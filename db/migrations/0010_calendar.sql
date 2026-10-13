-- The calendar: the family's own events and the ones brought in from a calendar elsewhere.

CREATE TABLE calendar_tags (
    id         uuid PRIMARY KEY,
    name       text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- One tag of a name, however it is capitalized.
CREATE UNIQUE INDEX calendar_tags_name ON calendar_tags (lower(name));

-- An event, in iCalendar's terms.
CREATE TABLE calendar_items (
    id                             uuid PRIMARY KEY,
    title                          text NOT NULL,
    description                    text,
    location                       text,
    url                            text,
    -- An all-day event has days, and ends on the day after its last. A timed event has instants. Never both.
    start_date                     date,
    end_date                       date,
    starts_at                      timestamptz,
    ends_at                        timestamptz,
    time_zone                      text,
    status                         text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('tentative', 'confirmed', 'cancelled')),
    event_type                     text NOT NULL DEFAULT 'default',
    visibility                     text NOT NULL DEFAULT 'default',
    -- Whether it takes up the time it covers.
    transparency                   text NOT NULL DEFAULT 'opaque' CHECK (transparency IN ('opaque', 'transparent')),
    priority                       integer,
    uid                            text UNIQUE,
    sequence                       integer NOT NULL DEFAULT 0,
    dtstamp                        timestamptz,
    last_modified                  timestamptz,
    -- How it repeats: the rule, without its `RRULE:` label, and the occurrences added to it and taken out of it.
    -- An occurrence is named as iCalendar names it: a day, or a date and time in the event's own time zone.
    rrule                          text,
    rdates                         text[] NOT NULL DEFAULT '{}',
    exdates                        text[] NOT NULL DEFAULT '{}',
    -- One occurrence of a repeating event that was changed: the event it belongs to, and which occurrence it replaces.
    recurring_event_id             uuid REFERENCES calendar_items (id) ON DELETE CASCADE,
    recurrence_id                  text,
    recurrence_id_range            text,
    -- Read and written whole, by the event form and the calendar import.
    organizer                      jsonb,
    attendees                      jsonb,
    alarms                         jsonb,
    x_props                        jsonb,
    travel_duration_before_minutes integer,
    travel_duration_after_minutes  integer,
    -- For an event brought in from elsewhere: from what kind of calendar, which one, and what it is known as there.
    source_type                    text,
    source_read_only               boolean NOT NULL DEFAULT false,
    source_sync_status             text CHECK (source_sync_status IN ('active', 'cancelled', 'deleted-remote')),
    source_calendar_name           text,
    source_external_id             text UNIQUE,
    source_remote_url              text,
    created_at                     timestamptz NOT NULL DEFAULT now(),
    updated_at                     timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (start_date IS NOT NULL AND end_date IS NOT NULL AND starts_at IS NULL AND ends_at IS NULL)
        OR (start_date IS NULL AND end_date IS NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL)
    ),
    CHECK (end_date > start_date),
    CHECK (ends_at >= starts_at),
    CHECK ((recurring_event_id IS NULL) = (recurrence_id IS NULL)),
    UNIQUE (recurring_event_id, recurrence_id)
);

CREATE INDEX calendar_items_days ON calendar_items (start_date, end_date) WHERE start_date IS NOT NULL;
CREATE INDEX calendar_items_instants ON calendar_items (starts_at, ends_at) WHERE starts_at IS NOT NULL;

-- Whom an event is for. One for nobody in particular is for everyone.
CREATE TABLE calendar_item_members (
    calendar_item_id uuid NOT NULL REFERENCES calendar_items (id) ON DELETE CASCADE,
    family_member_id uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
    PRIMARY KEY (calendar_item_id, family_member_id)
);

CREATE INDEX calendar_item_members_member ON calendar_item_members (family_member_id);

CREATE TABLE calendar_item_tags (
    calendar_item_id uuid NOT NULL REFERENCES calendar_items (id) ON DELETE CASCADE,
    tag_id           uuid NOT NULL REFERENCES calendar_tags (id) ON DELETE CASCADE,
    PRIMARY KEY (calendar_item_id, tag_id)
);

CREATE INDEX calendar_item_tags_tag ON calendar_item_tags (tag_id);

ALTER PUBLICATION powersync ADD TABLE calendar_tags, calendar_items, calendar_item_members, calendar_item_tags;
