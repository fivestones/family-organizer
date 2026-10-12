# Moving from InstantDB to PowerSync

**Date:** 2026-10-12
**Status:** Planned. Nothing is built. Phase 0 (the spike) and Phase 1 (the data layer) can start now; every later phase is provisional until the spike's findings are written into this document.
**Roadmap:** [Scope 7](../roadmap.md#scope-7--the-move-to-powersync).
**Measured against:** commit `a4aed13`. The counts below were taken from the code on that commit, not estimated.

---

## Implementation log

Record each completed phase here, newest first, in the prose style the audits use: what was built, what the work showed the plan had wrong, and what was left.

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

**The fallback, and the date it triggers.** Self-hosting Instant is a configuration change: both clients already accept a custom API and WebSocket address, and Instant publishes a [migration guide](https://www.instantdb.com/docs/self-hosting/migrate). If the cutover rehearsal ([Phase 7](#phase-7--rehearsal-and-cutover)) has not passed by **31 May 2027**, self-host Instant first so the August deadline cannot be missed, then finish this plan without it hanging over the work.

## Decisions

Settled with David on 11–12 October 2026.

1. **PowerSync, self-hosted, with Postgres.** The server component is the PowerSync Open Edition; the client libraries are Apache-2.0.
2. **Ahead of the unfinished product work.** Scope 7 comes before Scopes 4–6.
3. **Other people run this app.** The repository has forks, so the export and import are a documented, supported script. Both backends are not supported long-term: after cutover Instant is removed.
4. **Offline scope stays as it is.** Money mutations, sending messages and parent PIN elevation stay online-only. Making them work offline is a separate piece of design.
5. **One switch.** Nearly every entity links to `familyMembers`, so the data cannot live half in one backend and half in the other. Cutover is a short read-only window, a final import, and a flag flip.
6. **One Postgres, no MongoDB.** Postgres and the PowerSync service join the existing compose file. PowerSync keeps its own bookkeeping in a second database on the same server.
7. **Built for PowerSync, not adapted to it.** The finished app reads as though it had been written for PowerSync and Postgres from the start. There is no compatibility layer, and nothing keeps a shape only because Instant gave it that shape. [What that means here](#the-finished-app) is spelled out below.

Made in this plan, and open to revision by the spike:

8. **One data layer, shared by the web and the phone.** Each feature area has typed queries and mutations in a shared package. Screens call those; they contain no SQL and no query objects.
9. **Typed SQL, with Kysely, on the device and on the server.** PowerSync is SQL-first and has an official driver for it. The spike compared it with Drizzle and with plain SQL strings: speed was the same, Kysely needs one schema definition where Drizzle would need two, and it is the same builder on both sides.
10. **SQL migrations are the source of truth for the schema.** There is no schema file in application code that the database is derived from.
11. **The scaffolding faces Instant, and is thrown away.** To keep `main` shippable, the data layer is first implemented over Instant, then natively over PowerSync. The Instant implementation is deleted at cleanup. See [how the app gets there](#how-the-app-gets-there).
12. **The app owns its sessions.** Instant's tokens are replaced by session tokens this server issues and can revoke, plus short-lived signed tokens for PowerSync.
13. **The write rules are one file, shared.** The same rule code runs on the device, for an immediate answer, and on the server, where it is authoritative. Anything not listed is denied.
14. **Both backends live in `main` behind a flag** until cutover, rather than on a long-lived branch.

**Licence.** The PowerSync service is under the Functional Source License: source-available, free to self-host and modify, not to be resold as a competing sync service, and each release becomes Apache-2.0 after two years ([licence text](https://github.com/powersync-ja/powersync-service/blob/main/LICENSE)). It runs as a container this project pulls, so the repository stays MIT. The README should say that one runtime dependency is source-available rather than open source ([Phase 8](#phase-8--cleanup)).

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

The schema is designed, not transliterated. [Appendix A](#appendix-a--what-has-to-be-carried) lists what has to be carried; the design is produced in [Phase 2](#phase-2--the-schema-and-the-data) once the census of live data is in hand, because several type decisions depend on what is really stored.

### Design rules

- **Names** are `snake_case`, tables plural: `chore_completions.date_due`. Unquoted lower-case identifiers are also what PowerSync's sync queries handle without ceremony ([case sensitivity](https://docs.powersync.com/sync/advanced/case-sensitivity)).
- **Ids** are `uuid`, generated on the device, as PowerSync recommends for rows a client creates ([client id](https://docs.powersync.com/sync/advanced/client-id)).
- **An instant is `timestamptz`; a calendar day is `date`.** Today 87 attributes hold dates as strings, 13 as epoch numbers and 16 use Instant's date type. With `edition: 3` in the sync configuration PowerSync sends timestamps to devices as ISO 8601 text ([compatibility](https://docs.powersync.com/sync/advanced/compatibility)), so the rule end to end is: `timestamptz` in Postgres, ISO 8601 text on the device, an ISO string in the app's types.
- **A boolean is `boolean`, a count or position `integer`.** Devices receive booleans as 0 and 1; the data layer's row mappers turn them back.
- **Money stays `double precision`.** Four ledger rows hold sub-cent amounts and the roadmap [decided against](../roadmap.md#decided-against) scaled-integer money for this deployment. `numeric` is ruled out separately: PowerSync syncs it as text ([type mapping](https://docs.powersync.com/sync/types)).
- **`jsonb` is for documents.** A JSON attribute stays JSON when it is a self-contained value read and written whole — an event's recurrence lines, a widget's settings. It becomes columns or a table when the app reaches inside it or it models a relation. Several attributes typed as JSON today are plain scalars (`chores.canCompleteInAdvance`, `chores.difficultyRating`) and become ordinary columns.
- **Relations are foreign keys**, `ON DELETE CASCADE` where a child cannot outlive its parent — the 13 cascade links, and the join tables — and `SET NULL` otherwise.
- **Constraints say what the code currently has to remember**: `NOT NULL`, `UNIQUE`, and `CHECK` on status columns.

### What is designed out

These exist only because of how Instant works, and do not survive.

- **Key strings standing in for composite uniqueness.** `routineMarkerStatuses.key` is `date:markerKey` stored beside `date` and `markerKey`; `messageThreadMembers.membershipKey`, `messageReactions.reactionKey` and `messageAcknowledgements.ackKey` are the same idea. They become composite unique constraints. Each of the 17 unique attributes is reviewed: a real natural key (`unitDefinitions.code`, `contentCategories.slug`) or an idempotency key (`allowanceTransactions.distributionKey`) stays.
- **An id stored twice.** Ten relations are held both as a link and as a plain attribute carrying the same id (`messages.threadId` beside the `thread` link). Each becomes one foreign-key column.
- **Many-to-many links** become join tables with a composite primary key: who a calendar item pertains to, a calendar item's tags, who a history event affected, a chore's assignees, a task's prerequisites. PowerSync needs a single text `id` per synced table, which the sync query builds from the two columns.
- **`choreAssignments` and `routineSteps`**, entities that exist to carry a position on a relation, become what they are: join tables with a `position` column.
- **`calendarSyncLocks`.** A table of lock rows, because Instant has no locks. Postgres advisory locks replace it.
- **`$users`, `$files`, `$streams`, and the presence room.** Principals become token claims; nothing reads or writes `$files` or `$streams`.
- **Stringly-typed dates and loosely-typed scalars**, per the rules above.

Kept deliberately:

- **Deterministic ids** for up-for-grabs completions and countdown runs. They look like an Instant workaround but are the right tool for offline-first sync: two devices that create "the same" row while offline must arrive at the same id. A unique constraint is added behind them.
- **Soft references in history.** `historyEvents.choreId`, `taskId` and the like are ids that were never links. They stay unconstrained columns, because history must keep pointing at things that have since been deleted.
- **Five attachment tables** rather than one polymorphic table, so each keeps a real foreign key to its owner.

### What is added, and what is left behind

Added:

- `auth_sessions` — the app's own sessions ([identity](#identity-and-sessions)). Server only.
- `sync_write_rejections` — every write the server refused, with the reason. Server only; it exists so a refusal can be diagnosed in a Postgres client.
- `family_members.has_pin` — a generated boolean, synced in place of the PIN hash.
- A server-assigned creation timestamp on `allowance_transactions`, for the one place the app orders by Instant's built-in server timestamp (`TransactionHistoryView`).

Left behind:

- The two undeclared calendar attributes, `ctag` and `syncToken`. No code reads them. This also settles the open [Scope 3](../roadmap.md#scope-3--the-correctness-sweep) item about them: they are not migrated.
- `choreManualStarts`, already removed from the code and still present in the hosted app.

Three entities are referenced by no code at all: `calculatedAllowancePeriods`, `deviceSessions` and `timeOfDayDefinitions`. If the census finds rows in them they are archived as JSON beside the final backup rather than given tables nothing uses.

### Tables that never reach a device

The calendar-sync tables, `shortcut_tokens`, `push_devices`, `auth_sessions` and `sync_write_rejections` are read and written only by the server. They are left out of the sync configuration and the replication publication. Today's rules let some principals view five of the corresponding entities — any family member `calendarSyncCalendars` and `deviceSessions`, a parent `calendarSyncAccounts` and `calendarSyncRuns`, a parent or the owner `pushDevices` — but no client code reads any of them, so this narrows access without changing behavior.

### Where the schema lives

- **Postgres**: hand-written SQL migrations in `db/migrations/`, run when the app container starts, under an advisory lock.
- **The device**: a checked-in TypeScript client schema, first generated with PowerSync's CLI (`powersync generate schema`, which works against a self-hosted instance — [CLI](https://docs.powersync.com/tools/cli)) and then maintained with its indexes. A test fails if its columns drift from the sync configuration.
- **Indexes on the device** are declared for every foreign-key column the data layer joins on. PowerSync's ordinary client tables are views over JSON with basic index support; if the spike finds a join too slow on a phone, [raw tables](https://docs.powersync.com/client-sdks/advanced/raw-tables) — real SQLite tables — are the remedy for that table.
- **The mapping**: `scripts/migrate/mapping.ts` records, for every Instant attribute and link, the column it becomes and the conversion applied. The import uses it and the verification reads it, so it is also the written record of every design choice above.

## The data layer

`packages/data` is one workspace package used by the web app and the phone, as `packages/shared-core` is.

```
packages/data/
  schema/     the client schema and database types
  chores/     types.ts · queries.ts · mutations.ts · hooks.ts
  tasks/ …    one folder per area
  policy/     the write rules, shared with the server
  session/    the principal, the connector, sync status
```

- **`queries.ts`** holds typed SQL and the mappers from rows to the area's types.
- **`hooks.ts`** wraps them as live React hooks. PowerSync's hooks work in React and React Native alike ([React hooks](https://docs.powersync.com/client-sdks/frameworks/react)).
- **`mutations.ts`** holds named functions, each running in one local write transaction.
- **Screens import hooks and mutations and nothing else.** No SQL in a component, on either platform.

### Reads

A read is named for what a screen needs: `useChoreDay(day)`, `useThreadMessages(threadId)`, `useMemberBalances(memberId)`. Each is live — it re-runs when a table it reads changes, whether from a local write or from sync.

- **Nested data** such as a chore with its assignees and completions comes from a few flat live queries, each on an indexed column, combined by a pure function. The spike measured this against a single statement that joins and aggregates: flat was twenty to seventy times faster on the heaviest read, in every browser. A read never fetches a whole history when it wants a day: the day is in the `WHERE`, and the column has an index.
- **Types are the app's own**, written per area: ids for references, ISO strings for instants, `YYYY-MM-DD` for days, real booleans, parsed JSON. They are designed against the relational schema. Where `shared-core` logic takes a nested chore today it takes the area's type instead.
- **Loading.** A hook reports loading until the device has completed its first sync, so a new device shows a loading state rather than an empty family.

### Writes

A mutation is a function: `completeChore(db, { choreId, memberId, day, markedBy })`. Inside one local write transaction it:

1. checks the shared [write rule](#the-write-rules), so a refusal is immediate;
2. checks any uniqueness the server will enforce, for the same reason;
3. writes the rows, including the dependent rows the server's foreign keys would remove on a delete, so an offline view stays consistent.

PowerSync uploads each local transaction as one unit and the server applies it in one Postgres transaction — all or nothing.

A mutation resolves when the write is saved on the device, not when the server has accepted it. A refusal only the server can discover — another device changed the row first — arrives later, and the device's copy reverts at its next sync. Those reach the user through the rejection channel described under [writes](#writes-the-upload-endpoint).

Money, sending a message and PIN elevation are not local writes. Their mutations call the server routes they call today, per decision 4.

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

Rewriting every screen's data access and replacing the database underneath it are two large changes. Done together on a branch, nothing could be checked until all of it was finished, against a codebase that took eighteen commits while this plan was being written. So they are done one after the other, on `main`.

**First the data layer, over Instant** ([Phase 1](#phase-1--the-data-layer-over-instant)). Each area's API and types are designed for the relational end state. Its first implementation runs on Instant: the query objects and transaction-building that live in components today move into `packages/data/<area>/instant.ts` and are mapped into the new types. Every screen moves to the hooks and mutations. The app keeps running on the live database throughout, and each area can be looked at on real data as it lands.

**Then the same API, natively on PowerSync** ([Phase 6](#phase-6--the-data-layer-on-powersync)). Each area gets `queries.ts` and `mutations.ts` in SQL. TypeScript holds both implementations to one interface per area, and a `DATA_BACKEND` flag chooses between them, so the PowerSync build runs on a staging deployment while `main` stays on Instant.

**Then the Instant files are deleted** ([Phase 8](#phase-8--cleanup)).

The adapter code in this plan is therefore all on the Instant side — it maps Instant's results into the app's types — and none of it outlives cutover. Nothing is ever written to make PowerSync look like Instant.

The same pattern holds on the server: each service gets a Postgres implementation beside its Instant one, with the same function signatures, and the routes do not change.

## Reads: the sync configuration

PowerSync decides what reaches a device from a configuration of named streams, each a SQL query, filtered by claims in the device's token ([Sync Streams](https://docs.powersync.com/sync/streams/overview)). The configuration uses `edition: 3`, which PowerSync recommends for new Sync Streams projects, and `timestamp_max_precision: milliseconds`, so a timestamp reaches a device in exactly the form `toISOString()` writes. Today's 55 `view` rules reduce to three streams.

| Stream | Who | What |
| --- | --- | --- |
| `family` | every signed-in device | Every table today's rules let any family principal view. `family_members` is sent without the PIN hash |
| `messaging_member` | a token carrying a family member id | The threads that member belongs to, with their members, messages, attachments, reactions and acknowledgements |
| `messaging_parent` | a parent token | All threads and their contents, as the rules allow a parent today |

A shared kid session carries no family member id and so receives no message threads, as now. Every stream lists its columns explicitly, so a server-only column cannot leak by accident.

**The PIN hash stops leaving the server.** Today a parent's device can read every member's hash and a kid's device its own. The clients only ever use it to show whether a PIN is set, so devices get `has_pin` instead and the PIN is set through a server route.

**Growth.** History and messages only ever grow, and the roadmap [decided against](../roadmap.md#decided-against) rolling them up, bounding them at read time instead. Syncing is different from reading: a table that syncs in full is stored on every device. The census reports row counts and sizes. If history, messages and task updates are small — the expectation for one family — they sync in full. If not, they move to a stream bucketed by month that a device subscribes to as it scrolls back; PowerSync's stream parameters only support equality, so the bucket is a column, not a date range ([syncing by time](https://docs.powersync.com/sync/advanced/sync-data-by-time)).

## Writes: the upload endpoint

`POST /api/sync/upload` receives one uploaded transaction: a list of operations, each a table, a row id, and `PUT` (a new row with its columns), `PATCH` (only the columns that changed) or `DELETE` ([PowerSync's write model](https://docs.powersync.com/handling-writes/writing-client-changes)).

For each transaction the route:

1. Authenticates the session and resolves the principal — parent or kid, and which family member.
2. Opens a Postgres transaction and, for each operation, loads the current row and evaluates the write rule.
3. Applies the operations: `PUT` as insert-or-update, `PATCH` as an update of exactly the changed columns, `DELETE` as a delete that succeeds when the row is already gone.
4. Commits, or rolls the whole transaction back if any operation was refused.

**Responses.** A refused transaction returns `200` with the refusal in the body, and is recorded in `sync_write_rejections`. PowerSync's guidance is specific: an error response is retried indefinitely and blocks everything queued behind it, so a refusal is acknowledged and only a temporary fault — Postgres unreachable — returns `5xx` to be retried. The device shows the refusal as a toast; its local copy reverts at the next sync.

**Conflicts.** Two devices changing different fields of one row both win, because a `PATCH` carries only changed columns. Two devices changing the same field: the later upload wins. That is what Instant does today.

**Retries are safe.** Every operation is idempotent, so an upload that is retried after a dropped connection applies once.

**The upload throttle is lowered.** The SDK waits up to a second before uploading by default, and in the spike that wait was nearly all of the time a write took to reach another device: a median of 870 ms with the default, 43 ms with `crudUploadThrottleMs` at 50. The connector sets it to 100.

### The write rules

`packages/data/policy/` holds one entry per table. It is a faithful translation of `instant.perms.ts`: **no rule is tightened or loosened by this migration**, with the single exception of the tables that stop syncing. [Appendix B](#appendix-b--the-write-rules-today) gives today's rules in the form they are translated from.

The rule functions are pure — operation, current row, changed columns, principal — so the same file runs in two places: inside a mutation on the device, for an immediate refusal, and in the upload route, where it is authoritative. A device can be modified; the server check is the one that counts.

The two contract suites and the live permission matrix are the executable definition of today's rules. Each case is ported to run against the new policy and a real Postgres, and the migration is not complete until all of them pass.

### Which principal a queued write belongs to

A shared device switches between a parent and a kid, and a parent session is demoted after 15 idle minutes. A write is checked against the session that uploads it, not the one that made it. If a parent's writes were still queued when the device demoted, they would be uploaded as a kid and refused.

So the session shown in the interface and the session used for sync are separate. The interface switches at once. The sync connection keeps the previous session until the device has caught up, and only then switches. Parent writes upload as the parent; the kid's view of messages changes a moment later.

"Caught up" has a precise meaning, found in the spike: the upload queue is empty **and** a sync has completed since the last upload. An empty queue alone is not enough. The service confirms each upload per user, and a device that changes user before that confirmation arrives stops applying downloads altogether until its next upload — it looks connected and shows stale data. The session module owns this rule so no screen can get it wrong:

- Switch when the queue is empty and the last completed sync is later than the last upload. Online this takes tens of milliseconds.
- If that cannot be reached — the previous session has expired or been revoked — and the queue is empty, clear the local database and sync again as the new principal. Nothing is lost, since nothing is waiting to upload.
- If writes are still queued under a session that can no longer upload them, they are reported to the user as refused, not silently dropped.

## Identity and sessions

Today the server verifies a PIN, asks Instant to mint a token for a synthetic user, and writes the principal's type and family member id onto that user's `$users` row. Rules read them from there, API routes authenticate by asking Instant to verify the token, and components read `db.useAuth()`.

| Today | After |
| --- | --- |
| Instant refresh token, cached on the device | A session token this server issues: random, stored hashed in `auth_sessions`, revocable |
| `$users.type`, `$users.familyMemberId` | Columns on the session row, and claims in the PowerSync token |
| `adminDb.auth.verifyToken` in `lib/request-family-member.ts` | A lookup in `auth_sessions` |
| `db.useAuth()` returning an Instant user | `usePrincipal()` from the data layer's session module |
| Six `instant-auth-*` token routes | Routes under `/api/auth/`, and `GET /api/sync/token`, which exchanges a session for a signed token PowerSync accepts |

- **The PowerSync token** is signed with an asymmetric key and carries `sub`, `aud`, `iat`, `exp`, a `kid` header, and two claims the streams read: `type` and `family_member_id`. PowerSync requires those standard fields and recommends lifetimes between 5 and 60 minutes ([custom authentication](https://docs.powersync.com/configuration/auth/custom)); this plan uses 10. The SDK asks for a fresh one before expiry by itself.
- **The key pair** is generated by a setup script. The private half goes to the app, the public half into the PowerSync configuration.
- **PIN verification, the scrypt hashes, rate limiting and device activation do not change.** Family members keep their PINs; nobody re-enrols.
- **Existing sessions do not carry over.** Every device signs its member in again once after cutover.
- **Audit fields.** `allowanceTransactions.createdBy` holds an Instant user id today. New rows hold the session's principal id; old rows keep their old value as an opaque string. `createdByFamilyMemberId` is unaffected and remains the field that names a person.

In Phase 1 the session module is introduced over Instant, like the rest of the data layer, so components stop touching `db.useAuth()` before the backend changes.

## The server on Postgres

`lib/server/db.ts` exposes a typed Kysely connection. Each server module that uses the Admin SDK today is rewritten against it, keeping its exported functions so the routes that call it do not change.

- **Finance.** A mutation becomes one transaction that locks the envelope rows it touches, reads them, checks the invariants and writes the ledger. The transaction-building in `lib/currency-utils.ts` and `lib/allowance-payout.ts` retires; their pure calculations stay shared. The in-process lock in `lib/finance-mutation-lock.ts` is no longer what protects the ledger. The roadmap's rule against [running more than one instance](../roadmap.md#decided-against) is left standing — presence, below, still assumes one.
- **Messaging.** Thread, membership, reaction and acknowledgement uniqueness move from key lookups to constraints, and an idempotent send becomes an insert that does nothing on conflict.
- **Calendar sync.** Advisory locks replace the lock table.
- **Members and PINs.** `lib/instant-admin.ts` splits into a members module that reads Postgres and the session module.
- **Shortcuts, the content queue, exchange rates, the server actions** are direct ports.

The three backfill scripts repair Instant data and are retired with it. The two report scripts are rewritten against the server connection.

## Presence and typing

PowerSync has no equivalent of Instant's rooms. The message screens use one for "who has this thread open" and the typing indicator.

The messaging area gains `useThreadPresence(threadId)`. Behind it is a small in-memory module in the Next server with one route: a device posts a heartbeat while a thread is open, saying whether it is composing, and reads back who else is there, polling every few seconds while the thread is on screen. It is correct for a single app instance, which is what this deployment runs.

## The web client

- **Workers and WebAssembly.** PowerSync's web SDK runs SQLite in a worker. On Next 16 with Turbopack the worker files are copied into `public/@powersync/` by a `postinstall` step, and `next.config.js` gains `turbopack: {}` and `images.disableStaticImages: true` ([Next.js guide](https://docs.powersync.com/client-sdks/frameworks/next-js)). The app imports no static images, so the second setting costs nothing.
- **The connection is a WebSocket.** PowerSync's web SDK defaults to HTTP streaming. In the spike WebKit held the start of that stream for twenty seconds, so a first sync, and every reconnection after it, would wait that long; over WebSocket it took under a tenth of a second, and Chromium and Firefox were equally quick either way. The connector asks for WebSocket on every browser.
- **The database is opened once**, at module level, with the plain `database: { dbFilename, vfs, worker }` options. The SDK's README shows an older form that fails, and opening inside a React effect opens it twice in development.
- **The service worker** caches the worker and WebAssembly files explicitly. In the spike the app started offline in all three engines without that, on the browser's own cache, which is not something to depend on.
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
- **Private windows.** The private file system is unavailable in Safari's and Firefox's private windows. The app falls back to IndexedDB there, and if that fails too, to an in-memory database: it works while online and keeps nothing, and says so.
- **Several tabs.** PowerSync shares one connection between tabs through a shared worker, which it turns off on iOS, Safari and Android. There each tab syncs for itself. Nothing in the data layer may assume a single shared connection.
- **Being put in the background.** iOS suspends a page shortly after it leaves the screen. The sync connection drops and resumes when the app returns, as Instant's does now.
- **The browser clearing storage.** Safari has been reported to clear a site's stored data after a week without a visit, with apps added to the home screen exempt. The write-ups are old and this is checked on real devices rather than assumed. It is the same exposure the app has today with Instant's offline cache. Synced data simply downloads again; only writes not yet uploaded are at risk, so the app asks the browser to keep its storage and the sync badge shows how many changes are waiting.

**A browser that cannot run the app is told so.** A startup check for what PowerSync needs shows a plain screen naming what is missing, instead of a blank page. For someone on an old device this is the difference between a known limit and a mystery.

**How it is checked.** Playwright runs only Chromium today. It gains Firefox and WebKit, and the sync and offline end-to-end tests run on all three, which covers engines the family does not use. Playwright's WebKit is not iOS Safari, so real devices are still needed: an iPad and an iPhone, each in a Safari tab, as a home-screen app and in Orion, and Firefox wherever the family uses it.

**For other people running the app** the larger change is on the server, not the device: their deployment gains Postgres and the PowerSync service, and needs a public address for sync. The upgrade guide says so first.

## The phone

- `@powersync/react-native` 2.x uses `@op-engineering/op-sqlite` (17.1 or later, below 19) directly. The app already ships native builds, so no capability is lost.
- **The build made before cutover carries both backends.** The phone already fetches its configuration from `/api/mobile/config` at launch; that response gains a `backend` field. On cutover day the server changes its answer and each phone switches at next launch, instead of every phone needing a new build installed the same day. A cleanup build removes Instant afterwards.
- **The Expo upgrade in [Scope 0](../roadmap.md#scope-0--dependency-maintenance)** is sequenced against this: either before Phase 6's phone work or after cutover, never in the same step as the change of sync library. The spike says whether Expo 54 is sufficient.

## Infrastructure

Added to `docker-compose.yml`:

- **`postgres`**, with `wal_level=logical`. It holds the app database and a second database for PowerSync's own storage, which is supported on the same server from Postgres 14 ([self-hosted configuration](https://docs.powersync.com/configuration/powersync-service/self-hosted-instances)).
- **`powersync`**, the `journeyapps/powersync-service` image pinned to a version, with its configuration and the sync configuration mounted. PowerSync's guidance for a minimal deployment is 512 MB and one vCPU ([deployment architecture](https://docs.powersync.com/maintenance-ops/self-hosting/deployment-architecture)).
- A daily **compaction** job for PowerSync's storage, which its documentation asks for.
- A nightly **`pg_dump`** with retention. Instant Cloud has been keeping this family's backups; after cutover nobody does unless this job exists.

Postgres gets a replication role for PowerSync with read-only access and a publication named `powersync` listing the synced tables ([source database setup](https://docs.powersync.com/configuration/source-db/setup)).

**The PowerSync service needs a public address**, as MinIO has one: a hostname through the reverse proxy that passes WebSocket upgrades and has response buffering turned off, since sync can also run as a long-lived streaming response.

New environment variables: `DATABASE_URL`, `DATA_BACKEND` and `NEXT_PUBLIC_DATA_BACKEND`, `NEXT_PUBLIC_POWERSYNC_URL`, `POWERSYNC_JWT_PRIVATE_KEY`, `POWERSYNC_JWT_KID`, and the `PS_`-prefixed values the PowerSync configuration reads.

**Browsing the data.** The equivalent of Instant's Explorer is any Postgres client. An edit made there reaches devices the same way an Explorer edit does today. PowerSync's own dashboard is not available when self-hosting; its [Sync Diagnostics Client](https://docs.powersync.com/tools/devtools-overview) shows what one token has synced.

## Moving the data

`scripts/migrate/export.js` reads every entity through the Admin SDK with every link, page by page, and writes one JSON file per entity. It is read-only against the live app. `scripts/migrate/import.js` applies the mapping and loads Postgres.

**The census** is the export's first output and feeds the schema design:

- every attribute actually stored, against the schema file — this is where the undeclared attributes show up;
- for each attribute, the JavaScript types and, for dates, the string formats present, which decide each column's type and conversion;
- relations whose link and duplicate attribute disagree, and links that point at nothing;
- values that would violate a planned constraint, so each is resolved before the constraint is written;
- row counts and sizes per table, which settle [whether history and messages sync in full](#reads-the-sync-configuration).

Because the schema is redesigned, a row is not expected to look the same after the move, so **verification** is done at three levels:

- **Rows.** Counts per table against the export, and for every converted value a round-trip check: the stored `timestamptz` renders back to the instant the original string named.
- **Money.** Every envelope's balances and every member's transaction count and totals, compared one by one.
- **Behavior.** The [parity suite](#testing): every read in the data layer returns the same result from the Instant implementation over the live data as from the PowerSync implementation over the imported copy.

Files in MinIO are not touched. Their URLs are stored as values and cross unchanged.

The scripts and the mapping are documented in the README for other people running the app.

## Working on main while this is in flight

`main` stays deployable on Instant throughout. The flag selects the data layer's implementation, the server services' implementation and the session module; the same commit runs on PowerSync in a staging deployment. There is no long-lived branch.

The rules for other work change as the scope advances:

- **Until an area is converted in Phase 1**, work on it as today.
- **Once an area is converted**, its screens reach data only through its hooks and mutations. A new read or write is added to the area's API, not to a component.
- **Once an area has its PowerSync implementation in Phase 6**, a change to that area's API is made in both implementations in the same commit — the typecheck fails otherwise — and a schema change is an edit to `instant.schema.ts`, a SQL migration and a mapping entry together.
- **A change to `instant.perms.ts`** is also made in the write policy, with a case in the ported suites, from Phase 4 on.
- **Nothing new imports `@instantdb/*`** outside the data layer's Instant files. A lint rule enforces it from the end of Phase 1.

The third rule is real double work, so the gap between Phase 6 and cutover should be kept short and light on data-model changes.

## Testing

- **The data layer** is tested per area against PowerSync's Node SDK, opened on a temporary file and never connected. It carries the real client schema, and its upload queue shows exactly what each mutation would send, so a test asserts both what the device now holds and what the server will be asked to apply. The suite still needs no running services.
- **The parity suite** runs each area's reads through both implementations — Instant over recorded live results, PowerSync over the imported copy — and compares them. It is what makes "every screen still gets the data it expects" a test run instead of a manual tour.
- **The write policy** runs the ported contract and live-matrix cases against PGlite, an in-process Postgres reached through the ordinary driver.
- **The upload route** has integration tests for acceptance, refusal, atomic rollback, idempotent retry and the `5xx` path.
- **The server services** run their existing integration suites against PGlite. It is a single connection, so the finance concurrency cases — two transactions racing for one envelope — run against the real Postgres in the compose profile.
- **End to end**, Playwright runs against a compose profile with Postgres and PowerSync, seeded by the import script, in Chromium, Firefox and WebKit.

Of today's 153 test files, the 17 that mock `@/lib/db` are rewritten to mock the area's hooks and mutations as each area is converted, and the 10 that mock `@/lib/instant-admin` follow the server modules. The two contract suites and the live suite are ported, not deleted.

## Phases

Each phase ends with typechecks, the test suite and a production build passing. Items marked **(you)** need David's devices or his infrastructure.

Phases 1 to 5 do not wait on one another beyond what is noted; Phase 6 needs all of them.

### Phase 0 — The spike

A throwaway branch. Its only output is findings written into this document's log, and the revisions to later phases that follow from them.

- **S1 — Web.** PowerSync's web SDK in this Next 16 app under Turbopack, in development and in the standalone Docker build, with the service worker caching its assets. Run it in Chromium, Firefox and WebKit under Playwright, in ordinary and private windows, with two tabs open. **(you)** Open it on an iPad and an iPhone — in a Safari tab, as a home-screen app, and in Orion — and in Firefox wherever the family uses it: does it load, work offline, and survive being closed and reopened? Leave one untouched for eight days and say whether its data is still there.
- **S2 — Phone.** `@powersync/react-native` with op-sqlite on Expo 54 and the New Architecture. **(you)** Install the build.
- **S3 — Service.** The self-hosted service with Postgres storage on the same server; `edition: 3` and the timestamp text a device actually receives; a token signed with an inline public key; a stream filtered by `auth.parameter('type')`; messaging membership through a join; a join table with a composite key and a built `id`.
- **S4 — Latency.** Time from a write on one device to its appearance on another, and replay of writes queued offline. PowerSync publishes no figure, so this is measured.
- **S5 — The query layer.** The chore-day read and the complete-a-chore write, over an export of the real data, written three ways: Kysely, Drizzle, and plain SQL strings. For the read, both a single joined statement and flat queries assembled in memory. Timed on a phone and in a browser. Choose one and record why.
- **S6 — Switching principal.** Swap tokens without clearing the local database; confirm messaging buckets change; confirm the sync connection can keep the old session until the queue drains.
- **S7 — Refusal.** A refused upload answered with `200`, and the local revert. Confirm a `PATCH` lists only changed columns, which the kid-safe rules depend on.
- **S8 — Test tooling.** Choose the in-memory SQLite and in-process Postgres used by the suite.

Done when each has a written finding, and any that failed has a revised approach here.

### Phase 1 — The data layer, over Instant

On `main`, Instant still the only backend. Independent of the spike, apart from S5's choice of how hooks are written.

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

Also in this phase: the session module over Instant, replacing `db.useAuth()` in components; and the lint rule.

Done when no file outside the data layer's Instant implementation, the session module and the server's Instant modules imports `@instantdb/*` or builds a query.

### Phase 2 — The schema and the data

- The export script and the census, run against the live app, read-only.
- The schema, as SQL migrations, following [the design rules](#design-rules), with the mapping file.
- Postgres and PowerSync in `docker-compose.yml`, with the setup script for keys, roles and the publication.
- The client schema and its indexes.
- The import script and the row and money verification.
- **(you)** A hostname for the PowerSync service through the reverse proxy.

Any design choice that would change what the app does, as opposed to how it stores it, is asked of David first.

Done when a fresh import of the live data verifies clean.

### Phase 3 — Identity

- `auth_sessions`, the routes under `/api/auth/`, `/api/sync/token`, and request authentication against sessions.
- The session module's PowerSync-era implementation, on the web and the phone.
- `has_pin`, and the server route that sets a PIN.

Done when the parent-elevation, idle-demotion and device-auth tests pass on both backends.

### Phase 4 — Sync and the write rules

- The sync configuration and its three streams.
- `/api/sync/upload` and the write policy.
- The contract suites and the live matrix, ported.
- The PowerSync connector, with the split between interface session and sync session.
- The refusal toast and `sync_write_rejections`.

Done when every ported permission case passes and a two-device test shows a write crossing.

### Phase 5 — The server on Postgres

- `lib/server/db.ts`; finance as locked transactions; messaging on constraints; calendar sync on advisory locks; members and PINs; shortcuts, the content queue, exchange rates, the server actions.
- The report scripts rewritten; the backfill scripts removed.

Done when the integration suites for those areas pass on Postgres.

### Phase 6 — The data layer, on PowerSync

For each area, in the Phase 1 order:

- `queries.ts` and `mutations.ts` in SQL, behind the same interface.
- The area's parity cases, recorded from Instant and compared.
- **(you)** Look over the area's screens on staging.

Also in this phase: the web provider, worker assets and service-worker caching; storage chosen per browser with its fallbacks, the storage-persistence request and the unsupported-browser screen; Firefox and WebKit added to Playwright; the phone on op-sqlite with the `backend` field and the dual-backend build; presence's server module; the sync-status badge.

Done when the staging deployment runs the whole app on an imported copy of the live data and the parity suite passes.

### Phase 7 — Rehearsal and cutover

Rehearsal, on staging:

- A full export, import and verification, timed.
- A restore of the nightly dump into an empty Postgres, to prove the backup.
- **(you)** Use staging on the family's real devices for a few days: chores, a countdown run, a message thread, an allowance payout, offline and back.
- **(you)** Install the dual-backend phone build on every phone.

Cutover, on a quiet day:

1. Bring every device online and let it sync. Writes still queued inside Instant on a device are lost at the next step.
2. Turn on read-only mode for the app in the Instant dashboard and wait 30 seconds.
3. Export, import, verify.
4. Deploy the web app with `DATA_BACKEND=powersync`; the phones follow at next launch.
5. Smoke-test on each device before the family uses it. **This is the only point at which going back is free** — turn read-only off and redeploy the old flag.
6. After that, fix forward. Going back would discard everything written since.

Keep the Instant app read-only and untouched until the August deadline, and download a final backup. **(you)**

### Phase 8 — Cleanup

- Delete every Instant implementation in the data layer and on the server, the Instant packages, `instant.schema.ts`, `instant.perms.ts`, the flag, the `instant-auth-*` routes and the MMKV store.
- Rewrite `CLAUDE.md` and `AGENTS.md`, which currently instruct every agent to build on InstantDB.
- Rewrite the README's setup, add the upgrade guide for other people running the app, state the supported browsers and devices, and note the PowerSync licence.
- Update the reference documents in `docs/`.
- Close the roadmap items this makes moot: the hosted `choreManualStarts` deletion and the undeclared calendar attributes.
- Ship the phone build without Instant.

Done when a search of the repository for `instant` finds only history: this document, the audits and the changelog of what was removed.

## Risks

| Risk | What limits it |
| --- | --- |
| A browser that runs the app today cannot run PowerSync's web SDK reliably | All three engines are tested first, in S1, with the family's iPads and iPhones by hand. If WebKit fails the plan is reconsidered before anything specific to PowerSync is built |
| Someone running their own copy is on a browser nobody tested | The floor stays where Next 16 already puts it, the storage mode falls back twice, and a browser that still cannot run the app is told why |
| Rewriting every screen's data access introduces regressions | Done one area at a time on the live app, each with rewritten tests and David's look, before the backend changes at all |
| The PowerSync implementation of a read differs from the Instant one | The parity suite compares them over the real data, read by read |
| A redesigned column loses or alters a value | The census resolves every odd value before its constraint exists; conversions are round-trip checked; money is compared envelope by envelope; Instant is kept intact afterwards |
| A rule is translated wrongly and a kid can write what they should not | The existing contract suites and live matrix are ported case by case |
| Both implementations must be kept in step late in the work | The typecheck enforces the shared interface; Phase 6 is kept short |
| The work overruns the deadline | The 31 May 2027 trigger for self-hosting Instant |
| PowerSync changes its terms or stops | The data is in plain Postgres and the client libraries are Apache-2.0; released service versions become Apache-2.0 after two years |
| Sync Streams prove immature | PowerSync's older Sync Rules format can express the same three partitions; S3 says whether it is needed |

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

`instant.perms.ts` on `a4aed13`, grouped, under Instant's names. The write policy translates these onto the new tables and columns. "Family" means any signed-in principal, parent or kid.

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

Instant checks a `link` separately from the row it joins; in a relational schema the link is a column on a row, so each link rule becomes a rule on the value written to that column. The column-by-column table is produced in Phase 4 from the ported test cases, which are the authority.
