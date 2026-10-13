-- A member's default envelope is one still in use. The foreign key holds it to an envelope of their own; these
-- hold it to one that has not been archived, whoever writes either row: a device choosing a default, the finance
-- routes archiving an envelope, or someone at a database prompt. The finance routes move the default first.

CREATE FUNCTION family_members_default_envelope_is_open() RETURNS trigger AS $$
BEGIN
    IF NEW.default_envelope_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM allowance_envelopes WHERE id = NEW.default_envelope_id AND archived_at IS NOT NULL) THEN
        RAISE EXCEPTION 'An archived envelope cannot be a default envelope.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER family_members_default_envelope_is_open
    BEFORE INSERT OR UPDATE OF default_envelope_id ON family_members
    FOR EACH ROW EXECUTE FUNCTION family_members_default_envelope_is_open();

CREATE FUNCTION allowance_envelopes_archived_is_no_default() RETURNS trigger AS $$
BEGIN
    IF NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL
       AND EXISTS (SELECT 1 FROM family_members WHERE default_envelope_id = NEW.id) THEN
        RAISE EXCEPTION 'A default envelope cannot be archived. Choose another default first.' USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER allowance_envelopes_archived_is_no_default
    BEFORE UPDATE OF archived_at ON allowance_envelopes
    FOR EACH ROW EXECUTE FUNCTION allowance_envelopes_archived_is_no_default();
