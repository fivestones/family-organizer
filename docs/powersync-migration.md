# Moving from InstantDB to PowerSync

**Date:** 2026-10-12
**Status:** Planned. Nothing is built. Phase 0 (the spike) and Phase 1 (one door) can start now; every later phase is provisional until the spike's findings are written into this document.
**Roadmap:** [Scope 7](../roadmap.md#scope-7--the-move-to-powersync).
**Measured against:** commit `a4aed13`. The counts below were taken from the code on that commit, not estimated.

---

## Implementation log

Nothing yet. Record each completed phase here, newest first, in the prose style the audits use: what was built, what the work showed the plan had wrong, and what was left.

---

## Why, and by when

Instant's team has joined OpenAI and Instant Cloud is closing. New signups are shut, **cloud apps stop on 31 August 2027**, and backups stay downloadable until 31 August 2028 ([announcement](https://www.instantdb.com/essays/instant_team_joins_openai)). `.env` points at the family's live Instant Cloud app, so the deadline applies to this deployment.

The replacement is self-hosted **PowerSync** in front of ordinary **Postgres**. Postgres becomes the database; each device keeps a local SQLite copy; PowerSync streams Postgres changes down to devices, and devices send their writes up through an endpoint in this app.

**The fallback, and the date it triggers.** Self-hosting Instant is a configuration change: both clients already accept a custom API and WebSocket address, and Instant publishes a [migration guide](https://www.instantdb.com/docs/self-hosting/migrate). If the cutover rehearsal ([Phase 8](#phase-8--rehearsal-and-cutover)) has not passed by **31 May 2027**, self-host Instant first so the August deadline cannot be missed, then finish this plan without it hanging over the work.

## Decisions

Settled with David on 11–12 October 2026.

1. **PowerSync, self-hosted, with Postgres.** The server component is the PowerSync Open Edition; the client libraries are Apache-2.0.
2. **Ahead of the unfinished product work.** Scope 7 comes before Scopes 4–6. See [what this plan changes about that decision](#working-on-main-while-this-is-in-flight) — the restriction on other work turned out to be lighter than "do not touch the data layer".
3. **Other people run this app.** The repository has forks, so the export and import are a documented, supported script. Both backends are not supported long-term: after cutover Instant is removed.
4. **Offline scope stays as it is.** Money mutations, sending messages and parent PIN elevation stay online-only. Making them work offline is a separate piece of design.
5. **One switch.** Nearly every entity links to `familyMembers`, so the data cannot live half in one backend and half in the other. Cutover is a short read-only window, a final import, and a flag flip.
6. **One Postgres, no MongoDB.** Postgres and the PowerSync service join the existing compose file. PowerSync keeps its own bookkeeping in a second database on the same server.

Made in this plan, and open to revision by the spike:

7. **Keep the call sites; replace what is underneath them.** The app's 102 client queries and roughly 200 `transact` call sites keep their shape. A compatibility layer implements the small part of Instant's query and transaction API this app uses, on top of PowerSync's SQLite on devices and Postgres on the server. See [the compatibility layer](#the-compatibility-layer).
8. **One manifest describes the data.** A single file lists tables, columns and relations, and everything else — Postgres DDL, the PowerSync client schema, the sync configuration, the relation map — is generated from it.
9. **Names and values cross unchanged.** Tables and columns keep their Instant names, and stored values keep their exact form. Type improvements are a later, separate change.
10. **The app owns its sessions.** Instant's tokens are replaced by session tokens this server issues and can revoke, plus short-lived signed tokens for PowerSync.
11. **The write rules are one file, shared.** The same rule code runs on the device, for an immediate answer, and on the server, where it is authoritative. Anything not listed is denied.
12. **Both backends live in `main` behind a flag** until cutover, rather than on a long-lived branch.

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

Three things in that inventory shape the whole plan.

**The queries are few in kind.** Nearly all of them fetch whole collections with nested relations — every chore with its assignees, assignments and completions, for instance. Across the entire codebase the filters used are equality, `$in` (7 uses), `$isNull` (2), `$like` (2, both in the calendar) and `or`; ordering is by one attribute; `limit`, `first` and `last` appear four times. There is no `and`, no comparison operator, no dotted path, no `merge`, and no `lookup`.

**The server already holds the invariant-bearing work.** Money goes through `/api/finance/mutations`, messaging through `/api/messages/*`, calendar sync and shortcuts through their own routes. Those are untouched by the question of how devices sync.

**The live app does not exactly match `instant.schema.ts`.** The hosted app carries `calendarSyncCalendars.ctag` and `syncToken`, which the file does not declare ([roadmap Scope 3](../roadmap.md#scope-3--the-correctness-sweep)). The export therefore reads what is actually stored, and reports the difference, rather than trusting the file.

## Target architecture

```
  web (Next.js client)            phone (Expo)
  ┌───────────────────┐           ┌───────────────────┐
  │ components        │           │ screens           │
  │   db.useQuery     │           │   db.useQuery     │
  │   db.transact     │           │   db.transact     │
  ├───────────────────┤           ├───────────────────┤
  │ compatibility layer (packages/data) — shared      │
  ├───────────────────┤           ├───────────────────┤
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

## The data model in Postgres

### Names, ids and types

- **Table and column names are Instant's, unchanged**: `choreCompletions`, `dateDue`. Postgres needs them double-quoted; PowerSync's sync queries preserve the case of quoted identifiers and of `SELECT *` ([case sensitivity](https://docs.powersync.com/sync/advanced/case-sensitivity)). Keeping the names removes a mapping layer between 528 attributes and the roughly 120,000 lines of web and phone code that read them.
- **`id` is `text`**, holding the same UUID string Instant holds. PowerSync requires a text `id` on every synced table.
- **Values keep their stored form.** The mapping:

| Instant type | Postgres | On the device | Note |
| --- | --- | --- | --- |
| string | `text` | text | 87 of these hold dates as ISO strings and stay strings |
| number | `double precision` | real | Never `numeric`, which PowerSync syncs as text. Four ledger rows hold sub-cent amounts ([decided against](../roadmap.md#decided-against) rounding them), and a double preserves them exactly |
| boolean | `boolean` | integer 0/1 | The compatibility layer converts both ways |
| JSON | `jsonb` | text | Parsed on read, serialised on write, by the compatibility layer |
| date | decided by the census | text or real | 16 attributes. Instant returns what was stored — string or number — so the column type follows what the live data holds |

`timestamptz` is deliberately not used for existing attributes: PowerSync syncs it as `YYYY-MM-DD hh:mm:ss.sssZ`, with a space, which is not the string the app stored or parses today ([type mapping](https://docs.powersync.com/sync/types)).

### Links

A link with a "one" side becomes a column on the row that has one of the other. `allowanceEnvelopes.familyMember` becomes `allowanceEnvelopes.familyMemberId`. There are 49 such columns; 10 already exist as plain attributes carrying the same id (`messages.threadId`, for example), and the census confirms the attribute and the link agree before they are merged.

- **Foreign keys are real, and deferred.** Each link column gets a foreign-key constraint, `ON DELETE CASCADE` for the 13 cascade links and `ON DELETE SET NULL` for the rest, declared `DEFERRABLE INITIALLY DEFERRED` so the order of operations inside one transaction does not matter.
- **One-to-one links** (`dashboardConfigs.familyMember`, `familyRuleVersions.previousVersion`, `historyEvents.message`) also get a unique constraint.
- **Soft references stay soft.** Attributes such as `historyEvents.choreId` or `countdownRuns.familyMemberId` are ids that were never links. They stay plain text with no constraint, because history must keep pointing at things that have since been deleted.

The five many-to-many links become join tables. A join row's id is `leftId:rightId`, so linking twice is the same write and unlinking is a delete by id.

| Join table | Columns | Replaces |
| --- | --- | --- |
| `calendarItemsPertainsTo` | `calendarItemId`, `familyMemberId` | `calendarItems.pertainsTo` ↔ `familyMembers.calendarItems` |
| `calendarItemsTags` | `calendarItemId`, `calendarTagId` | `calendarItems.tags` ↔ `calendarTags.calendarItems` |
| `familyMembersAffectedHistoryEvents` | `familyMemberId`, `historyEventId` | `familyMembers.affectedHistoryEvents` ↔ `historyEvents.affectedFamilyMembers` |
| `familyMembersAssignedChores` | `familyMemberId`, `choreId` | `familyMembers.assignedChores` ↔ `chores.assignees` |
| `tasksPrerequisites` | `taskId`, `prerequisiteTaskId` | `tasks.prerequisites` ↔ `tasks.subsequentTasks` |

### What is added, and what is left behind

Added:

- `authSessions` — the app's own sessions ([identity](#identity-and-sessions)). Server only.
- `syncWriteRejections` — every write the server refused, with the reason. Server only; it exists so a refusal can be diagnosed in a Postgres client.
- `familyMembers.hasPin` — a generated boolean, synced in place of `pinHash`.
- `allowanceTransactions.serverCreatedAt` — the one place the app orders by Instant's built-in server timestamp (`TransactionHistoryView`). Filled from export order at import and by the server on insert.

Left behind:

- `$users`, `$files`, `$streams` and the presence room. Principals become token claims; nothing in the code reads or writes `$files` or `$streams`.
- The two undeclared calendar attributes, `ctag` and `syncToken`. No code reads them. This also settles the open [Scope 3](../roadmap.md#scope-3--the-correctness-sweep) item about them: they are not migrated.
- `choreManualStarts`, already removed from the code and still present in the hosted app.

Three entities are referenced by no code at all: `calculatedAllowancePeriods`, `deviceSessions` and `timeOfDayDefinitions`. Their rows are migrated so nothing is lost, they are not synced to devices, and they are candidates for deletion after cutover.

### Tables that never reach a device

`calendarSyncAccounts`, `calendarSyncCalendars`, `calendarSyncLocks`, `calendarSyncRuns`, `shortcutTokens`, `pushDevices`, `deviceSessions`, `authSessions` and `syncWriteRejections` are read and written only by the server. They are left out of the sync configuration and the replication publication. Today's rules let some principals view five of them — any family member `calendarSyncCalendars` and `deviceSessions`, a parent `calendarSyncAccounts` and `calendarSyncRuns`, a parent or the owner `pushDevices` — but no client code reads any of them, so this narrows access without changing behavior.

[Appendix A](#appendix-a--tables) lists every table.

## The schema manifest

`packages/data/manifest.ts` lists each table, its columns with their types, which columns are server-only, and each relation with its cardinality and delete rule. It is generated once from `instant.schema.ts` and the census, and from then on it is the source of truth that `instant.schema.ts` is today.

Generated from it, and checked in:

- the initial Postgres migration, and the publication listing the synced tables;
- the PowerSync client schema used by the web and the phone;
- the sync configuration — explicit column lists per table, so a server-only column cannot leak by accident;
- the relation map the compatibility layer reads.

A contract test regenerates each and fails if the checked-in copy differs. Until cutover a second contract test compares the manifest with `instant.schema.ts`, which is what lets feature work carry on.

Later schema changes are a hand-written SQL migration in `db/migrations/` plus the matching manifest edit. Migrations run when the app container starts, under an advisory lock.

## The compatibility layer

This is the decision that sets the size of the whole job. Rewriting 102 queries as SQL and 200 write sites as statements would touch most of the application and would have to be re-verified screen by screen. The app uses a narrow slice of Instant's API, so the plan implements that slice instead.

`packages/data` exposes what `lib/db.ts` and `mobile/src/lib/instant-db.js` expose today: `db.useQuery`, `db.queryOnce`, `db.transact`, `tx`, `id`, `db.useAuth`, `db.auth.signInWithToken`, `db.auth.signOut`, `db.useConnectionStatus`. Call sites and result shapes do not change. Nothing here is Instant's code; it is a small layer this project owns.

### Reads

The supported query language is exactly what the inventory found: nested relations to any depth; `where` with equality (including equality on a link label, as in `where: { envelope: envelopeId }`), `$in`, `$isNull`, `$like` and `or`; `order` on one attribute; `limit`, `first` and `last`; a `null` query meaning "do not run". Anything outside that throws, loudly, so a new query that needs more is noticed when it is written.

A query is resolved in a fixed number of SQL statements, not one per row: one for each top-level collection, then one for each relation at each level, fetching all children of all parents at once. Results are assembled in memory into the nested shape the components already expect.

- **Live updates.** `useQuery` re-runs when PowerSync reports a change to any table the query touches, whether from a local write or from sync.
- **Loading.** `isLoading` stays true until the device has completed its first sync, so a new device shows a loading state rather than an empty family.
- **Missing values are absent, not `null`.** SQL returns `null` for every empty column; Instant omits an attribute that was never set. The layer omits empty columns, which matches the types the code is written against. The spike measures how often the live data holds an explicit `null`, and Phase 3 searches the code for strict `=== null` comparisons on query results.
- **Link shape follows the caller.** The web and phone clients are initialised with the schema and the server's Admin client is not, and Instant shapes a has-one link differently for each: an object for the first, an array for the second. `lib/finance-mutation-server.ts` already handles both. The layer has a mode for each so neither side's code changes, and the parity fixtures record which shape each caller really receives.

### Writes

`tx.chores[id].update(...)`, `.create`, `.delete`, `.link` and `.unlink` are compiled into row operations, using the relation map to turn a link into a column update or a join row. `update` keeps Instant's meaning of create-or-update. One `transact([...])` becomes one local SQLite transaction, which PowerSync uploads as one unit and the server applies in one Postgres transaction — all or nothing, as now.

Three behaviors of Instant are reproduced deliberately:

- **Cascades happen on the device too.** Deleting a chore deletes its completions locally at once, so an offline view is consistent. The server cascades as well; the duplicate deletes are harmless.
- **Unique attributes are checked before the local write**, so a duplicate fails immediately as it does today, instead of succeeding locally and vanishing later.
- **The write rules are checked before the local write**, for the same reason. See below.

### What changes for the caller anyway

`await db.transact(...)` now resolves when the write is saved on the device, not when the server has accepted it. With the two pre-checks above, a refusal that used to reject the promise still does in every ordinary case. A refusal that only the server can discover — another device changed the row first — arrives later, and the device's copy reverts at its next sync. Those are reported to the user through the rejection channel described under [writes](#writes-the-upload-endpoint).

### Proving it is the same

**Parity fixtures.** For every distinct query in the inventory, record the result from the live Instant app and compare it, as deep-equal JSON, with the layer's result over the imported copy of the same data. This turns "does every screen still get the data it expects" from a manual tour into a test run. The fixtures are recorded with the Admin SDK, read-only.

Write semantics — create-or-update, link replacement on a has-one link, cascade, unique violation, the all-or-nothing transaction — each get direct tests against both SQLite and Postgres.

## Reads: the sync configuration

PowerSync decides what reaches a device from a configuration of named streams, each a SQL query, filtered by claims in the device's token ([Sync Streams](https://docs.powersync.com/sync/streams/overview)). Today's 55 `view` rules reduce to three streams.

| Stream | Who | What |
| --- | --- | --- |
| `family` | every signed-in device | Every synced table that today's rules let any family principal view: 34 entity tables and the 5 join tables. `familyMembers` is sent without `pinHash` |
| `messaging_member` | a token carrying a family member id | The threads that member belongs to, with their members, messages, attachments, reactions and acknowledgements |
| `messaging_parent` | a parent token | All threads and their contents, as the rules allow a parent today |

A shared kid session carries no family member id and so receives no message threads, as now.

**`pinHash` stops leaving the server.** Today a parent's device can read every member's hash and a kid's device its own. The clients only ever use it to show whether a PIN is set, so devices get `hasPin` instead and the PIN is set through a server route.

**Growth.** History and messages only ever grow, and the roadmap [decided against](../roadmap.md#decided-against) rolling them up, bounding them at read time instead. Syncing is different from reading: a table that syncs in full is stored on every device. The census reports row counts and sizes. If history, messages and task updates are small — the expectation for one family — they sync in full. If not, they move to a windowed stream that sends recent rows by default and older ones on request, which Sync Streams supports through subscription parameters.

## Writes: the upload endpoint

`POST /api/sync/upload` receives one uploaded transaction: a list of operations, each a table, a row id, and `PUT` (a new row with its columns), `PATCH` (only the columns that changed) or `DELETE` ([PowerSync's write model](https://docs.powersync.com/handling-writes/writing-client-changes)).

For each transaction the route:

1. Authenticates the session and resolves the principal — parent or kid, and which family member.
2. Opens a Postgres transaction and, for each operation, loads the current row and evaluates the write rule.
3. Applies the operations: `PUT` as insert-or-update, `PATCH` as an update of exactly the changed columns, `DELETE` as a delete that succeeds when the row is already gone.
4. Commits, or rolls the whole transaction back if any operation was refused.

**Responses.** A refused transaction returns `200` with the refusal in the body, and is recorded in `syncWriteRejections`. PowerSync's guidance is specific: an error response is retried indefinitely and blocks everything queued behind it, so a refusal is acknowledged and only a temporary fault — Postgres unreachable — returns `5xx` to be retried. The device shows the refusal as a toast; its local copy reverts at the next sync.

**Conflicts.** Two devices changing different fields of one row both win, because a `PATCH` carries only changed columns. Two devices changing the same field: the later upload wins. That is what Instant does today. Up-for-grabs completions and countdown runs use deterministic ids, so two devices creating "the same" row converge on one row, as they do now.

**Retries are safe.** Every operation is idempotent, so an upload that is retried after a dropped connection applies once.

### The write rules

`packages/data/policy.ts` holds one entry per table. It is a faithful translation of `instant.perms.ts`: **no rule is tightened or loosened by this migration**, with the single exception of the tables that stop syncing. [Appendix B](#appendix-b--write-rules) gives the translation.

The rule functions are pure — operation, current row, changed columns, principal — so the same file runs in two places: on the device before a local write, for an immediate refusal, and in the upload route, where it is authoritative. A device can be modified; the server check is the one that counts.

The two contract suites and the live permission matrix are the executable definition of today's rules. Each case is ported to run against the new policy and a real Postgres, and the migration is not complete until all of them pass.

### Which principal a queued write belongs to

A shared tablet switches between a parent and a kid, and a parent session is demoted after 15 idle minutes. A write is checked against the session that uploads it, not the one that made it. If a parent's writes were still queued when the tablet demoted, they would be uploaded as a kid and refused.

So the session shown in the interface and the session used for sync are separate. The interface switches at once. The sync connection keeps the previous session until the upload queue is empty, and only then switches. Parent writes upload as the parent; the kid's view of messages changes a moment later. The spike confirms the SDK allows this.

## Identity and sessions

Today the server verifies a PIN, asks Instant to mint a token for a synthetic user, and writes the principal's type and family member id onto that user's `$users` row. Rules read them from there, and API routes authenticate by asking Instant to verify the token.

| Today | After |
| --- | --- |
| Instant refresh token, cached in `localStorage` or AsyncStorage | A session token this server issues: random, stored hashed in `authSessions`, revocable |
| `$users.type`, `$users.familyMemberId` | Columns on the session row, and claims in the PowerSync token |
| `adminDb.auth.verifyToken` in `lib/request-family-member.ts` | A lookup in `authSessions` |
| `db.auth.signInWithToken(token)` | The same call, on the compatibility layer, storing the session token |
| `db.useAuth()` returning the Instant user | The same hook, returning the principal decoded from the session |
| — | `GET /api/sync/token`: exchanges a session token for a signed token PowerSync accepts |

- **The PowerSync token** is signed with an asymmetric key and carries `sub`, `aud`, `iat`, `exp`, a `kid` header, and two claims the streams read: `type` and `family_member_id`. PowerSync requires those standard fields and recommends lifetimes between 5 and 60 minutes ([custom authentication](https://docs.powersync.com/configuration/auth/custom)); this plan uses 10. The SDK asks for a fresh one before expiry by itself.
- **The key pair** is generated by a setup script. The private half goes to the app, the public half into the PowerSync configuration.
- **PIN verification, the scrypt hashes, rate limiting and device activation do not change.** Family members keep their PINs; nobody re-enrols.
- **Existing sessions do not carry over.** Every device signs its member in again once after cutover.
- **Audit fields.** `allowanceTransactions.createdBy` holds an Instant user id today. New rows hold the session's principal id; old rows keep their old value as an opaque string. `createdByFamilyMemberId` is unaffected and remains the field that names a person.
- **The token routes keep their paths** until cleanup, so a phone build made before cutover still works after it.

## The server on Postgres

`getInstantAdminDb()` becomes `getServerDb()`, which returns the same `query` / `transact` / `tx` surface backed by Postgres through the compatibility layer. The server's library code — messaging, finance, calendar sync, shortcuts, the content queue — therefore runs unchanged at cutover. This is what keeps the switch small.

Two things change underneath, both improvements the old backend could not offer:

- **`transact` is a real database transaction.** A finance mutation's fresh read and its write happen inside one transaction with the envelope rows locked. The in-process lock in `lib/finance-mutation-lock.ts` stays for now; the rule against [running more than one instance](../roadmap.md#decided-against) is unchanged by this plan, though it becomes possible to lift it later.
- **Uniqueness is enforced by the database.** `messageThreads.threadKey`, `messageReactions.reactionKey`, `allowanceTransactions.distributionKey` and the other 14 unique attributes become unique constraints.

`lib/instant-admin.ts` splits: PIN hashing and member lookup move to a module that reads Postgres; token minting moves to the session module.

The three backfill scripts have done their work and are retired. The two report scripts are pointed at `getServerDb()`.

## Presence and typing

PowerSync has no equivalent of Instant's rooms. The message screens use one for "who has this thread open" and the typing indicator.

The replacement is a small in-memory module in the Next server with one route: a device posts a heartbeat while a thread is open, saying whether it is composing, and reads back who else is there, polling every few seconds while the thread is on screen. It is correct for a single app instance, which is what this deployment runs. `db.room` and the two presence hooks are kept as shims so neither message screen changes.

## The web client

- **Workers and WebAssembly.** PowerSync's web SDK runs SQLite in a worker. On Next 16 with Turbopack the worker files are copied into `public/@powersync/` by a `postinstall` step, and `next.config.js` gains `turbopack: {}` and `images.disableStaticImages: true` ([Next.js guide](https://docs.powersync.com/client-sdks/frameworks/next-js)). The app imports no static images, so the second setting costs nothing.
- **The service worker** must cache the worker and WebAssembly files, or the app will not start offline.
- **The wall tablet is an iPad running the app as a PWA**, which means Safari. PowerSync treats Safari and iOS differently: shared workers are off by default there, and a different storage mode is recommended ([web SDK](https://docs.powersync.com/client-sdks/reference/javascript-web)). This is the largest technical unknown in the plan and is the first thing the spike tests on the real tablet.
- **Storage persistence.** The app asks the browser not to evict its storage, since queued writes live there until they upload.
- **Server rendering.** The SDK does nothing during server rendering. The app's data components are already client components behind the session provider.

## The phone

- `@powersync/react-native` 2.x uses `@op-engineering/op-sqlite` (17.1 or later, below 19) directly. The app already ships native builds — MMKV, the New Architecture — so no capability is lost.
- **The build made before cutover carries both backends.** The phone already fetches its configuration from `/api/mobile/config` at launch; that response gains a `backend` field. On cutover day the server changes its answer and each phone switches at next launch, instead of every phone needing a new build installed the same day. A cleanup build removes Instant afterwards.
- **The Expo upgrade in [Scope 0](../roadmap.md#scope-0--dependency-maintenance)** is sequenced against this: either before Phase 7's phone wiring or after cutover, never in the same step as the SDK change. The spike says whether Expo 54 is sufficient.

## Infrastructure

Added to `docker-compose.yml`:

- **`postgres`**, with `wal_level=logical`. It holds the app database and a second database for PowerSync's own storage, which is supported on the same server from Postgres 14 ([self-hosted configuration](https://docs.powersync.com/configuration/powersync-service/self-hosted-instances)).
- **`powersync`**, the `journeyapps/powersync-service` image pinned to a version, with its configuration and the generated sync configuration mounted. PowerSync's guidance for a minimal deployment is 512 MB and one vCPU ([deployment architecture](https://docs.powersync.com/maintenance-ops/self-hosting/deployment-architecture)).
- A daily **compaction** job for PowerSync's storage, which its documentation asks for.
- A nightly **`pg_dump`** with retention. Instant Cloud has been keeping this family's backups; after cutover nobody does unless this job exists.

Postgres gets a replication role for PowerSync with read-only access and a publication named `powersync` listing the synced tables ([source database setup](https://docs.powersync.com/configuration/source-db/setup)).

**The PowerSync service needs a public address**, as MinIO has one: a hostname through the reverse proxy with response buffering turned off, because sync is a long-lived streaming response.

New environment variables: `DATABASE_URL`, `DATA_BACKEND` and `NEXT_PUBLIC_DATA_BACKEND`, `NEXT_PUBLIC_POWERSYNC_URL`, `POWERSYNC_JWT_PRIVATE_KEY`, `POWERSYNC_JWT_KID`, and the `PS_`-prefixed values the PowerSync configuration reads.

**Browsing the data.** The equivalent of Instant's Explorer is any Postgres client. An edit made there reaches devices the same way an Explorer edit does today. PowerSync's own dashboard is not available when self-hosting; its [Sync Diagnostics Client](https://docs.powersync.com/tools/devtools-overview) shows what one token has synced.

## Moving the data

`scripts/instant-export.js` reads every entity through the Admin SDK with every link, page by page, and writes one JSON file per entity. It is read-only against the live app. `scripts/postgres-import.js` loads those files.

**The census** is the export's first output and decides the open type questions:

- every attribute actually stored, against the manifest — this is where the undeclared attributes show up;
- for each attribute, the JavaScript types and, for dates, the string formats present;
- link columns that disagree with their duplicate attribute, and links that point at nothing;
- row counts and sizes per table, which settle [whether history and messages sync in full](#reads-the-sync-configuration).

**Verification** after an import: row counts per table; a checksum per table over ids and values; every envelope's balances and every member's transaction count, compared one by one; and the parity fixtures.

Files in MinIO are not touched. Their URLs are stored as values and cross unchanged.

Both scripts are documented in the README for other people running the app.

## Working on main while this is in flight

The original recommendation was to pause data-layer work on `main`. The compatibility layer makes that unnecessary, and this replaces it.

`DATA_BACKEND` selects the implementation behind `lib/db.ts`, `getServerDb()` and the session module. `main` stays deployable on Instant throughout; the same commit runs on PowerSync in a second, staging deployment. There is no long-lived branch to merge.

The rule for other work, from the end of Phase 2 until cutover:

- **A change to `instant.schema.ts` is also made in the manifest**, in the same commit. A contract test fails otherwise.
- **A change to `instant.perms.ts` is also made in the write policy**, in the same commit, with a case in the ported suites.
- **A new query stays within the supported query language**, or extends the compatibility layer with a test.
- **Nothing new imports `@instantdb/*`** outside the three modules Phase 1 leaves it in. A lint rule enforces it.

## Testing

- **The compatibility layer** is tested against an in-memory SQLite and an in-process Postgres, so the suite still needs no running services. Which libraries is a spike question.
- **The parity fixtures** run against recorded Instant results.
- **The write policy** runs the ported contract and live-matrix cases.
- **The upload route** has integration tests for acceptance, refusal, atomic rollback, idempotent retry and the `5xx` path.
- **End to end**, Playwright runs against a compose profile with Postgres and PowerSync, seeded by the import script.

Of today's 153 test files: the 17 that mock `@/lib/db` keep working because the module and its shape are unchanged; the 10 that mock `@/lib/instant-admin` follow the module split; the two contract suites and the live suite are ported, not deleted.

## Phases

Each phase ends with typechecks, the test suite and a production build passing on both values of `DATA_BACKEND`. Items marked **(you)** need David's devices or his infrastructure.

### Phase 0 — The spike

A throwaway branch. Its only output is findings written into this document's log, and the revisions to later phases that follow from them.

- **S1 — Web.** PowerSync's web SDK in this Next 16 app under Turbopack, in development and in the standalone Docker build, with the service worker caching its assets. **(you)** Open it on the wall tablet and say whether it loads, works offline, and survives being closed and reopened.
- **S2 — Phone.** `@powersync/react-native` with op-sqlite on Expo 54 and the New Architecture. **(you)** Install the build.
- **S3 — Service.** The self-hosted service with Postgres storage on the same server; camelCase tables and columns through a stream; a token signed with an inline public key; a stream filtered by `auth.parameter('type')`; messaging membership through a join.
- **S4 — Latency.** Time from a write on one device to its appearance on another, and replay of writes queued offline. PowerSync publishes no figure, so this is measured.
- **S5 — The compatibility layer.** A prototype resolving the chore tracker's query — the heaviest in the app — over an export of the real data, timed on the tablet and a phone. Measure how often the data holds an explicit `null`.
- **S6 — Switching principal.** Swap tokens without clearing the local database; confirm messaging buckets change; confirm the sync connection can keep the old session until the queue drains.
- **S7 — Refusal.** A refused upload answered with `200`, and the local revert. Confirm a `PATCH` lists only changed columns, which the kid-safe rules depend on.
- **S8 — Test tooling.** Choose the in-memory SQLite and in-process Postgres used by the suite.

Done when each has a written finding, and any that failed has a revised approach here.

### Phase 1 — One door

On `main`, with Instant still the only backend and no change in behavior. Independent of the spike.

- Every import of `id` and `tx` comes from `@/lib/db` on the web and `mobile/src/lib/instant-db.js` on the phone, instead of from `@instantdb/*`.
- `getInstantAdminDb` and token verification sit behind `lib/server-db.ts` and a session module, still implemented by Instant.
- Presence is reached through `lib/db` only.
- A lint rule forbids `@instantdb/*` anywhere else.

Done when exactly three modules import Instant and the suite passes.

### Phase 2 — The manifest, Postgres and the export

- `packages/data/manifest.ts` and its generators, with the two contract tests.
- The export script and the census, run against the live app, read-only.
- Type decisions from the census recorded in the manifest; the initial migration generated.
- Postgres and PowerSync in `docker-compose.yml`, with the setup script for keys, roles and the publication.
- The import script and its verification report.
- **(you)** A hostname for the PowerSync service through the reverse proxy.

Done when a fresh import of the live data verifies clean.

### Phase 3 — The compatibility layer

- The read resolver and the write compiler, against SQLite and Postgres.
- The parity fixtures, recorded for every distinct query in the inventory.
- The search for strict `null` and `undefined` comparisons on query results.

Done when every parity fixture matches and the write-semantics tests pass on both databases.

### Phase 4 — Identity

- `authSessions`, the session routes, `/api/sync/token`, and request authentication against sessions.
- The compatibility layer's `useAuth`, `signInWithToken` and `signOut`.
- The phone's principal provider on the same calls.
- `hasPin`, and the server route that sets a PIN.

Done when the parent-elevation, idle-demotion and device-auth tests pass on both backends.

### Phase 5 — Sync and the write rules

- The generated sync configuration and its three streams.
- `/api/sync/upload` and `packages/data/policy.ts`.
- The contract suites and the live matrix, ported.
- The PowerSync connector for web and phone, with the split between interface session and sync session.
- The refusal toast and `syncWriteRejections`.

Done when every ported permission case passes and a two-device test shows a write crossing.

### Phase 6 — The server on Postgres

- `getServerDb()` on Postgres; finance inside one transaction; unique constraints in place of key checks.
- Messaging, calendar sync, shortcuts, the content queue, exchange rates, the server actions.
- The report scripts; the backfill scripts removed.

Done when the integration suites for those areas pass on Postgres, including the finance concurrency cases.

### Phase 7 — The clients

- The web provider, worker assets, service-worker caching and the storage-persistence request.
- The phone on op-sqlite, the `backend` field in `/api/mobile/config`, and the dual-backend build.
- The presence module and its shims.
- The sync-status badge reading PowerSync's status.

Done when the staging deployment runs the whole app on an imported copy of the live data.

### Phase 8 — Rehearsal and cutover

Rehearsal, on staging:

- A full export, import and verification, timed.
- A restore of the nightly dump into an empty Postgres, to prove the backup.
- **(you)** Use staging on the wall tablet and a phone for a few real days: chores, a countdown run, a message thread, an allowance payout, offline and back.
- **(you)** Install the dual-backend phone build on every phone.

Cutover, on a quiet day:

1. Bring every device online and let it sync. Writes still queued inside Instant on a device are lost at the next step.
2. Turn on read-only mode for the app in the Instant dashboard and wait 30 seconds.
3. Export, import, verify.
4. Deploy the web app with `DATA_BACKEND=powersync`; the phones follow at next launch.
5. Smoke-test on each device before the family uses it. **This is the only point at which going back is free** — turn read-only off and redeploy the old flag.
6. After that, fix forward. Going back would discard everything written since.

Keep the Instant app read-only and untouched until the August deadline, and download a final backup. **(you)**

### Phase 9 — Cleanup

- Remove the Instant packages, `instant.schema.ts`, `instant.perms.ts`, the flag, the old token routes, the MMKV store, and the manifest-versus-schema contract test.
- Rewrite `CLAUDE.md` and `AGENTS.md`, which currently instruct every agent to build on InstantDB.
- Rewrite the README's setup, add the upgrade guide for other people running the app, and note the PowerSync licence.
- Update the reference documents in `docs/`.
- Close the roadmap items this makes moot: the hosted `choreManualStarts` deletion and the undeclared calendar attributes.
- Ship the phone build without Instant.

Not part of this plan, and worth doing afterwards: direct SQL where a screen would be faster for it; proper date and money column types; lifting the single-instance restriction; deleting the three unreferenced entities.

## Risks

| Risk | What limits it |
| --- | --- |
| The iPad PWA cannot run PowerSync's web SDK reliably | Tested first, on the real tablet, in S1. If it fails the plan is reconsidered before anything specific to PowerSync is built |
| The compatibility layer differs subtly from Instant | Parity fixtures over the real data for every query; direct tests for each write behavior |
| A rule is translated wrongly and a kid can write what they should not | The existing contract suites and live matrix are ported case by case |
| Data is lost or altered in the move | Read-only window, counts, checksums, envelope-by-envelope ledger comparison, and Instant kept intact afterwards |
| The work overruns the deadline | The 31 May 2027 trigger for self-hosting Instant |
| PowerSync changes its terms or stops | The data is in plain Postgres and the client libraries are Apache-2.0; released service versions become Apache-2.0 after two years |
| Sync Streams prove immature | PowerSync's older Sync Rules format can express the same three partitions; S3 says whether it is needed |

## Alternatives considered

Recorded so they are not reopened by accident. Checked 11–12 October 2026.

- **Zero (Rocicorp).** The closest to Instant in feel. Its documentation says offline writes are unsupported ([connection status](https://zero.rocicorp.dev/docs/offline)), which rules it out.
- **Convex.** No official offline sync; its own alpha has an open issue asking whether it is shelved ([issue](https://github.com/get-convex/curvilinear/issues/6)).
- **Electric with TanStack DB.** Workable, but Electric only syncs downward, so the write queue, its persistence and the phone's storage are assembled from separate, younger pieces.
- **Pylon.** The nearest API to Instant, with a migration guide. The repository was under six months old with one contributor ([repository](https://github.com/pylonsync/pylon)) — the same risk this migration exists to escape.
- **Self-hosted Instant.** Kept as the fallback above, not chosen as the destination: nobody has committed to maintaining it after the shutdown.
- **Rewriting every query as SQL.** Rejected in favor of the compatibility layer, for the reasons given there.

---

## Appendix A — Tables

One row per table carried over, generated from `instant.schema.ts` on `a4aed13`. "Link columns" are the columns that replace links; † marks one that already exists as an attribute. "Referenced by" is where the entity's name appears in code; an entity read only as a nested relation, such as `messageReactions`, shows fewer places than actually read it.

| Table | Columns | JSON columns | Booleans | Date-typed | Link columns (→ target) | Unique | Referenced by |
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

## Appendix B — Write rules

The translation of `instant.perms.ts` on `a4aed13`. "Family" means any signed-in principal, parent or kid.

**Family reads, parents write** (23): `announcements`, `calculatedAllowancePeriods`, `calendarItems`, `calendarSyncCalendars`, `calendarTags`, `choreAssignments`, `chores`, `contentAttachments`, `contentCategories`, `contentQueueItems`, `deviceSessions`, `exchangeRates`, `familyDashboardLayouts`, `familyDashboardWidgets`, `familyRules`, `gradeTypes`, `routineMarkerStatuses`, `routines`, `routineSteps`, `settings`, `taskSeries`, `timeOfDayDefinitions`, `unitDefinitions`. `calendarSyncCalendars` and `deviceSessions` stop syncing, so their rule becomes "server only".

**Family reads and writes** (6): `dashboardConfigs`, `taskAttachments`, `taskResponseFieldValues`, `tasks`, `taskUpdateAttachments`, `taskUpdates`.

**Append-only**: `familyRuleVersions` — a parent may insert; nobody updates or deletes. `historyEventAttachments` — family may insert; nobody updates or deletes.

**`taskResponseFields`**: parents insert, update and delete. The link rule that lets family attach values is covered by `taskResponseFieldValues` being family-writable.

**Server only, no device access**: `calendarSyncAccounts`, `calendarSyncLocks`, `calendarSyncRuns`, `pushDevices`, `shortcutTokens`.

**Messaging, read by membership, written only by the server**: `messageThreads`, `messageThreadMembers`, `messages`, `messageAttachments`, `messageReactions`, `messageAcknowledgements`. Every client write is refused today and stays refused.

**Rules that depend on who you are:**

| Table | Parent | Kid |
| --- | --- | --- |
| `familyMembers` | Insert, update, delete | Update their own row, and only `lastDisplayCurrency`, `viewShowChoreDescriptions`, `viewShowTaskDetails`, `messageQuietHoursEnabled`, `messageQuietHoursStart`, `messageQuietHoursEnd`, `messageDigestMode`, `messageDigestWindowMinutes` |
| `allowanceEnvelopes` | Insert, update, delete | Update an envelope they own, and only `name`, `description`, `goalAmount`, `goalCurrency`, `isDefault` |
| `choreCompletions` | Insert, update, delete | Insert with `allowanceAwarded` false. Update a completion they completed, and only `completed`, `notDone`, `dateCompleted`. `completedById` and `markedById` may only be set to themselves |
| `countdownRuns` | Insert, update, delete | Insert a run whose `familyMemberId` is theirs. Update their own run, and only `routineId`, `status`, `currentChoreId`, `stepStartedAt`, `stepExtensionSecs`, `stepExtensionCount`, `skippedChoreIds`, `lastInteractionAt`, `startedAt`, `stoppedAt`, `stoppedReason` |
| `historyEvents` | Insert | Insert an event whose `actorFamilyMemberId` and `actorId` are theirs. Nobody updates or deletes |
| `allowanceTransactions` | Insert with `createdBy` equal to their principal; delete | Insert with `createdBy` equal to their principal. Nobody updates |

A kid session with no family member id — the shared kid principal — fails every "their own" test, as it does today.

Link rules become rules on the link's column. Where Instant checked a `link` on the far entity — a kid may link only themselves as the completer — the check is now on the value written to `completedById`. The exact column-by-column table is produced in Phase 5 from the ported test cases, which are the authority.
