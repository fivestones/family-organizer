#!/bin/sh
# The nightly jobs for the Postgres and PowerSync services in docker-compose.yml: back the database up, copy the
# backups off this machine, and compact the sync service's storage. Schedule it on the host, for example with cron:
#
#   30 2 * * *  /path/to/family-organizer/scripts/powersync/nightly.sh
#
# It reads the project's .env, or the environment file named as its argument. A second copy of the project, such as
# staging, names itself and its extra compose file there, with COMPOSE_PROJECT_NAME and COMPOSE_FILE. Each job stops
# the script if it fails, so nothing is recorded that did not happen.
#
# The dumps are plain files in BACKUP_DIR (./backups unless set), one a night. Getting them off the machine is
# either this script's job or somebody else's, and BACKUP_OFFSITE_REMOTE says which: an rclone remote, with its
# configuration in ./rclone, and they are copied there each night; the word `external`, and they are left for
# whatever already backs that folder up. Until it is set to one or the other the app's health report keeps asking.
set -eu
root=$(cd "$(dirname "$0")/../.." && pwd)
env_file="${1:-}"

run() {
    docker compose --project-directory "$root" ${env_file:+--env-file "$env_file"} --profile powersync --profile maintenance run --rm "$@"
}

run fo-backup

status=0
run fo-offsite || status=$?
if [ "$status" -eq 0 ]; then
    run fo-backup record offsite
elif [ "$status" -ne 3 ]; then
    echo "Copying the backups off this machine failed." >&2
    exit "$status"
fi

run fo-powersync-compact
run fo-backup record compact
