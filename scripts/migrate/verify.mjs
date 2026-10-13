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

export function readEntity(exportDir, entity) {
    const file = path.join(exportDir, 'entities', `${entity}.jsonl`);
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line).entity) : [];
}

/** The app's own reading of when a chore is due, bundled from shared-core so this check owes nothing to the mapping. */
export async function loadTimingResolver(root) {
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

    // ---- Routines, their steps, the day's markers, and countdown runs ----
    const rawRoutines = rowsOf('routines');
    const routines = new Map((await table('routines')).map((row) => [row.id, row]));
    const routine = check('routines: every routine, field by field');
    for (const raw of rawRoutines) {
        const row = routines.get(raw.id);
        routine(raw.id, Boolean(row) && row.name === String(raw.name ?? '').trim() && (row.on_step_overrun ?? null) === (raw.onStepOverrun ?? null)
            && row.sort_order === (raw.sortOrder ?? 0) && (blank(raw.createdAt) || instantOf(row.created_at) === instantOf(raw.createdAt)));
    }
    const rawSteps = rowsOf('routineSteps');
    const stepRoutine = new Map(rawSteps.map((raw) => [raw.id, raw.routine ?? null]));
    for (const raw of rawRoutines) for (const stepId of asList(raw.steps)) stepRoutine.set(stepId, raw.id);
    const stepChore = new Map(rawSteps.map((raw) => [raw.id, raw.chore ?? null]));
    for (const raw of rawChores) for (const stepId of asList(raw.routineSteps)) stepChore.set(stepId, raw.id);
    const stepRows = await table('routine_steps');
    const steps = check('routine_steps: each routine has its chores, in their order');
    for (const raw of rawRoutines) {
        const expected = rawSteps
            .filter((step) => stepRoutine.get(step.id) === raw.id && chores.has(stepChore.get(step.id)))
            .sort((a, b) => a.position - b.position || String(a.id).localeCompare(String(b.id)))
            .map((step) => stepChore.get(step.id));
        const got = stepRows.filter((row) => row.routine_id === raw.id).sort((a, b) => a.position - b.position).map((row) => row.chore_id);
        steps(raw.id, sameJson(got, [...new Set(expected)]));
    }

    const markerRows = new Map((await table('routine_marker_statuses')).map((row) => [`${row.day}\n${row.marker_key}`, row]));
    const marker = check('routine_marker_statuses: every marker on every day, field by field');
    const markersSeen = new Set();
    for (const raw of rowsOf('routineMarkerStatuses')) {
        const key = `${dayOf(raw.date)}\n${String(raw.markerKey ?? '').trim().toLowerCase()}`;
        if (markersSeen.has(key)) continue; // A second row for the same marker and day is held back.
        markersSeen.add(key);
        const row = markerRows.get(key);
        marker(raw.id, Boolean(row) && instantOf(row.started_at) === instantOf(raw.startedAt) && instantOf(row.completed_at) === instantOf(raw.completedAt)
            && (row.started_by ?? null) === (members.has(raw.startedById) ? raw.startedById : null)
            && (row.completed_by ?? null) === (members.has(raw.completedById) ? raw.completedById : null));
    }
    check('routine_marker_statuses: one for each marker and day that had one')('count', markerRows.size === markersSeen.size);

    const runs = new Map((await table('countdown_runs')).map((row) => [row.id, row]));
    const run = check('countdown_runs: every run loaded, field by field');
    for (const raw of rowsOf('countdownRuns')) {
        const row = runs.get(raw.id);
        if (!row) continue; // Held back: nobody's, or a second run for one person and day.
        run(raw.id, row.family_member_id === raw.familyMemberId && row.day === dayOf(raw.date) && row.status === raw.status
            && instantOf(row.started_at) === instantOf(raw.startedAt) && instantOf(row.stopped_at) === instantOf(raw.stoppedAt)
            && (row.stopped_reason ?? null) === (raw.stoppedReason || null) && (row.step_extension_secs ?? 0) === (raw.stepExtensionSecs ?? 0));
    }
    const runSlots = new Set(rowsOf('countdownRuns').filter((raw) => members.has(raw.familyMemberId) && dayOf(raw.date) && !blank(raw.startedAt)).map((raw) => `${raw.familyMemberId}\n${dayOf(raw.date)}`));
    check('countdown_runs: one for each person and day that had one')('count', runs.size === runSlots.size);

    // ---- History ----
    const rawEvents = rowsOf('historyEvents');
    const events = new Map((await table('history_events')).map((row) => [row.id, row]));
    const actedBy = new Map();
    for (const raw of rawMembers) for (const eventId of asList(raw.actedHistoryEvents)) actedBy.set(eventId, raw.id);
    const event = check('history_events: every event, field by field');
    for (const raw of rawEvents) {
        const row = events.get(raw.id);
        const actor = raw.actorFamilyMemberId || raw.actor || actedBy.get(raw.id) || null;
        event(raw.id, Boolean(row) && instantOf(row.occurred_at) === instantOf(raw.occurredAt) && row.domain === raw.domain
            && row.action_type === raw.actionType && row.summary === raw.summary && (row.source ?? null) === (raw.source || null)
            && (row.actor_id ?? null) === (members.has(actor) ? actor : null)
            && (row.chore_id ?? null) === (raw.choreId || null) && (row.task_series_id ?? null) === (raw.taskSeriesId || null)
            && (row.task_id ?? null) === (raw.taskId || null) && (row.calendar_item_id ?? null) === (raw.calendarItemId || null)
            && (row.allowance_transaction_id ?? null) === (raw.allowanceTransactionId || null)
            && (row.message_thread_id ?? null) === (raw.messageThreadId || null) && (row.message_id ?? null) === (raw.messageId || null)
            && row.scheduled_for === dayOf(raw.scheduledForDate) && (row.restore_timing ?? null) === (raw.restoreTiming || null)
            && sameJson(row.metadata, raw.metadata ?? {}));
    }
    check('history_events: as many as were exported')('count', events.size === rawEvents.length);

    const affectedBefore = new Map(rawEvents.map((raw) => [raw.id, new Set(asList(raw.affectedFamilyMembers))]));
    for (const raw of rawMembers) for (const eventId of asList(raw.affectedHistoryEvents)) affectedBefore.get(eventId)?.add(raw.id);
    const affectedAfter = new Map();
    for (const row of await table('history_event_members')) affectedAfter.set(row.history_event_id, [...(affectedAfter.get(row.history_event_id) ?? []), row.family_member_id]);
    const affected = check('history_event_members: each event affected exactly the people it did');
    for (const raw of rawEvents) {
        const expected = [...affectedBefore.get(raw.id)].filter((memberId) => members.has(memberId));
        const got = affectedAfter.get(raw.id) ?? [];
        affected(raw.id, got.length === expected.length && got.every((memberId) => expected.includes(memberId)));
    }

    // ---- Task series ----
    // Which row a link joins is read from both of the sides an export may hold it on.
    const linked = (ownerRows, ownerLabel, childRows, childLabel) => {
        const found = new Map();
        for (const raw of childRows) for (const ownerId of asList(raw[childLabel])) found.set(raw.id, ownerId);
        for (const raw of ownerRows) for (const childId of asList(raw[ownerLabel])) found.set(childId, raw.id);
        return found;
    };
    const same = (left, right) => (left ?? null) === (right ?? null);
    const textOf = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    // A day held as the instant of a midnight somewhere: the nearest midnight in UTC is the day that was meant.
    const nearestDay = (value) => (blank(value) ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value : new Date(Math.round(new Date(value).getTime() / 86_400_000) * 86_400_000).toISOString().slice(0, 10));
    const STATES = ['not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done'];
    // What the app takes a task's state to be: the state it stores, or failing that whether it was ticked.
    const stateOf = (raw) => (STATES.includes(raw.workflowState) ? raw.workflowState : raw.isCompleted ? 'done' : 'not_started');

    const rawGrades = rowsOf('gradeTypes');
    const grades = new Map((await table('grade_types')).map((row) => [row.id, row]));
    const grade = check('grade_types: every scale, field by field');
    for (const raw of rawGrades) {
        const row = grades.get(raw.id);
        grade(raw.id, Boolean(row) && row.name === String(raw.name ?? '').trim() && row.kind === raw.kind && row.low_value === raw.lowValue && row.high_value === raw.highValue
            && row.low_label === (raw.lowLabel ?? '') && row.high_label === (raw.highLabel ?? '') && sameJson(row.steps ?? null, raw.steps ?? null)
            && row.sort_order === (raw.order ?? 0) && instantOf(row.created_at) === instantOf(raw.createdAt));
    }
    check('grade_types: as many as were exported, and one default if there was one')('count',
        grades.size === rawGrades.length && [...grades.values()].filter((row) => row.is_default).length === Math.min(1, rawGrades.filter((raw) => raw.isDefault === true).length));

    const rawSeries = rowsOf('taskSeries');
    const rawTasks = rowsOf('tasks');
    const seriesRows = new Map((await table('task_series')).map((row) => [row.id, row]));
    const seriesMember = linked(rawMembers, 'taskSeries', rawSeries, 'familyMember');
    const seriesChore = linked(rawChores, 'taskSeries', rawSeries, 'scheduledActivity');
    const series = check('task_series: every series, field by field');
    for (const raw of rawSeries) {
        const row = seriesRows.get(raw.id);
        series(raw.id, Boolean(row) && row.name === String(raw.name ?? '').trim() && same(row.description, textOf(raw.description))
            && same(row.family_member_id, members.has(seriesMember.get(raw.id)) ? seriesMember.get(raw.id) : null)
            && same(row.chore_id, chores.has(seriesChore.get(raw.id)) ? seriesChore.get(raw.id) : null)
            && same(row.depends_on_series_id, rawSeries.some((other) => other.id === raw.dependsOnSeriesId) ? raw.dependsOnSeriesId : null)
            && same(row.start_date, nearestDay(raw.startDate)) && same(row.target_end_date, nearestDay(raw.targetEndDate))
            && same(row.planned_end_date, nearestDay(raw.plannedEndDate)) && same(row.break_start_date, nearestDay(raw.breakStartDate))
            && same(row.baseline_day_break_count, raw.baselineDayBreakCount) && row.work_ahead_allowed === (raw.workAheadAllowed === true)
            && row.pull_forward_count === (raw.pullForwardCount ?? 0) && same(row.break_type, textOf(raw.breakType))
            && same(row.break_delay_value, raw.breakDelayValue) && same(row.break_delay_unit, textOf(raw.breakDelayUnit)));
    }
    check('task_series: as many as were exported')('count', seriesRows.size === rawSeries.length);

    const taskSeriesOf = linked(rawSeries, 'tasks', rawTasks, 'taskSeries');
    const wholeTasks = rawTasks.filter((raw) => seriesRows.has(taskSeriesOf.get(raw.id)));
    const taskRows = new Map((await table('tasks')).map((row) => [row.id, row]));
    const parentOf = linked(rawTasks, 'subTasks', rawTasks, 'parentTask');
    const task = check('tasks: every task of a series, field by field');
    for (const raw of wholeTasks) {
        const row = taskRows.get(raw.id);
        task(raw.id, Boolean(row) && row.task_series_id === taskSeriesOf.get(raw.id) && row.title === (raw.text ?? '') && same(row.notes, textOf(raw.notes))
            && row.indentation_level === (raw.indentationLevel ?? 0) && row.is_day_break === (raw.isDayBreak === true) && same(row.weight, raw.weight)
            && same(minutesOf(row.specific_time), textOf(raw.specificTime)) && same(row.override_work_ahead, raw.overrideWorkAhead)
            && row.child_tasks_complete === (raw.childTasksComplete !== false) && instantOf(row.completed_at) === instantOf(raw.completedAt)
            && same(row.completed_on, dayOf(raw.completedOnDate)) && same(row.deferred_until, dayOf(raw.deferredUntilDate))
            && same(row.noted_until, dayOf(raw.notedUntilDate)) && row.is_noted_indefinitely === (raw.isNotedIndefinitely === true)
            && instantOf(row.updated_at) === instantOf(raw.updatedAt ?? raw.createdAt ?? 0));
    }
    check('tasks: none loaded but those of a series that was exported')('count', taskRows.size === wholeTasks.length);
    const taskState = check('tasks: the app reads the same state for each task, and the same place to return to');
    for (const raw of wholeTasks) {
        const row = taskRows.get(raw.id);
        const lastActive = ['not_started', 'in_progress'].includes(raw.lastActiveState) ? raw.lastActiveState : stateOf(raw) === 'in_progress' ? 'in_progress' : 'not_started';
        taskState(raw.id, Boolean(row) && row.workflow_state === stateOf(raw) && row.last_active_state === lastActive);
    }
    const taskOrder = check('tasks: each series has its tasks in their order, each under the parent it had');
    for (const raw of rawSeries) {
        const expected = wholeTasks.filter((item) => taskSeriesOf.get(item.id) === raw.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)));
        const got = [...taskRows.values()].filter((row) => row.task_series_id === raw.id).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
        taskOrder(raw.id, sameJson(got.map((row) => [row.id, row.parent_task_id ?? null]), expected.map((item) => [item.id, taskRows.has(parentOf.get(item.id)) ? parentOf.get(item.id) : null])));
    }

    // An attachment table: every file of an owner that was carried, and none besides.
    const attachmentsOf = async (name, ownerColumn, rawRows, ownerOf, owners) => {
        const rows = new Map((await table(name)).map((row) => [row.id, row]));
        const whole = rawRows.filter((raw) => owners.has(ownerOf.get(raw.id)));
        const each = check(`${name}: every file, field by field`);
        for (const raw of whole) {
            const row = rows.get(raw.id);
            each(raw.id, Boolean(row) && row[ownerColumn] === ownerOf.get(raw.id) && row.name === String(raw.name ?? '').trim() && row.type === raw.type && row.url === raw.url
                && same(row.kind, textOf(raw.kind)) && same(row.size_bytes, raw.sizeBytes) && same(row.width, raw.width) && same(row.height, raw.height)
                && same(row.duration_sec, raw.durationSec) && same(row.thumbnail_url, textOf(raw.thumbnailUrl)) && same(row.thumbnail_width, raw.thumbnailWidth)
                && same(row.thumbnail_height, raw.thumbnailHeight) && same(row.blurhash, textOf(raw.blurhash)) && sameJson(row.waveform_peaks ?? null, raw.waveformPeaks ?? null)
                && instantOf(row.created_at) === instantOf(raw.createdAt));
        }
        check(`${name}: none loaded but those whose owner was`)('count', rows.size === whole.length);
    };
    const rawTaskFiles = rowsOf('taskAttachments');
    await attachmentsOf('task_attachments', 'task_id', rawTaskFiles, linked(rawTasks, 'attachments', rawTaskFiles, 'task'), taskRows);

    const rawFields = rowsOf('taskResponseFields');
    const fieldTask = linked(rawTasks, 'responseFields', rawFields, 'task');
    const wholeFields = rawFields.filter((raw) => taskRows.has(fieldTask.get(raw.id)));
    const fieldRows = new Map((await table('task_response_fields')).map((row) => [row.id, row]));
    const field = check('task_response_fields: every field of a task, field by field');
    for (const raw of wholeFields) {
        const row = fieldRows.get(raw.id);
        field(raw.id, Boolean(row) && row.task_id === fieldTask.get(raw.id) && row.type === raw.type && row.label === (raw.label ?? '') && same(row.description, textOf(raw.description))
            && row.weight === (raw.weight ?? 0) && row.required === (raw.required === true) && row.sort_order === (raw.order ?? 0));
    }
    check('task_response_fields: none loaded but those whose task was')('count', fieldRows.size === wholeFields.length);

    const rawUpdates = rowsOf('taskUpdates');
    const updateTask = linked(rawTasks, 'updates', rawUpdates, 'task');
    const wholeUpdates = rawUpdates.filter((raw) => taskRows.has(updateTask.get(raw.id)));
    const updateRows = new Map((await table('task_updates')).map((row) => [row.id, row]));
    const updateActor = linked(rawMembers, 'actedTaskUpdates', rawUpdates, 'actor');
    const updateAffected = linked(rawMembers, 'affectedTaskUpdates', rawUpdates, 'affectedPerson');
    const updateReply = linked([], '', rawUpdates, 'replyTo');
    for (const raw of rawUpdates) for (const replyId of asList(raw.replies)) updateReply.set(replyId, raw.id);
    const updateGrade = linked(rawGrades, 'taskUpdates', rawUpdates, 'gradeType');
    const update = check('task_updates: every update of a task, field by field');
    for (const raw of wholeUpdates) {
        const row = updateRows.get(raw.id);
        update(raw.id, Boolean(row) && row.task_id === updateTask.get(raw.id) && row.from_state === raw.fromState && row.to_state === raw.toState
            && same(row.note, textOf(raw.note)) && row.is_draft === (raw.isDraft === true) && row.scheduled_for === dayOf(raw.scheduledForDate)
            && same(row.restore_timing, raw.restoreTiming) && same(row.grade_numeric_value, raw.gradeNumericValue) && same(row.grade_display_value, textOf(raw.gradeDisplayValue))
            && same(row.grade_is_provisional, raw.gradeIsProvisional) && instantOf(row.created_at) === instantOf(raw.createdAt)
            && same(row.actor_id, members.has(updateActor.get(raw.id)) ? updateActor.get(raw.id) : null)
            && same(row.affected_person_id, members.has(updateAffected.get(raw.id)) ? updateAffected.get(raw.id) : null)
            && same(row.reply_to_id, updateRows.has(updateReply.get(raw.id)) ? updateReply.get(raw.id) : null)
            && same(row.grade_type_id, grades.has(updateGrade.get(raw.id)) ? updateGrade.get(raw.id) : null));
    }
    check('task_updates: none loaded but those whose task was')('count', updateRows.size === wholeUpdates.length);
    const updatesPerTask = check('task_updates: each task has as many updates as before');
    for (const raw of wholeTasks) {
        updatesPerTask(raw.id, wholeUpdates.filter((item) => updateTask.get(item.id) === raw.id).length === [...updateRows.values()].filter((row) => row.task_id === raw.id).length);
    }

    const rawUpdateFiles = rowsOf('taskUpdateAttachments');
    await attachmentsOf('task_update_attachments', 'update_id', rawUpdateFiles, linked(rawUpdates, 'attachments', rawUpdateFiles, 'update'), updateRows);

    const rawValues = rowsOf('taskResponseFieldValues');
    const valueUpdate = linked(rawUpdates, 'responseFieldValues', rawValues, 'update');
    const valueField = linked(rawFields, 'values', rawValues, 'field');
    const wholeValues = rawValues.filter((raw) => updateRows.has(valueUpdate.get(raw.id)) && fieldRows.has(valueField.get(raw.id)));
    const valueRows = new Map((await table('task_response_field_values')).map((row) => [row.id, row]));
    const answers = new Set(wholeValues.map((raw) => `${valueUpdate.get(raw.id)}\n${valueField.get(raw.id)}`));
    const value = check('task_response_field_values: every answer loaded, field by field');
    for (const row of valueRows.values()) {
        const raw = wholeValues.find((item) => item.id === row.id);
        value(row.id, Boolean(raw) && row.update_id === valueUpdate.get(raw.id) && row.field_id === valueField.get(raw.id) && same(row.rich_text_content, raw.richTextContent)
            && same(row.file_url, textOf(raw.fileUrl)) && same(row.file_name, textOf(raw.fileName)) && same(row.file_type, textOf(raw.fileType))
            && same(row.file_size_bytes, raw.fileSizeBytes) && same(row.thumbnail_url, textOf(raw.thumbnailUrl)) && instantOf(row.created_at) === instantOf(raw.createdAt));
    }
    check('task_response_field_values: one for each field answered with each update')('count', valueRows.size === answers.size);

    // ---- Money ----
    // Amounts are compared as the numbers they are, with no rounding: nothing in the move should change one.
    const rawEnvelopes = rowsOf('allowanceEnvelopes');
    const rawLedger = rowsOf('allowanceTransactions');
    const envelopeRows = new Map((await table('allowance_envelopes')).map((row) => [row.id, row]));
    const envelopeOwner = linked(rawMembers, 'allowanceEnvelopes', rawEnvelopes, 'familyMember');
    const envelope = check('allowance_envelopes: every envelope, field by field, with its owner');
    for (const raw of rawEnvelopes) {
        const row = envelopeRows.get(raw.id);
        envelope(raw.id, Boolean(row) && row.name === String(raw.name ?? '').trim() && same(row.description, textOf(raw.description)) && same(row.goal_amount, raw.goalAmount)
            && same(row.goal_currency, textOf(raw.goalCurrency)) && instantOf(row.archived_at) === instantOf(raw.archivedAt)
            && same(row.family_member_id, members.has(envelopeOwner.get(raw.id)) ? envelopeOwner.get(raw.id) : null));
    }
    check('allowance_envelopes: as many as were exported')('count', envelopeRows.size === rawEnvelopes.length);

    const balanceRows = await table('envelope_balances');
    const balance = check('envelope_balances: each envelope holds exactly what it held, currency by currency');
    for (const raw of rawEnvelopes) {
        const before = Object.fromEntries(Object.entries(raw.balances ?? {}).filter(([, amount]) => typeof amount === 'number'));
        const after = Object.fromEntries(balanceRows.filter((row) => row.envelope_id === raw.id).map((row) => [row.currency, row.amount]));
        balance(raw.id, sameJson(before, after));
    }
    check('envelope_balances: none for an envelope that was not exported')('count', balanceRows.every((row) => rawEnvelopes.some((raw) => raw.id === row.envelope_id)));

    const ledgerRows = new Map((await table('allowance_transactions')).map((row) => [row.id, row]));
    const ledgerEnvelope = linked(rawEnvelopes, 'transactions', rawLedger, 'envelope');
    const ledgerSource = linked(rawEnvelopes, 'outgoingTransfers', rawLedger, 'sourceEnvelope');
    const ledgerDestination = linked(rawEnvelopes, 'incomingTransfers', rawLedger, 'destinationEnvelope');
    const entry = check('allowance_transactions: every ledger row, field by field');
    for (const raw of rawLedger) {
        const row = ledgerRows.get(raw.id);
        entry(raw.id, Boolean(row) && row.envelope_id === ledgerEnvelope.get(raw.id) && same(row.source_envelope_id, ledgerSource.get(raw.id)) && same(row.destination_envelope_id, ledgerDestination.get(raw.id))
            && row.transaction_type === raw.transactionType && row.amount === raw.amount && row.currency === raw.currency && row.description === (raw.description ?? '')
            && same(row.created_by, members.has(raw.createdByFamilyMemberId) ? raw.createdByFamilyMemberId : null) && same(row.distribution_key, textOf(raw.distributionKey))
            && instantOf(row.created_at) === instantOf(raw.createdAt));
    }
    check('allowance_transactions: as many as were exported')('count', ledgerRows.size === rawLedger.length);

    // Each envelope's ledger, added up, against what the envelope says it holds: the same envelopes agree, and the
    // same disagree, as before the move. Summed in the order the rows were written, so both sides add alike.
    const sumLedger = (rows, envelopeId, amountOf, currencyOf, whenOf, idOf, envelopeOf) => {
        const totals = {};
        const own = rows.filter((row) => envelopeOf(row) === envelopeId).sort((a, b) => whenOf(a) - whenOf(b) || String(idOf(a)).localeCompare(String(idOf(b))));
        for (const row of own) totals[currencyOf(row)] = (totals[currencyOf(row)] ?? 0) + amountOf(row);
        return totals;
    };
    const agrees = (totals, held) => [...new Set([...Object.keys(totals), ...Object.keys(held)])].every((currency) => Math.abs((totals[currency] ?? 0) - (held[currency] ?? 0)) < 1e-9);
    const reconciled = check('money: each envelope agrees with its ledger exactly where it did before');
    const totalsMatch = check('money: each envelope\'s ledger adds up to the same amount in every currency');
    for (const raw of rawEnvelopes) {
        const before = sumLedger(rawLedger, raw.id, (row) => row.amount, (row) => row.currency, (row) => instantOf(row.createdAt), (row) => row.id, (row) => ledgerEnvelope.get(row.id));
        const after = sumLedger([...ledgerRows.values()], raw.id, (row) => row.amount, (row) => row.currency, (row) => instantOf(row.created_at), (row) => row.id, (row) => row.envelope_id);
        const heldAfter = Object.fromEntries(balanceRows.filter((row) => row.envelope_id === raw.id).map((row) => [row.currency, row.amount]));
        totalsMatch(raw.id, sameJson(before, after));
        reconciled(raw.id, agrees(before, raw.balances ?? {}) === agrees(after, heldAfter));
    }
    const perMember = check('money: each member has as many ledger rows, and the same total held in each currency');
    for (const raw of rawMembers) {
        const mine = rawEnvelopes.filter((item) => envelopeOwner.get(item.id) === raw.id);
        const heldBefore = {};
        for (const item of mine) for (const [currency, amount] of Object.entries(item.balances ?? {})) heldBefore[currency] = (heldBefore[currency] ?? 0) + amount;
        const heldAfter = {};
        const mineAfter = [...envelopeRows.values()].filter((row) => row.family_member_id === raw.id).sort((a, b) => mine.findIndex((item) => item.id === a.id) - mine.findIndex((item) => item.id === b.id));
        for (const row of mineAfter) for (const held of balanceRows.filter((item) => item.envelope_id === row.id)) heldAfter[held.currency] = (heldAfter[held.currency] ?? 0) + held.amount;
        const rowsBefore = rawLedger.filter((item) => mine.some((mineEnvelope) => mineEnvelope.id === ledgerEnvelope.get(item.id))).length;
        const rowsAfter = [...ledgerRows.values()].filter((row) => mineAfter.some((mineEnvelope) => mineEnvelope.id === row.envelope_id)).length;
        perMember(raw.id, rowsBefore === rowsAfter && agrees(heldBefore, heldAfter) && Object.keys(heldBefore).length === Object.keys(heldAfter).length);
    }
    const defaults = check('family_members: each member\'s default envelope is one of theirs that was marked so, if any was');
    for (const raw of rawMembers) {
        const marked = rawEnvelopes.filter((item) => envelopeOwner.get(item.id) === raw.id && item.isDefault === true && blank(item.archivedAt)).map((item) => item.id);
        const chosen = members.get(raw.id)?.default_envelope_id ?? null;
        defaults(raw.id, marked.length ? marked.includes(chosen) : chosen === null);
    }

    const rateRows = await table('exchange_rates');
    const rawRates = rowsOf('exchangeRates');
    const rate = check('exchange_rates: the last rate fetched for each pair of currencies');
    const pairsSeen = new Set(rawRates.map((raw) => `${raw.baseCurrency}\n${raw.targetCurrency}`));
    for (const key of pairsSeen) {
        const [base, target] = key.split('\n');
        const latest = rawRates.filter((raw) => raw.baseCurrency === base && raw.targetCurrency === target).sort((a, b) => instantOf(b.lastFetchedTimestamp) - instantOf(a.lastFetchedTimestamp))[0];
        const row = rateRows.find((item) => item.base_currency === base && item.target_currency === target);
        rate(key.replace('\n', '→'), Boolean(row) && row.rate === latest.rate && instantOf(row.fetched_at) === instantOf(latest.lastFetchedTimestamp));
    }
    check('exchange_rates: one for each pair that had one')('count', rateRows.length === pairsSeen.size);

    // ---- What the family posts, the dashboards, and the files on a history entry ----
    const memberOrNone = (id) => (members.has(id) ? id : null);
    const rawAnnouncements = rowsOf('announcements');
    const announcementRows = new Map((await table('announcements')).map((row) => [row.id, row]));
    const announcement = check('announcements: every announcement, field by field, showing exactly if it was');
    for (const raw of rawAnnouncements) {
        const row = announcementRows.get(raw.id);
        announcement(raw.id, Boolean(row) && row.title === String(raw.title ?? '').trim() && same(row.rich_text_content, textOf(raw.richTextContent)) && same(row.link_url, textOf(raw.linkUrl))
            && same(row.created_by, memberOrNone(raw.createdByFamilyMemberId)) && instantOf(row.expires_at) === instantOf(raw.expiresAt) && instantOf(row.created_at) === instantOf(raw.createdAt)
            && (row.archived_at === null) === (raw.isActive === true) && (blank(raw.archivedAt) || raw.isActive === true || instantOf(row.archived_at) === instantOf(raw.archivedAt)));
    }
    check('announcements: as many as were exported')('count', announcementRows.size === rawAnnouncements.length);

    const rawCategories = rowsOf('contentCategories');
    const rawItems = rowsOf('contentQueueItems');
    const categoryRows = new Map((await table('content_categories')).map((row) => [row.id, row]));
    const category = check('content_categories: every category, field by field');
    for (const raw of rawCategories) {
        const row = categoryRows.get(raw.id);
        category(raw.id, Boolean(row) && row.slug === raw.slug && row.name === String(raw.name ?? '').trim() && row.default_duration_ms === raw.defaultDurationMs && row.loop_when_empty === (raw.loopWhenEmpty === true));
    }
    const itemCategory = linked(rawCategories, 'items', rawItems, 'category');
    const itemMaker = linked(rawMembers, 'createdContentQueueItems', rawItems, 'createdBy');
    const itemRows = new Map((await table('content_queue_items')).map((row) => [row.id, row]));
    const wholeItems = rawItems.filter((raw) => categoryRows.has(itemCategory.get(raw.id)));
    const item = check('content_queue_items: every item of a category, field by field');
    for (const raw of wholeItems) {
        const row = itemRows.get(raw.id);
        item(raw.id, Boolean(row) && row.category_id === itemCategory.get(raw.id) && row.title === String(raw.title ?? '').trim() && same(row.rich_text_content, textOf(raw.richTextContent))
            && same(row.link_url, textOf(raw.linkUrl)) && row.status === raw.status && row.sort_order === (raw.sortOrder ?? 0) && same(row.duration_ms, raw.durationMs)
            && instantOf(row.live_at) === instantOf(raw.liveAt) && instantOf(row.live_until) === instantOf(raw.liveUntil) && instantOf(row.archived_at) === instantOf(raw.archivedAt)
            && same(row.created_by, memberOrNone(itemMaker.get(raw.id))));
    }
    check('content: as many categories and items as were exported whole')('count', categoryRows.size === rawCategories.length && itemRows.size === wholeItems.length);

    const rawRules = rowsOf('familyRules');
    const rawVersions = rowsOf('familyRuleVersions');
    const versionRule = linked(rawRules, 'versions', rawVersions, 'rule');
    const versionPrevious = linked([], '', rawVersions, 'previousVersion');
    const ruleRows = new Map((await table('family_rules')).map((row) => [row.id, row]));
    const versionRows = new Map((await table('family_rule_versions')).map((row) => [row.id, row]));
    const rule = check('family_rules: every rule, field by field, reading as the version it did');
    for (const raw of rawRules) {
        const row = ruleRows.get(raw.id);
        const own = rawVersions.filter((version) => versionRule.get(version.id) === raw.id);
        rule(raw.id, Boolean(row) && row.title === String(raw.title ?? '').trim() && row.sort_order === (raw.sortOrder ?? 0) && row.is_archived === (raw.isArchived === true)
            && (own.some((version) => version.id === raw.activeVersionId) ? row.active_version_id === raw.activeVersionId : own.some((version) => version.id === row.active_version_id)));
    }
    const version = check('family_rule_versions: every version of a rule, word for word, in its place');
    for (const raw of rawVersions.filter((item) => ruleRows.has(versionRule.get(item.id)))) {
        const row = versionRows.get(raw.id);
        version(raw.id, Boolean(row) && row.rule_id === versionRule.get(raw.id) && row.version_number === raw.versionNumber && row.rich_text_content === (raw.richTextContent ?? '')
            && same(row.edit_note, textOf(raw.editNote)) && same(row.created_by, memberOrNone(raw.createdByFamilyMemberId)) && instantOf(row.created_at) === instantOf(raw.createdAt)
            && same(row.previous_version_id, versionRows.has(versionPrevious.get(raw.id)) && versionRule.get(versionPrevious.get(raw.id)) === versionRule.get(raw.id) ? versionPrevious.get(raw.id) : null));
    }
    check('family_rules: as many rules as were exported, and the versions of each')('count', ruleRows.size === rawRules.length && versionRows.size === rawVersions.filter((item) => ruleRows.has(versionRule.get(item.id))).length);

    // A file on one of three things. Which one it is on is read from whichever side holds the link.
    const rawContentFiles = rowsOf('contentAttachments');
    const fileOwners = [
        ['announcement_id', linked(rawAnnouncements, 'attachments', rawContentFiles, 'announcement'), announcementRows],
        ['queue_item_id', linked(rawItems, 'attachments', rawContentFiles, 'contentQueueItem'), itemRows],
        ['rule_version_id', linked(rawVersions, 'attachments', rawContentFiles, 'familyRuleVersion'), versionRows],
    ];
    const contentFileRows = new Map((await table('content_attachments')).map((row) => [row.id, row]));
    const wholeContentFiles = rawContentFiles.filter((raw) => fileOwners.filter(([, ownerOf, owners]) => owners.has(ownerOf.get(raw.id))).length === 1);
    const contentFile = check('content_attachments: every file, on the one thing it was on');
    for (const raw of wholeContentFiles) {
        const row = contentFileRows.get(raw.id);
        contentFile(raw.id, Boolean(row) && row.url === raw.url && row.name === String(raw.name ?? '').trim() && row.type === raw.type
            && fileOwners.every(([column, ownerOf, owners]) => same(row[column], owners.has(ownerOf.get(raw.id)) ? ownerOf.get(raw.id) : null)));
    }
    check('content_attachments: none loaded but those on something that was')('count', contentFileRows.size === wholeContentFiles.length);

    const rawLayouts = rowsOf('familyDashboardLayouts');
    const rawWidgets = rowsOf('familyDashboardWidgets');
    const layoutRows = new Map((await table('family_dashboard_layouts')).map((row) => [row.id, row]));
    const layout = check('family_dashboard_layouts: every layout, field by field');
    for (const raw of rawLayouts) {
        const row = layoutRows.get(raw.id);
        layout(raw.id, Boolean(row) && row.breakpoint_key === raw.breakpointKey && row.label === String(raw.label ?? '').trim() && row.min_width === raw.minWidth && row.max_width === raw.maxWidth
            && row.sort_order === (raw.order ?? 0) && row.is_default === (raw.isDefault === true));
    }
    const widgetLayout = linked(rawLayouts, 'widgets', rawWidgets, 'layout');
    const widgetRows = new Map((await table('family_dashboard_widgets')).map((row) => [row.id, row]));
    const wholeWidgets = rawWidgets.filter((raw) => layoutRows.has(widgetLayout.get(raw.id)));
    const widget = check('family_dashboard_widgets: every widget, where it sat, with its settings');
    for (const raw of wholeWidgets) {
        const row = widgetRows.get(raw.id);
        widget(raw.id, Boolean(row) && row.layout_id === widgetLayout.get(raw.id) && row.widget_type === raw.widgetType && row.x === raw.x && row.y === raw.y && row.w === raw.w && row.h === raw.h
            && row.z === (raw.z ?? 0) && sameJson(row.config ?? null, raw.config ?? null));
    }
    check('dashboards: as many layouts and widgets as were exported whole')('count', layoutRows.size === rawLayouts.length && widgetRows.size === wholeWidgets.length);

    const rawConfigs = rowsOf('dashboardConfigs');
    const configMember = linked(rawMembers, 'dashboardConfig', rawConfigs, 'familyMember');
    const configRows = new Map((await table('dashboard_configs')).map((row) => [row.family_member_id, row]));
    const config = check('dashboard_configs: each person\'s own arrangement, as they last left it');
    for (const memberId of new Set(rawConfigs.map((raw) => configMember.get(raw.id)).filter((id) => members.has(id)))) {
        const latest = rawConfigs.filter((raw) => configMember.get(raw.id) === memberId).sort((a, b) => (instantOf(b.updatedAt) ?? 0) - (instantOf(a.updatedAt) ?? 0))[0];
        const row = configRows.get(memberId);
        config(memberId, Boolean(row) && sameJson(row.widget_order ?? null, latest.widgetOrder ?? null) && sameJson(row.disabled_widgets ?? null, latest.disabledWidgets ?? null)
            && sameJson(row.widget_settings ?? null, latest.widgetSettings ?? null));
    }
    check('dashboard_configs: one for each person who had one')('count', configRows.size === new Set(rawConfigs.map((raw) => configMember.get(raw.id)).filter((id) => members.has(id))).size);

    const rawEventFiles = rowsOf('historyEventAttachments');
    await attachmentsOf('history_event_attachments', 'history_event_id', rawEventFiles, linked(rawEvents, 'attachments', rawEventFiles, 'event'), events);

    // ---- Messages ----
    // A reference Instant held twice, as an attribute and as a link, is read here from the link alone where there
    // is one, so that this check does not lean on the same copy the import preferred.
    const rawThreads = rowsOf('messageThreads');
    const rawMessages = rowsOf('messages');
    const rawSeats = rowsOf('messageThreadMembers');
    const threadRows = new Map((await table('message_threads')).map((row) => [row.id, row]));
    const thread = check('message_threads: every thread, field by field');
    for (const raw of rawThreads) {
        const row = threadRows.get(raw.id);
        thread(raw.id, Boolean(row) && row.thread_type === raw.threadType && row.visibility === raw.visibility && row.thread_key === raw.threadKey && row.title === raw.title
            && same(row.linked_domain, raw.linkedDomain) && same(row.linked_entity_id, textOf(raw.linkedEntityId)) && row.is_closed === (raw.isClosed === true)
            && same(row.created_by, memberOrNone(raw.createdByFamilyMemberId)) && instantOf(row.latest_message_at) === instantOf(raw.latestMessageAt)
            && same(row.latest_message_author_id, memberOrNone(raw.latestMessageAuthorId)) && same(row.latest_message_preview, raw.latestMessagePreview) && instantOf(row.created_at) === instantOf(raw.createdAt));
    }
    check('message_threads: as many as were exported')('count', threadRows.size === rawThreads.length);

    const messageThread = linked(rawThreads, 'messages', rawMessages, 'thread');
    const messageAuthor = linked(rawMembers, 'authoredMessages', rawMessages, 'author');
    const messageReply = linked([], '', rawMessages, 'replyTo');
    const messageRows = new Map((await table('messages')).map((row) => [row.id, row]));
    const threadOfMessage = (raw) => messageThread.get(raw.id) ?? raw.threadId;
    const wholeMessages = rawMessages.filter((raw) => threadRows.has(threadOfMessage(raw)));
    const message = check('messages: every message of a thread, word for word, by whom and in answer to what');
    for (const raw of wholeMessages) {
        const row = messageRows.get(raw.id);
        const reply = messageReply.get(raw.id) ?? raw.replyToMessageId ?? null;
        message(raw.id, Boolean(row) && row.thread_id === threadOfMessage(raw) && same(row.author_id, memberOrNone(messageAuthor.get(raw.id) ?? raw.authorFamilyMemberId)) && row.body === (raw.body ?? '')
            && row.importance === (raw.importance ?? 'normal') && row.is_system === (raw.isSystem === true) && same(row.reply_to_id, messageRows.has(reply) ? reply : null) && same(row.client_nonce, textOf(raw.clientNonce))
            && instantOf(row.created_at) === instantOf(raw.createdAt) && instantOf(row.edited_at) === instantOf(raw.editedAt) && instantOf(row.editable_until) === instantOf(raw.editableUntil)
            && instantOf(row.deleted_at) === instantOf(raw.deletedAt) && same(row.removed_by, memberOrNone(raw.removedByFamilyMemberId)) && same(row.removed_reason, textOf(raw.removedReason)));
    }
    check('messages: none loaded but those of a thread that was')('count', messageRows.size === wholeMessages.length);
    const perThread = check('messages: each thread has as many messages, and as many removed, as before');
    for (const raw of rawThreads) {
        const before = wholeMessages.filter((item) => threadOfMessage(item) === raw.id);
        const after = [...messageRows.values()].filter((row) => row.thread_id === raw.id);
        perThread(raw.id, before.length === after.length && before.filter((item) => !blank(item.deletedAt)).length === after.filter((row) => row.deleted_at !== null).length);
    }

    const seatThread = linked(rawThreads, 'members', rawSeats, 'thread');
    const seatPerson = linked(rawMembers, 'messageThreadMemberships', rawSeats, 'familyMember');
    const seatRows = await table('message_thread_members');
    const seats = check('message_thread_members: each thread has exactly the people it had, each keeping it as they did');
    for (const raw of rawThreads) {
        const before = rawSeats.filter((seat) => (seatThread.get(seat.id) ?? seat.threadId) === raw.id && members.has(seatPerson.get(seat.id) ?? seat.familyMemberId));
        const after = seatRows.filter((row) => row.thread_id === raw.id);
        seats(raw.id, before.length === after.length && before.every((seat) => {
            const row = after.find((item) => item.family_member_id === (seatPerson.get(seat.id) ?? seat.familyMemberId));
            return Boolean(row) && row.member_role === seat.memberRole && row.notification_level === seat.notificationLevel && row.is_archived === (seat.isArchived === true)
                && (row.pinned_at !== null) === (seat.isPinned === true) && instantOf(row.joined_at) === instantOf(seat.joinedAt) && instantOf(row.last_read_at) === instantOf(seat.lastReadAt)
                && same(row.last_read_message_id, messageRows.get(seat.lastReadMessageId)?.thread_id === raw.id ? seat.lastReadMessageId : null);
        }));
    }
    const perPerson = check('message_thread_members: each person is in as many threads as before');
    for (const raw of rawMembers) {
        perPerson(raw.id, rawSeats.filter((seat) => (seatPerson.get(seat.id) ?? seat.familyMemberId) === raw.id && threadRows.has(seatThread.get(seat.id) ?? seat.threadId)).length === seatRows.filter((row) => row.family_member_id === raw.id).length);
    }

    const rawMessageFiles = rowsOf('messageAttachments');
    await attachmentsOf('message_attachments', 'message_id', rawMessageFiles, linked(rawMessages, 'attachments', rawMessageFiles, 'message'), messageRows);

    const rawReactions = rowsOf('messageReactions');
    const rawAcks = rowsOf('messageAcknowledgements');
    const reactionMessage = linked(rawMessages, 'reactions', rawReactions, 'message');
    const ackMessage = linked(rawMessages, 'acknowledgements', rawAcks, 'message');
    const reactionRows = await table('message_reactions');
    const ackRows = await table('message_acknowledgements');
    const responses = check('message_reactions, message_acknowledgements: each message has the reactions and acknowledgements it had, from the people it had them from');
    for (const raw of wholeMessages) {
        const reactionsBefore = rawReactions.filter((item) => (reactionMessage.get(item.id) ?? item.messageId) === raw.id && members.has(item.familyMemberId)).map((item) => `${item.familyMemberId} ${item.emoji}`).sort();
        const reactionsAfter = reactionRows.filter((row) => row.message_id === raw.id).map((row) => `${row.family_member_id} ${row.emoji}`).sort();
        // One that says neither seen nor acknowledged, in its own words or at the end of its key, cannot be carried.
        const acksBefore = rawAcks.filter((item) => (ackMessage.get(item.id) ?? item.messageId) === raw.id && members.has(item.familyMemberId))
            .map((item) => [item.familyMemberId, item.kind ?? String(item.ackKey ?? '').split(':').pop()]).filter(([, kind]) => kind === 'seen' || kind === 'acknowledged').map((pair) => pair.join(' ')).sort();
        const acksAfter = ackRows.filter((row) => row.message_id === raw.id).map((row) => `${row.family_member_id} ${row.kind}`).sort();
        // Said twice is said once.
        responses(raw.id, sameJson([...new Set(reactionsBefore)], reactionsAfter) && sameJson([...new Set(acksBefore)], acksAfter));
    }
    check('message_reactions, message_acknowledgements: none on a message that was not exported')('count',
        reactionRows.every((row) => messageRows.has(row.message_id)) && ackRows.every((row) => messageRows.has(row.message_id)));

    // ---- The calendar ----
    const everyItem = rowsOf('calendarItems');
    const externalIdOf = new Map(everyItem.filter((raw) => typeof raw.sourceExternalId === 'string' && raw.sourceExternalId.trim()).map((raw) => [raw.sourceExternalId.trim(), raw.id]));
    // An occurrence names its repeating event by id, or by what the calendar it came from calls that event.
    const masterIdOf = (raw) => (everyItem.some((item) => item.id === raw.recurringEventId) ? raw.recurringEventId : externalIdOf.get(String(raw.recurringEventId ?? '').trim()));
    // One whose event is gone cannot be held, and is not looked for.
    const rawItems2 = everyItem.filter((raw) => blank(raw.recurringEventId) || masterIdOf(raw));
    const rawTags = rowsOf('calendarTags');
    const itemRows2 = new Map((await table('calendar_items')).map((row) => [row.id, row]));
    const lower = (value) => (blank(value) ? null : String(value).toLowerCase());
    // A zone is a name. Where Instant held a whole iCalendar description of one, its name is the line that says TZID.
    const zoneOf = (value) => {
        const text = textOf(value);
        const name = text && /BEGIN:VTIMEZONE/i.test(text) ? (text.split(/\r?\n/).find((line) => line.startsWith('TZID:')) ?? '').slice(5).trim() || null : text;
        try { return name && new Intl.DateTimeFormat('en', { timeZone: name }) ? name : null; } catch { return null; }
    };
    const emptyAsNone = (value) => (value == null || (Array.isArray(value) && !value.length) || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) ? null : value);
    const calendarItem = check('calendar_items: every event, field by field, on the days or at the instants it was');
    for (const raw of rawItems2) {
        const row = itemRows2.get(raw.id);
        const allDay = raw.isAllDay === true;
        calendarItem(raw.id, Boolean(row) && row.title === String(raw.title ?? '').trim() && same(row.description, textOf(raw.description)) && same(row.location, textOf(raw.location)) && same(row.url, textOf(raw.url))
            && (allDay
                ? row.start_date === dayOf(raw.startDate) && row.end_date === dayOf(raw.endDate) && row.starts_at === null && row.ends_at === null
                : instantOf(row.starts_at) === instantOf(raw.startDate) && instantOf(row.ends_at) === instantOf(raw.endDate) && row.start_date === null && row.end_date === null)
            && same(row.time_zone, zoneOf(raw.timeZone)) && row.status === (lower(raw.status) ?? 'confirmed') && row.event_type === (textOf(raw.eventType) ?? 'default') && row.visibility === (textOf(raw.visibility) ?? 'default')
            && row.transparency === (raw.transparency ?? (allDay ? 'transparent' : 'opaque')) && same(row.priority, raw.priority) && same(row.uid, textOf(raw.uid)) && row.sequence === (raw.sequence ?? 0)
            && instantOf(row.dtstamp) === instantOf(raw.dtStamp) && instantOf(row.last_modified) === instantOf(raw.lastModified)
            && sameJson(row.organizer ?? null, emptyAsNone(raw.organizer)) && sameJson(row.attendees ?? null, emptyAsNone(raw.attendees)) && sameJson(row.alarms ?? null, emptyAsNone(raw.alarms)) && sameJson(row.x_props ?? null, emptyAsNone(raw.xProps))
            && same(row.travel_duration_before_minutes, raw.travelDurationBeforeMinutes) && same(row.travel_duration_after_minutes, raw.travelDurationAfterMinutes));
    }
    check('calendar_items: as many as were exported')('count', itemRows2.size === rawItems2.length);

    // The three numbers Instant kept to find an event by its day are not carried. They can be, because they are
    // what the event's start already says, read in the event's own time zone.
    const partsIn = (instantValue, zone) => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(instantValue)).map((part) => [part.type, Number(part.value)]));
        return [parts.year, parts.month, parts.day];
    };
    const zones = [...new Set([...itemRows2.values()].map((row) => row.time_zone).filter(Boolean)), 'UTC'];
    const onItsDay = check('calendar_items: each event starts on the year, month and day Instant had it filed under, in its own time zone');
    for (const raw of rawItems2) {
        const row = itemRows2.get(raw.id);
        if (!row) { onItsDay(raw.id, false); continue; }
        const filed = [raw.year, raw.month, raw.dayOfMonth];
        // An event that names no zone was filed in whichever one the device that made it was in.
        const candidates = row.start_date ? [row.start_date.split('-').map(Number)] : (row.time_zone ? [row.time_zone] : zones).map((zone) => partsIn(row.starts_at, zone));
        // An event made in the app was filed with its month counted from nought.
        onItsDay(raw.id, candidates.some((parts) => sameJson(parts, filed) || sameJson([parts[0], parts[1] - 1, parts[2]], filed)));
    }

    const tokensOf = (raw, attribute, label) => [...new Set([
        ...asList(raw[attribute]).filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()),
        ...asList(raw.recurrenceLines).filter((line) => typeof line === 'string' && line.toUpperCase().startsWith(`${label}:`)).flatMap((line) => line.slice(label.length + 1).split(',')).map((token) => token.trim()).filter(Boolean),
    ])].sort();
    const repeats = check('calendar_items: each event repeats by the rule it did, with the same occurrences added and taken out');
    for (const raw of rawItems2) {
        const row = itemRows2.get(raw.id);
        const ruleBefore = textOf(raw.rrule) ?? asList(raw.recurrenceLines).find((line) => /^RRULE:/i.test(String(line))) ?? null;
        repeats(raw.id, Boolean(row) && same(row.rrule, ruleBefore ? String(ruleBefore).replace(/^RRULE:/i, '') : null)
            && sameJson([...row.exdates].sort(), tokensOf(raw, 'exdates', 'EXDATE')) && sameJson([...row.rdates].sort(), tokensOf(raw, 'rdates', 'RDATE')));
    }
    const exception = check('calendar_items: each changed occurrence belongs to the repeating event it did, as the occurrence it was');
    for (const raw of rawItems2.filter((item) => textOf(item.recurringEventId))) {
        const row = itemRows2.get(raw.id);
        exception(raw.id, Boolean(row) && row.recurring_event_id === masterIdOf(raw) && row.recurrence_id === textOf(raw.recurrenceId) && same(row.recurrence_id_range, textOf(raw.recurrenceIdRange)));
    }
    check('calendar_items: no event is an occurrence of another unless it was')('count',
        [...itemRows2.values()].filter((row) => row.recurring_event_id).length === rawItems2.filter((item) => textOf(item.recurringEventId)).length);
    const imported = check('calendar_items: each event brought in from elsewhere says from where, as it did');
    for (const raw of rawItems2) {
        const row = itemRows2.get(raw.id);
        imported(raw.id, Boolean(row) && same(row.source_type, textOf(raw.sourceType)) && row.source_read_only === (raw.sourceReadOnly === true) && same(row.source_sync_status, textOf(raw.sourceSyncStatus))
            && same(row.source_calendar_name, textOf(raw.sourceCalendarName)) && same(row.source_external_id, textOf(raw.sourceExternalId)) && same(row.source_remote_url, textOf(raw.sourceRemoteUrl)));
    }

    const itemPeopleBefore = new Map(rawItems2.map((raw) => [raw.id, new Set(asList(raw.pertainsTo))]));
    for (const raw of rawMembers) for (const itemId of asList(raw.calendarItems)) itemPeopleBefore.get(itemId)?.add(raw.id);
    const itemPeopleAfter = await table('calendar_item_members');
    const forWhom = check('calendar_item_members: each event is for exactly the people it was');
    for (const raw of rawItems2) {
        const before = [...itemPeopleBefore.get(raw.id)].filter((id) => members.has(id)).sort();
        forWhom(raw.id, sameJson(before, itemPeopleAfter.filter((row) => row.calendar_item_id === raw.id).map((row) => row.family_member_id).sort()));
    }
    const tagRows = new Map((await table('calendar_tags')).map((row) => [row.id, row]));
    const itemTagsBefore = new Map(rawItems2.map((raw) => [raw.id, new Set(asList(raw.tags))]));
    for (const raw of rawTags) for (const itemId of asList(raw.calendarItems)) itemTagsBefore.get(itemId)?.add(raw.id);
    const tagName = new Map(rawTags.map((raw) => [raw.id, String(raw.name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()]));
    const itemTagsAfter = await table('calendar_item_tags');
    const tagged = check('calendar_item_tags: each event has the tags it had, by name');
    for (const raw of rawItems2) {
        const before = [...new Set([...itemTagsBefore.get(raw.id)].map((id) => tagName.get(id)).filter(Boolean))].sort();
        tagged(raw.id, sameJson(before, itemTagsAfter.filter((row) => row.calendar_item_id === raw.id).map((row) => tagRows.get(row.tag_id)?.name.toLowerCase()).sort()));
    }
    check('calendar_tags: one for each name that was used')('count', tagRows.size === new Set([...tagName.values()].filter(Boolean)).size);

    // ---- What only the server keeps ----
    const rawAccounts = rowsOf('calendarSyncAccounts');
    const rawCalendars = rowsOf('calendarSyncCalendars');
    const accountRows = new Map((await table('calendar_sync_accounts')).map((row) => [row.id, row]));
    const account = check('calendar_sync_accounts: every account, field by field, with its password as it was encrypted');
    for (const raw of rawAccounts) {
        const row = accountRows.get(raw.id);
        account(raw.id, Boolean(row) && row.provider === raw.provider && row.username === raw.username && row.password_ciphertext === raw.passwordCiphertext && row.password_key_version === raw.passwordKeyVersion
            && row.account_label === raw.accountLabel && row.status === raw.status && same(row.apple_principal_url, textOf(raw.applePrincipalUrl)) && same(row.apple_calendar_home_url, textOf(raw.appleCalendarHomeUrl))
            && sameJson(row.selected_calendar_ids, asList(raw.selectedCalendarIds)) && same(row.sync_window_past_days, raw.syncWindowPastDays) && same(row.sync_window_future_days, raw.syncWindowFutureDays)
            && instantOf(row.last_successful_sync_at) === instantOf(raw.lastSuccessfulSyncAt) && same(row.last_error_code, textOf(raw.lastErrorCode)));
    }
    const calendarRows = new Map((await table('calendar_sync_calendars')).map((row) => [row.id, row]));
    const syncCalendar = check('calendar_sync_calendars: every calendar of an account, field by field');
    for (const raw of rawCalendars.filter((item) => accountRows.has(item.accountId))) {
        const row = calendarRows.get(raw.id);
        syncCalendar(raw.id, Boolean(row) && row.account_id === raw.accountId && row.remote_calendar_id === raw.remoteCalendarId && same(row.remote_url, textOf(raw.remoteUrl)) && row.display_name === raw.displayName
            && row.is_enabled === (raw.isEnabled === true) && same(row.last_ctag, textOf(raw.lastCtag)) && same(row.last_sync_token, textOf(raw.lastSyncToken)) && same(row.color, textOf(raw.color))
            && same(row.time_zone, zoneOf(raw.timeZone)) && instantOf(row.last_successful_sync_at) === instantOf(raw.lastSuccessfulSyncAt));
    }
    check('calendar sync: as many accounts and calendars as were exported')('count', accountRows.size === rawAccounts.length && calendarRows.size === rawCalendars.filter((item) => accountRows.has(item.accountId)).length);
    const stateRows = new Map((await table('calendar_item_sync_state')).map((row) => [row.calendar_item_id, row]));
    const state = check('calendar_item_sync_state: what the import knew of each event it brought in, so it finds the event again and not a second one');
    for (const raw of rawItems2.filter((item) => textOf(item.sourceAccountKey))) {
        const row = stateRows.get(raw.id);
        const from = rawCalendars.find((item) => item.accountId === raw.sourceAccountKey && item.remoteCalendarId === raw.sourceCalendarId);
        state(raw.id, from
            ? Boolean(row) && row.calendar_id === from.id && same(row.remote_etag, textOf(raw.sourceRemoteEtag)) && same(row.remote_ctag, textOf(raw.sourceRemoteCtag)) && same(row.raw_hash, textOf(raw.sourceRawHash))
                && instantOf(row.last_seen_at) === instantOf(raw.sourceLastSeenAt ?? raw.sourceImportedAt) && (blank(raw.sourceImportedAt) || instantOf(row.imported_at) === instantOf(raw.sourceImportedAt))
            : !row);
    }
    check('calendar_item_sync_state: none for an event that was not brought in')('count', stateRows.size <= rawItems2.filter((item) => textOf(item.sourceAccountKey)).length);

    const rawRuns = rowsOf('calendarSyncRuns');
    const runRows = new Map((await table('calendar_sync_runs')).map((row) => [row.id, row]));
    const newestRun = rawRuns.reduce((latest, raw) => Math.max(latest, instantOf(raw.startedAt) ?? 0), 0);
    const happened = (raw) => raw.status !== 'success' || (raw.eventsCreated ?? 0) + (raw.eventsUpdated ?? 0) + (raw.eventsCancelled ?? 0) + (raw.eventsMarkedDeleted ?? 0) > 0;
    const wanted = rawRuns.filter((raw) => accountRows.has(raw.accountId) && (instantOf(raw.startedAt) >= newestRun - 30 * 86_400_000 || happened(raw)));
    check('calendar_sync_runs: the last thirty days of the log, and every older run in which something happened')('count', runRows.size === wanted.length && wanted.every((raw) => runRows.has(raw.id)));
    const failedRun = check('calendar_sync_runs: every failed run, with what went wrong');
    for (const raw of wanted.filter((item) => item.status !== 'success')) {
        const row = runRows.get(raw.id);
        failedRun(raw.id, Boolean(row) && row.status === raw.status && row.trigger === raw.trigger && instantOf(row.started_at) === instantOf(raw.startedAt) && same(row.error_code, textOf(raw.errorCode)) && same(row.error_message, textOf(raw.errorMessage)));
    }

    const rawTokens = rowsOf('shortcutTokens');
    const tokenRows = new Map((await table('shortcut_tokens')).map((row) => [row.id, row]));
    const token = check('shortcut_tokens: every token of a parent still in the family, working or revoked as it was');
    for (const raw of rawTokens.filter((item) => members.has(item.parentFamilyMemberId))) {
        const row = tokenRows.get(raw.id);
        token(raw.id, Boolean(row) && row.token_hash === raw.tokenHash && row.capability === raw.capability && row.parent_family_member_id === raw.parentFamilyMemberId && row.label === raw.label
            && instantOf(row.revoked_at) === instantOf(raw.revokedAt) && instantOf(row.last_used_at) === instantOf(raw.lastUsedAt));
    }
    const rawPush = rowsOf('pushDevices');
    const pushRows = new Map((await table('push_devices')).map((row) => [row.id, row]));
    const push = check('push_devices: every device of someone in the family, with its token');
    for (const raw of rawPush.filter((item) => members.has(item.familyMemberId))) {
        const row = pushRows.get(raw.id);
        push(raw.id, Boolean(row) && row.token === raw.token && row.family_member_id === raw.familyMemberId && row.platform === raw.platform && row.is_enabled === (raw.isEnabled !== false));
    }
    check('shortcut_tokens, push_devices: none loaded but those of someone in the family')('count',
        tokenRows.size === rawTokens.filter((item) => members.has(item.parentFamilyMemberId)).length && pushRows.size === rawPush.filter((item) => members.has(item.familyMemberId)).length);

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
