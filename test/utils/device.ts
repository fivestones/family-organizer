import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PowerSyncDatabase } from '@powersync/node';
import type { Principal } from '@family-organizer/data';
import { nextUpload, type UploadBody } from '@family-organizer/data/powersync/connector';
import type { Device } from '@family-organizer/data/powersync/device';
import { AppSchema } from '@family-organizer/data/powersync/schema';

// A device for tests: PowerSync's own SQLite, on a temporary file, never connected to anything. It carries the
// real schema, runs the real mutations, and queues exactly what a real device would upload.

export interface TestDevice {
    device: Device;
    /** Puts rows on the device as though sync had delivered them: present, and not waiting to be uploaded. */
    receive(table: string, rows: Array<Record<string, unknown>>): Promise<void>;
    /** Everything the device is waiting to upload, oldest first, taken off its queue. */
    takeUploads(): Promise<UploadBody[]>;
    rows<Row = Record<string, any>>(sql: string, parameters?: unknown[]): Promise<Row[]>;
    setNow(iso: string): void;
    close(): Promise<void>;
}

/** What a test's pretend server answers a request with. Without one, the device is offline. */
export type TestServer = (path: string, init: { method?: string; body?: unknown }) => Promise<{ status: number; body?: unknown }> | { status: number; body?: unknown };

export async function openTestDevice(principal: Principal, options: { now?: string; dataGeneration?: number; server?: TestServer } = {}): Promise<TestDevice> {
    const directory = mkdtempSync(path.join(tmpdir(), 'device-'));
    const db = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: 'device.db', dbLocation: directory, implementation: { type: 'node:sqlite' } } });
    await db.init();
    let now = options.now ?? '2026-03-09T12:00:00.000Z';
    const device: Device = {
        db,
        principal,
        createId: () => randomUUID(),
        now: () => new Date(now),
        sessionToken: 'a-test-session',
        async request(path, init = {}) {
            if (!options.server) throw new Error('offline');
            const answer = await options.server(path, init);
            return { status: answer.status, json: async () => answer.body ?? {} };
        },
    };

    return {
        device,
        async receive(table, rows) {
            for (const row of rows) {
                const columns = Object.keys(row);
                await db.execute(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, Object.values(row));
            }
            await db.execute('DELETE FROM ps_crud');
        },
        async takeUploads() {
            const bodies: UploadBody[] = [];
            for (;;) {
                const pending = await nextUpload(db, options.dataGeneration ?? 1);
                if (!pending) return bodies;
                bodies.push(pending.body);
                await pending.complete();
            }
        },
        rows: (sql, parameters = []) => db.getAll(sql, parameters as any[]),
        setNow(iso) {
            now = iso;
        },
        async close() {
            await db.close();
            rmSync(directory, { recursive: true, force: true });
        },
    };
}
