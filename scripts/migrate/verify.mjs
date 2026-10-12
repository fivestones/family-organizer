#!/usr/bin/env node
// Checks an import against the export it came from.
//
// It does not use scripts/migrate/mapping.mjs. An import and a check that shared one mapping would share its
// mistakes, so everything expected here is worked out again from the export's raw files, and the timing of a chore
// is compared through the app's own resolver, not through anything written for the migration.
//
//   DATABASE_URL=postgres://… node scripts/migrate/verify.mjs [export-dir]
//
// It prints counts, and the ids of a few rows that disagree. It never prints a stored value.

import { build } from 'esbuild';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const blank = (value) => value == null || value === '';
const dayOf = (value) => (blank(value) ? null : String(value).slice(0, 10));
const instantOf = (value) => (blank(value) ? null : new Date(value).getTime());
const minutesOf = (value) => (blank(value) ? null : String(value).slice(0, 5));

function sameJson(left, right) {
    if (left === right) return true;
    if (left == null || right == null || typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => sameJson(left[key], right[key]));
}

function readEntity(exportDir, entity) {
    const file = path.join(exportDir, 'entities', `${entity}.jsonl`);
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).entity) : [];
}

/** The app's own reading of when a chore is due, bundled from shared-core so this check owes nothing to the mapping. */
async function loadTimingResolver(root) {
    const outfile = path.join(tmpdir(), `chore-timing-${process.pid}-${Date.now()}.cjs`);
    await build({ entryPoints: [path.join(root, 'packages/shared-core/src/chore-timing.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
    const loaded = createRequire(import.meta.url)(outfile);
    rmSync(outfile, { force: true });
    return loaded;
}

/** A chore as the app would be handed it from the new columns, for the resolver to read. */
function choreFromColumns(row) {
    const marker = row.timing_mode === 'before_marker' || row.timing_mode === 'after_marker';
    const chore = row.timing_mode === 'before_chore' || row.timing_mode === 'after_chore';
    return {
        id: row.id,
        timingMode: row.timing_mode,
        timingConfig: {
            mode: row.timing_mode,
            namedWindowKey: row.timing_window_key,
            time: minutesOf(row.timing_time),
            window: row.timing_mode === 'between_times' ? { startTime: minutesOf(row.timing_start_time), endTime: minutesOf(row.timing_end_time) } : null,
            anchor: marker || chore
                ? {
                      sourceType: marker ? 'routine' : 'chore',
                      relation: row.timing_mode.startsWith('after_') ? 'after' : 'before',
                      routineKey: row.timing_marker_key,
                      sourceChoreId: row.timing_chore_id,
                      fallbackTime: minutesOf(row.timing_fallback_time),
                      event: row.timing_event,
                  }
                : null,
        },
    };
}

/**
 * @param db anything with `query(text, params)`
 * @param {(entity: string) => Array<Record<string, any>>} rowsOf the export's raw rows
 * @param timing shared-core's chore-timing module
 * @returns {{ checks: Array<{ name: string, compared: number, wrong: string[] }> }}
 */
export async function verifyImport(db, rowsOf, timing) {
    const checks = [];
    const check = (name) => {
        const entry = { name, compared: 0, wrong: [] };
        checks.push(entry);
        return (id, ok) => {
            entry.compared += 1;
            if (!ok) entry.wrong.push(String(id));
        };
    };
    // Every row comes back as JSON, so a day is `YYYY-MM-DD` and a time `HH:MM:SS` whatever the driver would make of them.
    const table = async (name) => (await db.query(`SELECT to_jsonb(t.*) AS row FROM ${name} AS t`)).rows.map((result) => result.row);

    // ---- Settings: the first row of each name, its value read as the app reads it today ----
    const settings = new Map((await table('settings')).map((row) => [row.name, row]));
    const firstByName = new Map();
    for (const row of rowsOf('settings')) if (row.name && !firstByName.has(row.name)) firstByName.set(row.name, row);
    const settingValue = check('settings: each setting holds the value it held');
    for (const [name, raw] of firstByName) {
        let expected = raw.value;
        try { expected = JSON.parse(raw.value); } catch { /* a bare word is its own value */ }
        if (expected == null) continue;
        settingValue(name, settings.has(name) && sameJson(settings.get(name).value, expected));
    }
    check('settings: no setting that was not there before')('count', settings.size <= firstByName.size);

    // ---- Units ----
    const units = new Map((await table('unit_definitions')).map((row) => [row.id, row]));
    const unit = check('unit_definitions: every unit, field by field');
    for (const raw of rowsOf('unitDefinitions')) {
        const row = units.get(raw.id);
        unit(raw.id, Boolean(row) && row.code === raw.code && row.name === raw.name && row.symbol === raw.symbol
            && (typeof raw.isMonetary !== 'boolean' || row.is_monetary === raw.isMonetary)
            && (row.symbol_placement ?? null) === (raw.symbolPlacement ?? null)
            && (row.symbol_spacing ?? null) === (raw.symbolSpacing ?? null)
            && (row.decimal_places ?? null) === (raw.decimalPlaces ?? null));
    }

    // ---- Family members ----
    const rawMembers = rowsOf('familyMembers');
    const members = new Map((await table('family_members')).map((row) => [row.id, row]));
    const member = check('family_members: every member, field by field');
    for (const raw of rawMembers) {
        const row = members.get(raw.id);
        // A value Instant never stored has nothing to be compared with; what it was given instead is in the import's report.
        member(raw.id, Boolean(row) && row.name === String(raw.name ?? '').trim() && (raw.role == null || row.role === raw.role)
            && (!Number.isInteger(raw.order) || row.sort_order === raw.order)
            && row.has_pin === Boolean(raw.pinHash) && (row.pin_hash ?? null) === (raw.pinHash || null)
            && (row.email ?? '') === (raw.email ?? '') && (row.color ?? null) === (raw.color || null)
            && sameJson(row.photo_urls ?? null, raw.photoUrls ?? null)
            && (row.allowance_amount ?? null) === (raw.allowanceAmount ?? null)
            && (row.allowance_currency ?? null) === (raw.allowanceCurrency || null)
            && (row.allowance_rrule ?? null) === (raw.allowanceRrule || null)
            && row.allowance_start_date === dayOf(raw.allowanceStartDate)
            && row.allowance_payout_delay_days === (raw.allowancePayoutDelayDays ?? 0)
            && sameJson(row.allowance_config ?? null, raw.allowanceConfig ?? null)
            && (row.last_display_currency ?? null) === (raw.lastDisplayCurrency || null)
            && (row.view_show_chore_descriptions ?? null) === (raw.viewShowChoreDescriptions ?? null)
            && (row.view_show_task_details ?? null) === (raw.viewShowTaskDetails ?? null)
            && (row.message_quiet_hours_enabled ?? null) === (raw.messageQuietHoursEnabled ?? null)
            && minutesOf(row.message_quiet_hours_start) === minutesOf(raw.messageQuietHoursStart)
            && minutesOf(row.message_quiet_hours_end) === minutesOf(raw.messageQuietHoursEnd)
            && (row.message_digest_mode ?? null) === (raw.messageDigestMode ?? null)
            && (row.message_digest_window_minutes ?? null) === (raw.messageDigestWindowMinutes ?? null));
    }
    check('family_members: as many as were exported')('count', members.size === rawMembers.length);

    // ---- Chores ----
    const rawChores = rowsOf('chores');
    const chores = new Map((await table('chores')).map((row) => [row.id, row]));
    const chore = check('chores: every chore, field by field');
    const choreTiming = check('chores: the app resolves the same timing from the new columns as from the old attributes');
    for (const raw of rawChores) {
        const row = chores.get(raw.id);
        chore(raw.id, Boolean(row) && row.title === String(raw.title ?? '').trim() && (row.description ?? '') === String(raw.description ?? '').trim()
            && row.start_date === dayOf(raw.startDate) && (row.rrule ?? null) === (raw.rrule || null)
            && sameJson(row.exdates, [...new Set(asList(raw.exdates).map(dayOf))].sort())
            && sameJson(row.pause_state ?? null, raw.pauseState ?? null)
            && row.rotation_type === raw.rotationType
            && row.is_joint === (raw.isJoint === true) && row.is_up_for_grabs === (raw.isUpForGrabs === true)
            && row.hide_from_day_list === (raw.hideFromDayList === true) && row.sort_order === (raw.sortOrder ?? 0)
            && (row.weight ?? null) === (raw.weight ?? null) && (row.reward_type ?? null) === (raw.rewardType ?? null)
            && (row.reward_amount ?? null) === (raw.rewardAmount ?? null) && (row.reward_currency ?? null) === (raw.rewardCurrency || null)
            && (row.estimated_duration_secs ?? null) === (raw.estimatedDurationSecs ?? null)
            && instantOf(row.created_at) === (instantOf(raw.createdAt) ?? instantOf(`${dayOf(raw.startDate)}T00:00:00.000Z`)));
        if (!row) { choreTiming(raw.id, false); continue; }
        const rebuilt = choreFromColumns(row);
        choreTiming(raw.id, timing.getChoreTimingMode(raw) === timing.getChoreTimingMode(rebuilt) && timing.getChoreTimingRuleKey(raw) === timing.getChoreTimingRuleKey(rebuilt));
    }
    check('chores: as many as were exported')('count', chores.size === rawChores.length);

    // ---- Who is assigned, read from whichever side of the link the export holds ----
    const assigneesOf = new Map(rawChores.map((raw) => [raw.id, new Set(asList(raw.assignees))]));
    for (const raw of rawMembers) for (const choreId of asList(raw.assignedChores)) assigneesOf.get(choreId)?.add(raw.id);
    const assignmentById = new Map(rowsOf('choreAssignments').map((raw) => [raw.id, raw]));
    const memberOfAssignment = new Map(rowsOf('choreAssignments').map((raw) => [raw.id, raw.familyMember]));
    for (const raw of rawMembers) for (const assignmentId of asList(raw.choreAssignments)) memberOfAssignment.set(assignmentId, raw.id);
    const rotationOf = new Map(rawChores.map((raw) => [raw.id, asList(raw.assignments)]));
    for (const raw of rowsOf('choreAssignments')) if (raw.chore) rotationOf.set(raw.chore, [...(rotationOf.get(raw.chore) ?? []), raw.id]);
    const assigneeRows = await table('chore_assignees');
    const assigned = check('chore_assignees: each chore is assigned to exactly the people it was');
    const rotation = check('chore_assignees: each rotation runs in the order it did');
    for (const raw of rawChores) {
        const rows = assigneeRows.filter((row) => row.chore_id === raw.id).sort((a, b) => a.position - b.position);
        const expected = assigneesOf.get(raw.id);
        assigned(raw.id, rows.length === expected.size && rows.every((row) => expected.has(row.family_member_id)));
        const order = [...new Set(rotationOf.get(raw.id))]
            .sort((a, b) => assignmentById.get(a).order - assignmentById.get(b).order || a.localeCompare(b))
            .map((assignmentId) => memberOfAssignment.get(assignmentId));
        if (order.length) rotation(raw.id, sameJson(rows.slice(0, order.length).map((row) => row.family_member_id), order));
    }

    // ---- Completions ----
    const rawCompletions = rowsOf('choreCompletions');
    const choreOf = new Map(rawCompletions.map((raw) => [raw.id, raw.chore ?? null]));
    for (const raw of rawChores) for (const completionId of asList(raw.completions)) choreOf.set(completionId, raw.id);
    const completerOf = new Map(rawCompletions.map((raw) => [raw.id, raw.completedBy ?? null]));
    for (const raw of rawMembers) for (const completionId of asList(raw.completedChores)) completerOf.set(completionId, raw.id);
    const markerOf = new Map(rawCompletions.map((raw) => [raw.id, raw.markedBy ?? null]));
    for (const raw of rawMembers) for (const completionId of asList(raw.markedCompletions)) markerOf.set(completionId, raw.id);

    const completions = new Map((await table('chore_completions')).map((row) => [row.id, row]));
    const whole = rawCompletions.filter((raw) => chores.has(choreOf.get(raw.id)) && members.has(completerOf.get(raw.id)) && dayOf(raw.dateDue));
    const slots = new Set(whole.map((raw) => `${choreOf.get(raw.id)}\n${completerOf.get(raw.id)}\n${dayOf(raw.dateDue)}`));
    check('chore_completions: one for each chore, person and day that had one')('count', completions.size === slots.size);
    const completion = check('chore_completions: every completion loaded, field by field');
    for (const raw of whole) {
        const row = completions.get(raw.id);
        if (!row) continue; // The one of several for the same chore, person and day that was not kept.
        const done = raw.completed === true;
        completion(raw.id, row.chore_id === choreOf.get(raw.id) && row.completed_by === completerOf.get(raw.id)
            && (row.marked_by ?? null) === (members.has(markerOf.get(raw.id)) ? markerOf.get(raw.id) : null)
            && row.date_due === dayOf(raw.dateDue) && (row.completed_at != null) === done
            && (!done || blank(raw.dateCompleted) || instantOf(row.completed_at) === instantOf(raw.dateCompleted))
            && row.not_done === (!done && raw.notDone === true) && row.allowance_awarded === (raw.allowanceAwarded === true));
    }
    check('chore_completions: none loaded that was not exported whole')('count', [...completions.keys()].every((id) => whole.some((raw) => raw.id === id)));
    // A second route to the same answer: how many chores each person has done, counted on each side.
    const doneBy = check('chore_completions: each person has done as many chores as before');
    for (const raw of rawMembers) {
        const before = new Set(whole.filter((item) => item.completed === true && completerOf.get(item.id) === raw.id).map((item) => `${choreOf.get(item.id)}\n${dayOf(item.dateDue)}`)).size;
        const after = [...completions.values()].filter((row) => row.completed_by === raw.id && row.completed_at != null).length;
        doneBy(raw.id, before === after);
    }

    return { checks };
}

async function main() {
    const root = process.cwd();
    const exportsRoot = path.join(root, '.migration', 'exports');
    const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(exportsRoot, readdirSync(exportsRoot).sort().at(-1));
    if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the Postgres database that was imported into.');

    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    let result;
    try {
        result = await verifyImport(client, (entity) => readEntity(exportDir, entity), await loadTimingResolver(root));
    } finally {
        await client.end();
    }
    console.log(`Verified against ${path.relative(root, exportDir)}`);
    let failed = 0;
    for (const { name, compared, wrong } of result.checks) {
        if (wrong.length) failed += 1;
        console.log(`  ${wrong.length ? 'FAIL' : 'ok  '}  ${name} (${compared} compared${wrong.length ? `, ${wrong.length} wrong: ${wrong.slice(0, 3).join(', ')}` : ''})`);
    }
    console.log(failed ? `\n${failed} check${failed === 1 ? '' : 's'} failed.` : '\nEvery check passed.');
    if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
