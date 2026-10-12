-- Money: envelopes, what each holds, and the ledger of every change to one.
--
-- A device reads all of it and writes almost none of it. Ledger rows and balances are written only by the finance
-- routes, together, in one transaction (docs/powersync-migration.md, "Money is written only by the server").

CREATE TABLE allowance_envelopes (
    id               uuid PRIMARY KEY,
    -- Whose it is. An envelope outlives a member who leaves the family, because its ledger does.
    family_member_id uuid REFERENCES family_members (id) ON DELETE SET NULL,
    name             text NOT NULL,
    description      text,
    goal_amount      double precision,
    goal_currency    text,
    -- An envelope is never deleted. One that is no longer used is archived.
    archived_at      timestamptz,
    -- What a member's default envelope is held to, below.
    UNIQUE (id, family_member_id)
);

CREATE INDEX allowance_envelopes_member ON allowance_envelopes (family_member_id);

-- Which of a member's envelopes money goes into when nobody says. It is one of their own: the pair of columns is
-- what holds it to that. A member and their envelopes each name the other, so the check can be put off to the end
-- of a transaction, which is what loading a whole family at once needs.
ALTER TABLE family_members
    ADD COLUMN default_envelope_id uuid,
    ADD CONSTRAINT family_members_default_envelope
        FOREIGN KEY (default_envelope_id, id) REFERENCES allowance_envelopes (id, family_member_id)
        DEFERRABLE INITIALLY IMMEDIATE;

-- What an envelope holds, a row for each currency it holds any of.
CREATE TABLE envelope_balances (
    envelope_id uuid NOT NULL REFERENCES allowance_envelopes (id) ON DELETE RESTRICT,
    currency    text NOT NULL,
    amount      double precision NOT NULL,
    PRIMARY KEY (envelope_id, currency)
);

-- The ledger. A row is written once and never changed or removed.
CREATE TABLE allowance_transactions (
    id                      uuid PRIMARY KEY,
    envelope_id             uuid NOT NULL REFERENCES allowance_envelopes (id) ON DELETE RESTRICT,
    -- For a transfer, where the money came from and went to. A deposit names where it went.
    source_envelope_id      uuid REFERENCES allowance_envelopes (id) ON DELETE RESTRICT,
    destination_envelope_id uuid REFERENCES allowance_envelopes (id) ON DELETE RESTRICT,
    -- The kinds have grown over the years, and an old row keeps the word it was written with.
    transaction_type        text NOT NULL,
    amount                  double precision NOT NULL,
    currency                text NOT NULL,
    description             text NOT NULL DEFAULT '',
    created_by              uuid REFERENCES family_members (id) ON DELETE SET NULL,
    -- Set on an allowance payout, from the member, the period and the currency, so that one is never paid twice.
    distribution_key        text UNIQUE,
    created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX allowance_transactions_envelope ON allowance_transactions (envelope_id, created_at);
CREATE INDEX allowance_transactions_source ON allowance_transactions (source_envelope_id);
CREATE INDEX allowance_transactions_destination ON allowance_transactions (destination_envelope_id);

-- The last rate fetched between two currencies, kept so that a total can be shown in one of them.
CREATE TABLE exchange_rates (
    base_currency   text NOT NULL,
    target_currency text NOT NULL,
    rate            double precision NOT NULL,
    fetched_at      timestamptz NOT NULL,
    PRIMARY KEY (base_currency, target_currency)
);

ALTER PUBLICATION powersync ADD TABLE allowance_envelopes, envelope_balances, allowance_transactions, exchange_rates;
