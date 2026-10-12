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
    'grade_types', 'task_series', 'tasks', 'task_attachments', 'task_response_fields', 'task_updates', 'task_update_attachments',
    'task_response_field_values',
    'allowance_envelopes', 'envelope_balances', 'allowance_transactions', 'exchange_rates',
    'announcements', 'content_categories', 'content_queue_items', 'family_rules', 'family_rule_versions', 'content_attachments',
    'family_dashboard_layouts', 'family_dashboard_widgets', 'dashboard_configs', 'history_event_attachments',
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
        'default_envelope_id',
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
    grade_types: [
        'id', 'name', 'kind', 'low_value', 'high_value', 'low_label', 'high_label', 'steps', 'is_default', 'sort_order', 'created_at', 'updated_at',
    ],
    task_series: [
        'id', 'name', 'description', 'family_member_id', 'chore_id', 'depends_on_series_id', 'start_date', 'target_end_date', 'planned_end_date',
        'baseline_day_break_count', 'work_ahead_allowed', 'pull_forward_count', 'break_type', 'break_start_date', 'break_delay_value',
        'break_delay_unit', 'created_at', 'updated_at',
    ],
    tasks: [
        'id', 'task_series_id', 'parent_task_id', 'title', 'notes', 'sort_order', 'indentation_level', 'is_day_break', 'weight', 'specific_time',
        'override_work_ahead', 'workflow_state', 'last_active_state', 'child_tasks_complete', 'completed_at', 'completed_on', 'deferred_until',
        'noted_until', 'is_noted_indefinitely', 'created_at', 'updated_at',
    ],
    task_attachments: [
        'id', 'task_id', 'name', 'type', 'url', 'kind', 'size_bytes', 'width', 'height', 'duration_sec', 'thumbnail_url', 'thumbnail_width',
        'thumbnail_height', 'blurhash', 'waveform_peaks', 'created_at', 'updated_at',
    ],
    task_response_fields: ['id', 'task_id', 'type', 'label', 'description', 'weight', 'required', 'sort_order', 'created_at', 'updated_at'],
    task_updates: [
        'id', 'task_id', 'actor_id', 'affected_person_id', 'reply_to_id', 'from_state', 'to_state', 'note', 'is_draft', 'scheduled_for',
        'restore_timing', 'grade_type_id', 'grade_numeric_value', 'grade_display_value', 'grade_is_provisional', 'created_at', 'updated_at',
    ],
    task_update_attachments: [
        'id', 'update_id', 'name', 'type', 'url', 'kind', 'size_bytes', 'width', 'height', 'duration_sec', 'thumbnail_url', 'thumbnail_width',
        'thumbnail_height', 'blurhash', 'waveform_peaks', 'created_at', 'updated_at',
    ],
    task_response_field_values: [
        'id', 'update_id', 'field_id', 'rich_text_content', 'file_url', 'file_name', 'file_type', 'file_size_bytes', 'thumbnail_url', 'created_at',
        'updated_at',
    ],
    allowance_envelopes: ['id', 'family_member_id', 'name', 'description', 'goal_amount', 'goal_currency', 'archived_at'],
    envelope_balances: ['envelope_id', 'currency', 'amount'],
    allowance_transactions: [
        'id', 'envelope_id', 'source_envelope_id', 'destination_envelope_id', 'transaction_type', 'amount', 'currency', 'description', 'created_by',
        'distribution_key', 'created_at',
    ],
    exchange_rates: ['base_currency', 'target_currency', 'rate', 'fetched_at'],
    announcements: ['id', 'title', 'rich_text_content', 'link_url', 'created_by', 'expires_at', 'archived_at', 'created_at', 'updated_at'],
    content_categories: ['id', 'slug', 'name', 'default_duration_ms', 'loop_when_empty', 'created_at', 'updated_at'],
    content_queue_items: [
        'id', 'category_id', 'title', 'rich_text_content', 'link_url', 'status', 'sort_order', 'duration_ms', 'live_at', 'live_until', 'archived_at',
        'created_by', 'created_at', 'updated_at',
    ],
    family_rules: ['id', 'title', 'sort_order', 'is_archived', 'active_version_id', 'created_at', 'updated_at'],
    family_rule_versions: ['id', 'rule_id', 'version_number', 'rich_text_content', 'edit_note', 'previous_version_id', 'created_by', 'created_at'],
    content_attachments: [
        'id', 'announcement_id', 'queue_item_id', 'rule_version_id', 'name', 'type', 'url', 'kind', 'size_bytes', 'width', 'height', 'duration_sec',
        'thumbnail_url', 'thumbnail_width', 'thumbnail_height', 'blurhash', 'waveform_peaks', 'created_at', 'updated_at',
    ],
    family_dashboard_layouts: ['id', 'breakpoint_key', 'label', 'min_width', 'max_width', 'sort_order', 'is_default', 'created_at', 'updated_at'],
    family_dashboard_widgets: ['id', 'layout_id', 'widget_type', 'x', 'y', 'w', 'h', 'z', 'config', 'created_at', 'updated_at'],
    dashboard_configs: ['family_member_id', 'widget_order', 'disabled_widgets', 'widget_settings', 'updated_at'],
    history_event_attachments: [
        'id', 'history_event_id', 'name', 'type', 'url', 'kind', 'size_bytes', 'width', 'height', 'duration_sec', 'thumbnail_url', 'thumbnail_width',
        'thumbnail_height', 'blurhash', 'waveform_peaks', 'created_at', 'updated_at',
    ],
};

/** Columns holding a JSON document. The importer hands these to Postgres as JSON text, whatever the value's shape. */
export const JSON_COLUMNS = {
    settings: ['value'],
    family_members: ['photo_urls', 'allowance_config'],
    chores: ['pause_state'],
    history_events: ['metadata'],
    grade_types: ['steps'],
    task_attachments: ['waveform_peaks'],
    task_update_attachments: ['waveform_peaks'],
    content_attachments: ['waveform_peaks'],
    family_dashboard_widgets: ['config'],
    dashboard_configs: ['widget_order', 'disabled_widgets', 'widget_settings'],
    history_event_attachments: ['waveform_peaks'],
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
    announcements: {
        isActive: 'It is showing while archived_at is empty.',
    },
    allowanceTransactions: {
        createdBy: 'The Instant principal that wrote it. The member who did is created_by.',
        updatedAt: 'A ledger row is never changed.',
    },
    exchangeRates: {
        pairKey: 'The two currencies are the key.',
    },
    tasks: {
        isCompleted: 'A task is done when its workflow state is done.',
        // Declared in the schema as a link, never stored, never read.
        prerequisites: 'Never used.',
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
/** When a row that must say when it was made never did. */
const EPOCH = new Date(0).toISOString();

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

/**
 * A calendar day that was stored as the instant its midnight fell on where the family lives: the day is the one whose
 * midnight, in UTC, is nearest. For a family east of Greenwich the UTC day of that instant is the day before, which
 * is why this is not `day`.
 */
function localDay(value, notes, what) {
    if (value == null || value === '') return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return count(notes, `${what}: not a date, left empty`), null;
    if (parsed.getTime() % 86_400_000 !== 0) count(notes, `${what}: a local midnight read as its own day`);
    return new Date(parsed.getTime() + 43_200_000).toISOString().slice(0, 10);
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
            // Filled in with the envelopes, below.
            default_envelope_id: null,
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
            created_at: instant(row.createdAt, out.notes, 'routines.createdAt') ?? EPOCH,
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
// ---- Money ----

function finance(rowsOf, out) {
    const members = new Map(out.tables.family_members.map((row) => [row.id, row]));
    const ownerOf = new Map(pairs(rowsOf, ['allowanceEnvelopes', 'familyMember'], ['familyMembers', 'allowanceEnvelopes']));
    const envelopes = new Set();
    for (const row of rowsOf('allowanceEnvelopes')) {
        const owner = members.has(ownerOf.get(row.id)) ? ownerOf.get(row.id) : null;
        // An envelope whose member has left is kept, with nobody's name on it, because its ledger is.
        if (!owner) count(out.notes, 'allowanceEnvelopes: its member is gone, kept as nobody\'s');
        const archivedAt = instant(row.archivedAt, out.notes, 'allowanceEnvelopes.archivedAt');
        envelopes.add(row.id);
        out.tables.allowance_envelopes.push({
            id: row.id,
            family_member_id: owner,
            name: trimmed(row.name) || 'Untitled',
            description: optionalText(row.description),
            goal_amount: optionalNumber(row.goalAmount),
            goal_currency: optionalText(row.goalCurrency),
            archived_at: archivedAt,
        });

        // One default for each member, where a flag on every envelope allowed several. The app takes the first it finds.
        if (row.isDefault === true && owner && !archivedAt) {
            const member = members.get(owner);
            if (member.default_envelope_id) count(out.notes, 'allowanceEnvelopes.isDefault: a member\'s second default, cleared');
            else member.default_envelope_id = row.id;
        }

        for (const [currency, amount] of Object.entries(isRecord(row.balances) ? row.balances : {})) {
            if (!trimmed(currency) || optionalNumber(amount) === null) { hold(out, 'allowanceEnvelopes', { id: row.id, balance: { [currency]: amount } }, 'A balance that is not an amount of a currency.'); continue; }
            out.tables.envelope_balances.push({ envelope_id: row.id, currency: trimmed(currency), amount });
        }
    }

    const envelopeOf = new Map(pairs(rowsOf, ['allowanceTransactions', 'envelope'], ['allowanceEnvelopes', 'transactions']));
    const sourceOf = new Map(pairs(rowsOf, ['allowanceTransactions', 'sourceEnvelope'], ['allowanceEnvelopes', 'outgoingTransfers']));
    const destinationOf = new Map(pairs(rowsOf, ['allowanceTransactions', 'destinationEnvelope'], ['allowanceEnvelopes', 'incomingTransfers']));
    const keys = new Set();
    for (const row of rowsOf('allowanceTransactions')) {
        const createdAt = instant(row.createdAt, out.notes, 'allowanceTransactions.createdAt');
        if (!envelopes.has(envelopeOf.get(row.id))) { hold(out, 'allowanceTransactions', row, 'It is in no envelope.'); continue; }
        if (optionalNumber(row.amount) === null || !trimmed(row.currency)) { hold(out, 'allowanceTransactions', row, 'It is not an amount of a currency.'); continue; }
        if (!createdAt) { hold(out, 'allowanceTransactions', row, 'It does not say when it happened.'); continue; }
        const key = optionalText(row.distributionKey);
        if (key && keys.has(key)) { hold(out, 'allowanceTransactions', row, 'Another payout already has its key.'); continue; }
        if (key) keys.add(key);
        for (const [label, linked] of [['sourceEnvelope', sourceOf.get(row.id)], ['destinationEnvelope', destinationOf.get(row.id)]]) {
            if (linked && !envelopes.has(linked)) count(out.notes, `allowanceTransactions.${label}: an envelope that no longer exists, left empty`);
        }
        out.tables.allowance_transactions.push({
            id: row.id,
            envelope_id: envelopeOf.get(row.id),
            source_envelope_id: envelopes.has(sourceOf.get(row.id)) ? sourceOf.get(row.id) : null,
            destination_envelope_id: envelopes.has(destinationOf.get(row.id)) ? destinationOf.get(row.id) : null,
            transaction_type: trimmed(row.transactionType) || 'unknown',
            amount: row.amount,
            currency: trimmed(row.currency),
            description: typeof row.description === 'string' ? row.description : '',
            created_by: members.has(row.createdByFamilyMemberId) ? row.createdByFamilyMemberId : null,
            distribution_key: key,
            created_at: createdAt,
        });
    }

    // One rate for each pair of currencies: the one fetched last.
    const rates = new Map();
    for (const row of rowsOf('exchangeRates')) {
        const fetchedAt = instant(row.lastFetchedTimestamp, out.notes, 'exchangeRates.lastFetchedTimestamp');
        const [base, target] = [trimmed(row.baseCurrency), trimmed(row.targetCurrency)];
        if (!base || !target || optionalNumber(row.rate) === null || !fetchedAt) { hold(out, 'exchangeRates', row, 'It is not a rate between two currencies at a time.'); continue; }
        const current = rates.get(`${base}\n${target}`);
        if (current) hold(out, 'exchangeRates', fetchedAt > current.next.fetched_at ? current.row : row, 'A later rate for the same pair is kept.');
        if (!current || fetchedAt > current.next.fetched_at) rates.set(`${base}\n${target}`, { row, next: { base_currency: base, target_currency: target, rate: row.rate, fetched_at: fetchedAt } });
    }
    for (const { next } of rates.values()) out.tables.exchange_rates.push(next);
}

// ---- What the family posts, the dashboards, and the files on a history entry ----

function content(rowsOf, out) {
    const members = new Set(out.tables.family_members.map((row) => row.id));
    const member = (id) => (members.has(id) ? id : null);

    const announcements = new Set();
    for (const row of rowsOf('announcements')) {
        const createdAt = instant(row.createdAt, out.notes, 'announcements.createdAt') ?? EPOCH;
        const updatedAt = instant(row.updatedAt, out.notes, 'announcements.updatedAt') ?? createdAt;
        let archivedAt = instant(row.archivedAt, out.notes, 'announcements.archivedAt');
        // Whether it is showing was a flag of its own beside the time it was taken down. The flag is what the app read.
        if (row.isActive === true && archivedAt) { count(out.notes, 'announcements: showing, though it had a time it was taken down, which is cleared'); archivedAt = null; }
        if (row.isActive !== true && !archivedAt) { count(out.notes, 'announcements: taken down at no recorded time, taken as when it last changed'); archivedAt = updatedAt; }
        announcements.add(row.id);
        out.tables.announcements.push({
            id: row.id,
            title: trimmed(row.title) || 'Untitled',
            rich_text_content: optionalText(row.richTextContent),
            link_url: optionalText(row.linkUrl),
            created_by: member(row.createdByFamilyMemberId),
            expires_at: instant(row.expiresAt, out.notes, 'announcements.expiresAt'),
            archived_at: archivedAt,
            created_at: createdAt,
            updated_at: updatedAt,
        });
    }

    const categories = new Set();
    const slugs = new Set();
    for (const row of rowsOf('contentCategories')) {
        const slugOf = trimmed(row.slug);
        if (!slugOf) { hold(out, 'contentCategories', row, 'It has no slug.'); continue; }
        if (slugs.has(slugOf)) { hold(out, 'contentCategories', row, 'Another category already has its slug.'); continue; }
        slugs.add(slugOf);
        categories.add(row.id);
        const createdAt = instant(row.createdAt, out.notes, 'contentCategories.createdAt') ?? EPOCH;
        out.tables.content_categories.push({
            id: row.id,
            slug: slugOf,
            name: trimmed(row.name) || slugOf,
            default_duration_ms: Math.max(0, optionalInteger(row.defaultDurationMs) ?? 0),
            loop_when_empty: row.loopWhenEmpty === true,
            created_at: createdAt,
            updated_at: instant(row.updatedAt, out.notes, 'contentCategories.updatedAt') ?? createdAt,
        });
    }

    const categoryOf = new Map(pairs(rowsOf, ['contentQueueItems', 'category'], ['contentCategories', 'items']));
    const itemMaker = new Map(pairs(rowsOf, ['contentQueueItems', 'createdBy'], ['familyMembers', 'createdContentQueueItems']));
    const items = new Set();
    for (const row of rowsOf('contentQueueItems')) {
        if (!categories.has(categoryOf.get(row.id))) { hold(out, 'contentQueueItems', row, 'It is in no category.'); continue; }
        const status = oneOf(row.status, ['queued', 'live', 'archived']);
        if (!status) { hold(out, 'contentQueueItems', row, 'It has no status the app knows.'); continue; }
        items.add(row.id);
        const createdAt = instant(row.createdAt, out.notes, 'contentQueueItems.createdAt') ?? EPOCH;
        out.tables.content_queue_items.push({
            id: row.id,
            category_id: categoryOf.get(row.id),
            title: trimmed(row.title) || 'Untitled',
            rich_text_content: optionalText(row.richTextContent),
            link_url: optionalText(row.linkUrl),
            status,
            sort_order: optionalInteger(row.sortOrder) ?? 0,
            duration_ms: Number.isInteger(row.durationMs) && row.durationMs >= 0 ? row.durationMs : null,
            live_at: instant(row.liveAt, out.notes, 'contentQueueItems.liveAt'),
            live_until: instant(row.liveUntil, out.notes, 'contentQueueItems.liveUntil'),
            archived_at: instant(row.archivedAt, out.notes, 'contentQueueItems.archivedAt'),
            created_by: member(itemMaker.get(row.id)),
            created_at: createdAt,
            updated_at: instant(row.updatedAt, out.notes, 'contentQueueItems.updatedAt') ?? createdAt,
        });
    }

    // A rule's words are its versions, numbered within it. A version of no rule, or a second with one number, cannot be held.
    const ruleOf = new Map(pairs(rowsOf, ['familyRuleVersions', 'rule'], ['familyRules', 'versions']));
    const previousOf = new Map(pairs(rowsOf, ['familyRuleVersions', 'previousVersion'], ['familyRuleVersions', 'nextVersion']));
    const allRules = new Set(rowsOf('familyRules').map((row) => row.id));
    const versionsOf = new Map();
    const numbered = new Set();
    for (const row of [...rowsOf('familyRuleVersions')].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id)))) {
        const rule = ruleOf.get(row.id);
        if (!allRules.has(rule)) { hold(out, 'familyRuleVersions', row, 'It is a version of no rule.'); continue; }
        if (!Number.isInteger(row.versionNumber) || row.versionNumber < 1) { hold(out, 'familyRuleVersions', row, 'It has no version number.'); continue; }
        if (numbered.has(`${rule}\n${row.versionNumber}`)) { hold(out, 'familyRuleVersions', row, 'Another version of the rule has its number.'); continue; }
        numbered.add(`${rule}\n${row.versionNumber}`);
        versionsOf.set(rule, [...(versionsOf.get(rule) ?? []), row]);
    }
    const versions = new Set();
    for (const row of rowsOf('familyRules')) {
        const own = versionsOf.get(row.id) ?? [];
        if (!own.length) { hold(out, 'familyRules', row, 'It has no version, so no words.'); continue; }
        // The version a rule reads as is one of its own. Where it named another, or none, the newest is taken.
        let active = own.find((version) => version.id === row.activeVersionId);
        if (!active) { count(out.notes, 'familyRules.activeVersionId: not a version of the rule, its newest taken'); active = own.reduce((a, b) => (b.versionNumber > a.versionNumber ? b : a)); }
        const createdAt = instant(row.createdAt, out.notes, 'familyRules.createdAt') ?? EPOCH;
        out.tables.family_rules.push({
            id: row.id,
            title: trimmed(row.title) || 'Untitled',
            sort_order: optionalInteger(row.sortOrder) ?? 0,
            is_archived: row.isArchived === true,
            active_version_id: active.id,
            created_at: createdAt,
            updated_at: instant(row.updatedAt, out.notes, 'familyRules.updatedAt') ?? createdAt,
        });
        for (const version of own) versions.add(version.id);
        for (const version of own) {
            const previous = previousOf.get(version.id);
            out.tables.family_rule_versions.push({
                id: version.id,
                rule_id: row.id,
                version_number: version.versionNumber,
                rich_text_content: typeof version.richTextContent === 'string' ? version.richTextContent : '',
                edit_note: optionalText(version.editNote),
                previous_version_id: own.some((other) => other.id === previous) && previous !== version.id ? previous : null,
                created_by: member(version.createdByFamilyMemberId),
                created_at: instant(version.createdAt, out.notes, 'familyRuleVersions.createdAt') ?? createdAt,
            });
        }
    }
    for (const [rule, own] of versionsOf) {
        if (!out.tables.family_rules.some((row) => row.id === rule)) for (const version of own) hold(out, 'familyRuleVersions', version, 'Its rule could not be held.');
    }

    // A file is on one thing: an announcement, a queue item, or a version of a rule.
    const onAnnouncement = new Map(pairs(rowsOf, ['contentAttachments', 'announcement'], ['announcements', 'attachments']));
    const onItem = new Map(pairs(rowsOf, ['contentAttachments', 'contentQueueItem'], ['contentQueueItems', 'attachments']));
    const onVersion = new Map(pairs(rowsOf, ['contentAttachments', 'familyRuleVersion'], ['familyRuleVersions', 'attachments']));
    for (const row of rowsOf('contentAttachments')) {
        const owners = {
            announcement_id: announcements.has(onAnnouncement.get(row.id)) ? onAnnouncement.get(row.id) : null,
            queue_item_id: items.has(onItem.get(row.id)) ? onItem.get(row.id) : null,
            rule_version_id: versions.has(onVersion.get(row.id)) ? onVersion.get(row.id) : null,
        };
        const named = Object.values(owners).filter(Boolean).length;
        if (named === 0) { hold(out, 'contentAttachments', row, 'What it was attached to no longer exists.'); continue; }
        if (named > 1) { hold(out, 'contentAttachments', row, 'It is attached to more than one thing.'); continue; }
        if (!trimmed(row.url)) { hold(out, 'contentAttachments', row, 'It names no file.'); continue; }
        out.tables.content_attachments.push({ id: row.id, ...owners, ...attachmentColumns(row, out.notes, 'contentAttachments') });
    }

    const layouts = new Set();
    const breakpoints = new Set();
    for (const row of rowsOf('familyDashboardLayouts')) {
        const key = trimmed(row.breakpointKey);
        if (!key) { hold(out, 'familyDashboardLayouts', row, 'It has no breakpoint.'); continue; }
        if (breakpoints.has(key)) { hold(out, 'familyDashboardLayouts', row, 'Another layout already covers its breakpoint.'); continue; }
        breakpoints.add(key);
        layouts.add(row.id);
        const createdAt = instant(row.createdAt, out.notes, 'familyDashboardLayouts.createdAt') ?? EPOCH;
        out.tables.family_dashboard_layouts.push({
            id: row.id,
            breakpoint_key: key,
            label: trimmed(row.label) || key,
            min_width: optionalInteger(row.minWidth) ?? 0,
            max_width: optionalInteger(row.maxWidth) ?? 0,
            sort_order: optionalInteger(row.order) ?? 0,
            is_default: row.isDefault === true,
            created_at: createdAt,
            updated_at: instant(row.updatedAt, out.notes, 'familyDashboardLayouts.updatedAt') ?? createdAt,
        });
    }
    const layoutOf = new Map(pairs(rowsOf, ['familyDashboardWidgets', 'layout'], ['familyDashboardLayouts', 'widgets']));
    for (const row of rowsOf('familyDashboardWidgets')) {
        if (!layouts.has(layoutOf.get(row.id))) { hold(out, 'familyDashboardWidgets', row, 'It is on no layout.'); continue; }
        if (!trimmed(row.widgetType) || [row.x, row.y, row.w, row.h].some((value) => optionalNumber(value) === null)) { hold(out, 'familyDashboardWidgets', row, 'It has no type or no place.'); continue; }
        const createdAt = instant(row.createdAt, out.notes, 'familyDashboardWidgets.createdAt') ?? EPOCH;
        out.tables.family_dashboard_widgets.push({
            id: row.id,
            layout_id: layoutOf.get(row.id),
            widget_type: trimmed(row.widgetType),
            x: row.x, y: row.y, w: row.w, h: row.h,
            z: optionalInteger(row.z) ?? 0,
            config: isRecord(row.config) ? row.config : null,
            created_at: createdAt,
            updated_at: instant(row.updatedAt, out.notes, 'familyDashboardWidgets.updatedAt') ?? createdAt,
        });
    }

    // One arrangement for each person. Of several, the one changed last is kept.
    const configMember = new Map(pairs(rowsOf, ['dashboardConfigs', 'familyMember'], ['familyMembers', 'dashboardConfig']));
    const configs = new Map();
    for (const row of rowsOf('dashboardConfigs')) {
        const owner = member(configMember.get(row.id));
        if (!owner) { hold(out, 'dashboardConfigs', row, 'It belongs to nobody in the family.'); continue; }
        const updatedAt = instant(row.updatedAt, out.notes, 'dashboardConfigs.updatedAt') ?? EPOCH;
        const current = configs.get(owner);
        if (current) hold(out, 'dashboardConfigs', updatedAt > current.next.updated_at ? current.row : row, 'Another arrangement for the same person is kept.');
        if (!current || updatedAt > current.next.updated_at) {
            configs.set(owner, { row, next: { family_member_id: owner, widget_order: row.widgetOrder ?? null, disabled_widgets: row.disabledWidgets ?? null, widget_settings: row.widgetSettings ?? null, updated_at: updatedAt } });
        }
    }
    for (const { next } of configs.values()) out.tables.dashboard_configs.push(next);

    const events = new Set(out.tables.history_events.map((row) => row.id));
    const eventOf = new Map(pairs(rowsOf, ['historyEventAttachments', 'event'], ['historyEvents', 'attachments']));
    for (const row of rowsOf('historyEventAttachments')) {
        if (!events.has(eventOf.get(row.id))) { hold(out, 'historyEventAttachments', row, 'Its history entry no longer exists.'); continue; }
        if (!trimmed(row.url)) { hold(out, 'historyEventAttachments', row, 'It names no file.'); continue; }
        out.tables.history_event_attachments.push({ id: row.id, history_event_id: eventOf.get(row.id), ...attachmentColumns(row, out.notes, 'historyEventAttachments') });
    }
}

// ---- Task series ----

const WORKFLOW_STATES = ['not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done'];

function gradeTypes(rowsOf, out) {
    let hasDefault = false;
    for (const row of [...rowsOf('gradeTypes')].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id)))) {
        const kind = oneOf(row.kind, ['number', 'letter', 'stars', 'freeform']);
        if (!kind) { hold(out, 'gradeTypes', row, 'It has no kind the app knows.'); continue; }
        // One scale is the default. Of several marked so, the first in order stays.
        const isDefault = row.isDefault === true && !hasDefault;
        const createdAt = instant(row.createdAt, out.notes, 'gradeTypes.createdAt') ?? EPOCH;
        if (row.isDefault === true && hasDefault) count(out.notes, 'gradeTypes.isDefault: a second default, cleared');
        hasDefault ||= isDefault;
        out.tables.grade_types.push({
            id: row.id,
            name: trimmed(row.name) || 'Untitled',
            kind,
            low_value: optionalNumber(row.lowValue) ?? 0,
            high_value: optionalNumber(row.highValue) ?? 0,
            low_label: typeof row.lowLabel === 'string' ? row.lowLabel : '',
            high_label: typeof row.highLabel === 'string' ? row.highLabel : '',
            steps: Array.isArray(row.steps) ? row.steps : null,
            is_default: isDefault,
            sort_order: optionalInteger(row.order) ?? 0,
            created_at: createdAt,
            updated_at: instant(row.updatedAt, out.notes, 'gradeTypes.updatedAt') ?? createdAt,
        });
    }
}

/** The columns every attachment table shares. */
function attachmentColumns(row, notes, entity) {
    const createdAt = instant(row.createdAt, notes, `${entity}.createdAt`) ?? EPOCH;
    return {
        name: trimmed(row.name) || 'Untitled',
        type: trimmed(row.type) || 'application/octet-stream',
        url: row.url,
        kind: optionalText(row.kind),
        size_bytes: optionalInteger(row.sizeBytes),
        width: optionalInteger(row.width),
        height: optionalInteger(row.height),
        duration_sec: optionalNumber(row.durationSec),
        thumbnail_url: optionalText(row.thumbnailUrl),
        thumbnail_width: optionalInteger(row.thumbnailWidth),
        thumbnail_height: optionalInteger(row.thumbnailHeight),
        blurhash: optionalText(row.blurhash),
        waveform_peaks: row.waveformPeaks ?? null,
        created_at: createdAt,
        updated_at: instant(row.updatedAt, notes, `${entity}.updatedAt`) ?? createdAt,
    };
}

const ATTACHMENT_ATTRIBUTES = [
    'name', 'type', 'url', 'kind', 'sizeBytes', 'width', 'height', 'durationSec', 'thumbnailUrl', 'thumbnailWidth', 'thumbnailHeight', 'blurhash',
    'waveformPeaks', 'createdAt', 'updatedAt',
];

function taskSeries(rowsOf, out) {
    const members = new Set(out.tables.family_members.map((row) => row.id));
    const chores = new Set(out.tables.chores.map((row) => row.id));
    const allSeries = new Set(rowsOf('taskSeries').map((row) => row.id));
    const memberOf = new Map(pairs(rowsOf, ['taskSeries', 'familyMember'], ['familyMembers', 'taskSeries']));
    const choreOf = new Map(pairs(rowsOf, ['taskSeries', 'scheduledActivity'], ['chores', 'taskSeries']));
    for (const row of rowsOf('taskSeries')) {
        const createdAt = instant(row.createdAt, out.notes, 'taskSeries.createdAt') ?? EPOCH;
        out.tables.task_series.push({
            id: row.id,
            name: trimmed(row.name) || 'Untitled',
            description: optionalText(row.description),
            family_member_id: members.has(memberOf.get(row.id)) ? memberOf.get(row.id) : null,
            chore_id: chores.has(choreOf.get(row.id)) ? choreOf.get(row.id) : null,
            depends_on_series_id: allSeries.has(row.dependsOnSeriesId) && row.dependsOnSeriesId !== row.id ? row.dependsOnSeriesId : null,
            start_date: localDay(row.startDate, out.notes, 'taskSeries.startDate'),
            target_end_date: localDay(row.targetEndDate, out.notes, 'taskSeries.targetEndDate'),
            planned_end_date: localDay(row.plannedEndDate, out.notes, 'taskSeries.plannedEndDate'),
            baseline_day_break_count: optionalInteger(row.baselineDayBreakCount),
            work_ahead_allowed: row.workAheadAllowed === true,
            pull_forward_count: Math.max(0, optionalInteger(row.pullForwardCount) ?? 0),
            break_type: optionalText(row.breakType),
            break_start_date: localDay(row.breakStartDate, out.notes, 'taskSeries.breakStartDate'),
            break_delay_value: optionalNumber(row.breakDelayValue),
            break_delay_unit: optionalText(row.breakDelayUnit),
            created_at: createdAt,
            updated_at: instant(row.updatedAt, out.notes, 'taskSeries.updatedAt') ?? createdAt,
        });
    }

    // A task belongs to one series. One that belongs to none can be reached from nowhere in the app.
    const seriesOf = new Map(pairs(rowsOf, ['tasks', 'taskSeries'], ['taskSeries', 'tasks']));
    const parentOf = new Map(pairs(rowsOf, ['tasks', 'parentTask'], ['tasks', 'subTasks']));
    const kept = new Set();
    for (const row of rowsOf('tasks')) {
        if (allSeries.has(seriesOf.get(row.id))) kept.add(row.id);
        else hold(out, 'tasks', row, 'It belongs to no series.');
    }
    for (const row of rowsOf('tasks')) {
        if (!kept.has(row.id)) continue;
        const state = oneOf(row.workflowState, WORKFLOW_STATES) ?? (row.isCompleted === true ? 'done' : 'not_started');
        if (!oneOf(row.workflowState, WORKFLOW_STATES)) count(out.notes, 'tasks.workflowState: not stored, taken from isCompleted');
        const parent = parentOf.get(row.id);
        const createdAt = instant(row.createdAt, out.notes, 'tasks.createdAt');
        const updatedAt = instant(row.updatedAt, out.notes, 'tasks.updatedAt');
        out.tables.tasks.push({
            id: row.id,
            task_series_id: seriesOf.get(row.id),
            // A sub-task's parent is a task of the same series, or it has none.
            parent_task_id: kept.has(parent) && parent !== row.id && seriesOf.get(parent) === seriesOf.get(row.id) ? parent : null,
            title: typeof row.text === 'string' ? row.text : '',
            notes: optionalText(row.notes),
            sort_order: optionalInteger(row.order) ?? 0,
            indentation_level: Math.max(0, optionalInteger(row.indentationLevel) ?? 0),
            is_day_break: row.isDayBreak === true,
            weight: optionalNumber(row.weight),
            specific_time: timeOfDay(row.specificTime, out.notes, 'tasks.specificTime'),
            override_work_ahead: optionalBoolean(row.overrideWorkAhead),
            workflow_state: state,
            // What the app assumes of a task that never said: it was last working where it is, or had not begun.
            last_active_state: oneOf(row.lastActiveState, ['not_started', 'in_progress']) ?? (state === 'in_progress' ? 'in_progress' : 'not_started'),
            child_tasks_complete: row.childTasksComplete !== false,
            completed_at: instant(row.completedAt, out.notes, 'tasks.completedAt'),
            completed_on: day(row.completedOnDate, out.notes, 'tasks.completedOnDate'),
            deferred_until: day(row.deferredUntilDate, out.notes, 'tasks.deferredUntilDate'),
            noted_until: day(row.notedUntilDate, out.notes, 'tasks.notedUntilDate'),
            is_noted_indefinitely: row.isNotedIndefinitely === true,
            created_at: createdAt ?? updatedAt ?? EPOCH,
            updated_at: updatedAt ?? createdAt ?? EPOCH,
        });
    }

    const attachmentTask = new Map(pairs(rowsOf, ['taskAttachments', 'task'], ['tasks', 'attachments']));
    for (const row of rowsOf('taskAttachments')) {
        if (!kept.has(attachmentTask.get(row.id))) { hold(out, 'taskAttachments', row, 'Its task no longer exists.'); continue; }
        if (!trimmed(row.url)) { hold(out, 'taskAttachments', row, 'It names no file.'); continue; }
        out.tables.task_attachments.push({ id: row.id, task_id: attachmentTask.get(row.id), ...attachmentColumns(row, out.notes, 'taskAttachments') });
    }

    const fieldTask = new Map(pairs(rowsOf, ['taskResponseFields', 'task'], ['tasks', 'responseFields']));
    const fields = new Set();
    for (const row of rowsOf('taskResponseFields')) {
        if (!kept.has(fieldTask.get(row.id))) { hold(out, 'taskResponseFields', row, 'Its task no longer exists.'); continue; }
        const type = oneOf(row.type, ['rich_text', 'photo', 'video', 'audio', 'file']);
        if (!type) { hold(out, 'taskResponseFields', row, 'It asks for a kind of response the app does not know.'); continue; }
        fields.add(row.id);
        const createdAt = instant(row.createdAt, out.notes, 'taskResponseFields.createdAt') ?? EPOCH;
        out.tables.task_response_fields.push({
            id: row.id,
            task_id: fieldTask.get(row.id),
            type,
            label: typeof row.label === 'string' ? row.label : '',
            description: optionalText(row.description),
            weight: optionalNumber(row.weight) ?? 0,
            required: row.required === true,
            sort_order: optionalInteger(row.order) ?? 0,
            created_at: createdAt,
            updated_at: instant(row.updatedAt, out.notes, 'taskResponseFields.updatedAt') ?? createdAt,
        });
    }

    const updateTask = new Map(pairs(rowsOf, ['taskUpdates', 'task'], ['tasks', 'updates']));
    const actorOf = new Map(pairs(rowsOf, ['taskUpdates', 'actor'], ['familyMembers', 'actedTaskUpdates']));
    const affectedOf = new Map(pairs(rowsOf, ['taskUpdates', 'affectedPerson'], ['familyMembers', 'affectedTaskUpdates']));
    const replyTo = new Map(pairs(rowsOf, ['taskUpdates', 'replyTo'], ['taskUpdates', 'replies']));
    const gradeOf = new Map(pairs(rowsOf, ['taskUpdates', 'gradeType'], ['gradeTypes', 'taskUpdates']));
    const grades = new Set(out.tables.grade_types.map((row) => row.id));
    const updates = new Set();
    for (const row of rowsOf('taskUpdates')) {
        if (!kept.has(updateTask.get(row.id))) { hold(out, 'taskUpdates', row, 'Its task no longer exists.'); continue; }
        const from = oneOf(row.fromState, WORKFLOW_STATES);
        const to = oneOf(row.toState, WORKFLOW_STATES);
        const scheduledFor = day(row.scheduledForDate, out.notes, 'taskUpdates.scheduledForDate');
        if (!from || !to) { hold(out, 'taskUpdates', row, 'It moves a task from or to a state the app does not know.'); continue; }
        if (!scheduledFor) { hold(out, 'taskUpdates', row, 'It has no day.'); continue; }
        updates.add(row.id);
    }
    for (const row of rowsOf('taskUpdates')) {
        if (!updates.has(row.id)) continue;
        const createdAt = instant(row.createdAt, out.notes, 'taskUpdates.createdAt') ?? EPOCH;
        const reply = replyTo.get(row.id);
        out.tables.task_updates.push({
            id: row.id,
            task_id: updateTask.get(row.id),
            actor_id: members.has(actorOf.get(row.id)) ? actorOf.get(row.id) : null,
            affected_person_id: members.has(affectedOf.get(row.id)) ? affectedOf.get(row.id) : null,
            reply_to_id: updates.has(reply) && reply !== row.id ? reply : null,
            from_state: row.fromState,
            to_state: row.toState,
            note: optionalText(row.note),
            is_draft: row.isDraft === true,
            scheduled_for: day(row.scheduledForDate, {}, ''),
            restore_timing: oneOf(row.restoreTiming, ['now', 'next_scheduled']),
            grade_type_id: grades.has(gradeOf.get(row.id)) ? gradeOf.get(row.id) : null,
            grade_numeric_value: optionalNumber(row.gradeNumericValue),
            grade_display_value: optionalText(row.gradeDisplayValue),
            grade_is_provisional: optionalBoolean(row.gradeIsProvisional),
            created_at: createdAt,
            updated_at: instant(row.updatedAt, out.notes, 'taskUpdates.updatedAt') ?? createdAt,
        });
    }

    const attachmentUpdate = new Map(pairs(rowsOf, ['taskUpdateAttachments', 'update'], ['taskUpdates', 'attachments']));
    for (const row of rowsOf('taskUpdateAttachments')) {
        if (!updates.has(attachmentUpdate.get(row.id))) { hold(out, 'taskUpdateAttachments', row, 'Its update no longer exists.'); continue; }
        if (!trimmed(row.url)) { hold(out, 'taskUpdateAttachments', row, 'It names no file.'); continue; }
        out.tables.task_update_attachments.push({
            id: row.id, update_id: attachmentUpdate.get(row.id), ...attachmentColumns(row, out.notes, 'taskUpdateAttachments'),
        });
    }

    const valueUpdate = new Map(pairs(rowsOf, ['taskResponseFieldValues', 'update'], ['taskUpdates', 'responseFieldValues']));
    const valueField = new Map(pairs(rowsOf, ['taskResponseFieldValues', 'field'], ['taskResponseFields', 'values']));
    const answered = new Set();
    const newestFirst = [...rowsOf('taskResponseFieldValues')].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || String(a.id).localeCompare(String(b.id)));
    for (const row of newestFirst) {
        const update = valueUpdate.get(row.id);
        const field = valueField.get(row.id);
        if (!updates.has(update)) { hold(out, 'taskResponseFieldValues', row, 'Its update no longer exists.'); continue; }
        if (!fields.has(field)) { hold(out, 'taskResponseFieldValues', row, 'The field it answers no longer exists.'); continue; }
        // One answer to a field with an update. Of several, the one written last is kept.
        if (answered.has(`${update}\n${field}`)) { hold(out, 'taskResponseFieldValues', row, 'A later answer to the same field came with the same update.'); continue; }
        answered.add(`${update}\n${field}`);
        const createdAt = instant(row.createdAt, out.notes, 'taskResponseFieldValues.createdAt') ?? EPOCH;
        out.tables.task_response_field_values.push({
            id: row.id,
            update_id: update,
            field_id: field,
            rich_text_content: typeof row.richTextContent === 'string' ? row.richTextContent : null,
            file_url: optionalText(row.fileUrl),
            file_name: optionalText(row.fileName),
            file_type: optionalText(row.fileType),
            file_size_bytes: optionalInteger(row.fileSizeBytes),
            thumbnail_url: optionalText(row.thumbnailUrl),
            created_at: createdAt,
            updated_at: instant(row.updatedAt, out.notes, 'taskResponseFieldValues.updatedAt') ?? createdAt,
        });
    }
}

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
        allowanceEnvelopes: ['name', 'description', 'goalAmount', 'goalCurrency', 'archivedAt', 'isDefault', 'balances'],
        allowanceTransactions: ['transactionType', 'amount', 'currency', 'description', 'createdByFamilyMemberId', 'distributionKey', 'createdAt'],
        exchangeRates: ['baseCurrency', 'targetCurrency', 'rate', 'lastFetchedTimestamp'],
        announcements: ['title', 'richTextContent', 'linkUrl', 'createdByFamilyMemberId', 'expiresAt', 'archivedAt', 'createdAt', 'updatedAt'],
        contentCategories: ['slug', 'name', 'defaultDurationMs', 'loopWhenEmpty', 'createdAt', 'updatedAt'],
        contentQueueItems: ['title', 'richTextContent', 'linkUrl', 'status', 'sortOrder', 'durationMs', 'liveAt', 'liveUntil', 'archivedAt', 'createdAt', 'updatedAt'],
        familyRules: ['title', 'sortOrder', 'isArchived', 'activeVersionId', 'createdAt', 'updatedAt'],
        familyRuleVersions: ['versionNumber', 'richTextContent', 'editNote', 'createdByFamilyMemberId', 'createdAt'],
        contentAttachments: ATTACHMENT_ATTRIBUTES,
        familyDashboardLayouts: ['breakpointKey', 'label', 'minWidth', 'maxWidth', 'order', 'isDefault', 'createdAt', 'updatedAt'],
        familyDashboardWidgets: ['widgetType', 'x', 'y', 'w', 'h', 'z', 'config', 'createdAt', 'updatedAt'],
        dashboardConfigs: ['widgetOrder', 'disabledWidgets', 'widgetSettings', 'updatedAt'],
        historyEventAttachments: ATTACHMENT_ATTRIBUTES,
        gradeTypes: ['name', 'kind', 'lowValue', 'highValue', 'lowLabel', 'highLabel', 'steps', 'isDefault', 'order', 'createdAt', 'updatedAt'],
        taskSeries: [
            'name', 'description', 'dependsOnSeriesId', 'startDate', 'targetEndDate', 'plannedEndDate', 'baselineDayBreakCount', 'workAheadAllowed',
            'pullForwardCount', 'breakType', 'breakStartDate', 'breakDelayValue', 'breakDelayUnit', 'createdAt', 'updatedAt',
        ],
        tasks: [
            'text', 'notes', 'order', 'indentationLevel', 'isDayBreak', 'weight', 'specificTime', 'overrideWorkAhead', 'workflowState',
            'lastActiveState', 'childTasksComplete', 'completedAt', 'completedOnDate', 'deferredUntilDate', 'notedUntilDate', 'isNotedIndefinitely',
            'createdAt', 'updatedAt',
        ],
        taskAttachments: ATTACHMENT_ATTRIBUTES,
        taskResponseFields: ['type', 'label', 'description', 'weight', 'required', 'order', 'createdAt', 'updatedAt'],
        taskUpdates: [
            'fromState', 'toState', 'note', 'isDraft', 'scheduledForDate', 'restoreTiming', 'gradeNumericValue', 'gradeDisplayValue',
            'gradeIsProvisional', 'createdAt', 'updatedAt',
        ],
        taskUpdateAttachments: ATTACHMENT_ATTRIBUTES,
        taskResponseFieldValues: ['richTextContent', 'fileUrl', 'fileName', 'fileType', 'fileSizeBytes', 'thumbnailUrl', 'createdAt', 'updatedAt'],
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
    allowanceEnvelopes: ['familyMember', 'transactions', 'incomingTransfers', 'outgoingTransfers'],
    allowanceTransactions: ['envelope', 'sourceEnvelope', 'destinationEnvelope'],
    announcements: ['attachments'],
    contentCategories: ['items'],
    contentQueueItems: ['category', 'createdBy', 'attachments'],
    familyRules: ['versions'],
    familyRuleVersions: ['rule', 'previousVersion', 'nextVersion', 'attachments'],
    contentAttachments: ['announcement', 'contentQueueItem', 'familyRuleVersion'],
    familyDashboardLayouts: ['widgets'],
    familyDashboardWidgets: ['layout'],
    dashboardConfigs: ['familyMember'],
    historyEventAttachments: ['event'],
    gradeTypes: ['taskUpdates'],
    taskSeries: ['familyMember', 'scheduledActivity', 'tasks'],
    tasks: ['taskSeries', 'parentTask', 'subTasks', 'subsequentTasks', 'attachments', 'responseFields', 'updates'],
    taskAttachments: ['task'],
    taskResponseFields: ['task', 'values'],
    taskUpdates: ['task', 'actor', 'affectedPerson', 'replyTo', 'replies', 'gradeType', 'attachments', 'responseFieldValues'],
    taskUpdateAttachments: ['update'],
    taskResponseFieldValues: ['update', 'field'],
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
    gradeTypes(rowsOf, out);
    taskSeries(rowsOf, out);
    finance(rowsOf, out);
    content(rowsOf, out);
    unmappedAttributes(rowsOf, out);
    return out;
}
