# Thomas Family Organizer

This is the code for our family's organizer


## Features implemented

* Calendar, most features working. Add or remove items. view calendar ok multi-month view
    * Optionally show either/both Gregorian and Bikram Samvat calendars
* Chore assignment and tracking
    * See all chores with avatars for which person/people are assigned
    * See chores due for calandar view
    * Set multiple assignees for a chore, and to have it optionally alternate between the assignees
    * Set auto repeats for chores with simple or complicated repeat patterns, using rrule rules
* Instant sync between clients
* Local-first architecture
* Beginnings of allowance tracking, in multiple currencies


## Features planned

* Calendar
    * For multiple people
    * Day, 3-4 day, weekly, agenda, monthly, multi-month, and full year views
    * Custom metadata (circle, highlight events. Make an event a major even (to show only major events on the yearly (or other) calendar). Events can be associated with a person or multiple people.)
    * Events can be all day, specific time, no particular time (shows not as all day, but also has no time given), or a time period (Early morning, Morning, Mid-day, Afternoon, Evening, Night, Middle of the night).
* To do list
    * Associate To dos with a particular person
    * Regular lists
    * *Maybe to dos are just a specific kind of chore, which only has one occurance?*
* Meal plan
    * Connections to mealie (or another self-hosted recipe app) for recipes and meal planning
* Family chores/rewards tracking
    * Set relative value of a chore for rewards/allowance calculations
    * Keep track of rewards/money accounts per person
* Dashboard view for keyboardless/mouseless usage
* Photo stream
* Extension-capible
    * Quote of the day
    * Current family Bible memory passage
    * Current family hymn/song of the week
    * Kid home school/homework tracker
        * With each item tagged for whether they can do it alone or only with a parent
    * Etc
* Offline capibile, fast
    * Uses instantdb.com in the background for synching
* iOS and web clients
* Two-way sync with Google calendar and apple calendar
* Touch screen capable
* Connect to Immage photo server for photostream


We'll see how far I get!



# Setup
Not tested, but might work:
* Clone this repo
* Clone the instantdb repo
* Set up the instantdb server
`cd instant/server`
`make docker-compose`
Check that the instantdb server is running: at localhost:8888 you should see "Welcome to Instant's Backend!".
* Set up the instantdb client
In a new terminal window,
```
cd instant/client
corepack enable
pnpm i
make dev
```
If you are doing this after the first time, just do `npm run dev`
Check localhost:3000 in a browser, should see the instandb.com website.
In devtools, go to console. Enter `localStorage.setItem('devBackend', true);` so that the client (localhost:3000) connects to the local instantdb server (instead of the instantdb.com one).
* Sign in to instantdb
Maybe not strictly necessary to use this app, but good for dev purposes.
At localhost:3000, click login.
Enter your email address. It won't send an email, but the same email will be used for the username.
Look in the terminal window where the server was started, should see `postmark/send-disabled` somewhere, with the contents of the email, and a 6 digit code. Enter this.
    If you have already logged in in the past and are trying to log in again, it won't show the code. To find it:
        `docker ps` and find the name of the docker container that is running the postgres database
        `docker exec -it server-postgres-1 /bin/bash` to get into the docker container
        `psql -U instant -d instant` to get into the postgres database
        `SELECT * FROM instant_user_magic_codes ORDER BY created_at DESC LIMIT 5;` and you should see the current date with a code
        Enter the code in the website
* Start the family-organizer app
`cd family-organizer`
`npm dev run`
go to localhost:3001 or whichever port it was launched with.
