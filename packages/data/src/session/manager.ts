import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { createConnector, type UploadBody } from '../powersync/connector';
import type { Device } from '../powersync/device';
import type { DevicePlatform, InstallationConfig } from './platform';
import { principalKey, type Principal } from './principal';

// Who is signed in on this device, and whose local database is whose
// (docs/powersync-migration.md, "One database per person").
//
// A database belongs to one principal. The interface is given one at a time: the signed-in person's. When someone
// else takes over, the database left behind is closed to the interface; if it still holds changes that have not
// been sent, it goes on sending them in the background, as the person who made them, and is emptied when it has.
// One database is kept between visits: that of the person the device rests on, the one it returns to when a
// parent who stepped in is signed out.

/** Why a sign-in did not happen, as the server put it. */
export class SignInError extends Error {
    constructor(readonly code: string, message: string, readonly retryAfterSeconds: number | null = null) {
        super(message);
        this.name = 'SignInError';
    }
}

type HeldState =
    /** In use, or resting until its person comes back. */
    | 'active'
    /** Its person has left. It is only finishing sending what it holds. */
    | 'draining'
    /** Its session has ended with changes still unsent. They wait for its person to sign in again. */
    | 'waiting';

interface HeldSession {
    principal: Principal;
    token: string;
    state: HeldState;
}

interface StoredState {
    installationId: string;
    dataGeneration: number;
    /** Whose database the interface is showing. */
    current: string | null;
    /** Whose database is kept when someone else is signed in over them. */
    resting: string | null;
    sessions: Record<string, HeldSession>;
    /** Sessions to end on the server when it can next be reached. */
    toEnd: string[];
    /** Databases made under data that has since been replaced, which still hold changes that were never sent. */
    stranded: StrandedDatabase[];
}

interface StrandedDatabase {
    fileName: string;
    principal: Principal;
    count: number;
}

/** Changes that have not been sent and cannot be until their person signs in on this device again. */
export interface WaitingChanges {
    principal: Principal;
    count: number;
}

export interface SessionSnapshot {
    /** The signed-in person and their database, or `null` when nobody is signed in. */
    device: Device | null;
    /** Changes that will be sent when the person who made them signs in on this device again. */
    waiting: readonly WaitingChanges[];
    /**
     * Changes that can no longer be sent at all: the data they were made against has been replaced, at a cutover
     * or a restore. They are shown so that they can be made again by hand, and then discarded.
     */
    stranded: readonly WaitingChanges[];
}

const STORAGE_KEY = 'family-organizer.sessions';

const emptyState = (config: InstallationConfig): StoredState => ({
    installationId: config.installationId,
    dataGeneration: config.dataGeneration,
    current: null,
    resting: null,
    sessions: {},
    toEnd: [],
    stranded: [],
});

/** The name embeds the installation and its data generation, so a database is never opened against other data. */
const fileNameFor = (state: Pick<StoredState, 'installationId' | 'dataGeneration'>, key: string) => `family-${state.installationId}-g${state.dataGeneration}-${key}.db`;

async function pendingChanges(db: AbstractPowerSyncDatabase): Promise<number> {
    const rows = await db.getAll<{ changes: number }>('SELECT count(DISTINCT tx_id) AS changes FROM ps_crud');
    return rows[0]?.changes ?? 0;
}

export class SessionManager {
    private state: StoredState;
    private readonly open = new Map<string, AbstractPowerSyncDatabase>();
    private readonly draining = new Map<string, () => void>();
    private readonly listeners = new Set<() => void>();
    private snapshot: SessionSnapshot = { device: null, waiting: [], stranded: [] };
    private queue: Promise<unknown> = Promise.resolve();

    private constructor(private readonly platform: DevicePlatform, private readonly config: InstallationConfig, state: StoredState) {
        this.state = state;
    }

    /** Picks up where the device left off: the person who was signed in, and anything still being sent for others. */
    static async start(platform: DevicePlatform, config: InstallationConfig): Promise<SessionManager> {
        const stored = await platform.storage.get(STORAGE_KEY);
        let state: StoredState | null = null;
        try {
            state = stored ? (JSON.parse(stored) as StoredState) : null;
        } catch {
            state = null;
        }
        const manager = new SessionManager(platform, config, emptyState(config));
        if (state && (state.installationId !== config.installationId || state.dataGeneration !== config.dataGeneration)) {
            // The data under the app has been replaced. Nothing made under the old data may be opened against the new.
            manager.state.stranded = await manager.retire(state);
            await manager.save();
            state = null;
        }
        if (state) manager.state = { ...emptyState(config), ...state };
        await manager.enqueue(async () => {
            for (const [key, held] of Object.entries(manager.state.sessions)) if (held.state === 'draining') manager.drainInBackground(key);
            await manager.endSessionsOwed();
            await manager.refresh();
        });
        return manager;
    }

    getSnapshot = (): SessionSnapshot => this.snapshot;

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    /**
     * Signs someone in. With no family member it is the shared kid session. A kid, or the shared session, becomes
     * the person the device rests on. A parent does too on their own device; on a shared one they are stepping in
     * over whoever is there, and the device goes back to that person when the parent signs out.
     */
    signIn(input: { familyMemberId?: string | null; pin?: string | null; sharedDevice?: boolean } = {}): Promise<void> {
        return this.enqueue(async () => {
            const response = await this.platform.request('/api/auth/sessions', { method: 'POST', body: { familyMemberId: input.familyMemberId ?? undefined, pin: input.pin ?? undefined } });
            const body = await response.json();
            if (response.status !== 200) throw new SignInError(String(body?.code ?? 'sign_in_failed'), String(body?.error ?? 'Could not sign in'), body?.retryAfterSeconds ?? null);
            const principal: Principal = body.session.principalType === 'parent' ? { type: 'parent', familyMemberId: body.session.familyMemberId } : { type: 'kid', familyMemberId: body.session.familyMemberId ?? null };
            const key = principalKey(principal);

            // A session of theirs may still be here: resting, draining, or waiting with changes that could not be
            // sent. The new one takes its place, and whatever their database holds is now sent under it.
            const earlier = this.state.sessions[key];
            if (earlier && earlier.token !== body.token) this.state.toEnd.push(earlier.token);
            this.stopDraining(key);
            // Closed, so that it is opened again connected under the new session.
            if (earlier) await this.closeDatabase(key);
            this.state.sessions[key] = { principal, token: body.token, state: 'active' };

            const previous = this.state.current;
            const steppingIn = principal.type === 'parent' && input.sharedDevice === true && this.state.resting !== null;
            const previousResting = this.state.resting;
            this.state.current = key;
            if (!steppingIn) this.state.resting = key;
            await this.save();

            for (const left of Array.from(new Set([previous, previousResting]))) {
                if (left && left !== key && left !== this.state.resting) await this.leave(left);
                else if (left && left !== key) await this.closeDatabase(left);
            }
            await this.endSessionsOwed();
            await this.refresh();
        });
    }

    /**
     * Signs the current person out. If they had stepped in over someone, the device goes back to that person, whose
     * database is still here, so this works with no network. Otherwise nobody is signed in.
     */
    signOut(): Promise<void> {
        return this.enqueue(async () => {
            const leaving = this.state.current;
            if (!leaving) return;
            const back = this.state.resting !== leaving ? this.state.resting : null;
            this.state.current = back;
            if (!back) this.state.resting = null;
            await this.save();
            await this.leave(leaving);
            await this.refresh();
        });
    }

    /** The server can be reached again: tell it about the sessions this device finished with while it could not. */
    reconnected(): Promise<void> {
        return this.enqueue(() => this.endSessionsOwed());
    }

    /** Throws away changes that were waiting for someone to sign in. A parent's decision, made after seeing them. */
    discardWaiting(principal: Principal): Promise<void> {
        return this.enqueue(async () => {
            const key = principalKey(principal);
            if (this.state.sessions[key]?.state !== 'waiting') return;
            await this.empty(key);
            delete this.state.sessions[key];
            await this.save();
            await this.refresh();
        });
    }

    /** Throws away changes that were made against data that has since been replaced, once they have been seen. */
    discardStranded(): Promise<void> {
        return this.enqueue(async () => {
            for (const { fileName } of this.state.stranded) {
                const db = this.platform.openDatabase(fileName);
                await db.init();
                await db.disconnectAndClear();
                await db.close();
            }
            this.state.stranded = [];
            await this.save();
            await this.refresh();
        });
    }

    /** Stops everything. The databases and the stored sessions stay as they are for the next start. */
    async stop(): Promise<void> {
        await this.enqueue(async () => {
            for (const stop of Array.from(this.draining.values())) stop();
            this.draining.clear();
            for (const key of Array.from(this.open.keys())) await this.closeDatabase(key);
        });
    }

    // ---- What follows runs one step at a time, in the order it was asked for ----

    private enqueue<Result>(step: () => Promise<Result>): Promise<Result> {
        const next = this.queue.then(step, step);
        this.queue = next.catch(() => undefined);
        return next;
    }

    private save(): Promise<void> {
        return this.platform.storage.set(STORAGE_KEY, JSON.stringify(this.state));
    }

    private async database(key: string): Promise<AbstractPowerSyncDatabase> {
        let db = this.open.get(key);
        if (!db) {
            db = this.platform.openDatabase(fileNameFor(this.state, key));
            await db.init();
            this.open.set(key, db);
        }
        return db;
    }

    private async closeDatabase(key: string): Promise<void> {
        const db = this.open.get(key);
        if (!db) return;
        this.open.delete(key);
        await db.close();
    }

    /** How many changes a database is still waiting to send: one for each mutation, however many rows it wrote. */
    private async pendingCount(key: string): Promise<number> {
        return pendingChanges(await this.database(key));
    }

    /** Starts a database syncing under its own person's session. */
    private async connect(key: string): Promise<void> {
        const held = this.state.sessions[key];
        if (!held) return;
        const db = await this.database(key);
        const sessionToken = held.token;
        const connector = createConnector({
            dataGeneration: this.state.dataGeneration,
            fetchCredentials: async () => {
                const response = await this.platform.request('/api/sync/token', { sessionToken });
                if (response.status === 401) void this.sessionEnded(key, sessionToken);
                if (response.status !== 200) throw new Error(`No sync token (${response.status}).`);
                return { endpoint: this.platform.resolveUrl(this.config.powersyncUrl), token: (await response.json()).token };
            },
            upload: async (body: UploadBody) => {
                const response = await this.platform.request('/api/sync/upload', { method: 'POST', body, sessionToken });
                // Applied or refused, the server has answered for this transaction and it must not be sent again.
                if (response.status === 200) return;
                if (response.status === 401) void this.sessionEnded(key, sessionToken);
                throw new Error(`The upload was not taken (${response.status}).`);
            },
        });
        await this.platform.connect(db, connector);
    }

    /**
     * Someone has stopped using a database. With nothing left to send it is emptied and its session ended. With
     * something left, the session is narrowed to draining and the sending goes on in the background.
     */
    private async leave(key: string): Promise<void> {
        const held = this.state.sessions[key];
        if (!held) return;
        if (held.state === 'waiting') {
            await this.closeDatabase(key);
            return;
        }
        if ((await this.pendingCount(key)) === 0) {
            await this.empty(key);
            this.state.toEnd.push(held.token);
            delete this.state.sessions[key];
            await this.save();
            await this.endSessionsOwed();
            return;
        }
        held.state = 'draining';
        await this.save();
        // Best effort: an active session can upload too, so nothing is lost if the server cannot be told yet.
        await this.platform.request('/api/auth/sessions/current?drain=1', { method: 'DELETE', sessionToken: held.token }).catch(() => undefined);
        this.drainInBackground(key);
    }

    /** Keeps a left-behind database sending until it has nothing left, then empties it and ends its session. */
    private drainInBackground(key: string): void {
        if (this.draining.has(key)) return;
        let stopped = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        this.draining.set(key, () => {
            stopped = true;
            if (timer) clearTimeout(timer);
        });
        const check = async () => {
            if (stopped) return;
            await this.enqueue(async () => {
                const held = this.state.sessions[key];
                if (stopped || !held || held.state !== 'draining') return;
                if ((await this.pendingCount(key)) > 0) return;
                this.stopDraining(key);
                await this.empty(key);
                this.state.toEnd.push(held.token);
                delete this.state.sessions[key];
                await this.save();
                await this.endSessionsOwed();
                await this.refresh();
            });
            if (!stopped && this.draining.has(key)) timer = setTimeout(() => void check(), 500);
        };
        void this.enqueue(() => this.connect(key)).then(check, check);
    }

    private stopDraining(key: string): void {
        this.draining.get(key)?.();
        this.draining.delete(key);
    }

    /** Takes everything out of a database and closes it. */
    private async empty(key: string): Promise<void> {
        const db = await this.database(key);
        await db.disconnectAndClear();
        await this.closeDatabase(key);
    }

    /** The server no longer accepts a session. What its database still holds waits for its person to sign in again. */
    private sessionEnded(key: string, token: string): Promise<void> {
        return this.enqueue(async () => {
            const held = this.state.sessions[key];
            if (!held || held.token !== token || held.state === 'waiting') return;
            this.stopDraining(key);
            const db = await this.database(key);
            await db.disconnect();
            if ((await this.pendingCount(key)) > 0) {
                held.state = 'waiting';
            } else {
                await this.empty(key);
                delete this.state.sessions[key];
            }
            if (this.state.current === key) this.state.current = null;
            if (this.state.resting === key) this.state.resting = null;
            await this.closeDatabase(key);
            await this.save();
            await this.refresh();
        });
    }

    /** Tells the server about sessions this device has finished with. Any it cannot reach are kept for next time. */
    private async endSessionsOwed(): Promise<void> {
        const owed = this.state.toEnd;
        if (!owed.length) return;
        const still: string[] = [];
        for (const token of owed) {
            try {
                await this.platform.request('/api/auth/sessions/current', { method: 'DELETE', sessionToken: token });
            } catch {
                still.push(token);
            }
        }
        this.state.toEnd = still;
        await this.save();
    }

    /** Databases made under data that has since been replaced: emptied if they hold nothing unsent, kept aside if they do. */
    private async retire(old: StoredState): Promise<StrandedDatabase[]> {
        const stranded: StrandedDatabase[] = [...(old.stranded ?? [])];
        for (const [key, held] of Object.entries(old.sessions ?? {})) {
            const fileName = fileNameFor(old, key);
            const db = this.platform.openDatabase(fileName);
            await db.init();
            const count = await pendingChanges(db);
            if (count === 0) await db.disconnectAndClear();
            else stranded.push({ fileName, principal: held.principal, count });
            await db.close();
        }
        return stranded;
    }

    /** Works out what the interface should now be shown, and says so. */
    private async refresh(): Promise<void> {
        const key = this.state.current;
        const held = key ? this.state.sessions[key] : undefined;
        let device: Device | null = null;
        if (key && held && held.state === 'active') {
            const db = await this.database(key);
            if (this.snapshot.device?.db !== db) await this.connect(key);
            device = this.snapshot.device?.db === db ? this.snapshot.device : { db, principal: held.principal, createId: this.platform.createId, now: this.platform.now };
        }
        const waiting: WaitingChanges[] = [];
        for (const [waitingKey, session] of Object.entries(this.state.sessions)) {
            if (session.state !== 'waiting') continue;
            waiting.push({ principal: session.principal, count: await this.pendingCount(waitingKey) });
            await this.closeDatabase(waitingKey);
        }
        this.snapshot = { device, waiting, stranded: this.state.stranded.map(({ principal, count }) => ({ principal, count })) };
        for (const listener of Array.from(this.listeners)) listener();
    }
}
