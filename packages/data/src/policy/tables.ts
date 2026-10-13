import type { Principal } from '../session/principal';
import type { ColumnRule, Row, TablePolicy, Verdict } from './types';

// The write rules: for each table a device may write, who may insert, change and delete a row.
//
// They start from instant.perms.ts and keep every ability a person has today. docs/powersync-migration.md, "The
// write rules", lists the few places where they are deliberately stricter. A table that is not here cannot be
// written from a device at all: money, messages and everything the server keeps for itself.
//
// Each rule is a pure function of who is asking and the row, so the same file answers at once on the device and
// with authority on the server.

const text: ColumnRule = { kind: 'text' };
const uuid: ColumnRule = { kind: 'uuid' };
const boolean: ColumnRule = { kind: 'boolean' };
const integer: ColumnRule = { kind: 'integer' };
const number: ColumnRule = { kind: 'number' };
const day: ColumnRule = { kind: 'day' };
const instant: ColumnRule = { kind: 'instant' };
const time: ColumnRule = { kind: 'time' };
const json: ColumnRule = { kind: 'json' };
const oneOf = (...words: string[]): ColumnRule => ({ kind: 'text', oneOf: words });

const isParent = (principal: Principal) => principal.type === 'parent';
/** The family member a kid session is signed in as. The shared kid session is nobody, and owns nothing. */
const kidSelf = (principal: Principal) => (principal.type === 'kid' ? principal.familyMemberId : null);

const parentsOnly = (principal: Principal): Verdict => (isParent(principal) ? null : 'not_allowed');
const nobody = (): Verdict => 'not_allowed';
const only = (changed: readonly string[], allowed: readonly string[]) => changed.every((column) => allowed.includes(column));

/** Parents write it; everyone else only reads it. */
const parentsWrite = { insert: parentsOnly, update: parentsOnly, delete: parentsOnly };

const anyone = (): Verdict => null;
/** Anyone signed in writes it: a parent, a kid, or the kid session a shared device rests on. */
const familyWrites = { insert: anyone, update: anyone, delete: anyone };

/** What a kid may change on their own row: how the app looks and behaves for them, and which envelope is their default. */
const OWN_PREFERENCES = [
    'last_display_currency', 'view_show_chore_descriptions', 'view_show_task_details', 'message_quiet_hours_enabled',
    'message_quiet_hours_start', 'message_quiet_hours_end', 'message_digest_mode', 'message_digest_window_minutes',
    'default_envelope_id',
] as const;

export const POLICY = {
    settings: {
        key: ['name'],
        columns: { name: text, value: json },
        ...parentsWrite,
    },

    unit_definitions: {
        key: ['id'],
        columns: { id: uuid, code: text, name: text, symbol: text, is_monetary: boolean, symbol_placement: oneOf('before', 'after'), symbol_spacing: boolean, decimal_places: integer },
        ...parentsWrite,
    },

    family_members: {
        key: ['id'],
        // No PIN: its hash is set by the server and never comes from a device.
        columns: {
            id: uuid, name: text, role: oneOf('parent', 'child'), email: text, color: text, photo_urls: json, sort_order: integer,
            allowance_amount: number, allowance_currency: text, allowance_rrule: text, allowance_start_date: day,
            allowance_payout_delay_days: integer, allowance_config: json,
            last_display_currency: text, view_show_chore_descriptions: boolean, view_show_task_details: boolean,
            message_quiet_hours_enabled: boolean, message_quiet_hours_start: time, message_quiet_hours_end: time,
            message_digest_mode: oneOf('immediate', 'digest'), message_digest_window_minutes: integer,
            // The database holds this to an envelope of the member's own.
            default_envelope_id: uuid,
        },
        insert: parentsOnly,
        update(principal, current, _next, changed) {
            if (isParent(principal)) return null;
            if (kidSelf(principal) === null) return 'not_allowed';
            if (current.id !== kidSelf(principal)) return 'not_yours';
            return only(changed, OWN_PREFERENCES) ? null : 'column_not_allowed';
        },
        delete: parentsOnly,
    },

    chores: {
        key: ['id'],
        columns: {
            id: uuid, title: text, description: text, start_date: day, rrule: text, exdates: { kind: 'days' }, pause_state: json,
            rotation_type: oneOf('none', 'daily', 'weekly', 'monthly'), is_joint: boolean, is_up_for_grabs: boolean, hide_from_day_list: boolean,
            sort_order: integer, weight: number, reward_type: oneOf('fixed', 'weight'), reward_amount: number, reward_currency: text,
            estimated_duration_secs: integer,
            timing_mode: oneOf('anytime', 'named_window', 'before_time', 'after_time', 'between_times', 'before_marker', 'after_marker', 'before_chore', 'after_chore'),
            timing_window_key: text, timing_time: time, timing_start_time: time, timing_end_time: time, timing_marker_key: text,
            timing_chore_id: uuid, timing_event: oneOf('started', 'completed'), timing_fallback_time: time, created_at: instant,
        },
        ...parentsWrite,
    },

    chore_assignees: {
        key: ['chore_id', 'family_member_id'],
        columns: { chore_id: uuid, family_member_id: uuid, position: integer },
        ...parentsWrite,
    },

    chore_completions: {
        key: ['id'],
        columns: { id: uuid, chore_id: uuid, completed_by: uuid, marked_by: uuid, date_due: day, completed_at: instant, not_done: boolean, allowance_awarded: boolean },
        insert(principal, next) {
            if (isParent(principal)) return null;
            const self = kidSelf(principal);
            if (self === null) return 'not_allowed';
            // A kid records their own work, as themselves, and cannot say it has been paid for.
            if (next.completed_by !== self || (next.marked_by != null && next.marked_by !== self)) return 'not_yours';
            return next.allowance_awarded === true ? 'column_not_allowed' : null;
        },
        update(principal, current, next, changed) {
            // Which chore and which day a completion is for never change.
            if (changed.includes('chore_id') || changed.includes('date_due')) return 'column_not_allowed';
            // A completion that stands belongs to whoever completed it, whoever is asking. This is what makes the
            // first claim on an up-for-grabs chore win: a second device's claim finds the first's row here.
            if (current.completed_at != null && changed.includes('completed_by')) return 'already_claimed';
            if (isParent(principal)) return null;
            const self = kidSelf(principal);
            if (self === null) return 'not_allowed';
            if (current.completed_by === self) return only(changed, ['completed_at', 'not_done']) ? null : 'column_not_allowed';
            // Someone else's completion. A kid may take it only once it has been cleared, and only for themselves:
            // a chore someone ticked and un-ticked is free to be done by another.
            const cleared = current.completed_at == null && current.not_done !== true;
            if (!cleared || next.completed_by !== self || (next.marked_by != null && next.marked_by !== self)) return 'not_yours';
            return only(changed, ['completed_by', 'marked_by', 'completed_at', 'not_done']) ? null : 'column_not_allowed';
        },
        delete: parentsOnly,
    },

    routines: {
        key: ['id'],
        columns: { id: uuid, name: text, on_step_overrun: oneOf('wait', 'advance'), sort_order: integer, created_at: instant },
        ...parentsWrite,
    },

    routine_steps: {
        key: ['routine_id', 'chore_id'],
        columns: { routine_id: uuid, chore_id: uuid, position: integer },
        ...parentsWrite,
    },

    routine_marker_statuses: {
        key: ['day', 'marker_key'],
        columns: { day, marker_key: text, started_at: instant, started_by: uuid, completed_at: instant, completed_by: uuid },
        ...parentsWrite,
    },

    countdown_runs: {
        key: ['id'],
        columns: {
            id: uuid, family_member_id: uuid, day, routine_id: uuid, status: oneOf('running', 'stopped'), current_chore_id: uuid,
            skipped_chore_ids: { kind: 'uuids' }, started_at: instant, step_started_at: instant, step_extension_secs: integer,
            step_extension_count: integer, last_interaction_at: instant, stopped_at: instant, stopped_reason: text,
        },
        // A kid runs their own countdown and nobody else's.
        insert(principal, next) {
            if (isParent(principal)) return null;
            const self = kidSelf(principal);
            if (self === null) return 'not_allowed';
            return next.family_member_id === self ? null : 'not_yours';
        },
        update(principal, current, _next, changed) {
            // Whose run it is, and for which day, never change.
            if (changed.includes('family_member_id') || changed.includes('day')) return 'column_not_allowed';
            if (isParent(principal)) return null;
            const self = kidSelf(principal);
            if (self === null) return 'not_allowed';
            return current.family_member_id === self ? null : 'not_yours';
        },
        delete: parentsOnly,
    },

    // The record of what happened is added to and never changed.
    grade_types: {
        key: ['id'],
        columns: {
            id: uuid, name: text, kind: oneOf('number', 'letter', 'stars', 'freeform'), low_value: number, high_value: number, low_label: text,
            high_label: text, steps: json, is_default: boolean, sort_order: integer, created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    task_series: {
        key: ['id'],
        columns: {
            id: uuid, name: text, description: text, family_member_id: uuid, chore_id: uuid, depends_on_series_id: uuid, start_date: day,
            target_end_date: day, planned_end_date: day, baseline_day_break_count: integer, work_ahead_allowed: boolean, pull_forward_count: integer,
            break_type: text, break_start_date: day, break_delay_value: number, break_delay_unit: text, created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    tasks: {
        key: ['id'],
        columns: {
            id: uuid, task_series_id: uuid, parent_task_id: uuid, title: text, notes: text, sort_order: integer, indentation_level: integer,
            is_day_break: boolean, weight: number, specific_time: time, override_work_ahead: boolean,
            workflow_state: oneOf('not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done'),
            last_active_state: oneOf('not_started', 'in_progress'), child_tasks_complete: boolean, completed_at: instant, completed_on: day,
            deferred_until: day, noted_until: day, is_noted_indefinitely: boolean, created_at: instant, updated_at: instant,
        },
        // Which series a task belongs to is the parent's to say, as joining the two is today. A kid works through
        // the tasks that are there.
        insert: parentsOnly,
        update: (principal, _current, _next, changed) => (!isParent(principal) && changed.includes('task_series_id') ? 'column_not_allowed' : null),
        delete: anyone,
    },

    task_attachments: {
        key: ['id'],
        columns: {
            id: uuid, task_id: uuid, name: text, type: text, url: text, kind: text, size_bytes: integer, width: integer, height: integer,
            duration_sec: number, thumbnail_url: text, thumbnail_width: integer, thumbnail_height: integer, blurhash: text, waveform_peaks: json,
            created_at: instant, updated_at: instant,
        },
        ...familyWrites,
    },

    task_response_fields: {
        key: ['id'],
        columns: {
            id: uuid, task_id: uuid, type: oneOf('rich_text', 'photo', 'video', 'audio', 'file'), label: text, description: text, weight: number,
            required: boolean, sort_order: integer, created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    task_updates: {
        key: ['id'],
        columns: {
            id: uuid, task_id: uuid, actor_id: uuid, affected_person_id: uuid, reply_to_id: uuid,
            from_state: oneOf('not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done'),
            to_state: oneOf('not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done'), note: text, is_draft: boolean,
            scheduled_for: day, restore_timing: oneOf('now', 'next_scheduled'), grade_type_id: uuid, grade_numeric_value: number,
            grade_display_value: text, grade_is_provisional: boolean, created_at: instant, updated_at: instant,
        },
        ...familyWrites,
    },

    task_update_attachments: {
        key: ['id'],
        columns: {
            id: uuid, update_id: uuid, name: text, type: text, url: text, kind: text, size_bytes: integer, width: integer, height: integer,
            duration_sec: number, thumbnail_url: text, thumbnail_width: integer, thumbnail_height: integer, blurhash: text, waveform_peaks: json,
            created_at: instant, updated_at: instant,
        },
        ...familyWrites,
    },

    task_response_field_values: {
        key: ['id'],
        columns: {
            id: uuid, update_id: uuid, field_id: uuid, rich_text_content: text, file_url: text, file_name: text, file_type: text,
            file_size_bytes: integer, thumbnail_url: text, created_at: instant, updated_at: instant,
        },
        ...familyWrites,
    },

    // Money is written by the server. What is left to a device is what an envelope is called and what it is
    // saving for: a parent on any envelope, a kid on their own. Whose it is, and whether it is archived, are not
    // columns a device may send at all, and neither a balance nor a ledger row is in this file.
    allowance_envelopes: {
        key: ['id'],
        columns: { id: uuid, name: text, description: text, goal_amount: number, goal_currency: text },
        insert: nobody,
        update(principal, current) {
            if (isParent(principal)) return null;
            const self = kidSelf(principal);
            if (self === null) return 'not_allowed';
            return current.family_member_id === self ? null : 'not_yours';
        },
        delete: nobody,
    },

    exchange_rates: {
        key: ['base_currency', 'target_currency'],
        columns: { base_currency: text, target_currency: text, rate: number, fetched_at: instant },
        ...parentsWrite,
    },

    announcements: {
        key: ['id'],
        columns: {
            id: uuid, title: text, rich_text_content: text, link_url: text, created_by: uuid, expires_at: instant, archived_at: instant,
            created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    content_categories: {
        key: ['id'],
        columns: {
            id: uuid, slug: text, name: text, default_duration_ms: integer, loop_when_empty: boolean, created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    content_queue_items: {
        key: ['id'],
        columns: {
            id: uuid, category_id: uuid, title: text, rich_text_content: text, link_url: text, status: oneOf('queued', 'live', 'archived'),
            sort_order: integer, duration_ms: integer, live_at: instant, live_until: instant, archived_at: instant, created_by: uuid,
            created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    family_rules: {
        key: ['id'],
        columns: {
            id: uuid, title: text, sort_order: integer, is_archived: boolean, active_version_id: uuid, created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    family_rule_versions: {
        key: ['id'],
        columns: {
            id: uuid, rule_id: uuid, version_number: integer, rich_text_content: text, edit_note: text, previous_version_id: uuid, created_by: uuid,
            created_at: instant,
        },
        // A rule's words are kept as they were. A parent writes a new version; nobody changes or removes an old one.
        insert: parentsOnly,
        update: nobody,
        delete: nobody,
    },

    content_attachments: {
        key: ['id'],
        columns: {
            id: uuid, announcement_id: uuid, queue_item_id: uuid, rule_version_id: uuid, name: text, type: text, url: text, kind: text,
            size_bytes: integer, width: integer, height: integer, duration_sec: number, thumbnail_url: text, thumbnail_width: integer,
            thumbnail_height: integer, blurhash: text, waveform_peaks: json, created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    family_dashboard_layouts: {
        key: ['id'],
        columns: {
            id: uuid, breakpoint_key: text, label: text, min_width: integer, max_width: integer, sort_order: integer, is_default: boolean,
            created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    family_dashboard_widgets: {
        key: ['id'],
        columns: {
            id: uuid, layout_id: uuid, widget_type: text, x: number, y: number, w: number, h: number, z: integer, config: json, created_at: instant,
            updated_at: instant,
        },
        ...parentsWrite,
    },

    dashboard_configs: {
        key: ['family_member_id'],
        columns: {
            family_member_id: uuid, widget_order: json, disabled_widgets: json, widget_settings: json, updated_at: instant,
        },
        ...familyWrites,
    },

    history_event_attachments: {
        key: ['id'],
        columns: {
            id: uuid, history_event_id: uuid, name: text, type: text, url: text, kind: text, size_bytes: integer, width: integer, height: integer,
            duration_sec: number, thumbnail_url: text, thumbnail_width: integer, thumbnail_height: integer, blurhash: text, waveform_peaks: json,
            created_at: instant, updated_at: instant,
        },
        // Like the entry it is on: added by anyone signed in, and never changed or removed.
        insert: anyone,
        update: nobody,
        delete: nobody,
    },



    calendar_tags: {
        key: ['id'],
        columns: {
            id: uuid, name: text, created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    calendar_items: {
        key: ['id'],
        columns: {
            id: uuid, title: text, description: text, location: text, url: text, start_date: day, end_date: day, starts_at: instant, ends_at: instant,
            time_zone: text, status: oneOf('tentative', 'confirmed', 'cancelled'), event_type: text, visibility: text,
            transparency: oneOf('opaque', 'transparent'), priority: integer, uid: text, sequence: integer, dtstamp: instant, last_modified: instant,
            rrule: text, rdates: { kind: 'texts' }, exdates: { kind: 'texts' }, recurring_event_id: uuid, recurrence_id: text,
            recurrence_id_range: text, organizer: json, attendees: json, alarms: json, x_props: json, travel_duration_before_minutes: integer,
            travel_duration_after_minutes: integer, source_type: text, source_read_only: boolean,
            source_sync_status: oneOf('active', 'cancelled', 'deleted-remote'), source_calendar_name: text, source_external_id: text,
            source_remote_url: text, created_at: instant, updated_at: instant,
        },
        ...parentsWrite,
    },

    calendar_item_members: {
        key: ['calendar_item_id', 'family_member_id'],
        columns: {
            calendar_item_id: uuid, family_member_id: uuid,
        },
        ...parentsWrite,
    },

    calendar_item_tags: {
        key: ['calendar_item_id', 'tag_id'],
        columns: {
            calendar_item_id: uuid, tag_id: uuid,
        },
        ...parentsWrite,
    },

    history_events: {
        key: ['id'],
        columns: {
            id: uuid, occurred_at: instant, domain: oneOf('tasks', 'chores', 'calendar', 'finance', 'messages', 'system'), action_type: text,
            summary: text, source: text, actor_id: uuid, chore_id: uuid, task_series_id: uuid, task_id: uuid, calendar_item_id: uuid,
            allowance_transaction_id: uuid, message_thread_id: uuid, message_id: uuid, scheduled_for: day, restore_timing: text, metadata: json,
        },
        insert(principal, next) {
            if (isParent(principal)) return null;
            const self = kidSelf(principal);
            if (self === null) return 'not_allowed';
            return next.actor_id === self ? null : 'not_yours';
        },
        update: nobody,
        delete: nobody,
    },

    history_event_members: {
        key: ['history_event_id', 'family_member_id'],
        columns: { history_event_id: uuid, family_member_id: uuid },
        insert: (principal) => (isParent(principal) || kidSelf(principal) !== null ? null : 'not_allowed'),
        update: nobody,
        delete: nobody,
    },

    // A refusal is written by the server. A person can only say they have seen theirs.
    write_refusals: {
        key: ['id'],
        columns: { id: uuid, dismissed_at: instant },
        insert: nobody,
        update(principal, current, _next, changed) {
            if (!only(changed, ['dismissed_at'])) return 'column_not_allowed';
            if (isParent(principal)) return null;
            const self = kidSelf(principal);
            if (self === null) return 'not_allowed';
            return current.family_member_id === self ? null : 'not_yours';
        },
        delete: nobody,
    },
} satisfies Record<string, TablePolicy>;

export type WritableTable = keyof typeof POLICY;

export const isWritableTable = (table: string): table is WritableTable => Object.prototype.hasOwnProperty.call(POLICY, table);

export const policyFor = (table: WritableTable): TablePolicy => POLICY[table];
