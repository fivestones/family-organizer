import { describe, expect, it } from 'vitest';
import { checkOperation, judge, keyOf, POLICY, readValue, type CheckedOperation, type DeviceOperation, type Judged, type Principal, type Row } from '@family-organizer/data';

// The write rules, as pure functions: who may insert, change and delete what. The server applies them with
// authority in the upload route, and its tests show them holding against a real database; these show the rules
// themselves, case by case, for every kind of person.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DANA = id(1);
const ELI = id(2);
const FAY = id(3);
const parent: Principal = { type: 'parent', familyMemberId: DANA };
const eli: Principal = { type: 'kid', familyMemberId: ELI };
const fay: Principal = { type: 'kid', familyMemberId: FAY };
const sharedKid: Principal = { type: 'kid', familyMemberId: null };
const everyone = { parent, eli, fay, sharedKid };

function checked(operation: DeviceOperation): CheckedOperation {
    const result = checkOperation(operation);
    if (!result.valid) throw new Error(`The test's own operation is not valid: ${JSON.stringify(operation)}`);
    return result.operation;
}
const verdict = (judged: Judged) => (judged.action === 'refuse' ? judged.reason : judged.action);
const decide = (principal: Principal, operation: DeviceOperation, current: Row | null = null) => verdict(judge(principal, checked(operation), current));
const forEveryone = (operation: DeviceOperation, current: Row | null = null) =>
    Object.fromEntries(Object.entries(everyone).map(([name, principal]) => [name, decide(principal, operation, current)]));

describe('reading what a device sends', () => {
    it('takes a boolean as SQLite holds it', () => {
        expect(readValue({ kind: 'boolean' }, 1)).toEqual({ valid: true, value: true });
        expect(readValue({ kind: 'boolean' }, 0)).toEqual({ valid: true, value: false });
        expect(readValue({ kind: 'boolean' }, 'yes')).toEqual({ valid: false });
    });

    it('takes a JSON document only as text, even one that is itself a string', () => {
        expect(readValue({ kind: 'json' }, '"dark"')).toEqual({ valid: true, value: 'dark' });
        expect(readValue({ kind: 'json' }, '{"a":[1,2]}')).toEqual({ valid: true, value: { a: [1, 2] } });
        expect(readValue({ kind: 'json' }, 'dark')).toEqual({ valid: false });
        expect(readValue({ kind: 'json' }, { a: 1 })).toEqual({ valid: false });
    });

    it('brings an instant and a time to the form Postgres reads them back in', () => {
        expect(readValue({ kind: 'instant' }, '2026-03-09T10:51:07+05:45')).toEqual({ valid: true, value: '2026-03-09T05:06:07.000Z' });
        expect(readValue({ kind: 'time' }, '07:30')).toEqual({ valid: true, value: '07:30:00' });
        expect(readValue({ kind: 'time' }, '07:30:15.000')).toEqual({ valid: true, value: '07:30:15' });
        expect(readValue({ kind: 'time' }, '25:00')).toEqual({ valid: false });
    });

    it('refuses a day that does not exist, and a list of days with one in it', () => {
        expect(readValue({ kind: 'day' }, '2026-02-28')).toEqual({ valid: true, value: '2026-02-28' });
        expect(readValue({ kind: 'day' }, '2026-02-30')).toEqual({ valid: false });
        expect(readValue({ kind: 'days' }, '["2026-02-28","2026-03-01"]')).toEqual({ valid: true, value: ['2026-02-28', '2026-03-01'] });
        expect(readValue({ kind: 'days' }, '["2026-02-30"]')).toEqual({ valid: false });
    });

    it('holds a word to its list, and lets anything be empty', () => {
        expect(readValue({ kind: 'text', oneOf: ['parent', 'child'] }, 'admin')).toEqual({ valid: false });
        expect(readValue({ kind: 'uuid' }, null)).toEqual({ valid: true, value: null });
    });
});

describe('the shape of a write', () => {
    const invalid = { valid: false, reason: 'invalid' };

    it('knows a row by the key its table has', () => {
        expect(keyOf('settings', 'dashboardTheme')).toEqual({ name: 'dashboardTheme' });
        expect(keyOf('chore_assignees', `${id(10)}.${ELI}`)).toEqual({ chore_id: id(10), family_member_id: ELI });
        expect(keyOf('chore_assignees', id(10))).toBeNull();
        expect(keyOf('chores', 'not-an-id')).toBeNull();
    });

    it('refuses a table no device may write, by any name', () => {
        for (const table of ['allowance_transactions', 'auth_sessions', 'sync_uploads', 'installation', 'pg_catalog.pg_class', 'chores; DROP TABLE chores', '__proto__', 'constructor']) {
            expect(checkOperation({ op: 'PUT', table, id: id(1), data: {} })).toEqual(invalid);
        }
    });

    it('refuses a column no device may send, on a table it may write', () => {
        expect(checkOperation({ op: 'PATCH', table: 'family_members', id: ELI, data: { pin_hash: 'x' } })).toEqual(invalid);
        expect(checkOperation({ op: 'PATCH', table: 'family_members', id: ELI, data: { has_pin: 1 } })).toEqual(invalid);
        expect(checkOperation({ op: 'PATCH', table: 'chores', id: id(10), data: { 'title = title; --': 'x' } })).toEqual(invalid);
        expect(checkOperation({ op: 'PATCH', table: 'write_refusals', id: id(9), data: { reason: 'x' } })).toEqual(invalid);
    });

    it('refuses a value of the wrong kind, an operation it has never heard of, and an id that is not one', () => {
        expect(checkOperation({ op: 'PATCH', table: 'chores', id: id(10), data: { sort_order: 'first' } })).toEqual(invalid);
        expect(checkOperation({ op: 'UPSERT' as 'PUT', table: 'chores', id: id(10), data: {} })).toEqual(invalid);
        expect(checkOperation({ op: 'PUT', table: 'chores', id: "x' OR '1'='1", data: {} })).toEqual(invalid);
    });

    it('refuses a key column that disagrees with the id it came with', () => {
        expect(checkOperation({ op: 'PUT', table: 'chore_assignees', id: `${id(10)}.${ELI}`, data: { chore_id: id(10), family_member_id: FAY, position: 0 } })).toEqual(invalid);
        const good = checkOperation({ op: 'PUT', table: 'chore_assignees', id: `${id(10)}.${ELI}`, data: { chore_id: id(10), family_member_id: ELI, position: 0 } });
        expect(good).toMatchObject({ valid: true, operation: { key: { chore_id: id(10), family_member_id: ELI }, values: { position: 0 } } });
    });

    it('lists pin_hash nowhere', () => {
        for (const policy of Object.values(POLICY)) expect(Object.keys(policy.columns)).not.toContain('pin_hash');
    });
});

describe('what a write really is', () => {
    const chore = { id: id(10), title: 'Dishes', sort_order: 1 };

    it('is an update when the row exists, whatever the device called it', () => {
        expect(judge(parent, checked({ op: 'PUT', table: 'chores', id: id(10), data: { title: 'Dishes', sort_order: 2 } }), chore)).toEqual({
            action: 'update', changed: ['sort_order'], row: { ...chore, sort_order: 2 },
        });
    });

    it('is nothing when it changes nothing, or the row has gone', () => {
        expect(decide(parent, { op: 'PATCH', table: 'chores', id: id(10), data: { title: 'Dishes' } }, chore)).toBe('skip');
        expect(decide(parent, { op: 'PATCH', table: 'chores', id: id(10), data: { title: 'New' } }, null)).toBe('skip');
        expect(decide(parent, { op: 'DELETE', table: 'chores', id: id(10) }, null)).toBe('skip');
        // Even from someone who could not have made the change: there is nothing to refuse.
        expect(decide(eli, { op: 'DELETE', table: 'chores', id: id(10) }, null)).toBe('skip');
    });

    it('is an insert only when the device said it was creating a row and none is there', () => {
        expect(decide(parent, { op: 'PUT', table: 'chores', id: id(10), data: { title: 'Dishes' } }, null)).toBe('insert');
    });
});

describe('what parents write and everyone reads', () => {
    it.each([
        ['settings', 'dashboardTheme', { value: '"dark"' }],
        ['unit_definitions', id(20), { code: 'STARS' }],
        ['chores', id(10), { title: 'Dishes' }],
        ['chore_assignees', `${id(10)}.${ELI}`, { position: 0 }],
        ['routines', id(80), { name: 'Evening' }],
        ['routine_steps', `${id(80)}.${id(10)}`, { position: 0 }],
        ['routine_marker_statuses', '2026-03-09.dinner', { started_at: '2026-03-09T18:00:00.000Z' }],
    ])('%s: a parent may insert, change and delete; nobody else may do any of it', (table, rowId, data) => {
        const current = { name: 'dashboardTheme', id: rowId };
        expect(forEveryone({ op: 'PUT', table, id: rowId, data })).toEqual({ parent: 'insert', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
        expect(forEveryone({ op: 'PATCH', table, id: rowId, data }, current)).toEqual({ parent: 'update', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
        expect(forEveryone({ op: 'DELETE', table, id: rowId }, current)).toEqual({ parent: 'delete', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
    });
});

describe('family members', () => {
    const eliRow = { id: ELI, name: 'Eli', role: 'child' };

    it('are added and removed by parents only', () => {
        expect(forEveryone({ op: 'PUT', table: 'family_members', id: id(4), data: { name: 'Gus', role: 'child', sort_order: 3 } })).toEqual({ parent: 'insert', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
        expect(forEveryone({ op: 'DELETE', table: 'family_members', id: ELI }, eliRow)).toEqual({ parent: 'delete', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
    });

    it('may change how the app behaves for themselves, and nothing else about themselves', () => {
        const preference: DeviceOperation = { op: 'PATCH', table: 'family_members', id: ELI, data: { view_show_task_details: 1, message_quiet_hours_start: '21:00' } };
        expect(forEveryone(preference, eliRow)).toEqual({ parent: 'update', eli: 'update', fay: 'not_yours', sharedKid: 'not_allowed' });
        for (const data of [{ role: 'parent' }, { name: 'Boss' }, { allowance_amount: 1000 }, { sort_order: 0 }, { view_show_task_details: 1, role: 'parent' }]) {
            expect(decide(eli, { op: 'PATCH', table: 'family_members', id: ELI, data }, eliRow)).toBe('column_not_allowed');
        }
    });
});

describe('chore completions', () => {
    const DISHES = id(10);
    const completion = (by: string, overrides: Record<string, unknown> = {}) => ({ id: id(40), chore_id: DISHES, completed_by: by, marked_by: null, date_due: '2026-03-09', completed_at: '2026-03-09T18:00:00.000Z', not_done: false, allowance_awarded: false, ...overrides });
    const put = (by: string, overrides: Record<string, unknown> = {}): DeviceOperation => ({ op: 'PUT', table: 'chore_completions', id: id(40), data: { chore_id: DISHES, completed_by: by, date_due: '2026-03-09', completed_at: '2026-03-09T18:00:00.000Z', not_done: 0, allowance_awarded: 0, ...overrides } });

    it('are recorded by a kid for themselves only, as themselves, and unpaid', () => {
        expect(forEveryone(put(ELI))).toEqual({ parent: 'insert', eli: 'insert', fay: 'not_yours', sharedKid: 'not_allowed' });
        expect(decide(eli, put(ELI, { marked_by: ELI }))).toBe('insert');
        expect(decide(eli, put(ELI, { marked_by: DANA }))).toBe('not_yours');
        expect(decide(eli, put(ELI, { allowance_awarded: 1 }))).toBe('column_not_allowed');
        // A parent may record one for anyone, and mark it paid.
        expect(decide(parent, put(ELI, { marked_by: DANA, allowance_awarded: 1 }))).toBe('insert');
    });

    it('are un-ticked and re-ticked by the kid who made them, and nothing more', () => {
        const untick: DeviceOperation = { op: 'PATCH', table: 'chore_completions', id: id(40), data: { completed_at: null } };
        expect(forEveryone(untick, completion(ELI))).toEqual({ parent: 'update', eli: 'update', fay: 'not_yours', sharedKid: 'not_allowed' });
        expect(decide(eli, { op: 'PATCH', table: 'chore_completions', id: id(40), data: { allowance_awarded: 1 } }, completion(ELI))).toBe('column_not_allowed');
        expect(decide(eli, { op: 'PATCH', table: 'chore_completions', id: id(40), data: { marked_by: FAY } }, completion(ELI))).toBe('column_not_allowed');
    });

    it('are deleted by parents only', () => {
        expect(forEveryone({ op: 'DELETE', table: 'chore_completions', id: id(40) }, completion(ELI))).toEqual({ parent: 'delete', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
    });

    it('cannot be overwritten by sending their id again as though it were new', () => {
        // Fay sends Eli's completion as her own. It is judged against the row that is there.
        expect(decide(fay, put(FAY), completion(ELI))).toBe('already_claimed');
        // Eli sends his own again with it marked as paid.
        expect(decide(eli, put(ELI, { allowance_awarded: 1 }), completion(ELI))).toBe('column_not_allowed');
    });

    it('belong to whoever completed them while they stand: not even a parent hands one to someone else', () => {
        expect(decide(parent, { op: 'PATCH', table: 'chore_completions', id: id(40), data: { completed_by: FAY } }, completion(ELI))).toBe('already_claimed');
        expect(decide(parent, put(FAY), completion(ELI))).toBe('already_claimed');
    });

    it('can be taken once cleared, by a kid for themselves and by a parent for anyone', () => {
        const cleared = completion(ELI, { completed_at: null });
        expect(decide(fay, put(FAY, { marked_by: FAY }), cleared)).toBe('update');
        expect(decide(parent, put(FAY), cleared)).toBe('update');
        // But not for someone else, not with it marked paid, and not one a parent has marked as not done.
        expect(decide(fay, put(ELI, { completed_at: '2026-03-09T19:00:00.000Z' }), completion(DANA, { completed_at: null }))).toBe('not_yours');
        expect(decide(fay, put(FAY, { allowance_awarded: 1 }), cleared)).toBe('column_not_allowed');
        expect(decide(fay, put(FAY), completion(ELI, { completed_at: null, not_done: true }))).toBe('not_yours');
    });

    it('never move to another chore or another day', () => {
        expect(decide(parent, { op: 'PATCH', table: 'chore_completions', id: id(40), data: { date_due: '2026-03-10' } }, completion(ELI))).toBe('column_not_allowed');
        expect(decide(parent, { op: 'PATCH', table: 'chore_completions', id: id(40), data: { chore_id: id(11) } }, completion(ELI))).toBe('column_not_allowed');
    });
});

describe('countdown runs', () => {
    const run = (member: string) => ({ id: id(90), family_member_id: member, day: '2026-03-09', status: 'running', started_at: '2026-03-09T15:00:00.000Z' });
    const start = (member: string): DeviceOperation => ({ op: 'PUT', table: 'countdown_runs', id: id(90), data: { family_member_id: member, day: '2026-03-09', status: 'running', started_at: '2026-03-09T15:00:00.000Z', skipped_chore_ids: '[]' } });

    it('are started by a kid for themselves only', () => {
        expect(forEveryone(start(ELI))).toEqual({ parent: 'insert', eli: 'insert', fay: 'not_yours', sharedKid: 'not_allowed' });
    });

    it('are driven by the kid whose run it is, in every part but whose it is and which day', () => {
        const step: DeviceOperation = { op: 'PATCH', table: 'countdown_runs', id: id(90), data: { status: 'stopped', stopped_reason: 'finished', skipped_chore_ids: JSON.stringify([id(10)]), step_extension_secs: 30 } };
        expect(forEveryone(step, run(ELI))).toEqual({ parent: 'update', eli: 'update', fay: 'not_yours', sharedKid: 'not_allowed' });
        expect(decide(eli, { op: 'PATCH', table: 'countdown_runs', id: id(90), data: { family_member_id: FAY } }, run(ELI))).toBe('column_not_allowed');
        expect(decide(parent, { op: 'PATCH', table: 'countdown_runs', id: id(90), data: { day: '2026-03-10' } }, run(ELI))).toBe('column_not_allowed');
    });

    it('are removed by parents only', () => {
        expect(forEveryone({ op: 'DELETE', table: 'countdown_runs', id: id(90) }, run(ELI))).toEqual({ parent: 'delete', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
    });
});

describe('a key made of more than an id', () => {
    it('is read part by part, each as its column\'s kind', () => {
        expect(keyOf('routine_marker_statuses', '2026-03-09.dinner')).toEqual({ day: '2026-03-09', marker_key: 'dinner' });
        expect(keyOf('routine_marker_statuses', '2026-02-30.dinner')).toBeNull();
        expect(keyOf('routine_marker_statuses', 'dinner')).toBeNull();
        expect(keyOf('routine_steps', `${id(80)}.not-an-id`)).toBeNull();
    });
});

describe('task series', () => {
    const allow = (action: string) => ({ parent: action, eli: action, fay: action, sharedKid: action });
    const parentsOnly = (action: string) => ({ parent: action, eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
    const task = { id: id(131), task_series_id: id(130), title: 'Read chapter 1', workflow_state: 'not_started', sort_order: 0 };

    it('are made, changed and removed by parents, with their grade scales and what each task asks for', () => {
        expect(forEveryone({ op: 'PUT', table: 'task_series', id: id(130), data: { name: 'Maths', family_member_id: ELI } })).toEqual(parentsOnly('insert'));
        expect(forEveryone({ op: 'PATCH', table: 'task_series', id: id(130), data: { pull_forward_count: 1 } }, { id: id(130), pull_forward_count: 0 })).toEqual(parentsOnly('update'));
        expect(forEveryone({ op: 'DELETE', table: 'task_series', id: id(130) }, { id: id(130) })).toEqual(parentsOnly('delete'));
        expect(forEveryone({ op: 'PUT', table: 'grade_types', id: id(120), data: { name: 'Percent', kind: 'number', low_value: 0, high_value: 100 } })).toEqual(parentsOnly('insert'));
        expect(forEveryone({ op: 'PUT', table: 'task_response_fields', id: id(150), data: { task_id: id(131), type: 'photo', label: 'A photo' } })).toEqual(parentsOnly('insert'));
    });

    it('have their tasks worked through by anyone, and laid out by parents', () => {
        // A kid moves a task along, as the day list lets them.
        expect(forEveryone({ op: 'PATCH', table: 'tasks', id: id(131), data: { workflow_state: 'done', completed_on: '2026-03-09', completed_at: '2026-03-09T18:00:00.000Z' } }, task)).toEqual(allow('update'));
        // Which series a task is in is the parent's to say: a kid neither adds a task nor moves one.
        expect(forEveryone({ op: 'PUT', table: 'tasks', id: id(139), data: { task_series_id: id(130), title: 'Extra', sort_order: 9 } })).toEqual(parentsOnly('insert'));
        expect(forEveryone({ op: 'PATCH', table: 'tasks', id: id(131), data: { task_series_id: id(140) } }, task)).toEqual({ parent: 'update', eli: 'column_not_allowed', fay: 'column_not_allowed', sharedKid: 'column_not_allowed' });
        expect(forEveryone({ op: 'DELETE', table: 'tasks', id: id(131) }, task)).toEqual(allow('delete'));
    });

    it('take an update, its files and its answers from anyone signed in', () => {
        expect(forEveryone({ op: 'PUT', table: 'task_updates', id: id(160), data: { task_id: id(131), actor_id: ELI, from_state: 'in_progress', to_state: 'needs_review', scheduled_for: '2026-03-09' } })).toEqual(allow('insert'));
        expect(forEveryone({ op: 'PUT', table: 'task_update_attachments', id: id(170), data: { update_id: id(160), name: 'page.jpg', type: 'image/jpeg', url: 'updates/page.jpg' } })).toEqual(allow('insert'));
        expect(forEveryone({ op: 'PUT', table: 'task_response_field_values', id: id(180), data: { update_id: id(160), field_id: id(150), rich_text_content: '<p>1, 3, 5</p>' } })).toEqual(allow('insert'));
        expect(forEveryone({ op: 'PATCH', table: 'task_response_field_values', id: id(180), data: { update_id: id(161) } }, { id: id(180), update_id: id(160), field_id: id(150) })).toEqual(allow('update'));
        expect(forEveryone({ op: 'PUT', table: 'task_attachments', id: id(140), data: { task_id: id(131), name: 'chapter.pdf', type: 'application/pdf', url: 'tasks/chapter.pdf' } })).toEqual(allow('insert'));
    });

    it('refuse a state, a kind of answer or a time of day the app does not have', () => {
        expect(checkOperation({ op: 'PATCH', table: 'tasks', id: id(131), data: { workflow_state: 'finished' } }).valid).toBe(false);
        expect(checkOperation({ op: 'PATCH', table: 'tasks', id: id(131), data: { specific_time: 'teatime' } }).valid).toBe(false);
        expect(checkOperation({ op: 'PUT', table: 'task_response_fields', id: id(150), data: { task_id: id(131), type: 'song', label: 'Sing' } }).valid).toBe(false);
        expect(checkOperation({ op: 'PUT', table: 'task_updates', id: id(160), data: { task_id: id(131), from_state: 'done', to_state: 'undone', scheduled_for: '2026-03-09' } }).valid).toBe(false);
    });
});

describe('money', () => {
    const envelope = { id: id(200), family_member_id: ELI, name: 'Savings', archived_at: null };
    const nobodyMay = { parent: 'not_allowed', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' };

    it('leaves a device what an envelope is called and saving for: a parent on any, a kid on their own', () => {
        expect(forEveryone({ op: 'PATCH', table: 'allowance_envelopes', id: id(200), data: { name: 'Bike', goal_amount: 120, goal_currency: 'USD' } }, envelope)).toEqual({ parent: 'update', eli: 'update', fay: 'not_yours', sharedKid: 'not_allowed' });
    });

    it('takes no envelope from a device, and lets none be removed', () => {
        expect(forEveryone({ op: 'PUT', table: 'allowance_envelopes', id: id(203), data: { name: 'Extra' } })).toEqual(nobodyMay);
        expect(forEveryone({ op: 'DELETE', table: 'allowance_envelopes', id: id(200) }, envelope)).toEqual(nobodyMay);
    });

    it('has no way to say whose an envelope is, to archive one, or to write a balance or a ledger row', () => {
        expect(checkOperation({ op: 'PATCH', table: 'allowance_envelopes', id: id(200), data: { family_member_id: FAY } }).valid).toBe(false);
        expect(checkOperation({ op: 'PATCH', table: 'allowance_envelopes', id: id(200), data: { archived_at: '2026-03-09T18:00:00.000Z' } }).valid).toBe(false);
        expect(checkOperation({ op: 'PATCH', table: 'envelope_balances', id: `${id(200)}.USD`, data: { amount: 1000 } }).valid).toBe(false);
        expect(checkOperation({ op: 'PUT', table: 'allowance_transactions', id: id(210), data: { envelope_id: id(200), transaction_type: 'deposit', amount: 1000, currency: 'USD' } }).valid).toBe(false);
        expect(Object.keys(POLICY)).not.toContain('envelope_balances');
        expect(Object.keys(POLICY)).not.toContain('allowance_transactions');
    });

    it('lets a kid choose their own default envelope, and a parent anyone\'s', () => {
        expect(forEveryone({ op: 'PATCH', table: 'family_members', id: ELI, data: { default_envelope_id: id(201) } }, { id: ELI, default_envelope_id: id(200) })).toEqual({ parent: 'update', eli: 'update', fay: 'not_yours', sharedKid: 'not_allowed' });
    });

    it('keeps exchange rates by their pair of currencies, written by parents', () => {
        expect(keyOf('exchange_rates', 'USD.NPR')).toEqual({ base_currency: 'USD', target_currency: 'NPR' });
        expect(forEveryone({ op: 'PUT', table: 'exchange_rates', id: 'USD.NPR', data: { rate: 133.5, fetched_at: '2026-03-09T18:00:00.000Z' } })).toEqual({ parent: 'insert', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
    });
});

describe('what the family posts, and the dashboards', () => {
    const parentsOnly = (action: string) => ({ parent: action, eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
    const anyone = (action: string) => ({ parent: action, eli: action, fay: action, sharedKid: action });

    it('are written by parents: announcements, the queue and its categories, rules, their files, and the family dashboard', () => {
        expect(forEveryone({ op: 'PUT', table: 'announcements', id: id(300), data: { title: 'Grandma visits' } })).toEqual(parentsOnly('insert'));
        expect(forEveryone({ op: 'PATCH', table: 'content_queue_items', id: id(311), data: { status: 'archived', archived_at: '2026-03-09T18:00:00.000Z' } }, { id: id(311), status: 'live' })).toEqual(parentsOnly('update'));
        expect(forEveryone({ op: 'DELETE', table: 'content_categories', id: id(310) }, { id: id(310) })).toEqual(parentsOnly('delete'));
        expect(forEveryone({ op: 'PATCH', table: 'family_rules', id: id(320), data: { is_archived: 1 } }, { id: id(320), is_archived: false })).toEqual(parentsOnly('update'));
        expect(forEveryone({ op: 'PUT', table: 'content_attachments', id: id(330), data: { queue_item_id: id(311), name: 'psalm.png', type: 'image/png', url: 'content/psalm.png' } })).toEqual(parentsOnly('insert'));
        expect(forEveryone({ op: 'PATCH', table: 'family_dashboard_widgets', id: id(341), data: { x: 1.5, config: '{"format":"12h"}' } }, { id: id(341), x: 0 })).toEqual(parentsOnly('update'));
        expect(forEveryone({ op: 'PUT', table: 'family_dashboard_layouts', id: id(340), data: { breakpoint_key: 'watch', label: 'Watch', min_width: 0, max_width: 200 } })).toEqual(parentsOnly('insert'));
    });

    it('keep a rule\'s versions as written: a parent adds one, and nobody changes or removes one', () => {
        const version = { id: id(321), rule_id: id(320), version_number: 1 };
        expect(forEveryone({ op: 'PUT', table: 'family_rule_versions', id: id(322), data: { rule_id: id(320), version_number: 2, rich_text_content: '<p>After chores.</p>' } })).toEqual(parentsOnly('insert'));
        expect(forEveryone({ op: 'PATCH', table: 'family_rule_versions', id: id(321), data: { rich_text_content: '<p>Never.</p>' } }, version)).toEqual(anyone('not_allowed'));
        expect(forEveryone({ op: 'DELETE', table: 'family_rule_versions', id: id(321) }, version)).toEqual(anyone('not_allowed'));
    });

    it('let anyone arrange a personal dashboard, which is known by whose it is', () => {
        expect(keyOf('dashboard_configs', ELI)).toEqual({ family_member_id: ELI });
        expect(forEveryone({ op: 'PUT', table: 'dashboard_configs', id: ELI, data: { widget_order: '["chores","balance"]' } })).toEqual(anyone('insert'));
    });

    it('let anyone put a file on a history entry, once', () => {
        const file = { id: id(360), history_event_id: id(60) };
        expect(forEveryone({ op: 'PUT', table: 'history_event_attachments', id: id(360), data: { history_event_id: id(60), name: 'proof.jpg', type: 'image/jpeg', url: 'history/proof.jpg' } })).toEqual(anyone('insert'));
        expect(forEveryone({ op: 'PATCH', table: 'history_event_attachments', id: id(360), data: { url: 'history/other.jpg' } }, file)).toEqual(anyone('not_allowed'));
        expect(forEveryone({ op: 'DELETE', table: 'history_event_attachments', id: id(360) }, file)).toEqual(anyone('not_allowed'));
    });
});

describe('messages', () => {
    it('are no device\'s to write: there is no rule for them, because there is nothing a device may send', () => {
        for (const table of ['message_threads', 'message_thread_members', 'messages', 'message_attachments', 'message_reactions', 'message_acknowledgements']) {
            expect(Object.keys(POLICY)).not.toContain(table);
            expect(checkOperation({ op: 'PUT', table, id: id(400), data: {} }).valid).toBe(false);
            expect(checkOperation({ op: 'DELETE', table, id: id(400) }).valid).toBe(false);
        }
    });
});

describe('history', () => {
    const event = (actor: string | null): DeviceOperation => ({ op: 'PUT', table: 'history_events', id: id(60), data: { occurred_at: '2026-03-09T18:00:00.000Z', domain: 'chores', action_type: 'chore_marked_done', summary: 'Completed "Dishes"', actor_id: actor, metadata: '{}' } });

    it('is written by a kid only in their own name', () => {
        expect(forEveryone(event(ELI))).toEqual({ parent: 'insert', eli: 'insert', fay: 'not_yours', sharedKid: 'not_allowed' });
        expect(decide(eli, event(null))).toBe('not_yours');
    });

    it('is never changed or removed, by anyone', () => {
        const current = { id: id(60), actor_id: ELI, summary: 'Completed "Dishes"' };
        expect(forEveryone({ op: 'PATCH', table: 'history_events', id: id(60), data: { summary: 'Nothing happened' } }, current)).toEqual({ parent: 'not_allowed', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
        expect(forEveryone({ op: 'DELETE', table: 'history_events', id: id(60) }, current)).toEqual({ parent: 'not_allowed', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
        expect(forEveryone({ op: 'DELETE', table: 'history_event_members', id: `${id(60)}.${ELI}` }, { history_event_id: id(60), family_member_id: ELI })).toEqual({ parent: 'not_allowed', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
    });

    it('says whom an event affected, for anyone signed in as themselves', () => {
        expect(forEveryone({ op: 'PUT', table: 'history_event_members', id: `${id(60)}.${ELI}`, data: {} })).toEqual({ parent: 'insert', eli: 'insert', fay: 'insert', sharedKid: 'not_allowed' });
    });
});

describe('refusals', () => {
    const refusal = { id: id(90), family_member_id: ELI, reason: 'already_claimed', dismissed_at: null };
    const dismiss: DeviceOperation = { op: 'PATCH', table: 'write_refusals', id: id(90), data: { dismissed_at: '2026-03-09T18:00:00.000Z' } };

    it('are dismissed by the person they belong to, or a parent', () => {
        expect(forEveryone(dismiss, refusal)).toEqual({ parent: 'update', eli: 'update', fay: 'not_yours', sharedKid: 'not_allowed' });
    });

    it('are never made or removed from a device', () => {
        expect(forEveryone({ op: 'PUT', table: 'write_refusals', id: id(91), data: {} })).toEqual({ parent: 'not_allowed', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
        expect(forEveryone({ op: 'DELETE', table: 'write_refusals', id: id(90) }, refusal)).toEqual({ parent: 'not_allowed', eli: 'not_allowed', fay: 'not_allowed', sharedKid: 'not_allowed' });
    });
});
