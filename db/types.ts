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
    default_envelope_id: string | null;
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

export interface GradeTypesTable {
    id: string;
    name: string;
    kind: 'number' | 'letter' | 'stars' | 'freeform';
    low_value: number;
    high_value: number;
    low_label: Generated<string>;
    high_label: Generated<string>;
    steps: Json | null;
    is_default: Generated<boolean>;
    sort_order: Generated<number>;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface TaskSeriesTable {
    id: string;
    name: string;
    description: string | null;
    family_member_id: string | null;
    chore_id: string | null;
    depends_on_series_id: string | null;
    start_date: Day | null;
    target_end_date: Day | null;
    planned_end_date: Day | null;
    baseline_day_break_count: number | null;
    work_ahead_allowed: Generated<boolean>;
    pull_forward_count: Generated<number>;
    break_type: string | null;
    break_start_date: Day | null;
    break_delay_value: number | null;
    break_delay_unit: string | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface TasksTable {
    id: string;
    task_series_id: string;
    parent_task_id: string | null;
    title: Generated<string>;
    notes: string | null;
    sort_order: number;
    indentation_level: Generated<number>;
    is_day_break: Generated<boolean>;
    weight: number | null;
    specific_time: TimeOfDay | null;
    override_work_ahead: boolean | null;
    workflow_state: Generated<'not_started' | 'in_progress' | 'blocked' | 'skipped' | 'needs_review' | 'done'>;
    last_active_state: Generated<'not_started' | 'in_progress'>;
    child_tasks_complete: Generated<boolean>;
    completed_at: Instant | null;
    completed_on: Day | null;
    deferred_until: Day | null;
    noted_until: Day | null;
    is_noted_indefinitely: Generated<boolean>;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface TaskAttachmentsTable {
    id: string;
    task_id: string;
    name: string;
    type: string;
    url: string;
    kind: string | null;
    size_bytes: number | null;
    width: number | null;
    height: number | null;
    duration_sec: number | null;
    thumbnail_url: string | null;
    thumbnail_width: number | null;
    thumbnail_height: number | null;
    blurhash: string | null;
    waveform_peaks: Json | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface TaskResponseFieldsTable {
    id: string;
    task_id: string;
    type: 'rich_text' | 'photo' | 'video' | 'audio' | 'file';
    label: string;
    description: string | null;
    weight: Generated<number>;
    required: Generated<boolean>;
    sort_order: Generated<number>;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface TaskUpdatesTable {
    id: string;
    task_id: string;
    actor_id: string | null;
    affected_person_id: string | null;
    reply_to_id: string | null;
    from_state: 'not_started' | 'in_progress' | 'blocked' | 'skipped' | 'needs_review' | 'done';
    to_state: 'not_started' | 'in_progress' | 'blocked' | 'skipped' | 'needs_review' | 'done';
    note: string | null;
    is_draft: Generated<boolean>;
    scheduled_for: Day;
    restore_timing: 'now' | 'next_scheduled' | null;
    grade_type_id: string | null;
    grade_numeric_value: number | null;
    grade_display_value: string | null;
    grade_is_provisional: boolean | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface TaskUpdateAttachmentsTable {
    id: string;
    update_id: string;
    name: string;
    type: string;
    url: string;
    kind: string | null;
    size_bytes: number | null;
    width: number | null;
    height: number | null;
    duration_sec: number | null;
    thumbnail_url: string | null;
    thumbnail_width: number | null;
    thumbnail_height: number | null;
    blurhash: string | null;
    waveform_peaks: Json | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface TaskResponseFieldValuesTable {
    id: string;
    update_id: string;
    field_id: string;
    rich_text_content: string | null;
    file_url: string | null;
    file_name: string | null;
    file_type: string | null;
    file_size_bytes: number | null;
    thumbnail_url: string | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface AllowanceEnvelopesTable {
    id: string;
    family_member_id: string | null;
    name: string;
    description: string | null;
    goal_amount: number | null;
    goal_currency: string | null;
    archived_at: Instant | null;
}

export interface EnvelopeBalancesTable {
    envelope_id: string;
    currency: string;
    amount: number;
}

export interface AllowanceTransactionsTable {
    id: string;
    envelope_id: string;
    source_envelope_id: string | null;
    destination_envelope_id: string | null;
    transaction_type: string;
    amount: number;
    currency: string;
    description: Generated<string>;
    created_by: string | null;
    distribution_key: string | null;
    created_at: InstantWithDefault;
}

export interface ExchangeRatesTable {
    base_currency: string;
    target_currency: string;
    rate: number;
    fetched_at: Instant;
}

export interface AnnouncementsTable {
    id: string;
    title: string;
    rich_text_content: string | null;
    link_url: string | null;
    created_by: string | null;
    expires_at: Instant | null;
    archived_at: Instant | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface ContentCategoriesTable {
    id: string;
    slug: string;
    name: string;
    default_duration_ms: number;
    loop_when_empty: Generated<boolean>;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface ContentQueueItemsTable {
    id: string;
    category_id: string;
    title: string;
    rich_text_content: string | null;
    link_url: string | null;
    status: 'queued' | 'live' | 'archived';
    sort_order: Generated<number>;
    duration_ms: number | null;
    live_at: Instant | null;
    live_until: Instant | null;
    archived_at: Instant | null;
    created_by: string | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface FamilyRulesTable {
    id: string;
    title: string;
    sort_order: Generated<number>;
    is_archived: Generated<boolean>;
    active_version_id: string;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface FamilyRuleVersionsTable {
    id: string;
    rule_id: string;
    version_number: number;
    rich_text_content: string;
    edit_note: string | null;
    previous_version_id: string | null;
    created_by: string | null;
    created_at: InstantWithDefault;
}

export interface ContentAttachmentsTable {
    id: string;
    announcement_id: string | null;
    queue_item_id: string | null;
    rule_version_id: string | null;
    name: string;
    type: string;
    url: string;
    kind: string | null;
    size_bytes: number | null;
    width: number | null;
    height: number | null;
    duration_sec: number | null;
    thumbnail_url: string | null;
    thumbnail_width: number | null;
    thumbnail_height: number | null;
    blurhash: string | null;
    waveform_peaks: Json | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface FamilyDashboardLayoutsTable {
    id: string;
    breakpoint_key: string;
    label: string;
    min_width: number;
    max_width: number;
    sort_order: Generated<number>;
    is_default: Generated<boolean>;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface FamilyDashboardWidgetsTable {
    id: string;
    layout_id: string;
    widget_type: string;
    x: number;
    y: number;
    w: number;
    h: number;
    z: Generated<number>;
    config: Json | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface DashboardConfigsTable {
    family_member_id: string;
    widget_order: Json | null;
    disabled_widgets: Json | null;
    widget_settings: Json | null;
    updated_at: InstantWithDefault;
}

export interface HistoryEventAttachmentsTable {
    id: string;
    history_event_id: string;
    name: string;
    type: string;
    url: string;
    kind: string | null;
    size_bytes: number | null;
    width: number | null;
    height: number | null;
    duration_sec: number | null;
    thumbnail_url: string | null;
    thumbnail_width: number | null;
    thumbnail_height: number | null;
    blurhash: string | null;
    waveform_peaks: Json | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
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
    grade_types: GradeTypesTable;
    task_series: TaskSeriesTable;
    tasks: TasksTable;
    task_attachments: TaskAttachmentsTable;
    task_response_fields: TaskResponseFieldsTable;
    task_updates: TaskUpdatesTable;
    task_update_attachments: TaskUpdateAttachmentsTable;
    task_response_field_values: TaskResponseFieldValuesTable;
    allowance_envelopes: AllowanceEnvelopesTable;
    envelope_balances: EnvelopeBalancesTable;
    allowance_transactions: AllowanceTransactionsTable;
    exchange_rates: ExchangeRatesTable;
    announcements: AnnouncementsTable;
    content_categories: ContentCategoriesTable;
    content_queue_items: ContentQueueItemsTable;
    family_rules: FamilyRulesTable;
    family_rule_versions: FamilyRuleVersionsTable;
    content_attachments: ContentAttachmentsTable;
    family_dashboard_layouts: FamilyDashboardLayoutsTable;
    family_dashboard_widgets: FamilyDashboardWidgetsTable;
    dashboard_configs: DashboardConfigsTable;
    history_event_attachments: HistoryEventAttachmentsTable;
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
        message_digest_window_minutes: true, default_envelope_id: true,
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
    grade_types: {
        id: true, name: true, kind: true, low_value: true, high_value: true, low_label: true, high_label: true, steps: true, is_default: true,
        sort_order: true, created_at: true, updated_at: true,
    },
    task_series: {
        id: true, name: true, description: true, family_member_id: true, chore_id: true, depends_on_series_id: true, start_date: true,
        target_end_date: true, planned_end_date: true, baseline_day_break_count: true, work_ahead_allowed: true, pull_forward_count: true,
        break_type: true, break_start_date: true, break_delay_value: true, break_delay_unit: true, created_at: true, updated_at: true,
    },
    tasks: {
        id: true, task_series_id: true, parent_task_id: true, title: true, notes: true, sort_order: true, indentation_level: true, is_day_break: true,
        weight: true, specific_time: true, override_work_ahead: true, workflow_state: true, last_active_state: true, child_tasks_complete: true,
        completed_at: true, completed_on: true, deferred_until: true, noted_until: true, is_noted_indefinitely: true, created_at: true,
        updated_at: true,
    },
    task_attachments: {
        id: true, task_id: true, name: true, type: true, url: true, kind: true, size_bytes: true, width: true, height: true, duration_sec: true,
        thumbnail_url: true, thumbnail_width: true, thumbnail_height: true, blurhash: true, waveform_peaks: true, created_at: true, updated_at: true,
    },
    task_response_fields: {
        id: true, task_id: true, type: true, label: true, description: true, weight: true, required: true, sort_order: true, created_at: true,
        updated_at: true,
    },
    task_updates: {
        id: true, task_id: true, actor_id: true, affected_person_id: true, reply_to_id: true, from_state: true, to_state: true, note: true,
        is_draft: true, scheduled_for: true, restore_timing: true, grade_type_id: true, grade_numeric_value: true, grade_display_value: true,
        grade_is_provisional: true, created_at: true, updated_at: true,
    },
    task_update_attachments: {
        id: true, update_id: true, name: true, type: true, url: true, kind: true, size_bytes: true, width: true, height: true, duration_sec: true,
        thumbnail_url: true, thumbnail_width: true, thumbnail_height: true, blurhash: true, waveform_peaks: true, created_at: true, updated_at: true,
    },
    task_response_field_values: {
        id: true, update_id: true, field_id: true, rich_text_content: true, file_url: true, file_name: true, file_type: true, file_size_bytes: true,
        thumbnail_url: true, created_at: true, updated_at: true,
    },
    allowance_envelopes: {
        id: true, family_member_id: true, name: true, description: true, goal_amount: true, goal_currency: true, archived_at: true,
    },
    envelope_balances: { envelope_id: true, currency: true, amount: true },
    allowance_transactions: {
        id: true, envelope_id: true, source_envelope_id: true, destination_envelope_id: true, transaction_type: true, amount: true, currency: true,
        description: true, created_by: true, distribution_key: true, created_at: true,
    },
    exchange_rates: { base_currency: true, target_currency: true, rate: true, fetched_at: true },
    announcements: {
        id: true, title: true, rich_text_content: true, link_url: true, created_by: true, expires_at: true, archived_at: true, created_at: true,
        updated_at: true,
    },
    content_categories: { id: true, slug: true, name: true, default_duration_ms: true, loop_when_empty: true, created_at: true, updated_at: true },
    content_queue_items: {
        id: true, category_id: true, title: true, rich_text_content: true, link_url: true, status: true, sort_order: true, duration_ms: true,
        live_at: true, live_until: true, archived_at: true, created_by: true, created_at: true, updated_at: true,
    },
    family_rules: { id: true, title: true, sort_order: true, is_archived: true, active_version_id: true, created_at: true, updated_at: true },
    family_rule_versions: {
        id: true, rule_id: true, version_number: true, rich_text_content: true, edit_note: true, previous_version_id: true, created_by: true,
        created_at: true,
    },
    content_attachments: {
        id: true, announcement_id: true, queue_item_id: true, rule_version_id: true, name: true, type: true, url: true, kind: true, size_bytes: true,
        width: true, height: true, duration_sec: true, thumbnail_url: true, thumbnail_width: true, thumbnail_height: true, blurhash: true,
        waveform_peaks: true, created_at: true, updated_at: true,
    },
    family_dashboard_layouts: {
        id: true, breakpoint_key: true, label: true, min_width: true, max_width: true, sort_order: true, is_default: true, created_at: true,
        updated_at: true,
    },
    family_dashboard_widgets: {
        id: true, layout_id: true, widget_type: true, x: true, y: true, w: true, h: true, z: true, config: true, created_at: true, updated_at: true,
    },
    dashboard_configs: { family_member_id: true, widget_order: true, disabled_widgets: true, widget_settings: true, updated_at: true },
    history_event_attachments: {
        id: true, history_event_id: true, name: true, type: true, url: true, kind: true, size_bytes: true, width: true, height: true,
        duration_sec: true, thumbnail_url: true, thumbnail_width: true, thumbnail_height: true, blurhash: true, waveform_peaks: true, created_at: true,
        updated_at: true,
    },
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
