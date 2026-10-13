-- Messages: threads, who is in each, what was said, and what was done with it.
--
-- A device reads the threads its person is in, and a parent's reads them all. No device writes any of this:
-- sending, editing, reacting, acknowledging and reading all go through the message routes, as they do today.

CREATE TABLE message_threads (
    id                       uuid PRIMARY KEY,
    thread_type              text NOT NULL CHECK (thread_type IN ('family', 'parents_only', 'direct', 'group', 'linked')),
    visibility               text NOT NULL CHECK (visibility IN ('family', 'parents_only', 'members')),
    -- What makes a thread the one of its kind: the family's, the parents', the one between two people, or the one
    -- about a chore. Asking for it twice finds the same thread.
    thread_key               text NOT NULL UNIQUE,
    title                    text NOT NULL,
    -- For a thread about something: what kind of thing, and which. It may outlive the thing.
    linked_domain            text CHECK (linked_domain IN ('tasks', 'chores', 'calendar', 'finance')),
    linked_entity_id         text,
    is_closed                boolean NOT NULL DEFAULT false,
    created_by               uuid REFERENCES family_members (id) ON DELETE SET NULL,
    -- Kept by the message routes as each message is written, so the list of threads needs no message read.
    latest_message_at        timestamptz,
    latest_message_author_id uuid REFERENCES family_members (id) ON DELETE SET NULL,
    latest_message_preview   text,
    created_at               timestamptz NOT NULL DEFAULT now(),
    updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Who is in a thread, and how each of them keeps it.
CREATE TABLE message_thread_members (
    thread_id            uuid NOT NULL REFERENCES message_threads (id) ON DELETE CASCADE,
    family_member_id     uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
    member_role          text NOT NULL DEFAULT 'member' CHECK (member_role IN ('member', 'owner', 'watcher')),
    notification_level   text NOT NULL DEFAULT 'all' CHECK (notification_level IN ('all', 'mentions', 'mute', 'watch')),
    is_archived          boolean NOT NULL DEFAULT false,
    -- Pinned while this is set.
    pinned_at            timestamptz,
    joined_at            timestamptz NOT NULL DEFAULT now(),
    last_read_at         timestamptz,
    last_read_message_id uuid,
    PRIMARY KEY (thread_id, family_member_id)
);

CREATE INDEX message_thread_members_member ON message_thread_members (family_member_id);

CREATE TABLE messages (
    id             uuid PRIMARY KEY,
    thread_id      uuid NOT NULL REFERENCES message_threads (id) ON DELETE CASCADE,
    author_id      uuid REFERENCES family_members (id) ON DELETE SET NULL,
    body           text NOT NULL DEFAULT '',
    importance     text NOT NULL DEFAULT 'normal' CHECK (importance IN ('normal', 'urgent', 'announcement', 'needs_ack')),
    is_system      boolean NOT NULL DEFAULT false,
    reply_to_id    uuid REFERENCES messages (id) ON DELETE SET NULL,
    -- Made by the device that sent it, so that device can tell its own message when it comes back.
    client_nonce   text,
    metadata       jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    edited_at      timestamptz,
    editable_until timestamptz,
    -- A removed message stays, emptied, with who removed it and why.
    deleted_at     timestamptz,
    removed_by     uuid REFERENCES family_members (id) ON DELETE SET NULL,
    removed_reason text,
    -- What a member's place in a thread is held to, below.
    UNIQUE (id, thread_id)
);

CREATE INDEX messages_thread ON messages (thread_id, created_at);

-- A member's place in a thread is a message of that thread, or nothing once that message is gone.
ALTER TABLE message_thread_members
    ADD CONSTRAINT message_thread_members_last_read
        FOREIGN KEY (last_read_message_id, thread_id) REFERENCES messages (id, thread_id) ON DELETE SET NULL (last_read_message_id);

CREATE TABLE message_attachments (
    id               uuid PRIMARY KEY,
    message_id       uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
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

CREATE INDEX message_attachments_message ON message_attachments (message_id);

-- One person's one emoji on one message.
CREATE TABLE message_reactions (
    message_id       uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    family_member_id uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
    emoji            text NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, family_member_id, emoji)
);

-- That someone has seen a message, or has acknowledged one that asked for it.
CREATE TABLE message_acknowledgements (
    message_id       uuid NOT NULL REFERENCES messages (id) ON DELETE CASCADE,
    family_member_id uuid NOT NULL REFERENCES family_members (id) ON DELETE CASCADE,
    kind             text NOT NULL CHECK (kind IN ('seen', 'acknowledged')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, family_member_id, kind)
);

ALTER PUBLICATION powersync ADD TABLE
    message_threads, message_thread_members, messages, message_attachments, message_reactions, message_acknowledgements;
