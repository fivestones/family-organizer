-- The family's record of what happened: who did what, and to what. It is only ever added to.

CREATE TABLE history_events (
    id          uuid PRIMARY KEY,
    occurred_at timestamptz NOT NULL,
    domain      text NOT NULL CHECK (domain IN ('tasks', 'chores', 'calendar', 'finance', 'messages', 'system')),
    action_type text NOT NULL,
    summary     text NOT NULL,
    -- Where it came from: a person using the app, a calendar sync, or the server itself.
    source      text,
    -- Who did it. Empty for something no person did.
    actor_id    uuid REFERENCES family_members (id) ON DELETE SET NULL,

    -- What it was about. History has to go on naming things after they are deleted, so none of these is a foreign
    -- key: each holds the id the thing had.
    chore_id                 uuid,
    task_series_id           uuid,
    task_id                  uuid,
    calendar_item_id         uuid,
    allowance_transaction_id uuid,
    message_thread_id        uuid,
    message_id               uuid,

    -- The day the thing was scheduled for, where it had one.
    scheduled_for   date,
    restore_timing  text,
    -- Whatever else the event needs to be shown as it was: the chore's title then, the amount, and so on.
    metadata        jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX history_events_occurred ON history_events (occurred_at DESC);
CREATE INDEX history_events_chore ON history_events (chore_id) WHERE chore_id IS NOT NULL;

-- Whom an event affected, which is not always who did it: a parent ticking a kid's chore affects the kid.
CREATE TABLE history_event_members (
    history_event_id uuid NOT NULL REFERENCES history_events (id) ON DELETE CASCADE,
    family_member_id uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
    PRIMARY KEY (history_event_id, family_member_id)
);

CREATE INDEX history_event_members_member ON history_event_members (family_member_id);

ALTER PUBLICATION powersync ADD TABLE history_events, history_event_members;
