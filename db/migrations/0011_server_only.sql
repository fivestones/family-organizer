-- What only the server reads and writes: the calendar import's accounts, calendars, bookkeeping and log, the tokens
-- behind iOS Shortcuts, and the devices that asked for notifications. None of it is published to the sync service.

-- A calendar account elsewhere that events are brought in from.
CREATE TABLE calendar_sync_accounts (
    id                         uuid PRIMARY KEY,
    provider                   text NOT NULL,
    account_label              text NOT NULL,
    username                   text NOT NULL,
    -- The account's app password, encrypted with a key that is not in the database.
    password_ciphertext        text NOT NULL,
    password_key_version       text NOT NULL,
    apple_principal_url        text,
    apple_calendar_home_url    text,
    status                     text NOT NULL,
    -- The calendars of the account that were chosen, by what the account calls them.
    selected_calendar_ids      text[] NOT NULL DEFAULT '{}',
    sync_window_past_days      integer,
    sync_window_future_days    integer,
    repair_scan_interval_hours integer,
    last_attempted_sync_at     timestamptz,
    last_successful_sync_at    timestamptz,
    last_error_at              timestamptz,
    last_error_code            text,
    last_error_message         text,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    updated_at                 timestamptz NOT NULL DEFAULT now()
);

-- A calendar of an account, as last seen there.
CREATE TABLE calendar_sync_calendars (
    id                      uuid PRIMARY KEY,
    account_id              uuid NOT NULL REFERENCES calendar_sync_accounts (id) ON DELETE CASCADE,
    remote_calendar_id      text NOT NULL,
    remote_url              text,
    display_name            text NOT NULL,
    description             text,
    color                   text,
    time_zone               text,
    is_enabled              boolean NOT NULL DEFAULT false,
    -- What the account last said had changed, so the next run can ask only for what has changed since.
    last_ctag               text,
    last_sync_token         text,
    last_seen_at            timestamptz,
    last_successful_sync_at timestamptz,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    UNIQUE (account_id, remote_calendar_id)
);

-- What the import knows about an event it brought in, and touches every time it sees the event again. It is kept
-- off the event's own row so that looking at an event does not send it to every device.
CREATE TABLE calendar_item_sync_state (
    calendar_item_id uuid PRIMARY KEY REFERENCES calendar_items (id) ON DELETE CASCADE,
    calendar_id      uuid NOT NULL REFERENCES calendar_sync_calendars (id) ON DELETE CASCADE,
    remote_etag      text,
    remote_ctag      text,
    raw_hash         text,
    imported_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX calendar_item_sync_state_calendar ON calendar_item_sync_state (calendar_id);

-- The log of import runs.
CREATE TABLE calendar_sync_runs (
    id                    uuid PRIMARY KEY,
    account_id            uuid NOT NULL REFERENCES calendar_sync_accounts (id) ON DELETE CASCADE,
    provider              text NOT NULL,
    trigger               text NOT NULL,
    status                text NOT NULL,
    started_at            timestamptz NOT NULL,
    finished_at           timestamptz,
    duration_ms           bigint,
    calendars_processed   integer,
    remote_events_fetched integer,
    events_created        integer,
    events_updated        integer,
    events_unchanged      integer,
    events_cancelled      integer,
    events_marked_deleted integer,
    error_code            text,
    error_message         text,
    details               jsonb
);

CREATE INDEX calendar_sync_runs_account ON calendar_sync_runs (account_id, started_at);

-- A token an iOS Shortcut presents. Only its hash is kept.
CREATE TABLE shortcut_tokens (
    id                      uuid PRIMARY KEY,
    token_hash              text NOT NULL UNIQUE,
    capability              text NOT NULL,
    label                   text NOT NULL,
    parent_family_member_id uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
    issued_device_name      text,
    issued_platform         text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    last_used_at            timestamptz,
    revoked_at              timestamptz
);

CREATE INDEX shortcut_tokens_parent ON shortcut_tokens (parent_family_member_id);

-- A device that asked to be sent notifications for someone.
CREATE TABLE push_devices (
    id               uuid PRIMARY KEY,
    family_member_id uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
    token            text NOT NULL UNIQUE,
    platform         text NOT NULL,
    is_enabled       boolean NOT NULL DEFAULT true,
    last_seen_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_devices_member ON push_devices (family_member_id);
