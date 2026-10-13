#!/bin/sh
# Run inside the `fo-backup` container, which has Postgres's own tools and the database's address in its
# environment. scripts/powersync/nightly.sh is what calls it.
#
#   backup.sh                 dump the app's database into /backups, check the dump, drop old ones, record it
#   backup.sh record <kind>   record that another nightly job finished: offsite, or compact
#
# It stops at the first failure, so a dump that could not be written or read back is never recorded as made.
set -eu

record() {
    psql --quiet --set ON_ERROR_STOP=1 --set kind="$1" --set detail="$2" <<'SQL'
INSERT INTO maintenance_runs (kind, detail) VALUES (:'kind', :'detail');
SQL
}

if [ "${1:-}" = "record" ]; then
    record "$2" "${3:-}"
    exit 0
fi

stamp=$(date -u +%Y-%m-%dT%H-%M-%SZ)
file="/backups/family-organizer-$stamp.dump"

# The sync service's own database is not dumped: it holds nothing that is not worked out again from this one.
pg_dump --format=custom --file="$file.partial"
# A dump that cannot be listed cannot be restored.
pg_restore --list "$file.partial" > /dev/null
mv "$file.partial" "$file"

find /backups -name 'family-organizer-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
find /backups -name 'family-organizer-*.partial' -mtime +1 -delete

record backup "$(basename "$file"), $(wc -c < "$file" | tr -d ' ') bytes"
echo "Backed up to $(basename "$file")."
