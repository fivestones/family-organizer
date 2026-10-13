# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Rules
- Do your very best to write code that is both perfectly functional and exetremely good looking.
- When you finish coding something, do not test the UI unless you have been explicitly instructed to do so. I will do the UI testing for you. That means you must skip preview verification (unless I ask you to do so for a specific case).
- After any update, bug fix, or new feature, commit it. Don't leave finished work uncommitted: once a change is complete and its checks pass, make a focused commit with a message that says what changed and why, before moving on to the next piece of work.

## Commands

```bash
# Development
npm run dev              # Start Next.js with Turbopack

# Mobile (Expo)
npm run mobile:start     # Start Expo dev server
npm run mobile:ios       # Run on iOS simulator

# Testing
npm test                 # Run all Vitest tests
npm run test:watch       # Vitest watch mode
npm run test:coverage    # Vitest with coverage report
npm run test:e2e         # Playwright E2E tests (auto-starts dev server on port 3000)
npm run test:all         # Vitest + Playwright

# Run a single test file
npx vitest run test/unit/lib/task-scheduler-date-logic.node.test.ts

# Run live InstantDB permissions smoke test (requires env vars)
npm run test:perms:live

# The part of the app that runs on PowerSync (needs Docker; each starts a throwaway Postgres + PowerSync and stops it)
npm run test:sync:live   # real devices through the real sync service, no browser
npm run test:sync:e2e    # builds the app, then Playwright in Chromium, Firefox and WebKit against /sync

# InstantDB schema management (local dev)
INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest push
INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest pull
```

**Preview every hosted schema push before confirming it.** `.env` points at the family's live Instant Cloud app, and a field missing from `instant.schema.ts` is pushed as a deletion. Run `npx instant-cli@latest push schema < /dev/null` first: it prints the plan and stops at the prompt. Only add `--yes` once the plan contains nothing but the change you mean to make. The hosted app currently has attributes the file does not declare (see the correctness sweep in `roadmap.md`), so an unpreviewed push would delete live data.

## Architecture

This is a **Next.js 16 + InstantDB** family management app. InstantDB is the sole database—there is no traditional backend DB. Live reads use the InstantDB React SDK. Ordinary permission-scoped writes may run on the client, while invariant-bearing or privileged workflows use authenticated App Router endpoints/server actions backed by the Admin SDK.

### Key architectural layers

**Client DB** (`lib/db.ts`): the single `@instantdb/react` entrypoint, initialized with `instant.schema.ts` for typed queries and transactions. Components use `db.useQuery(...)` for live data; writes stay client-side only when Instant permissions are the complete authorization/integrity boundary.

**Data layer** (`packages/data`, bound for the web in `lib/data.ts` and for the phone in `mobile/src/lib/instant-db.js`): the app is moving off InstantDB to PowerSync ([docs/powersync-migration.md](docs/powersync-migration.md), roadmap Scope 7), and screens are moving, area by area, to typed reads and mutations in this package — `useSetting('countdown')`, `saveSetting(...)`. An area that has moved is reached only through it; do not add a query or a `transact` for it to a component. `test/contracts/instant-boundary.contract.node.test.ts` lists every file that still reaches Instant directly and fails if a new one does. Read `packages/data/README.md` before adding to it.

**The move to PowerSync, so far** ([docs/powersync-migration.md](docs/powersync-migration.md); its log is the record). A slice of the app runs on Postgres and PowerSync beside the InstantDB app, on any deployment that sets `DATABASE_URL`:
- `db/migrations/*.sql` is the Postgres schema, applied by the server as it starts; `db/types.ts` types it for Kysely and a contract test holds the two together. `lib/server/` is the server on Postgres: its connection, sessions, the upload route's logic, the sync token.
- `packages/data/src/policy/` is the write rules, shared by device and server. `packages/data/src/powersync/` is the data layer over a person's local database, and `packages/data/src/session/manager.ts` decides whose database is whose. `powersync/` is the sync service's configuration.
- `/sync` is the web client of that slice, with a frame of its own; every other page gets the InstantDB frame from `components/AppShell.tsx`.
- Adding a synced table means a migration (which also adds it to the publication), its columns in `powersync/sync-config.yaml`, its table in `packages/data/src/powersync/schema.ts`, its entry in the policy, and its part of `scripts/migrate/mapping.mjs`. Contract tests fail if these disagree. A table only the server reads gets the migration, without the publication, and its part of the mapping. `db/migrations/` now holds the whole schema; the Instant schema file is what the live app still runs on.
- `node scripts/migrate/rehearse.mjs` imports the newest export under `.migration/exports/` into an in-process Postgres and verifies it, printing counts only. Run it after changing a migration, the mapping or the verification. The export is the family's real data: never commit it, and never write a stored value — a name, a chore's title, a message — into a file, a test or a commit message.

**Server/Admin** (`lib/instant-admin.ts`): `@instantdb/admin` for verified principal-token minting, finance ledger mutations, messaging, calendar sync, file finalization, and other workflows that require fresh reads, cross-row invariants, or elevated writes. Used by routes under `app/api/` and authenticated server actions in `app/actions.ts`.

**Schema** (`instant.schema.ts`): Single source of truth for all entities and their links. Modify here and push with `instant-cli`. Key entities include `familyMembers`, chores/task-series records, allowance envelopes/transactions, calendar and sync records, history events, messaging records, and device sessions.

**Permissions** (`instant.perms.ts`): CEL-based rules pushed to InstantDB. Changes must be pushed to take effect.

### Auth / device access model

Two-layer auth:
1. **Device auth** (`lib/device-auth.ts`): A `DEVICE_ACCESS_KEY` cookie gates the entire app. `middleware.ts` enforces this — unauthenticated devices are redirected to `/activate`. The `/api/device-activate` endpoint validates a shared secret from the environment and sets the cookie.
2. **Principal/role** (`lib/instant-principal-types.ts`, `lib/parent-mode.ts`): Within the app, family members log in by PIN. Principals are `kid` | `parent` | `unknown`. Parent elevation goes through `lib/parent-elevation-rate-limit.ts` and mints short-lived tokens via `/api/instant-auth-parent-token`. `components/auth/ParentGate.tsx` is the component-level guard for parent-only pages and `components/auth/LoginModal.tsx` handles PIN entry and family member selection.

### Web app pages and features

**Routes (App Router):**
- First, you have to activate the app. If you try to load any route before doing this, you will get a 404 not found error. After the server is running, get `DEVICE_ACCESS_KEY` from the .env file, and go to `http://<ip>:<port>/?activate=<DEVICE_ACCESS_KEY>`. This will activate you and immediately redirect you to `/`. Then you will be able to get to any of the other routes without a 404 error.
- `/activate` — Device activation screen (enter shared `DEVICE_ACCESS_KEY`). You should not use this to activate; it's for human use and you can use the method described above for quicker access.
- `/` — Main chore dashboard (`ChoresTracker` + `ChoreList`). Family member sidebar, date carousel, add/edit/delete chores, task series checklists with file attachment previews, marks completions.
- `/countdown` — The countdown runner. Start, and a step gets a timer for its own duration; finish it and the next begins. Shows one or several family members' runs, with ahead/behind and a deadline forecast. Reads and writes `countdownRuns`.
- `/routines` — Routine manager (parent-only). A routine is a named, ordered group of chores, built from existing chores or from typed steps whose chores are created on save.
- `/calendar` — Multi-week calendar with drag-and-drop events. Supports both Gregorian and Nepali (Bikram Samvat) views. Displays chore dates and calendar items.
- `/task-series` — Task series manager (parent-only). Lists all series with status filters (draft/pending/in_progress/archived), batch delete, progress tracking.
- `/task-series/new` and `/task-series/[seriesId]` — TipTap-based rich text editor for creating/editing task series. Supports slash commands, nested task indentation, drag-and-drop reordering, and day-break markers.
- `/familyMemberDetail` — Per-member allowance management: multiple currency envelopes, deposits/withdrawals/transfers between envelopes or to other members, transaction history, savings goals, recurring allowance schedule setup.
- `/allowance-distribution` — Parent-only allowance distribution workflow. Selects a period, calculates weight-based completion percentage, handles fixed up-for-grabs rewards, previews and executes payouts.
- `/files` — File manager backed by S3/MinIO. Upload images (resized server-side to 64/320/1200px via Sharp) and documents, grid gallery view, preview modal.
- `/settings` — Parent-only currency settings (toggle enabled currencies; at least one required).


**Key components to know:**
- `ChoresTracker.tsx` / `ChoreList.tsx` — the core chore UI; chore display, completion toggling, and the `DetailedChoreForm.tsx` dialog for creating/editing chores (rrule picker, rotation, weight, up-for-grabs, reward type/currency, date preview).
- `MainNav.tsx` — the header navigation. `NAV_ENTRIES` is the single list of pages: a new route gets its link by being added there, as a page of its own or inside a group.
- `FamilyMembersList.tsx` — member management with photo upload (crop), drag-and-drop reorder (Atlaskit PDND), role and PIN configuration.
- `TaskSeriesChecklist.tsx` — renders the rolling-queue task list inside a chore row, including nested sub-tasks, file/note previews, and a completion fireworks animation.
- `components/allowance/MemberAllowanceDetail.tsx` — the full envelope finance UI for one member (the largest single component at ~61KB).
- `components/countdown/` — `useCountdownRunner.ts` reads the day and owns every write to a run; `RunnerPanel.tsx` draws one person's countdown; `FocusedCountdownPage.tsx` is the page shell. `SequenceTimeline.tsx` is the separate parent-facing plan view at `/chores/all`.
- `components/routines/` — `RoutineManager.tsx` and `RoutineEditor.tsx` for `/routines`; `RoutineDayRows.tsx` is the collapsed routine row in the day list.

**Server API routes:**
- `POST /api/device-activate` — sets device auth cookie
- `/api/instant-auth-*` — mint kid/parent InstantDB principal tokens after server-side verification
- `POST /api/finance/mutations` — performs authenticated ledger mutations with fresh server reads and invariant checks
- `/api/messages/*` — bootstraps threads and performs message, reaction, acknowledgement, read-state, watch, and preference mutations
- `/api/calendar-sync/apple/*` — parent/cron-authenticated Apple Calendar connection and sync operations
- `POST /api/avatar-variants` — authenticated multipart fallback for already-resized avatar variants
- `/api/mobile/*` — bearer-authenticated mobile device, principal, file, and iOS Shortcut endpoints

### Core business logic

- **Chore scheduling** (`lib/chore-utils.ts`): `rrule`-based recurrence. `createRRuleWithStartDate` / `toUTCDate` are the key helpers. Rotation types (`none` | `daily` | `weekly` | `monthly`) determine which family member is assigned on a given date.
- **Countdown** (`packages/shared-core/src/chore-countdown-engine.ts`, `chore-countdown-runner.ts`): two clocks. The planner packs chores as late as their deadlines allow and is only the yardstick; the runner drives the ring from `stepStartedAt + durationSecs`, honours each timing mode's earliest-allowed gate, and builds every patch written to a `countdownRuns` row. Specified in `docs/countdown-redesign.md`.
- **Chore completion** (`lib/chore-completion.ts`): the one way a chore is marked done or not done on the web — history event, `markedBy` link, and the up-for-grabs claim guard. The day list, the countdown and the sequence view all build their writes here.
- **Routines** (`packages/shared-core/src/routines.ts`, `routine-summary.ts`, `lib/routine-mutations.ts`): `routineSteps` is a join row carrying `position`. A chore is folded into its routine's day-list row when it has a routine step *and* `hideFromDayList` is true; the flag is inert otherwise.
- **Task series scheduler** (`lib/task-scheduler.ts`): `getTasksForDate` implements the "rolling queue" — tasks in a series advance based on completion, not calendar date. Day-break entities (`isDayBreak: true`) act as paginators between sessions.
- **Allowance** (`lib/chore-utils.ts` `CalculatedPeriod`): Weight-based percentage completion, fixed rewards for "up for grabs" chores, multi-currency envelope deposits.
- **Time machine** (`lib/time-machine.ts`): Dev/test utility that patches `Date` via a `localStorage` offset (`debug_time_offset`). Used extensively in tests; `packages/shared-core/src/time-provider.ts` exposes `getNow()` which tests can override.

### File storage

S3-compatible object storage (MinIO in self-hosted setup). Authenticated server actions in `app/actions.ts` issue constrained presigned uploads, finalize attachment metadata, list/delete objects for parents, and sweep orphaned task uploads. The browser creates 64/320/1200px PNG avatar variants and uploads them with parent-authorized presigned posts; `POST /api/avatar-variants` is the authenticated multipart fallback. Configured via `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` env vars.

### Monorepo workspace packages

- **`packages/shared-core`** (`@family-organizer/shared-core`): Pure TS utilities shared between web and mobile. Contains `chores.ts`, `date.ts`, `time-provider.ts`.
- **`packages/mobile-contracts`**: API contract types between the Next.js backend and the Expo mobile client.

### Mobile app (`mobile/`)

Expo/React Native app using Expo Router. Uses a **hybrid backend**: InstantDB (`@instantdb/react-native`) for live real-time queries and permission-scoped writes, plus Next.js routes for device/principal auth, files, iOS Shortcuts, messaging, and finance mutations. The mobile app does not talk to InstantDB admin directly—privileged or invariant-bearing operations go through the API. Base URL configured via `EXPO_PUBLIC_API_BASE_URL` (defaults to `http://localhost:3000`). API client lives in `mobile/src/lib/api-client.js`.

**Auth/session flow (mobile-specific):** Three provider layers compose in `mobile/src/providers/AppProviders.js`:
1. `DeviceSessionProvider` — device activation token persisted in AsyncStorage; refreshed on app resume. Activation calls `POST /api/mobile/device-activate`.
2. `InstantPrincipalProvider` — manages kid/parent InstantDB principal switching. Parent elevation calls `POST /api/mobile/instant-auth-parent-token` with PIN. In shared-device mode, parents are auto-demoted after a configurable idle timeout (default 15 min), tracked via `InteractionCapture`.
3. `FamilyAuthProvider` — tracks the currently selected family member; restores last selection on launch.

Navigation: unauthenticated device → `/activate`; no member selected → `/lock`; authenticated → tab navigator (`/dashboard`, `/chores`, `/calendar`, `/finance`, `/more`).

**Implemented screens:**
- **Dashboard** — XP scores, 7-day chore/task summary, recent transactions
- **Chores** — date-navigable chore list with per-member filtering and completion status; routine steps fold into a row per routine
- **Countdown** (`app/countdown.js`, `src/features/countdown/`) — the same runner as the web `/countdown`, one person at a time, reached from the Chores header and from More
- **Calendar** — Gregorian + Nepali (Bikram Samvat) calendar views with chore/task overlays
- **Finance** — multi-currency envelope balances, transaction history, envelope management modals
- **More > Task Series** (parent) — live task series status and checklist progress
- **More > Family Members** (parent) — household roster with roles and photo profiles
- **More > Settings** — theme selection, unit/currency definitions
- **More > Files** (parent) — file browser backed by S3
- **More > Allowance Distribution** (parent, preview) — payout readiness preview
- **More > Dev Tools** (parent) — session state inspection and debug metadata
- **Lock screen** — multi-member grid with PIN entry, parent elevation, shared-device mode toggle

## Test conventions

Test files live under `test/` and `e2e/`:

- `*.node.test.ts` — Node environment (default vitest env)
- `*.dom.test.ts` — Browser environment; add `// @vitest-environment jsdom` at top of file
- `test/unit/` — Pure logic; `test/integration/` — route handlers/middleware; `test/contracts/` — schema/permission regression guards; `test/dom/` — React component behavior
- `e2e/` — Playwright browser flows

Time-sensitive tests (recurrence, allowance periods, parent idle expiry) should use `test/utils/fake-clock.ts` rather than raw `vi.useFakeTimers()`. E2E time travel uses `e2e/support/time-machine.ts`.

When mocking InstantDB in jsdom tests, mock `@/lib/db` to avoid booting the real Instant client/IndexedDB layer. Mock Radix UI primitives when testing form logic rather than UI internals.

## Environment variables

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_INSTANT_APP_ID` | InstantDB app ID (client) |
| `INSTANT_APP_ID` | InstantDB app ID (server/admin) |
| `INSTANT_APP_ADMIN_TOKEN` | InstantDB admin token |
| `NEXT_PUBLIC_INSTANT_API_URI` | Override InstantDB API URL (local dev) |
| `NEXT_PUBLIC_INSTANT_WEBSOCKET_URI` | Override InstantDB WS URL (local dev) |
| `DEVICE_ACCESS_KEY` | Shared secret for device activation |
| `DEVICE_AUTH_COOKIE_DOMAIN` | Optional parent domain for activation-cookie SSO across sibling subdomains |
| `NEXT_PUBLIC_ENABLE_TIME_MACHINE` | Explicitly enable the debug Date patch in production (normally unset) |
| `S3_ENDPOINT` / `NEXT_PUBLIC_S3_ENDPOINT` | MinIO/S3 endpoints (internal/public) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET_NAME` | S3 credentials |
| `DATABASE_URL` | Postgres for the part of the app that runs on PowerSync. Unset on every InstantDB-only deployment |
| `DATA_BACKEND` | `powersync` sends every page to `/sync`, the part of the app that runs on it. Read at run time |
| `POWERSYNC_JWT_PRIVATE_KEY` / `POWERSYNC_JWT_KID` / `POWERSYNC_JWK_N` / `POWERSYNC_JWK_E` | The key the app signs sync tokens with, and its public half for the sync service. `node scripts/powersync/setup-env.mjs` prints all of these |
| `POSTGRES_PASSWORD` / `POWERSYNC_DB_PASSWORD` | For the Postgres and PowerSync services in `docker-compose.yml`'s `powersync` profile |

Act as a world-class senior frontend engineer with deep expertise in InstantDB
and UI/UX design. Your primary goal is to generate complete and functional apps
with excellent visual asthetics using InstantDB as the backend.

# About InstantDB aka Instant

Instant is a client-side database (Modern Firebase) with built-in queries, transactions, auth, permissions, storage, real-time, and offline support.

# Instant SDKs

Instant provides client-side JS SDKs and an admin SDK:

- `@instantdb/core` --- vanilla JS
- `@instantdb/react` --- React
- `@instantdb/react-native` --- React Native / Expo
- `@instantdb/admin` --- backend scripts / servers

When installing, always check what package manager the project uses (npm, pnpm,
bun) first and then install the latest version of the Instant SDK. If working in
React use Next and Tailwind unless specified otherwise.

# Managing Instant Apps

## Prerequisites

Look for `instant.schema.ts` and `instant.perms.ts`. These define the schema and permissions.
Look for an app id and admin token in `.env` or another env file.

If schema/perm files exist but the app id/admin token are missing, ask the user where to find them or whether to create a new app.

To create a new app:

```bash
npx instant-cli init-without-files --title <APP_NAME>
```

This outputs an app id and admin token. Store them in an env file.

If you get an error related to not being logged in tell the user to:

- Sign up for free or log in at https://instantdb.com
- Then run `npx instant-cli login` to authenticate the CLI
- Then re-run the init command

If you have an app id/admin token but no schema/perm files, pull them:

```bash
npx instant-cli pull --yes
```

## Schema changes

Edit `instant.schema.ts`, then push:

```bash
npx instant-cli push schema --yes
```

New fields = additions; missing fields = deletions.

To rename fields:

```bash
npx instant-cli push schema --rename 'posts.author:posts.creator stores.owner:stores.manager' --yes
```

## Permission changes

Edit `instant.perms.ts`, then push:

```bash
npx instant-cli push perms --yes
```

# CRITICAL Query Guidelines

CRITICAL: When using React make sure to follow the rules of hooks. Remember, you can't have hooks show up conditionally.

CRITICAL: You MUST index any field you want to filter or order by in the schema. If you do not, you will get an error when you try to filter or order by it.

Here is how ordering works:

```
Ordering:        order: { field: 'asc' | 'desc' }

Example:         $: { order: { dueDate: 'asc' } }

Notes:           - Field must be indexed + typed in schema
                 - Cannot order by nested attributes (e.g. 'owner.name')
```

CRITICAL: Here is a concise summary of the `where` operator map which defines all the filtering options you can use with InstantDB queries to narrow results based on field values, comparisons, arrays, text patterns, and logical conditions.

```
Equality:        { field: value }

Inequality:      { field: { $ne: value } }

Null checks:     { field: { $isNull: true | false } }

Comparison:      $gt, $lt, $gte, $lte   (indexed + typed fields only)

Sets:            { field: { $in: [v1, v2] } }

Substring:       { field: { $like: 'Get%' } }      // case-sensitive
                  { field: { $ilike: '%get%' } }   // case-insensitive

Logic:           and: [ {...}, {...} ]
                  or:  [ {...}, {...} ]

Nested fields:   'relation.field': value
```

CRITICAL: The operator map above is the full set of `where` filters Instant
supports right now. There is no `$exists`, `$nin`, or `$regex`. And `$like` and
`$ilike` are what you use for `startsWith` / `endsWith` / `includes`.

CRITICAL: Pagination keys (`limit`, `offset`, `first`, `after`, `last`, `before`) only work on top-level namespaces. DO NOT use them on nested relations or else you will get an error.

CRITICAL: If you are unsure how something works in InstantDB you fetch the relevant urls in the documentation to learn more.

# CRITICAL Permission Guidelines

Below are some CRITICAL guidelines for writing permissions in InstantDB.

## `data.ref`

- Use `data.ref("<path.to.attr>")` for linked attributes.
- Always returns a **list**.
- Must end with an **attribute**.

**Correct**

```cel
auth.id in data.ref('post.author.id') // auth.id in list of author ids
data.ref('owner.id') == [] // there is no owner
```

**Errors**

```cel
auth.id in data.post.author.id
auth.id in data.ref('author')
data.ref('admins.id') == auth.id
auth.id == data.ref('owner.id')
data.ref('owner.id') == null
data.ref('owner.id').length > 0
```

## `auth.ref`

- Same as `data.ref` but path must start with `$user`.
- Returns a list.

**Correct**

```cel
'admin' in auth.ref('$user.role.type')
auth.ref('$user.role.type')[0] == 'admin'
```

**Errors**

```cel
auth.ref('role.type')
auth.ref('$user.role.type') == 'admin'
```

## Unsupported

```cel
newData.ref('x')
data.ref(someVar + '.members.id')
```

## $users Permissions

- Default `view` permission is `auth.id == data.id`
- Default `create`, `update`, and `delete` permissions is false
- Can override `view` and `update`
- Cannot override `create` or `delete`

## $files Permissions

- Default permissions are all false. Override as needed to allow access.
- `data.ref` does not work for `$files` permissions.
- Use `data.path.startsWith(...)` or `data.path.endsWith(...)` to write
  path-based rules.

## Field-level Permissions

Restrict access to specific fields while keeping the entity public:

```json
{
  "$users": {
    "allow": {
      "view": "true"
    },
    "fields": {
      "email": "auth.id == data.id"
    }
  }
}
```

Notes:

- Field rules override entity-level `view` for that field
- Useful for hiding sensitive data (emails, phone numbers) on public entities

# Best Practices

## Pass `schema` when initializing Instant

Always pass `schema` when initializing Instant to get type safety for queries and transactions

```tsx
import schema from '@/instant.schema`

// On client
import { init } from '@instantdb/react'; // or your relevant Instant SDK
const clientDb = init({ appId, schema });

// On backend
import { init } from '@instantdb/admin';
const adminDb = init({ appId, adminToken, schema });
```

## Use `id()` to generate ids

Always use `id()` to generate ids for new entities

```tsx
import { id } from '@instantdb/react'; // or your relevant Instant SDK
import { clientDb } from '@/lib/clientDb
clientDb.transact(clientDb.tx.todos[id()].create({ title: 'New Todo' }));
```

## Use Instant utility types for data models

Always use Instant utility types to type data models

```tsx
import { AppSchema } from '@/instant.schema';

type Todo = InstaQLEntity<AppSchema, 'todos'>; // todo from clientDb.useQuery({ todos: {} })
type PostsWithProfile = InstaQLEntity<
  AppSchema,
  'posts',
  { author: { avatar: {} } }
>; // post from clientDb.useQuery({ posts: { author: { avatar: {} } } })
```

## Use `db.useAuth` or `db.subscribeAuth` for auth state

```tsx
import { clientDb } from '@/lib/clientDb';

// For react/react-native apps use db.useAuth
function App() {
  const { isLoading, user, error } = clientDb.useAuth();
  if (isLoading) { return null; }
  if (error) { return <Error message={error.message /}></div>; }
  if (user) { return <Main />; }
  return <Login />;
}

// For vanilla JS apps use db.subscribeAuth
function App() {
  renderLoading();
  db.subscribeAuth((auth) => {
    if (auth.error) { renderAuthError(auth.error.message); }
    else if (auth.user) { renderLoggedInPage(auth.user); }
    else { renderSignInPage(); }
  });
}
```

# Ad-hoc queries & transactions

Use `@instantdb/admin` to run ad-hoc queries and transactions on the backend.
Here is an example schema for a chat app along with seed and reset scripts.

```tsx
// instant.schema.ts
const _schema = i.schema({
  entities: {
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    profiles: i.entity({
      displayName: i.string(),
    }),
    channels: i.entity({
      name: i.string().indexed(),
    }),
    messages: i.entity({
      content: i.string(),
      timestamp: i.number().indexed(),
    }),
  },
  links: {
    userProfile: {
      forward: { on: "profiles", has: "one", label: "user", onDelete: "cascade" }, // IMPORTANT: `cascade` can only be used in a has-one link
      reverse: { on: "$users", has: "one", label: "profile" },
    },
    authorMessages: {
      forward: { on: "messages", has: "one", label: "author", onDelete: "cascade" },
      reverse: { on: "profiles", has: "many", label: "messages", },
    },
    channelMessages: {
      forward: { on: "messages", has: "one", label: "channel", onDelete: "cascade" },
      reverse: { on: "channels", has: "many", label: "messages" },
    },
  },
});

// scripts/seed.ts
import { id } from "@instantdb/admin";
import { adminDb } from "@/lib/adminDb";

const users: Record<string, User> = { ... }
const channels: Record<string, Channel> = { ... }
const mockMessages: Message[] = [ ... ]

function seed() {
  console.log("Seeding db...");
  const userTxs = Object.values(users).map(u => adminDb.tx.$users[u.id].create({}));
  const profileTxs = Object.values(users).map(u => adminDb.tx.profiles[u.id].create({ displayName: u.displayName }).link({ user: u.id }));
  const channelTxs = Object.values(channels).map(c => adminDb.tx.channels[c.id].create({ name: c.name }))
  const messageTxs = mockMessages.map(m => {
    const messageId = id();
    return adminDb.tx.messages[messageId].create({
      content: m.content,
      timestamp: m.timestamp,
    })
      .link({ author: users[m.author].id })
      .link({ channel: channels[m.channel].id });
  })

  adminDb.transact([...userTxs, ...profileTxs, ...channelTxs, ...messageTxs]);
}

seed();

// scripts/reset.ts
import { adminDb } from "@/lib/adminDb";

async function reset() {
  console.log("Resetting database...");
  const { $users, channels } = await adminDb.query({ $users: {}, channels: {} });

  // Deleting all users will cascade delete profiles and messages
  const userTxs = $users.map(user => adminDb.tx.$users[user.id].delete());

  const channelTxs = channels.map(channel => adminDb.tx.channels[channel.id].delete());
  adminDb.transact([...userTxs, ...channelTxs]);
}

reset();
```

# Instant Documentation

The bullets below are links to the Instant documentation. They provide detailed information on how to use different features of InstantDB. Each line follows the pattern of

- [TOPIC](URL): Description of the topic.

Fetch the URL for a topic to learn more about it.

- [Common mistakes](https://instantdb.com/docs/common-mistakes.md): Common mistakes when working with Instant
- [Initializing Instant](https://instantdb.com/docs/init.md): How to integrate Instant with your app.
- [Modeling data](https://instantdb.com/docs/modeling-data.md): How to model data with Instant's schema.
- [Writing data](https://instantdb.com/docs/instaml.md): How to write data with Instant using InstaML.
- [Reading data](https://instantdb.com/docs/instaql.md): How to read data with Instant using InstaQL.
- [Instant on the Backend](https://instantdb.com/docs/backend.md): How to use Instant on the server with the Admin SDK.
- [Patterns](https://instantdb.com/docs/patterns.md): Common patterns for working with InstantDB.
- [Auth](https://instantdb.com/docs/auth.md): Instant supports magic code, OAuth, Clerk, and custom auth.
- [Auth](https://instantdb.com/docs/auth/magic-codes.md): How to add magic code auth to your Instant app.
- [Managing users](https://instantdb.com/docs/users.md): How to manage users in your Instant app.
- [Presence, Cursors, and Activity](https://instantdb.com/docs/presence-and-topics.md): How to add ephemeral features like presence and cursors to your Instant app.
- [Instant CLI](https://instantdb.com/docs/cli.md): How to use the Instant CLI to manage schema.
- [Storage](https://instantdb.com/docs/storage.md): How to upload and serve files with Instant.
- [Stripe Payments](https://instantdb.com/docs/stripe-payments.md): How to integrate Stripe payments with Instant.

# Final Note

Think before you answer. Make sure your code passes typechecks `tsc --noEmit` and works as expected.
Remember! AESTHETICS ARE VERY IMPORTANT. All apps should LOOK AMAZING and have GREAT FUNCTIONALITY!
