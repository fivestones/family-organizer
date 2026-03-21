# Thomas Family Organizer

Hey! This is the code for our family's organizer. I'm building this to help us (and maybe you, if you like this kind of thing!) manage our family life a bit more smoothly. It's a personal project, so I'm putting it on GitHub mainly to track my own changes and updates, but if you find it useful, feel free to run with it!

It runs as a Next.js web app plus an Expo mobile app, uses InstantDB for realtime data, and stores files in S3-compatible storage. There is a docker container you can use to spin the whole thing up.

The app is designed around shared family devices. Family members can signs in with their own PIN, but everyone doesn't need a device. Kids can mark of chores for other kids; the app keeps track of who was logged in when a chore was marked as complete so you can look at that if you need to. Parent-only actions work when a parent is logged in.

## What The App Does Today

- Personal and family dashboards with chores, task-series work, calendar items, progress, and balance snapshots

  The dashboard is meant to answer "what matters right now?" On web there is both a family-wide overview and a more personal widget-based view, and on mobile it acts as a daily summary and jumping-off point into tasks, calendar, messages, and finance.

- Chores with recurrence, rotation, up-for-grabs rewards, completion tracking, and per-member filtering

  Chores can repeat on schedules, rotate among family members, or be claimed as up-for-grabs work with either XP/weight or fixed rewards attached. The app also keeps track of who completed or marked a chore, which is especially useful on shared family devices. Chores can have start and end dates (or no end date) and can be paused for a time when needed.

- Task series for homeschooling or other multi-step work

  A task series is a structured queue of work that unfolds over time instead of as a single one-off item. It supports nested tasks, day-break scheduling, grading and response fields, parent review/feedback, and progress tracking, which makes it useful for laying out the specific daily tasks that are part of a homeschool curriculum, or for routines, or longer project work. Each task can have attached documents/files/images/video/audio, and can have one or more required response fields. Parent flows allow for feedback on the response fields and/or grading of the responses.

- Calendar views on web and mobile with Gregorian and Bikram Samvat (Nepali) dates, chore overlays, and Apple Calendar import/sync from selected calendars

  The calendar is used for both events created in the app and imported Apple calendar events. It supports all-day and timed events, recurrances for events, local editing, tags, and a shared schedule view while still showing chore-related context alongside normal calendar items. It can use either Gregorian or Bikram Samvat (Nepali) dates (or both at the same time). It also has views for a day, several days, a month, or even a full year. (The full year can still show the events--something I've always wanted but never could find in any other calendar software.)

- Family messaging with threads, replies, reactions, acknowledgements, attachments, unread tracking, and parent oversight tools

  Messaging is thread-based rather than just a single running chat. Parents can oversee household conversations, messages can require acknowledgement, and attachments can be shared directly inside the same place where family communication is happening.

- Finance tools built around multi-currency envelopes, transaction history, recurring allowance setup, and allowance distribution tied to chore completion

  Each family member can have multiple envelopes (with a savings goal if desired), and balances can be tracked across money and other units. There's not really a budget system yet, but if I get around to adding that this will work well for envelope budgeting (ynab-style). The app supports deposits, withdrawals, transfers, recurring allowance settings, and parent-side distribution flows that turn completed chore work into payouts. Multiple currencies are supported.

- File storage for family documents and media, plus attachment support across messages and task updates

  Files are stored centrally so the app can act as both a simple family file browser and an attachment source for task updates and messages. That makes it practical to keep instructions, photos, PDFs, and other supporting material close to the work or conversation they belong to.

- History and settings screens for family members, dashboard configuration, grade types, currencies/units, and Apple Calendar sync

  History works as an audit trail across the app, and settings is where the household-level configuration lives. Together they cover the "how is this family set up?" side of the app, not just the day-to-day usage side.

### Tech And Sync

- Realtime sync across connected clients
- Web app, installable PWA, and native mobile app
- Some offline support already, but not a "fully offline is done" claim yet
- InstantDB for the main data layer, Next.js API routes for privileged/device flows, and S3-compatible storage for files

Most day-to-day app data is read and written through InstantDB, so changes show up very quickly across the web app and mobile app. That realtime behavior is one of the main reasons this project feels usable on shared family devices instead of like a single-user tracker.

On the web side, the app can be installed like a PWA, while the mobile side runs as a native Expo app. The system is trying to feel local-first in practice, but I still think of the offline story as partial rather than finished: some pieces work fine when connectivity is spotty, but I would not describe the whole app as fully offline-complete yet.

## Platforms

### Web

The web app is the most complete surface today. Main routes include:

- `/` dashboard
- `/chores`
- `/tasks`
- `/task-series`
- `/calendar`
- `/messages`
- `/familyMemberDetail`
- `/allowance-distribution`
- `/history`
- `/settings`
- `/files`

### Mobile

- device activation and server URL setup
- shared-device lock/login with family member selection and parent PIN elevation
- dashboard, chores, calendar, messages, and finance tabs
- additional parent/admin screens for task series, family members, files, settings, and allowance preview

## Stack

- Next.js 16 + React 18 for web
- Expo / React Native for mobile
- InstantDB for realtime data, auth token flows, and typed schema-driven queries
- MinIO / S3-compatible object storage for files and images
- npm workspaces for the monorepo

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Copy the example env files:

```bash
cp .env.example .env
cp mobile/.env.example mobile/.env
```

3. Fill in the required values in `.env`:

- `NEXT_PUBLIC_INSTANT_APP_ID`
- `INSTANT_APP_ADMIN_TOKEN`
- `DEVICE_ACCESS_KEY`
- `NEXT_PUBLIC_S3_ENDPOINT`
- `S3_ENDPOINT`
- `S3_BUCKET_NAME`
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`

You can also set `INSTANT_APP_ID` explicitly for the server/admin side. In many local setups it can simply match `NEXT_PUBLIC_INSTANT_APP_ID`.

Optional Apple Calendar sync and tuning variables are documented in [`.env.example`](./.env.example).

4. Start the web app:

```bash
npm run dev
```

5. Start the mobile app in a second terminal when needed:

```bash
npm run mobile:start
```

or

```bash
npm run mobile:ios
```

The mobile app talks to the Next.js server for activation, parent elevation, mobile config, and file-related APIs. Set `EXPO_PUBLIC_API_BASE_URL` in [`mobile/.env.example`](./mobile/.env.example) if your simulator or phone cannot reach `http://localhost:3000`.

## Docker / Self-Hosting

[`docker-compose.yml`](./docker-compose.yml) runs:

- the Next.js app
- a MinIO container
- bucket bootstrap
- the Apple Calendar sync worker

You still need to provide your Instant app credentials in `.env`.

```bash
docker compose up -d --build
```
Once you've set up your `.env` file, to upgrade the app to get new updates from the repo, just do `git pull` and then `docker compose up -d --build`.

When I use the docker setup, I usually use linuxserver.io's swag container, set up with a domain of mine, to get https and then I use the following files in swag's swag/config/nginx/proxy-conf/ folder:

<details>
<summary>Click to show the nginx conf files I use</summary>

`family-organizer.subdomain.conf`:
```
server {
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name fam.*;

    include /config/nginx/ssl.conf;

    client_max_body_size 0;

    location / {
        include /config/nginx/proxy.conf;
        include /config/nginx/resolver.conf;

        # WEBSOCKET SUPPORT (Critical for Next.js & InstantDB)
        # The standard proxy.conf includes basics, but explicitly ensuring
        # upgrade headers is good practice for Next.js apps.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # DOCKER DNS RESOLUTION
        # "family-organizer" matches the container_name in your docker-compose.yml
        set $upstream_app family-organizer;
        set $upstream_port 3000;
        set $upstream_proto http;

        proxy_pass $upstream_proto://$upstream_app:$upstream_port;
    }
}
```

`s3.subdomain.conf`:
```
server {
    listen 443 ssl;
    listen [::]:443 ssl;

    server_name s3.*;

    include /config/nginx/ssl.conf;

    # Required for presigned upload POSTs
    client_max_body_size 10G;

    # Disable buffering for streaming large files
    proxy_buffering off;
    proxy_request_buffering off;

    location / {
        # CORS headers

        include /config/nginx/proxy.conf;
        include /config/nginx/resolver.conf;

        set $upstream_app minio;
        set $upstream_port 9000;
        set $upstream_proto http;

        proxy_pass $upstream_proto://$upstream_app:$upstream_port;

    }
}
```
</details>

## Instant Schema And Permissions

The Instant schema lives in [`instant.schema.ts`](./instant.schema.ts) and permissions live in [`instant.perms.ts`](./instant.perms.ts).

If you create a new Instant app or switch environments, use the Instant CLI to sync schema and permissions:

```bash
npx instant-cli pull --yes
npx instant-cli push schema --yes
npx instant-cli push perms --yes
```

For self-hosted or local Instant development, you can also set `NEXT_PUBLIC_INSTANT_API_URI` and `NEXT_PUBLIC_INSTANT_WEBSOCKET_URI`.

## Testing

```bash
npm test
npm run test:e2e
npm run test:all
```

## Apple Calendar Sync Setup

The app now supports one-way Apple Calendar import via CalDAV. The Family Organizer server connects to Apple, pulls events into InstantDB, and keeps them updated on a schedule. Imported events can be edited and deleted locally inside the app for now.

### What this sync does right now

-   One-way sync from Apple Calendar into Family Organizer.
-   One Apple account per Family Organizer deployment.
-   Centralized server sync. No phone or browser has to stay open after setup.
-   Imported events appear in the normal calendar views.
-   Imported events are marked as Apple-sourced in the UI and can be edited or deleted locally for now.

### 1. Make sure your schema and perms are current

If you just pulled a version of the app that includes Apple sync, push the latest Instant schema and perms before trying to connect:

```bash
npx instant-cli push schema --yes
npx instant-cli push perms --yes
```

The Apple sync feature depends on additional `calendarItems` fields plus the new `calendarSyncAccounts`, `calendarSyncCalendars`, `calendarSyncRuns`, and `calendarSyncLocks` entities.

### 2. Add the required server environment variables

These must be available to the Next.js server. Put them in your server environment or local `.env.local`. Do **not** expose them to the client as `NEXT_PUBLIC_*` variables.

```bash
CALDAV_CREDENTIAL_ENCRYPTION_KEY=replace-with-a-random-32-byte-secret
CALDAV_CREDENTIAL_ENCRYPTION_KEY_VERSION=v1
CALENDAR_SYNC_CRON_SECRET=replace-with-a-long-random-secret
```

Optional tuning variables:

```bash
APPLE_CALDAV_SYNC_WINDOW_PAST_DAYS=90
APPLE_CALDAV_SYNC_WINDOW_FUTURE_DAYS=365
APPLE_CALDAV_REPAIR_SCAN_INTERVAL_HOURS=24
APPLE_CALDAV_LOCK_TTL_MINUTES=20
APPLE_CALDAV_POLL_BASE_SECONDS=15
APPLE_CALDAV_POLL_MAX_IDLE_SECONDS=300
APPLE_CALDAV_POLL_ERROR_SECONDS=30
APPLE_CALDAV_POLL_MAX_ERROR_SECONDS=300
APPLE_CALDAV_DISCOVERY_REFRESH_HOURS=12
```

Notes:

-   `CALDAV_CREDENTIAL_ENCRYPTION_KEY` is used to encrypt the stored Apple app-specific password at rest.
-   `CALENDAR_SYNC_CRON_SECRET` is what your scheduler uses to authenticate the sync endpoint.
-   The window defaults are usually fine. They control how much history/future data gets materialized into `calendarItems`.
-   The poll settings control the near-real-time Apple polling behavior. The server stays “hot” after changes and automatically backs off when calendars are quiet or failing.
-   `APPLE_CALDAV_DISCOVERY_REFRESH_HOURS` controls how often the server refreshes Apple calendar metadata. Hot polls reuse cached calendar URLs and `sync-token` state between refreshes to keep Apple request volume low.

### 3. Create an Apple app-specific password

Apple Calendar CalDAV access should use an app-specific password, not your normal Apple ID password.

1.  Sign in to your Apple account management page.
2.  Make sure two-factor authentication is enabled on the Apple account.
3.  Create an app-specific password for Family Organizer.
4.  Copy the generated password somewhere temporary so you can paste it into the app during setup.

You will use:

-   Apple ID email address
-   App-specific password

### 4. Start the app and connect Apple Calendar as a parent

You can do this from the web settings page or the mobile settings screen, but using the web app is the easiest first setup path.

1.  Start the app and log in as a parent.
2.  Open `Settings`.
3.  Find the `Apple Calendar Sync` section.
4.  Enter:
    -   Apple ID email
    -   app-specific password
    -   optional account label
5.  Click `Connect`.
6.  Wait for the server to validate the CalDAV credentials and discover available Apple calendars.
7.  Select the Apple calendars you want imported.
8.  Save the settings.
9.  Trigger `Sync now` for the initial import if it does not start automatically in your environment.

What happens during connect:

-   The server authenticates to Apple via CalDAV.
-   It discovers the principal URL and calendar home.
-   It stores the encrypted app-specific password in InstantDB sync metadata.
-   It saves the discovered calendars and their selection state.

### 5. Understand what you should expect after the first sync

-   The first sync imports events from the configured sync window.
-   By default that is `90` days in the past and `365` days in the future.
-   Recurring Apple events are materialized into visible occurrences inside that window so they show up in the existing calendar views.
-   Imported events are editable and deletable in Family Organizer for now.
-   Those changes are local only. A future two-way sync will write changes back to Apple, but today Apple remains the source of truth if the remote event changes later.
-   If an event is cancelled or deleted in Apple Calendar, the next sync will mark the imported Family Organizer copy as cancelled/deleted-remote.

### 6. Set up the recurring server sync job

The sync route is:

```text
POST /api/calendar-sync/apple/run
```

Recommended schedule:

-   Hit the sync route every `15-30` seconds if your platform supports frequent scheduled requests.
-   The server uses cached calendar metadata, `sync-token` deltas, and adaptive backoff, so frequent ticks do **not** always mean a full sync run.
-   Apple calendar discovery is refreshed separately on a slower cadence based on `APPLE_CALDAV_DISCOVERY_REFRESH_HOURS`, or sooner if cached metadata is missing.
-   The app still automatically forces periodic repair scans based on `APPLE_CALDAV_REPAIR_SCAN_INTERVAL_HOURS`.

Authenticate the request with either:

-   `Authorization: Bearer <CALENDAR_SYNC_CRON_SECRET>`
-   or `x-calendar-sync-secret: <CALENDAR_SYNC_CRON_SECRET>`

Example:

```bash
curl -X POST http://localhost:3001/api/calendar-sync/apple/run \
  -H "Authorization: Bearer $CALENDAR_SYNC_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"trigger":"cron"}'
```

Notes:

-   The sync system uses a lock so overlapping runs do not step on each other.
-   If a run is already in progress, the route may return a skipped/already-running response instead of starting another job.
-   If the next Apple poll is not due yet, the route will return a skipped `not_due` response with the next recommended poll delay.
-   You can manually force a repair-style run with `{"trigger":"repair"}` if needed.

### 6a. Optional self-hosted worker for fast polling

If your hosting platform does not support 15-second cron-like schedules, run the included worker process instead:

```bash
CALENDAR_SYNC_CRON_SECRET=replace-with-the-same-secret \
APPLE_CALDAV_POLL_TARGET_URL=http://localhost:3001 \
npm run calendar-sync:worker
```

What this worker does:

-   It calls `POST /api/calendar-sync/apple/run` with the cron secret.
-   It respects the server-provided `nextPollInMs` backoff guidance.
-   It keeps polling near-real-time when changes are happening and slows down automatically when Apple calendars are quiet.

The worker is a good fit for:

-   self-hosted deployments
-   a sidecar/container process
-   `systemd`, `pm2`, or another long-running process manager

If you deploy with this repo's Docker Compose setup, the worker now runs automatically as a second service:

-   app service: `family-organizer`
-   worker service: `family-organizer-calendar-sync-worker`

That means the usual deploy flow is enough:

```bash
git pull
docker compose up -d --build
```

The worker container waits for the web app to become healthy, then starts polling `http://family-organizer:3000/api/calendar-sync/apple/run` over the internal Docker network.

Helpful checks:

```bash
docker compose ps
docker compose logs -f family-organizer-calendar-sync-worker
```

### 7. Verify that it is working

Good signs:

-   The Apple Calendar Sync settings card shows a connected account.
-   Selected calendars are listed.
-   `Last sync` updates after a run.
-   Apple events appear in the normal calendar views.
-   Imported events show Apple sync indicators.

If you want to check the sync endpoint directly in development:

```bash
curl http://localhost:3001/api/calendar-sync/apple/status
```

From the browser, that route uses your parent auth session. From cron, use the run route with the cron secret.

### 8. Common problems and what they usually mean

-   **Connect fails immediately:** the Apple ID email or app-specific password is wrong, or the Apple account is not ready for app-specific passwords.
-   **The route throws an encryption error:** `CALDAV_CREDENTIAL_ENCRYPTION_KEY` is missing on the server.
-   **Cron gets unauthorized responses:** `CALENDAR_SYNC_CRON_SECRET` does not match what the server is configured to expect.
-   **No events show up after connecting:** make sure at least one discovered Apple calendar is enabled and run a manual sync.
-   **Events show up but your edits disappear after Apple changes the same event:** that is expected until two-way sync is added, because Apple is still the source of truth.
-   **Apple password changed or revoked later:** reconnect from Settings with a fresh app-specific password.
-   **You imported the feature into a fresh Instant app and settings behave oddly:** double-check that schema and perms were pushed after pulling the latest code.

### 9. Current limitations

-   This is one-way sync only. Editing Family Organizer events does not write back to Apple Calendar.
-   The system currently supports one Apple account per Family Organizer deployment.
-   Imported events are not automatically assigned to specific family members.
-   A real-world smoke test against your own iCloud account is still a very good idea after setup, especially if you rely heavily on recurring events and timezone-heavy calendars.