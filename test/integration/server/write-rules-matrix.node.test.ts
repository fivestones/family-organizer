import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { keyOf, POLICY, type DeviceOperation, type Principal } from '@family-organizer/data';
import { createSession, type Session } from '@/lib/server/sessions';
import { applyUpload } from '@/lib/server/upload';
import { DANA, DISHES, ELI, FAY, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// Who may write what, for every table a device may write at all, shown by sending the write and looking at the
// database afterwards. Each table has a cell for each kind of person and each kind of write: a parent, a kid whom
// the row belongs to, another kid, and the kid session a shared device rests on, which is nobody.
//
// This is the write rules of instant.perms.ts, carried over (docs/powersync-migration.md, Appendix B), with the
// few places that are deliberately different. A table that is not here cannot be written from a device, and the
// last test holds this file to that.

type Cell = 'ok' | 'not_allowed' | 'not_yours' | 'column_not_allowed' | 'already_claimed' | 'invalid' | 'conflict';
/** In order: a parent, the kid the row belongs to, another kid, the shared kid session. */
type Cells = readonly [Cell, Cell, Cell, Cell];

const PARENTS: Cells = ['ok', 'not_allowed', 'not_allowed', 'not_allowed'];
const ANYONE: Cells = ['ok', 'ok', 'ok', 'ok'];
const NOBODY: Cells = ['not_allowed', 'not_allowed', 'not_allowed', 'not_allowed'];
/** A parent for anyone, a kid for themselves. */
const OWN: Cells = ['ok', 'ok', 'not_yours', 'not_allowed'];

const PEOPLE: ReadonlyArray<[string, Principal]> = [
    ['a parent', { type: 'parent', familyMemberId: DANA }],
    ['the kid it belongs to', { type: 'kid', familyMemberId: ELI }],
    ['another kid', { type: 'kid', familyMemberId: FAY }],
    ['the shared kid session', { type: 'kid', familyMemberId: null }],
];

/** An id made from a table's own number and a row's, so no two rows anywhere share one. */
const u = (group: number, n = 0) => `00000000-0000-4000-8000-${String(group * 1000 + n).padStart(12, '0')}`;
/** The same ids, for SQL that makes many rows at once. */
const uSql = (group: number) => `('00000000-0000-4000-8000-' || lpad((${group * 1000} + n)::text, 12, '0'))::uuid`;
const DAY = '2026-03-09';
const NOON = '2026-03-09T12:00:00.000Z';
const FILE = { name: 'a.pdf', type: 'application/pdf' };

interface Spec {
    table: keyof typeof POLICY;
    /** Rows this table's rows point at, as SQL, made before anything else. */
    needs?: string;
    /** The n-th row, as a device would send it new. Rows 0 to 4 exist before the cases run; 10 to 13 are what the four people try to add. */
    row(n: number): { id: string; data: Record<string, unknown> };
    /** For a table no device may add to: the n-th row as SQL. */
    seed?(n: number): string;
    /** Sent in the same transaction as a new row, for a row that cannot stand alone. */
    alongside?(n: number): DeviceOperation[];
    /** The row the four people try to change, where it is not row 0. */
    target?: string;
    /** What the i-th person changes on it. Empty for a table whose rows are nothing but their key. */
    change?(i: number): Record<string, unknown>;
    insert: Cells;
    update: Cells;
    delete: Cells;
}

const many = (count: number, values: string) => `SELECT ${values} FROM generate_series(0, ${count}) AS n`;

const SPECS: Spec[] = [
    { table: 'settings', row: (n) => ({ id: `setting_${n}`, data: { value: '"on"' } }), change: (i) => ({ value: String(i) }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    { table: 'unit_definitions', row: (n) => ({ id: u(1, n), data: { code: `U${n}`, name: 'Unit', symbol: 'u', is_monetary: 0 } }), change: (i) => ({ name: `Unit ${i}` }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    // A kid changes how the app behaves for themselves, on their own row and no other.
    { table: 'family_members', row: (n) => ({ id: u(2, n), data: { name: `Member ${n}`, role: 'child', sort_order: 10 + n } }), target: ELI, change: (i) => ({ last_display_currency: `C${i}` }), insert: PARENTS, update: OWN, delete: PARENTS },
    { table: 'chores', row: (n) => ({ id: u(3, n), data: { title: `Chore ${n}`, start_date: '2026-03-01' } }), change: (i) => ({ title: `Renamed ${i}` }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    {
        table: 'chore_assignees',
        needs: `INSERT INTO chores (id, title, start_date) ${many(20, `${uSql(4)}, 'Chore', '2026-03-01'::date`)}`,
        row: (n) => ({ id: `${u(4, n)}.${ELI}`, data: { position: 0 } }),
        change: (i) => ({ position: i + 1 }),
        insert: PARENTS, update: PARENTS, delete: PARENTS,
    },
    {
        // A kid records their own work. A completion that stands is theirs, so another kid cannot change it.
        table: 'chore_completions',
        needs: `INSERT INTO chores (id, title, start_date) ${many(20, `${uSql(5)}, 'Chore', '2026-03-01'::date`)}`,
        row: (n) => ({ id: u(6, n), data: { chore_id: u(5, n), completed_by: ELI, date_due: DAY, completed_at: NOON, not_done: 0, allowance_awarded: 0 } }),
        change: (i) => ({ completed_at: `2026-03-09T1${i}:30:00.000Z` }),
        insert: OWN, update: OWN, delete: PARENTS,
    },
    { table: 'routines', row: (n) => ({ id: u(7, n), data: { name: `Routine ${n}`, sort_order: n } }), change: (i) => ({ name: `Renamed ${i}` }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    {
        table: 'routine_steps',
        needs: `INSERT INTO routines (id, name) VALUES ('${u(8)}', 'Evening'); INSERT INTO chores (id, title, start_date) ${many(20, `${uSql(9)}, 'Chore', '2026-03-01'::date`)}`,
        row: (n) => ({ id: `${u(8)}.${u(9, n)}`, data: { position: n } }),
        change: (i) => ({ position: 50 + i }),
        insert: PARENTS, update: PARENTS, delete: PARENTS,
    },
    { table: 'routine_marker_statuses', row: (n) => ({ id: `${DAY}.marker_${n}`, data: { started_at: NOON, started_by: DANA } }), change: (i) => ({ completed_at: `2026-03-09T1${i}:00:00.000Z` }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    {
        // A kid runs their own countdown and nobody else's.
        table: 'countdown_runs',
        row: (n) => ({ id: u(10, n), data: { family_member_id: ELI, day: `2026-04-${String(n + 1).padStart(2, '0')}`, status: 'running', skipped_chore_ids: '[]', started_at: NOON, step_extension_secs: 0, step_extension_count: 0 } }),
        change: (i) => ({ stopped_reason: `reason ${i}` }),
        insert: OWN, update: OWN, delete: PARENTS,
    },
    { table: 'grade_types', row: (n) => ({ id: u(11, n), data: { name: `Scale ${n}`, kind: 'number', low_value: 0, high_value: 10 } }), change: (i) => ({ name: `Renamed ${i}` }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    { table: 'task_series', row: (n) => ({ id: u(12, n), data: { name: `Series ${n}` } }), change: (i) => ({ pull_forward_count: i + 1 }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    {
        // Anyone works through a series' tasks. Only a parent says what is in it.
        table: 'tasks',
        needs: `INSERT INTO task_series (id, name) VALUES ('${u(13)}', 'Maths')`,
        row: (n) => ({ id: u(14, n), data: { task_series_id: u(13), title: `Task ${n}`, sort_order: n } }),
        change: (i) => ({ notes: `Seen by ${i}` }),
        insert: PARENTS, update: ANYONE, delete: ANYONE,
    },
    {
        table: 'task_attachments',
        needs: `INSERT INTO task_series (id, name) VALUES ('${u(15)}', 'Maths'); INSERT INTO tasks (id, task_series_id, title, sort_order) VALUES ('${u(16)}', '${u(15)}', 'Task', 0)`,
        row: (n) => ({ id: u(17, n), data: { task_id: u(16), ...FILE, url: `tasks/${n}.pdf` } }),
        change: (i) => ({ name: `renamed-${i}.pdf` }),
        insert: ANYONE, update: ANYONE, delete: ANYONE,
    },
    {
        table: 'task_response_fields',
        needs: `INSERT INTO task_series (id, name) VALUES ('${u(18)}', 'Maths'); INSERT INTO tasks (id, task_series_id, title, sort_order) VALUES ('${u(19)}', '${u(18)}', 'Task', 0)`,
        row: (n) => ({ id: u(20, n), data: { task_id: u(19), type: 'rich_text', label: `Field ${n}` } }),
        change: (i) => ({ label: `Renamed ${i}` }),
        insert: PARENTS, update: PARENTS, delete: PARENTS,
    },
    {
        table: 'task_updates',
        needs: `INSERT INTO task_series (id, name) VALUES ('${u(21)}', 'Maths'); INSERT INTO tasks (id, task_series_id, title, sort_order) VALUES ('${u(22)}', '${u(21)}', 'Task', 0)`,
        row: (n) => ({ id: u(23, n), data: { task_id: u(22), actor_id: ELI, from_state: 'not_started', to_state: 'in_progress', scheduled_for: DAY } }),
        change: (i) => ({ note: `Note ${i}` }),
        insert: ANYONE, update: ANYONE, delete: ANYONE,
    },
    {
        table: 'task_update_attachments',
        needs: `INSERT INTO task_series (id, name) VALUES ('${u(24)}', 'Maths'); INSERT INTO tasks (id, task_series_id, title, sort_order) VALUES ('${u(25)}', '${u(24)}', 'Task', 0);
                INSERT INTO task_updates (id, task_id, from_state, to_state, scheduled_for) VALUES ('${u(26)}', '${u(25)}', 'not_started', 'in_progress', '${DAY}')`,
        row: (n) => ({ id: u(27, n), data: { update_id: u(26), ...FILE, url: `updates/${n}.pdf` } }),
        change: (i) => ({ name: `renamed-${i}.pdf` }),
        insert: ANYONE, update: ANYONE, delete: ANYONE,
    },
    {
        table: 'task_response_field_values',
        needs: `INSERT INTO task_series (id, name) VALUES ('${u(28)}', 'Maths'); INSERT INTO tasks (id, task_series_id, title, sort_order) VALUES ('${u(29)}', '${u(28)}', 'Task', 0);
                INSERT INTO task_response_fields (id, task_id, type, label) VALUES ('${u(30)}', '${u(29)}', 'rich_text', 'Answer');
                INSERT INTO task_updates (id, task_id, from_state, to_state, scheduled_for) ${many(20, `${uSql(31)}, '${u(29)}'::uuid, 'not_started', 'in_progress', '${DAY}'::date`)}`,
        row: (n) => ({ id: u(32, n), data: { update_id: u(31, n), field_id: u(30), rich_text_content: '<p>42</p>' } }),
        change: (i) => ({ rich_text_content: `<p>${i}</p>` }),
        insert: ANYONE, update: ANYONE, delete: ANYONE,
    },
    {
        // Money is the server's. A device says what an envelope is called and saving for, and nothing more.
        table: 'allowance_envelopes',
        row: (n) => ({ id: u(33, n), data: { name: `Envelope ${n}` } }),
        seed: (n) => `INSERT INTO allowance_envelopes (id, family_member_id, name) VALUES ('${u(33, n)}', '${ELI}', 'Savings')`,
        change: (i) => ({ name: `Renamed ${i}` }),
        insert: NOBODY, update: OWN, delete: NOBODY,
    },
    { table: 'exchange_rates', row: (n) => ({ id: `USD.C${n}`, data: { rate: 1.5, fetched_at: NOON } }), change: (i) => ({ rate: 2 + i }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    { table: 'announcements', row: (n) => ({ id: u(34, n), data: { title: `News ${n}` } }), change: (i) => ({ title: `Renamed ${i}` }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    { table: 'content_categories', row: (n) => ({ id: u(35, n), data: { slug: `category-${n}`, name: 'Category', default_duration_ms: 1000 } }), change: (i) => ({ name: `Renamed ${i}` }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    {
        table: 'content_queue_items',
        needs: `INSERT INTO content_categories (id, slug, name, default_duration_ms) VALUES ('${u(36)}', 'verse', 'Verse', 1000)`,
        row: (n) => ({ id: u(37, n), data: { category_id: u(36), title: `Item ${n}`, status: 'queued' } }),
        change: (i) => ({ title: `Renamed ${i}` }),
        insert: PARENTS, update: PARENTS, delete: PARENTS,
    },
    {
        // A rule and its first version each name the other, so they are sent together.
        table: 'family_rules',
        row: (n) => ({ id: u(38, n), data: { title: `Rule ${n}`, active_version_id: u(39, n) } }),
        alongside: (n) => [{ op: 'PUT', table: 'family_rule_versions', id: u(39, n), data: { rule_id: u(38, n), version_number: 1, rich_text_content: '<p>Shoes come off at the door.</p>' } }],
        change: (i) => ({ title: `Renamed ${i}` }),
        insert: PARENTS, update: PARENTS, delete: PARENTS,
    },
    {
        // A rule's words are kept as written: a parent adds a version, and nobody changes or removes one.
        table: 'family_rule_versions',
        needs: `BEGIN; INSERT INTO family_rules (id, title, active_version_id) VALUES ('${u(40)}', 'Screens', '${u(41, 99)}');
                INSERT INTO family_rule_versions (id, rule_id, version_number, rich_text_content) VALUES ('${u(41, 99)}', '${u(40)}', 1, '<p>One hour.</p>'); COMMIT`,
        row: (n) => ({ id: u(41, n), data: { rule_id: u(40), version_number: n + 2, rich_text_content: '<p>One hour, after chores.</p>' } }),
        change: (i) => ({ rich_text_content: `<p>${i} hours.</p>` }),
        insert: PARENTS, update: NOBODY, delete: NOBODY,
    },
    {
        table: 'content_attachments',
        needs: `INSERT INTO announcements (id, title) VALUES ('${u(42)}', 'News')`,
        row: (n) => ({ id: u(43, n), data: { announcement_id: u(42), ...FILE, url: `content/${n}.pdf` } }),
        change: (i) => ({ name: `renamed-${i}.pdf` }),
        insert: PARENTS, update: PARENTS, delete: PARENTS,
    },
    { table: 'family_dashboard_layouts', row: (n) => ({ id: u(44, n), data: { breakpoint_key: `width-${n}`, label: 'Width', min_width: 0, max_width: 100 } }), change: (i) => ({ label: `Renamed ${i}` }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    {
        table: 'family_dashboard_widgets',
        needs: `INSERT INTO family_dashboard_layouts (id, breakpoint_key, label, min_width, max_width) VALUES ('${u(45)}', 'phone', 'Phone', 0, 480)`,
        row: (n) => ({ id: u(46, n), data: { layout_id: u(45), widget_type: 'clock', x: 0, y: n, w: 1, h: 1 } }),
        change: (i) => ({ x: i + 0.5 }),
        insert: PARENTS, update: PARENTS, delete: PARENTS,
    },
    {
        // Anyone signed in arranges a personal dashboard, as today. It is known by whose it is.
        table: 'dashboard_configs',
        needs: `INSERT INTO family_members (id, name, role, sort_order) ${many(20, `${uSql(47)}, 'Member', 'child', 100 + n`)}`,
        row: (n) => ({ id: u(47, n), data: { widget_order: '["chores"]' } }),
        change: (i) => ({ widget_order: JSON.stringify([`widget-${i}`]) }),
        insert: ANYONE, update: ANYONE, delete: ANYONE,
    },
    {
        // Like the entry it is on: added by anyone signed in, and never changed or removed.
        table: 'history_event_attachments',
        needs: `INSERT INTO history_events (id, occurred_at, domain, action_type, summary) VALUES ('${u(48)}', '${NOON}', 'chores', 'chore_marked_done', 'Done')`,
        row: (n) => ({ id: u(49, n), data: { history_event_id: u(48), ...FILE, url: `history/${n}.pdf` } }),
        change: (i) => ({ name: `renamed-${i}.pdf` }),
        insert: ANYONE, update: NOBODY, delete: NOBODY,
    },
    { table: 'calendar_tags', row: (n) => ({ id: u(50, n), data: { name: `Tag ${n}` } }), change: (i) => ({ name: `Renamed ${i}` }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    { table: 'calendar_items', row: (n) => ({ id: u(51, n), data: { title: `Event ${n}`, start_date: DAY, end_date: '2026-03-10', rdates: '[]', exdates: '[]' } }), change: (i) => ({ title: `Renamed ${i}` }), insert: PARENTS, update: PARENTS, delete: PARENTS },
    {
        table: 'calendar_item_members',
        needs: `INSERT INTO calendar_items (id, title, start_date, end_date) ${many(20, `${uSql(52)}, 'Event', '${DAY}'::date, '2026-03-10'::date`)}`,
        row: (n) => ({ id: `${u(52, n)}.${ELI}`, data: {} }),
        insert: PARENTS, update: PARENTS, delete: PARENTS,
    },
    {
        table: 'calendar_item_tags',
        needs: `INSERT INTO calendar_tags (id, name) VALUES ('${u(53)}', 'School'); INSERT INTO calendar_items (id, title, start_date, end_date) ${many(20, `${uSql(54)}, 'Event', '${DAY}'::date, '2026-03-10'::date`)}`,
        row: (n) => ({ id: `${u(54, n)}.${u(53)}`, data: {} }),
        insert: PARENTS, update: PARENTS, delete: PARENTS,
    },
    {
        // History is written in one's own name, and never changed or removed, by anyone.
        table: 'history_events',
        row: (n) => ({ id: u(55, n), data: { occurred_at: NOON, domain: 'chores', action_type: 'chore_marked_done', summary: 'Done', actor_id: ELI, metadata: '{}' } }),
        change: (i) => ({ summary: `Rewritten ${i}` }),
        insert: OWN, update: NOBODY, delete: NOBODY,
    },
    {
        table: 'history_event_members',
        needs: `INSERT INTO history_events (id, occurred_at, domain, action_type, summary) ${many(20, `${uSql(56)}, '${NOON}'::timestamptz, 'chores', 'chore_marked_done', 'Done'`)}`,
        row: (n) => ({ id: `${u(56, n)}.${ELI}`, data: {} }),
        insert: ['ok', 'ok', 'ok', 'not_allowed'], update: NOBODY, delete: NOBODY,
    },
    {
        // A refusal is only ever dismissed, by the person it was for or by a parent.
        table: 'write_refusals',
        row: (n) => ({ id: u(57, n), data: {} }),
        seed: (n) => `INSERT INTO write_refusals (id, family_member_id, principal_type, reason) VALUES ('${u(57, n)}', '${ELI}', 'kid', 'not_allowed')`,
        change: (i) => ({ dismissed_at: `2026-03-09T1${i}:00:00.000Z` }),
        insert: NOBODY, update: OWN, delete: NOBODY,
    },
];

describe.each(SPECS)('who may write $table', (spec) => {
    let database: TestDatabase;
    const sessions: Session[] = [];
    let upload = 0;

    const send = (session: Session, operations: DeviceOperation[]) => applyUpload(database.db, session, { uploadId: `${spec.table}-${(upload += 1)}`, dataGeneration: 1, mutation: 'matrix', operations });
    const where = (rowId: string) => {
        const key = keyOf(spec.table, rowId)!;
        const columns = Object.keys(key);
        return { text: columns.map((column, index) => `${column}::text = $${index + 1}`).join(' AND '), values: columns.map((column) => key[column]) };
    };
    /** The row as the database holds it, whole, or nothing. */
    const held = async (rowId: string) => {
        const { text, values } = where(rowId);
        return (await database.sql.query<{ row: unknown }>(`SELECT to_jsonb(t.*) AS row FROM ${spec.table} AS t WHERE ${text}`, values)).rows[0]?.row ?? null;
    };
    const put = (n: number): DeviceOperation[] => [{ op: 'PUT', table: spec.table, id: spec.row(n).id, data: spec.row(n).data }, ...(spec.alongside?.(n) ?? [])];

    beforeAll(async () => {
        database = await createTestDatabase();
        await seedFamily(database);
        if (spec.needs) await database.sql.exec(spec.needs);
        for (const [, principal] of PEOPLE) sessions.push((await createSession(database.db, principal)).session);
        // The rows that are there before anyone tries anything: one to change, and one for each person to try to remove.
        for (let n = 0; n <= 4; n += 1) {
            if (n === 0 && spec.target) continue;
            if (spec.seed) await database.sql.exec(spec.seed(n));
            else expect((await send(sessions[0], put(n))).outcome).toEqual({ ok: true });
        }
    });
    afterAll(() => database.close());

    it.each(PEOPLE.map(([who], index) => [who, index] as const))('adding a row, by %s', async (_who, index) => {
        const { id: rowId } = spec.row(10 + index);
        const result = await send(sessions[index], put(10 + index));

        expect(result.outcome.ok ? 'ok' : result.outcome.reason).toBe(spec.insert[index]);
        expect((await held(rowId)) !== null).toBe(spec.insert[index] === 'ok');
    });

    // A row that is nothing but its key has nothing to change.
    (spec.change ? it : it.skip).each(PEOPLE.map(([who], index) => [who, index] as const))('changing a row, by %s', async (_who, index) => {
        const rowId = spec.target ?? spec.row(0).id;
        const before = await held(rowId);
        const result = await send(sessions[index], [{ op: 'PATCH', table: spec.table, id: rowId, data: spec.change!(index) }]);

        expect(result.outcome.ok ? 'ok' : result.outcome.reason).toBe(spec.update[index]);
        expect(JSON.stringify(await held(rowId)) !== JSON.stringify(before)).toBe(spec.update[index] === 'ok');
    });

    it.each(PEOPLE.map(([who], index) => [who, index] as const))('removing a row, by %s', async (_who, index) => {
        const { id: rowId } = spec.row(1 + index);
        const result = await send(sessions[index], [{ op: 'DELETE', table: spec.table, id: rowId }]);

        expect(result.outcome.ok ? 'ok' : result.outcome.reason).toBe(spec.delete[index]);
        expect((await held(rowId)) === null).toBe(spec.delete[index] === 'ok');
    });
});

// The cells above ask who may write a row at all. These ask which part of it: a person who may change a row may
// not always change every column of it. Each is a refusal the live Instant rules make today, sent here for real.
describe('a row someone may change, but not every part of it', () => {
    let database: TestDatabase;
    let parent: Session;
    let eli: Session;
    let upload = 0;
    const send = (session: Session, operation: DeviceOperation) => applyUpload(database.db, session, { uploadId: `part-${(upload += 1)}`, dataGeneration: 1, mutation: 'matrix', operations: [operation] });
    const reason = async (session: Session, operation: DeviceOperation) => {
        const result = await send(session, operation);
        return result.outcome.ok ? 'ok' : result.outcome.reason;
    };
    const [COMPLETION, RUN, SERIES, OTHER_SERIES, TASK] = [u(60), u(61), u(62), u(63), u(64)];

    beforeAll(async () => {
        database = await createTestDatabase();
        await seedFamily(database);
        parent = (await createSession(database.db, { type: 'parent', familyMemberId: DANA })).session;
        eli = (await createSession(database.db, { type: 'kid', familyMemberId: ELI })).session;
        await database.sql.exec(`
            INSERT INTO chore_completions (id, chore_id, completed_by, date_due, completed_at) VALUES ('${COMPLETION}', '${DISHES}', '${ELI}', '${DAY}', '${NOON}');
            INSERT INTO countdown_runs (id, family_member_id, day, status, started_at) VALUES ('${RUN}', '${ELI}', '${DAY}', 'running', '${NOON}');
            INSERT INTO task_series (id, name) VALUES ('${SERIES}', 'Maths'), ('${OTHER_SERIES}', 'Reading');
            INSERT INTO tasks (id, task_series_id, title, sort_order) VALUES ('${TASK}', '${SERIES}', 'Exercises', 0);
        `);
    });
    afterAll(() => database.close());

    it.each([
        ['their own role in the family', { op: 'PATCH', table: 'family_members', id: ELI, data: { role: 'parent' } }, 'column_not_allowed'],
        ['their own allowance', { op: 'PATCH', table: 'family_members', id: ELI, data: { allowance_amount: 100 } }, 'column_not_allowed'],
        ['that their own completion has been paid for', { op: 'PATCH', table: 'chore_completions', id: COMPLETION, data: { allowance_awarded: 1 } }, 'column_not_allowed'],
        ['which day their own completion was for', { op: 'PATCH', table: 'chore_completions', id: COMPLETION, data: { date_due: '2026-03-10' } }, 'column_not_allowed'],
        ['whose their own countdown run is', { op: 'PATCH', table: 'countdown_runs', id: RUN, data: { family_member_id: FAY } }, 'column_not_allowed'],
        ['which day their own countdown run is for', { op: 'PATCH', table: 'countdown_runs', id: RUN, data: { day: '2026-03-10' } }, 'column_not_allowed'],
        ['which series a task is in', { op: 'PATCH', table: 'tasks', id: TASK, data: { task_series_id: OTHER_SERIES } }, 'column_not_allowed'],
    ] as Array<[string, DeviceOperation, string]>)('a kid does not change %s', async (_what, operation, expected) => {
        expect(await reason(eli, operation)).toBe(expected);
    });

    it.each([
        ['whose a countdown run is', { op: 'PATCH', table: 'countdown_runs', id: RUN, data: { family_member_id: FAY } }, 'column_not_allowed'],
        ['which day a completion was for', { op: 'PATCH', table: 'chore_completions', id: COMPLETION, data: { date_due: '2026-03-10' } }, 'column_not_allowed'],
        // The one rule that is stricter than today for a parent, on purpose: it is what makes the first claim win.
        ['who did a chore, while the completion stands', { op: 'PATCH', table: 'chore_completions', id: COMPLETION, data: { completed_by: FAY } }, 'already_claimed'],
    ] as Array<[string, DeviceOperation, string]>)('nor does a parent change %s', async (_what, operation, expected) => {
        expect(await reason(parent, operation)).toBe(expected);
    });

    it('and none of it happened', async () => {
        expect((await database.sql.query(`SELECT role, allowance_amount FROM family_members WHERE id = $1`, [ELI])).rows).toEqual([{ role: 'child', allowance_amount: null }]);
        expect((await database.sql.query(`SELECT completed_by, date_due::text AS day, allowance_awarded FROM chore_completions WHERE id = $1`, [COMPLETION])).rows).toEqual([{ completed_by: ELI, day: DAY, allowance_awarded: false }]);
        expect((await database.sql.query(`SELECT family_member_id, day::text AS day FROM countdown_runs WHERE id = $1`, [RUN])).rows).toEqual([{ family_member_id: ELI, day: DAY }]);
        expect((await database.sql.query(`SELECT task_series_id FROM tasks WHERE id = $1`, [TASK])).rows).toEqual([{ task_series_id: SERIES }]);
        // Each refusal was recorded for the person who was refused.
        expect((await database.sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM write_refusals`)).rows[0].n).toBe(10);
    });
});

describe('the tables a device may write', () => {
    it('are exactly the ones this file has a row of cells for', () => {
        expect(SPECS.map((spec) => spec.table).sort()).toEqual(Object.keys(POLICY).sort());
    });

    it('do not include money, messages, or anything the server keeps for itself', () => {
        const never = ['envelope_balances', 'allowance_transactions', 'messages', 'message_threads', 'message_thread_members', 'message_attachments', 'message_reactions', 'message_acknowledgements', 'auth_sessions', 'sync_uploads', 'installation', 'calendar_sync_accounts', 'calendar_sync_calendars', 'calendar_item_sync_state', 'calendar_sync_runs', 'shortcut_tokens', 'push_devices', 'maintenance_runs', 'schema_migrations'];
        expect(Object.keys(POLICY).filter((table) => never.includes(table))).toEqual([]);
    });
});
