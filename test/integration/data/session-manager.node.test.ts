import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { createPowerSyncChoresBackend } from '@family-organizer/data/powersync/chores';
import { SessionManager, SignInError } from '@family-organizer/data/session/manager';
import type { InstallationConfig } from '@family-organizer/data/session/platform';
import { __resetParentElevationRateLimitForTests } from '@/lib/parent-elevation-rate-limit';
import { DANA, DISHES, ELI, FAY, PINS, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';
import { createTestPlatform, type TestPlatform } from '@/test/utils/session-platform';

// Who is signed in on a device, and whose local database is whose. The databases are real, the server is the app's
// real routes on a real Postgres, and the device can be cut off from it.

const DAY = '2026-03-09';

let server: TestDatabase;
let platform: TestPlatform;
let config: InstallationConfig;
let manager: SessionManager;

beforeEach(async () => {
    __resetParentElevationRateLimitForTests();
    server = await createTestDatabase();
    await seedFamily(server);
    const installation = (await server.sql.query<{ id: string }>(`SELECT id FROM installation`)).rows[0];
    config = { installationId: installation.id, dataGeneration: 1, powersyncUrl: '/powersync' };
    platform = createTestPlatform();
    manager = await SessionManager.start(platform, config);
});
afterEach(async () => {
    await manager.stop();
    await platform.dispose();
    await server.close();
});

const file = (key: string, generation = 1) => `family-${config.installationId}-g${generation}-${key}.db`;
const who = () => manager.getSnapshot().device?.principal ?? null;
const onServer = async <Row = Record<string, any>>(text: string, params: unknown[] = []) => (await server.sql.query<Row>(text, params as any[])).rows;
const sessionStates = async () => Object.fromEntries((await onServer(`SELECT principal_type || coalesce('-' || family_member_id, '-shared') AS who, state FROM auth_sessions ORDER BY created_at`)).map((row) => [row.who, row.state]));

async function until(condition: () => Promise<boolean> | boolean, what: string): Promise<void> {
    const started = Date.now();
    while (!(await condition())) {
        if (Date.now() - started > 5000) throw new Error(`Timed out waiting until ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
}

/** What the family stream would have brought: enough for a chore to be completed. */
async function deliverChores(db: AbstractPowerSyncDatabase): Promise<void> {
    await db.execute(`INSERT OR REPLACE INTO chores (id, title, start_date, is_up_for_grabs, timing_mode) VALUES (?, 'Dishes', '2026-01-01', 0, 'anytime')`, [DISHES]);
    await db.execute(`DELETE FROM ps_crud`);
}

const completeDishes = (memberId: string, markedBy: string | null = null) => createPowerSyncChoresBackend(manager.getSnapshot().device!).completeChore({ choreId: DISHES, memberId, day: DAY, markedBy });

describe('signing in', () => {
    it('starts with nobody', () => {
        expect(manager.getSnapshot()).toEqual({ device: null, waiting: [], stranded: [] });
    });

    it('gives a kid a database of their own, named for the installation and for them', async () => {
        await manager.signIn({ familyMemberId: ELI });

        expect(who()).toEqual({ type: 'kid', familyMemberId: ELI });
        expect(platform.openFiles()).toEqual([file(`kid-${ELI}`)]);
        expect(await sessionStates()).toEqual({ [`kid-${ELI}`]: 'active' });
    });

    it('gives the shared kid session one too', async () => {
        await manager.signIn();
        expect(who()).toEqual({ type: 'kid', familyMemberId: null });
        expect(platform.openFiles()).toEqual([file('kid-shared')]);
    });

    it('changes nothing when the PIN is wrong', async () => {
        await manager.signIn({ familyMemberId: ELI });
        await expect(manager.signIn({ familyMemberId: FAY, pin: '0000' })).rejects.toMatchObject({ name: 'SignInError', code: 'incorrect_pin' });
        await expect(manager.signIn({ familyMemberId: FAY, pin: '0000' })).rejects.toBeInstanceOf(SignInError);
        expect(who()).toEqual({ type: 'kid', familyMemberId: ELI });
    });

    it('tells whoever is listening when the person changes', async () => {
        const seen: Array<string | null> = [];
        manager.subscribe(() => seen.push(who()?.familyMemberId ?? null));
        await manager.signIn({ familyMemberId: ELI });
        await manager.signOut();
        expect(seen).toEqual([ELI, null]);
    });

    it('is remembered: the device starts again as the same person, with no server to ask', async () => {
        await manager.signIn({ familyMemberId: ELI });
        await manager.stop();
        platform.setOnline(false);
        platform.requests.length = 0;

        manager = await SessionManager.start(platform, config);

        expect(who()).toEqual({ type: 'kid', familyMemberId: ELI });
        expect(platform.requests).toEqual([]);
    });
});

describe('a different kid signing in', () => {
    it('becomes the person the device rests on, and the first kid\'s database is emptied and their session ended', async () => {
        await manager.signIn({ familyMemberId: ELI });
        await deliverChores(manager.getSnapshot().device!.db);

        await manager.signIn({ familyMemberId: FAY, pin: PINS[FAY] });

        expect(who()).toEqual({ type: 'kid', familyMemberId: FAY });
        expect(platform.openFiles()).toEqual([file(`kid-${FAY}`)]);
        expect(await sessionStates()).toEqual({ [`kid-${ELI}`]: 'ended', [`kid-${FAY}`]: 'active' });
        const left = await platform.peek(file(`kid-${ELI}`));
        expect(await left.getAll(`SELECT 1 FROM chores`)).toEqual([]);
        await left.close();
    });
});

describe('a parent stepping in on a shared device', () => {
    beforeEach(async () => {
        await manager.signIn({ familyMemberId: ELI });
        await manager.signIn({ familyMemberId: DANA, pin: PINS[DANA], sharedDevice: true });
    });

    it('gets a database of their own, and the kid\'s is kept, closed', async () => {
        expect(who()).toEqual({ type: 'parent', familyMemberId: DANA });
        expect(platform.openFiles()).toEqual([file(`parent-${DANA}`)]);
        expect(await sessionStates()).toEqual({ [`kid-${ELI}`]: 'active', [`parent-${DANA}`]: 'active' });
    });

    it('is signed out back to the kid, with no network', async () => {
        platform.setOnline(false);

        await manager.signOut();

        expect(who()).toEqual({ type: 'kid', familyMemberId: ELI });
        expect(platform.openFiles()).toEqual([file(`kid-${ELI}`)]);
    });

    it('has their session ended on the server as soon as it can be told', async () => {
        platform.setOnline(false);
        await manager.signOut();
        expect((await sessionStates())[`parent-${DANA}`]).toBe('active');

        platform.setOnline(true);
        await manager.reconnected();

        expect(await sessionStates()).toEqual({ [`kid-${ELI}`]: 'active', [`parent-${DANA}`]: 'ended' });
    });

    it('leaves nothing of theirs in the kid\'s database, and what they changed offline is sent as them', async () => {
        const parentDb = manager.getSnapshot().device!.db;
        await deliverChores(parentDb);
        platform.setOnline(false);
        // The parent ticks Eli's dishes, and is signed out before the device is back online.
        await completeDishes(ELI, DANA);
        await manager.signOut();

        const kidDb = manager.getSnapshot().device!.db;
        expect(who()).toEqual({ type: 'kid', familyMemberId: ELI });
        expect(await kidDb.getAll(`SELECT 1 FROM chore_completions`)).toEqual([]);
        expect((await kidDb.getUploadQueueStats()).count).toBe(0);
        expect(await onServer(`SELECT 1 FROM chore_completions`)).toEqual([]);

        platform.setOnline(true);
        await until(async () => (await onServer(`SELECT 1 FROM chore_completions`)).length === 1, 'the parent\'s change has reached the server');

        expect(await onServer(`SELECT completed_by, marked_by FROM chore_completions`)).toEqual([{ completed_by: ELI, marked_by: DANA }]);
        expect(await onServer(`SELECT principal, mutation, outcome FROM sync_uploads`)).toEqual([{ principal: `parent-${DANA}`, mutation: 'completeChore', outcome: { ok: true } }]);
        // Once it has all been sent, the parent's database is emptied and their session ended.
        await until(async () => (await sessionStates())[`parent-${DANA}`] === 'ended', 'the parent\'s session has ended');
        expect(platform.openFiles()).toEqual([file(`kid-${ELI}`)]);
        const left = await platform.peek(file(`parent-${DANA}`));
        expect(await left.getAll(`SELECT 1 FROM chore_completions`)).toEqual([]);
        await left.close();
    });

    it('has their session narrowed to draining while something of theirs is still being sent', async () => {
        await deliverChores(manager.getSnapshot().device!.db);
        // The server is reachable but not taking writes, so the change cannot go yet.
        await server.sql.query(`UPDATE installation SET writes_frozen = true`);
        await completeDishes(ELI, DANA);

        await manager.signOut();

        expect(who()).toEqual({ type: 'kid', familyMemberId: ELI });
        expect((await sessionStates())[`parent-${DANA}`]).toBe('draining');

        await server.sql.query(`UPDATE installation SET writes_frozen = false`);
        await until(async () => (await sessionStates())[`parent-${DANA}`] === 'ended', 'the parent\'s session has ended');
        expect(await onServer(`SELECT marked_by FROM chore_completions`)).toEqual([{ marked_by: DANA }]);
    });
});

describe('a session that ends with changes unsent', () => {
    beforeEach(async () => {
        await manager.signIn({ familyMemberId: ELI });
        await deliverChores(manager.getSnapshot().device!.db);
        platform.setOnline(false);
        await completeDishes(ELI);
        // While the device is away, the session is ended on the server: revoked, or simply expired.
        await server.sql.query(`UPDATE auth_sessions SET state = 'ended', ended_at = now()`);
        platform.setOnline(true);
        await until(() => manager.getSnapshot().waiting.length === 1, 'the device has learned its session ended');
    });

    it('signs the person out and keeps what they had not sent, saying whose it is', async () => {
        expect(manager.getSnapshot()).toEqual({ device: null, waiting: [{ principal: { type: 'kid', familyMemberId: ELI }, count: 1 }], stranded: [] });
        expect(await onServer(`SELECT 1 FROM chore_completions`)).toEqual([]);
    });

    it('sends it when that person signs in again, under their new session', async () => {
        await manager.signIn({ familyMemberId: ELI });

        await until(async () => (await onServer(`SELECT 1 FROM chore_completions`)).length === 1, 'the kept change has reached the server');
        expect(await onServer(`SELECT completed_by FROM chore_completions`)).toEqual([{ completed_by: ELI }]);
        expect(manager.getSnapshot().waiting).toEqual([]);
    });

    it('does not send it as anyone else who signs in meanwhile', async () => {
        await manager.signIn({ familyMemberId: FAY, pin: PINS[FAY] });
        await new Promise((resolve) => setTimeout(resolve, 200));

        expect(await onServer(`SELECT 1 FROM chore_completions`)).toEqual([]);
        expect(manager.getSnapshot().waiting).toEqual([{ principal: { type: 'kid', familyMemberId: ELI }, count: 1 }]);
    });

    it('can be thrown away, once someone has decided to', async () => {
        await manager.discardWaiting({ type: 'kid', familyMemberId: ELI });
        expect(manager.getSnapshot().waiting).toEqual([]);
        await manager.signIn({ familyMemberId: ELI });
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(await onServer(`SELECT 1 FROM chore_completions`)).toEqual([]);
    });
});

describe('when the data under the app has been replaced', () => {
    it('opens nothing made under the old data, and shows what had not been sent so it can be made again', async () => {
        await manager.signIn({ familyMemberId: ELI });
        await deliverChores(manager.getSnapshot().device!.db);
        platform.setOnline(false);
        await completeDishes(ELI);
        await manager.stop();

        // A restore, or the cutover: a new generation of the data.
        manager = await SessionManager.start(platform, { ...config, dataGeneration: 2 });

        expect(manager.getSnapshot()).toEqual({ device: null, waiting: [], stranded: [{ principal: { type: 'kid', familyMemberId: ELI }, count: 1 }] });
        expect(platform.openFiles()).toEqual([]);

        // Signing in again is under the new generation, in a new database, with none of the old in it.
        platform.setOnline(true);
        await manager.signIn({ familyMemberId: ELI });
        expect(platform.openFiles()).toEqual([file(`kid-${ELI}`, 2)]);
        expect(await manager.getSnapshot().device!.db.getAll(`SELECT 1 FROM chore_completions`)).toEqual([]);
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(await onServer(`SELECT 1 FROM chore_completions`)).toEqual([]);

        await manager.discardStranded();
        expect(manager.getSnapshot().stranded).toEqual([]);
    });

    it('simply empties an old database that held nothing unsent', async () => {
        await manager.signIn({ familyMemberId: ELI });
        await deliverChores(manager.getSnapshot().device!.db);
        await manager.stop();

        manager = await SessionManager.start(platform, { ...config, dataGeneration: 2 });

        expect(manager.getSnapshot().stranded).toEqual([]);
        const old = await platform.peek(file(`kid-${ELI}`, 1));
        expect(await old.getAll(`SELECT 1 FROM chores`)).toEqual([]);
        await old.close();
    });
});
