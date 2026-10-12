-- The household's settings and units, its members, and chores: who does each one and what has been done.
-- These are the tables the first slice of the move to PowerSync runs on (docs/powersync-migration.md, Phase 2).

-- A household setting. The name is the key, so a setting cannot be stored twice.
CREATE TABLE settings (
    name  text PRIMARY KEY,
    value jsonb NOT NULL
);

-- A currency or other unit the family counts in.
CREATE TABLE unit_definitions (
    id               uuid PRIMARY KEY,
    code             text NOT NULL UNIQUE,
    name             text NOT NULL,
    symbol           text NOT NULL,
    is_monetary      boolean NOT NULL,
    -- NULL in the next three leaves the choice to the formatter.
    symbol_placement text CHECK (symbol_placement IN ('before', 'after')),
    symbol_spacing   boolean,
    decimal_places   integer CHECK (decimal_places >= 0)
);

CREATE TABLE family_members (
    id         uuid PRIMARY KEY,
    name       text NOT NULL,
    role       text NOT NULL CHECK (role IN ('parent', 'child')),
    email      text,
    color      text,
    -- The member's photo at each size it was resized to, keyed by pixel width. Read and written whole.
    photo_urls jsonb,
    sort_order integer NOT NULL,

    -- The hash never reaches a device. Devices are sent has_pin, which the trigger below keeps true to the hash.
    -- It is an ordinary column and not a generated one because Postgres leaves generated columns out of what it
    -- sends PowerSync when a row changes: a device would learn it once and never see it change.
    pin_hash   text,
    has_pin    boolean NOT NULL DEFAULT false,

    allowance_amount            double precision,
    allowance_currency          text,
    allowance_rrule             text,
    allowance_start_date        date,
    allowance_payout_delay_days integer NOT NULL DEFAULT 0 CHECK (allowance_payout_delay_days >= 0),
    allowance_config            jsonb,

    -- The member's own preferences. NULL means not chosen, and the app's default applies.
    last_display_currency         text,
    view_show_chore_descriptions  boolean,
    view_show_task_details        boolean,
    message_quiet_hours_enabled   boolean,
    message_quiet_hours_start     time,
    message_quiet_hours_end       time,
    message_digest_mode           text CHECK (message_digest_mode IN ('immediate', 'digest')),
    message_digest_window_minutes integer CHECK (message_digest_window_minutes > 0)
);

CREATE FUNCTION family_members_keep_has_pin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.has_pin := NEW.pin_hash IS NOT NULL;
    RETURN NEW;
END;
$$;

CREATE TRIGGER family_members_keep_has_pin
    BEFORE INSERT OR UPDATE ON family_members
    FOR EACH ROW EXECUTE FUNCTION family_members_keep_has_pin();

CREATE TABLE chores (
    id          uuid PRIMARY KEY,
    title       text NOT NULL,
    description text,

    -- When it recurs: from a day, by an RFC 5545 rule, less the days in exdates. No rule means once, on start_date.
    start_date  date NOT NULL,
    rrule       text,
    exdates     date[] NOT NULL DEFAULT '{}',
    -- A pause in progress, with what is needed to undo it. Read and written whole.
    pause_state jsonb,

    rotation_type      text NOT NULL DEFAULT 'none' CHECK (rotation_type IN ('none', 'daily', 'weekly', 'monthly')),
    is_joint           boolean NOT NULL DEFAULT false,
    is_up_for_grabs    boolean NOT NULL DEFAULT false,
    hide_from_day_list boolean NOT NULL DEFAULT false,
    sort_order         integer NOT NULL DEFAULT 0,

    weight                  double precision,
    reward_type             text CHECK (reward_type IN ('fixed', 'weight')),
    reward_amount           double precision,
    reward_currency         text,
    estimated_duration_secs integer CHECK (estimated_duration_secs >= 0),

    -- When in the day it is due. The mode says which of the columns after it apply.
    timing_mode          text NOT NULL DEFAULT 'anytime' CHECK (
        timing_mode IN (
            'anytime', 'named_window', 'before_time', 'after_time', 'between_times',
            'before_marker', 'after_marker', 'before_chore', 'after_chore'
        )
    ),
    timing_window_key    text,     -- named_window: which of the household's named windows
    timing_time          time,     -- before_time, after_time
    timing_start_time    time,     -- between_times
    timing_end_time      time,     -- between_times
    timing_marker_key    text,     -- before_marker, after_marker: which routine marker
    timing_chore_id      uuid REFERENCES chores (id) ON DELETE SET NULL, -- before_chore, after_chore
    timing_event         text CHECK (timing_event IN ('started', 'completed')), -- which moment of the marker or chore
    timing_fallback_time time,     -- used when the marker or chore has not happened yet

    created_at  timestamptz NOT NULL DEFAULT now(),

    -- A column that belongs to another mode is empty.
    CHECK (timing_window_key IS NULL OR timing_mode = 'named_window'),
    CHECK (timing_time IS NULL OR timing_mode IN ('before_time', 'after_time')),
    CHECK ((timing_start_time IS NULL AND timing_end_time IS NULL) OR timing_mode = 'between_times'),
    CHECK (timing_marker_key IS NULL OR timing_mode IN ('before_marker', 'after_marker')),
    CHECK (timing_chore_id IS NULL OR timing_mode IN ('before_chore', 'after_chore')),
    CHECK (
        (timing_event IS NULL AND timing_fallback_time IS NULL)
        OR timing_mode IN ('before_marker', 'after_marker', 'before_chore', 'after_chore')
    ),
    CHECK (timing_chore_id IS DISTINCT FROM id)
);

CREATE INDEX chores_timing_chore ON chores (timing_chore_id) WHERE timing_chore_id IS NOT NULL;

-- Who a chore is assigned to. The position orders the rotation when the chore rotates.
CREATE TABLE chore_assignees (
    chore_id         uuid NOT NULL REFERENCES chores (id) ON DELETE CASCADE,
    family_member_id uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
    position         integer NOT NULL,
    PRIMARY KEY (chore_id, family_member_id)
);

CREATE INDEX chore_assignees_member ON chore_assignees (family_member_id);

-- What one person did about one chore on one day it was due.
-- Done when completed_at is set; marked as not done when not_done is; otherwise cleared.
CREATE TABLE chore_completions (
    id                uuid PRIMARY KEY,
    chore_id          uuid NOT NULL REFERENCES chores (id) ON DELETE CASCADE,
    completed_by      uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
    -- Who pressed the button, when that was not the person who did the chore.
    marked_by         uuid REFERENCES family_members (id) ON DELETE SET NULL,
    date_due          date NOT NULL,
    completed_at      timestamptz,
    not_done          boolean NOT NULL DEFAULT false,
    allowance_awarded boolean NOT NULL DEFAULT false,
    UNIQUE (chore_id, completed_by, date_due),
    CHECK (NOT (completed_at IS NOT NULL AND not_done))
);

CREATE INDEX chore_completions_day ON chore_completions (date_due);
CREATE INDEX chore_completions_member_day ON chore_completions (completed_by, date_due);
