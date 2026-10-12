-- What the family posts for itself — announcements, a queue of things to show, the house rules — the dashboards,
-- and the files attached to a history entry.

CREATE TABLE announcements (
    id                uuid PRIMARY KEY,
    title             text NOT NULL,
    rich_text_content text,
    link_url          text,
    created_by        uuid REFERENCES family_members (id) ON DELETE SET NULL,
    expires_at        timestamptz,
    -- When it was taken down, by hand or by expiring. It is showing while this is empty.
    archived_at       timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- A channel of the content queue, such as a verse or a word of the week.
CREATE TABLE content_categories (
    id                  uuid PRIMARY KEY,
    slug                text NOT NULL UNIQUE,
    name                text NOT NULL,
    -- How long an item shows when it does not say.
    default_duration_ms bigint NOT NULL CHECK (default_duration_ms >= 0),
    -- Whether to start again from the oldest when nothing is waiting.
    loop_when_empty     boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE content_queue_items (
    id                uuid PRIMARY KEY,
    category_id       uuid NOT NULL REFERENCES content_categories (id) ON DELETE CASCADE,
    title             text NOT NULL,
    rich_text_content text,
    link_url          text,
    status            text NOT NULL CHECK (status IN ('queued', 'live', 'archived')),
    sort_order        integer NOT NULL DEFAULT 0,
    duration_ms       bigint CHECK (duration_ms >= 0),
    live_at           timestamptz,
    live_until        timestamptz,
    archived_at       timestamptz,
    created_by        uuid REFERENCES family_members (id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX content_queue_items_category ON content_queue_items (category_id, status, sort_order);

-- A house rule. Its words are in its versions: editing a rule writes a new one, and the old ones stay.
CREATE TABLE family_rules (
    id                uuid PRIMARY KEY,
    title             text NOT NULL,
    sort_order        integer NOT NULL DEFAULT 0,
    is_archived       boolean NOT NULL DEFAULT false,
    active_version_id uuid NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Written once, and never changed or removed while its rule stands.
CREATE TABLE family_rule_versions (
    id                  uuid PRIMARY KEY,
    rule_id             uuid NOT NULL REFERENCES family_rules (id) ON DELETE CASCADE,
    version_number      integer NOT NULL CHECK (version_number > 0),
    rich_text_content   text NOT NULL,
    edit_note           text,
    previous_version_id uuid REFERENCES family_rule_versions (id) ON DELETE SET NULL,
    created_by          uuid REFERENCES family_members (id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (rule_id, version_number),
    -- What a rule's current version is held to, below.
    UNIQUE (id, rule_id)
);

-- The version a rule currently reads as is one of its own. A rule and its first version each name the other, so
-- this is checked at the end of a transaction, when both are in.
ALTER TABLE family_rules
    ADD CONSTRAINT family_rules_active_version
        FOREIGN KEY (active_version_id, id) REFERENCES family_rule_versions (id, rule_id)
        DEFERRABLE INITIALLY DEFERRED;

-- A file on an announcement, a queue item or a version of a rule: on exactly one of them.
CREATE TABLE content_attachments (
    id               uuid PRIMARY KEY,
    announcement_id  uuid REFERENCES announcements (id) ON DELETE CASCADE,
    queue_item_id    uuid REFERENCES content_queue_items (id) ON DELETE CASCADE,
    rule_version_id  uuid REFERENCES family_rule_versions (id) ON DELETE CASCADE,
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
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CHECK (num_nonnulls(announcement_id, queue_item_id, rule_version_id) = 1)
);

CREATE INDEX content_attachments_announcement ON content_attachments (announcement_id);
CREATE INDEX content_attachments_queue_item ON content_attachments (queue_item_id);
CREATE INDEX content_attachments_rule_version ON content_attachments (rule_version_id);

-- The family dashboard is laid out once for each width of screen.
CREATE TABLE family_dashboard_layouts (
    id             uuid PRIMARY KEY,
    breakpoint_key text NOT NULL UNIQUE,
    label          text NOT NULL,
    min_width      integer NOT NULL,
    max_width      integer NOT NULL,
    sort_order     integer NOT NULL DEFAULT 0,
    -- One of the widths the app sets up for itself, as against one a parent added.
    is_default     boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- A widget on one layout: what it is, where it sits, and its own settings, which only it reads.
CREATE TABLE family_dashboard_widgets (
    id          uuid PRIMARY KEY,
    layout_id   uuid NOT NULL REFERENCES family_dashboard_layouts (id) ON DELETE CASCADE,
    widget_type text NOT NULL,
    x           double precision NOT NULL,
    y           double precision NOT NULL,
    w           double precision NOT NULL,
    h           double precision NOT NULL,
    z           integer NOT NULL DEFAULT 0,
    config      jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX family_dashboard_widgets_layout ON family_dashboard_widgets (layout_id);

-- How one person has arranged their own dashboard. There is one for each person who has changed anything.
CREATE TABLE dashboard_configs (
    family_member_id uuid PRIMARY KEY REFERENCES family_members (id) ON DELETE CASCADE,
    widget_order     jsonb,
    disabled_widgets jsonb,
    widget_settings  jsonb,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- A file on a history entry. Like the entry, it is written once.
CREATE TABLE history_event_attachments (
    id               uuid PRIMARY KEY,
    history_event_id uuid NOT NULL REFERENCES history_events (id) ON DELETE CASCADE,
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

CREATE INDEX history_event_attachments_event ON history_event_attachments (history_event_id);

ALTER PUBLICATION powersync ADD TABLE
    announcements, content_categories, content_queue_items, family_rules, family_rule_versions, content_attachments,
    family_dashboard_layouts, family_dashboard_widgets, dashboard_configs, history_event_attachments;
