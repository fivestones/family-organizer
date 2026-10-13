-- What the nightly jobs last did. The server reads it to say, in its health report, how old the newest backup is.

CREATE TABLE maintenance_runs (
    -- backup: the database was dumped to a file. offsite: the dumps were copied off this machine.
    -- compact: the sync service's own storage was compacted.
    kind        text NOT NULL CHECK (kind IN ('backup', 'offsite', 'compact')),
    finished_at timestamptz NOT NULL DEFAULT now(),
    detail      text,
    PRIMARY KEY (kind, finished_at)
);
