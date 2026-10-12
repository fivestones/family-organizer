# Running the PowerSync slice on staging

**Date:** 2026-10-13
**For:** [Scope 7.2](../roadmap.md#72-one-slice-end-to-end) of the roadmap. The plan is [powersync-migration.md](powersync-migration.md).

This puts a second copy of the app beside the live one, running on Postgres and PowerSync with a copy of the family's data, so that the part of the app that has been built on PowerSync can be used on real devices. The live app is not touched: it keeps its own containers, its own environment file and InstantDB.

What you get at the end is one address. Every page on it leads to `/sync`: a day's chores, ticked and un-ticked, and the currency and countdown settings, with sign-in, a sync badge and a list of changes that did not go through.

**What has and has not been tried.** Steps 2, 3, 5, 6 and 7 have been run on a Mac exactly as written, from the Docker image built from a clean copy of the repository, with the real export: the app created its tables as it started, the import ran inside the container, and Chromium, Firefox and WebKit each landed on `/sync` and showed the family's chores within three seconds. What has not been tried is your server, and step 4: the Mac had no reverse proxy, so the browser reached the sync service directly, and the nginx rule has not been run anywhere. Budgeter's working equivalent is Caddy's. Expect step 4 to be where something needs adjusting.

## What you need

- A hostname for staging, served over HTTPS by the reverse proxy the live app already uses. It has to be its own hostname: a browser keeps storage, the service worker and the activation cookie per address, and staging must not share them with the live app.
- The export of the live data that is already on the Mac, under `.migration/exports/`. It holds the family's data in plain text. Copy it to the server by hand and do not commit it.

## Steps

All commands are run in the repository's folder on the server.

**1. Update the live app to this commit.** `git pull`, then rebuild as you normally do (`docker compose up -d --build`). Staging runs the same image. Nothing changes for the live app: with no `DATABASE_URL` in its `.env` it stays on InstantDB.

**2. Make staging's environment file.** The script prints fresh secrets and writes nothing itself.

```bash
docker run --rm family-organizer:latest node scripts/powersync/setup-env.mjs > .env.staging
```

Then add three lines of your own to `.env.staging`:

```
DEVICE_ACCESS_KEY=<a new key, not the live app's>
POWERSYNC_HOST_ALIAS=family-organizer-powersync-staging
DOCKER_NETWORK_NAME=<the reverse proxy's network, as in the live .env>
```

`.env.staging` is ignored by git, like every `.env` file here.

**3. Start staging.**

```bash
docker compose -p family-organizer-staging --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml --profile powersync up -d
```

Three containers start: the app as `family-organizer-staging`, Postgres, and the PowerSync service. The app creates its tables as it starts. The PowerSync service logs once that its publication is missing and carries on by itself when the tables exist.

**4. Point the reverse proxy at it.** Two rules on the staging hostname:

- everything to `http://family-organizer-staging:3000`;
- `/powersync/` to `http://family-organizer-powersync-staging:8080/`, with the prefix removed, WebSocket upgrades passed and response buffering off.

In nginx the second is:

```nginx
location /powersync/ {
    proxy_pass http://family-organizer-powersync-staging:8080/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

**5. Load the family's data.** With the export copied to `.migration/exports/` on the server:

```bash
docker compose -p family-organizer-staging --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml --profile powersync run --rm -v "$PWD/.migration:/app/.migration" family-organizer node scripts/migrate/import.mjs
```

It prints how many rows went into each table and anything it held back. On the export of 12 October that is 46 chore completions that belong to no chore, which is expected.

**6. Tell staging's clients to use PowerSync.**

```bash
docker compose -p family-organizer-staging --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml --profile powersync exec family-organizer node scripts/powersync/set-backend.mjs powersync
```

**7. Open it.** On a device, go to `https://<staging hostname>/?activate=<staging DEVICE_ACCESS_KEY>`. It should land on `/sync`, show "Up to date", and list today's chores. Pick yourself from the button at the top right to sign in.

## What to try

These are the checks only a real device can make ([Phase 2](powersync-migration.md#phase-2--one-slice-end-to-end)):

- On an iPad and an iPhone, in Safari, as a home-screen app, and in Orion: does it load and show "Up to date"?
- Tick a chore on one device. Does it appear on another, and how quickly?
- Turn on airplane mode, tick a chore, turn it off. Does the badge go from "1 change waiting" back to "Up to date"?
- **Close the browser completely, turn on airplane mode, and open the app.** Does it start? This is the one check nothing here could settle: Playwright's WebKit fails it, and Safari may not.
- Sign in as a parent over a kid, with "This is my own device" off, and sign out again. Does it go back to the kid?
- Compare a few days' chores with the live app.

## Taking it down

```bash
docker compose -p family-organizer-staging --env-file .env.staging -f docker-compose.yml -f docker-compose.staging.yml --profile powersync down --volumes
```

`--volumes` removes staging's Postgres data, which is only ever a copy.
