#!/bin/sh
# Runs once, when Postgres first creates its data directory.
#
# PowerSync needs two things on this server that the app's migrations cannot give it: a database of its own for its
# bookkeeping, and a role it can read the app's tables through. The role can replicate and read, and change nothing.
set -e

: "${POWERSYNC_DB_PASSWORD:?Set POWERSYNC_DB_PASSWORD before the first start}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v powersync_password="$POWERSYNC_DB_PASSWORD" <<'SQL'
CREATE ROLE powersync WITH REPLICATION LOGIN PASSWORD :'powersync_password';
CREATE DATABASE powersync_storage OWNER powersync;

-- Every table the app creates, now or in a later migration, is readable by PowerSync. What it actually receives
-- is narrower: only the tables in the `powersync` publication, which the migrations maintain.
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync;
SQL
