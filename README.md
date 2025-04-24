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
* Allowance tracking, in multiple currencies
    * Each family member can have multiple envelopes
    * Can deposit funds
    * Can transfer funds between envelopes, withdraw money, delete envelopes, show totals
    * View a transaction history
* Offline capibile, fast
    * Uses instantdb.com in the background for syncing


## To do at the moment:
* ~Need a way to withdraw/spend money from your account~ - done
* ~Transfer to other person~ - done
* ~Show total current allowance~ - done
* ~Change default envelope~ - done
    * Set up rules for deposits (ordered list of amounts and percentages (e.g., first $2 in env A, then of the remainder [20% in env B and 80% in env C]))
* ~Show accurate currency symbol for rupees at least~ - done
* ~Show the total amount in one given currency, if you changed all your money to that currency today~ - done
    * ~This will only compute the total for the given currency for monetary curriencies (e.g., if you have $ and euros and stars, it can give you your total in $ and stars)~
    * Make the last chosen display currency come up next time first, per family member
* ~Envelopes can have a savings goal amount~ - done
* Make a default "Savings" envelope when adding a family member
* ~Show the current total allowance for each person in the familyMembersList next to their name~ - done
* ~Show a full transaction list~ - done
    * Show a graph next to the list; if there is a savings goal amount for envelopes this should be incorporated somehow. Maybe if it is a graph of just one envelope (or each envelope is shown in a different color, with the total amount in its own color)
    * Add a running total, per currency or as a combined total in a given currency
    * filter by envelope
* ~Add value to chores (each chore has a weight of any real number); then have an allowance; base the allowance payout amount on the weighted values of the chores which have been marked done during the given period~ - done
    * ~Need to calculate the total weight of all assigned chores for the week, and then the total weight of all chores completed for the week. Find the weighted percent completed.~ - done
        * bug: all chores are counted (J had 80% listed when all were checked off. Maybe from adding new chores, or from checking, then unchecking, then rechecking some chores?)
        * bug: if a chore is unchecked after having been checked off, it should no longer count toward allowance
    * ~Display current stats for chores complete and allowance due~ - done
    * ~Deposit that percent of that family member's weekly allowance in their default envelope.~ - done
        * Fix the bug where it makes a new default envelope
    * Chores can be part of the normal allowance (required to be able to get 100% of the allowance amount for you), or can be up for grabs with a given amount attached
        * If an up-for-grabs chore was completed, deposit the given amount in the family member's allowance too
        * Up for grabs chores should be able to have an amount or a weight (so you could get more than 100% of your assigned chores' weight if you do an up for grabs chore)
    * ~Set up a way to auto-deposit or click to deposit chore money~ - done
* Maybe: if working in stars or some other non-money currency, could have a list somewhere of prizes that could be gotten with certain numbers of stars (e.g., 10 stars for a small candy; 100 stars to watch a show, 50 stars to play a video game for 30 minutes);
    * Also maybe: value of stars in monetary currency, can be time limited (e.g., if you want to convert stars to $ you can do that this week at a rate of 100 stars = $1).
* Kid's passcode needed to activate transfers out; parent passcode needed to activate parent mode which lets you do any transfers and deposits.
* Integrate the familyMemberDetail page into the main page somewhere, or have it come up with a button click from a family member's chore list
* Future: Use the envelope allowance system to create a multi-currency envelope-based budgeting system ynab-style
* Convert into PWA so it can be used fully offline
* Future: convert into react native for iOS app
* Chores:
    * Let chores be assigned during a time period of the day (using timeOfDayDefinitions)
        * Maybe there should also be meal ones, which are like "Before Breakfast". You would have a way to say you are eating breakfast now, so it's over, and if it doesn't get marked, it's automatically marked as over at 11 am or something. "After dinner" starts automatically at 7:30 but if you mark dinner as happening it starts then. Etc.
* 


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
* Chores
    * A way to have home school subjects listed, with particular assignment items as to dos attached to particular days
        * Or just attached to a given school subject chore (but not on a given day), and marked as starting at some particular date (in which case it shows up with that school subject chore on that day or the next day that school subject chore is scheduled) OR marked as starting when some other to do is finished (e.g., the previous day's assignments for that school subject). Then if the assingment it is marked as coming after has been marked as finished, it can show up the next day it's school subject chore is scheduled.
        * Should be able to rely on multiple other to dos (this assignment has to be after this other assignment but before this one?)
        * Is there any need for nested to dos if you can have to dos that only start depending on other to dos being done? Maybe there still is, just to break down a to do into constituient parts.
        * If there are other to dos that will come up following the completion of a current chore, it should be possible to see the whole string of them (and maybe the string of those that have come before?)
        * It would be nice if Chores could change too the same way. Like a school subject chore gets marked as completely finished when all its to dos are finished, and another school subject chore that starts next (finished 7th grade english, start 8th grade if it's done and the date is at least Aug 1).
        * The assignments of a school subject are like a playlist
        * Need to be able to go on to the next assignment on the same day if desired, so you don't have to wait until tomorrow and can get ahead
            * There should be a field that lists if this is allowed or not, could be per school subject or per assignment
* Meal plan
    * Connections to mealie (or another self-hosted recipe app) for recipes and meal planning
* Family chores/rewards tracking
    * Set relative value of a chore for rewards/allowance calculations
    * ~Keep track of rewards/money accounts per person~ - done
* Dashboard view for keyboardless/mouseless usage
* Photo stream
* Extension-capible
    * Quote of the day
    * Current family Bible memory passage
    * Current family hymn/song of the week
    * Kid home school/homework tracker
        * With each item tagged for whether they can do it alone or only with a parent
        * See the comments on Chores above for more ideas
    * Etc
* iOS and web clients
* Two-way sync with Google calendar and apple calendar or cal dav servers
* Touch screen capable
* Connect to Immage photo server for photostream
* Maybe:
    * Messaging between family members
    * Goals/goal tracking
    * 


We'll see how far I get!



# Setup
Not fully tested, but might work:
* Clone this repo
* Clone the instantdb repo
* Set up the instantdb server
    * `cd instant/server`
    * May need to add AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in the docker-compose-dev.yml file for the server, just set dummy values
        * see https://github.com/instantdb/instant/issues/617
    * `make docker-compose`
    * Check that the instantdb server is running: at localhost:8888 you should see "Welcome to Instant's Backend!".
* Set up the instantdb client
    * In a new terminal window,
        * `cd instant/client`
        * `corepack enable`
        * `pnpm i`
        * `make dev`
    * If you are doing this after the first time, just do `npm run dev`
    * Check localhost:3000 in a browser, should see the instandb.com website.
    * In devtools, go to console. Enter `localStorage.setItem('devBackend', true);` so that the client (localhost:3000) connects to the local instantdb server (instead of the instantdb.com one).
* Sign in to instantdb
    * Maybe not strictly necessary to use this app, but good for dev purposes.
    * At localhost:3000, click login.
    * Enter your email address. It won't send an email, but the same email will be used for the username.
    * Look in the terminal window where the server was started, should see `postmark/send-disabled` somewhere, with the contents of the email, and a 6 digit code. Enter this.
        * If you have already logged in in the past and are trying to log in again, it won't show the code. To find it:
            * `docker ps` and find the name of the docker container that is running the postgres database
            * `docker exec -it server-postgres-1 /bin/bash` to get into the docker container
            * `psql -U instant -d instant` to get into the postgres database
            * `SELECT * FROM instant_user_magic_codes ORDER BY created_at DESC LIMIT 5;` and you should see the current date with a code
        * Enter the code in the website
* Start the family-organizer app
    * `cd family-organizer`
    * `npm dev run`
    * go to localhost:3001 or whichever port it was launched with.


### How I got the instant.schema.ts file from the database
to get the schema file out of the instantdb database, cd into the base directory of the react or next.js project. Then
`INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest login`
Then `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest pull` which will pull the data and create the instant.schema.ts file.
Then when you have the schema file modified how you want it to be,
`INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest push`

The old way, for when I didn't know to add `@latest`:
`npx instant-cli pull` should do it, but it wasn't working to login to the locally hosted instantdb backend. `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli login` and then `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli pull` should work, but the login only took me to https://instantdb.com/login. Maybe my version of instant-cli was out of date. I tried a bunch of ways, and finally what worked was to cd into the instant/client directory (from where I did git clone of the instantdb repo), then `pnpm install` (which probably isn't needed since I had done that to run the client web interface already), then cd packages/cli, then `pnpm dev`, then in a new browser, `cd instant/client/packages/cli` and then `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI=http://localhost:8888 node dist/index.js login` which brought me to the localhost:3000 client instance for login, then `INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI=http://localhost:8888 node dist/index.js pull` which walked me through using the instantdb to write a schema to instant.schema.ts (and perms to instant.perms.ts).