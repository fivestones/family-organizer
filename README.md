# Thomas Family Organizer

Hey! This is the code for our family's organizer. I'm building this to help us (and maybe you, if you like this kind of thing!) manage our family life a bit more smoothly. It's a personal project, so I'm putting it on GitHub mainly to track my own changes and updates, but if you find it useful, feel free to tinker with it!

## What It Can Do (Key Features)

Here's a rundown of what the Thomas Family Organizer offers so far:

-   **Dashboard / Daily Overview:**

    -   See upcoming events, chores due, task-series progress, and each person's current balance at a glance.
    -   There is a web dashboard and a native iPhone dashboard.

-   **Calendar:**

    -   Add, remove, and view calendar items easily.
    -   Handles both all-day and timed events.
    -   Supports recurring events, especially on the web app where the recurrence editing is more complete.
    -   Calendar items can be for the whole family or assigned to one or more specific people.
    -   Supports both Gregorian and Bikram Samvat calendars, and shows both together nicely.

-   **Chore Assignment and Tracking:**

    -   Clearly see all chores with avatars showing who is assigned.
    -   View chore schedules in a calendar-style preview, and see due chores on the dashboards.
    -   Assign chores to multiple people, with an option to have it automatically alternate between them.
    -   Set up auto-repeating chores with simple or complex recurrence patterns using rrule.
    -   The detailed create/edit chore form includes a working assignment preview.
    -   **"Up for Grabs" Chores:**
        -   Chores can be part of the normal allowance (required for 100% allowance) OR be "up for grabs" with a specific monetary amount or weight attached.
        -   Completed up-for-grabs chores feed into allowance distribution, either as a direct amount or as extra weight/value (allowing for earning more than 100% of assigned chore weight).

-   **Task Series (Advanced Chores / Homeschooling Module):**

    -   A task series is a series of tasks, such as the individual items for each day of a subject in a home school curriculum
    -   A task series manager is available to create, delete, and manage different task series
    -   A task series editor allows one to add a list of tasks in a freeform environment. Indent tasks to create sub-tasks/child tasks.
        -   Use "/" for a slash command drop down that lets you add a day break, showing where in the list of tasks the scheduling should move to the following day
        -   Assign a task series to a family member, and link it to a specific chore. It will be scheduled out so that the tasks will be shown with that Chore for that person
    -   Can be used to list homeschool subjects, with specific assignment items (as To-Dos) attached to a school subject chore (not a specific day), marked as starting on a certain date (appearing with that school subject chore on that day or the next scheduled day for that subject)
    -   Can create nested tasks. Useful for breaking down big tasks.
    -   Ability to see the whole string of upcoming dependent chores/assignments (and maybe those already completed).
    -   Assignments for a school subject could function like a playlist. On any given day of the Chore where the task series is active, it will show the next task that hasn't been done. If a task isn't done on a day it is scheduled, it will show up the next time that Chore appears.
    -   Attach files and notes to individual tasks, see the notes and view images/text files/pdfs from where the task is shown as due
    -   There is also a native iPhone view for seeing task-series progress and status

-   **Time travelling**

    -   Simulate different dates to see how things would play out

-   **Allowance & Money Management (Multi-Currency):**

    -   Each family member can have multiple "envelopes" to manage their funds.
    -   Easily deposit funds, withdraw/spend money, and transfer funds between their own envelopes or to another person.
    -   Envelopes can be deleted (with appropriate confirmations).
    -   View a full transaction history and current totals for each envelope and overall.
    -   The system accurately displays currency symbols (e.g., for Rupees, alongside others).
    -   **Smart Totals & Currency Conversion:**
        -   See the total current allowance for each person displayed next to their name in the family members list.
        -   View your total balance converted into a single chosen monetary currency (e.g., if you have USD, Euros, and Stars, it can show your total in USD and your total in Stars).
        -   The last chosen display currency now sticks for each family member.
    -   **Savings Goals:** Envelopes can have a designated savings goal amount.
    -   **Flexible Deposits:**
        -   Allows setting a default envelope for deposits.
        -   New family members added on the web get a default "Savings" envelope automatically.
    -   **Chore-Based Allowance Calculation:**
        -   Assign a numerical weight (any real number) to chores.
        -   Allowance payouts can be based on the total weighted value of chores marked "done" during a specific period.
        -   The system calculates the total weight of all assigned chores for the week and the total weight of completed chores to find a weighted completion percentage. (Bugs related to incorrect counting of all chores or issues with unchecking/rechecking have been resolved.)
        -   If a chore is unchecked after being marked done, it correctly no longer counts towards the allowance.
        -   View current stats for chores completed and the allowance due.
        -   Deposit the calculated percentage of a family member's weekly allowance into their default envelope. (The full allowance distribution workflow is strongest on the web right now.)

-   **Role-based User Access**

    -   Family members are users. Set PINs for each family members. Can set role (Parent or Child) for each user.
    -   Log in and log out, switch user
    -   Parents can do anything. Children can manage the parts meant for them, especially their own chores, tasks, and some of their own finances. Children can mark Chores or Tasks as done for someone else but the system keeps track of who marked it
    -   Parent mode can time out automatically on shared devices
    -   When not logged in, limited to viewing but can't make changes.

-   **Family Setup & Files:**

    -   Add and edit family members, set roles, and reorder the family list.
    -   Upload profile photos and a shared family photo.
    -   Upload and open files, and attach them to tasks (including images/text files/pdfs).

-   **Tech & Sync:**
    -   **Instant Sync:** Changes are reflected immediately across all connected clients.
    -   **Local-First Architecture:** Your data primarily lives on your device/server.
    -   Already has a web app and a native iPhone app.
    -   The web app can be installed like a PWA.
    -   There is some offline support already, but I still wouldn't call full offline use "done" yet.
    -   Uses `instantdb.com` in the background for its powerful syncing capabilities.

## What I'm Tinkering With Now (Current To-Do & Bugs)

This is the stuff I'm actively working on or plan to tackle very soon:

-   **Allowance System Enhancements:**
    -   Set up sophisticated rules for deposits (e.g., first $2 into envelope A, then of the remainder: 20% into envelope B and 80% into envelope C).
    -   Continue bringing the iPhone finance experience closer to the fuller web workflow, especially around allowance distribution.
-   **Transaction Viewing Improvements:**
    -   Add a graph next to the transaction list. This graph should somehow incorporate savings goal amounts for envelopes (maybe different colors for each envelope, with the total in its own color, showing progress towards goals).
    -   Include a running total in the transaction list, either per currency or as a combined total in a chosen currency.
    -   Allow filtering transactions by envelope.
-   **Chore System Next Steps:**
    -   Allow chores to be assigned during specific time periods of the day (using `timeOfDayDefinitions`).
        -   This might include meal-based timings like "Before Breakfast" (ends when breakfast is marked as started, or auto-ends at a set time like 11 am) or "After Dinner" (starts when dinner is marked done, or auto-starts at 7:30 pm).
    -   Show completed vs. uncompleted chores in the assignment preview when editing a chore (to see historical status).
    -   Make the chore preview more flexible to show other dates (e.g., for chores starting in the future or past).
        -   Maybe implement lazy loading: load a month before and after what's shown, and if the user scrolls towards the beginning/end, calculate and add another month of data.
    -   Ability to set end dates for chores.
    -   Implement pausing and restarting chores, potentially with an option to schedule these pauses/restarts.
    -   Refine chore deletion processes.
-   **Calendar Improvements:**
    -   More views, lazy loading with scrolling to other weeks/months/years, week view, full year view, better controls to turn on/off Gregorian and Bikram Samvat, maybe syncing with google or apple calendars.
-   **User Experience & General Polish:**
    -   Figure out the best way to handle future periods that are simulated and then marked as done. Should deposits also be marked as simulated? Or maybe simplify/hide the simulated date option.
    -   Kid's passcode needed to activate transfers out; parent passcode already activates parent mode (full transfer/deposit rights).
    -   Integrate the `familyMemberDetail` page more smoothly into the main interface, perhaps as a pop-up or section accessible from a family member's chore list.
-   **Allowance Adjustments:**

    -   Develop a system for managing changes to set allowance amounts (e.g., schedule future raises, change currencies, or apply changes retroactively or from the current time).

-   **Task Series (Advanced Chores / Homeschooling Module) additions:**

    -   Ability for tasks to start when another task is finished (e.g., previous day's assignments). If the preceding assignment is done, the next one appears on the next scheduled day for that subject. This is essentually already implemented, but doesn't yet allow one to have a task's scheduling be based on tasks from other task series.
    -   Assignments could depend on multiple other tasks (e.g., this one has to be after X but before Y).
    -   Chores (like school subjects) could change dynamically. For example, "7th Grade English" gets marked as "completely finished" when all its To-Dos are done, and then "8th Grade English" starts if it's after a certain date (e.g., Aug 1st).
    -   Need a way to work ahead--move on to the next assignment on the same day if desired (get ahead), possibly configurable per subject or assignment.

-   **Bugs on the Radar:**
    -   **Envelopes:** If an empty envelope is deleted, it should just give an "are you sure" message and not ask where to transfer funds to (since there are none).
    -   **Chore System (Up for Grabs):**
        -   Non-monetary up-for-grabs chores aren't getting properly deposited along with monetary chores (even though they show up in the allowance distribution calculation).
        -   The way chore period allowance distribution info (especially with up-for-grabs items) is shown needs to be arranged more clearly.
        -   When an up-for-grabs chore is done, while it disables it for others, it doesn't give them a message about _who_ has already done it.
        -   When an up-for-grabs chore is done, and you are viewing the chore list of the person who completed it, its name shouldn't be struck through (as it's a completed task for them, not an unavailable one).
    -   **Currency:** If a new currency is made and is not defined (e.g., no exchange rate or type), and money in that currency is deposited, the `familyMemberDetail` Total Balance hangs on loading.

## Dreaming Big (Future Ideas & Aspirations)

This is where I'd love to take the project eventually. No promises, but these are the things I'm thinking about!

-   **Even Better Calendar:**

    -   Cleaner individual calendar views for multiple people.
    -   More views: Day, 3-4 day, weekly, agenda, and full year views.
    -   Custom metadata for events: circle or highlight events, mark an event as "major" (to show only major events on yearly/other views).
    -   Flexible event timings: all-day, specific time, no particular time (shows differently from all-day), or broader time periods (Early morning, Morning, Mid-day, Afternoon, Evening, Night, Middle of the night).

-   **To-Do Lists:**

    -   Associate To-Dos with a particular person.
    -   Simple, effective regular lists.
    -   _Maybe To-Dos are just a specific kind of chore that only occurs once? Something to ponder._

-   **Meal Planning:**

    -   Connections to Mealie (or another self-hosted recipe app) for recipes and meal planning.

-   **Family Chores/Rewards Tracking (Already partially implemented, but can be expanded):**

    -   The core value/weight system for chores and allowance is in place.

-   **Dashboard View:**

    -   A view designed for keyboardless/mouseless usage (e.g., a tablet on the wall).

-   **Photo Stream:**

    -   Connect to an Immage photo server for a family photostream.

-   **Extensibility / Plugins:**

    -   Quote of the day widget.
    -   Current family Bible memory passage display.
    -   Current family hymn/song of the week.
    -   Kid homeschool/homework tracker (with items tagged for whether they can do it alone or only with a parent) - building on the Chores/Homeschooling ideas above.
    -   And whatever else sounds fun or useful!

-   **Broader Platform Support:**

    -   Make the Progressive Web App (PWA) much better for full offline use on any device.
    -   Keep rounding out the native iOS app, and maybe Android too.
    -   Two-way sync with Google Calendar, Apple Calendar, or CalDAV servers.

-   **"Maybe Someday" Ideas:**
    -   Simple messaging between family members within the app.
    -   Email inside the app. Maybe.
    -   Goals/goal tracking (beyond just envelope savings goals).
    -   Prize system for non-monetary currencies (e.g., 10 stars for candy, 100 for a show).
        -   Maybe a time-limited option to convert stars to monetary currency (e.g., this week 100 stars = $1).
    -   Use the envelope allowance system as a foundation for a full multi-currency, YNAB-style envelope budgeting system.
    -   Routine manager (e.g., passage of time-aware items to playback as part of a morning routine)

We'll see how far I get!

## Setting Things Up (For Fellow Tinkerers)

If you want to get this running yourself, here's a rough guide. It's not super polished, but it might work:

-   **What you'll need first:**

    -   Git
    -   Docker & Docker Compose
    -   Node.js (I use `pnpm`, so `corepack enable` is handy)

-   **1. Get instantdb Server Running:**

    -   Clone the `instantdb` repo: `git clone <instantdb_repo_url>` (you'll need to find this)
    -   `cd instant/server`
    -   You _might_ need to put dummy AWS values in `docker-compose-dev.yml`. See [this instantdb issue](https://github.com/instantdb/instant/issues/617). (e.g., `AWS_REGION=us-east-1`, `AWS_ACCESS_KEY_ID=dummy`, `AWS_SECRET_ACCESS_KEY=dummy`)
    -   Run `make docker-compose`.
    -   Check `http://localhost:8888`. You should see "Welcome to Instant's Backend!".

-   **2. Get instantdb Client Dev Environment Running:**

    -   In a new terminal: `cd instant/client`
    -   `corepack enable`
    -   `pnpm i`
    -   `make dev` (or `npm run dev` if you've run it before)
    -   Check `http://localhost:3000`. You should see the instantdb website.
    -   **Important:** Open browser dev tools (console) for `localhost:3000` and run: `localStorage.setItem('devBackend', true);`. This tells the client to use your local server. Refresh the page.

-   **3. Sign in to Your Local instantdb:**

    -   This isn't strictly needed to run the app, but good for dev.
    -   At `http://localhost:3000`, click login.
    -   Enter your email (it won't actually send an email, this just becomes your username).
    -   Look in the terminal where your `instant/server` is running. You should see `postmark/send-disabled` with a 6-digit code. Enter this code on the website.
    -   **If you can't find the code (e.g., after logging in before):**
        -   `docker ps` (find the name of your postgres container, like `server-postgres-1`).
        -   `docker exec -it server-postgres-1 /bin/bash`
        -   `psql -U instant -d instant`
        -   `SELECT * FROM instant_user_magic_codes ORDER BY created_at DESC LIMIT 5;` (find the latest code).
        -   Enter that code on the site.

-   **4. Push the schema and perms to the local instantdb:**

    -   Login to the local Instant CLI: `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest login`
        -   If the website comes up with the wrong port (e.g., your local instantdb client is running on localhost:3001 but it tries to load localhost:3001): just change the port in the url
        -   This will be easier if you already signed into your local instantdb client in the same browser (see step 3 above)
    -   Initialize an app. Either:
        -   Use the local instantdb client dashboard (http://localhost:3000/dash), which will onboard you to make a new app
            -   Then get the App ID from the web interface and replace what's in the .env file with your new App ID
        -   Or use instant-cli to initialize:
            -   First delete `.env`(maybe? I haven't actually tried this), then
            -   `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest init`
    -   At this point your .env file should have `NEXT_PUBLIC_INSTANT_APP_ID=xxxxxxx...` and `INSTANT_APP_ID=xxxxxxx...` which should both list your app's id
    -   Now you can push the schema: `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest push`

-   **5. Start the Family Organizer App Itself:**
    -   `cd family-organizer` (wherever you cloned this repo)
    -   `npm install` (or `pnpm i`, `yarn`, whatever you use)
    -   `npm run dev` (or your start script)
    -   Go to `http://localhost:3001` (or the port it says it's running on).

## Apple Calendar Sync Setup

The app now supports one-way Apple Calendar import via CalDAV. The Family Organizer server connects to Apple, pulls events into InstantDB, and keeps them updated on a schedule. Imported events are read-only inside the app.

### What this sync does right now

-   One-way sync from Apple Calendar into Family Organizer.
-   One Apple account per Family Organizer deployment.
-   Centralized server sync. No phone or browser has to stay open after setup.
-   Imported events appear in the normal calendar views.
-   Imported events are read-only and are marked as Apple-sourced in the UI.

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
-   Imported events are read-only in Family Organizer.
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

### 7. Verify that it is working

Good signs:

-   The Apple Calendar Sync settings card shows a connected account.
-   Selected calendars are listed.
-   `Last sync` updates after a run.
-   Apple events appear in the normal calendar views.
-   Imported events show Apple/read-only indicators.

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
-   **Events show up but cannot be edited:** that is expected for imported Apple events in v1.
-   **Apple password changed or revoked later:** reconnect from Settings with a fresh app-specific password.
-   **You imported the feature into a fresh Instant app and settings behave oddly:** double-check that schema and perms were pushed after pulling the latest code.

### 9. Current limitations

-   This is one-way sync only. Editing Family Organizer events does not write back to Apple Calendar.
-   The system currently supports one Apple account per Family Organizer deployment.
-   Imported events are not automatically assigned to specific family members.
-   A real-world smoke test against your own iCloud account is still a very good idea after setup, especially if you rely heavily on recurring events and timezone-heavy calendars.

## Developer's Corner (My Notes to Self)

### How I wrangle the `instant.schema.ts` file:

To get the schema file out of the local instantdb database and into the project:

1.  `cd` into the `family-organizer` project directory.
2.  Login to the local Instant CLI: `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest login`
3.  Pull the schema: `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest pull` This should create/update `instant.schema.ts` (and `instant.perms.ts`).
4.  After I modify `instant.schema.ts` how I want it, I push it back: `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest push`

**The Old Way (when `@latest` was being fussy or I didn't know to add it):** Sometimes `npx instant-cli` (without `@latest`) didn't want to login to the local backend directly. This was my workaround:

1. `cd` into the local `instant/client/packages/cli` directory (from my cloned instantdb repo).
2. `pnpm install` (probably done already if I ran the client web interface).
3. `pnpm dev` (to build/watch the CLI package).
4. Then, in a _new_ terminal, from that same `instant/client/packages/cli` directory:
    - Login: `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI=http://localhost:8888 node dist/index.js login` (this then used `localhost:3000` for the actual login browser part).
    - Pull: `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI=http://localhost:8888 node dist/index.js pull` (this walked me through getting the schema into `instant.schema.ts`).

---

Hope this makes the project a bit easier to understand!
