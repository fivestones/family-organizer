// The Postgres schema as the server's queries see it. The SQL files in db/migrations/ are the source of truth; this
// describes what they add up to, and test/contracts/database-types.contract.node.test.ts fails if the two part.
//
// What a column reads as depends on lib/server/pg-types.ts: a day is `YYYY-MM-DD`, an instant an ISO 8601 string,
// a time of day `HH:MM:SS`, and a JSON document whatever it parses to.

import type { ColumnType, Generated } from 'kysely';

type Day = string;
type Instant = ColumnType<string, string | Date, string | Date>;
type InstantWithDefault = ColumnType<string, string | Date | undefined, string | Date>;
type TimeOfDay = string;
/** Read as parsed JSON. Written as JSON text cast to jsonb; see `jsonb` in lib/server/db.ts. */
type Json = ColumnType<unknown, unknown, unknown>;

export interface SettingsTable {
    name: string;
    value: Json;
}

export interface UnitDefinitionsTable {
    id: string;
    code: string;
    name: string;
    symbol: string;
    is_monetary: boolean;
    symbol_placement: 'before' | 'after' | null;
    symbol_spacing: boolean | null;
    decimal_places: number | null;
}

export interface FamilyMembersTable {
    id: string;
    name: string;
    role: 'parent' | 'child';
    email: string | null;
    color: string | null;
    photo_urls: Json;
    sort_order: number;
    pin_hash: string | null;
    /** Kept true to pin_hash by a trigger. Never written. */
    has_pin: ColumnType<boolean, never, never>;
    allowance_amount: number | null;
    allowance_currency: string | null;
    allowance_rrule: string | null;
    allowance_start_date: Day | null;
    allowance_payout_delay_days: Generated<number>;
    allowance_config: Json;
    last_display_currency: string | null;
    view_show_chore_descriptions: boolean | null;
    view_show_task_details: boolean | null;
    message_quiet_hours_enabled: boolean | null;
    message_quiet_hours_start: TimeOfDay | null;
    message_quiet_hours_end: TimeOfDay | null;
    message_digest_mode: 'immediate' | 'digest' | null;
    message_digest_window_minutes: number | null;
}

export type ChoreTimingMode =
    | 'anytime'
    | 'named_window'
    | 'before_time'
    | 'after_time'
    | 'between_times'
    | 'before_marker'
    | 'after_marker'
    | 'before_chore'
    | 'after_chore';

export interface ChoresTable {
    id: string;
    title: string;
    description: string | null;
    start_date: Day;
    rrule: string | null;
    exdates: Generated<Day[]>;
    pause_state: Json;
    rotation_type: Generated<'none' | 'daily' | 'weekly' | 'monthly'>;
    is_joint: Generated<boolean>;
    is_up_for_grabs: Generated<boolean>;
    hide_from_day_list: Generated<boolean>;
    sort_order: Generated<number>;
    weight: number | null;
    reward_type: 'fixed' | 'weight' | null;
    reward_amount: number | null;
    reward_currency: string | null;
    estimated_duration_secs: number | null;
    timing_mode: Generated<ChoreTimingMode>;
    timing_window_key: string | null;
    timing_time: TimeOfDay | null;
    timing_start_time: TimeOfDay | null;
    timing_end_time: TimeOfDay | null;
    timing_marker_key: string | null;
    timing_chore_id: string | null;
    timing_event: 'started' | 'completed' | null;
    timing_fallback_time: TimeOfDay | null;
    created_at: InstantWithDefault;
}

export interface ChoreAssigneesTable {
    chore_id: string;
    family_member_id: string;
    position: number;
}

export interface ChoreCompletionsTable {
    id: string;
    chore_id: string;
    completed_by: string;
    marked_by: string | null;
    date_due: Day;
    completed_at: Instant | null;
    not_done: Generated<boolean>;
    allowance_awarded: Generated<boolean>;
}

export interface RoutinesTable {
    id: string;
    name: string;
    on_step_overrun: 'wait' | 'advance' | null;
    sort_order: Generated<number>;
    created_at: InstantWithDefault;
}

export interface RoutineStepsTable {
    routine_id: string;
    chore_id: string;
    position: number;
}

export interface RoutineMarkerStatusesTable {
    day: Day;
    marker_key: string;
    started_at: Instant | null;
    started_by: string | null;
    completed_at: Instant | null;
    completed_by: string | null;
}

export interface CountdownRunsTable {
    id: string;
    family_member_id: string;
    day: Day;
    routine_id: string | null;
    status: 'running' | 'stopped';
    current_chore_id: string | null;
    skipped_chore_ids: Generated<string[]>;
    started_at: Instant;
    step_started_at: Instant | null;
    step_extension_secs: Generated<number>;
    step_extension_count: Generated<number>;
    last_interaction_at: Instant | null;
    stopped_at: Instant | null;
    stopped_reason: string | null;
}

export type HistoryDomain = 'tasks' | 'chores' | 'calendar' | 'finance' | 'messages' | 'system';

export interface HistoryEventsTable {
    id: string;
    occurred_at: Instant;
    domain: HistoryDomain;
    action_type: string;
    summary: string;
    source: string | null;
    actor_id: string | null;
    chore_id: string | null;
    task_series_id: string | null;
    task_id: string | null;
    calendar_item_id: string | null;
    allowance_transaction_id: string | null;
    message_thread_id: string | null;
    message_id: string | null;
    scheduled_for: Day | null;
    restore_timing: string | null;
    metadata: Json;
}

export interface HistoryEventMembersTable {
    history_event_id: string;
    family_member_id: string;
}

export interface InstallationTable {
    only_row: Generated<boolean>;
    id: Generated<string>;
    data_generation: Generated<number>;
    backend: Generated<'instant' | 'powersync'>;
    writes_frozen: Generated<boolean>;
    min_client_build: Generated<number>;
}

export type PrincipalType = 'kid' | 'parent';
export type SessionState = 'active' | 'draining' | 'ended';

export interface AuthSessionsTable {
    id: Generated<string>;
    token_hash: string;
    principal_type: PrincipalType;
    family_member_id: string | null;
    state: Generated<SessionState>;
    created_at: InstantWithDefault;
    last_seen_at: InstantWithDefault;
    expires_at: Instant;
    drain_until: Instant | null;
    ended_at: Instant | null;
}

export interface SyncUploadsTable {
    upload_id: string;
    session_id: string | null;
    principal: string;
    mutation: string | null;
    outcome: Json;
    received_at: InstantWithDefault;
}

export interface WriteRefusalsTable {
    id: Generated<string>;
    family_member_id: string | null;
    principal_type: PrincipalType;
    mutation: string | null;
    reason: string;
    table_name: string | null;
    row_id: string | null;
    refused_at: InstantWithDefault;
    dismissed_at: Instant | null;
}

export interface SchemaMigrationsTable {
    version: string;
    applied_at: InstantWithDefault;
}

export interface Database {
    settings: SettingsTable;
    unit_definitions: UnitDefinitionsTable;
    family_members: FamilyMembersTable;
    chores: ChoresTable;
    chore_assignees: ChoreAssigneesTable;
    chore_completions: ChoreCompletionsTable;
    routines: RoutinesTable;
    routine_steps: RoutineStepsTable;
    routine_marker_statuses: RoutineMarkerStatusesTable;
    countdown_runs: CountdownRunsTable;
    history_events: HistoryEventsTable;
    history_event_members: HistoryEventMembersTable;
    installation: InstallationTable;
    auth_sessions: AuthSessionsTable;
    sync_uploads: SyncUploadsTable;
    write_refusals: WriteRefusalsTable;
    schema_migrations: SchemaMigrationsTable;
}

/**
 * Every column of every table, by name. TypeScript holds this to the interfaces above, in both directions, and
 * the contract test holds it to the migrated schema, so a column cannot be in one and missing from the other.
 */
export const DATABASE_COLUMNS = {
    settings: { name: true, value: true },
    unit_definitions: { id: true, code: true, name: true, symbol: true, is_monetary: true, symbol_placement: true, symbol_spacing: true, decimal_places: true },
    family_members: {
        id: true, name: true, role: true, email: true, color: true, photo_urls: true, sort_order: true, pin_hash: true, has_pin: true,
        allowance_amount: true, allowance_currency: true, allowance_rrule: true, allowance_start_date: true, allowance_payout_delay_days: true,
        allowance_config: true, last_display_currency: true, view_show_chore_descriptions: true, view_show_task_details: true,
        message_quiet_hours_enabled: true, message_quiet_hours_start: true, message_quiet_hours_end: true, message_digest_mode: true,
        message_digest_window_minutes: true,
    },
    chores: {
        id: true, title: true, description: true, start_date: true, rrule: true, exdates: true, pause_state: true, rotation_type: true,
        is_joint: true, is_up_for_grabs: true, hide_from_day_list: true, sort_order: true, weight: true, reward_type: true, reward_amount: true,
        reward_currency: true, estimated_duration_secs: true, timing_mode: true, timing_window_key: true, timing_time: true,
        timing_start_time: true, timing_end_time: true, timing_marker_key: true, timing_chore_id: true, timing_event: true,
        timing_fallback_time: true, created_at: true,
    },
    chore_assignees: { chore_id: true, family_member_id: true, position: true },
    chore_completions: { id: true, chore_id: true, completed_by: true, marked_by: true, date_due: true, completed_at: true, not_done: true, allowance_awarded: true },
    routines: { id: true, name: true, on_step_overrun: true, sort_order: true, created_at: true },
    routine_steps: { routine_id: true, chore_id: true, position: true },
    routine_marker_statuses: { day: true, marker_key: true, started_at: true, started_by: true, completed_at: true, completed_by: true },
    countdown_runs: {
        id: true, family_member_id: true, day: true, routine_id: true, status: true, current_chore_id: true, skipped_chore_ids: true,
        started_at: true, step_started_at: true, step_extension_secs: true, step_extension_count: true, last_interaction_at: true,
        stopped_at: true, stopped_reason: true,
    },
    history_events: {
        id: true, occurred_at: true, domain: true, action_type: true, summary: true, source: true, actor_id: true, chore_id: true,
        task_series_id: true, task_id: true, calendar_item_id: true, allowance_transaction_id: true, message_thread_id: true, message_id: true,
        scheduled_for: true, restore_timing: true, metadata: true,
    },
    history_event_members: { history_event_id: true, family_member_id: true },
    installation: { only_row: true, id: true, data_generation: true, backend: true, writes_frozen: true, min_client_build: true },
    auth_sessions: {
        id: true, token_hash: true, principal_type: true, family_member_id: true, state: true, created_at: true, last_seen_at: true,
        expires_at: true, drain_until: true, ended_at: true,
    },
    sync_uploads: { upload_id: true, session_id: true, principal: true, mutation: true, outcome: true, received_at: true },
    write_refusals: {
        id: true, family_member_id: true, principal_type: true, mutation: true, reason: true, table_name: true, row_id: true, refused_at: true,
        dismissed_at: true,
    },
    schema_migrations: { version: true, applied_at: true },
} satisfies { [Table in keyof Database]: Record<keyof Database[Table], true> };
