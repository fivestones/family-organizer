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
# Copying off the machine needs BACKUP_OFFSITE_REMOTE, an rclone remote, and its configuration in ./rclone. Until
# that is set the backups stay on the disk they describe, and the app's health report says so every day.
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
