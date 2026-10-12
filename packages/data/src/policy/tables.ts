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

/** What a kid may change on their own row: how the app looks and behaves for them. */
const OWN_PREFERENCES = [
    'last_display_currency', 'view_show_chore_descriptions', 'view_show_task_details', 'message_quiet_hours_enabled',
    'message_quiet_hours_start', 'message_quiet_hours_end', 'message_digest_mode', 'message_digest_window_minutes',
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

    // The record of what happened is added to and never changed.
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
        columns: { dismissed_at: instant },
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
