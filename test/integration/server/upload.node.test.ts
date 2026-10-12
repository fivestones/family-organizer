import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DeviceOperation, Principal } from '@family-organizer/data';
import { POST } from '@/app/api/sync/upload/route';
import { createSession, drainSession, endSession, type Session } from '@/lib/server/sessions';
import { applyUpload, GenerationChangedError, WritesFrozenError, type UploadedTransaction } from '@/lib/server/upload';
import { DANA, deviceRequest, DISHES, ELI, FAY, LAUNDRY, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// The upload route against a real Postgres: what a device sends is judged by the row as the database holds it,
// applied wholly or not at all, and applied once.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const DAY = '2026-03-09';
const NOON = '2026-03-09T12:00:00.000Z';
const ONE = '2026-03-09T13:00:00.000Z';

let database: TestDatabase;
let nextTransaction: number;
beforeEach(async () => {
    database = await createTestDatabase();
    await seedFamily(database);
    nextTransaction = 1;
});
afterEach(() => database.close());

const signedIn = async (principal: Principal) => (await createSession(database.db, principal)).session;
const asParent = () => signedIn({ type: 'parent', familyMemberId: DANA });
const asEli = () => signedIn({ type: 'kid', familyMemberId: ELI });
const asFay = () => signedIn({ type: 'kid', familyMemberId: FAY });

const transaction = (operations: DeviceOperation[], overrides: Partial<UploadedTransaction> = {}): UploadedTransaction => ({
    uploadId: `upload-${String(nextTransaction++).padStart(12, '0')}`, dataGeneration: 1, mutation: 'completeChore', operations, ...overrides,
});
const send = (session: Session, operations: DeviceOperation[], overrides: Partial<UploadedTransaction> = {}) => applyUpload(database.db, session, transaction(operations, overrides));

const rows = async <T = Record<string, any>>(text: string, params: unknown[] = []) => (await database.sql.query<T>(text, params as any[])).rows;
const completion = async (completionId: string) => (await rows(`SELECT completed_by, marked_by, completed_at, not_done, allowance_awarded FROM chore_completions WHERE id = $1`, [completionId]))[0] ?? null;

/** What completing a chore sends: the completion, the history entry, and whom the entry affected, as one transaction. */
const completing = (who: string, options: { completionId?: string; chore?: string; eventId?: string; at?: string; markedBy?: string | null; awarded?: number } = {}): DeviceOperation[] => {
    const eventId = options.eventId ?? id(600 + nextTransaction);
    return [
        { op: 'PUT', table: 'chore_completions', id: options.completionId ?? id(400 + nextTransaction), data: { chore_id: options.chore ?? DISHES, completed_by: who, marked_by: options.markedBy ?? null, date_due: DAY, completed_at: options.at ?? NOON, not_done: 0, allowance_awarded: options.awarded ?? 0 } },
        { op: 'PUT', table: 'history_events', id: eventId, data: { occurred_at: options.at ?? NOON, domain: 'chores', action_type: 'chore_marked_done', summary: 'Completed a chore', source: 'manual', actor_id: options.markedBy ?? who, chore_id: options.chore ?? DISHES, scheduled_for: DAY, metadata: JSON.stringify({ dateDue: DAY }) } },
        { op: 'PUT', table: 'history_event_members', id: `${eventId}.${who}`, data: { history_event_id: eventId, family_member_id: who } },
    ];
};

describe('a transaction a kid may make', () => {
    it('is applied whole, and recorded', async () => {
        const result = await send(await asEli(), completing(ELI, { completionId: id(40), eventId: id(60) }));

        expect(result).toEqual({ outcome: { ok: true }, replayed: false });
        expect(await completion(id(40))).toEqual({ completed_by: ELI, marked_by: null, completed_at: NOON, not_done: false, allowance_awarded: false });
        expect(await rows(`SELECT actor_id, chore_id, scheduled_for, metadata FROM history_events`)).toEqual([{ actor_id: ELI, chore_id: DISHES, scheduled_for: DAY, metadata: { dateDue: DAY } }]);
        expect(await rows(`SELECT family_member_id FROM history_event_members`)).toEqual([{ family_member_id: ELI }]);
        expect(await rows(`SELECT principal, mutation, outcome FROM sync_uploads`)).toEqual([{ principal: `kid-${ELI}`, mutation: 'completeChore', outcome: { ok: true } }]);
        expect(await rows(`SELECT 1 FROM write_refusals`)).toEqual([]);
    });

    it('can be un-ticked by sending only what changed', async () => {
        const eli = await asEli();
        await send(eli, completing(ELI, { completionId: id(40) }));
        expect((await send(eli, [{ op: 'PATCH', table: 'chore_completions', id: id(40), data: { completed_at: null } }])).outcome).toEqual({ ok: true });
        expect((await completion(id(40)))?.completed_at).toBeNull();
    });
});

describe('a transaction with one write that is not allowed', () => {
    it('is refused whole: the writes that were allowed are not applied either', async () => {
        // A history entry Eli could write, with a completion for Fay that he could not.
        const result = await send(await asEli(), completing(FAY, { completionId: id(40), markedBy: ELI }));

        expect(result).toEqual({ outcome: { ok: false, reason: 'not_yours', table: 'chore_completions', rowId: id(40) }, replayed: false });
        expect(await rows(`SELECT 1 FROM chore_completions`)).toEqual([]);
        expect(await rows(`SELECT 1 FROM history_events`)).toEqual([]);
    });

    it('is recorded, and the person who made it is told', async () => {
        await send(await asEli(), completing(ELI, { awarded: 1, completionId: id(40) }));

        expect(await rows(`SELECT family_member_id, principal_type, mutation, reason, table_name, row_id, dismissed_at FROM write_refusals`)).toEqual([
            { family_member_id: ELI, principal_type: 'kid', mutation: 'completeChore', reason: 'column_not_allowed', table_name: 'chore_completions', row_id: id(40), dismissed_at: null },
        ]);
        expect((await rows(`SELECT outcome FROM sync_uploads`))[0].outcome).toMatchObject({ ok: false, reason: 'column_not_allowed' });
    });
});

describe('what a device calls a write', () => {
    it('does not decide what it is: sending an existing row as new is judged as the change it would make', async () => {
        await send(await asEli(), completing(ELI, { completionId: id(40) }));

        // Fay sends Eli's completion again, as hers.
        const stolen = await send(await asFay(), completing(FAY, { completionId: id(40), at: ONE }));
        expect(stolen.outcome).toMatchObject({ ok: false, reason: 'already_claimed' });
        // Eli sends his own again, marked as paid.
        const paid = await send(await asEli(), completing(ELI, { completionId: id(40), awarded: 1 }));
        expect(paid.outcome).toMatchObject({ ok: false, reason: 'column_not_allowed' });

        expect(await completion(id(40))).toMatchObject({ completed_by: ELI, completed_at: NOON, allowance_awarded: false });
    });

    it('does not let a delete and a re-creation do what a change could not', async () => {
        await send(await asEli(), completing(ELI, { completionId: id(40) }));

        const result = await send(await asFay(), [{ op: 'DELETE', table: 'chore_completions', id: id(40) }, ...completing(FAY, { completionId: id(40) })]);

        expect(result.outcome).toMatchObject({ ok: false, reason: 'not_allowed' });
        expect(await completion(id(40))).toMatchObject({ completed_by: ELI });
    });

    it('is nothing at all when the row it changes has gone', async () => {
        const result = await send(await asEli(), [{ op: 'PATCH', table: 'chore_completions', id: id(49), data: { completed_at: NOON } }]);
        expect(result.outcome).toEqual({ ok: true });
        expect(await rows(`SELECT 1 FROM chore_completions`)).toEqual([]);
    });
});

describe('two kids claiming one chore', () => {
    it('gives it to the first to arrive and tells the second', async () => {
        const claim = id(41); // The id both devices worked out for this chore and day.
        const first = await send(await asEli(), completing(ELI, { completionId: claim, chore: LAUNDRY }));
        const second = await send(await asFay(), completing(FAY, { completionId: claim, chore: LAUNDRY, at: ONE }));

        expect(first.outcome).toEqual({ ok: true });
        expect(second.outcome).toEqual({ ok: false, reason: 'already_claimed', table: 'chore_completions', rowId: claim });
        expect(await completion(claim)).toMatchObject({ completed_by: ELI, completed_at: NOON });
        expect(await rows(`SELECT family_member_id, reason FROM write_refusals`)).toEqual([{ family_member_id: FAY, reason: 'already_claimed' }]);
        // Fay's history entry went with her claim.
        expect(await rows(`SELECT actor_id FROM history_events`)).toEqual([{ actor_id: ELI }]);
    });

    it('lets the second take it once the first has un-ticked it', async () => {
        const claim = id(41);
        const eli = await asEli();
        await send(eli, completing(ELI, { completionId: claim, chore: LAUNDRY }));
        await send(eli, [{ op: 'PATCH', table: 'chore_completions', id: claim, data: { completed_at: null } }]);

        const taken = await send(await asFay(), completing(FAY, { completionId: claim, chore: LAUNDRY, at: ONE, markedBy: FAY }));

        expect(taken.outcome).toEqual({ ok: true });
        expect(await completion(claim)).toMatchObject({ completed_by: FAY, marked_by: FAY, completed_at: ONE });
    });
});

describe('a transaction that is sent again', () => {
    it('is applied once: a retry after the answer was lost does not undo what another device did since', async () => {
        const eli = await asEli();
        await send(eli, completing(ELI, { completionId: id(40) }));
        // Eli un-ticks it. The server applies that, and the answer never reaches his device.
        const untick = transaction([{ op: 'PATCH', table: 'chore_completions', id: id(40), data: { completed_at: null } }]);
        await applyUpload(database.db, eli, untick);
        // A parent puts it back, from another device.
        await send(await asParent(), [{ op: 'PATCH', table: 'chore_completions', id: id(40), data: { completed_at: ONE } }]);

        // Eli's device, having heard nothing, sends the same transaction again.
        const retry = await applyUpload(database.db, eli, untick);

        expect(retry).toEqual({ outcome: { ok: true }, replayed: true });
        expect((await completion(id(40)))?.completed_at).toBe(ONE);
    });

    it('gets the same refusal, and the person is not told twice', async () => {
        const eli = await asEli();
        const refusedOnce = transaction(completing(FAY, { completionId: id(40), markedBy: ELI }));
        const first = await applyUpload(database.db, eli, refusedOnce);
        const again = await applyUpload(database.db, eli, refusedOnce);

        expect(again).toEqual({ outcome: first.outcome, replayed: true });
        expect(await rows(`SELECT 1 FROM write_refusals`)).toHaveLength(1);
    });

    it('is known by the id its mutation gave it, so another transaction is never taken for it', async () => {
        const eli = await asEli();
        await send(eli, completing(ELI, { completionId: id(40) }), { uploadId: 'aaaaaaaa-0000-4000-8000-000000000001' });
        const other = await send(eli, completing(ELI, { completionId: id(41), chore: LAUNDRY }), { uploadId: 'aaaaaaaa-0000-4000-8000-000000000002' });
        expect(other).toEqual({ outcome: { ok: true }, replayed: false });
        expect(await rows(`SELECT upload_id FROM sync_uploads ORDER BY upload_id`)).toEqual([{ upload_id: 'aaaaaaaa-0000-4000-8000-000000000001' }, { upload_id: 'aaaaaaaa-0000-4000-8000-000000000002' }]);
    });
});

describe('a write that is malformed', () => {
    it.each([
        ['a table no device may write', { op: 'PUT', table: 'auth_sessions', id: id(1), data: {} }],
        ['a column no device may send', { op: 'PATCH', table: 'family_members', id: ELI, data: { pin_hash: 'x' } }],
        ['a name that is really SQL', { op: 'PATCH', table: 'chores', id: DISHES, data: { 'title = (SELECT pin_hash FROM family_members LIMIT 1) --': 'x' } }],
        ['a value of the wrong kind', { op: 'PATCH', table: 'chores', id: DISHES, data: { start_date: 'tomorrow' } }],
    ] as Array<[string, DeviceOperation]>)('is refused as invalid, with nothing run: %s', async (_what, operation) => {
        const result = await send(await asParent(), [operation]);
        expect(result.outcome).toMatchObject({ ok: false, reason: 'invalid' });
        expect((await rows(`SELECT title, start_date FROM chores WHERE id = $1`, [DISHES]))[0]).toEqual({ title: 'Dishes', start_date: '2026-01-01' });
    });

    it('is refused as invalid when the database will not hold it', async () => {
        // A completion needs a due day.
        const result = await send(await asParent(), [{ op: 'PUT', table: 'chore_completions', id: id(40), data: { chore_id: DISHES, completed_by: ELI } }]);
        expect(result.outcome).toMatchObject({ ok: false, reason: 'invalid', table: 'chore_completions' });
    });
});

describe('a write overtaken by another device', () => {
    it('is refused as a conflict when what it points at has gone', async () => {
        await database.sql.query(`DELETE FROM chores WHERE id = $1`, [LAUNDRY]);
        const result = await send(await asEli(), completing(ELI, { completionId: id(40), chore: LAUNDRY }));
        expect(result.outcome).toMatchObject({ ok: false, reason: 'conflict', table: 'chore_completions' });
    });

    it('is refused as a conflict when its place is already taken', async () => {
        const eli = await asEli();
        await send(eli, completing(ELI, { completionId: id(40) }));
        // The same chore, person and day again, under another id: two devices that each made one while offline.
        const result = await send(eli, completing(ELI, { completionId: id(41) }));
        expect(result.outcome).toMatchObject({ ok: false, reason: 'conflict' });
        expect(await rows(`SELECT id FROM chore_completions`)).toEqual([{ id: id(40) }]);
    });
});

describe('what a parent writes', () => {
    it('reaches each kind of column in the form the database keeps it', async () => {
        const result = await send(await asParent(), [
            { op: 'PUT', table: 'settings', id: 'dashboardTheme', data: { value: '"dark"' } },
            { op: 'PATCH', table: 'chores', id: DISHES, data: { exdates: '["2026-03-11","2026-03-10"]', timing_mode: 'before_time', timing_time: '07:30', pause_state: '{"mode":"bounded"}', is_joint: 1 } },
            { op: 'PUT', table: 'chore_assignees', id: `${DISHES}.${DANA}`, data: { chore_id: DISHES, family_member_id: DANA, position: 2 } },
            { op: 'DELETE', table: 'chore_assignees', id: `${DISHES}.${FAY}` },
        ]);

        expect(result.outcome).toEqual({ ok: true });
        expect(await rows(`SELECT value FROM settings`)).toEqual([{ value: 'dark' }]);
        expect((await rows(`SELECT exdates, timing_mode, timing_time, pause_state, is_joint FROM chores WHERE id = $1`, [DISHES]))[0]).toEqual({
            exdates: ['2026-03-11', '2026-03-10'], timing_mode: 'before_time', timing_time: '07:30:00', pause_state: { mode: 'bounded' }, is_joint: true,
        });
        expect((await rows(`SELECT family_member_id FROM chore_assignees WHERE chore_id = $1 ORDER BY position`, [DISHES])).map((row) => row.family_member_id)).toEqual([ELI, DANA]);
    });

    it('is refused when a kid sends it', async () => {
        const result = await send(await asEli(), [{ op: 'PUT', table: 'settings', id: 'dashboardTheme', data: { value: '"dark"' } }]);
        expect(result.outcome).toMatchObject({ ok: false, reason: 'not_allowed', table: 'settings' });
    });
});

describe('when the server is not taking writes', () => {
    it('refuses nothing and applies nothing, so the device keeps the transaction and tries again', async () => {
        await database.sql.query(`UPDATE installation SET writes_frozen = true`);
        await expect(send(await asEli(), completing(ELI))).rejects.toBeInstanceOf(WritesFrozenError);
        expect(await rows(`SELECT 1 FROM sync_uploads`)).toEqual([]);
    });

    it('turns away a device whose database was made from data that has since been replaced', async () => {
        await database.sql.query(`UPDATE installation SET data_generation = 2`);
        await expect(send(await asEli(), completing(ELI))).rejects.toBeInstanceOf(GenerationChangedError);
    });
});

describe('POST /api/sync/upload', () => {
    const post = (sessionToken: string | null, body: unknown) => POST(deviceRequest('/api/sync/upload', { body, sessionToken }));
    const tokenFor = async (principal: Principal) => createSession(database.db, principal);

    it('answers a refusal with 200, because it is an answer and not a reason to try again', async () => {
        const { token } = await tokenFor({ type: 'kid', familyMemberId: ELI });
        const response = await post(token, transaction(completing(FAY, { completionId: id(40), markedBy: ELI })));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: false, reason: 'not_yours', table: 'chore_completions', rowId: id(40), replayed: false });
    });

    it('needs a session, and takes one that is draining but not one that has ended', async () => {
        expect((await post(null, transaction(completing(ELI)))).status).toBe(401);

        const draining = await tokenFor({ type: 'parent', familyMemberId: DANA });
        await drainSession(database.db, draining.session.id);
        const sent = await post(draining.token, transaction(completing(ELI, { completionId: id(40), markedBy: DANA, awarded: 1 })));
        expect(await sent.json()).toMatchObject({ ok: true });
        expect(await completion(id(40))).toMatchObject({ marked_by: DANA, allowance_awarded: true });

        await endSession(database.db, draining.session.id);
        const ended = await post(draining.token, transaction(completing(ELI)));
        expect([ended.status, (await ended.json()).code]).toEqual([401, 'session_ended']);
    });

    it('says to try again later when writes are frozen, and that the data has been replaced when it has', async () => {
        const { token } = await tokenFor({ type: 'kid', familyMemberId: ELI });
        await database.sql.query(`UPDATE installation SET writes_frozen = true`);
        const frozen = await post(token, transaction(completing(ELI)));
        expect([frozen.status, frozen.headers.get('retry-after')]).toEqual([503, '30']);

        await database.sql.query(`UPDATE installation SET writes_frozen = false, data_generation = 2`);
        const replaced = await post(token, transaction(completing(ELI)));
        expect([replaced.status, (await replaced.json()).code]).toEqual([409, 'generation_changed']);
    });

    it('turns away what is not an uploaded transaction at all', async () => {
        const { token } = await tokenFor({ type: 'kid', familyMemberId: ELI });
        for (const body of [{}, { uploadId: 'upload-000000000001', dataGeneration: 1, operations: [] }, { ...transaction(completing(ELI)), uploadId: 'short' }, { ...transaction(completing(ELI)), mutation: 'DROP TABLE' }]) {
            expect((await post(token, body)).status).toBe(400);
        }
        expect(await rows(`SELECT 1 FROM sync_uploads`)).toEqual([]);
    });
});
