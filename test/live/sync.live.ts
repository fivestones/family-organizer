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
import { createSession } from '@/lib/server/sessions';
import { applyUpload } from '@/lib/server/upload';
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

/**
 * Waits until a device holds the family this test seeded. A first sync alone is not enough to wait for: the sync
 * service may still be a moment behind the rows a test has just put into Postgres.
 */
const synced = async (database: AbstractPowerSyncDatabase) => {
    await database.waitForFirstSync();
    await until(async () => (await database.getAll<{ name: string }>(`SELECT name FROM family_members ORDER BY sort_order`)).map((row) => row.name).join() === 'Dana,Eli,Fay', 'the device holds the seeded family');
    return database;
};
const has = async (database: AbstractPowerSyncDatabase, text: string, parameters: unknown[] = []) => (await database.getAll(text, parameters as any[])).length > 0;

beforeAll(async () => {
    db = getDb();
    // These tests empty the tables they use. They are for the throwaway stack and nothing else.
    const rows = await sql<{ members: number }>`SELECT count(*)::int AS members FROM family_members WHERE name NOT IN ('Dana', 'Eli', 'Fay')`.execute(db);
    if (rows.rows[0]!.members > 0) throw new Error('This database holds a family that is not the test fixture. Refusing to run against it.');
    const installation = await db.selectFrom('installation').selectAll().executeTakeFirstOrThrow();
    config = { installationId: installation.id, dataGeneration: installation.data_generation, powersyncUrl: process.env.POWERSYNC_URL! };
});
afterAll(() => db.destroy());

beforeEach(async () => {
    __resetParentElevationRateLimitForTests();
    await sql.raw(`UPDATE family_members SET default_envelope_id = NULL`).execute(db);
    for (const table of ['write_refusals', 'sync_uploads', 'auth_sessions', 'exchange_rates', 'allowance_transactions', 'envelope_balances', 'allowance_envelopes', 'task_series', 'grade_types', 'history_event_members', 'history_events', 'countdown_runs', 'routine_marker_statuses', 'routine_steps', 'routines', 'chore_completions', 'chore_assignees', 'chores', 'family_members', 'unit_definitions', 'settings']) {
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

describe('routines and the countdown', () => {
    it('reach a device with keys made of two parts, and a kid\'s own run goes up with its list of skipped chores', async () => {
        const ROUTINE = '00000000-0000-4000-8000-000000000080';
        const RUN = '00000000-0000-4000-8000-000000000090';
        await sql.raw(`INSERT INTO routines (id, name, on_step_overrun) VALUES ('${ROUTINE}', 'Evening', 'advance')`).execute(db);
        await sql.raw(`INSERT INTO routine_steps (routine_id, chore_id, position) VALUES ('${ROUTINE}', '${DISHES}', 0), ('${ROUTINE}', '${LAUNDRY}', 1)`).execute(db);
        await sql.raw(`INSERT INTO routine_marker_statuses (day, marker_key, started_at, started_by) VALUES ('${DAY}', 'dinner', '2026-03-09T18:00:00Z', '${DANA}')`).execute(db);
        const kid = await device();
        await kid.manager.signIn({ familyMemberId: ELI });
        const local = await synced(kid.db());

        expect(await local.getAll(`SELECT id, routine_id, chore_id FROM routine_steps ORDER BY position`)).toEqual([
            { id: `${ROUTINE}.${DISHES}`, routine_id: ROUTINE, chore_id: DISHES }, { id: `${ROUTINE}.${LAUNDRY}`, routine_id: ROUTINE, chore_id: LAUNDRY },
        ]);
        expect(await local.getAll(`SELECT id, day, marker_key, started_at, started_by FROM routine_marker_statuses`)).toEqual([
            { id: `${DAY}.dinner`, day: DAY, marker_key: 'dinner', started_at: '2026-03-09T18:00:00.000Z', started_by: DANA },
        ]);

        // No mutation for a run exists yet, so this is written as one would write it: the row, and the transaction's name.
        await local.writeTransaction(async (transaction) => {
            await transaction.execute(
                `INSERT INTO countdown_runs (id, family_member_id, day, routine_id, status, skipped_chore_ids, started_at, step_extension_secs, step_extension_count) VALUES (?, ?, ?, ?, 'running', ?, ?, 0, 0)`,
                [RUN, ELI, DAY, ROUTINE, JSON.stringify([LAUNDRY]), '2026-03-09T15:00:00.000Z']
            );
            await transaction.execute(`INSERT INTO local_transactions (id, mutation) VALUES (?, 'startCountdown')`, ['00000000-0000-4000-8000-0000000000aa']);
        });

        await until(async () => (await serverRows(`SELECT 1 FROM countdown_runs`)).length === 1, 'the run has reached the server');
        expect(await serverRows(`SELECT family_member_id, day, routine_id, status, skipped_chore_ids FROM countdown_runs`)).toEqual([
            { family_member_id: ELI, day: DAY, routine_id: ROUTINE, status: 'running', skipped_chore_ids: [LAUNDRY] },
        ]);
        // And comes back as the server holds it, the list as JSON text.
        await until(() => has(local, `SELECT 1 FROM countdown_runs WHERE skipped_chore_ids = ?`, [JSON.stringify([LAUNDRY])]), 'the device holds the run as the server sent it');
    });
});

describe('a task series', () => {
    it('reaches a kid whole, and what the kid hands in goes up, while a task of their own invention is refused', async () => {
        const n = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, '0')}`;
        const [SERIES, TASK, FIELD, UPDATE, ANSWER, FILE] = [n(130), n(131), n(150), n(160), n(180), n(170)];
        await sql.raw(`INSERT INTO task_series (id, name, family_member_id, chore_id, start_date, work_ahead_allowed) VALUES ('${SERIES}', 'Maths', '${ELI}', '${DISHES}', '${DAY}', true)`).execute(db);
        await sql.raw(`INSERT INTO tasks (id, task_series_id, title, sort_order, specific_time) VALUES ('${TASK}', '${SERIES}', 'Exercises', 0, '16:30')`).execute(db);
        await sql.raw(`INSERT INTO task_response_fields (id, task_id, type, label, required) VALUES ('${FIELD}', '${TASK}', 'rich_text', 'Your answers', true)`).execute(db);
        const kid = await device();
        await kid.manager.signIn({ familyMemberId: ELI });
        const local = await synced(kid.db());
        await until(() => has(local, `SELECT 1 FROM task_response_fields`), 'the device holds the series');

        expect(await local.getAll(`SELECT name, family_member_id, chore_id, start_date, work_ahead_allowed, pull_forward_count FROM task_series`)).toEqual([
            { name: 'Maths', family_member_id: ELI, chore_id: DISHES, start_date: DAY, work_ahead_allowed: 1, pull_forward_count: 0 },
        ]);
        expect(await local.getAll(`SELECT title, workflow_state, specific_time, is_day_break FROM tasks`)).toEqual([{ title: 'Exercises', workflow_state: 'not_started', specific_time: '16:30:00.000', is_day_break: 0 }]);
        expect(await local.getAll(`SELECT type, label, required FROM task_response_fields`)).toEqual([{ type: 'rich_text', label: 'Your answers', required: 1 }]);

        // No mutation for handing a task in exists yet, so this is written as one would write it.
        await local.writeTransaction(async (transaction) => {
            await transaction.execute(`UPDATE tasks SET workflow_state = 'needs_review', last_active_state = 'in_progress', updated_at = ? WHERE id = ?`, ['2026-03-09T16:40:00.000Z', TASK]);
            await transaction.execute(
                `INSERT INTO task_updates (id, task_id, actor_id, affected_person_id, from_state, to_state, note, is_draft, scheduled_for, created_at, updated_at) VALUES (?, ?, ?, ?, 'in_progress', 'needs_review', 'Done!', 0, ?, ?, ?)`,
                [UPDATE, TASK, ELI, ELI, DAY, '2026-03-09T16:40:00.000Z', '2026-03-09T16:40:00.000Z']
            );
            await transaction.execute(`INSERT INTO task_response_field_values (id, update_id, field_id, rich_text_content, created_at, updated_at) VALUES (?, ?, ?, '<p>1, 3, 5</p>', ?, ?)`, [ANSWER, UPDATE, FIELD, '2026-03-09T16:40:00.000Z', '2026-03-09T16:40:00.000Z']);
            await transaction.execute(
                `INSERT INTO task_update_attachments (id, update_id, name, type, url, size_bytes, waveform_peaks, created_at, updated_at) VALUES (?, ?, 'page.jpg', 'image/jpeg', 'updates/page.jpg', 90210, ?, ?, ?)`,
                [FILE, UPDATE, JSON.stringify([0.1, 0.9]), '2026-03-09T16:40:00.000Z', '2026-03-09T16:40:00.000Z']
            );
            await transaction.execute(`INSERT INTO local_transactions (id, mutation) VALUES (?, 'handInTask')`, [n(0xab)]);
        });

        await until(async () => (await serverRows(`SELECT 1 FROM task_update_attachments`)).length === 1, 'what was handed in has reached the server');
        expect(await serverRows(`SELECT workflow_state, last_active_state FROM tasks`)).toEqual([{ workflow_state: 'needs_review', last_active_state: 'in_progress' }]);
        expect(await serverRows(`SELECT task_id, actor_id, to_state, scheduled_for, is_draft FROM task_updates`)).toEqual([{ task_id: TASK, actor_id: ELI, to_state: 'needs_review', scheduled_for: DAY, is_draft: false }]);
        expect(await serverRows(`SELECT update_id, field_id, rich_text_content FROM task_response_field_values`)).toEqual([{ update_id: UPDATE, field_id: FIELD, rich_text_content: '<p>1, 3, 5</p>' }]);
        expect(await serverRows(`SELECT size_bytes, waveform_peaks FROM task_update_attachments`)).toEqual([{ size_bytes: 90210, waveform_peaks: [0.1, 0.9] }]);

        // A kid does not add a task to a series. The device takes it, the server refuses it, and it is gone again.
        await local.writeTransaction(async (transaction) => {
            await transaction.execute(`INSERT INTO tasks (id, task_series_id, title, sort_order) VALUES (?, ?, 'No homework', 1)`, [n(139), SERIES]);
            await transaction.execute(`INSERT INTO local_transactions (id, mutation) VALUES (?, 'addTask')`, [n(0xac)]);
        });
        await until(async () => (await serverRows(`SELECT 1 FROM write_refusals WHERE table_name = 'tasks' AND reason = 'not_allowed'`)).length === 1, 'the server has refused the task');
        await until(async () => !(await has(local, `SELECT 1 FROM tasks WHERE id = ?`, [n(139)])), 'the device has let the task go');
        expect(await serverRows(`SELECT count(*)::int AS tasks FROM tasks`)).toEqual([{ tasks: 1 }]);
    });
});

describe('money', () => {
    it('reaches a device to be read, takes a new name and a new default from its owner, and puts back a balance changed on the device', async () => {
        const n = (last: number) => `00000000-0000-4000-8000-${String(last).padStart(12, '0')}`;
        const [SAVINGS, SPENDING, ENTRY] = [n(200), n(201), n(210)];
        await sql.raw(`INSERT INTO allowance_envelopes (id, family_member_id, name) VALUES ('${SAVINGS}', '${ELI}', 'Savings'), ('${SPENDING}', '${ELI}', 'Spending')`).execute(db);
        await sql.raw(`INSERT INTO envelope_balances (envelope_id, currency, amount) VALUES ('${SAVINGS}', 'USD', 12.505)`).execute(db);
        await sql.raw(`INSERT INTO allowance_transactions (id, envelope_id, destination_envelope_id, transaction_type, amount, currency, description, created_by, created_at) VALUES ('${ENTRY}', '${SAVINGS}', '${SAVINGS}', 'deposit', 12.505, 'USD', 'Birthday', '${DANA}', '2026-03-09T09:00:00Z')`).execute(db);
        await sql.raw(`UPDATE family_members SET default_envelope_id = '${SAVINGS}' WHERE id = '${ELI}'`).execute(db);
        const kid = await device();
        await kid.manager.signIn({ familyMemberId: ELI });
        const local = await synced(kid.db());
        await until(() => has(local, `SELECT 1 FROM allowance_transactions`), 'the device holds the ledger');

        // A balance is known by its envelope and its currency, and an amount keeps its part of a cent.
        expect(await local.getAll(`SELECT id, envelope_id, currency, amount FROM envelope_balances`)).toEqual([{ id: `${SAVINGS}.USD`, envelope_id: SAVINGS, currency: 'USD', amount: 12.505 }]);
        expect(await local.getAll(`SELECT envelope_id, transaction_type, amount, created_by, created_at FROM allowance_transactions`)).toEqual([
            { envelope_id: SAVINGS, transaction_type: 'deposit', amount: 12.505, created_by: DANA, created_at: '2026-03-09T09:00:00.000Z' },
        ]);
        expect(await local.getAll(`SELECT default_envelope_id FROM family_members WHERE id = ?`, [ELI])).toEqual([{ default_envelope_id: SAVINGS }]);

        // What is the kid's to change goes up: what the other envelope is called, and that it is now the default.
        await local.writeTransaction(async (transaction) => {
            await transaction.execute(`UPDATE allowance_envelopes SET name = 'Bike' WHERE id = ?`, [SPENDING]);
            await transaction.execute(`UPDATE family_members SET default_envelope_id = ? WHERE id = ?`, [SPENDING, ELI]);
            await transaction.execute(`INSERT INTO local_transactions (id, mutation) VALUES (?, 'setDefaultEnvelope')`, [n(0xad)]);
        });
        await until(async () => (await serverRows(`SELECT 1 FROM family_members WHERE id = '${ELI}' AND default_envelope_id = '${SPENDING}'`)).length === 1, 'the new default has reached the server');
        expect(await serverRows(`SELECT name FROM allowance_envelopes WHERE id = '${SPENDING}'`)).toEqual([{ name: 'Bike' }]);

        // What is not: a kid who gives themselves a thousand dollars on their own device has it put back.
        await local.writeTransaction(async (transaction) => {
            await transaction.execute(`UPDATE envelope_balances SET amount = 1000 WHERE envelope_id = ?`, [SAVINGS]);
            await transaction.execute(`INSERT INTO local_transactions (id, mutation) VALUES (?, 'tamper')`, [n(0xae)]);
        });
        await until(async () => (await serverRows(`SELECT 1 FROM write_refusals WHERE table_name = 'envelope_balances'`)).length === 1, 'the server has refused the balance');
        await until(() => has(local, `SELECT 1 FROM envelope_balances WHERE amount = 12.505`), 'the device holds the real balance again');
        expect(await serverRows(`SELECT amount FROM envelope_balances`)).toEqual([{ amount: 12.505 }]);
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

describe('two uploads that reach the server at the same moment', () => {
    // The in-process Postgres the other tests use has one connection and cannot run two transactions at once.
    // This one can, so this is where a race for one row is run for real.
    it('for the same up-for-grabs chore: one holds it and the other is refused, every time', async () => {
        const eli = (await createSession(db, { type: 'kid', familyMemberId: ELI })).session;
        const fay = (await createSession(db, { type: 'kid', familyMemberId: FAY })).session;
        const claim = (who: string, round: number) => ({
            uploadId: `race-${round}-${who.slice(-4)}-0000000000`,
            dataGeneration: config.dataGeneration,
            mutation: 'completeChore',
            operations: [{ op: 'PUT' as const, table: 'chore_completions', id: `00000000-0000-4000-8000-0000000009${String(round).padStart(2, '0')}`, data: { chore_id: LAUNDRY, completed_by: who, date_due: `2026-04-${String(round + 1).padStart(2, '0')}`, completed_at: '2026-04-01T10:00:00.000Z', not_done: 0, allowance_awarded: 0 } }],
        });

        for (let round = 0; round < 20; round += 1) {
            const [first, second] = await Promise.all([applyUpload(db, eli, claim(ELI, round)), applyUpload(db, fay, claim(FAY, round))]);
            const outcomes = [first.outcome, second.outcome];
            expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
            expect(outcomes.find((outcome) => !outcome.ok)).toMatchObject({ ok: false, reason: 'already_claimed' });
        }
        // Twenty days, twenty completions: never two for one day, never none.
        expect(await serverRows(`SELECT count(*)::int AS n, count(DISTINCT date_due)::int AS days FROM chore_completions`)).toEqual([{ n: 20, days: 20 }]);
        expect(await serverRows(`SELECT count(*)::int AS n FROM write_refusals WHERE reason = 'already_claimed'`)).toEqual([{ n: 20 }]);
    });

    it('for the same transaction sent twice at once: it is applied once', async () => {
        const eli = (await createSession(db, { type: 'kid', familyMemberId: ELI })).session;
        const upload = {
            uploadId: 'race-same-transaction-0001',
            dataGeneration: config.dataGeneration,
            mutation: 'completeChore',
            operations: [{ op: 'PUT' as const, table: 'chore_completions', id: '00000000-0000-4000-8000-000000000950', data: { chore_id: DISHES, completed_by: ELI, date_due: '2026-05-01', completed_at: '2026-05-01T10:00:00.000Z', not_done: 0, allowance_awarded: 0 } }],
        };

        const results = await Promise.all([applyUpload(db, eli, upload), applyUpload(db, eli, upload), applyUpload(db, eli, upload)]);

        expect(results.map((result) => result.outcome)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
        expect(results.filter((result) => !result.replayed)).toHaveLength(1);
        expect(await serverRows(`SELECT count(*)::int AS n FROM chore_completions`)).toEqual([{ n: 1 }]);
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
