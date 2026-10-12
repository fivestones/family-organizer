// How what Instant holds becomes rows in Postgres: for each table, which entity it comes from, which attribute or link
// fills each column, and the conversion applied. This file is the written record of the schema's design choices
// (docs/powersync-migration.md, "The schema"). It reads no database and knows nothing about instant.schema.ts, so it
// goes on working from an export, or from one of Instant's own backups, after Instant has left the repository.
//
// `buildRows` never drops a row silently. A row that the new schema cannot hold is returned under `heldBack` with the
// reason, and every conversion that changed a value's meaning is counted under `notes`.

/** The tables this mapping fills, in an order their foreign keys allow. */
export const TABLES = [
    'settings', 'unit_definitions', 'family_members', 'chores', 'chore_assignees', 'chore_completions',
    'routines', 'routine_steps', 'routine_marker_statuses', 'countdown_runs', 'history_events', 'history_event_members',
];

/** The columns written to each table. One the database fills in for itself, such as family_members.has_pin, is not among them. */
export const COLUMNS = {
    settings: ['name', 'value'],
    unit_definitions: ['id', 'code', 'name', 'symbol', 'is_monetary', 'symbol_placement', 'symbol_spacing', 'decimal_places'],
    family_members: [
        'id', 'name', 'role', 'email', 'color', 'photo_urls', 'sort_order', 'pin_hash',
        'allowance_amount', 'allowance_currency', 'allowance_rrule', 'allowance_start_date', 'allowance_payout_delay_days', 'allowance_config',
        'last_display_currency', 'view_show_chore_descriptions', 'view_show_task_details',
        'message_quiet_hours_enabled', 'message_quiet_hours_start', 'message_quiet_hours_end', 'message_digest_mode', 'message_digest_window_minutes',
    ],
    chores: [
        'id', 'title', 'description', 'start_date', 'rrule', 'exdates', 'pause_state',
        'rotation_type', 'is_joint', 'is_up_for_grabs', 'hide_from_day_list', 'sort_order',
        'weight', 'reward_type', 'reward_amount', 'reward_currency', 'estimated_duration_secs',
        'timing_mode', 'timing_window_key', 'timing_time', 'timing_start_time', 'timing_end_time',
        'timing_marker_key', 'timing_chore_id', 'timing_event', 'timing_fallback_time', 'created_at',
    ],
    chore_assignees: ['chore_id', 'family_member_id', 'position'],
    chore_completions: ['id', 'chore_id', 'completed_by', 'marked_by', 'date_due', 'completed_at', 'not_done', 'allowance_awarded'],
    routines: ['id', 'name', 'on_step_overrun', 'sort_order', 'created_at'],
    routine_steps: ['routine_id', 'chore_id', 'position'],
    routine_marker_statuses: ['day', 'marker_key', 'started_at', 'started_by', 'completed_at', 'completed_by'],
    countdown_runs: [
        'id', 'family_member_id', 'day', 'routine_id', 'status', 'current_chore_id', 'skipped_chore_ids', 'started_at', 'step_started_at',
        'step_extension_secs', 'step_extension_count', 'last_interaction_at', 'stopped_at', 'stopped_reason',
    ],
    history_events: [
        'id', 'occurred_at', 'domain', 'action_type', 'summary', 'source', 'actor_id', 'chore_id', 'task_series_id', 'task_id',
        'calendar_item_id', 'allowance_transaction_id', 'message_thread_id', 'message_id', 'scheduled_for', 'restore_timing', 'metadata',
    ],
    history_event_members: ['history_event_id', 'family_member_id'],
};

/** Columns holding a JSON document. The importer hands these to Postgres as JSON text, whatever the value's shape. */
export const JSON_COLUMNS = {
    settings: ['value'],
    family_members: ['photo_urls', 'allowance_config'],
    chores: ['pause_state'],
    history_events: ['metadata'],
};

/**
 * Attributes that are deliberately not carried, by entity. Anything stored that is neither mapped nor listed here
 * is reported, so a new attribute cannot be lost by oversight.
 */
export const LEFT_BEHIND = {
    chores: {
        done: 'Set to false when a chore is created and never read.',
        timeBucket: 'Folded into the timing columns.',
        timingMode: 'Folded into the timing columns.',
        timingConfig: 'Folded into the timing columns.',
        // Declared in the schema, never stored, never read.
        advanceCompletionLimit: 'Never used.', allowExtraDays: 'Never used.', area: 'Never used.',
        canCompleteInAdvance: 'Never used.', canCompletePast: 'Never used.', difficultyRating: 'Never used.',
        dueTimes: 'Never used.', imageUrl: 'Never used.', pastCompletionLimit: 'Never used.',
    },
    choreCompletions: {
        completed: 'A completion is done when completed_at is set.',
    },
    routineMarkerStatuses: {
        key: 'The day and the marker are the key.',
    },
};

// ---- Conversions ----

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const asList = (value) => (Array.isArray(value) ? value : value ? [value] : []);
const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

/** Text that is optional: an empty string was Instant's way of saying none. */
const optionalText = (value) => trimmed(value) || null;
const optionalNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const optionalInteger = (value) => (Number.isInteger(value) ? value : null);
const optionalBoolean = (value) => (typeof value === 'boolean' ? value : null);
const oneOf = (value, allowed) => (allowed.includes(value) ? value : null);

/** A calendar day. Instant held days as `YYYY-MM-DD` or as the instant of that day's start in UTC. */
function day(value, notes, what) {
    if (value == null || value === '') return null;
    const text = value instanceof Date ? value.toISOString() : String(value);
    const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:T(.*))?$/);
    if (!match) {
        const parsed = new Date(typeof value === 'number' ? value : text);
        if (Number.isNaN(parsed.getTime())) return count(notes, `${what}: not a date, left empty`), null;
        return count(notes, `${what}: an instant narrowed to its UTC day`), parsed.toISOString().slice(0, 10);
    }
    if (match[2] && !/^00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(match[2])) count(notes, `${what}: an instant narrowed to its UTC day`);
    return match[1];
}

/** An instant, as ISO 8601 with milliseconds and Z. Instant held these as ISO strings or epoch milliseconds. */
function instant(value, notes, what) {
    if (value == null || value === '') return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return count(notes, `${what}: not a date, left empty`), null;
    return parsed.toISOString();
}

/** A time of day, `HH:MM`. */
function timeOfDay(value, notes, what) {
    const text = trimmed(value);
    if (!text) return null;
    const match = text.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
    if (!match) return count(notes, `${what}: not a time of day, left empty`), null;
    return `${match[1]}:${match[2]}`;
}

function count(notes, note) {
    notes[note] = (notes[note] ?? 0) + 1;
}

/** The key form the app gives a named window or a routine marker. */
function slug(value) {
    return trimmed(String(value ?? '')).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

// ---- Links ----

/**
 * The pairs joined by one link, read from whichever side the export holds it on. An export keeps a link on its
 * forward side; which side that is depends on how the schema declared it, which this file should not need to know.
 */
function pairs(rowsOf, [leftEntity, leftLabel], [rightEntity, rightLabel]) {
    const found = new Map();
    const add = (left, right) => found.set(`${left}\n${right}`, [left, right]);
    for (const row of rowsOf(leftEntity)) for (const other of asList(row[leftLabel])) add(row.id, other);
    for (const row of rowsOf(rightEntity)) for (const other of asList(row[rightLabel])) add(other, row.id);
    return [...found.values()];
}

function groupBy(list, key, value) {
    const grouped = new Map();
    for (const item of list) grouped.set(key(item), [...(grouped.get(key(item)) ?? []), value(item)]);
    return grouped;
}

// ---- Tables ----

function settings(rowsOf, out) {
    const seen = new Set();
    for (const row of rowsOf('settings')) {
        const name = trimmed(row.name);
        if (!name) { hold(out, 'settings', row, 'It has no name.'); continue; }
        // Every reader today takes the first row of a name, so the first is the one that is kept.
        if (seen.has(name)) { hold(out, 'settings', row, 'Another row already holds this setting.'); continue; }
        const value = settingValue(row.value, out.notes);
        // A setting stored as nothing is a setting that is not set.
        if (value == null) { hold(out, 'settings', row, 'It has no value.'); continue; }
        seen.add(name);
        out.tables.settings.push({ name, value });
    }
}

/** A setting's value was stored as text: JSON for most, and for the dashboard theme the bare word. */
function settingValue(raw, notes) {
    if (typeof raw !== 'string') return raw ?? null;
    try {
        return JSON.parse(raw);
    } catch {
        count(notes, 'settings.value: a bare word, kept as a JSON string');
        return raw;
    }
}

function unitDefinitions(rowsOf, out) {
    const seen = new Set();
    for (const row of rowsOf('unitDefinitions')) {
        const code = trimmed(row.code);
        if (!code) { hold(out, 'unitDefinitions', row, 'It has no code.'); continue; }
        if (seen.has(code)) { hold(out, 'unitDefinitions', row, 'Another unit already has this code.'); continue; }
        seen.add(code);
        let isMonetary = optionalBoolean(row.isMonetary);
        if (isMonetary === null) {
            // What the app's formatters do with a unit that never said: a three-letter code is a currency.
            isMonetary = /^[A-Za-z]{3}$/.test(code);
            count(out.notes, 'unitDefinitions.isMonetary: not stored, taken from the shape of the code');
        }
        out.tables.unit_definitions.push({
            id: row.id,
            code,
            name: trimmed(row.name) || code,
            symbol: typeof row.symbol === 'string' ? row.symbol : '',
            is_monetary: isMonetary,
            symbol_placement: oneOf(row.symbolPlacement, ['before', 'after']),
            symbol_spacing: optionalBoolean(row.symbolSpacing),
            decimal_places: Number.isInteger(row.decimalPlaces) && row.decimalPlaces >= 0 ? row.decimalPlaces : null,
        });
    }
}

function familyMembers(rowsOf, out) {
    const rows = rowsOf('familyMembers');
    for (const [index, row] of rows.entries()) {
        if (!oneOf(row.role, ['parent', 'child'])) count(out.notes, 'familyMembers.role: missing or unknown, set to child');
        if (!Number.isInteger(row.order)) count(out.notes, 'familyMembers.order: missing, placed by position in the export');
        out.tables.family_members.push({
            id: row.id,
            name: trimmed(row.name) || 'Unnamed',
            role: oneOf(row.role, ['parent', 'child']) ?? 'child',
            email: optionalText(row.email),
            color: optionalText(row.color),
            photo_urls: isRecord(row.photoUrls) ? row.photoUrls : null,
            sort_order: Number.isInteger(row.order) ? row.order : index,
            pin_hash: optionalText(row.pinHash),
            allowance_amount: optionalNumber(row.allowanceAmount),
            allowance_currency: optionalText(row.allowanceCurrency),
            allowance_rrule: optionalText(row.allowanceRrule),
            allowance_start_date: day(row.allowanceStartDate, out.notes, 'familyMembers.allowanceStartDate'),
            allowance_payout_delay_days: Number.isInteger(row.allowancePayoutDelayDays) && row.allowancePayoutDelayDays >= 0 ? row.allowancePayoutDelayDays : 0,
            allowance_config: isRecord(row.allowanceConfig) ? row.allowanceConfig : null,
            last_display_currency: optionalText(row.lastDisplayCurrency),
            view_show_chore_descriptions: optionalBoolean(row.viewShowChoreDescriptions),
            view_show_task_details: optionalBoolean(row.viewShowTaskDetails),
            message_quiet_hours_enabled: optionalBoolean(row.messageQuietHoursEnabled),
            message_quiet_hours_start: timeOfDay(row.messageQuietHoursStart, out.notes, 'familyMembers.messageQuietHoursStart'),
            message_quiet_hours_end: timeOfDay(row.messageQuietHoursEnd, out.notes, 'familyMembers.messageQuietHoursEnd'),
            message_digest_mode: oneOf(row.messageDigestMode, ['immediate', 'digest']),
            message_digest_window_minutes: Number.isInteger(row.messageDigestWindowMinutes) && row.messageDigestWindowMinutes > 0 ? row.messageDigestWindowMinutes : null,
        });
    }
}

const TIMING_MODES = ['anytime', 'named_window', 'before_time', 'after_time', 'between_times', 'before_marker', 'after_marker', 'before_chore', 'after_chore'];

/**
 * When in the day a chore is due. Instant held it three ways at once — a mode, a bucket and a configuration object,
 * under several generations of names — and the app resolved them on every read. The resolution is done once, here,
 * and the result stored as a mode with the columns that mode uses.
 */
function choreTiming(row, choreIds, notes) {
    const config = isRecord(row.timingConfig) ? row.timingConfig : {};
    const anchor = isRecord(config.anchor) ? config.anchor : null;
    const stated = trimmed(row.timingMode) || trimmed(config.mode);
    const after = anchor?.relation === 'after';
    const bucket = trimmed(row.timeBucket) || trimmed(config.timeBucket);
    const earlierNames = { day_part: 'named_window', clock_window: 'between_times', routine_anchor: after ? 'after_marker' : 'before_marker', chore_anchor: after ? 'after_chore' : 'before_chore' };
    const mode = TIMING_MODES.includes(stated) ? stated : earlierNames[stated] ?? (bucket ? 'named_window' : 'anytime');
    if (stated && stated !== mode) count(notes, `chores timing: "${stated}" stored as ${mode}`);
    if (!stated && bucket) count(notes, 'chores timing: a bare time bucket stored as named_window');

    const timing = {
        timing_mode: mode, timing_window_key: null, timing_time: null, timing_start_time: null, timing_end_time: null,
        timing_marker_key: null, timing_chore_id: null, timing_event: null, timing_fallback_time: null,
    };
    const anchored = () => {
        const before = mode.startsWith('before_');
        // An anchor once held a start and an end fallback. The app reads the one on the side the chore is due.
        const fallback = trimmed(anchor?.fallbackTime)
            || (before ? trimmed(anchor?.fallbackEndTime) || trimmed(anchor?.fallbackStartTime) : trimmed(anchor?.fallbackStartTime) || trimmed(anchor?.fallbackEndTime));
        timing.timing_fallback_time = timeOfDay(fallback, notes, 'chores timing fallback');
        timing.timing_event = anchor?.event === 'started' ? 'started' : 'completed';
    };
    if (mode === 'named_window') {
        timing.timing_window_key = slug(trimmed(config.namedWindowKey) || bucket) || null;
    } else if (mode === 'before_time' || mode === 'after_time') {
        timing.timing_time = timeOfDay(config.time, notes, 'chores timing time');
    } else if (mode === 'between_times') {
        timing.timing_start_time = timeOfDay(config.window?.startTime, notes, 'chores timing window');
        timing.timing_end_time = timeOfDay(config.window?.endTime, notes, 'chores timing window');
    } else if (mode === 'before_marker' || mode === 'after_marker') {
        timing.timing_marker_key = slug(anchor?.routineKey) || null;
        anchored();
    } else if (mode === 'before_chore' || mode === 'after_chore') {
        const source = trimmed(anchor?.sourceChoreId);
        if (source && source !== row.id && choreIds.has(source)) timing.timing_chore_id = source;
        else if (source) count(notes, 'chores timing: anchored to a chore that no longer exists, anchor left empty');
        anchored();
    }
    return timing;
}

function chores(rowsOf, out) {
    const rows = rowsOf('chores');
    const choreIds = new Set(rows.map((row) => row.id));
    for (const row of rows) {
        const startDate = day(row.startDate, out.notes, 'chores.startDate');
        if (!startDate) { hold(out, 'chores', row, 'It has no start date.'); continue; }
        const exdates = [...new Set(asList(row.exdates).map((value) => day(value, out.notes, 'chores.exdates')).filter(Boolean))].sort();
        out.tables.chores.push({
            id: row.id,
            title: trimmed(row.title) || 'Untitled',
            description: optionalText(row.description),
            start_date: startDate,
            rrule: optionalText(row.rrule),
            exdates,
            pause_state: isRecord(row.pauseState) ? row.pauseState : null,
            rotation_type: oneOf(row.rotationType, ['none', 'daily', 'weekly', 'monthly']) ?? 'none',
            is_joint: row.isJoint === true,
            is_up_for_grabs: row.isUpForGrabs === true,
            hide_from_day_list: row.hideFromDayList === true,
            sort_order: optionalInteger(row.sortOrder) ?? 0,
            weight: optionalNumber(row.weight),
            reward_type: oneOf(row.rewardType, ['fixed', 'weight']),
            reward_amount: optionalNumber(row.rewardAmount),
            reward_currency: optionalText(row.rewardCurrency),
            estimated_duration_secs: Number.isInteger(row.estimatedDurationSecs) && row.estimatedDurationSecs >= 0 ? row.estimatedDurationSecs : null,
            ...choreTiming(row, choreIds, out.notes),
            created_at: instant(row.createdAt, out.notes, 'chores.createdAt') ?? `${startDate}T00:00:00.000Z`,
        });
    }
}

/**
 * Who a chore is assigned to, with their place in its rotation. Instant held the assignees as one link and the
 * rotation's order as a separate entity; they are the same people, so they are one table.
 */
function choreAssignees(rowsOf, out) {
    const chores = new Set(out.tables.chores.map((row) => row.id));
    const members = new Map(out.tables.family_members.map((row) => [row.id, row]));
    const assigned = groupBy(pairs(rowsOf, ['familyMembers', 'assignedChores'], ['chores', 'assignees']), ([, chore]) => chore, ([member]) => member);
    const memberOfAssignment = new Map(pairs(rowsOf, ['choreAssignments', 'familyMember'], ['familyMembers', 'choreAssignments']));
    const assignmentOrder = new Map(rowsOf('choreAssignments').map((row) => [row.id, Number.isFinite(row.order) ? row.order : Number.MAX_SAFE_INTEGER]));
    const rotations = groupBy(pairs(rowsOf, ['chores', 'assignments'], ['choreAssignments', 'chore']), ([chore]) => chore, ([, assignment]) => assignment);

    for (const chore of chores) {
        const inRotation = (rotations.get(chore) ?? [])
            .filter((assignment) => members.has(memberOfAssignment.get(assignment)))
            .sort((a, b) => assignmentOrder.get(a) - assignmentOrder.get(b) || a.localeCompare(b))
            .map((assignment) => memberOfAssignment.get(assignment));
        const assignees = (assigned.get(chore) ?? []).filter((member) => members.has(member));
        // The rotation's order first; then anyone assigned but not in it, in the family's order.
        const rest = assignees
            .filter((member) => !inRotation.includes(member))
            .sort((a, b) => members.get(a).sort_order - members.get(b).sort_order || a.localeCompare(b));
        const ordered = [...new Set([...inRotation, ...rest])];
        if (inRotation.some((member) => !assignees.includes(member))) count(out.notes, 'chore_assignees: someone in a rotation who was not an assignee, added as one');
        ordered.forEach((member, position) => out.tables.chore_assignees.push({ chore_id: chore, family_member_id: member, position }));
    }
}

function choreCompletions(rowsOf, out) {
    const chores = new Set(out.tables.chores.map((row) => row.id));
    const members = new Set(out.tables.family_members.map((row) => row.id));
    const choreOf = new Map(pairs(rowsOf, ['choreCompletions', 'chore'], ['chores', 'completions']));
    const completerOf = new Map(pairs(rowsOf, ['choreCompletions', 'completedBy'], ['familyMembers', 'completedChores']));
    const markerOf = new Map(pairs(rowsOf, ['choreCompletions', 'markedBy'], ['familyMembers', 'markedCompletions']));

    const kept = new Map();
    for (const row of rowsOf('choreCompletions')) {
        const chore = choreOf.get(row.id);
        const completer = completerOf.get(row.id);
        const dateDue = day(row.dateDue, out.notes, 'choreCompletions.dateDue');
        if (!chores.has(chore)) { hold(out, 'choreCompletions', row, 'It belongs to no chore.'); continue; }
        if (!members.has(completer)) { hold(out, 'choreCompletions', row, 'Nobody is recorded as having completed it.'); continue; }
        if (!dateDue) { hold(out, 'choreCompletions', row, 'It has no due day.'); continue; }

        const done = row.completed === true;
        let completedAt = done ? instant(row.dateCompleted, out.notes, 'choreCompletions.dateCompleted') : null;
        if (done && !completedAt) {
            completedAt = `${dateDue}T00:00:00.000Z`;
            count(out.notes, 'choreCompletions: done with no time recorded, set to the start of its due day');
        }
        if (!done && row.dateCompleted) count(out.notes, 'choreCompletions: not done but carrying a time, time dropped');
        const next = {
            id: row.id,
            chore_id: chore,
            completed_by: completer,
            marked_by: members.has(markerOf.get(row.id)) ? markerOf.get(row.id) : null,
            date_due: dateDue,
            completed_at: completedAt,
            not_done: !done && row.notDone === true,
            allowance_awarded: row.allowanceAwarded === true,
        };
        // One completion per chore, person and day. Of several, the one that is done, and then the latest, is kept.
        const key = `${chore}\n${completer}\n${dateDue}`;
        const current = kept.get(key);
        if (!current) { kept.set(key, { row, next }); continue; }
        const better = (next.completed_at ?? '') > (current.next.completed_at ?? '');
        hold(out, 'choreCompletions', better ? current.row : row, 'Another completion already covers this chore, person and day.');
        if (better) kept.set(key, { row, next });
    }
    for (const { next } of kept.values()) out.tables.chore_completions.push(next);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The id something had, kept even though the thing may be gone. Anything that is not an id is left out. */
const idOrNull = (value) => (typeof value === 'string' && UUID.test(value) ? value : null);

/** A routine, and its chores in order. Instant held the order on a join entity of its own; here the join is the table. */
function routines(rowsOf, out) {
    const chores = new Set(out.tables.chores.map((row) => row.id));
    const kept = new Set();
    for (const row of rowsOf('routines')) {
        kept.add(row.id);
        out.tables.routines.push({
            id: row.id,
            name: trimmed(row.name) || 'Untitled',
            on_step_overrun: oneOf(row.onStepOverrun, ['wait', 'advance']),
            sort_order: optionalInteger(row.sortOrder) ?? 0,
            created_at: instant(row.createdAt, out.notes, 'routines.createdAt') ?? new Date(0).toISOString(),
        });
    }
    const routineOf = new Map(pairs(rowsOf, ['routineSteps', 'routine'], ['routines', 'steps']));
    const choreOf = new Map(pairs(rowsOf, ['routineSteps', 'chore'], ['chores', 'routineSteps']));
    const seen = new Set();
    for (const row of [...rowsOf('routineSteps')].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.id).localeCompare(String(b.id)))) {
        const routine = routineOf.get(row.id);
        const chore = choreOf.get(row.id);
        if (!kept.has(routine)) { hold(out, 'routineSteps', row, 'It belongs to no routine.'); continue; }
        if (!chores.has(chore)) { hold(out, 'routineSteps', row, 'It names no chore.'); continue; }
        if (seen.has(`${routine}\n${chore}`)) { hold(out, 'routineSteps', row, 'The chore is already a step of this routine.'); continue; }
        seen.add(`${routine}\n${chore}`);
        out.tables.routine_steps.push({ routine_id: routine, chore_id: chore, position: optionalInteger(row.position) ?? 0 });
    }
}

/** When a routine marker started and finished on a day. Its key was a string of the two joined; it is the two. */
function routineMarkerStatuses(rowsOf, out) {
    const members = new Set(out.tables.family_members.map((row) => row.id));
    const seen = new Set();
    for (const row of rowsOf('routineMarkerStatuses')) {
        const dayOf = day(row.date, out.notes, 'routineMarkerStatuses.date');
        const marker = slug(row.markerKey);
        if (!dayOf || !marker) { hold(out, 'routineMarkerStatuses', row, 'It has no day or no marker.'); continue; }
        if (seen.has(`${dayOf}\n${marker}`)) { hold(out, 'routineMarkerStatuses', row, 'Another row already covers this marker and day.'); continue; }
        seen.add(`${dayOf}\n${marker}`);
        out.tables.routine_marker_statuses.push({
            day: dayOf,
            marker_key: marker,
            started_at: instant(row.startedAt, out.notes, 'routineMarkerStatuses.startedAt'),
            started_by: members.has(row.startedById) ? row.startedById : null,
            completed_at: instant(row.completedAt, out.notes, 'routineMarkerStatuses.completedAt'),
            completed_by: members.has(row.completedById) ? row.completedById : null,
        });
    }
}

/** One person's countdown on one day. */
function countdownRuns(rowsOf, out) {
    const members = new Set(out.tables.family_members.map((row) => row.id));
    const chores = new Set(out.tables.chores.map((row) => row.id));
    const routinesKept = new Set(out.tables.routines.map((row) => row.id));
    const kept = new Map();
    for (const row of rowsOf('countdownRuns')) {
        const dayOf = day(row.date, out.notes, 'countdownRuns.date');
        const startedAt = instant(row.startedAt, out.notes, 'countdownRuns.startedAt');
        if (!members.has(row.familyMemberId)) { hold(out, 'countdownRuns', row, 'It belongs to nobody in the family.'); continue; }
        if (!dayOf || !startedAt) { hold(out, 'countdownRuns', row, 'It has no day or no start.'); continue; }
        const next = {
            id: row.id,
            family_member_id: row.familyMemberId,
            day: dayOf,
            routine_id: routinesKept.has(row.routineId) ? row.routineId : null,
            status: oneOf(row.status, ['running', 'stopped']) ?? 'stopped',
            current_chore_id: chores.has(row.currentChoreId) ? row.currentChoreId : null,
            skipped_chore_ids: asList(row.skippedChoreIds).filter((id) => chores.has(id)),
            started_at: startedAt,
            step_started_at: instant(row.stepStartedAt, out.notes, 'countdownRuns.stepStartedAt'),
            step_extension_secs: optionalInteger(row.stepExtensionSecs) ?? 0,
            step_extension_count: optionalInteger(row.stepExtensionCount) ?? 0,
            last_interaction_at: instant(row.lastInteractionAt, out.notes, 'countdownRuns.lastInteractionAt'),
            stopped_at: instant(row.stoppedAt, out.notes, 'countdownRuns.stoppedAt'),
            stopped_reason: optionalText(row.stoppedReason),
        };
        // One run per person and day. Of several, the one started last is kept.
        const key = `${next.family_member_id}\n${dayOf}`;
        const current = kept.get(key);
        if (current) hold(out, 'countdownRuns', next.started_at > current.next.started_at ? current.row : row, 'Another run already covers this person and day.');
        if (!current || next.started_at > current.next.started_at) kept.set(key, { row, next });
    }
    for (const { next } of kept.values()) out.tables.countdown_runs.push(next);
}

const HISTORY_DOMAINS = ['tasks', 'chores', 'calendar', 'finance', 'messages', 'system'];

/**
 * The record of what happened. Instant held who did it twice, as a link and as an id beside it; here it is one
 * column. Who it affected was a many-to-many link and is a table of its own.
 */
function historyEvents(rowsOf, out) {
    const members = new Set(out.tables.family_members.map((row) => row.id));
    const actorByLink = new Map(pairs(rowsOf, ['historyEvents', 'actor'], ['familyMembers', 'actedHistoryEvents']));
    const kept = new Set();
    for (const row of rowsOf('historyEvents')) {
        const occurredAt = instant(row.occurredAt, out.notes, 'historyEvents.occurredAt');
        if (!occurredAt) { hold(out, 'historyEvents', row, 'It does not say when it happened.'); continue; }
        if (!HISTORY_DOMAINS.includes(row.domain)) count(out.notes, 'historyEvents.domain: missing or unknown, set to system');
        const statedActor = idOrNull(row.actorFamilyMemberId);
        const linkedActor = actorByLink.get(row.id) ?? null;
        if (statedActor && linkedActor && statedActor !== linkedActor) count(out.notes, 'historyEvents: the actor link and the actor id disagree, the id kept');
        const actor = statedActor ?? linkedActor;
        if (actor && !members.has(actor)) count(out.notes, 'historyEvents: done by someone no longer in the family, actor left empty');
        kept.add(row.id);
        out.tables.history_events.push({
            id: row.id,
            occurred_at: occurredAt,
            domain: HISTORY_DOMAINS.includes(row.domain) ? row.domain : 'system',
            action_type: trimmed(row.actionType) || 'unknown',
            summary: typeof row.summary === 'string' ? row.summary : '',
            source: optionalText(row.source),
            actor_id: actor && members.has(actor) ? actor : null,
            chore_id: idOrNull(row.choreId),
            task_series_id: idOrNull(row.taskSeriesId),
            task_id: idOrNull(row.taskId),
            calendar_item_id: idOrNull(row.calendarItemId),
            allowance_transaction_id: idOrNull(row.allowanceTransactionId),
            message_thread_id: idOrNull(row.messageThreadId),
            message_id: idOrNull(row.messageId) ?? idOrNull(Array.isArray(row.message) ? row.message[0] : row.message),
            scheduled_for: day(row.scheduledForDate, out.notes, 'historyEvents.scheduledForDate'),
            restore_timing: optionalText(row.restoreTiming),
            metadata: isRecord(row.metadata) ? row.metadata : {},
        });
    }
    const affected = pairs(rowsOf, ['historyEvents', 'affectedFamilyMembers'], ['familyMembers', 'affectedHistoryEvents']);
    for (const [event, member] of affected) {
        if (kept.has(event) && members.has(member)) out.tables.history_event_members.push({ history_event_id: event, family_member_id: member });
    }
}

function hold(out, entity, row, reason) {
    (out.heldBack[entity] ??= []).push({ reason, row });
}

/** Attributes stored on an entity that the mapping neither carries nor deliberately leaves behind. */
function unmappedAttributes(rowsOf, out) {
    const carried = {
        settings: ['name', 'value'],
        unitDefinitions: ['code', 'name', 'symbol', 'isMonetary', 'symbolPlacement', 'symbolSpacing', 'decimalPlaces'],
        familyMembers: [
            'name', 'role', 'email', 'color', 'photoUrls', 'order', 'pinHash', 'allowanceAmount', 'allowanceCurrency', 'allowanceRrule',
            'allowanceStartDate', 'allowancePayoutDelayDays', 'allowanceConfig', 'lastDisplayCurrency', 'viewShowChoreDescriptions',
            'viewShowTaskDetails', 'messageQuietHoursEnabled', 'messageQuietHoursStart', 'messageQuietHoursEnd', 'messageDigestMode',
            'messageDigestWindowMinutes',
        ],
        chores: [
            'title', 'description', 'startDate', 'rrule', 'exdates', 'pauseState', 'rotationType', 'isJoint', 'isUpForGrabs', 'hideFromDayList',
            'sortOrder', 'weight', 'rewardType', 'rewardAmount', 'rewardCurrency', 'estimatedDurationSecs', 'createdAt',
        ],
        choreAssignments: ['order'],
        choreCompletions: ['dateDue', 'dateCompleted', 'notDone', 'allowanceAwarded'],
        routines: ['name', 'onStepOverrun', 'sortOrder', 'createdAt'],
        routineSteps: ['position'],
        routineMarkerStatuses: ['date', 'markerKey', 'startedAt', 'startedById', 'completedAt', 'completedById'],
        countdownRuns: [
            'familyMemberId', 'date', 'routineId', 'status', 'currentChoreId', 'skippedChoreIds', 'startedAt', 'stepStartedAt',
            'stepExtensionSecs', 'stepExtensionCount', 'lastInteractionAt', 'stoppedAt', 'stoppedReason',
        ],
        historyEvents: [
            'occurredAt', 'domain', 'actionType', 'summary', 'source', 'actorFamilyMemberId', 'choreId', 'taskSeriesId', 'taskId', 'calendarItemId',
            'allowanceTransactionId', 'messageThreadId', 'messageId', 'scheduledForDate', 'restoreTiming', 'metadata',
        ],
    };
    for (const [entity, names] of Object.entries(carried)) {
        const known = new Set(['id', ...names, ...Object.keys(LEFT_BEHIND[entity] ?? {})]);
        const unknown = new Map();
        for (const row of rowsOf(entity)) {
            for (const [name, value] of Object.entries(row)) {
                // A link holds an id or a list of ids; those are read through `pairs`, not as attributes.
                if (known.has(name) || LINK_LABELS[entity]?.includes(name)) continue;
                if (value != null) unknown.set(name, (unknown.get(name) ?? 0) + 1);
            }
        }
        if (unknown.size) out.unmapped[entity] = Object.fromEntries(unknown);
    }
}

/** The link labels an export may carry on each of these entities. Other tables' links are theirs to map. */
const LINK_LABELS = {
    familyMembers: [
        'assignedChores', 'completedChores', 'choreAssignments', 'markedCompletions', 'actedHistoryEvents', 'actedTaskUpdates',
        'affectedHistoryEvents', 'affectedTaskUpdates', 'allowancePeriods', 'allowanceEnvelopes', 'authoredMessages', 'messageAcknowledgements',
        'messageReactions', 'messageThreadMemberships', 'pushDevices', 'calendarItems', 'taskSeries', 'dashboardConfig', 'createdContentQueueItems',
    ],
    chores: ['assignees', 'assignments', 'completions', 'routineSteps', 'taskSeries'],
    choreAssignments: ['familyMember', 'chore'],
    choreCompletions: ['chore', 'completedBy', 'markedBy'],
    routines: ['steps'],
    routineSteps: ['routine', 'chore'],
    // An event's attachments are a table of their own, mapped with the history area.
    historyEvents: ['actor', 'affectedFamilyMembers', 'attachments', 'message'],
};

/**
 * Turns an export into the rows of each table.
 * @param {(entity: string) => Array<Record<string, any>>} rowsOf every row of an entity as the export holds it
 */
export function buildRows(rowsOf) {
    const out = { tables: Object.fromEntries(TABLES.map((table) => [table, []])), heldBack: {}, notes: {}, unmapped: {} };
    settings(rowsOf, out);
    unitDefinitions(rowsOf, out);
    familyMembers(rowsOf, out);
    chores(rowsOf, out);
    choreAssignees(rowsOf, out);
    choreCompletions(rowsOf, out);
    routines(rowsOf, out);
    routineMarkerStatuses(rowsOf, out);
    countdownRuns(rowsOf, out);
    historyEvents(rowsOf, out);
    unmappedAttributes(rowsOf, out);
    return out;
}
