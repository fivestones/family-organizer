-- Task series: a queue of tasks worked through in order, a few each time its chore comes round, with what was
-- said and handed in along the way.

-- How a response is graded: a scale, with a name for each end.
CREATE TABLE grade_types (
    id         uuid PRIMARY KEY,
    name       text NOT NULL,
    kind       text NOT NULL CHECK (kind IN ('number', 'letter', 'stars', 'freeform')),
    low_value  double precision NOT NULL,
    high_value double precision NOT NULL,
    low_label  text NOT NULL DEFAULT '',
    high_label text NOT NULL DEFAULT '',
    -- The named steps of a scale that has them, such as letters. Read and written whole.
    steps      jsonb,
    is_default boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- At most one scale is the one a new grade starts on.
CREATE UNIQUE INDEX grade_types_one_default ON grade_types (is_default) WHERE is_default;

CREATE TABLE task_series (
    id                       uuid PRIMARY KEY,
    name                     text NOT NULL,
    description              text,
    -- Whose series it is, and the chore whose turn brings its tasks up. A series without both is a draft.
    family_member_id         uuid REFERENCES family_members (id) ON DELETE SET NULL,
    chore_id                 uuid REFERENCES chores (id) ON DELETE SET NULL,
    depends_on_series_id     uuid REFERENCES task_series (id) ON DELETE SET NULL,
    start_date               date,
    target_end_date          date,
    -- When the series was planned to end, and how many day breaks it had then, kept to say how far ahead or behind it is.
    planned_end_date         date,
    baseline_day_break_count integer,
    work_ahead_allowed       boolean NOT NULL DEFAULT false,
    -- How many days' tasks have been brought forward to be done early.
    pull_forward_count       integer NOT NULL DEFAULT 0 CHECK (pull_forward_count >= 0),
    -- A planned pause, in the family's own words.
    break_type               text,
    break_start_date         date,
    break_delay_value        double precision,
    break_delay_unit         text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_series_chore ON task_series (chore_id);
CREATE INDEX task_series_member ON task_series (family_member_id);

-- One line of a series: something to do, or a day break, which ends one sitting's tasks.
CREATE TABLE tasks (
    id                    uuid PRIMARY KEY,
    task_series_id        uuid NOT NULL REFERENCES task_series (id) ON DELETE CASCADE,
    parent_task_id        uuid REFERENCES tasks (id) ON DELETE SET NULL,
    title                 text NOT NULL DEFAULT '',
    notes                 text,
    sort_order            integer NOT NULL,
    indentation_level     integer NOT NULL DEFAULT 0,
    is_day_break          boolean NOT NULL DEFAULT false,
    weight                double precision,
    specific_time         time,
    -- Whether this task may be done ahead of its day. Empty means as its series says.
    override_work_ahead   boolean,
    workflow_state        text NOT NULL DEFAULT 'not_started'
        CHECK (workflow_state IN ('not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done')),
    -- Where the task goes back to when it leaves blocked, skipped, needs_review or done.
    last_active_state     text NOT NULL DEFAULT 'not_started' CHECK (last_active_state IN ('not_started', 'in_progress')),
    -- False while a task with sub-tasks still has one unfinished.
    child_tasks_complete  boolean NOT NULL DEFAULT true,
    completed_at          timestamptz,
    -- The day it was done for, which is the day it was showing on and not always the day of completed_at.
    completed_on          date,
    deferred_until        date,
    noted_until           date,
    is_noted_indefinitely boolean NOT NULL DEFAULT false,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tasks_series ON tasks (task_series_id, sort_order);
CREATE INDEX tasks_parent ON tasks (parent_task_id);

-- A file a parent put on a task.
CREATE TABLE task_attachments (
    id               uuid PRIMARY KEY,
    task_id          uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    name             text NOT NULL,
    -- Its media type, and where it is in object storage.
    type             text NOT NULL,
    url              text NOT NULL,
    kind             text,
    size_bytes       bigint,
    width            integer,
    height           integer,
    duration_sec     double precision,
    thumbnail_url    text,
    thumbnail_width  integer,
    thumbnail_height integer,
    blurhash         text,
    waveform_peaks   jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_attachments_task ON task_attachments (task_id);

-- Something a parent asks for when a task is handed in: some writing, a photo, a recording, a file.
CREATE TABLE task_response_fields (
    id          uuid PRIMARY KEY,
    task_id     uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    type        text NOT NULL CHECK (type IN ('rich_text', 'photo', 'video', 'audio', 'file')),
    label       text NOT NULL,
    description text,
    weight      double precision NOT NULL DEFAULT 0,
    required    boolean NOT NULL DEFAULT false,
    sort_order  integer NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_response_fields_task ON task_response_fields (task_id);

-- One step in a task's life: it moved from one state to another, or someone said something about it.
CREATE TABLE task_updates (
    id                   uuid PRIMARY KEY,
    task_id              uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
    actor_id             uuid REFERENCES family_members (id) ON DELETE SET NULL,
    affected_person_id   uuid REFERENCES family_members (id) ON DELETE SET NULL,
    -- A parent's feedback names the hand-in it answers.
    reply_to_id          uuid REFERENCES task_updates (id) ON DELETE SET NULL,
    from_state           text NOT NULL CHECK (from_state IN ('not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done')),
    to_state             text NOT NULL CHECK (to_state IN ('not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done')),
    note                 text,
    -- A draft holds a response that is still being written, and has moved nothing.
    is_draft             boolean NOT NULL DEFAULT false,
    scheduled_for        date NOT NULL,
    restore_timing       text CHECK (restore_timing IN ('now', 'next_scheduled')),
    grade_type_id        uuid REFERENCES grade_types (id) ON DELETE SET NULL,
    grade_numeric_value  double precision,
    grade_display_value  text,
    grade_is_provisional boolean,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_updates_task ON task_updates (task_id, created_at);
CREATE INDEX task_updates_reply ON task_updates (reply_to_id);

-- A file sent along with an update.
CREATE TABLE task_update_attachments (
    id               uuid PRIMARY KEY,
    update_id        uuid NOT NULL REFERENCES task_updates (id) ON DELETE CASCADE,
    name             text NOT NULL,
    type             text NOT NULL,
    url              text NOT NULL,
    kind             text,
    size_bytes       bigint,
    width            integer,
    height           integer,
    duration_sec     double precision,
    thumbnail_url    text,
    thumbnail_width  integer,
    thumbnail_height integer,
    blurhash         text,
    waveform_peaks   jsonb,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_update_attachments_update ON task_update_attachments (update_id);

-- What was handed in for one response field, with one update. A draft's answers move to the update that submits them.
CREATE TABLE task_response_field_values (
    id                uuid PRIMARY KEY,
    update_id         uuid NOT NULL REFERENCES task_updates (id) ON DELETE CASCADE,
    field_id          uuid NOT NULL REFERENCES task_response_fields (id) ON DELETE CASCADE,
    rich_text_content text,
    file_url          text,
    file_name         text,
    file_type         text,
    file_size_bytes   bigint,
    thumbnail_url     text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    UNIQUE (update_id, field_id)
);

CREATE INDEX task_response_field_values_field ON task_response_field_values (field_id);

ALTER PUBLICATION powersync ADD TABLE
    grade_types, task_series, tasks, task_attachments, task_response_fields, task_updates, task_update_attachments,
    task_response_field_values;
