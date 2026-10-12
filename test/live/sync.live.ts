import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { createPowerSyncChoresBackend } from '@family-organizer/data/powersync/chores';
import { createPowerSyncSettingsBackend } from '@family-organizer/data/powersync/settings';
import { SessionManager } from '@family-organizer/data/session/manager';
import type { InstallationConfig } from '@family-organizer/data/session/platform';
import { __resetParentElevationRateLimitForTests } from '@/lib/parent-elevation-rate-limit';
import { getDb, type AppDatabase } from '@/lib/server/db';
import { hashPinServer } from '@/lib/server/pin';
import { DANA, DISHES, ELI, FAY, LAUNDRY, PINS, seedFamily } from '@/test/utils/family-fixture';
import { createTestPlatform, type TestPlatform } from '@/test/utils/session-platform';
import { sql } from 'kysely';

// The whole path, with nothing stood in for: real devices, the app's real routes, a real Postgres and the real
// PowerSync service between them. Run with `npm run test:sync:live`, which starts the service in Docker first.

const envFile = path.join(process.cwd(), '.migration', 'sync-test', 'env');
if (!existsSync(envFile)) throw new Error('The sync test stack is not running. Use `npm run test:sync:live`.');
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match) process.env[match[1]] = match[2];
}

const DAY = '2026-03-09';
let db: AppDatabase;
let config: InstallationConfig;
const devices: Array<{ platform: TestPlatform; manager: SessionManager }> = [];

const serverRows = async <Row = Record<string, any>>(text: string) => (await sql.raw<Row>(text).execute(db)).rows;
const query = { query: async (text: string, params: unknown[] = []) => ({ rows: (await sql.raw(text.replace(/\$(\d+)/g, (_, n) => `'${String(params[Number(n) - 1]).replace(/'/g, "''")}'`)).execute(db)).rows }) };

async function until(condition: () => Promise<boolean> | boolean, what: string, timeoutMs = 15_000): Promise<number> {
    const started = Date.now();
    while (!(await condition())) {
        if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting until ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return Date.now() - started;
}

/** A device, started with nobody signed in. */
async function device() {
    const platform = createTestPlatform({ syncUrl: process.env.POWERSYNC_URL });
    const manager = await SessionManager.start(platform, config);
    devices.push({ platform, manager });
    return { platform, manager, db: () => manager.getSnapshot().device!.db, device: () => manager.getSnapshot().device! };
}

const synced = async (database: AbstractPowerSyncDatabase) => {
    await database.waitForFirstSync();
    return database;
};
const has = async (database: AbstractPowerSyncDatabase, text: string, parameters: unknown[] = []) => (await database.getAll(text, parameters as any[])).length > 0;

beforeAll(async () => {
    db = getDb();
    const installation = await db.selectFrom('installation').selectAll().executeTakeFirstOrThrow();
    config = { installationId: installation.id, dataGeneration: installation.data_generation, powersyncUrl: process.env.POWERSYNC_URL! };
});
afterAll(() => db.destroy());

beforeEach(async () => {
    __resetParentElevationRateLimitForTests();
    for (const table of ['write_refusals', 'sync_uploads', 'auth_sessions', 'history_event_members', 'history_events', 'chore_completions', 'chore_assignees', 'chores', 'family_members', 'unit_definitions', 'settings']) {
        await sql.raw(`DELETE FROM ${table}`).execute(db);
    }
    await seedFamily({ sql: query } as any);
});
afterEach(async () => {
    for (const { platform, manager } of devices.splice(0)) {
        await manager.stop();
        await platform.dispose();
    }
});

describe('what a device is sent', () => {
    it('is the family\'s data, with whether each person has a PIN and never the PIN', async () => {
        const kid = await device();
        await kid.manager.signIn({ familyMemberId: ELI });
        const local = await synced(kid.db());

        expect(await local.getAll(`SELECT name, role, has_pin FROM family_members ORDER BY sort_order`)).toEqual([
            { name: 'Dana', role: 'parent', has_pin: 1 }, { name: 'Eli', role: 'child', has_pin: 0 }, { name: 'Fay', role: 'child', has_pin: 1 },
        ]);
        expect((await local.getAll<{ title: string }>(`SELECT title FROM chores ORDER BY title`)).map((row) => row.title)).toEqual(['Dishes', 'Laundry']);
        expect(await local.getAll(`SELECT id FROM chore_assignees ORDER BY id`)).toHaveLength(4);
        const columns = (await local.getAll<{ name: string }>(`SELECT name FROM pragma_table_info('family_members')`)).map((row) => row.name);
        expect(columns).not.toContain('pin_hash');
    });

    it('follows a change made on the server: a PIN set there shows as set here', async () => {
        const kid = await device();
        await kid.manager.signIn({ familyMemberId: ELI });
        const local = await synced(kid.db());

        await db.updateTable('family_members').set({ pin_hash: hashPinServer('9999') }).where('id', '=', ELI).execute();

        await until(() => has(local, `SELECT 1 FROM family_members WHERE id = ? AND has_pin = 1`, [ELI]), 'the device sees the PIN is set');
    });
});

describe('a completion', () => {
    it('made on one device appears in Postgres and on another device', async () => {
        const kid = await device();
        await kid.manager.signIn({ familyMemberId: ELI });
        await synced(kid.db());
        const parent = await device();
        await parent.manager.signIn({ familyMemberId: DANA, pin: PINS[DANA] });
        const parentDb = await synced(parent.db());

        await createPowerSyncChoresBackend(kid.device()).completeChore({ choreId: DISHES, memberId: ELI, day: DAY });

        const took = await until(() => has(parentDb, `SELECT 1 FROM chore_completions WHERE chore_id = ? AND completed_by = ?`, [DISHES, ELI]), 'the other device has the completion');
        expect(await serverRows(`SELECT completed_by FROM chore_completions`)).toEqual([{ completed_by: ELI }]);
        expect(await has(parentDb, `SELECT 1 FROM history_events WHERE action_type = 'chore_marked_done'`)).toBe(true);
        console.log(`one device to another: ${took} ms`);
    });

    it('made with no network is sent when the device is back', async () => {
        const kid = await device();
        await kid.manager.signIn({ familyMemberId: ELI });
        await synced(kid.db());
        kid.platform.setOnline(false);

        await createPowerSyncChoresBackend(kid.device()).completeChore({ choreId: DISHES, memberId: ELI, day: DAY });
        await new Promise((resolve) => setTimeout(resolve, 400));
        expect(await serverRows(`SELECT 1 FROM chore_completions`)).toEqual([]);

        kid.platform.setOnline(true);
        await until(async () => (await serverRows(`SELECT 1 FROM chore_completions`)).length === 1, 'the completion has reached the server');
    });
});

describe('two kids claiming one chore with no network', () => {
    it('leaves it with the first to return, and tells the second on their own device', async () => {
        const eli = await device();
        await eli.manager.signIn({ familyMemberId: ELI });
        await synced(eli.db());
        const fay = await device();
        await fay.manager.signIn({ familyMemberId: FAY, pin: PINS[FAY] });
        await synced(fay.db());
        eli.platform.setOnline(false);
        fay.platform.setOnline(false);

        const first = await createPowerSyncChoresBackend(eli.device()).completeChore({ choreId: LAUNDRY, memberId: ELI, day: DAY });
        const second = await createPowerSyncChoresBackend(fay.device()).completeChore({ choreId: LAUNDRY, memberId: FAY, day: DAY });
        expect([first.status, second.status]).toEqual(['completed', 'completed']);

        eli.platform.setOnline(true);
        await until(async () => (await serverRows(`SELECT 1 FROM chore_completions`)).length === 1, 'the first claim has reached the server');
        fay.platform.setOnline(true);

        // Fay's device learns it was refused, and what it shows goes back to what is true.
        await until(() => has(fay.db(), `SELECT 1 FROM write_refusals WHERE reason = 'already_claimed' AND mutation = 'completeChore'`), 'the second device has the refusal');
        await until(() => has(fay.db(), `SELECT 1 FROM chore_completions WHERE completed_by = ?`, [ELI]), 'the second device shows the first kid\'s claim');
        expect(await fay.db().getAll(`SELECT completed_by FROM chore_completions`)).toEqual([{ completed_by: ELI }]);
        expect(await serverRows(`SELECT completed_by FROM chore_completions`)).toEqual([{ completed_by: ELI }]);
        // The refusal is Fay's. Eli's device is not sent it.
        expect(await eli.db().getAll(`SELECT 1 FROM write_refusals`)).toEqual([]);
    });
});

describe('a parent on a shared device', () => {
    it('is sent what a kid is not, in a database of their own, and their offline change goes up as theirs after they are signed out', async () => {
        const shared = await device();
        await shared.manager.signIn({ familyMemberId: ELI });
        await synced(shared.db());
        await shared.manager.signIn({ familyMemberId: DANA, pin: PINS[DANA], sharedDevice: true });
        await synced(shared.db());
        shared.platform.setOnline(false);

        await createPowerSyncChoresBackend(shared.device()).completeChore({ choreId: DISHES, memberId: ELI, day: DAY, markedBy: DANA });
        await createPowerSyncSettingsBackend(shared.device()).saveStoredSetting('dashboardTheme', 'dark');
        await shared.manager.signOut();

        expect(shared.manager.getSnapshot().device!.principal).toEqual({ type: 'kid', familyMemberId: ELI });
        expect(await shared.db().getAll(`SELECT 1 FROM chore_completions`)).toEqual([]);

        shared.platform.setOnline(true);
        await until(async () => (await serverRows(`SELECT 1 FROM sync_uploads`)).length === 2, 'both of the parent\'s changes have reached the server');
        expect(await serverRows(`SELECT DISTINCT principal FROM sync_uploads`)).toEqual([{ principal: `parent-${DANA}` }]);
        expect(await serverRows(`SELECT marked_by FROM chore_completions`)).toEqual([{ marked_by: DANA }]);
        // The kid's own database is then sent the result, as any device would be.
        await until(() => has(shared.db(), `SELECT 1 FROM chore_completions WHERE marked_by = ?`, [DANA]), 'the kid\'s database has the completion');
        await until(() => has(shared.db(), `SELECT 1 FROM settings WHERE id = 'dashboardTheme' AND value = '"dark"'`), 'the kid\'s database has the setting');
        await until(async () => (await serverRows(`SELECT state FROM auth_sessions WHERE principal_type = 'parent'`))[0].state === 'ended', 'the parent\'s session has ended');
    });
});
