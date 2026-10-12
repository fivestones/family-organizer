-- Who is signed in, and the bookkeeping of sync: what each device has uploaded, and what the server refused.
-- docs/powersync-migration.md, "Identity and sessions" and "Writes: the upload endpoint".

-- What every client is told when it starts: which backend to use, and whether anything has changed under it.
-- There is one row, and `only_row` makes a second impossible.
CREATE TABLE installation (
    only_row         boolean PRIMARY KEY DEFAULT true CHECK (only_row),
    id               uuid NOT NULL DEFAULT gen_random_uuid(),
    -- Changes whenever the data under the app is replaced, at cutover and after a restore. A device's local
    -- database belongs to one generation and is never opened under another.
    data_generation  integer NOT NULL DEFAULT 1,
    backend          text NOT NULL DEFAULT 'instant' CHECK (backend IN ('instant', 'powersync')),
    writes_frozen    boolean NOT NULL DEFAULT false,
    min_client_build integer NOT NULL DEFAULT 0
);

INSERT INTO installation DEFAULT VALUES;

-- One person signed in on one device. The shared kid session is the one with no family member.
CREATE TABLE auth_sessions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- The device holds the token. Only its hash is kept here, so reading this table lets nobody sign in.
    token_hash       text NOT NULL UNIQUE,
    principal_type   text NOT NULL CHECK (principal_type IN ('kid', 'parent')),
    family_member_id uuid REFERENCES family_members (id) ON DELETE CASCADE,
    -- active: whatever its principal may do. draining: only finish uploading what its database still holds.
    -- ended: nothing.
    state            text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'draining', 'ended')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    last_seen_at     timestamptz NOT NULL DEFAULT now(),
    expires_at       timestamptz NOT NULL,
    -- Set when the session is narrowed to draining. Past it, the session is treated as ended.
    drain_until      timestamptz,
    ended_at         timestamptz,
    CHECK (principal_type = 'kid' OR family_member_id IS NOT NULL),
    CHECK (state <> 'draining' OR drain_until IS NOT NULL)
);

CREATE INDEX auth_sessions_member ON auth_sessions (family_member_id);

-- Every transaction a device has uploaded, once. A retry finds its row here and is answered with the outcome it
-- was given the first time, in place of being applied again.
CREATE TABLE sync_uploads (
    -- The device database the transaction came from, and its number in that database.
    client_id      text NOT NULL,
    transaction_id bigint NOT NULL,
    session_id     uuid REFERENCES auth_sessions (id) ON DELETE SET NULL,
    principal      text NOT NULL,
    mutation       text,
    -- Empty only while the transaction is being applied.
    outcome        jsonb,
    received_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (client_id, transaction_id)
);

CREATE INDEX sync_uploads_received ON sync_uploads (received_at);

-- A write the server refused. It syncs to the person who made it, and to parents, so that a refusal that happens
-- in the background, or after the device has changed hands, is still seen.
CREATE TABLE write_refusals (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    family_member_id uuid REFERENCES family_members (id) ON DELETE CASCADE,
    principal_type   text NOT NULL CHECK (principal_type IN ('kid', 'parent')),
    -- The name of the mutation that made the write, and the code for why it was refused.
    mutation         text,
    reason           text NOT NULL,
    table_name       text,
    row_id           text,
    refused_at       timestamptz NOT NULL DEFAULT now(),
    dismissed_at     timestamptz
);

CREATE INDEX write_refusals_member ON write_refusals (family_member_id) WHERE dismissed_at IS NULL;

ALTER PUBLICATION powersync ADD TABLE write_refusals;
