import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AbstractPowerSyncDatabase, PowerSyncBackendConnector } from '@powersync/common';
import { PowerSyncDatabase } from '@powersync/node';
import { AppSchema } from '@family-organizer/data/powersync/schema';
import type { DevicePlatform, ServerResponse } from '@family-organizer/data/session/platform';
import { POST as signIn } from '@/app/api/auth/sessions/route';
import { DELETE as signOut, GET as currentSession } from '@/app/api/auth/sessions/current/route';
import { GET as syncToken } from '@/app/api/sync/token/route';
import { POST as upload } from '@/app/api/sync/upload/route';
import { deviceRequest } from './family-fixture';

// One device for tests of who is signed in: real PowerSync databases on temporary files, a small store in memory,
// and "the server" as the app's real route handlers, called directly. In place of the sync service, which a unit
// test has none of, a connected database simply has what it queues sent whenever the device is online.

export interface TestPlatform extends DevicePlatform {
    /** Cuts the device off from the server, or puts it back. */
    setOnline(online: boolean): void;
    setNow(iso: string): void;
    /** The file names of the databases this device has opened and not yet closed. */
    openFiles(): string[];
    /** Opens a database by file name without going through the session manager, to look inside it. */
    peek(fileName: string): Promise<AbstractPowerSyncDatabase>;
    /** Every request the device made, as `METHOD path`. */
    requests: string[];
    dispose(): Promise<void>;
}

const routes: Array<[string, RegExp, (request: any) => Promise<Response>]> = [
    ['POST', /^\/api\/auth\/sessions$/, signIn],
    ['GET', /^\/api\/auth\/sessions\/current$/, currentSession],
    ['DELETE', /^\/api\/auth\/sessions\/current(\?.*)?$/, signOut],
    ['GET', /^\/api\/sync\/token$/, syncToken],
    ['POST', /^\/api\/sync\/upload$/, upload],
];

/**
 * `syncUrl` makes this a device that really syncs: its databases connect to the PowerSync service at that address,
 * and going offline disconnects them. Without it, uploads are pumped as described above and nothing is downloaded.
 */
export function createTestPlatform(options: { syncUrl?: string } = {}): TestPlatform {
    const directory = mkdtempSync(path.join(tmpdir(), 'platform-'));
    const connected = new Map<AbstractPowerSyncDatabase, PowerSyncBackendConnector>();
    const syncOptions = { crudUploadThrottleMs: 50, retryDelayMs: 300 };
    const stored = new Map<string, string>();
    const open = new Map<string, PowerSyncDatabase>();
    const pumps = new Set<() => void>();
    let online = true;
    let now = '2026-03-09T12:00:00.000Z';
    const requests: string[] = [];

    const openDatabase = (fileName: string) => {
        const db = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: fileName, dbLocation: directory, implementation: { type: 'node:sqlite' } } });
        open.set(fileName, db);
        const close = db.close.bind(db);
        db.close = async (...args: Parameters<typeof close>) => {
            open.delete(fileName);
            return close(...args);
        };
        return db;
    };

    return {
        requests,
        openDatabase,
        async connect(db: AbstractPowerSyncDatabase, connector: PowerSyncBackendConnector) {
            if (options.syncUrl) {
                connected.set(db, connector);
                if (online) await db.connect(connector, syncOptions);
                return;
            }
            // What the sync service's client does for uploads: whenever something is queued, hand it to the connector.
            let stopped = false;
            const pump = async () => {
                while (!stopped && !db.closed) {
                    try {
                        if (online && (await db.getUploadQueueStats()).count > 0) await connector.uploadData(db);
                    } catch {
                        // Tried again on the next turn, as the real client does.
                    }
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
            };
            pumps.add(() => (stopped = true));
            void pump();
        },
        storage: {
            get: async (key) => stored.get(key) ?? null,
            set: async (key, value) => void stored.set(key, value),
        },
        async request(requestPath, init = {}): Promise<ServerResponse> {
            const method = init.method ?? 'GET';
            requests.push(`${method} ${requestPath}`);
            if (!online) throw new Error('The server cannot be reached.');
            const route = routes.find(([routeMethod, pattern]) => routeMethod === method && pattern.test(requestPath));
            if (!route) throw new Error(`The test platform has no route for ${method} ${requestPath}`);
            const response = await route[2](deviceRequest(requestPath, { method, body: init.body, sessionToken: init.sessionToken }));
            return { status: response.status, json: () => response.json() };
        },
        resolveUrl: (pathOrUrl) => options.syncUrl ?? new URL(pathOrUrl, 'https://family.test').toString(),
        createId: () => randomUUID(),
        now: () => new Date(now),
        setOnline(value) {
            online = value;
            // A device that really syncs loses its connection to the sync service along with the server.
            for (const [db, connector] of Array.from(connected)) {
                if (db.closed) connected.delete(db);
                else if (value) void db.connect(connector, syncOptions);
                else void db.disconnect();
            }
        },
        setNow(iso) {
            now = iso;
        },
        openFiles: () => Array.from(open.keys()).sort(),
        async peek(fileName) {
            const db = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: fileName, dbLocation: directory, implementation: { type: 'node:sqlite' } } });
            await db.init();
            return db;
        },
        async dispose() {
            for (const stop of Array.from(pumps)) stop();
            await Promise.all(Array.from(open.values()).map((db) => db.close().catch(() => undefined)));
            rmSync(directory, { recursive: true, force: true });
        },
    };
}
