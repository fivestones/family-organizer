-- What PowerSync is sent. A table reaches devices only if it is listed here and a stream in
-- powersync/sync-config.yaml selects from it; a table that is neither stays on the server.
-- A migration that adds a synced table adds it to this publication.
CREATE PUBLICATION powersync FOR TABLE
    settings,
    unit_definitions,
    family_members,
    chores,
    chore_assignees,
    chore_completions;
