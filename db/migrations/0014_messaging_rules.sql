-- Two things about messages that the database keeps, so that no code has to remember to.

-- A device gives each message it sends a word of its own. Sent again after a lost answer, it is the same message.
CREATE UNIQUE INDEX messages_client_nonce ON messages (thread_id, author_id, client_nonce) WHERE client_nonce IS NOT NULL;

-- Everyone is in the family's thread and every parent is in the parents' thread, from the moment they are added.
-- Someone who stops being a parent leaves the parents' thread, and stops watching any thread they were not in.
CREATE FUNCTION family_members_keep_standing_threads() RETURNS trigger AS $$
BEGIN
    INSERT INTO message_thread_members (thread_id, family_member_id)
        SELECT id, NEW.id FROM message_threads
        WHERE thread_key = 'family' OR (thread_key = 'parents_only' AND NEW.role = 'parent')
        ON CONFLICT DO NOTHING;
    IF NEW.role <> 'parent' THEN
        DELETE FROM message_thread_members AS membership
            USING message_threads AS thread
            WHERE membership.thread_id = thread.id AND membership.family_member_id = NEW.id
              AND (thread.thread_key = 'parents_only' OR membership.member_role = 'watcher');
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER family_members_keep_standing_threads
    AFTER INSERT OR UPDATE OF role ON family_members
    FOR EACH ROW EXECUTE FUNCTION family_members_keep_standing_threads();
