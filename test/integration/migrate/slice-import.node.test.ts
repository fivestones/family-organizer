import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as choreTiming from '@/packages/shared-core/src/chore-timing';
import { applyMigrations, listMigrations } from '@/db/migrate.mjs';
import { describeImport, loadTables, readExport } from '@/scripts/migrate/import.mjs';
import { buildRows } from '@/scripts/migrate/mapping.mjs';
import { verifyImport } from '@/scripts/migrate/verify.mjs';

// The move from Instant to Postgres for the first tables: an export goes through the mapping into the schema, and the
// verification, which shares no code with the mapping, agrees. Everything here is invented; no real data is used.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADA = id(1);
const BEN = id(2);
const CAL = id(3);
const DISHES = id(10);
const TRASH = id(11);
const PIANO = id(12);
const LAUNDRY = id(13);

type Rows = Record<string, Array<Record<string, unknown>>>;

/** A small family as Instant would export it, with each link on the side Instant's schema declares it forward. */
function family(): Rows {
    return {
        settings: [
            { id: id(100), name: 'dashboardTheme', value: 'dark' },
            { id: id(101), name: 'enabledCurrencies', value: '["USD","STARS"]' },
        ],
        unitDefinitions: [{ id: id(110), code: 'STARS', name: 'Stars', symbol: '★', isMonetary: false, symbolPlacement: 'after', symbolSpacing: true, decimalPlaces: 0 }],
        familyMembers: [
            { id: ADA, name: 'Ada', role: 'parent', order: 0, email: '', pinHash: 'scrypt$abc', photoUrls: { '64': 'a64.png', '320': 'a320.png', '1200': 'a1200.png' }, allowancePayoutDelayDays: 0, allowanceStartDate: null, assignedChores: [DISHES, TRASH], completedChores: [id(40)] },
            { id: BEN, name: 'Ben', role: 'child', order: 1, email: '', color: '#3366ff', allowancePayoutDelayDays: 2, allowanceStartDate: '2026-01-05T00:00:00.000Z', messageQuietHoursStart: '21:30', messageDigestMode: 'digest', assignedChores: [DISHES, TRASH, PIANO, LAUNDRY], completedChores: [id(41), id(42)] },
            { id: CAL, name: 'Cal', role: 'child', order: 2, email: '', assignedChores: [TRASH], completedChores: [id(43)] },
        ],
        chores: [
            { id: DISHES, title: 'Dishes', description: '', startDate: '2026-01-01T00:00:00.000Z', createdAt: '2025-12-31T18:00:00.000Z', rrule: 'FREQ=DAILY', rotationType: 'none', done: false, isJoint: true, isUpForGrabs: false, sortOrder: 1, weight: 2, exdates: ['2026-01-03', '2026-01-02'], timingMode: 'named_window', timingConfig: { mode: 'named_window', namedWindowKey: 'Evening' }, completions: [id(40), id(41)] },
            // Rotates between three people, in an order that is not the family's.
            { id: TRASH, title: 'Trash', startDate: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T08:00:00.000Z', rrule: 'FREQ=WEEKLY', rotationType: 'weekly', done: false, sortOrder: 2, assignments: [id(30), id(31), id(32)], timingMode: null, timeBucket: 'morning', completions: [id(43)] },
            // An earlier generation's name for "after a routine marker", with the fallback on the old start field.
            { id: PIANO, title: 'Piano', startDate: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T08:00:00.000Z', rrule: null, rotationType: 'none', done: false, sortOrder: 3, timingMode: 'routine_anchor', timingConfig: { mode: 'routine_anchor', anchor: { sourceType: 'routine', relation: 'after', routineKey: 'Dinner', fallbackStartTime: '18:30' } }, completions: [id(42)] },
            // Due after another chore.
            { id: LAUNDRY, title: 'Laundry', startDate: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T08:00:00.000Z', rotationType: 'none', done: false, sortOrder: 4, isUpForGrabs: true, rewardType: 'fixed', rewardAmount: 1.5, rewardCurrency: 'USD', estimatedDurationSecs: 600, pauseState: { mode: 'bounded', intent: 'vacation', pauseStartDate: '2026-02-01', resumeOnDate: '2026-02-08', generatedExdates: [], originalEndCondition: { type: 'none' }, createdAt: '2026-01-20T00:00:00.000Z' }, timingMode: 'after_chore', timingConfig: { mode: 'after_chore', anchor: { sourceType: 'chore', sourceChoreId: DISHES, fallbackTime: '19:00', event: 'completed' } } },
        ],
        choreAssignments: [
            { id: id(30), order: 0, familyMember: CAL },
            { id: id(31), order: 1, familyMember: ADA },
            { id: id(32), order: 2, familyMember: BEN },
        ],
        choreCompletions: [
            { id: id(40), completed: true, dateDue: '2026-01-04', dateCompleted: '2026-01-04T19:05:00.000Z', allowanceAwarded: false, markedBy: ADA },
            { id: id(41), completed: false, dateDue: '2026-01-04', dateCompleted: null, notDone: true, allowanceAwarded: false, markedBy: ADA },
            { id: id(42), completed: true, dateDue: '2026-01-05', dateCompleted: '2026-01-05T16:00:00.000Z', allowanceAwarded: true },
            { id: id(43), completed: false, dateDue: '2026-01-05', dateCompleted: null, allowanceAwarded: false },
        ],
    };
}

const scratch = mkdtempSync(path.join(tmpdir(), 'slice-import-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let exportCount = 0;
function writeExport(rows: Rows): string {
    const dir = path.join(scratch, `export-${(exportCount += 1)}`);
    mkdirSync(path.join(dir, 'entities'), { recursive: true });
    for (const [entity, list] of Object.entries(rows)) {
        writeFileSync(path.join(dir, 'entities', `${entity}.jsonl`), list.map((entity) => JSON.stringify({ entity })).join('\n'));
    }
    return dir;
}

async function importInto(db: PGlite, rows: Rows, options?: { replace?: boolean }) {
    const rowsOf = readExport(writeExport(rows));
    const built = buildRows(rowsOf);
    await loadTables(db, built.tables, options);
    return { rowsOf, built, report: describeImport(built, 'export') };
}

const failed = (result: { checks: Array<{ name: string; wrong: string[] }> }) => result.checks.filter((check) => check.wrong.length).map((check) => check.name);
const one = async (db: PGlite, sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];

let db: PGlite;
beforeEach(async () => {
    db = new PGlite();
    await applyMigrations(db);
});

describe('the migrations', () => {
    it('apply once, and are recorded so a second start applies nothing', async () => {
        const fresh = new PGlite();
        const versions = listMigrations().map((migration) => migration.version);
        expect(versions.slice(0, 2)).toEqual(['0001_family_and_chores', '0002_powersync_publication']);
        expect(await applyMigrations(fresh)).toEqual(versions);
        expect(await applyMigrations(fresh)).toEqual([]);
        expect((await fresh.query('SELECT version FROM schema_migrations ORDER BY version')).rows).toEqual(versions.map((version) => ({ version })));
    });
});

describe('importing an export', () => {
    it('loads a family and passes a verification that shares no code with the mapping', async () => {
        const { rowsOf, report } = await importInto(db, family());

        expect(report.rows).toEqual({ settings: 2, unit_definitions: 1, family_members: 3, chores: 4, chore_assignees: 7, chore_completions: 4 });
        expect(report.heldBack).toEqual({});
        expect(report.storedButNotMapped).toEqual({});
        const result = await verifyImport(db, rowsOf, choreTiming);
        expect(failed(result)).toEqual([]);
        expect(result.checks.every((check) => check.compared > 0)).toBe(true);
    });

    it('keeps a setting stored as a bare word, and one stored as JSON, both as JSON', async () => {
        await importInto(db, family());

        expect((await one(db, `SELECT value FROM settings WHERE name = 'dashboardTheme'`)).value).toBe('dark');
        expect((await one(db, `SELECT value FROM settings WHERE name = 'enabledCurrencies'`)).value).toEqual(['USD', 'STARS']);
    });

    it('stores a day as a day, an empty string as nothing, and whether a PIN is set without being asked', async () => {
        await importInto(db, family());

        const ada = await one(db, `SELECT email, has_pin, photo_urls FROM family_members WHERE id = $1`, [ADA]);
        expect(ada).toEqual({ email: null, has_pin: true, photo_urls: { '64': 'a64.png', '320': 'a320.png', '1200': 'a1200.png' } });
        const ben = await one(db, `SELECT has_pin, allowance_start_date::text AS start, allowance_payout_delay_days AS delay, message_quiet_hours_start::text AS quiet FROM family_members WHERE id = $1`, [BEN]);
        expect(ben).toEqual({ has_pin: false, start: '2026-01-05', delay: 2, quiet: '21:30:00' });
        const dishes = await one(db, `SELECT start_date::text AS start, exdates::text[] AS exdates, description FROM chores WHERE id = $1`, [DISHES]);
        expect(dishes).toEqual({ start: '2026-01-01', exdates: ['2026-01-02', '2026-01-03'], description: null });
    });

    it('keeps has_pin true to the hash whoever writes the row, since it is what devices are sent in the hash\'s place', async () => {
        await importInto(db, family());
        const hasPin = async (memberId: string) => (await one(db, `SELECT has_pin FROM family_members WHERE id = $1`, [memberId])).has_pin;

        await db.query(`UPDATE family_members SET pin_hash = 'scrypt$new' WHERE id = $1`, [BEN]);
        expect(await hasPin(BEN)).toBe(true);
        await db.query(`UPDATE family_members SET pin_hash = NULL WHERE id = $1`, [BEN]);
        expect(await hasPin(BEN)).toBe(false);
        // Saying so directly changes nothing: the hash decides.
        await db.query(`UPDATE family_members SET has_pin = true WHERE id = $1`, [BEN]);
        expect(await hasPin(BEN)).toBe(false);
    });

    it('resolves each generation of timing into one mode and the columns that mode uses', async () => {
        const { report } = await importInto(db, family());
        const timing = async (choreId: string) =>
            one(db, `SELECT timing_mode AS mode, timing_window_key AS win, timing_marker_key AS marker, timing_chore_id AS chore, timing_event AS event, timing_fallback_time::text AS fallback FROM chores WHERE id = $1`, [choreId]);

        expect(await timing(DISHES)).toEqual({ mode: 'named_window', win: 'evening', marker: null, chore: null, event: null, fallback: null });
        expect(await timing(TRASH)).toEqual({ mode: 'named_window', win: 'morning', marker: null, chore: null, event: null, fallback: null });
        expect(await timing(PIANO)).toEqual({ mode: 'after_marker', win: null, marker: 'dinner', chore: null, event: 'completed', fallback: '18:30:00' });
        expect(await timing(LAUNDRY)).toEqual({ mode: 'after_chore', win: null, marker: null, chore: DISHES, event: 'completed', fallback: '19:00:00' });
        expect(report.conversions).toMatchObject({
            'chores timing: "routine_anchor" stored as after_marker': 1,
            'chores timing: a bare time bucket stored as named_window': 1,
        });
    });

    it('makes one table of who is assigned, in the rotation\'s order where there is one and the family\'s where there is not', async () => {
        await importInto(db, family());
        const order = async (choreId: string) => (await db.query<{ member: string }>(`SELECT family_member_id AS member FROM chore_assignees WHERE chore_id = $1 ORDER BY position`, [choreId])).rows.map((row) => row.member);

        expect(await order(TRASH)).toEqual([CAL, ADA, BEN]);
        expect(await order(DISHES)).toEqual([ADA, BEN]);
    });

    it('reads a link from either side, since which side an export holds it on is the old schema\'s business', async () => {
        const rows = family();
        for (const member of rows.familyMembers) delete member.assignedChores;
        rows.chores.find((chore) => chore.id === DISHES)!.assignees = [ADA, BEN];
        rows.chores.find((chore) => chore.id === TRASH)!.assignees = [ADA, BEN, CAL];
        rows.chores.find((chore) => chore.id === PIANO)!.assignees = [BEN];
        rows.chores.find((chore) => chore.id === LAUNDRY)!.assignees = [BEN];

        const { rowsOf, report } = await importInto(db, rows);

        expect(report.rows.chore_assignees).toBe(7);
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);
    });

    it('holds a completion done, marked not done, or cleared, and never two of those at once', async () => {
        await importInto(db, family());
        const state = async (completionId: string) => one(db, `SELECT completed_at IS NOT NULL AS done, not_done, allowance_awarded AS awarded, marked_by FROM chore_completions WHERE id = $1`, [completionId]);

        expect(await state(id(40))).toEqual({ done: true, not_done: false, awarded: false, marked_by: ADA });
        expect(await state(id(41))).toEqual({ done: false, not_done: true, awarded: false, marked_by: ADA });
        expect(await state(id(42))).toEqual({ done: true, not_done: false, awarded: true, marked_by: null });
        expect(await state(id(43))).toEqual({ done: false, not_done: false, awarded: false, marked_by: null });
        await expect(db.query(`UPDATE chore_completions SET not_done = true WHERE id = $1`, [id(40)])).rejects.toThrow();
    });
});

describe('what the new schema cannot hold', () => {
    it('is held back with its reason and counted, never dropped', async () => {
        const rows = family();
        // A completion whose chore was deleted, one nobody is recorded against, and a second for a slot already taken.
        rows.choreCompletions.push({ id: id(50), completed: true, dateDue: '2026-01-06', dateCompleted: '2026-01-06T10:00:00.000Z', allowanceAwarded: false });
        rows.familyMembers[1].completedChores = [id(41), id(42), id(50)];
        rows.choreCompletions.push({ id: id(51), completed: true, dateDue: '2026-01-06', dateCompleted: '2026-01-06T11:00:00.000Z', allowanceAwarded: false });
        rows.chores[0].completions = [id(40), id(41), id(51), id(52)];
        rows.choreCompletions.push({ id: id(52), completed: true, dateDue: '2026-01-04', dateCompleted: '2026-01-04T20:00:00.000Z', allowanceAwarded: false });
        rows.familyMembers[0].completedChores = [id(40), id(52)];
        rows.settings.push({ id: id(102), name: 'dashboardTheme', value: 'light' });

        const { rowsOf, built, report } = await importInto(db, rows);

        expect(report.heldBack).toEqual({
            settings: { 'Another row already holds this setting.': 1 },
            choreCompletions: {
                'It belongs to no chore.': 1,
                'Nobody is recorded as having completed it.': 1,
                'Another completion already covers this chore, person and day.': 1,
            },
        });
        expect(built.heldBack.choreCompletions.map((held: { row: { id: string } }) => held.row.id).sort()).toEqual([id(40), id(50), id(51)]);
        // Of the two for Ada, the dishes and the fourth, the later one is the one kept.
        expect((await one(db, `SELECT id FROM chore_completions WHERE chore_id = $1 AND completed_by = $2`, [DISHES, ADA])).id).toBe(id(52));
        expect((await one(db, `SELECT value FROM settings WHERE name = 'dashboardTheme'`)).value).toBe('dark');
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);
    });

    it('leaves a timing anchor empty when the chore it pointed at is gone, and says so', async () => {
        const rows = family();
        rows.chores = rows.chores.filter((chore) => chore.id !== DISHES);
        rows.choreCompletions = rows.choreCompletions.filter((completion) => ![id(40), id(41)].includes(completion.id as string));

        const { report } = await importInto(db, rows);

        expect(await one(db, `SELECT timing_mode AS mode, timing_chore_id AS chore, timing_fallback_time::text AS fallback FROM chores WHERE id = $1`, [LAUNDRY])).toEqual({ mode: 'after_chore', chore: null, fallback: '19:00:00' });
        expect(report.conversions).toMatchObject({ 'chores timing: anchored to a chore that no longer exists, anchor left empty': 1 });
    });

    it('reports an attribute it was never told about, so a new one cannot be lost by oversight', async () => {
        const rows = family();
        rows.chores[0].somethingNew = 'value';

        const { report } = await importInto(db, rows);

        expect(report.storedButNotMapped).toEqual({ chores: { somethingNew: 1 } });
    });
});

describe('safety', () => {
    it('refuses to import over rows that are already there, and leaves them untouched', async () => {
        await importInto(db, family());
        const smaller = family();
        smaller.familyMembers = smaller.familyMembers.slice(0, 1);

        await expect(importInto(db, smaller)).rejects.toThrow(/already holds rows/);
        expect((await one(db, `SELECT count(*)::int AS n FROM family_members`)).n).toBe(3);
    });

    it('replaces everything when asked to', async () => {
        await importInto(db, family());
        const rows = family();
        rows.settings = rows.settings.slice(0, 1);

        const { rowsOf } = await importInto(db, rows, { replace: true });

        expect((await one(db, `SELECT count(*)::int AS n FROM settings`)).n).toBe(1);
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);
    });

    it('loads nothing at all when any table fails', async () => {
        const rows = family();
        rows.choreCompletions[0].dateDue = '2026-02-30';

        await expect(importInto(db, rows)).rejects.toThrow();
        expect((await one(db, `SELECT count(*)::int AS n FROM family_members`)).n).toBe(0);
    });
});

describe('the verification', () => {
    // A check that cannot fail proves nothing. Each of these alters the database after a good import.
    const alterations: Array<[string, string, string]> = [
        ['a changed setting', `UPDATE settings SET value = '"light"' WHERE name = 'dashboardTheme'`, 'settings: each setting holds the value it held'],
        ['a changed role', `UPDATE family_members SET role = 'parent' WHERE id = '${BEN}'`, 'family_members: every member, field by field'],
        ['a start date a day out', `UPDATE chores SET start_date = start_date + 1 WHERE id = '${DISHES}'`, 'chores: every chore, field by field'],
        ['a different timing', `UPDATE chores SET timing_marker_key = 'breakfast' WHERE id = '${PIANO}'`, 'chores: the app resolves the same timing from the new columns as from the old attributes'],
        ['a missing assignee', `DELETE FROM chore_assignees WHERE chore_id = '${DISHES}' AND family_member_id = '${BEN}'`, 'chore_assignees: each chore is assigned to exactly the people it was'],
        ['a rotation out of order', `UPDATE chore_assignees SET position = 9 WHERE chore_id = '${TRASH}' AND family_member_id = '${CAL}'`, 'chore_assignees: each rotation runs in the order it did'],
        ['a completion moved to another person', `UPDATE chore_completions SET completed_by = '${CAL}' WHERE id = '${id(42)}'`, 'chore_completions: every completion loaded, field by field'],
        ['a completion that is missing', `DELETE FROM chore_completions WHERE id = '${id(43)}'`, 'chore_completions: one for each chore, person and day that had one'],
        ['a completion undone', `UPDATE chore_completions SET completed_at = NULL WHERE id = '${id(40)}'`, 'chore_completions: each person has done as many chores as before'],
    ];

    it.each(alterations)('catches %s', async (_what, sql, check) => {
        const { rowsOf } = await importInto(db, family());
        await db.exec(sql);

        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toContain(check);
    });
});
