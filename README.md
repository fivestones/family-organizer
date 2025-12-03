# Thomas Family Organizer

Hey! This is the code for our family's organizer. I'm building this to help us (and maybe you, if you like this kind of thing!) manage our family life a bit more smoothly. It's a personal project, so I'm putting it on GitHub mainly to track my own changes and updates, but if you find it useful, feel free to tinker with it!

## What It Can Do (Key Features)

Here's a rundown of what the Thomas Family Organizer offers so far:

-   **Calendar:**

    -   Add, remove, and view calendar items easily.
    -   Includes a multi-month view for better planning.
    -   Supports both Gregorian and Bikram Samvat calendars, and you can choose to show either or both.
    -   Needs work:
        -   Planning to have other views, lazy loading with scrolling to other weeks/months/years, week view, full year view, better controls to turn on/off Gregorian and Bikram Samvat, maybe syncing with google or apple calendars.

-   **Chore Assignment and Tracking:**

    -   Clearly see all chores with avatars showing who is assigned.
    -   View chores due directly in the calendar.
    -   Assign chores to multiple people, with an option to have it automatically alternate between them.
    -   Set up auto-repeating chores with simple or complex recurrence patterns using rrule.
    -   The detailed create/edit chore form includes a working assignment preview.
    -   **"Up for Grabs" Chores:**
        -   Chores can be part of the normal allowance (required for 100% allowance) OR be "up for grabs" with a specific monetary amount or weight attached.
        -   Completed up-for-grabs chores will automatically deposit the specified amount/value into the family member's allowance. This applies to chores with either a direct amount or a weight (allowing for earning more than 100% of assigned chore weight).

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
    -   **Savings Goals:** Envelopes can have a designated savings goal amount.
    -   **Flexible Deposits:**
        -   Allows setting a default envelope for deposits. (The previous bug that sometimes created a new default envelope is fixed.)
    -   **Chore-Based Allowance Calculation:**
        -   Assign a numerical weight (any real number) to chores.
        -   Allowance payouts can be based on the total weighted value of chores marked "done" during a specific period.
        -   The system calculates the total weight of all assigned chores for the week and the total weight of completed chores to find a weighted completion percentage. (Bugs related to incorrect counting of all chores or issues with unchecking/rechecking have been resolved.)
        -   If a chore is unchecked after being marked done, it correctly no longer counts towards the allowance.
        -   View current stats for chores completed and the allowance due.
        -   Automatically (or with a click) deposit the calculated percentage of a family member's weekly allowance into their default envelope.

-   **Role-based User Access**

    -   Family members are users. Set PINs for each family members. Can set role (Parent or Child) for each user.
    -   Log in and log out, switch user
    -   Parents can do anything, children can only manage their own finances. Children can mark Chores or Tasks as done for someone else but the system keeps track of who marked it
    -   When not logged in, limited to viewing but can't make changes.

-   **Tech & Sync:**
    -   **Instant Sync:** Changes are reflected immediately across all connected clients.
    -   **Local-First Architecture:** Your data primarily lives on your device/server.
    -   **Offline Capable & Fast:** Designed to work even without an internet connection and be responsive. (Ok, this isn't done yet, but it shouldn't be too hard to make happen, given that it uses InstantDB which is designed for this kind of stuff.)
    -   Uses `instantdb.com` in the background for its powerful syncing capabilities.

## What I'm Tinkering With Now (Current To-Do & Bugs)

This is the stuff I'm actively working on or plan to tackle very soon:

-   **Allowance System Enhancements:**
    -   Set up sophisticated rules for deposits (e.g., first $2 into envelope A, then of the remainder: 20% into envelope B and 80% into envelope C).
    -   Make the last chosen display currency for totals stick for the next session (on a per-family-member basis).
    -   Automatically create a default "Savings" envelope when a new family member is added.
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
-   **User Experience & General Polish:**
    -   Figure out the best way to handle future periods that are simulated and then marked as done. Should deposits also be marked as simulated? Or maybe simplify/hide the simulated date option.
    -   Kid's passcode needed to activate transfers out; parent passcode needed to activate parent mode (full transfer/deposit rights).
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

    -   Individual calendars for multiple people.
    -   More views: Day, 3-4 day, weekly, agenda, and full year views.
    -   Custom metadata for events: circle or highlight events, mark an event as "major" (to show only major events on yearly/other views).
    -   Events assignable to a person or multiple people.
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

    -   Convert into a Progressive Web App (PWA) for full offline use on any device.
    -   Eventually, convert into React Native for a native iOS app (and maybe Android?).
    -   Two-way sync with Google Calendar, Apple Calendar, or CalDAV servers.
    -   Ensure the interface is touch-screen capable.

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
