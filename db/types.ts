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

export interface MessageThreadsTable {
    id: string;
    thread_type: 'family' | 'parents_only' | 'direct' | 'group' | 'linked';
    visibility: 'family' | 'parents_only' | 'members';
    thread_key: string;
    title: string;
    linked_domain: 'tasks' | 'chores' | 'calendar' | 'finance' | null;
    linked_entity_id: string | null;
    is_closed: Generated<boolean>;
    created_by: string | null;
    latest_message_at: Instant | null;
    latest_message_author_id: string | null;
    latest_message_preview: string | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface MessageThreadMembersTable {
    thread_id: string;
    family_member_id: string;
    member_role: Generated<'member' | 'owner' | 'watcher'>;
    notification_level: Generated<'all' | 'mentions' | 'mute' | 'watch'>;
    is_archived: Generated<boolean>;
    pinned_at: Instant | null;
    joined_at: InstantWithDefault;
    last_read_at: Instant | null;
    last_read_message_id: string | null;
}

export interface MessagesTable {
    id: string;
    thread_id: string;
    author_id: string | null;
    body: Generated<string>;
    importance: Generated<'normal' | 'urgent' | 'announcement' | 'needs_ack'>;
    is_system: Generated<boolean>;
    reply_to_id: string | null;
    client_nonce: string | null;
    metadata: Json | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
    edited_at: Instant | null;
    editable_until: Instant | null;
    deleted_at: Instant | null;
    removed_by: string | null;
    removed_reason: string | null;
}

export interface MessageAttachmentsTable {
    id: string;
    message_id: string;
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

export interface MessageReactionsTable {
    message_id: string;
    family_member_id: string;
    emoji: string;
    created_at: InstantWithDefault;
}

export interface MessageAcknowledgementsTable {
    message_id: string;
    family_member_id: string;
    kind: 'seen' | 'acknowledged';
    created_at: InstantWithDefault;
}

export interface CalendarTagsTable {
    id: string;
    name: string;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface CalendarItemsTable {
    id: string;
    title: string;
    description: string | null;
    location: string | null;
    url: string | null;
    start_date: Day | null;
    end_date: Day | null;
    starts_at: Instant | null;
    ends_at: Instant | null;
    time_zone: string | null;
    status: Generated<'tentative' | 'confirmed' | 'cancelled'>;
    event_type: Generated<string>;
    visibility: Generated<string>;
    transparency: Generated<'opaque' | 'transparent'>;
    priority: number | null;
    uid: string | null;
    sequence: Generated<number>;
    dtstamp: Instant | null;
    last_modified: Instant | null;
    rrule: string | null;
    rdates: Generated<string[]>;
    exdates: Generated<string[]>;
    recurring_event_id: string | null;
    recurrence_id: string | null;
    recurrence_id_range: string | null;
    organizer: Json | null;
    attendees: Json | null;
    alarms: Json | null;
    x_props: Json | null;
    travel_duration_before_minutes: number | null;
    travel_duration_after_minutes: number | null;
    source_type: string | null;
    source_read_only: Generated<boolean>;
    source_sync_status: 'active' | 'cancelled' | 'deleted-remote' | null;
    source_calendar_name: string | null;
    source_external_id: string | null;
    source_remote_url: string | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface CalendarItemMembersTable {
    calendar_item_id: string;
    family_member_id: string;
}

export interface CalendarItemTagsTable {
    calendar_item_id: string;
    tag_id: string;
}

export interface CalendarSyncAccountsTable {
    id: string;
    provider: string;
    account_label: string;
    username: string;
    password_ciphertext: string;
    password_key_version: string;
    apple_principal_url: string | null;
    apple_calendar_home_url: string | null;
    status: string;
    selected_calendar_ids: Generated<string[]>;
    sync_window_past_days: number | null;
    sync_window_future_days: number | null;
    repair_scan_interval_hours: number | null;
    last_attempted_sync_at: Instant | null;
    last_successful_sync_at: Instant | null;
    last_error_at: Instant | null;
    last_error_code: string | null;
    last_error_message: string | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface CalendarSyncCalendarsTable {
    id: string;
    account_id: string;
    remote_calendar_id: string;
    remote_url: string | null;
    display_name: string;
    description: string | null;
    color: string | null;
    time_zone: string | null;
    is_enabled: Generated<boolean>;
    last_ctag: string | null;
    last_sync_token: string | null;
    last_seen_at: Instant | null;
    last_successful_sync_at: Instant | null;
    created_at: InstantWithDefault;
    updated_at: InstantWithDefault;
}

export interface CalendarItemSyncStateTable {
    calendar_item_id: string;
    calendar_id: string;
    remote_etag: string | null;
    remote_ctag: string | null;
    raw_hash: string | null;
    imported_at: InstantWithDefault;
    last_seen_at: InstantWithDefault;
}

export interface CalendarSyncRunsTable {
    id: string;
    account_id: string;
    provider: string;
    trigger: string;
    status: string;
    started_at: Instant;
    finished_at: Instant | null;
    duration_ms: number | null;
    calendars_processed: number | null;
    remote_events_fetched: number | null;
    events_created: number | null;
    events_updated: number | null;
    events_unchanged: number | null;
    events_cancelled: number | null;
    events_marked_deleted: number | null;
    error_code: string | null;
    error_message: string | null;
    details: Json | null;
}

export interface ShortcutTokensTable {
    id: string;
    token_hash: string;
    capability: string;
    label: string;
    parent_family_member_id: string;
    issued_device_name: string | null;
    issued_platform: string | null;
    created_at: InstantWithDefault;
    last_used_at: Instant | null;
    revoked_at: Instant | null;
}

export interface PushDevicesTable {
    id: string;
    family_member_id: string;
    token: string;
    platform: string;
    is_enabled: Generated<boolean>;
    last_seen_at: InstantWithDefault;
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

export interface MaintenanceRunsTable {
    kind: 'backup' | 'offsite' | 'compact';
    finished_at: InstantWithDefault;
    detail: string | null;
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
    message_threads: MessageThreadsTable;
    message_thread_members: MessageThreadMembersTable;
    messages: MessagesTable;
    message_attachments: MessageAttachmentsTable;
    message_reactions: MessageReactionsTable;
    message_acknowledgements: MessageAcknowledgementsTable;
    calendar_tags: CalendarTagsTable;
    calendar_items: CalendarItemsTable;
    calendar_item_members: CalendarItemMembersTable;
    calendar_item_tags: CalendarItemTagsTable;
    calendar_sync_accounts: CalendarSyncAccountsTable;
    calendar_sync_calendars: CalendarSyncCalendarsTable;
    calendar_item_sync_state: CalendarItemSyncStateTable;
    calendar_sync_runs: CalendarSyncRunsTable;
    shortcut_tokens: ShortcutTokensTable;
    push_devices: PushDevicesTable;
    installation: InstallationTable;
    auth_sessions: AuthSessionsTable;
    sync_uploads: SyncUploadsTable;
    write_refusals: WriteRefusalsTable;
    maintenance_runs: MaintenanceRunsTable;
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
    message_threads: {
        id: true, thread_type: true, visibility: true, thread_key: true, title: true, linked_domain: true, linked_entity_id: true, is_closed: true,
        created_by: true, latest_message_at: true, latest_message_author_id: true, latest_message_preview: true, created_at: true, updated_at: true,
    },
    message_thread_members: {
        thread_id: true, family_member_id: true, member_role: true, notification_level: true, is_archived: true, pinned_at: true, joined_at: true,
        last_read_at: true, last_read_message_id: true,
    },
    messages: {
        id: true, thread_id: true, author_id: true, body: true, importance: true, is_system: true, reply_to_id: true, client_nonce: true,
        metadata: true, created_at: true, updated_at: true, edited_at: true, editable_until: true, deleted_at: true, removed_by: true,
        removed_reason: true,
    },
    message_attachments: {
        id: true, message_id: true, name: true, type: true, url: true, kind: true, size_bytes: true, width: true, height: true, duration_sec: true,
        thumbnail_url: true, thumbnail_width: true, thumbnail_height: true, blurhash: true, waveform_peaks: true, created_at: true, updated_at: true,
    },
    message_reactions: { message_id: true, family_member_id: true, emoji: true, created_at: true },
    message_acknowledgements: { message_id: true, family_member_id: true, kind: true, created_at: true },
    calendar_tags: { id: true, name: true, created_at: true, updated_at: true },
    calendar_items: {
        id: true, title: true, description: true, location: true, url: true, start_date: true, end_date: true, starts_at: true, ends_at: true,
        time_zone: true, status: true, event_type: true, visibility: true, transparency: true, priority: true, uid: true, sequence: true,
        dtstamp: true, last_modified: true, rrule: true, rdates: true, exdates: true, recurring_event_id: true, recurrence_id: true,
        recurrence_id_range: true, organizer: true, attendees: true, alarms: true, x_props: true, travel_duration_before_minutes: true,
        travel_duration_after_minutes: true, source_type: true, source_read_only: true, source_sync_status: true, source_calendar_name: true,
        source_external_id: true, source_remote_url: true, created_at: true, updated_at: true,
    },
    calendar_item_members: { calendar_item_id: true, family_member_id: true },
    calendar_item_tags: { calendar_item_id: true, tag_id: true },
    calendar_sync_accounts: {
        id: true, provider: true, account_label: true, username: true, password_ciphertext: true, password_key_version: true,
        apple_principal_url: true, apple_calendar_home_url: true, status: true, selected_calendar_ids: true, sync_window_past_days: true,
        sync_window_future_days: true, repair_scan_interval_hours: true, last_attempted_sync_at: true, last_successful_sync_at: true,
        last_error_at: true, last_error_code: true, last_error_message: true, created_at: true, updated_at: true,
    },
    calendar_sync_calendars: {
        id: true, account_id: true, remote_calendar_id: true, remote_url: true, display_name: true, description: true, color: true, time_zone: true,
        is_enabled: true, last_ctag: true, last_sync_token: true, last_seen_at: true, last_successful_sync_at: true, created_at: true,
        updated_at: true,
    },
    calendar_item_sync_state: {
        calendar_item_id: true, calendar_id: true, remote_etag: true, remote_ctag: true, raw_hash: true, imported_at: true, last_seen_at: true,
    },
    calendar_sync_runs: {
        id: true, account_id: true, provider: true, trigger: true, status: true, started_at: true, finished_at: true, duration_ms: true,
        calendars_processed: true, remote_events_fetched: true, events_created: true, events_updated: true, events_unchanged: true,
        events_cancelled: true, events_marked_deleted: true, error_code: true, error_message: true, details: true,
    },
    shortcut_tokens: {
        id: true, token_hash: true, capability: true, label: true, parent_family_member_id: true, issued_device_name: true, issued_platform: true,
        created_at: true, last_used_at: true, revoked_at: true,
    },
    push_devices: { id: true, family_member_id: true, token: true, platform: true, is_enabled: true, last_seen_at: true },
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
    maintenance_runs: { kind: true, finished_at: true, detail: true },
    schema_migrations: { version: true, applied_at: true },
} satisfies { [Table in keyof Database]: Record<keyof Database[Table], true> };
