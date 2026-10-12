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
    message_digest_mode: text, message_digest_window_minutes: integer,
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
    write_refusals, local_transactions,
});

/** The device's tables as typed SQL sees them. */
export type ClientDatabase = (typeof AppSchema)['types'];

/** The table that names transactions. It is never sent as a write of its own. */
export const TRANSACTION_TABLE = 'local_transactions';
