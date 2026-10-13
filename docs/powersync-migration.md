# Moving from InstantDB to PowerSync

**Date:** 2026-10-12
**Status:** In progress. [Phase 2](#phase-2--one-slice-end-to-end), one slice of the app on PowerSync end to end, is built and tested on one machine against the real sync service: the server, sessions, sync, the data layer on a device, and a web client at `/sync`. It has not been on David's server or on a real device, and the phone is not started. [powersync-staging.md](powersync-staging.md) says how to put it on staging. The plan was revised after a review on 12 October 2026; the log says what changed then and since.
**Roadmap:** [Scope 7](../roadmap.md#scope-7--the-move-to-powersync).
**Measured against:** commit `a4aed13`. The counts below were taken from the code on that commit, not estimated.

---

## Implementation log

Record each completed phase here, newest first, in the prose style the audits use: what was built, what the work showed the plan had wrong, and what was left.

- **2026-10-13 — The calendar and what only the server keeps have their tables. The schema is whole, and the real export imports into it and verifies.**
  Four tables for the calendar — events, whom each is for, tags, and what is tagged — and six that never reach a device: the calendar import's accounts, calendars, per-event notes and log of runs, Shortcut tokens, and push devices.
  **An event's time is what it is.** An all-day event has two days, the second the day after its last, as iCalendar has it. A timed event has two instants. A row has one pair or the other, and the flag that said which is gone, as are the year, month and day Instant kept beside the start so that it could find an event by its day. The verification shows those three can be read back from the start, in the event's own time zone, for every one of the 248 events.
  **How an event repeats is held once.** The rule, the occurrences added and the occurrences taken out were three attributes, and then the same three again written out as lines, and the app read both in case they differed. They are a rule, without its `RRULE:` label, and two lists of text, an occurrence named as iCalendar names it. On the real export the two copies agree on every event; where they would not, the import keeps what either holds. A list of text is a new kind of column for the rules and the upload route, and it is handed to the database as JSON, because a hand-built list would break on a comma.
  **A changed occurrence points at its event.** It named the event either by id or by what the calendar it came from calls it, and the screens tried both. It is a foreign key, with which occurrence it replaces beside it, unique between them.
  **What the import knows about an event is kept off the event.** Every run, the import stamps each event it sees again with the time it saw it. On the event's own row that would send the event to every device every few minutes for nothing. The stamp, the etag and the hash are in a table of their own that is not published; the event keeps the six things a screen reads about where it came from. Through the real sync service, the import touching its notes sends a device nothing.
  One thing the data had wrong. 33 events and all 12 calendars held, where the name of a time zone belongs, a whole iCalendar description of one, several lines long. The name is taken out of it.
  The log of runs is 61,111 of Instant's 64,895 rows. **The last thirty days are carried, and from before that only the runs that failed or changed an event: 8,679 rows in, 52,432 left behind.** A run in which nothing happened says nothing once it is a month old. Pruning it as the app runs comes with the import's rewrite in [Phase 6](#phase-6--the-server-on-postgres).
  The rules are today's: parents write events, tags and whom an event is for, and kids read. The plan could have closed the columns that say where an event came from to devices; it has not, because a parent's device may write them today and closing them was not asked.
  **The whole export now imports.** 50 tables are loaded from 45 of the export's 51 entities, on the real Postgres 17 as well as the in-process one, and all 102 checks pass. The other six entities are left behind on purpose, and the import now says so by name and count instead of passing over them: Instant's own `$users`, the retired `choreManualStarts`, the lock table, and three that no code uses and that hold nothing. An entity it has never heard of is reported. Held back: the 46 completions and the 112 rows of deleted tasks, both for David to confirm. Nothing else is held back and no stored attribute is unaccounted for. With the real data in it, the sync service replicated every published table without an error; what a device then holds was not compared row by row with the real data, only with the fixtures.
  Left in [Phase 3](#phase-3--the-schema-and-the-data): Postgres and PowerSync in the production compose file with backups, and the reverse proxy, which is David's. `client_checkins` is not made yet; it belongs to the readiness build in [Phase 8](#phase-8--rehearsal-and-cutover).

- **2026-10-13 — Messages have their tables and their two streams, and a device is sent the threads its person is in and no others.**
  Six tables: threads, who is in each, messages, their files, reactions and acknowledgements.
  What changed shape. Three keys that stood in for uniqueness are gone: who is in a thread is keyed by the thread and the person, a reaction by its message, person and emoji, an acknowledgement by its message, person and kind. A thread's own key stays, because it is what makes a thread the one of its kind: the family's, the one between two people, the one about a chore. Three columns existed only to be searched or sorted on and are not carried: a thread's lower-cased title and its search text, which nothing ever read, and each member's copy of when the thread last had a message, which the list of threads can take from the thread. Pinned was a flag beside the time of pinning; a thread is pinned while it has that time. Each reference that Instant held twice, as an attribute and as a link, is one foreign key.
  **How far someone has read is held to a message of that thread.** Nothing checked that it was, and on the real export three members' places name a message of a different thread. No screen reads the value, only the time beside it, so the three are left empty and the time is kept. The message routes will have to pass a message of the thread, or the database refuses it; that goes with [Phase 6](#phase-6--the-server-on-postgres).
  The streams are the two the plan named. `messaging_member` sends a person the threads they are in, with the other members, the messages and what hangs off them; `messaging_parent` sends a parent everything. Membership is a subquery, two deep for a message's files, reactions and acknowledgements, and **the sync service takes them as written**. Nothing had to be copied onto a row for the sake of the query.
  No device writes any of it. The six tables are not among those a device may send, so a write to one is refused as malformed, a parent's included, which is what the Instant rules do today.
  On the real export: 14 threads with 44 memberships, 42 messages of which 4 are removed, 3 files, 3 reactions and 1 acknowledgement load and verify, with nothing held back.
  Through the real sync service: a kid is sent their own thread and nothing of a thread they are not in; a parent is sent every thread; the kid session a shared device rests on is sent none. Someone added to a thread is sent what was already said in it, with its files, and someone removed loses it from their device. A message a kid writes into their own device's table, under a parent's name, is refused and disappears.

- **2026-10-13 — What the family posts, the dashboards, and the files on a history entry have their tables.**
  Ten tables: announcements, the content queue and its categories, house rules and their versions, the files on any of those, the family dashboard's layouts and widgets, each person's own dashboard arrangement, and history attachments, which finishes history.
  What changed shape. Whether an announcement is showing was a flag kept beside the time it was taken down; it is showing while that time is empty. A rule named its current version by an id that nothing checked; it is a foreign key, held to a version of that rule. One table of files served three owners through three links; it has a column for each and a check that exactly one is set. A person's dashboard arrangement had an id of its own and a link to its person, one to one; the person is its key.
  **A rule and its first version each name the other**, so neither can be written first. The check between them is put off to the end of the transaction, and the upload route now makes every put-off check itself, after the last operation, so that a failure is a refusal like any other. Left to the commit it would have been an error, and the device would have retried it for ever. The import puts off the same checks while it loads.
  The rules are today's: parents write all of it, except that anyone signed in may arrange a personal dashboard and add a file to a history entry. A rule's version is added by a parent and never changed or removed; a history file likewise, by anyone.
  On the real export everything loads and nothing is held back: 1 announcement, 2 categories, 4 queue items, 4 rules in 6 versions, 3 files, 5 layouts with 75 widgets, and 5 history files. Nobody has arranged a personal dashboard.
  Through the real sync service, a parent's rule and its first version go up in one transaction and reach a kid's device, and a kid's arrangement goes up under the kid's own id.
  One thing to remember when reading JSON on a device: it arrives as Postgres writes it out, which is not byte for byte what was sent — `{"format": "24h"}` with a space. A document is compared after parsing, never as text.

- **2026-10-13 — Money has its tables, and the ledger adds up after the move as it did before.**
  Four tables: envelopes, what each holds, the ledger, and cached exchange rates; and one column on a member, their default envelope.
  What changed shape. An envelope's balances were one JSON value, a currency to an amount; they are a row for each envelope and currency. Which envelope is a member's default was a flag on every envelope; it is one column on the member, and the database holds it to an envelope of that member's own, so a kid who points theirs at a sibling's is refused by the database itself. A ledger row named who made it twice, as Instant's principal and as a family member; it keeps the family member. It is written once and never changed, so it has no time of last change. An exchange rate is keyed by its two currencies, where a string of the two joined stood in.
  What a delete does. Nothing the ledger points at can be deleted: not an envelope, and so not a balance from under one. A member who leaves the family leaves their envelopes and their ledger, with nobody's name on them, which is what happens today.
  The rules are the money rule David approved. A device may change what an envelope is called, its description and its goal — a parent on any, a kid on their own — and choose a default. It cannot create, archive or delete an envelope, and has no way at all to send a balance or a ledger row: those tables are not among the ones a device may write. The plan asked that a default also be an envelope that is not archived; that part is not enforced yet and goes with the finance routes in [Phase 6](#phase-6--the-server-on-postgres), which are what archive one.
  The plan had a second timestamp on a ledger row, assigned by the server, to order by. It is not needed: from cutover only the server writes a ledger row, so `created_at` is the server's.
  On the real export: 18 envelopes, 10 balances and 38 ledger rows load, and nothing is held back. Every amount is compared as the number it is, with no rounding. Each envelope's ledger adds up to the same total in every currency before and after, each envelope agrees with its ledger exactly where it did — which is everywhere — and each member holds the same in each currency.
  **(you)** Two things to know. Four envelopes belong to nobody: their members were deleted. They hold nothing, two ledger rows point at them, and they are carried as they are. And one member has four envelopes all marked as the default. The app uses whichever it is handed first; the import keeps the first as the export lists them, which may not be the one the app has been using. Look at that member's default after an import, on staging.
  Through the real sync service, a kid's device is sent its envelopes, balances and ledger, an amount with part of a cent arriving as it is. The kid renames an envelope and makes it their default, and both go up. A kid who writes a thousand dollars into their own balance on the device has it refused and put back.

- **2026-10-13 — Task series have their tables.**
  Eight of them, by the same list as before: grade scales, series, tasks, the files on a task, what a task asks for when it is handed in, updates, the files sent with an update, and the answers given.
  What changed shape. A task's state is one column. It used to be a workflow state with an older ticked-or-not flag behind it for rows that had none, and the app read one through the other; the import resolves that once and the flag is gone. A task belongs to exactly one series and goes when its series goes, which is what both editors already did by hand. A series' start and end are days. They were stored as the instant of midnight where the family lives, which in UTC is the evening before; the import takes the day whose midnight is nearest, so it comes out right in any time zone. The series manager today reads the UTC day from that instant, which for this family is a day early; the editor reads the local one. The column holds what the editor shows. At most one grade scale is the default, by a constraint. An answer is unique to its update and its field. A task's prerequisites were declared as a link, never stored and never read, and are not carried.
  The rules are today's. Parents write series, grade scales and response fields. Anyone signed in writes updates, answers and files, and changes a task. Joining a task to a series is the parent's, as the link rule has it today: a kid neither adds a task to a series nor moves one to another.
  On the real export: 2 series, 29 tasks, 97 updates, 13 response fields, 38 answers and 6 files load and verify, with 2 grade scales. **Held back: 112 rows that belonged to tasks deleted in March 2026** — 32 updates, 28 response fields, 44 answers, 7 task files and 1 file on an update. Instant kept them when their task went; the app can reach none of them. They are in the file beside the import's report, like the 46 completions, and **(you)** this is the same call as that one, to confirm or overrule. The eight files they name are still in object storage.
  Through the real sync service, a kid's device is sent a series whole, what the kid hands in — the state, the update, the answer and a file — goes up in one transaction and is stored, and a task the kid invents is refused and disappears from the device again.
  `scripts/migrate/rehearse.mjs` is new: it imports an export into a Postgres that lives only inside the process, verifies it, and throws it away. It needs nothing installed, so it is the quick way to find out whether an export will import, here and for anyone else moving their own data.
  One correction to this log. An earlier entry named some of the 46 held-back completions' chores by their titles. Those are the family's words and this repository is public; they were taken out of the entry and out of the commits that carried them before anything was pushed. Held-back rows are described here by count and kind, never by content.

- **2026-10-13 — The rest of the chore area has its tables: routines, their steps, the day's routine markers, and countdown runs.**
  The first step of [Phase 3](#phase-3--the-schema-and-the-data), taken by following the list the slice left for adding a table: a migration that also adds the table to the publication, its columns in the stream, its table in the device's schema, its rules, and its part of the mapping and the verification. Each of those is held to the others by a test, and they caught the one thing that was forgotten.
  A routine's steps were an entity of their own carrying a position; they are the join between a routine and its chores, with the position on it. A routine marker's status was keyed by a string of its day and its marker joined together, stored beside both; the day and the marker are the key. A countdown run keeps the id worked out from its person and day, with a constraint behind it that there is one run per person per day. Its list of skipped chores is an array of ids.
  A key made of two parts is now read part by part, each as its column's kind, so a marker's key must hold a real day. The rules gained a kind for a list of ids. A kid starts and drives their own run and nobody else's, as today; whose run it is and for which day cannot be changed by anyone.
  On the real export: 1 routine, 10 steps and 8 marker statuses load and verify, and there are no runs. Through the real sync service, a device is sent a routine's steps and a day's marker under their two-part keys, and a kid's run goes up and comes back with its list intact.
  One caution from doing it. The live test was once pointed at a stack that still held the real import, and its first failure printed real first names into a terminal. Nothing was written anywhere. The live tests now refuse to run against any family that is not their own fixture.

- **2026-10-13 — The slice has a web client, and it runs in three browsers against the real sync service.**
  `/sync` is the app on PowerSync as far as it is built: a day's chores, ticked and un-ticked, and the currency and countdown settings, with a person switcher, a sync badge and the list of changes that did not go through. Underneath is everything the entry below describes, with nothing stood in for.
  **How it sits beside the live app.** The root layout no longer hard-wires the InstantDB frame. A small shell picks the frame by page: every existing page gets the InstantDB frame as before, loaded on demand, and `/sync` brings its own. What the server sends for a live page is unchanged: the same "Connecting to family data" splash, rendered by the same provider. The data layer's InstantDB binding moved from `lib/data.ts`, where importing any hook opened a connection to InstantDB, into that frame. A deployment started with `DATA_BACKEND=powersync` sends every page to `/sync`, because its other pages still need InstantDB.
  This is narrower than the plan's "the server tells each client which backend to use". Which frame a page gets is decided by its address, not by a switch a running client obeys, and that is enough for a slice with one page. The switch, with its checks and its freeze, is still [the cutover protocol](#the-cutover-protocol)'s to build. `/api/client-config` and the `installation` row it reads exist, and `/sync` refuses to start unless they say PowerSync.
  **In the browser.** The database is kept in the browser's private file system where the browser allows it, in IndexedDB where it does not, and in memory as a last resort, which the app says plainly. The connection is a WebSocket. The page asks the browser to keep its storage. A browser missing what the client needs is told what is missing. A parent who stepped in on a shared device is signed out after fifteen idle minutes, as now.
  **`npm run test:sync:e2e`** builds the app and runs it in Chromium, Firefox and WebKit against a throwaway Postgres and the PowerSync service in Docker. A device with nobody signed in is sent the family and its chores. A kid ticks a chore: it shows at once, reaches the server, and is there in a second tab, and un-ticking it in the second tab un-ticks it in the first. A chore ticked with no network waits, counted in the badge, and is sent when the network returns. A parent steps in with a PIN, ticks for a kid, and is signed out back to the kid. The wrong PIN signs nobody in. All of them pass in all three.
  **Two faults it found**, neither of which any test without a browser could have. The sync address reached the client with a trailing slash, which the client refuses, so nothing synced anywhere. And the app waited for the sync connection before showing anything. Where a browser lets only one tab hold the connection, which is what WebKit did here, a second tab's turn never came and it sat at "Starting". The connection is no longer waited for: the second tab shows what the shared database holds, and what it writes goes up through the tab that is connected. This is the first time two tabs have been seen working in WebKit with both of them live; the spike's second tab was never connected.
  **A race, run for real.** The live test now sends two kids' claims for one chore at the same moment, twenty times over, on a real Postgres: one holds it every time and the other is refused. One transaction sent three times at once is applied once.
  **Staging.** `docker-compose.staging.yml` runs a second copy beside the live one, from the same image, and [powersync-staging.md](powersync-staging.md) is the walk-through for David's server. It says which steps have been tried and which have not; the reverse proxy's rule is one that has not.
  **The Docker image, and Node.** Building the image from a clean copy of the tree failed at first: Kysely needs Node 22 or later and the image was on Node 20, which reached the end of its life in April; and the tests' SQLite module had to be compiled, which the image has no tools for. The image now starts from Node 24, and the tests' local databases use Node's own SQLite, so nothing is compiled. With that, the staging guide's steps were run on this machine from the built image with the real export: the app made its tables as it started, the import ran inside the container, and all three browsers landed on `/sync` showing the family's chores within three seconds of a cold start. The live app's image changes Node version with this, which is worth a look after the next deploy.
  **Starting with no network.** The service worker now keeps what `/sync` needs: the page, the scripts it loaded, and the files of the database's worker, which are listed when the app is built. The page asks for all of it as soon as the worker is in charge, so one visit is enough. Opened at the app's home address with the network off, Chromium and Firefox are sent on to `/sync`, show the signed-in kid and the day's chores, take a tick, and send it when the network returns. The sync service's path and the server's routes are never answered from the cache.
  **What Playwright's WebKit still cannot say.** It cannot load any page while offline: it stops with an internal error before the service worker is asked, as it did in the spike, so that test is skipped on WebKit and says why. And it has no private file system in a throwaway profile, so everything WebKit did here was on IndexedDB; Safari on an iPad will normally use the file system. Both are for real devices.
  **Left in the slice.** The phone, which needs a native build with a new SQLite library and so a build installed by hand. David's own look, on his devices. And revising the later phases from all this.

- **2026-10-13 — Sessions, the write rules, the upload route and the device side of the data layer are built, and the whole path runs through the real sync service.**
  This is most of the slice below the screen. What it took, in the order it was built:
  **Strict null checks are on, for the whole repository.** The server code needs them. Kysely's types only work with them, and without them a result that is either a success or a failure cannot be told apart by its `ok`, which the existing code had been working around with casts. Turning them on raised 108 errors in 36 existing files. Every fix was to a type: an empty array or a `null` that is given a value later now says what it will hold, and a value the code already used as present is asserted to be. No behavior changed, and it is its own commit.
  **The server has a Postgres connection and sessions of its own.** `lib/server/db.ts` is the one connection, through Kysely, typed by `db/types.ts`; a contract test holds those hand-written types to the schema the migrations produce. With `DATABASE_URL` set the server applies pending migrations as it starts; without it nothing here runs. A session is a random token on the device and its hash in `auth_sessions`, and is active, draining or ended. It lasts 180 days from its last use; Instant's tokens never expired. `POST /api/auth/sessions` signs in the shared kid session or a member after their PIN, behind the existing rate limit, and PIN hashing moved out of the Instant module so that it no longer loads Instant.
  **The write rules are one module, and the upload route applies them.** `packages/data/src/policy` lists, per table, its key, the columns a device may send, and who may insert, change and delete. The route checks a transaction's shape against those lists before any statement exists, locks each row, and judges each write by the row as Postgres holds it. It answers a refusal with 200, records it, and writes it to `write_refusals`. Tests cover each rule for a parent, two kids and the shared kid session, and against a real Postgres: an upload that lies about being new, a delete followed by a re-creation, two claims for one chore, a retry after a lost answer with another device's write in between, and writes the database itself refuses.
  **Three things the building changed.** *What names an upload.* The record that makes a retry safe was keyed on the device database's id and PowerSync's number for the transaction. Emptying a database starts that numbering again, so a later transaction could have been answered from the record and never applied. A mutation now names its own transaction with a random id. *What happens to a database nobody is using.* It is emptied in place, not deleted as a file: with ids of their own, transactions no longer depend on the file, and browsers offer no clean way to delete one. *One rule is looser.* A completion that has been un-ticked can be taken by another kid for themselves. Under the Instant rules it could not, which left an up-for-grabs chore stuck with whoever had touched it first. This is a change in what a kid can do, small and in their favor, and David has not been asked about it yet.
  **History joined the slice.** Completing a chore writes a history entry in the same transaction, so the real mutation needed somewhere to put one. `history_events` and `history_event_members` are in the schema, the import and the verification: 2,477 events and 1,007 affected rows from the real export load and verify field by field.
  **The data layer on a device.** `packages/data/src/powersync` implements settings, units, the roster and the chore day over one person's local database. A read is typed SQL, built with Kysely and run by PowerSync inside one read transaction, so a read made of several queries sees one moment. A mutation is one local write transaction that asks the shared rules first, so a change that will be refused is refused on the spot. The chore day is the first area designed on PowerSync before Instant: over Instant it is not implemented, and the chore screens there still reach the database directly.
  **One database per person, built and tested.** `packages/data/src/session/manager.ts` does what [the plan describes](#one-database-per-person): a database per principal, the one the device rests on kept between visits, a signed-out person's unsent changes sent in the background as that person, and changes whose session has ended kept and shown until their person signs in again. What differs between the web, the phone and a test sits behind a small platform interface. Eighteen tests use real PowerSync databases and the app's real routes, and cut the device off from the server to make each case.
  **The whole path, with nothing stood in for.** `npm run test:sync:live` starts a throwaway Postgres and the PowerSync service in Docker and runs real devices against them through the real routes. A device is sent the family's data without the PIN hash; a PIN set on the server shows as set on the device; a completion crosses from one device to another; one made offline arrives when the device returns; of two kids claiming one chore offline, the second is told on their own device and nobody else's; and a parent's offline changes on a shared device go up as the parent after they are signed out. The token the app signs is accepted by the service, which until now only the spike's signing code had been.
  **Not built yet.** Nothing in a browser or on a phone: the web provider, storage chosen per browser, the sync badge, the list of refusals, the chore-day screen, and two tabs. No live test of two uploads racing for one row; PGlite cannot run two transactions at once, and the live stack can. The suite is 1,304 passing, and the live test passes on this machine.

- **2026-10-13 — Three answers from David.**
  **The default envelope stays a device write.** The revision had moved choosing it to the server, which would have made it need a connection. David wants it to work offline as it does now. It does, and more simply than before: the choice becomes one column on the member in place of a flag on every envelope, so there is no "exactly one default" for anyone to enforce. The money rule now takes nothing from a person at all; what is server-only is the ledger, balances, and creating and archiving envelopes.
  **The 46 completions with no chore are left out**, as proposed. They carry no chore at all, not even an id: the link was held on the chore's side and went with it. What each does carry is a due day, a time, and who. 44 are recorded against David and 2 against nobody; none is a child's, none had allowance awarded, and all were due between 25 February and 8 April 2026. 14 were ticked and then un-ticked. Of the 32 marked done, the history log names the chore for 15, by a history entry written for the same person and due day within two minutes, 9 of them in the same second. Every one of those chores has since been deleted, and their names read like chores made while the countdown was being tried out. The names themselves are the family's own and are not written here. The file they are kept in stays beside the import's report.
  **One address, not two.** The plan asked for a hostname for the PowerSync service. Budgeter, David's other app, serves PowerSync from a path on the app's own address, and that is better here too: no second hostname or certificate, and no cross-origin rules. The service is reached at `/powersync/`. Only staging needs a new hostname, for the app itself.

- **2026-10-12 — Postgres and PowerSync run from the repository's own compose file, and a device was sent the real data through them.**
  `docker-compose.yml` gains two services behind a profile, so `docker compose up` does what it did and `docker compose --profile powersync up` adds Postgres 17 and the PowerSync service. Postgres is on a network private to the project, where only PowerSync and, later, the app can reach it; the compose file's own network is the reverse proxy's, shared with whatever else is on it. Neither service has a fixed container name, so a second copy of the project can run beside the first for staging. Postgres runs with logical replication and with the cap on what a stalled replication slot may hold back.
  `db/init/10-powersync.sh` runs once, when Postgres first starts: it makes PowerSync's own database and the one role PowerSync uses, which can replicate and read and change nothing. A second migration creates the `powersync` publication, so what is published lives with the schema and a later migration that adds a synced table adds it there. `powersync/service.yaml` and `powersync/sync-config.yaml` are the service's configuration and the `family` stream for the six tables, every column named. `scripts/powersync/setup-env.mjs` prints the secrets a deployment needs — two database passwords and the signing key in its two halves — and writes nothing.
  **Run locally, on the real export.** The service started before any table existed, logged once that the publication was missing, and began replicating by itself when the migrations had run. A scripted device, given a token signed with the generated key, held all 484 rows 170 ms after connecting. The PIN hash was not among what it received.
  **A generated column does not follow a change.** This is the finding that mattered. `has_pin` was a generated column, as the plan said and as the first spike pass reported working. It arrived correctly with the first sync. When a PIN was then set in Postgres the device never heard, and the row it held went to `has_pin` unknown: Postgres leaves generated columns out of what it sends a replica when a row changes, so only the first copy carries them. The spike had looked at the first copy and no further. `has_pin` is now an ordinary column that a trigger keeps true to the hash on every insert and update; the same change then reached the device in 27 ms, both ways. No generated column may be synced, and the schema rules now say so.
  **The two types not seen before.** A `time` reaches a device as `HH:MM:SS.mmm`, so the data layer trims it to the `HH:MM` the app uses. An array of days reaches it as a JSON array of `YYYY-MM-DD`, which SQLite's `json_each` reads. Both stay.
  **A test holds the two halves together.** `test/contracts/sync-config.contract.node.test.ts` runs every query in the sync configuration against the migrated schema, requires each to name its columns and yield an `id`, refuses any that mentions the PIN hash, and requires the tables the streams read to be exactly the tables published.
  Not done here: the app container does not yet apply migrations on start or connect to Postgres; that comes with sessions, next. Nothing has run on David's server, and the reverse proxy's part is his. The suite is 1,143 passing.

- **2026-10-12 — The slice's first tables exist, and the family's real data loads into them and verifies.**
  `db/migrations/0001_family_and_chores.sql` creates six tables: settings, unit definitions, family members, chores, who each chore is assigned to, and completions. `db/migrate.mjs` applies migrations in order, each once, each in a transaction with the row that records it, under an advisory lock. `scripts/migrate/mapping.mjs` says how each Instant entity becomes rows, `import.mjs` loads them in one transaction, and `verify.mjs` checks the result against the export.
  **What the design changed, table by table.** A setting's name is its key. A chore's start is a day, and so is a member's allowance start; both were stored as the instant that day begins in UTC. A chore's excluded days are an array of days. A member's PIN hash stays on the server beside `has_pin`, which is what devices are sent.
  *When in the day a chore is due* was held three ways at once: a mode, a bucket, and a configuration object, under several generations of names, which the app resolved on every read. It is resolved once, at import, into a mode and the few columns that mode uses, with checks that a column belonging to another mode is empty. A chore due after another chore refers to it by a real foreign key.
  *Who a chore is assigned to* was one link, and the order of its rotation a separate entity. On the live data every rotation is exactly its chore's assignees, in an order, so they are one table with a position.
  *A completion* had a `completed` flag beside the time it was completed. Not one of the 357 has the flag without the time or the time without the flag, so the flag is gone: a completion is done when it has a time, marked not done when it says so, and otherwise cleared, and a check keeps the first two apart. One completion per chore, person and day is a constraint; the data already obeys it.
  Nine chore attributes the schema declared were never stored and are not carried, nor is `chores.done`, which is written false at creation and never read.
  **The import on the real export.** 5 settings, 1 unit, 10 members, 40 chores, 117 assignments and 311 completions loaded. The 46 completions with no chore were held back to a file with the reason, as proposed below, and nothing else was. The only conversion that changed how a value is held was the theme's bare word becoming JSON. Nothing stored went unmapped: the mapping reports any attribute it was never told about, so one added later cannot be lost by oversight.
  **The verification shares no code with the mapping.** It works out what to expect from the export's raw files: every row field by field, who is assigned to each chore and in what rotation order, each completion's chore and person, and how many chores each person has done. For timing it asks the app's own resolver in `shared-core` whether it reads the same rule from the new columns as from the old attributes; for all 40 chores it does. All fourteen checks passed on the real data. Nine tests alter a good import, one way each, and assert that the matching check fails, since a check that cannot fail shows nothing.
  **Two types in the data layer changed to match.** A member's `allowanceStartDate` is now a day and `allowancePayoutDelayDays` a number that is zero when unset. No converted screen reads either yet.
  **Not yet seen on a device.** The schema uses two Postgres types the spike did not sync: `time`, for times of day, and an array of days. PowerSync documents both as reaching a device as text; that is to be seen when the stream is built, and either is easy to change before anything depends on it.
  Tests: 23 for the migration, import and verification, against PGlite, on invented data. The suite is 1,132 passing. The import ran against a throwaway database in the spike's local Postgres, which was dropped afterwards. `pg` is a new dependency and `@electric-sql/pglite` a new development one.

- **2026-10-12 — The plan revised after a review: a database for each person, every upload recorded once, money written only by the server, and one slice built end to end before more screens move.**
  David had a second reviewer read this plan, the spike and the first data-layer code. It found three faults in the settings adapter, and a number of statements here that were inferences written as fact. The adapter was fixed the same day, with a test reproducing each fault: it now knows when a setting is absent as well as where it is, follows what live reads show, runs one name's saves in order, and saves an unset setting while offline. Each of the statements was put to an experiment on the spike before this revision was written. The scripts are `spike/service/client/spike-review.mjs`, `spike/service/client/upload.mjs` and `spike/web/review.mjs` on the spike branch.
  **A database for each person works, and removes the problem instead of managing it.** A kid's own database filled in about a tenth of a second on Node. It held no parent-only row, only that kid's thread, and nothing of a write the parent had not yet sent. The kid's write uploaded as the kid. The parent's database, reopened in the background, uploaded the parent's write as the parent and was then deleted. In a browser, two tabs signed in as two different people, each with its own database, stayed apart in all three engines: the kid's tab saw one thread and no parent-only rows, the parent's saw both threads, and a write a kid may not make was refused from the kid's tab and accepted from the parent's.
  **Tabs on one database share it without the server.** A write in one tab appeared in the other with the network off, in Chromium, Firefox and WebKit, on both storage modes. The first pass had only shown two tabs agreeing while online, which the server alone would explain.
  **The first fill is quick.** About 3,800 rows, which is everything a device would hold, took 150–220 ms on Node. In a browser on the private file system it took 230 ms in Chromium, 260 in WebKit and 725 in Firefox; on IndexedDB, 456, 1,962 and 511.
  **Judging an upload by what the device calls it is a hole.** The first pass's upload route checked a `PUT` as a new row and applied it as insert-or-update, so a kid could overwrite another kid's completion by sending its id as though it were new. Rewritten to lock the row, look at what Postgres holds and judge an existing row as an update, the route refused that write, and refused a delete followed by a re-creation, and the device put its copy back within a quarter of a second.
  **Two kids claiming the same chore offline.** Both built the same id. The first upload was accepted. The second was refused as a change to someone else's completion, and that device showed the first kid's claim 173 ms later.
  **A retry after a lost answer undoes newer work, unless uploads are recorded.** A kid's write committed and its answer was dropped; a parent then corrected the row; the device retried. With nothing recorded, the retry replaced the parent's correction. With each transaction recorded under the device database's id and the transaction's number, in the same Postgres transaction as its writes, the retry was answered from the record and the correction stood.
  **Starting with no network is unproven on WebKit.** The first pass reported it working. Its test could pass on the page left over from before the network was cut. Rerun with a browser process started offline, Chromium and Firefox start. Playwright's WebKit fails to load the page at all, with the app's present service worker and with one that also caches PowerSync's files. Whether Safari itself does better is a question for a real iPad.
  **What the earlier entries overstate.** The in-memory storage mode does not keep data across a restart, and was never going to. Playwright's current engines say nothing about the oldest browsers the app supports, which remain untried. A one-page app with this app's build settings is not this app with its sign-in, its service worker, its Docker image and its reverse proxy. The query comparison ran on generated data, counted rows without comparing fields, and set one shape of single statement against one set of indexes; it supports flat queries as a starting point and nothing wider. The WebSocket finding comes from Playwright's WebKit on one machine and stays provisional until Safari has been tried through the real proxy. And "switching principal works without clearing the device" described a design this revision drops.
  **What changes in the plan.** [One database per person](#one-database-per-person) replaces the split between an interface session and a sync session. [The upload route](#writes-the-upload-endpoint) judges a write by the server's state under a lock, accepts only listed tables and columns, and records every transaction once; "every operation is idempotent" is gone. [Refusals](#refusals) are kept where the person can see them, not only shown in a toast. [Money is written only by the server](#money-is-written-only-by-the-server), which David approved; it touches four places that write money from a device today, not the one first reported to him. [The cutover](#the-cutover-protocol) gains a protocol for clients that are stale, offline or holding unsent writes, and a client learns its backend from the server when it starts, not from a value compiled into the build. And the seam between the two implementations is now said to go at cleanup, with the Instant code.
  Corrections of fact: where shared workers are off, one tab syncs at a time, not each for itself. A phone starts from cached configuration, so relaunching it does not change its backend. The two permission contract suites pin the text of the rules and do not test their behavior. `numeric` was never ruled out by how it syncs. What a delete does is chosen relationship by relationship. An advisory lock for calendar sync needs a connection of its own. Backups must leave the machine, and a stalled PowerSync must not be able to fill Postgres's disk. Self-hosting Instant is a project, not a setting.
  **The order changes too.** Converting screens is paused after the first area. Next is [one slice end to end](#phase-2--one-slice-end-to-end): settings, units, the family roster, the chore day and completing a chore, on PowerSync, on staging, on the exported data, with real sessions, the real upload route and the real rules. The data layer's API has so far been designed against one backend. The slice is where it meets the other, before a hundred more files are shaped by it. The slice is now Phase 2, so the phases after it are renumbered: what the entries below call Phases 2 to 8 are now Phases 3 to 9.
  **Two things a person will notice from the money rule.** Choosing which envelope is the default will need a connection, as every other money operation does. And a balance that disagrees with its ledger is put right by the server when a parent opens the page, not by the parent's device.
  **The census is finished.** The ten references the schema holds twice, as a link and as an attribute, were all compared, reading each link from whichever side the export keeps it on. Every one agrees: 143 rows carry both and name the same row, none disagrees, and none has only one of the two. Two of the ten have no rows at all. So each becomes one foreign-key column with nothing to reconcile.
  **One thing the slice's tables turned up.** 46 of the 357 chore completions belong to no chore, and two of those to no person either. All were due this year, 32 are marked done, and none has had allowance awarded; nothing can show them on a chore day, since a day is read chore by chore. They look like what was left when chores were deleted. A completion's chore will be a required column, so these cannot be loaded as they are. The proposal, for David to confirm: they are not carried into the new table, and are kept as a file beside the import, counted in its report. Every assignment has its chore and its person, every chore has someone assigned, and no chore, person and day has two completions.
  **Left.** None of this revision is built; it is a plan. Every **(you)** check stands, and a real iPad starting with no network is now the most important of them.

- **2026-10-12 — The first export and census of the live data.**
  `scripts/migrate/export.mjs` reads every entity through the Admin SDK and writes it under `.migration/exports/`, which git and Docker both ignore. It can only read: the SDK is wrapped so nothing in the file can reach a write. `scripts/migrate/census.mjs` then reports what the data holds against what the schema declares, printing counts and attribute names and never a stored value, so what follows is safe to keep here.
  **The data is small, and one table is nearly all of it.** 64,895 rows, 27 MB as JSON. Of those, 61,111 rows and 24 MB are `calendarSyncRuns`, the server's log of calendar sync attempts, which no device reads. Everything a device would hold is about 3,800 rows and 3 MB. So history, messages and task updates sync in full and the windowed stream is not needed; and the sync-run log wants a retention rule, with only recent runs carried over.
  **It is clean.** Every id is a UUID. No link points at a missing row. No unique attribute repeats a value, no setting name is stored twice, and every unit definition says whether it is money. The only attributes stored but not declared are the two already known, `calendarSyncCalendars.ctag` and `syncToken`. Eight entities hold no rows at all: `calculatedAllowancePeriods`, `calendarSyncLocks`, `countdownRuns`, `dashboardConfigs`, `deviceSessions`, `exchangeRates`, `pushDevices`, `timeOfDayDefinitions`.
  **What the schema has to handle.** Instants are almost everywhere ISO strings with milliseconds and a Z, which is the form a `timestamptz` reaches a device in. Four entities store epoch milliseconds instead (task updates, response fields and their values, grade types), and `taskSeries.plannedEndDate` holds epoch numbers beside siblings that hold ISO strings. A calendar item's start and end hold a day for an all-day event and an instant for a timed one, in the same attribute, so the schema must say which. A few timestamps use an empty string for "none". Explicit nulls are stored widely, so the app's types must allow them. Half the ledger amounts are fractional, which confirms doubles.
  One check is incomplete. The export holds each link on the side that owns it, so the comparison of a link with the plain attribute that duplicates it covered one of the ten pairs (it agreed, 5 of 5). The other nine need the lookup from the far side.
  **Instant's own backups use the same layout.** Instant backs every cloud app up nightly and keeps seven days; `npx instant-cli@latest backup download --latest` fetches one as a zip of one NDJSON file per entity, with its schema, rules and row counts ([backups](https://www.instantdb.com/docs/backups)). The export writes that same layout, so the importer will read either, and other people running the app can migrate from a backup alone. Downloading needs the CLI signed in to the Instant account, which it is not on this machine.
  **The Docker build.** Built from a clean copy of the committed tree, the production image builds and its health route answers. Two things came out of doing it. On this machine a build hung for hours at its first step because Docker's credential helper did not answer; pulling the public base image anonymously got past it. And the repository had no `.dockerignore`, so a build sends everything in the folder to Docker; a minimal one now keeps exports and agent worktrees out. Next copies `.env` into its standalone output, so a build made where a `.env` is present bakes those secrets into the image; that is left as its own task.
  **Known errors in this document, found in review the same day.** They are listed, and corrected, in the entry above.

- **2026-10-12 — Phase 1 begun: the data layer exists, and settings are the first thing on it.**
  `packages/data` is a third workspace package beside `shared-core`, wired into the TypeScript paths, the Docker install and the phone's bundle. It has one seam, `backend.ts`, through which an implementation is bound once at startup: `lib/data.ts` does it for the web and `mobile/src/lib/instant-db.js` for the phone, and screens import from `lib/data`. Its Instant implementation lives apart in `src/instant/` and is the only part that knows Instant exists. The package's own README states the rules.
  Settings came first because they are the smallest area and touch the most screens. A household setting is now read with `useSetting('householdSchedule')` and written with `saveSetting` or `clearSetting`, typed by its key; there are five. Each is defined once, as the name it is stored under and how its stored JSON becomes a value with a default, and that definition knows nothing about any database. What an implementation must supply is four functions. Thirteen files moved onto it — on the web the three settings panels, the family photo, the dashboard theme, the chore tracker, the countdown runner and two dashboard widgets; on the phone the chore list, the routine markers, the countdown runner and the settings list — and none of them names the `settings` entity any more. The one reader left is the server's shortcut service, which belongs to Phase 5.
  What the work showed. The dashboard theme is stored as the bare word `dark`, not as JSON like the other four, so the Instant implementation reads both forms and still writes the bare word; the mapping in Phase 2 must turn it into JSON. A setting is found by its name but keyed by a random id, and nothing stops two rows sharing a name: the currency panel used to create its row whenever it was opened and found none, so two devices opening Settings for the first time would each have made one. In the new schema the name is the key. The panel no longer writes on opening, since USD is the default until the family chooses otherwise. Reads on the phone are held back until someone is signed in, so every read takes an `enabled` option. And a save needs the row's id, which the implementation remembers from what screens have read, so saving costs no round trip and still works offline as it did.
  **The ratchet.** `test/contracts/instant-boundary.contract.node.test.ts` keeps a list of every file that still reaches InstantDB directly: 119 today. No file may join it, and a converted file must leave it. This is the rule the plan called a lint rule, enforced from the first area instead of the last.
  Tests: a small in-memory stand-in for an Instant client, `test/utils/fake-instant.ts`, and twelve tests of the settings area against it. The suite is 1,089 passing, with the typecheck, the phone's lint, an iOS bundle and a production build. On this machine's default Node 25 every test that uses a browser environment failed, new and old alike: Node 25 has a `localStorage` of its own, an empty object when no file backs it, and it shadowed jsdom's. That was fixed the same day in `test/setup/vitest.setup.ts`, and the suite passes on Node 24 and 25.
  Two small changes in behavior, both deliberate: the currency panel no longer stores anything until a currency is toggled, and the phone's raw settings list shows each value as parsed rather than as the stored string.
  **Unit definitions followed the same day.** `useUnitDefinitions()` and `defineUnit(...)` replaced the `unitDefinitions` entity in eleven read sites and both places a unit is created, on the web and the phone. A unit's type says what the schema will: a code, a name, a symbol and whether it is money are always present, and placement, spacing and decimal places are `null` when left to the formatter. One old-data rule moved into the Instant implementation so it is applied once instead of in six components: a row that never said whether it is money is treated as the formatters treat an undefined unit, where a three-letter code is a currency. The allowance-distribution page was among the eleven; its calculation destructured the units and never used them, so only its display changed source. The currency selector and the unit form no longer take a database as a prop. The list of files still reaching Instant directly is down to 117, and the suite is 1,095 passing.
  **The family roster has its type and its read.** `FamilyMember` is one definition of a person, where the components have eight private ones between them. It names the member's place in the family `sortOrder`, because `order` is not a name a SQL column should have, and it carries `hasPin` instead of the PIN's hash, which no screen is handed any more. `useFamilyMembers()` returns everyone in the family's order and `useFamilyMember(id)` one of them. Seven screens read through it so far: the dashboard, the message screen, transaction history, and four dashboard widgets. One limit belongs to Instant and goes away with it: Instant hides the hash from everyone but a parent and the member themselves, so on this implementation a kid's device reads `hasPin` as false for other people; sign-in already asks the server instead. The suite is 1,101 passing.
  **Left in this area:** the other screens that read the roster — about twenty read it plain, and more read it with each member's envelopes, which waits for finance; the signed-in member in `AuthProvider`, which moves with the session module; and creating, editing, reordering and removing members in `FamilyMembersList`. Nothing here has been seen in a browser or on a device.

- **2026-10-12 — Spike, second pass: reads are flat queries assembled in memory, written with Kysely; the test tooling is chosen.**
  **S5, the query layer.** The day's chores — 80 chores, each with its assignees and that day's completions, out of 43,800 completions, which is two years for a family of eight — was written six ways: in plain SQL, Kysely and Drizzle, each as flat queries assembled in memory and as one statement that joins and aggregates. All six returned the same result. The library made no measurable difference; the shape made all of it. On the Node SDK the flat form took 0.3–0.7 ms and the single statement 23 ms. In a browser, on PowerSync's WebAssembly SQLite, flat took 1–7 ms in every engine and storage mode, and the single statement 28–57 ms, with one outlier of 244 ms in Firefox on the private file system. Dropping the index on the day column took the flat read from 0.3 ms to 13 ms. A local write took 0.2 ms on Node and 2–11 ms in a browser, and all three libraries queued the identical upload.
  So the data layer's reads are **flat, indexed queries, assembled by pure functions**, and the choice of library is about maintenance. Kysely stays: it takes its types from PowerSync's own client schema, so the device has one schema definition, and the same builder is used on the server. Drizzle's advantage is its relational query, which is the slow shape; without it, it would add a second schema definition for nothing.
  One number for the browser choice: in WebKit the private file system was faster than IndexedDB at everything — 3 ms against 7 for the read, 2 against 11 for a write — which supports making it the default there.
  This was run on generated data sized generously, not on an export of the family's data as the plan said, because the export belongs to Phase 2 and nothing here depended on the real values. It has not been timed on a phone.
  **S8, test tooling.** On the device side, PowerSync's Node SDK opened without ever connecting is a complete test database: open, write, read back the upload queue and close took about 80 ms, and the queue shows exactly what a mutation would upload — a transaction's writes grouped together, a `PATCH` carrying only what changed. On the server side, PGlite behind its socket server is reached with the ordinary `pg` driver and Kysely, starts in 0.7 s, and handled everything the schema uses: a generated column, a `CHECK`, a composite key, a deferred foreign key, `FOR UPDATE`, an advisory lock, an upsert. It is a single connection, so two transactions racing for one row cannot be tested in it; those suites, and the end-to-end tests, run against the real Postgres in a compose profile.

- **2026-10-12 — Spike, first pass: the service, the sync rules and all three browser engines behave. Four things in the plan change.**
  What was run. PowerSync service 1.26.1 against Postgres 17, with its own storage in a second database on the same server. Scripted clients on the Node SDK playing a kid's device, a parent's device and a shared device. A minimal Next 16.4 app with this app's build settings — standalone output, Turbopack — and web SDK 2.4.2, driven by Playwright in Chromium, Firefox 146 and WebKit 26, each in a throwaway and a persistent profile, with each storage mode, against both the dev server and the standalone production build. The code is on branch `spike/powersync`, under `spike/`. Everything ran on one machine, so every latency below is without a network; Playwright's WebKit is not Safari on an iPad; and the web app was a minimal page, not this app.
  **S3, the service: as planned.** One Postgres for both databases works. A token signed with our own RSA key, its public half given to the service inline, is accepted. `auth.parameter('type')` and `auth.parameter('family_member_id')` filter as intended: a kid's device received no parent-only rows and only its own thread; a parent's received everything. Membership through `INNER JOIN` works, and so does a join table with a composite key whose `id` the stream builds as `chore_id || '.' || family_member_id` — in both directions. A generated `has_pin` column syncs and the hash beside it does not. On the device a boolean is 0 or 1, a `date` is `2026-10-01`, `jsonb` is text that `json_extract` reads, and a `timestamptz` is `2026-03-04T05:06:07.000Z` once the configuration sets `timestamp_max_precision: milliseconds`. Without that setting it carries six fractional digits, which is not what `toISOString()` produces.
  **S4, latency: the default upload throttle is the whole delay.** A local write takes 1–3 ms. With defaults, another device saw it after a median of 870 ms, almost all of it the SDK's one-second upload throttle. With `crudUploadThrottleMs: 50` the median was 43 ms. A change made directly in Postgres reached a device in about 30 ms. Five writes queued offline reached the other device 71 ms after the Node client reconnected; in a browser the same took four to five seconds, which is the SDK's wait before it retries a dropped connection.
  **S7, refusal: as planned.** A `PATCH` carries exactly the changed columns, which the kid-safe rules depend on. A write the server refused, answered as success, showed locally at once and reverted 74 ms later; Postgres never changed. A table option, `trackMetadata`, lets a write carry a label through to the upload, which is a way to record which principal made it.
  **S6, switching principal: the plan's rule was not enough.** Changing the token without clearing the database works — a kid's thread was replaced by another kid's in 35 ms and nothing else was re-downloaded. But a device that switched as soon as its upload queue was empty **stopped applying downloads entirely**: it was still waiting for confirmation of its last upload, which the service issues per user, and under the new user it never came. Parent-only rows stayed and later server changes did not arrive, until the device made another upload. Waiting until a sync had completed after the last upload, then switching, worked every time (about 40 ms). Clearing the device and syncing again as the new principal also works.
  **S1, the web SDK: works in all three engines, with two findings for Safari.** Under Turbopack in development and in the standalone production build, every storage mode opened, synced, wrote through to Postgres, shared its database with a second tab, queued a write offline and uploaded it on return, and kept its data across a reload and a full browser restart — in Chromium, Firefox and WebKit. Starting the app with no network worked in all three, even with today's service worker unchanged. The two findings: in a throwaway WebKit profile, which is the nearest thing to a private window, the browser's private file system is unusable and that storage mode fails to open, so the fallback to IndexedDB is needed and works. And over HTTP streaming, WebKit's first sync took **twenty seconds** — the stream's first bytes were held until the service's next keep-alive — while later changes arrived in about 10 ms. Over WebSocket WebKit's first sync took 50–100 ms, the same as the others. On an iPad every return to the app is a reconnection, so this would have been felt constantly.
  Two smaller things. The web SDK's README shows constructor options that no longer exist; the working form is a plain `database: { dbFilename, vfs, worker }`. And React's development double-run of effects opened the database twice, so it must be opened once at module level.
  **What changes in the plan.** The web client connects by WebSocket. A device may change its syncing session only once it has caught up, not merely emptied its queue. The sync configuration sets millisecond timestamps. The upload throttle is lowered. Each is written into its section below.
  **Not done in this pass.** S2, the phone, which needs a build installed. S5 and S8, which the entry above covers. And every **(you)** check: the real iPad and iPhone, whether Safari itself shows the twenty-second delay, and the eight-day storage test.

- **2026-10-12 — Plan revised before any work began: no compatibility layer.**
  The first version of this plan kept the app's Instant-shaped queries and `transact` calls and put a compatibility layer underneath them, on the grounds that it made the job much smaller. David rejected that: the finished app is to read as though it had been written for PowerSync from the start, with nothing left in an Instant shape because it used to be Instant's. The plan now rebuilds the data access natively — a relational schema designed as one, SQL reads, SQL writes, the server on database transactions — and the only adapter code ever written faces Instant and is deleted at the end.
  The same revision removed the plan's references to a wall tablet. There is not one; the claim came from other documents.

---

## Why, and by when

Instant's team has joined OpenAI and Instant Cloud is closing. New signups are shut, **cloud apps stop on 31 August 2027**, and backups stay downloadable until 31 August 2028 ([announcement](https://www.instantdb.com/essays/instant_team_joins_openai)). `.env` points at the family's live Instant Cloud app, so the deadline applies to this deployment.

The replacement is self-hosted **PowerSync** in front of ordinary **Postgres**. Postgres becomes the database; each device keeps a local SQLite copy; PowerSync streams Postgres changes down to devices, and devices send their writes up through an endpoint in this app.

**The fallback, and the date it triggers.** Instant can be self-hosted, both clients already accept a custom API and WebSocket address, and Instant publishes a [migration guide](https://www.instantdb.com/docs/self-hosting/migrate). It is a small project of its own, not a setting: Instant's server and its database have to be deployed and backed up, a backup of the cloud app restored into them, new credentials issued, every phone's configuration changed, and the whole thing tried before it is relied on. If the cutover rehearsal ([Phase 8](#phase-8--rehearsal-and-cutover)) has not passed by **31 May 2027**, that project starts then. Three months is room enough for it, so the August deadline cannot be missed, and this plan is then finished without the deadline hanging over the work. The rehearsal itself runs against a self-hosted Instant, so most of the fallback will already have been done once.

## Decisions

Settled with David on 11–12 October 2026.

1. **PowerSync, self-hosted, with Postgres.** The server component is the PowerSync Open Edition; the client libraries are Apache-2.0.
2. **Ahead of the unfinished product work.** Scope 7 comes before Scopes 4–6.
3. **Other people run this app.** The repository has forks, so the export and import are a documented, supported script. Both backends are not supported long-term: after cutover Instant is removed.
4. **Offline scope stays as it is.** Money mutations, sending messages and parent PIN elevation stay online-only. Making them work offline is a separate piece of design.
5. **One switch.** Nearly every entity links to `familyMembers`, so the data cannot live half in one backend and half in the other. Cutover is a short read-only window, a final import, and a change of backend.
6. **One Postgres, no MongoDB.** Postgres and the PowerSync service join the existing compose file. PowerSync keeps its own bookkeeping in a second database on the same server.
7. **Built for PowerSync, not adapted to it.** The finished app reads as though it had been written for PowerSync and Postgres from the start. There is no compatibility layer, and nothing keeps a shape only because Instant gave it that shape. [What that means here](#the-finished-app) is spelled out below.

Made in this plan, and open to revision as the work shows:

8. **One data layer, shared by the web and the phone.** Each feature area has typed queries and mutations in a shared package. Screens call those; they contain no SQL and no query objects.
9. **Typed SQL, with Kysely, on the device and on the server.** PowerSync is SQL-first and has an official driver for it. The spike compared it with Drizzle and with plain SQL strings and found no difference in speed. Kysely is chosen because it takes its types from PowerSync's own client schema and is the same builder on both sides. Drizzle would also work; this is a preference for one tool, not a measured result.
10. **SQL migrations are the source of truth for the schema.** There is no schema file in application code that the database is derived from.
11. **The scaffolding faces Instant, and is thrown away.** To keep `main` shippable, the data layer is first implemented over Instant, then natively over PowerSync. The Instant implementation is deleted at cleanup, and the seam between the two with it. See [how the app gets there](#how-the-app-gets-there).
12. **The app owns its sessions.** Instant's tokens are replaced by session tokens this server issues and can revoke, plus short-lived signed tokens for PowerSync.
13. **The write rules are one file, shared.** The same rule code runs on the device, for an immediate answer, and on the server, where it is authoritative. Anything not listed is denied.
14. **Both backends live in `main`** until cutover, rather than on a long-lived branch. Which one a client uses is what the server tells it when it starts, not something compiled into the build.

Added after the review of 12 October 2026. David approved the direction, and decision 18 in particular. The detail of the others is this plan's, and [the slice](#phase-2--one-slice-end-to-end) either proves it or changes it.

15. **One local database per person.** A device keeps a separate database for each person signed in on it. A write waits in the database of the person who made it and is uploaded under that person's own session. See [one database per person](#one-database-per-person).
16. **The server decides what an upload is.** An uploaded write is judged against the row as Postgres holds it, under a lock, never by what the device called it. Every uploaded transaction is recorded once, so a retry is answered from the record instead of being applied again. See [the upload endpoint](#writes-the-upload-endpoint).
17. **First claim wins.** When two devices create the same up-for-grabs completion offline, the first to reach the server holds it and the second is refused.
18. **Money is written only by the server.** Ledger rows, balances, and creating and archiving an envelope go through the finance routes and nowhere else. An envelope's name, description and goal, and which envelope is a member's default, stay ordinary device writes, so they go on working offline. This applies at cutover; the live Instant rules are not touched. See [what it changes](#money-is-written-only-by-the-server).
19. **One slice before the rest.** One feature runs on PowerSync end to end, on staging, on a copy of the real data, before more screens are converted.

**Licence.** The PowerSync service is under the Functional Source License: source-available, free to self-host and modify, not to be resold as a competing sync service, and each release becomes Apache-2.0 after two years ([licence text](https://github.com/powersync-ja/powersync-service/blob/main/LICENSE)). It runs as a container this project pulls, so the repository stays MIT. The README should say that one runtime dependency is source-available rather than open source ([Phase 9](#phase-9--cleanup)).

## What exists today

| Area | Count on `a4aed13` |
| --- | --- |
| Entities | 49 of the app's own, plus Instant's `$users`, `$files`, `$streams` |
| Attributes | 528: 330 string, 108 number, 38 JSON, 36 boolean, 16 date |
| Links | 54 between app entities: 49 with a "one" side, 5 many-to-many; 13 cascade on delete |
| Unique attributes | 17 |
| Client reads | 64 `useQuery` and 6 `queryOnce` on the web; 32 `useQuery` on the phone |
| Client writes | 161 `transact` call sites in 45 web and shared files; 35 in 13 phone files |
| Server reads and writes | 26 admin queries; 6 library files write through the Admin SDK; 13 files call `getInstantAdminDb` |
| Imports of `@instantdb/*` | 34 component files, 13 in `lib/`, 15 in `mobile/`, 5 scripts, 1 in `app/`. They import `id` (53 times), `tx` (41) and `init` (4) |
| Permission rules | 55 blocks in `instant.perms.ts`; 40 are pure role checks |
| Auth | 6 token routes; the helpers that authenticate a request by verifying an Instant token are used in 6 files |
| Presence | One room, `messageThreads`, used by the web and phone message screens |
| Tests | 153 files, 1,074 tests. 17 files mock `@/lib/db`, 10 mock `@/lib/instant-admin`, 2 contract suites and 1 live suite test the permission rules |

Three things in that inventory shape the plan.

**The same data is fetched over and over.** Nearly every query fetches whole collections with their relations, and the same few graphs recur: chores with their assignees, assignments or completions are queried in nineteen separate places across the web and the phone, thirteen of them dashboard widgets. A shared data layer replaces that repetition with a handful of named reads per area.

**The server already holds the invariant-bearing work.** Money goes through `/api/finance/mutations`, messaging through `/api/messages/*`, calendar sync and shortcuts through their own routes. Those are untouched by the question of how devices sync, and they are where real database transactions pay off most.

**The live app does not exactly match `instant.schema.ts`.** The hosted app carries `calendarSyncCalendars.ctag` and `syncToken`, which the file does not declare ([roadmap Scope 3](../roadmap.md#scope-3--the-correctness-sweep)). The export therefore reads what is actually stored, and reports the difference, rather than trusting the file.

## The finished app

This is the definition of done for decision 7. When the work is complete:

- **The schema is a relational schema.** Tables and columns are named and typed the way a Postgres schema is, with foreign keys, composite keys and constraints doing the work that application code and workaround fields do today.
- **A read is SQL.** A screen asks the data layer for what it needs — a day's chores, one thread's messages — and gets rows shaped for that purpose, live.
- **A write is SQL in a local transaction**, wrapped in a named function: `completeChore`, `renameEnvelope`. There are no operation lists, no `link` and `unlink`.
- **The server uses database transactions and constraints** for money, messaging and sync bookkeeping.
- **Identity is the app's own.** There is no object pretending to be an Instant user.
- **Nothing from Instant is in the repository**: not its packages, its schema and permission files, its vocabulary, nor an API imitating it.

What is *not* required: that every domain concept be remodelled. A chore still has assignees; a task series still has tasks. The test for any shape is whether someone designing this app on Postgres today would choose it — not whether it is different from before.

## Target architecture

```
  web (Next.js client)            phone (Expo)
  ┌───────────────────┐           ┌───────────────────┐
  │ components        │           │ screens           │
  ├───────────────────┴───────────┴───────────────────┤
  │ data layer (packages/data) — shared               │
  │   queries · mutations · write rules · session     │
  ├───────────────────┬───────────┬───────────────────┤
  │ PowerSync web SDK │           │ PowerSync RN SDK  │
  │ SQLite (WASM)     │           │ SQLite (op-sqlite)│
  └───┬───────────▲───┘           └───┬───────────▲───┘
      │ writes    │ changes           │           │
      ▼           │                   ▼           │
  ┌───────────────┴───────────────────────────────┴───┐
  │ Next.js server                    PowerSync service│
  │  POST /api/sync/upload  ── write rules             │
  │  GET  /api/sync/token   ── signs a short token     │
  │  finance, messaging, calendar sync, files …        │
  └───────────────┬───────────────────────▲────────────┘
                  ▼                       │ logical replication
              ┌───────────────────────────┴──┐
              │ Postgres                     │
              └──────────────────────────────┘
```

A write on a device lands in local SQLite at once, and every live query on that device updates. PowerSync's upload queue then posts it to `/api/sync/upload`, which checks the write rules and applies it to Postgres. PowerSync reads Postgres's replication log and streams the change to every other connected device.

## The schema

The schema is designed, not transliterated. [Appendix A](#appendix-a--what-has-to-be-carried) lists what has to be carried. The tables the slice needs are designed first, in [Phase 2](#phase-2--one-slice-end-to-end), and the rest in [Phase 3](#phase-3--the-schema-and-the-data). Both rest on the census of live data, because several type decisions depend on what is really stored.

### Design rules

- **Names** are `snake_case`, tables plural: `chore_completions.date_due`. Unquoted lower-case identifiers are also what PowerSync's sync queries handle without ceremony ([case sensitivity](https://docs.powersync.com/sync/advanced/case-sensitivity)).
- **Ids** are `uuid`, generated on the device, as PowerSync recommends for rows a client creates ([client id](https://docs.powersync.com/sync/advanced/client-id)).
- **An instant is `timestamptz`; a calendar day is `date`.** Today 87 attributes hold dates as strings, 13 as epoch numbers and 16 use Instant's date type. With `edition: 3` in the sync configuration PowerSync sends timestamps to devices as ISO 8601 text ([compatibility](https://docs.powersync.com/sync/advanced/compatibility)), so the rule end to end is: `timestamptz` in Postgres, ISO 8601 text on the device, an ISO string in the app's types.
- **A boolean is `boolean`, a count or position `integer`.** Devices receive booleans as 0 and 1; the data layer's row mappers turn them back.
- **Money stays `double precision`.** Four ledger rows hold sub-cent amounts, and the roadmap [decided against](../roadmap.md#decided-against) scaled-integer money for this deployment because coercing them would rewrite a real event. That decision is the whole reason. `numeric` would be exact, and it reaches a device as text ([type mapping](https://docs.powersync.com/sync/types)), which the app could parse. Moving to it is a change for later, with its own conversion and David's approval, not something this migration slips in.
- **`jsonb` is for documents.** A JSON attribute stays JSON when it is a self-contained value read and written whole — an event's alarms, a widget's settings. It becomes columns or a table when the app reaches inside it or it models a relation. Several attributes typed as JSON today are plain scalars (`chores.canCompleteInAdvance`, `chores.difficultyRating`) and become ordinary columns.
- **Relations are foreign keys, and what a delete does is decided relationship by relationship.** `ON DELETE CASCADE` where a child means nothing without its parent: the 13 cascade links, and the join tables. `RESTRICT` where the child is a record that must not vanish: nothing the ledger points at can be deleted from under it, which is why an envelope is archived and never deleted. `SET NULL` only where the reference is optional and the row still makes sense without it. The mapping file records the choice for each relation; there is no default.
- **Constraints say what the code currently has to remember**: `NOT NULL`, `UNIQUE`, and `CHECK` on status columns.
- **No generated column is synced.** Postgres leaves generated columns out of what it sends PowerSync when a row changes, so a device would be sent one once and never see it change. A value derived from other columns that devices need is an ordinary column kept by a trigger.

### What is designed out

These exist only because of how Instant works, and do not survive.

- **Key strings standing in for composite uniqueness.** `routineMarkerStatuses.key` is `date:markerKey` stored beside `date` and `markerKey`; `messageThreadMembers.membershipKey`, `messageReactions.reactionKey` and `messageAcknowledgements.ackKey` are the same idea. They become composite primary keys.
- **Columns kept only to search or sort on.** A thread's `titleNormalized` and `searchText`, written for a search Instant could not do without them and never read; and each thread member's `sortTimestamp`, a copy of when the thread last had a message. SQL lower-cases, searches and joins for itself. Each of the 17 unique attributes is reviewed: a real natural key (`unitDefinitions.code`, `contentCategories.slug`) or an idempotency key (`allowanceTransactions.distributionKey`) stays.
- **An id stored twice.** Ten relations are held both as a link and as a plain attribute carrying the same id (`messages.threadId` beside the `thread` link). Each becomes one foreign-key column.
- **Many-to-many links** become join tables with a composite primary key: who a calendar item pertains to, a calendar item's tags, who a history event affected, a chore's assignees. PowerSync needs a single text `id` per synced table, which the sync query builds from the two columns.
- **`choreAssignments` and `routineSteps`**, entities that exist to carry a position on a relation, become what they are: join tables with a `position` column.
- **Balances as one JSON value.** `allowanceEnvelopes.balances` maps a currency to an amount, and every money operation reaches inside it. It becomes one row per envelope and currency.
- **A setting found by name but keyed by a random id.** Nothing stops two rows sharing a name today. The name becomes the key.
- **A default flag on every envelope.** Which envelope is a member's default is a flag on each of them, and code keeps exactly one set. It becomes one column on the member.
- **`calendarSyncLocks`.** A table of lock rows, because Instant has no locks. A Postgres advisory lock replaces it: one per calendar account, held for the length of a sync run on a connection taken for that run alone, and released when the run ends, or by Postgres itself if the process dies. A sync run makes network calls, so the lock is held by the session and never inside an open transaction.
- **`$users`, `$files`, `$streams`, and the presence room.** Principals become token claims; nothing reads or writes `$files` or `$streams`.
- **Numbers kept to find a row by.** A calendar event's `year`, `month` and `dayOfMonth` repeat its start so that Instant could filter on them. A range on the start does that.
- **A flag saying which kind of value another attribute holds.** `calendarItems.isAllDay` said whether the start was a day or an instant. An all-day event has two day columns and a timed one two instant columns, and a row has one pair.
- **The same thing held twice in two forms.** An event's `recurrenceLines` wrote out again what `rrule`, `rdates` and `exdates` already held.
- **Stringly-typed dates and loosely-typed scalars**, per the rules above.

Kept deliberately:

- **Deterministic ids** for up-for-grabs completions and countdown runs. They look like an Instant workaround but are the right tool for offline-first sync: two devices that create "the same" row while offline must arrive at the same id. The id does not decide who wins; [a rule on the server](#the-write-rules) does.
- **Soft references in history.** `historyEvents.choreId`, `taskId` and the like are ids that were never links. They stay unconstrained columns, because history must keep pointing at things that have since been deleted.
- **Five attachment tables** rather than one polymorphic table, so each keeps a real foreign key to its owner. The one for content has three possible owners, a column for each, and a check that exactly one is set.

### What is added, and what is left behind

Added:

- `auth_sessions` — the app's own sessions ([identity](#identity-and-sessions)). Server only.
- `sync_uploads` — one row for every transaction a device has uploaded, with its outcome ([the upload endpoint](#writes-the-upload-endpoint)). Server only.
- `write_refusals` — every transaction the server refused: who made it, what it was, and why. Synced to the person who made it and to parents ([refusals](#refusals)).
- `installation` — one row: this installation's id, its data generation, the backend in use, whether writes are frozen, and the oldest client build allowed ([the cutover protocol](#the-cutover-protocol)). Server only, and served to clients through the configuration route.
- `client_checkins` — what each device last reported about itself. Server only.
- `family_members.has_pin` — a boolean synced in place of the PIN hash, kept true to the hash by a trigger.
- `family_members.default_envelope_id` and `envelope_balances`, in place of a flag and a JSON value on each envelope ([money](#money-is-written-only-by-the-server)).
- Nothing for the one place the app orders by Instant's built-in server timestamp (`TransactionHistoryView`): from cutover only the server writes a ledger row, so `allowance_transactions.created_at` is the server's own.

Left behind:

- The two undeclared calendar attributes, `ctag` and `syncToken`. No code reads them. This also settles the open [Scope 3](../roadmap.md#scope-3--the-correctness-sweep) item about them: they are not migrated.
- `choreManualStarts`, already removed from the code and still present in the hosted app.
- A task's prerequisites, a link that is declared, holds nothing, and that no code reads.
- `tasks.isCompleted`. A task is done when its workflow state says so; the flag was the fallback for rows from before that state existed, and the import resolves it.
- Most of `calendarSyncRuns`. The server's log of sync attempts is 61,111 of the live app's 64,895 rows and no device reads it. The last thirty days are carried, and from before that only the runs that failed or changed an event; the table gets a retention rule with the import's rewrite.

Three entities are referenced by no code at all: `calculatedAllowancePeriods`, `deviceSessions` and `timeOfDayDefinitions`. The census found no rows in any of them, so they are simply not carried.

### Tables that never reach a device

The calendar-sync tables — accounts, calendars, the log of runs, and `calendar_item_sync_state`, what the import knows about each event it brought in — with `shortcut_tokens`, `push_devices`, `auth_sessions`, `sync_uploads`, `installation` and `client_checkins`, are read and written only by the server. They are left out of the sync configuration and the replication publication. Today's rules let some principals view five of the corresponding entities — any family member `calendarSyncCalendars` and `deviceSessions`, a parent `calendarSyncAccounts` and `calendarSyncRuns`, a parent or the owner `pushDevices` — but no client code reads any of them, so this narrows access without changing behavior.

### Where the schema lives

- **Postgres**: hand-written SQL migrations in `db/migrations/`, applied by `db/migrate.mjs` when the app container starts, under an advisory lock.
- **The device**: a checked-in TypeScript client schema, first generated with PowerSync's CLI (`powersync generate schema`, which works against a self-hosted instance — [CLI](https://docs.powersync.com/tools/cli)) and then maintained with its indexes. A test fails if its columns drift from the sync configuration.
- **Indexes on the device** are declared for the columns a read filters and joins on, composite where a read filters on two together: a day's completions are found by chore and day. They are chosen from the query plans of the real reads, not by rule. PowerSync's ordinary client tables are views over JSON with basic index support; if a read proves too slow on a phone, [raw tables](https://docs.powersync.com/client-sdks/advanced/raw-tables) — real SQLite tables — are the remedy for that table.
- **The mapping**: `scripts/migrate/mapping.mjs` records, for every Instant attribute and link, the column it becomes and the conversion applied, and lists what is deliberately left behind. The import uses it, so it is also the written record of every design choice above. It reads neither a database nor `instant.schema.ts`, so it goes on working from an export or a backup after Instant has left the repository.

## The data layer

`packages/data` is one workspace package used by the web app and the phone, as `packages/shared-core` is. Its own README states its rules.

```
packages/data/src/
  backend.ts     the one seam: an implementation is bound once, at startup
  <area>/        types.ts · backend.ts · hooks.ts · mutations.ts
  instant/       the implementation over Instant — deleted at cleanup
  powersync/     the implementation over PowerSync: client schema, queries, mutations
  policy/        the write rules, shared with the server
  session/       the principal, that person's database, the connector, sync status
```

- **`types.ts`** holds the area's own types, designed against the relational schema.
- **`hooks.ts` and `mutations.ts`** are what screens import. They hold what is true on any backend — defaults, decoding, validation — and call the bound implementation.
- **`backend.ts`** is what an implementation must supply for the area: a handful of functions.
- **Screens import hooks and mutations and nothing else.** No SQL in a component, on either platform.

The seam exists so the app can run on Instant while it is rebuilt. It is scaffolding. At cleanup the Instant implementation is deleted and the seam with it: an interface with one implementation would be exactly the kind of leftover decision 7 rules out, so the hooks then call the SQL directly.

### Reads

A read is named for what a screen needs: `useChoreDay(day)`, `useThreadMessages(threadId)`, `useMemberBalances(memberId)`. Each is live — it re-runs when a table it reads changes, whether from a local write or from sync.

- **A read is typed SQL**, built with Kysely against the device's schema and handed to PowerSync to run. Kysely never runs anything itself on a device: it has no driver there, only the builder and its types.
- **Nested data** such as a chore with its assignees and completions comes, by default, from a few flat queries, each on an indexed column, combined by a pure function. On the spike's generated data that shape was far faster on PowerSync's client tables than one statement of correlated aggregates. It is the starting point, not a rule: a read that is better written as a join is written as one, decided from its query plan on the real data and its timing on a phone. A read never fetches a whole history when it wants a day: the day is in the `WHERE`, and the columns have an index.
- **One read, one moment.** A hook that combines several queries watches the tables it reads and, when any of them changes, runs all its queries inside one read transaction. It never stitches together results taken at different moments, so a screen cannot show a completion whose chore has not arrived yet.
- **Types are the app's own**, written per area: ids for references, ISO strings for instants, `YYYY-MM-DD` for days, real booleans, parsed JSON. They are designed against the relational schema. Where `shared-core` logic takes a nested chore today it takes the area's type instead. A type says "not known" where that is the truth: on Instant a kid's device cannot tell whether someone else has a PIN, so `hasPin` is `null` there, not `false`.
- **Loading.** A hook reports loading until the signed-in person's database has completed its first sync, so a new device, or a person new to a device, sees a loading state rather than an empty family.

### Writes

A mutation is a function: `completeChore({ choreId, memberId, day, markedBy })`. Inside one local write transaction it:

1. checks the shared [write rule](#the-write-rules), so a refusal is immediate;
2. checks any uniqueness the server will enforce, for the same reason;
3. writes the rows, including the dependent rows the server's foreign keys would remove on a delete, so an offline view stays consistent;
4. labels the transaction with its own name, which travels with the upload so that a refusal can say what was refused.

PowerSync uploads each local transaction as one unit and the server applies it in one Postgres transaction — all or nothing.

A mutation resolves when the write is saved on the device, not when the server has accepted it. A refusal only the server can discover — another device changed the row first, another kid claimed the chore first — arrives later. The device's copy is put right at its next sync, and the person finds what happened under [refusals](#refusals).

**A mutation checks what it is given.** The app's TypeScript is not strict and the phone's screens are JavaScript, so types alone do not protect a write. Each mutation validates its arguments at run time before it touches the database, and a test compiles the package itself under strict settings.

Money, sending a message and PIN elevation are not local writes. Their mutations call the server routes they call today, per decision 4. From cutover that covers everything that writes the ledger or a balance, or creates or archives an envelope ([money](#money-is-written-only-by-the-server)).

**Changing backend, or person.** The implementation is bound once, before anything renders. Nothing swaps it under a running screen: a change of backend is a restart ([the cutover protocol](#the-cutover-protocol)), and a change of person remounts everything below the session provider on that person's database ([one database per person](#one-database-per-person)).

### The areas

Read and write call sites on `a4aed13`, client and server together, by area. The counts are what gets consolidated, not how many functions result; the chore graph alone accounts for half of the dashboard reads.

| Area | Read sites | Write sites | Owns |
| --- | --- | --- | --- |
| Family, settings | 10 | 13 | members, settings, unit definitions |
| Chores | 12 | 38 | chores, assignments, completions, routine markers, routines, countdown runs |
| Task series | 19 | 40 | series, tasks, updates, response fields, grade types, attachments |
| Calendar | 5 | 24 | items, tags, who an item pertains to |
| Finance | 21 | 20 | envelopes, transactions, exchange rates |
| Messaging | 18 | 16 | threads, members, messages, reactions, acknowledgements |
| History | 1 | — | events and their attachments, written from other areas |
| Content | 9 | 24 | announcements, family rules, the content queue |
| Dashboards | 25 | 15 | configs, layouts, widgets; reads mostly other areas' data |
| Calendar sync | 6 | 6 | server only |

## How the app gets there

Rewriting every screen's data access and replacing the database underneath it are two large changes. Done together on a branch, nothing could be checked until all of it was finished, against a codebase that took eighteen commits while this plan was being written. So they are done separately, on `main`.

They are not done strictly one after the other, though. Converting every screen before any of it had met PowerSync would fix the data layer's API around one backend's habits: what it means for a mutation to have finished, what loading is, what a change of person does, how a refusal arrives. So a thin slice goes all the way through first.

**First, one area's data layer, over Instant** ([Phase 1](#phase-1--the-data-layer-over-instant), done as far as settings, units and reading the family roster). The area's API and types are designed for the relational end state. Its first implementation runs on Instant: the query objects and transaction-building that live in components today move into `packages/data/src/instant/` and are mapped into the new types. The app keeps running on the live database.

**Then one slice on PowerSync, end to end** ([Phase 2](#phase-2--one-slice-end-to-end)): those reads, a day's chores, and completing a chore, on a staging deployment, on a copy of the real data, through real sessions, the real upload route and the real rules. What it shows is written back into this plan before anything else is built on it.

**Then the rest of the screens move to the data layer, over Instant** (Phase 1, resumed), area by area, each looked at on real data as it lands.

**Then each area gets its PowerSync implementation** ([Phase 7](#phase-7--the-data-layer-on-powersync)). TypeScript holds both implementations to one interface per area, and the server tells each client which to use, so the PowerSync build runs on staging while production stays on Instant.

**Then the Instant files are deleted** ([Phase 9](#phase-9--cleanup)), and the seam with them.

The adapter code in this plan is therefore all on the Instant side — it maps Instant's results into the app's types — and none of it outlives cutover. Nothing is ever written to make PowerSync look like Instant.

The same pattern holds on the server: each service gets a Postgres implementation beside its Instant one, with the same function signatures, and the routes do not change.

## Reads: the sync configuration

PowerSync decides what reaches a device from a configuration of named streams, each a SQL query, filtered by claims in the device's token ([Sync Streams](https://docs.powersync.com/sync/streams/overview)). The configuration uses `edition: 3`, which PowerSync recommends for new Sync Streams projects, and `timestamp_max_precision: milliseconds`, so a timestamp reaches a device in exactly the form `toISOString()` writes. Today's 55 `view` rules reduce to three streams, and two more carry refusals.

| Stream | Who | What |
| --- | --- | --- |
| `family` | every signed-in device | Every table today's rules let any family principal view. `family_members` is sent without the PIN hash |
| `messaging_member` | a token carrying a family member id | The threads that member belongs to, with their members, messages, attachments, reactions and acknowledgements |
| `messaging_parent` | a parent token | All threads and their contents, as the rules allow a parent today |
| `refusals_member` | a token carrying a family member id | That person's refused writes |
| `refusals_parent` | a parent token | Everyone's refused writes |

A shared kid session carries no family member id and so receives no message threads, as now. Every stream lists its columns explicitly, so a server-only column cannot leak by accident.

**The PIN hash stops leaving the server.** Today a parent's device can read every member's hash and a kid's device its own. The clients only ever use it to show whether a PIN is set, so devices get `has_pin` instead and the PIN is set through a server route.

**Growth.** History and messages only ever grow, and the roadmap [decided against](../roadmap.md#decided-against) rolling them up, bounding them at read time instead. Syncing is different from reading: a table that syncs in full is stored on every device. The census settled the question for this family: everything a device would hold is about 3,800 rows and 3 MB, so history, messages and task updates sync in full. If a family's data outgrows that, those tables move to a stream bucketed by month that a device subscribes to as it scrolls back; PowerSync's stream parameters only support equality, so the bucket is a column, not a date range ([syncing by time](https://docs.powersync.com/sync/advanced/sync-data-by-time)).

## Writes: the upload endpoint

`POST /api/sync/upload` receives one uploaded transaction: the id its mutation gave it, the mutation's name, the data generation the device's database belongs to, and a list of operations, each a table, a row id, and `PUT` (a new row with its columns), `PATCH` (only the columns that changed) or `DELETE` ([PowerSync's write model](https://docs.powersync.com/handling-writes/writing-client-changes)).

What a device calls an operation is a hint and nothing more. A device can be modified, and an honest one can be out of date: the row it thinks it is creating may exist, and the row it is editing may be gone. So the route trusts none of it.

For each transaction the route:

1. **Authenticates the session** and resolves the principal — parent or kid, and which family member. A session that has ended is answered `401` and nothing is applied; [the device keeps the writes](#one-database-per-person).
2. **Checks the shape before any SQL exists.** The table must be one a device may write, the operation one of the three, every column one a device may write on that table, and every value of that column's type. These come from a fixed list in the policy, never from the request, so no table or column name sent by a device is ever put into a statement. One unknown name refuses the whole transaction.
3. **Opens a Postgres transaction and claims the upload**, by inserting the transaction's id into `sync_uploads`. If that row is already there with an outcome, this is a retry: the stored outcome is returned and nothing is applied.
4. **Locks and reads each row** it is about to touch, with `SELECT … FOR UPDATE`, and decides what the operation really is from what it finds. A `PUT` for an id that exists is an update of the columns that differ. A `PUT` for one that does not is an insert, made so that losing a race to another insert is noticed and the operation is judged again as an update. A `PATCH` or `DELETE` for a row that is gone does nothing.
5. **Evaluates the [write rule](#the-write-rules)** on the operation as decided: the principal, the row as it is, the row as it would be.
6. **Applies and commits**, storing the outcome in `sync_uploads` in the same transaction. If any operation was refused, every write in the transaction is undone and only the refusal is stored.

**Responses.** A refused transaction returns `200` with the refusal in the body. PowerSync's guidance is specific: an error response is retried indefinitely and blocks everything queued behind it, so a refusal is acknowledged, and only a temporary fault — Postgres unreachable — returns `5xx` to be retried.

**Retries.** A device retries an upload whenever it did not hear the answer, and that includes the case where the write was applied and only the answer was lost. Applying it again is not harmless: in the spike such a retry replaced a correction another device had made in between. The record in `sync_uploads` is what makes a retry safe. It is written in the same transaction as the writes, so a transaction is applied exactly once and every retry gets the first answer. What names a transaction is an id its own mutation makes, at random, when it writes: a row in a table PowerSync uploads and keeps nothing of. The first design used the device database's id with PowerSync's number for the transaction, and that numbering starts again when a database is emptied, so a later transaction could have been taken for an earlier one and never applied. Records are pruned after ninety days.

**Conflicts.** Two devices changing different fields of one row both win, because a `PATCH` carries only changed columns. Two devices changing the same field: the later upload wins, which is what Instant does today. Where that is the wrong answer the table's rule says otherwise, and one does — a claim, below.

**The upload throttle is lowered.** The SDK waits up to a second before uploading by default, and in the spike that wait was nearly all of the time a write took to reach another device: a median of 870 ms with the default, 43 ms with `crudUploadThrottleMs` at 50. The connector sets it to 100.

### Refusals

A refused write has already shown on the device as done. The device puts its copy right at the next sync, but the person needs to be told, and may not be looking: the upload can happen minutes later, in the background, or after someone else has picked up the device.

So a refusal is a row. The route writes it to `write_refusals` — who, when, the mutation's label, the reason — in the transaction that records the outcome, and the table syncs: to the person who made the write, on whatever device they next sign in to, and to parents. The app shows a toast if that person is looking, and keeps the row in a list behind the sync badge until they dismiss it. Because it is an ordinary table, a refusal can also be read in any Postgres client.

Writes that could not be sent at all are a different case, covered under [one database per person](#one-database-per-person).

### The write rules

`packages/data/src/policy/` holds one entry per table a device may write: who may insert, who may update and which columns, and who may delete, given the principal and the row. Anything not listed is denied.

It starts from `instant.perms.ts`; [Appendix B](#appendix-b--the-write-rules-today) gives today's rules in the form they are translated from. **A person keeps every ability the app gives them today.** Four things are stricter than the Instant rules, each on purpose:

- **Tables that stop syncing** cannot be written from a device ([which](#tables-that-never-reach-a-device)).
- **The PIN hash** is set through a server route, never by a device.
- **Money** is written only by the server ([below](#money-is-written-only-by-the-server)).
- **A completion that stands belongs to whoever completed it.** A write that would hand it to someone else is refused, for a parent as for a kid. This is what makes first claim win: the second device's `PUT` finds the first's row, is judged as an update of it, and is refused. No screen changes a completion's owner today, so nobody loses anything.

And one thing is looser, also on purpose. **A completion that has been un-ticked can be taken by another kid, for themselves.** Under the Instant rules a kid may change only a completion that is theirs, so an up-for-grabs chore that one kid ticked and un-ticked could not then be done by another: the one completion that chore has for the day still belonged to the first. A parent could always take it. A cleared completion records nothing, so nothing is lost by letting it go; one a parent has marked as not done stays where it is.

One table is new and so has no rule to translate: a row of `write_refusals` can only be marked dismissed, by the person it belongs to or by a parent.

The rule functions are pure — operation, current row, proposed row, principal — so the same file runs in two places: inside a mutation on the device, for an immediate refusal, and in the upload route, where it is authoritative. A device can be modified; the server check is the one that counts.

**How the rules are tested.** By behavior, against a real Postgres. Each table has a case for every principal and operation Appendix B names, and for the ways a device can lie or be late: a `PUT` over an existing row, a change of owner, a transaction that changes both a row and the row its rule depends on, a retry after a commit with another device's write in between, an upload under a session that has ended, and two uploads racing for one row. The two existing contract suites compare the text of the rules in `instant.perms.ts`. They keep that file from changing by accident, and they serve here as a checklist of what needs a case, but they do not show that any write is refused. The live matrix, which does send real writes to Instant, is ported case by case.

### Money is written only by the server

Approved by David on 12 October 2026. It is the one place this migration takes an ability away on purpose, and it takes it from a modified client, not from a person.

Today's rules let any signed-in device create a ledger row, and let a parent's device write any column of an envelope, its balances included. The app does not use that freedom for money: deposits, withdrawals, transfers, payouts and archiving all go through `/api/finance/mutations`, which reads fresh, checks the invariants and writes ledger and balance together. But the rules permit a device to go around the route, and an upload endpoint that translated them faithfully would permit it too.

From cutover:

| | A device may | Only the finance routes may |
| --- | --- | --- |
| Ledger rows | Read | Insert. Nobody updates or deletes |
| Envelopes | Change the name, description and goal, and choose which is the default — a parent for anyone, a kid for their own | Create, archive |
| Balances | Read | Write, in the same transaction as the ledger row |

Four places in the app write these from a device today, and each moves:

- **A new member's first envelope** is created with the member, in `FamilyMembersList`. The device still creates the member. The envelope is made by the server's existing `create-initial` operation, which the form calls once the member has uploaded, and which the allowance page already calls for any member who has none.
- **Editing an envelope** (`updateEnvelope`) writes the name, the goal and the default flag together. Name, description and goal become device mutations, `renameEnvelope` and `setEnvelopeGoal`, with their history event. The default flag leaves it.
- **Choosing the default envelope** (`setDefaultEnvelope`) clears one row's flag and sets another's, from the device. It stays a device write, by David's decision of 13 October 2026, so a kid can still do it offline. What changes is where the choice is kept: it becomes one column on the member, `default_envelope_id`, in place of a flag on every envelope. That a member has exactly one default then needs no rule to keep it, on a device or on the server, and two devices that choose differently offline leave one default, the later, not two. A parent may set it for anyone and a kid for themselves, to an envelope of that member's that is not archived. The finance routes read it, and move it when they archive the envelope it names.
- **Reconciling a balance** (`reconcileEnvelope`) replays an envelope's ledger on a parent's device when the allowance page opens, and rewrites a balance that disagrees. The route gains `reconcile`, for a parent, which does the same under the envelope's lock; the page calls it and shows the same notice. With ledger and balance written in one database transaction, a disagreement should no longer arise from the app at all — only from an edit made by hand in Postgres.

**What a person notices.** Nothing. Everything the app lets someone do with money today, it lets them do afterwards, online or off as now.

**What does not change yet.** The live app keeps today's Instant rules until cutover. Tightening them there would be a second change to a database that is about to be left, with its own risk and nothing gained.

## Identity and sessions

Today the server verifies a PIN, asks Instant to mint a token for a synthetic user, and writes the principal's type and family member id onto that user's `$users` row. Rules read them from there, API routes authenticate by asking Instant to verify the token, and components read `db.useAuth()`.

| Today | After |
| --- | --- |
| Instant refresh token, cached on the device | A session token this server issues: random, stored hashed in `auth_sessions`, revocable |
| `$users.type`, `$users.familyMemberId` | Columns on the session row, and claims in the PowerSync token |
| `adminDb.auth.verifyToken` in `lib/request-family-member.ts` | A lookup in `auth_sessions` |
| `db.useAuth()` returning an Instant user | `usePrincipal()` from the data layer's session module |
| Six `instant-auth-*` token routes | Routes under `/api/auth/`, and `GET /api/sync/token`, which exchanges a session for a signed token PowerSync accepts |

- **A session is one principal on one device**, and it is in one of three states. *Active*: it can do whatever its principal may. *Draining*: it can upload what its database still holds, fetch the tokens that needs, and nothing else — no money, no messages, no new sign-in. *Ended*: it can do nothing.
- **The PowerSync token** is signed with an asymmetric key and carries `sub`, `aud`, `iat`, `exp`, a `kid` header, and two claims the streams read: `type` and `family_member_id`. PowerSync requires those standard fields and recommends lifetimes between 5 and 60 minutes ([custom authentication](https://docs.powersync.com/configuration/auth/custom)); this plan uses 10. The SDK asks for a fresh one before expiry by itself.
- **The key pair** is generated by a setup script. The private half goes to the app, the public half into the PowerSync configuration.
- **PIN verification, the scrypt hashes, rate limiting and device activation do not change.** Family members keep their PINs; nobody re-enrols.
- **Existing sessions do not carry over.** Every device signs its member in again once after cutover.
- **Audit fields.** `allowanceTransactions.createdBy` holds an Instant user id today. New rows hold the session's principal id; old rows keep their old value as an opaque string. `createdByFamilyMemberId` is unaffected and remains the field that names a person.

In Phase 1 the session module is introduced over Instant, like the rest of the data layer, so components stop touching `db.useAuth()` before the backend changes.

### One database per person

A shared device moves between people: a kid, another kid, a parent who steps in for a few minutes and is signed out again after fifteen idle. Each may see different things — a parent every message thread, a kid only their own — and each may leave writes that have not uploaded yet.

The first version of this plan kept one database and one upload queue per device and changed the token underneath it. That cannot be made safe. A queue holding one person's writes is uploaded under whoever is signed in when the network returns. Parent-only rows stay in a database the interface is now showing to a kid. And nothing on the device remembers, after a restart, whose a queued write was.

So **a database belongs to one principal.** Its file is named for the installation and the principal — the shared kid session, a kid by member id, a parent by member id — and it is only ever opened with that principal's session. Whatever is in it was synced for that person. Whatever waits in it was written by that person, and is uploaded as that person. The interface has one database open at a time: the signed-in person's.

When the person on a device changes:

- **The interface switches at once**, to the other person's database. If that database is new it fills first, which the spike measured at a quarter to three quarters of a second for this family's data on the browser's private file system.
- **The database left behind is closed to the interface.** If nothing in it is waiting to upload, it is emptied and its session ended. If something is, the session is narrowed to draining and the device goes on uploading from that database in the background, as that person. When the queue is empty, the database is emptied and the session ended.
- **One database is kept: that of the person the device rests on** — its owner on a personal device, and on a shared one the kid or shared session it returns to when a parent is signed out. A parent stepping in opens the parent's database beside it. Signing the parent out goes back to a database that is already there, so it works with no network, as it does today from a cached token.

A parent's data is therefore on a shared device only while the parent is signed in, plus however long the parent's last writes take to upload. Idle sign-out does not turn into the device holding a parent's authority indefinitely: a draining session can do nothing but finish its uploads, and it ends after a day whether or not it has.

**When a queue cannot be sent.** A session can end with writes still waiting: it expired on a device that was offline for a long time, its day of draining ran out, or a parent revoked it. The upload route answers `401` and the device stops trying. The writes are neither dropped nor uploaded as someone else. They stay in that person's database, the device says so — "3 changes by Dad are waiting for Dad to sign in" — and they upload when that person next signs in on that device, under the new session. A parent can discard them instead, after seeing what they are.

**Tabs.** The signed-in person belongs to the browser, not to a tab: every tab shows the same person, and when one tab changes person the others are told and follow. Tabs showing the same person share that person's database, so a write in one appears in the others at once, with or without a network. They do not each sync. Where PowerSync uses a shared worker, which is Chromium and Firefox on a computer, one connection serves every tab. Where it does not — Safari, every browser on iOS, and Android — only one tab at a time holds the connection, and the others see what it brings through the shared database ([multiple tabs](https://docs.powersync.com/client-sdks/reference/javascript-web#multiple-tab-support)). Either way one set of credentials is in use per database, and it is that database's own. Two tabs caught briefly out of step, each showing a different person, are on different databases with different sessions; in the spike neither saw nor uploaded anything of the other's, in all three engines. What happens when the tab holding the connection closes is checked in the slice.

**What it costs.** Only the resting person's data is on a device between visits. Anyone else waits for a fill when they sign in — under a second for this family's data — and cannot sign in offline at all, which is already true: checking a PIN needs the server.

**The installation and the data generation are part of the file's name**, so that a phone pointed at a different server, or a server whose data has been replaced by an import or a restore, never opens a database built from something else ([the cutover protocol](#the-cutover-protocol)).

## The server on Postgres

`lib/server/db.ts` exposes a typed Kysely connection. Each server module that uses the Admin SDK today is rewritten against it, keeping its exported functions so the routes that call it do not change.

- **Finance.** A mutation becomes one transaction that locks the envelope rows it touches — always in the same order, by id, so two transfers in opposite directions cannot deadlock — reads them, checks the invariants, and writes the ledger row and the balance together. It gains one operation, `reconcile` ([money](#money-is-written-only-by-the-server)). The transaction-building in `lib/currency-utils.ts` and `lib/allowance-payout.ts` retires; their pure calculations stay shared. The in-process lock in `lib/finance-mutation-lock.ts` is no longer what protects the ledger. The roadmap's rule against [running more than one instance](../roadmap.md#decided-against) is left standing — presence, below, still assumes one.
- **Messaging.** Thread, membership, reaction and acknowledgement uniqueness move from key lookups to constraints, and an idempotent send becomes an insert that does nothing on conflict.
- **Calendar sync.** One advisory lock per account replaces the lock table, held on a connection taken from the pool for the run and given back when it ends ([designed out](#what-is-designed-out)).
- **Members and PINs.** `lib/instant-admin.ts` splits into a members module that reads Postgres and the session module.
- **Shortcuts, the content queue, exchange rates, the server actions** are direct ports.

The three backfill scripts repair Instant data and are retired with it. The two report scripts are rewritten against the server connection.

## Presence and typing

PowerSync has no equivalent of Instant's rooms. The message screens use one for "who has this thread open" and the typing indicator.

The messaging area gains `useThreadPresence(threadId)`. Behind it is a small in-memory module in the Next server with one route: a device posts a heartbeat while a thread is open, saying whether it is composing, and reads back who else is there, polling every few seconds while the thread is on screen. It is correct for a single app instance, which is what this deployment runs.

## The web client

- **Workers and WebAssembly.** PowerSync's web SDK runs SQLite in a worker. On Next 16 with Turbopack the worker files are copied into `public/@powersync/` by a `postinstall` step, and `next.config.js` gains `turbopack: {}` and `images.disableStaticImages: true` ([Next.js guide](https://docs.powersync.com/client-sdks/frameworks/next-js)). The app imports no static images, so the second setting costs nothing.
- **The connection is a WebSocket**, for now. PowerSync's web SDK defaults to HTTP streaming. In the spike Playwright's WebKit held the start of that stream for twenty seconds, so a first sync, and every reconnection after it, would wait that long; over WebSocket it took under a tenth of a second, and Chromium and Firefox were equally quick either way. That is one engine build on one machine with no proxy in between. It stands until Safari itself has been tried through the real reverse proxy, which confirms it or changes it.
- **A database is opened once per person**, outside React's effects, with the plain `database: { dbFilename, vfs, worker }` options. The SDK's README shows an older form that fails, and opening inside an effect opens it twice in development.
- **The service worker** leaves everything under `/powersync/` alone, since the sync stream shares the app's address, and caches the app's shell and PowerSync's worker and WebAssembly files, so the app can start with no network. In the spike Chromium and Firefox do, from a browser process started offline. Playwright's WebKit does not load the page at all in that test, with or without the extra caching, so whether an iPad starts offline is not known until one is tried.
- **Server rendering.** The SDK does nothing during server rendering. The app's data components are already client components behind the session provider.

### Browsers and devices

**The promise: anyone the app works for today, it works for afterwards.** The family uses it on iPads and iPhones, in Safari, Orion and Firefox. Other people run their own copies on devices nobody here can see. So the bar is not a list of the family's devices; it is whatever runs the app now. That is already defined: Next 16 supports Chrome and Edge 111, Firefox 111 and Safari 16.4 onward ([supported browsers](https://nextjs.org/docs/architecture/supported-browsers)), and the native app requires iOS 15.1. This migration must not raise either floor.

The browser matters because on the web the local database is SQLite running inside the page, and browsers differ in where a page may keep a database, whether its tabs can share one, and when the browser may throw it away. The native app has none of this: it uses the phone's own SQLite.

What matters is the engine, not the name on the icon. There are three:

| Engine | Where | Who |
| --- | --- | --- |
| WebKit | Every browser on an iPhone or iPad — Safari, Orion and Firefox alike — and Safari and Orion on a Mac | The family, mostly |
| Gecko | Firefox on a computer or on Android | The family, wherever Firefox is used off iOS |
| Blink | Chrome, Edge and their relatives, including on Android | Probably other people's copies |

PowerSync supports all three ([supported platforms](https://docs.powersync.com/resources/supported-platforms)). The differences that shape the work:

- **Where the database is stored.** PowerSync offers IndexedDB and several modes built on the browser's private file system. One of the latter, `OPFSCoopSyncVFS`, is the mode it recommends for Safari and iOS and the only one it lists as handling several tabs on every major browser ([web SDK](https://docs.powersync.com/client-sdks/reference/javascript-web)). It is the default here. The choice is made per browser at startup, not once for everyone.
- **Private windows.** The private file system is unavailable in Safari's and Firefox's private windows. The app falls back to IndexedDB there, and if that fails too, to an in-memory database: it works while online, keeps nothing once the page is closed, and says so.
- **Several tabs.** Tabs showing the same person share one database and one connection between them; where PowerSync turns its shared worker off — iOS, Safari and Android — one tab at a time does the syncing and the rest read what it brings. Nothing in the data layer may assume the tab it runs in is the one connected. [One database per person](#one-database-per-person) says what tabs mean for who is signed in.
- **Being put in the background.** iOS suspends a page shortly after it leaves the screen. The sync connection drops and resumes when the app returns, as Instant's does now.
- **The browser clearing storage.** Safari has been reported to clear a site's stored data after a week without a visit, with apps added to the home screen exempt. The write-ups are old and this is checked on real devices rather than assumed. It is the same exposure the app has today with Instant's offline cache. Synced data simply downloads again; only writes not yet uploaded are at risk, so the app asks the browser to keep its storage and the sync badge shows how many changes are waiting.
- **The oldest browsers.** Everything measured so far ran on current engines. The floor — Chrome 111, Firefox 111, Safari 16.4 — has not been tried, and current engines say nothing about it. An iOS 16.4 simulator and one old desktop build of each engine are tried in [Phase 7](#phase-7--the-data-layer-on-powersync).

**A browser that cannot run the app is told so.** A startup check for what PowerSync needs shows a plain screen naming what is missing, instead of a blank page. For someone on an old device this is the difference between a known limit and a mystery.

**How it is checked.** Playwright runs only Chromium today. It gains Firefox and WebKit, and the sync and offline end-to-end tests run on all three, which covers engines the family does not use. Playwright's WebKit is not iOS Safari, so real devices are still needed: an iPad and an iPhone, each in a Safari tab, as a home-screen app and in Orion, and Firefox wherever the family uses it.

**For other people running the app** the larger change is on the server, not the device: their deployment gains Postgres and the PowerSync service, and their reverse proxy one more rule, sending a path to it. The upgrade guide says so first.

## The phone

- `@powersync/react-native` 2.x uses `@op-engineering/op-sqlite` (17.1 or later, below 19) directly. The app already ships native builds, so no capability is lost.
- **One database per person** applies exactly as on the web. The phone has no tabs and its storage is the phone's own, so none of the browser questions arise.
- **The build made before cutover carries both backends**, so that cutover does not depend on every phone installing a new build the same day. That does not happen by itself. Today the phone starts from the configuration it cached last time and refreshes it in the background without acting on any change, so relaunching it would not move it. The build that carries both treats the cached answer as provisional: it starts on it, so it still opens offline; it asks the server again; and if the backend or the data generation has changed it stops, deals with anything it has not sent, and restarts on the new one ([the cutover protocol](#the-cutover-protocol)). A cleanup build removes Instant afterwards.
- **The Expo upgrade in [Scope 0](../roadmap.md#scope-0--dependency-maintenance)** is sequenced against this: either before the slice's phone work or after cutover, never in the same step as the change of sync library. The phone part of the spike, which needs a build installed, says whether Expo 54 is sufficient.

## Infrastructure

Added to `docker-compose.yml`:

- **`postgres`**, with `wal_level=logical`. It holds the app database and a second database for PowerSync's own storage, which is supported on the same server from Postgres 14 ([self-hosted configuration](https://docs.powersync.com/configuration/powersync-service/self-hosted-instances)).
- **`powersync`**, the `journeyapps/powersync-service` image pinned to a version, with its configuration and the sync configuration mounted. PowerSync's guidance for a minimal deployment is 512 MB and one vCPU ([deployment architecture](https://docs.powersync.com/maintenance-ops/self-hosting/deployment-architecture)).
- A daily **compaction** job for PowerSync's storage, which its documentation asks for.
- A nightly **`pg_dump`** with retention, **copied off the machine**. Instant Cloud has been keeping this family's backups; after cutover nobody does unless this job exists, and a dump kept only on the disk it describes is lost with it. **(you)** Say where the copies go.

Postgres gets a replication role for PowerSync with read-only access and a publication named `powersync` listing the synced tables ([source database setup](https://docs.powersync.com/configuration/source-db/setup)).

**A cap on what replication may hold back.** PowerSync reads Postgres through a replication slot, and Postgres keeps its write-ahead log for as long as a slot's reader has not caught up. If the PowerSync service stops for long enough, that log grows until the disk is full and Postgres stops with it — a sync outage becoming a database outage. `max_slot_wal_keep_size` is set, so Postgres drops the slot instead; PowerSync then copies the synced tables afresh when it returns, which at this size is quick.

**Health.** `/api/health` reports the replication slot's lag and the age of the newest dump, so a stalled sync or a missed backup is seen before it matters.

**Devices reach the PowerSync service at a path on the app's own address**, `/powersync/`, which the reverse proxy sends to the service with the prefix removed, WebSocket upgrades passed and response buffering off. It needs no hostname or certificate of its own, and because the browser sees one origin there are no cross-origin rules to get right. This is the arrangement David's other app, Budgeter, runs PowerSync 1.26.1 under behind Caddy; here the proxy is nginx, and the equivalent rule has still to be tried. A staging copy does need a hostname of its own for the app, since a browser keeps storage, the service worker and the activation cookie per address, and staging must not share them with the live app.

New environment variables: `DATABASE_URL`, `DATA_BACKEND`, `POWERSYNC_JWT_PRIVATE_KEY`, `POWERSYNC_JWT_KID`, the two halves of the key's public part, and the `PS_`-prefixed values the PowerSync configuration reads. **Nothing about the backend is compiled into the web build.** One image runs on Instant or on PowerSync, on staging or in production; what differs is read by the server from its environment and from Postgres, and given to the client when it starts. A deployment with no `DATABASE_URL` is on Instant, which is every deployment today, including other people's until they follow the upgrade guide. `DATA_BACKEND=powersync` is read by the server as it runs and, while only part of the app is on PowerSync, sends every page to the part that is. The image runs on Node 24.

**Browsing the data.** The equivalent of Instant's Explorer is any Postgres client. An edit made there reaches devices the same way an Explorer edit does today. PowerSync's own dashboard is not available when self-hosting; its [Sync Diagnostics Client](https://docs.powersync.com/tools/devtools-overview) shows what one token has synced.

## Moving the data

`scripts/migrate/export.mjs` reads every entity through the Admin SDK, page by page, and writes one file per entity. It can only read: the SDK is wrapped so that nothing in the file can reach a write. `scripts/migrate/census.mjs` reports what the export holds against what the schema declares. `scripts/migrate/import.mjs` applies the mapping and loads Postgres in one transaction, and `scripts/migrate/verify.mjs` checks the result. `scripts/migrate/rehearse.mjs` does both against a Postgres that lives only inside the process, for trying an export before there is a database to load it into. A row the new schema cannot hold is never dropped: it is written to a file beside the import's report, with the reason.

The export uses the layout of Instant's own nightly backups, so the import reads either. Someone running their own copy can migrate from a backup downloaded with Instant's CLI and never run the export at all.

**The census** is the export's first use and feeds the schema design:

- every attribute actually stored, against the schema file — this is where the undeclared attributes show up;
- for each attribute, the JavaScript types and, for dates, the string formats present, which decide each column's type and conversion;
- relations whose link and duplicate attribute disagree, and links that point at nothing;
- values that would violate a planned constraint, so each is resolved before the constraint is written;
- row counts and sizes per table, which settled [that history and messages sync in full](#reads-the-sync-configuration).

It was run on 12 October 2026 and its findings are in the log.

Because the schema is redesigned, a row is not expected to look the same after the move, so **verification** is done at five levels. An import and a check that shared one mapping would share its mistakes, so the checks compute what they expect from the export's raw files, without the mapping.

- **Rows.** Counts per table against the export, and for every converted value a round-trip check: the stored `timestamptz` renders back to the instant the original string named.
- **Relations.** For each relation, the ids on each side as the raw export has them, against what a query on Postgres returns: every chore's assignees, every thread's members, every task's series.
- **Money.** Every envelope's balances and every member's transaction count and totals, worked out from the raw export and from Postgres separately, and compared one by one.
- **Behavior.** The [parity suite](#testing): every read in the data layer returns the same result from the Instant implementation over the live data as from the PowerSync implementation over the imported copy.
- **By eye.** **(you)** A short list of things David knows the right answer to — this week's chores, each kid's balance, the last few messages — looked at on staging.

Files in MinIO are not touched. Their URLs are stored as values and cross unchanged.

The scripts and the mapping are documented in the README for other people running the app.

## The cutover protocol

On cutover day every copy of the app has to stop writing to Instant, and none may be left behind still doing so. The copies are not all within reach: a tab left open since last week, a build held in a service worker's cache, a phone in a drawer, a device that is offline with changes it has not sent. Changing a setting on the server does not reach them. This is what does.

**What the server says.** One row in Postgres, `installation`, holds four things. The server gives them to every client through its configuration route — `/api/client-config` on the web, the existing `/api/mobile/config` on the phone — and in a header on every API response:

- the **backend** in use, `instant` or `powersync`;
- the **data generation**, which changes whenever the data under the app is replaced: at cutover, and after any restore;
- the **oldest build** allowed to run;
- whether **writes are frozen**.

**What a client does with it.** It asks at startup, whenever it returns to the foreground, and every minute while it is on screen; and it learns from the header at its next request in any case.

- *Writes are frozen:* mutations refuse, under a banner saying the app is being moved and will be back shortly. This is one check in the data layer, not one per screen. The server's own routes refuse writes too.
- *A newer build is required:* the web app discards its cached files and reloads; the phone says an update is needed.
- *The backend or the generation has changed:* the client stops, deals with what it has not sent, and restarts on what the server now says. A local database made under another generation is never opened.

**Every device reports in.** With each check a device tells the server which build it runs, which backend it is on, who is signed in, how many writes it has not sent, and how old the oldest is. A parent-only page lists every device seen in the last month. "Every device is online and synced" stops being something assumed on the day and becomes a list that is either clear or is not.

On Instant the count comes from a journal the data layer's Instant implementation keeps: a line for each write, removed when Instant confirms it. Instant holds unsent writes itself but offers no way to count or list them. On PowerSync the count is the upload queue.

**The build that understands all this has to be everywhere first.** Today's deployed app knows none of it. So the protocol ships on Instant, weeks ahead, and cutover is not scheduled until every device on the list reports a build that has it — or David has decided that a device no longer matters.

**Writes that miss the move.** A device that was offline through the freeze comes back holding writes Instant will now refuse. The journal is why they are not silently lost: the client shows what they were, and they can be done again by hand. The aim is for the list to show none before the freeze begins.

**Going back.** Until the first real write lands in Postgres, going back costs nothing: turn Instant's read-only mode off and set the backend to `instant` again. So the checks made before the family is let in are read-only — sign in, look at every screen, compare the numbers the verification printed. Then the freeze is lifted for David's own session alone, for write checks made on a member and a chore created for the purpose and deleted afterwards. Only then is it lifted for everyone, and from that moment the way is forward.

**After a restore from backup** the same machinery applies. The generation changes, every client discards its local database and fills again, and anything a device had not sent is shown to its owner, since the server it was written against no longer exists in that form.

## Working on main while this is in flight

`main` stays deployable on Instant throughout. Which implementation runs — of the data layer, the server's services and the session module — is decided when the app starts, from what the server says, so the same image runs on PowerSync in a staging deployment. There is no long-lived branch.

The rules for other work change as the scope advances:

- **Until an area is converted in Phase 1**, work on it as today.
- **Once an area is converted**, its screens reach data only through its hooks and mutations. A new read or write is added to the area's API, not to a component.
- **Once an area has its PowerSync implementation in Phase 7**, a change to that area's API is made in both implementations in the same commit — the typecheck fails otherwise — and a schema change is an edit to `instant.schema.ts`, a SQL migration and a mapping entry together.
- **A change to `instant.perms.ts`** is also made in the write policy, with a behavioral case, from Phase 5 on.
- **Nothing new reaches Instant directly.** `test/contracts/instant-boundary.contract.node.test.ts` lists every file that still does. No file may join the list, a converted file must leave it, and a converted area's entities may not be queried or written outside the data layer by any file, listed or not. The list tracks files, so a file already on it can still gain a query for an area that has not been converted; that gap closes as areas convert, and at cleanup the list is empty and the rule becomes a ban on the import.

The third rule is real double work, so the gap between Phase 7 and cutover should be kept short and light on data-model changes.

## Testing

- **The data layer** is tested per area against PowerSync's Node SDK, opened on a temporary file and never connected. It carries the real client schema, and its upload queue shows exactly what each mutation would send, so a test asserts both what the device now holds and what the server will be asked to apply. The suite still needs no running services.
- **The parity suite** runs each area's reads through both implementations — Instant over recorded live results, PowerSync over the imported copy — and compares the whole result, field by field. It is what makes "every screen still gets the data it expects" a test run instead of a manual tour.
- **The write policy** is tested by behavior, table by table, as set out under [the write rules](#the-write-rules). Cases that need one connection run against PGlite, an in-process Postgres reached through the ordinary driver.
- **The upload route** has integration tests for acceptance, refusal, atomic rollback, an unknown table or column, a `PUT` over an existing row, a retry after a commit with another device's write in between, an ended session, and the `5xx` path.
- **Sessions and databases**: changing person with writes waiting; signing a parent out with no network; what a draining session may and may not do; a session that ends with a queue; two tabs on one person and on two; and the tab holding the connection being closed.
- **The server services** run their existing integration suites against PGlite. It is a single connection, so whatever needs two — two uploads racing for a row, transfers in opposite directions, the same payout sent twice — runs against the real Postgres in the compose profile.
- **Through the real sync service**, without a browser: `npm run test:sync:live` starts a throwaway Postgres and the PowerSync service in Docker and runs real devices against them through the app's real routes, including two uploads racing for one row.
- **End to end**, `npm run test:sync:e2e`: Playwright runs the production build against the same throwaway stack, in Chromium, Firefox and WebKit. A case that needs a fresh start gets a new browser process, and a navigation that fails is a failure.

**What the suite cannot show.** The stand-in for Instant that the data layer's tests use answers every query and refuses nothing: it has no permissions, no uniqueness and no ordering. It tests the adapter's own logic and says nothing about Instant. Playwright's WebKit is not Safari, and current engines are not the oldest supported ones. These are why the checks marked **(you)** exist, and why the slice is run on real devices before anything is built on it.

Of today's 153 test files, the 17 that mock `@/lib/db` are rewritten to mock the area's hooks and mutations as each area is converted, and the 10 that mock `@/lib/instant-admin` follow the server modules. The two contract suites guard `instant.perms.ts` until it is deleted and go with it; the live suite is ported.

## Phases

Each phase ends with typechecks, the test suite and a production build passing. Items marked **(you)** need David's devices or his infrastructure.

The order is Phase 0, the start of Phase 1, then Phase 2. Phase 2 exists to change what follows it: every later phase is provisional until the slice has run and this document has been revised from it. After that, Phases 1 and 3 to 6 do not wait on one another beyond what is noted, and Phase 7 needs all of them.

### Phase 0 — The spike

A throwaway branch. Its only output is findings written into this document's log, and the revisions to later phases that follow from them. **Done, except S2 and the checks marked (you); the log has the findings.**

- **S1 — Web.** PowerSync's web SDK in this Next 16 app under Turbopack, in development and in the standalone Docker build, with the service worker caching its assets. Run it in Chromium, Firefox and WebKit under Playwright, in ordinary and private windows, with two tabs open. **(you)** Open it on an iPad and an iPhone — in a Safari tab, as a home-screen app, and in Orion — and in Firefox wherever the family uses it: does it load, work offline, start with no network, and survive being closed and reopened? Leave one untouched for eight days and say whether its data is still there.
- **S2 — Phone.** `@powersync/react-native` with op-sqlite on Expo 54 and the New Architecture. **(you)** Install the build.
- **S3 — Service.** The self-hosted service with Postgres storage on the same server; `edition: 3` and the timestamp text a device actually receives; a token signed with an inline public key; a stream filtered by `auth.parameter('type')`; messaging membership through a join; a join table with a composite key and a built `id`.
- **S4 — Latency.** Time from a write on one device to its appearance on another, and replay of writes queued offline. PowerSync publishes no figure, so this is measured.
- **S5 — The query layer.** The chore-day read and the complete-a-chore write, written three ways: Kysely, Drizzle, and plain SQL strings. For the read, both a single joined statement and flat queries assembled in memory. It ran on generated data in a browser and on Node; the real data and a phone are left to the slice.
- **S6 — Switching principal.** Swap tokens without clearing the local database. It showed that approach to be fragile, and the review replaced it with [one database per person](#one-database-per-person).
- **S7 — Refusal.** A refused upload answered with `200`, and the local revert. Confirm a `PATCH` lists only changed columns, which the kid-safe rules depend on.
- **S8 — Test tooling.** Choose the in-memory SQLite and in-process Postgres used by the suite.
- **The review's experiments.** A database per person; two people in two tabs; a hostile `PUT`; two claims for one chore; a retry after a lost answer; a start with no network in a fresh browser process.

### Phase 1 — The data layer, over Instant

On `main`, Instant still the only backend.

For each area, in this order — family and settings first, because it is small and sets the pattern; dashboards last, because they mostly consume other areas' reads:

1. Family and settings
2. Chores, routines and the countdown
3. Task series
4. Calendar
5. Finance
6. Messaging, including `useThreadPresence`
7. History
8. Content
9. Dashboards

the work is the same:

- Design the area's types, reads and mutations for the relational end state, and write them down in the area's `types.ts`.
- Implement them over Instant, moving the area's query objects and transaction-building out of its components.
- Move every screen in the area, web and phone, to the hooks and mutations.
- Rewrite the area's tests against the new API.
- **(you)** Look over the area's screens on the live app.

**Paused after the first area.** Settings, units and reading the family roster are done. The rest of family and settings, and every other area, waits for Phase 2, so that no more of the API is fixed before it has run on the backend it is for.

Also in this phase: the session module over Instant, replacing `db.useAuth()` in components.

Done when no file outside the data layer's Instant implementation, the session module and the server's Instant modules imports `@instantdb/*` or builds a query.

### Phase 2 — One slice, end to end

One feature on PowerSync, on a staging deployment, on a copy of the family's real data, built with the code that will ship and not a prototype of it. It is thin on purpose and complete on purpose: every layer the finished app has, for a few tables.

**What is in it.** Reading the household settings, the units and the family roster, which the data layer already has. Reading a day's chores. Completing a chore, undoing that, and claiming one that is up for grabs. Settings are the simple case. Completing a chore is the one that matters: it is the app's most common write, it is made offline, a kid may do it only for themselves, and two kids can claim the same chore at once.

**What that takes**, each piece in the form the later phases extend:

- The tables those reads and writes touch, as migrations, with their part of the mapping and the import, loaded from the export already taken. *Done on 12 October 2026.*
- Postgres and the PowerSync service in a compose profile for staging, with the setup of keys, roles and the publication. *Done on 12 October 2026, and run locally; not yet on David's server.*
- The app's own sessions for the kid, shared-kid and parent principals; the token route; and [one database per person](#one-database-per-person), with switching, the resting database and draining. *Done on 13 October 2026, below the screen.*
- The `family` stream for those tables, and the refusal streams. *Done.*
- The upload route [as specified](#writes-the-upload-endpoint) — the list of what may be written, the row lock, the record of uploads, the stored outcome — and the write rules for those tables. *Done.*
- The data layer's PowerSync implementation for settings, units, the roster and the chore day, beside the Instant one; and the chore day's types and mutations, designed with both in view. *Done, with the history tables a completion needs; the chore day over Instant waits for Phase 1 to resume.*
- The web provider: worker files, storage chosen per browser, the connection, the configuration route that says which backend to use, the sync badge and the list of refusals. *Done at `/sync`, and run in three browsers; not yet seen by David.*
- The same on the phone, in a development build. **(you)** Install it.
- **(you)** One staging hostname over HTTPS, with `/powersync/` on it sent to the PowerSync service. A browser allows the storage and the service worker this needs only on a secure address, and staging needs an address of its own so that it shares nothing with the live app.

Everything else in the app is absent from staging until its area arrives in Phase 7. The slice has the real settings screens and a plain chore-day screen of its own.

**What it must show**, as automated tests wherever a machine can run them:

- A completion made on one device appears on another, made online and made offline.
- A kid cannot complete for someone else, award allowance, or overwrite a completion by sending its id as though it were new.
- Two kids claim one chore offline: one holds it and the other is told.
- An upload whose answer is lost is not applied twice, with another device's write in between.
- A parent signs in over a kid, writes while offline, and is signed out: the kid's screen holds nothing of the parent's, the parent's write uploads as the parent when the network returns, and the parent's database is then gone.
- A session ends with writes waiting: they are kept, shown, and sent when that person signs in again.
- Two tabs, on one person and on two; and the tab holding the connection is closed.
- The chore day for a set of real dates matches what the live app shows. **(you)** Compare a few by eye.
- **(you)** On an iPad and an iPhone, in Safari, as a home-screen app and in Orion: it loads, syncs, works offline, and starts with no network.

**Done when** those pass, David has used it on his own devices, and the later phases of this document have been revised from what building it showed. If the design is wrong somewhere, this is the cheap place to find out.

### Phase 3 — The schema and the data

- The export script and the census, run against the live app, read-only. *Done on 12 October 2026.*
- The rest of the schema, as SQL migrations, following [the design rules](#design-rules), with the mapping file complete, a delete rule chosen for every relation. *Done on 13 October 2026: 55 tables in eleven migrations, 45 of them sent to devices.*
- Postgres and PowerSync in the production `docker-compose.yml`, with the cap on replication, the health report, the nightly dump and its copy off the machine.
- The client schema and its indexes, for every table. *Done with each table. The indexes are chosen from how each table will be read, not yet from the plans of real reads, which come with [Phase 7](#phase-7--the-data-layer-on-powersync).*
- The import script for everything, and [verification at all five levels](#moving-the-data). *Done for rows, relations and money: the live export imports and all 102 checks pass. Behavior comes with the parity suite in Phase 7, and by eye is David's, on staging.*
- **(you)** `/powersync/` on the app's address sent to the PowerSync service by the reverse proxy, and somewhere off the machine for backups.

Any design choice that would change what the app does, as opposed to how it stores it, is asked of David first.

Done when a fresh import of the live data verifies clean.

### Phase 4 — Identity

The slice's sessions, extended to everything that authenticates.

Built in the slice: `auth_sessions` with its three states, signing in and out, the sync token, `has_pin`, and the session manager with its tests. What is left:

- Every route that verifies an Instant token today — finance, messages, files, calendar sync — authenticates against `auth_sessions` instead, and the six `instant-auth-*` routes go.
- The same routes for the phone. A phone proves it is an activated device with a token in `Authorization`, where the web has a cookie, and the middleware lets only the routes under `/api/mobile/` through on that. The session, sync and configuration routes have to be reachable by it too.
- The server route that sets a PIN, and a parent ending someone's sessions on every device, which the server can already do and nothing yet asks for.
- A screen for what is waiting for someone to sign in. The slice shows it as a notice.

Done when the parent-elevation, idle sign-out and device-auth tests pass on both backends.

### Phase 5 — Sync and the write rules

The slice's streams, upload route and rules, extended to every table.

Built in the slice: the `family` stream and the two for refusals; the upload route; and the policy, with its tests, for the tables the slice has. Adding a table is now a fixed list of small things, each held to the others by a test: a migration that also adds it to the publication, its columns in the stream, its table in the device's schema, its entry in the policy with a case for each kind of person, and its part of the mapping and the verification. What is left:

- The two messaging streams.
- The policy for every other table a device may write, with [a behavioral case for every cell of Appendix B](#the-write-rules) and for each way a device can lie or be late.
- The live permission matrix, ported.
- Pruning of the upload record.

Done when every case passes against a real Postgres.

### Phase 6 — The server on Postgres

- `lib/server/db.ts`; finance as locked transactions, with `reconcile`; messaging on constraints; calendar sync on advisory locks; members and PINs; shortcuts, the content queue, exchange rates, the server actions.
- The report scripts rewritten; the backfill scripts removed.

Done when the integration suites for those areas pass on Postgres, the concurrency cases among them on the real one.

### Phase 7 — The data layer, on PowerSync

The slice built this for settings, units, the roster's reads and the chore day, and built what every area stands on: typed SQL, live reads that see one moment, mutations that ask the rules first and name their transactions, and the browser client. For each remaining area, in the Phase 1 order:

- Its queries and mutations in SQL, behind the same interface.
- The area's parity cases, recorded from Instant and compared.
- **(you)** Look over the area's screens on staging.

Also in this phase: the service worker caching PowerSync's files; the storage-persistence request; the screen for a browser that cannot run the app; Firefox and WebKit added to Playwright; the oldest supported browsers tried; presence's server module; and the moves [the money rule](#money-is-written-only-by-the-server) requires in the finance screens.

Done when the staging deployment runs the whole app on an imported copy of the live data and the parity suite passes.

### Phase 8 — Rehearsal and cutover

**The readiness build**, on Instant, deployed weeks ahead ([the cutover protocol](#the-cutover-protocol)): the configuration checks, the freeze, device check-ins and the parent's list of devices, the journal of unconfirmed writes, and on the phone both backends. Production gains Postgres at this point, holding only the `installation` row and the check-ins.

- **(you)** Install that phone build on every phone.

**Rehearsal**, on staging, against a self-hosted Instant loaded from a backup of the live app — new Instant Cloud apps cannot be created, and this is also most of [the fallback](#why-and-by-when), done once for real:

- The whole cutover below, start to finish, timed, with a tab left open on the old build, a device offline through the freeze, and a device holding unsent writes.
- A restore of the nightly dump into an empty Postgres, with PowerSync started against it and devices that hold older local databases: they must discard them, fill again, and show anything they had not sent.
- **(you)** Use staging on the family's real devices for a few days: chores, a countdown run, a message thread, an allowance payout, offline and back.

**Cutover**, on a quiet day:

1. The list of devices is clear: each on the readiness build, none holding unsent writes.
2. Freeze writes. Then turn on read-only mode for the app in the Instant dashboard — the stop for anything that did not hear the freeze — and wait 30 seconds.
3. Export, import, verify.
4. Set the backend to `powersync` and advance the data generation. Open clients restart on it, and phones at their next check.
5. Read-only checks on each kind of device; then write checks from David's session alone, on a member and a chore made for the purpose and deleted after. **Until a real write lands, going back is free** — turn read-only off and set the backend back.
6. Lift the freeze. After that, fix forward: going back would discard everything written since.

Keep the Instant app read-only and untouched until the August deadline, and download a final backup. **(you)**

### Phase 9 — Cleanup

- Delete every Instant implementation in the data layer and on the server, and with them the seam between implementations, the journal of unconfirmed writes and the choice of backend; the Instant packages, `instant.schema.ts`, `instant.perms.ts` and the suites that guard it, the `instant-auth-*` routes and the MMKV store.
- Rewrite `CLAUDE.md` and `AGENTS.md`, which currently instruct every agent to build on InstantDB.
- Rewrite the README's setup, add the upgrade guide for other people running the app, state the supported browsers and devices, and note the PowerSync licence.
- Update the reference documents in `docs/`.
- Close the roadmap items this makes moot: the hosted `choreManualStarts` deletion and the undeclared calendar attributes.
- Ship the phone build without Instant.

Done when a search of the repository for `instant` finds only history: this document, the audits and the changelog of what was removed.

## Risks

| Risk | What limits it |
| --- | --- |
| A browser that runs the app today cannot run PowerSync's web SDK reliably | All three engines run it under Playwright. What Playwright cannot settle — an iPad starting with no network, Safari's stream delay, storage surviving a week — is checked on the family's devices in the slice, before anything is built on top. If WebKit fails there the plan is reconsidered |
| Someone running their own copy is on a browser nobody tested | The floor stays where Next 16 already puts it and is tried once in Phase 7, the storage mode falls back twice, and a browser that still cannot run the app is told why |
| The data layer's API is shaped by Instant without anyone noticing | One slice runs on PowerSync, end to end, before the other areas are converted |
| Rewriting every screen's data access introduces regressions | Done one area at a time on the live app, each with rewritten tests and David's look, before the backend changes at all |
| The PowerSync implementation of a read differs from the Instant one | The parity suite compares them over the real data, read by read, field by field |
| A redesigned column loses or alters a value | The census resolves every odd value before its constraint exists; conversions are round-trip checked; relations and money are checked from the raw export, independently of the mapping; Instant is kept intact afterwards |
| A rule is translated wrongly and a kid can write what they should not | Behavioral cases for every rule and for hostile uploads, against a real Postgres; the upload route judges by the server's state and writes only listed tables and columns |
| One person's writes are uploaded as another, or a kid is shown a parent's data | A database per person, opened only with that person's session |
| A retried upload undoes newer work | Every uploaded transaction is recorded once, in the transaction that applies it |
| A device goes on writing to Instant after cutover, or loses writes it had not sent | The cutover protocol: every device reports its build and its unsent writes beforehand, writes are frozen, stale clients restart, and Instant's read-only mode stops the rest |
| PowerSync stops and Postgres fills its disk keeping the log for it | The cap on what a replication slot may hold back, and the health report |
| The server's disk is lost | The nightly dump is copied off the machine, and a restore is rehearsed with PowerSync and real clients |
| Both implementations must be kept in step late in the work | The typecheck enforces the shared interface; Phase 7 is kept short |
| The work overruns the deadline | The 31 May 2027 trigger for self-hosting Instant, most of which the rehearsal will already have done |
| PowerSync changes its terms or stops | The data is in plain Postgres and the client libraries are Apache-2.0; released service versions become Apache-2.0 after two years |
| Sync Streams prove immature | PowerSync's older Sync Rules format can express the same partitions |

## Alternatives considered

Recorded so they are not reopened by accident. Checked 11–12 October 2026.

- **A compatibility layer reproducing Instant's query and transaction API on PowerSync.** It would have left the screens untouched and made the job much smaller. Rejected by David on 12 October 2026: the result would be an app permanently shaped by a database it no longer uses.
- **Zero (Rocicorp).** The closest to Instant in feel. Its documentation says offline writes are unsupported ([connection status](https://zero.rocicorp.dev/docs/offline)), which rules it out.
- **Convex.** No official offline sync; its own alpha has an open issue asking whether it is shelved ([issue](https://github.com/get-convex/curvilinear/issues/6)).
- **Electric with TanStack DB.** Workable, but Electric only syncs downward, so the write queue, its persistence and the phone's storage are assembled from separate, younger pieces.
- **Pylon.** The nearest API to Instant, with a migration guide. The repository was under six months old with one contributor ([repository](https://github.com/pylonsync/pylon)) — the same risk this migration exists to escape.
- **Self-hosted Instant.** Kept as the fallback above, not chosen as the destination: nobody has committed to maintaining it after the shutdown.

---

## Appendix A — What has to be carried

One row per entity in `instant.schema.ts` on `a4aed13`, under its Instant name. This is the input to the schema design, not the design: names, types and several structures change, per [the schema](#the-schema). "Link columns" are the relations with a "one" side; † marks one that is also stored as a plain attribute. "Referenced by" is where the entity's name appears in code; an entity read only as a nested relation, such as `messageReactions`, shows fewer places than actually read it.

| Entity | Attributes | JSON columns | Booleans | Date-typed | Link columns (→ target) | Unique | Referenced by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `allowanceEnvelopes` | 7 | `balances` | 1 | — | `familyMemberId` → familyMembers | — | web, mobile, server |
| `allowanceTransactions` | 9 | — | — | — | `destinationEnvelopeId` → allowanceEnvelopes<br>`envelopeId` → allowanceEnvelopes<br>`sourceEnvelopeId` → allowanceEnvelopes | `distributionKey` | web, mobile |
| `announcements` | 9 | — | 1 | — | — | — | web, server |
| `calculatedAllowancePeriods` | 9 | — | 1 | `lastCalculatedAt`, `periodEndDate`, `periodStartDate` | `familyMemberId` → familyMembers † | — | nothing |
| `calendarItems` | 49 | `alarms`, `attendees`, `conferenceData`, `exdates`, `organizer`, `rdates`, `recurrenceLines`, `xProps` | 2 | — | — | `sourceExternalId`, `uid` | web, mobile, server |
| `calendarSyncAccounts` | 19 | `selectedCalendarIds` | — | — | — | — | server |
| `calendarSyncCalendars` | 14 | — | 1 | — | — | — | server |
| `calendarSyncLocks` | 4 | — | — | — | — | `key` | server |
| `calendarSyncRuns` | 17 | `details` | — | — | — | — | server |
| `calendarTags` | 4 | — | — | — | — | `normalizedName` | web, mobile |
| `choreAssignments` | 1 | — | — | — | `familyMemberId` → familyMembers<br>`choreId` → chores (cascade) | — | web |
| `choreCompletions` | 5 | — | 3 | — | `markedById` → familyMembers<br>`choreId` → chores (cascade)<br>`completedById` → familyMembers | — | web, mobile |
| `chores` | 30 | `advanceCompletionLimit`, `allowExtraDays`, `area`, `canCompleteInAdvance`, `canCompletePast`, `difficultyRating`, `dueTimes`, `exdates`, `imageUrl`, `pastCompletionLimit`, `pauseState`, `timingConfig` | 4 | — | — | — | web, mobile, server |
| `contentAttachments` | 15 | `waveformPeaks` | — | — | `announcementId` → announcements<br>`contentQueueItemId` → contentQueueItems<br>`familyRuleVersionId` → familyRuleVersions | — | web |
| `contentCategories` | 6 | — | 1 | — | — | `slug` | web, server |
| `contentQueueItems` | 11 | — | — | — | `categoryId` → contentCategories (cascade)<br>`createdById` → familyMembers | — | web, server |
| `countdownRuns` | 13 | `skippedChoreIds` | — | — | — | — | web, mobile |
| `dashboardConfigs` | 4 | `disabledWidgets`, `widgetOrder`, `widgetSettings` | — | — | `familyMemberId` → familyMembers (one-to-one) | — | web |
| `deviceSessions` | 10 | — | — | — | — | `deviceId` | nothing |
| `exchangeRates` | 5 | — | — | `lastFetchedTimestamp` | — | `pairKey` | web, server |
| `familyDashboardLayouts` | 8 | — | 1 | — | — | `breakpointKey` | web |
| `familyDashboardWidgets` | 9 | `config` | — | — | `layoutId` → familyDashboardLayouts (cascade) | — | web |
| `familyMembers` | 21 | `allowanceConfig`, `photoUrls` | 3 | `allowanceStartDate` | — | — | web, mobile, server |
| `familyRules` | 6 | — | 1 | — | — | — | web |
| `familyRuleVersions` | 5 | — | — | — | `ruleId` → familyRules (cascade)<br>`previousVersionId` → familyRuleVersions (one-to-one) | — | web |
| `gradeTypes` | 11 | `steps` | 1 | — | — | — | web, mobile |
| `historyEventAttachments` | 15 | `waveformPeaks` | — | — | `eventId` → historyEvents | — | web, server |
| `historyEvents` | 16 | `metadata` | — | — | `actorId` → familyMembers<br>`messageId` → messages (one-to-one) † | — | web, mobile |
| `messageAcknowledgements` | 5 | — | — | — | `familyMemberId` → familyMembers †<br>`messageId` → messages † | `ackKey` | server |
| `messageAttachments` | 15 | `waveformPeaks` | — | — | `messageId` → messages | — | web, server |
| `messageReactions` | 5 | — | — | — | `familyMemberId` → familyMembers †<br>`messageId` → messages † | `reactionKey` | server |
| `messages` | 15 | `metadata` | 1 | — | `authorId` → familyMembers<br>`replyToId` → messages<br>`threadId` → messageThreads † | — | web, mobile, server |
| `messageThreadMembers` | 12 | — | 2 | — | `familyMemberId` → familyMembers †<br>`threadId` → messageThreads † | `membershipKey` | web, mobile, server |
| `messageThreads` | 15 | — | 1 | — | — | `threadKey` | web, mobile, server |
| `pushDevices` | 5 | — | 1 | — | `familyMemberId` → familyMembers † | `token` | server |
| `routineMarkerStatuses` | 7 | — | — | — | — | `key` | web, mobile |
| `routines` | 4 | — | — | — | — | — | web, mobile |
| `routineSteps` | 1 | — | — | — | `choreId` → chores (cascade)<br>`routineId` → routines (cascade) | — | web, mobile |
| `settings` | 2 | — | — | — | — | — | web, mobile, server |
| `shortcutTokens` | 9 | — | — | — | — | `tokenHash` | server |
| `taskAttachments` | 15 | `waveformPeaks` | — | `createdAt`, `updatedAt` | `taskId` → tasks (cascade) | — | web, mobile, server |
| `taskResponseFields` | 8 | — | 1 | — | `taskId` → tasks (cascade) | — | web, mobile |
| `taskResponseFieldValues` | 8 | — | — | — | `fieldId` → taskResponseFields (cascade)<br>`updateId` → taskUpdates (cascade) | — | web, server |
| `tasks` | 19 | — | 5 | `completedAt`, `createdAt`, `updatedAt` | `parentTaskId` → tasks<br>`taskSeriesId` → taskSeries | — | web, mobile |
| `taskSeries` | 15 | — | 1 | `breakStartDate`, `createdAt`, `plannedEndDate`, `startDate`, `targetEndDate`, `updatedAt` | `familyMemberId` → familyMembers<br>`scheduledActivityId` → chores | — | web, mobile |
| `taskUpdateAttachments` | 15 | `waveformPeaks` | — | — | `updateId` → taskUpdates (cascade) | — | web, server |
| `taskUpdates` | 11 | — | 2 | — | `actorId` → familyMembers<br>`affectedPersonId` → familyMembers<br>`gradeTypeId` → gradeTypes<br>`replyToId` → taskUpdates<br>`taskId` → tasks (cascade) | — | web |
| `timeOfDayDefinitions` | 3 | — | — | — | — | — | nothing |
| `unitDefinitions` | 7 | — | 2 | — | — | `code` | web, mobile |

The five many-to-many links, which become join tables:

| Link | Between |
| --- | --- |
| `calendarItemsPertainsTo` | `calendarItems.pertainsTo` ↔ `familyMembers.calendarItems` |
| `calendarItemsTags` | `calendarItems.tags` ↔ `calendarTags.calendarItems` |
| `familyMembersAffectedHistoryEvents` | `familyMembers.affectedHistoryEvents` ↔ `historyEvents.affectedFamilyMembers` |
| `familyMembersAssignedChores` | `familyMembers.assignedChores` ↔ `chores.assignees` |
| `tasksPrerequisites` | `tasks.prerequisites` ↔ `tasks.subsequentTasks` |

## Appendix B — The write rules today

`instant.perms.ts` on `a4aed13`, grouped, under Instant's names. The write policy starts from these, on the new tables and columns; [the write rules](#the-write-rules) lists the four places where it is deliberately stricter. "Family" means any signed-in principal, parent or kid.

**Family reads, parents write** (23): `announcements`, `calculatedAllowancePeriods`, `calendarItems`, `calendarSyncCalendars`, `calendarTags`, `choreAssignments`, `chores`, `contentAttachments`, `contentCategories`, `contentQueueItems`, `deviceSessions`, `exchangeRates`, `familyDashboardLayouts`, `familyDashboardWidgets`, `familyRules`, `gradeTypes`, `routineMarkerStatuses`, `routines`, `routineSteps`, `settings`, `taskSeries`, `timeOfDayDefinitions`, `unitDefinitions`. `calendarSyncCalendars` stops syncing, so its rule becomes "server only"; `calculatedAllowancePeriods`, `deviceSessions` and `timeOfDayDefinitions` are not carried.

**Family reads and writes** (6): `dashboardConfigs`, `taskAttachments`, `taskResponseFieldValues`, `tasks`, `taskUpdateAttachments`, `taskUpdates`.

**Append-only**: `familyRuleVersions` — a parent may insert; nobody updates or deletes. `historyEventAttachments` — family may insert; nobody updates or deletes.

**`taskResponseFields`**: parents insert, update and delete. The link rule that lets family attach values is covered by `taskResponseFieldValues` being family-writable.

**Server only, no device access**: `calendarSyncAccounts`, `calendarSyncLocks`, `calendarSyncRuns`, `pushDevices`, `shortcutTokens`.

**Messaging, read by membership, written only by the server**: `messageThreads`, `messageThreadMembers`, `messages`, `messageAttachments`, `messageReactions`, `messageAcknowledgements`. Every client write is refused today and stays refused.

**Rules that depend on who you are:**

| Entity | Parent | Kid |
| --- | --- | --- |
| `familyMembers` | Insert, update, delete | Update their own row, and only `lastDisplayCurrency`, `viewShowChoreDescriptions`, `viewShowTaskDetails`, `messageQuietHoursEnabled`, `messageQuietHoursStart`, `messageQuietHoursEnd`, `messageDigestMode`, `messageDigestWindowMinutes` |
| `allowanceEnvelopes` | Insert, update, delete | Update an envelope they own, and only `name`, `description`, `goalAmount`, `goalCurrency`, `isDefault` |
| `choreCompletions` | Insert, update, delete | Insert with `allowanceAwarded` false. Update a completion they completed, and only `completed`, `notDone`, `dateCompleted`. The completer and the marker may only be set to themselves |
| `countdownRuns` | Insert, update, delete | Insert a run whose `familyMemberId` is theirs. Update their own run, and only `routineId`, `status`, `currentChoreId`, `stepStartedAt`, `stepExtensionSecs`, `stepExtensionCount`, `skippedChoreIds`, `lastInteractionAt`, `startedAt`, `stoppedAt`, `stoppedReason` |
| `historyEvents` | Insert | Insert an event whose actor is themselves. Nobody updates or deletes |
| `allowanceTransactions` | Insert with `createdBy` equal to their principal; delete | Insert with `createdBy` equal to their principal. Nobody updates |

A kid session with no family member id — the shared kid principal — fails every "their own" test, as it does today.

**What changes at cutover.** The `allowanceTransactions` row goes: no device inserts or deletes a ledger row. On an envelope a device changes only the name, description and goal — a parent on any envelope, a kid on their own — and no longer creates or deletes one or writes a balance ([money](#money-is-written-only-by-the-server)). Which envelope is the default moves from `isDefault` on the envelope to a column on the member, which a parent may set for anyone and a kid for themselves, as each may today. And no update, by a parent or a kid, changes who completed a completion that stands.

Instant checks a `link` separately from the row it joins; in a relational schema the link is a column on a row, so each link rule becomes a rule on the value written to that column. The column-by-column table is produced in Phase 5, with a behavioral case for every cell.
