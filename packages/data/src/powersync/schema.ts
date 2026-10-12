import { column, Schema, Table } from '@powersync/common';

// The database a device keeps: one table for each that a sync stream sends, with the columns it sends.
//
// A device holds every value as SQLite does: a boolean as 0 or 1, a day as `YYYY-MM-DD`, an instant as ISO 8601
// text, a time of day as `HH:MM:SS.mmm`, and a JSON document or a list of days as JSON text. Each area's row
// mappers turn those into the app's own types. A contract test holds this file to powersync/sync-config.yaml.

const { text, integer, real } = column;

const settings = new Table({ value: text });

const unit_definitions = new Table({
    code: text, name: text, symbol: text, is_monetary: integer, symbol_placement: text, symbol_spacing: integer, decimal_places: integer,
});

const family_members = new Table({
    name: text, role: text, email: text, color: text, photo_urls: text, sort_order: integer, has_pin: integer,
    allowance_amount: real, allowance_currency: text, allowance_rrule: text, allowance_start_date: text,
    allowance_payout_delay_days: integer, allowance_config: text,
    last_display_currency: text, view_show_chore_descriptions: integer, view_show_task_details: integer,
    message_quiet_hours_enabled: integer, message_quiet_hours_start: text, message_quiet_hours_end: text,
    message_digest_mode: text, message_digest_window_minutes: integer, default_envelope_id: text,
});

const chores = new Table({
    title: text, description: text, start_date: text, rrule: text, exdates: text, pause_state: text,
    rotation_type: text, is_joint: integer, is_up_for_grabs: integer, hide_from_day_list: integer, sort_order: integer,
    weight: real, reward_type: text, reward_amount: real, reward_currency: text, estimated_duration_secs: integer,
    timing_mode: text, timing_window_key: text, timing_time: text, timing_start_time: text, timing_end_time: text,
    timing_marker_key: text, timing_chore_id: text, timing_event: text, timing_fallback_time: text, created_at: text,
});

const chore_assignees = new Table(
    { chore_id: text, family_member_id: text, position: integer },
    { indexes: { chore: ['chore_id'], member: ['family_member_id'] } }
);

const chore_completions = new Table(
    { chore_id: text, completed_by: text, marked_by: text, date_due: text, completed_at: text, not_done: integer, allowance_awarded: integer },
    // A day's completions are found by the day; one chore's on a day by both together.
    { indexes: { day: ['date_due'], chore_day: ['chore_id', 'date_due'] } }
);

const routines = new Table({ name: text, on_step_overrun: text, sort_order: integer, created_at: text });

const routine_steps = new Table({ routine_id: text, chore_id: text, position: integer }, { indexes: { routine: ['routine_id'], chore: ['chore_id'] } });

const routine_marker_statuses = new Table(
    { day: text, marker_key: text, started_at: text, started_by: text, completed_at: text, completed_by: text },
    { indexes: { day: ['day'] } }
);

const countdown_runs = new Table(
    {
        family_member_id: text, day: text, routine_id: text, status: text, current_chore_id: text, skipped_chore_ids: text, started_at: text,
        step_started_at: text, step_extension_secs: integer, step_extension_count: integer, last_interaction_at: text, stopped_at: text,
        stopped_reason: text,
    },
    { indexes: { member_day: ['family_member_id', 'day'] } }
);

const history_events = new Table(
    {
        occurred_at: text, domain: text, action_type: text, summary: text, source: text, actor_id: text, chore_id: text, task_series_id: text,
        task_id: text, calendar_item_id: text, allowance_transaction_id: text, message_thread_id: text, message_id: text, scheduled_for: text,
        restore_timing: text, metadata: text,
    },
    { indexes: { occurred: ['occurred_at'] } }
);

const history_event_members = new Table(
    { history_event_id: text, family_member_id: text },
    { indexes: { event: ['history_event_id'], member: ['family_member_id'] } }
);

const grade_types = new Table({
    name: text, kind: text, low_value: real, high_value: real, low_label: text, high_label: text, steps: text, is_default: integer,
    sort_order: integer, created_at: text, updated_at: text,
});

const task_series = new Table(
    {
        name: text, description: text, family_member_id: text, chore_id: text, depends_on_series_id: text, start_date: text, target_end_date: text,
        planned_end_date: text, baseline_day_break_count: integer, work_ahead_allowed: integer, pull_forward_count: integer, break_type: text,
        break_start_date: text, break_delay_value: real, break_delay_unit: text, created_at: text, updated_at: text,
    },
    { indexes: { chore: ['chore_id'], member: ['family_member_id'] } }
);

const tasks = new Table(
    {
        task_series_id: text, parent_task_id: text, title: text, notes: text, sort_order: integer, indentation_level: integer, is_day_break: integer,
        weight: real, specific_time: text, override_work_ahead: integer, workflow_state: text, last_active_state: text, child_tasks_complete: integer,
        completed_at: text, completed_on: text, deferred_until: text, noted_until: text, is_noted_indefinitely: integer, created_at: text,
        updated_at: text,
    },
    { indexes: { series: ['task_series_id', 'sort_order'], parent: ['parent_task_id'] } }
);

const task_attachments = new Table(
    {
        task_id: text, name: text, type: text, url: text, kind: text, size_bytes: integer, width: integer, height: integer, duration_sec: real,
        thumbnail_url: text, thumbnail_width: integer, thumbnail_height: integer, blurhash: text, waveform_peaks: text, created_at: text, updated_at: text,
    },
    { indexes: { task: ['task_id'] } }
);

const task_response_fields = new Table(
    {
        task_id: text, type: text, label: text, description: text, weight: real, required: integer, sort_order: integer, created_at: text,
        updated_at: text,
    },
    { indexes: { task: ['task_id'] } }
);

const task_updates = new Table(
    {
        task_id: text, actor_id: text, affected_person_id: text, reply_to_id: text, from_state: text, to_state: text, note: text, is_draft: integer,
        scheduled_for: text, restore_timing: text, grade_type_id: text, grade_numeric_value: real, grade_display_value: text,
        grade_is_provisional: integer, created_at: text, updated_at: text,
    },
    { indexes: { task: ['task_id', 'created_at'], reply: ['reply_to_id'] } }
);

const task_update_attachments = new Table(
    {
        update_id: text, name: text, type: text, url: text, kind: text, size_bytes: integer, width: integer, height: integer, duration_sec: real,
        thumbnail_url: text, thumbnail_width: integer, thumbnail_height: integer, blurhash: text, waveform_peaks: text, created_at: text, updated_at: text,
    },
    { indexes: { update: ['update_id'] } }
);

const task_response_field_values = new Table(
    {
        update_id: text, field_id: text, rich_text_content: text, file_url: text, file_name: text, file_type: text, file_size_bytes: integer,
        thumbnail_url: text, created_at: text, updated_at: text,
    },
    { indexes: { update: ['update_id'], field: ['field_id'] } }
);

const allowance_envelopes = new Table(
    {
        family_member_id: text, name: text, description: text, goal_amount: real, goal_currency: text, archived_at: text,
    },
    { indexes: { member: ['family_member_id'] } }
);

const envelope_balances = new Table({ envelope_id: text, currency: text, amount: real }, { indexes: { envelope: ['envelope_id'] } });

const allowance_transactions = new Table(
    {
        envelope_id: text, source_envelope_id: text, destination_envelope_id: text, transaction_type: text, amount: real, currency: text,
        description: text, created_by: text, distribution_key: text, created_at: text,
    },
    { indexes: { envelope: ['envelope_id', 'created_at'] } }
);

const exchange_rates = new Table({ base_currency: text, target_currency: text, rate: real, fetched_at: text });

const write_refusals = new Table({
    family_member_id: text, mutation: text, reason: text, table_name: text, row_id: text, refused_at: text, dismissed_at: text,
});

/**
 * Not data: the name a mutation gives its own transaction. One row is written with every local transaction and
 * travels with its upload, so the server can tell a transaction it has seen from one it has not. Nothing is kept
 * of it on the device.
 */
const local_transactions = new Table({ mutation: text }, { insertOnly: true });

export const AppSchema = new Schema({
    settings, unit_definitions, family_members, chores, chore_assignees, chore_completions, routines, routine_steps, routine_marker_statuses,
    countdown_runs, history_events, history_event_members,
    grade_types, task_series, tasks, task_attachments, task_response_fields, task_updates, task_update_attachments, task_response_field_values,
    allowance_envelopes, envelope_balances, allowance_transactions, exchange_rates,
    write_refusals, local_transactions,
});

/** The device's tables as typed SQL sees them. */
export type ClientDatabase = (typeof AppSchema)['types'];

/** The table that names transactions. It is never sent as a write of its own. */
export const TRANSACTION_TABLE = 'local_transactions';
