-- The rest of the chore area: routines, the day's routine markers, and countdown runs.

-- A named, ordered group of chores, run one after another.
CREATE TABLE routines (
    id              uuid PRIMARY KEY,
    name            text NOT NULL,
    -- What the countdown does when a step runs past its time: wait for the person, or move on. Empty means wait.
    on_step_overrun text CHECK (on_step_overrun IN ('wait', 'advance')),
    sort_order      integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- The chores of a routine, in order. A chore is a step of a routine at most once.
CREATE TABLE routine_steps (
    routine_id uuid NOT NULL REFERENCES routines (id) ON DELETE CASCADE,
    chore_id   uuid NOT NULL REFERENCES chores (id) ON DELETE CASCADE,
    position   integer NOT NULL,
    PRIMARY KEY (routine_id, chore_id)
);

CREATE INDEX routine_steps_chore ON routine_steps (chore_id);

-- When one of the household's routine markers, such as dinner, started and finished on a day, and who said so.
CREATE TABLE routine_marker_statuses (
    day          date NOT NULL,
    marker_key   text NOT NULL,
    started_at   timestamptz,
    started_by   uuid REFERENCES family_members (id) ON DELETE SET NULL,
    completed_at timestamptz,
    completed_by uuid REFERENCES family_members (id) ON DELETE SET NULL,
    PRIMARY KEY (day, marker_key)
);

-- One person's countdown through their chores on one day. Its id is worked out from the person and the day, so two
-- devices that each start it offline start the same run.
CREATE TABLE countdown_runs (
    id                   uuid PRIMARY KEY,
    family_member_id     uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
    day                  date NOT NULL,
    routine_id           uuid REFERENCES routines (id) ON DELETE SET NULL,
    status               text NOT NULL CHECK (status IN ('running', 'stopped')),
    current_chore_id     uuid REFERENCES chores (id) ON DELETE SET NULL,
    skipped_chore_ids    uuid[] NOT NULL DEFAULT '{}',
    started_at           timestamptz NOT NULL,
    step_started_at      timestamptz,
    step_extension_secs  integer NOT NULL DEFAULT 0,
    step_extension_count integer NOT NULL DEFAULT 0,
    last_interaction_at  timestamptz,
    stopped_at           timestamptz,
    stopped_reason       text,
    UNIQUE (family_member_id, day)
);

ALTER PUBLICATION powersync ADD TABLE routines, routine_steps, routine_marker_statuses, countdown_runs;
