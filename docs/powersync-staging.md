# Running the PowerSync slice on staging

**Date:** 2026-10-13
**For:** [Scope 7.2](../roadmap.md#72-one-slice-end-to-end) of the roadmap. The plan is [powersync-migration.md](powersync-migration.md).

This puts a second copy of the app beside the live one, running on Postgres and PowerSync with a copy of the family's data, so that the part of the app that has been built on PowerSync can be used on real devices. The live app is not touched: it keeps its own containers, its own environment file and InstantDB.

What you get at the end is one address. Every page on it leads to `/sync`: a day's chores, ticked and un-ticked, and the currency and countdown settings, with sign-in, a sync badge and a list of changes that did not go through.

**What has and has not been tried.** The Caddy rule below has been run for real: a Caddy with exactly that rule stood in front of the sync service, and the live sync tests passed through it both ways a device can hold its connection open, by WebSocket and by HTTP streaming. An earlier version of these steps was run end to end on a Mac from the built image with the real export, and Chromium, Firefox and WebKit each landed on `/sync` with the family's chores within three seconds. No real iPad, iPhone or Safari has opened it.

## What you need

- A hostname for staging, served over HTTPS by a reverse proxy on the same machine. It has to be its own hostname: a browser keeps storage, the service worker and the activation cookie per address, and staging must not share them with the live app.
- A folder of its own with a checkout of this repository. Staging shares nothing with the live app, which may be on this machine or another: its own folder and `.env`, its own image, its own Postgres, its own Docker network. Its file storage and calendar sync are not started; what is built on PowerSync so far needs neither.
- The export of the live data, under `.migration/exports/` on the machine it was made on. It holds the family's data in plain text. Copy it to the staging folder by hand and do not commit it.

## Steps

All commands are run in the staging folder.

**1. Make its `.env`.** The script prints fresh secrets, the two ports staging is reached on, and the two lines that make every `docker compose` command in this folder a staging command. It needs only Node, so a stock image runs it before the app's own image exists.

```bash
docker run --rm -v "$PWD:/app:ro" -w /app node:24-alpine node scripts/powersync/setup-env.mjs --staging > .env
```

Change `STAGING_APP_PORT` and `STAGING_POWERSYNC_PORT` in it if 8440 and 8430 are taken. `.env` is ignored by git.

**2. Build and start it.**

```bash
docker compose up -d --build
```

Three containers start: the app as `family-organizer-staging`, Postgres, and the PowerSync service. The app is on `127.0.0.1:8440` and the sync service on `127.0.0.1:8430`, reachable from this machine only. The app creates its tables as it starts. The PowerSync service logs once that its publication is missing and carries on by itself when the tables exist.

**3. Point the reverse proxy at it.** Two rules on the staging hostname: `/powersync/` to the sync service with the prefix removed and response buffering off, and everything else to the app. In Caddy, inside the site that serves the hostname:

```caddy
@family-organizer-staging host <staging hostname>
handle @family-organizer-staging {
    handle_path /powersync/* {
        reverse_proxy 127.0.0.1:8430 {
            flush_interval -1
        }
    }
    handle {
        reverse_proxy 127.0.0.1:8440
    }
}
```

The name after `@` on the first line must be the name `handle` is given on the second. Caddy passes WebSocket upgrades by itself. In nginx the sync service's rule is a `location /powersync/` with `proxy_pass http://127.0.0.1:8430/;`, the `Upgrade` and `Connection` headers passed, `proxy_buffering off` and a long `proxy_read_timeout`; that one has not been run.

**4. Load the family's data.** With the export copied to `.migration/exports/` in the staging folder:

```bash
docker compose run --rm -v "$PWD/.migration:/app/.migration" family-organizer node scripts/migrate/import.mjs
```

It prints how many rows went into each table, anything it held back, and every conversion that changed how a value is held.

**5. Tell staging's clients to use PowerSync.**

```bash
docker compose exec family-organizer node scripts/powersync/set-backend.mjs powersync
```

**6. Open it.** On a device, go to `https://<staging hostname>/?activate=<DEVICE_ACCESS_KEY from the staging .env>`. It should land on `/sync`, show "Up to date", and list today's chores. Pick yourself from the button at the top right to sign in.

## What to try

These are the checks only a real device can make ([Phase 2](powersync-migration.md#phase-2--one-slice-end-to-end)):

- On an iPad and an iPhone, in Safari, as a home-screen app, and in Orion: does it load and show "Up to date"?
- Tick a chore on one device. Does it appear on another, and how quickly?
- Turn on airplane mode, tick a chore, turn it off. Does the badge go from "1 change waiting" back to "Up to date"?
- **Close the browser completely, turn on airplane mode, and open the app.** Does it start, show who was signed in and the day's chores, and take a tick? It does in Chromium and Firefox. On Safari nothing here could settle it: Playwright's WebKit cannot load any page offline, which says nothing about Safari either way.
- Sign in as a parent over a kid, with "This is my own device" off, and sign out again. Does it go back to the kid?
- Compare a few days' chores with the live app.

## The nightly jobs, once by hand

Not needed to try the app, but staging is the place to see the backup work before production depends on it:

```bash
sh scripts/powersync/nightly.sh
```

It writes a dump under `./backups`, says it has nowhere to copy it to until `BACKUP_OFFSITE_REMOTE` is set, and compacts the sync service's storage. `https://<staging hostname>/api/health` then shows, under `data`, the sync service connected, how old the backup is, and anything that wants attention.

## Taking it down

```bash
docker compose down --volumes
```

`--volumes` removes staging's Postgres data, which is only ever a copy.
