# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

# InstantDB schema management (local dev)
INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest push
INSTANT_CLI_DEV=1 INSTANT_CLI_API_URI="http://localhost:8888" npx instant-cli@latest pull
```

## Architecture

This is a **Next.js 16 + InstantDB** family management app. InstantDB is the sole database—there is no traditional backend DB. All data sync happens client-side via the InstantDB React SDK, with the server-side Admin SDK used only for privileged operations (auth token minting, admin writes).

### Key architectural layers

**Client DB** (`lib/db.ts`): `@instantdb/react` initialized with `instant.schema.ts` for typed queries. All client components use `db.useQuery(...)` for live data and `db.transact(...)` for writes.

**Server/Admin** (`lib/instant-admin.ts`): `@instantdb/admin` for operations requiring elevated privileges. Used in API routes under `app/api/`.

**Schema** (`instant.schema.ts`): Single source of truth for all entities and their links. Modify here and push with `instant-cli`. Key entities: `familyMembers`, `chores`, `choreAssignments`, `choreCompletions`, `taskSeries`, `tasks`, `allowanceEnvelopes`, `allowanceTransactions`, `calendarItems`, `deviceSessions`.

**Permissions** (`instant.perms.ts`): CEL-based rules pushed to InstantDB. Changes must be pushed to take effect.

### Auth / device access model

Two-layer auth:
1. **Device auth** (`lib/device-auth.ts`): A `DEVICE_ACCESS_KEY` cookie gates the entire app. `middleware.ts` enforces this — unauthenticated devices are redirected to `/activate`. The `/api/device-activate` endpoint validates a shared secret from the environment and sets the cookie.
2. **Principal/role** (`lib/instant-principal-types.ts`, `lib/parent-mode.ts`): Within the app, family members log in by PIN. Principals are `kid` | `parent` | `unknown`. Parent elevation goes through `lib/parent-elevation-rate-limit.ts` and mints short-lived tokens via `/api/instant-auth-parent-token`. `components/auth/ParentGate.tsx` is the component-level guard for parent-only pages and `components/auth/LoginModal.tsx` handles PIN entry and family member selection.

### Web app pages and features

**Routes (App Router):**
- `/` — Main chore dashboard (`ChoresTracker` + `ChoreList`). Family member sidebar, date carousel, add/edit/delete chores, task series checklists with file attachment previews, marks completions.
- `/calendar` — Multi-week calendar with drag-and-drop events. Supports both Gregorian and Nepali (Bikram Samvat) views. Displays chore dates and calendar items.
- `/task-series` — Task series manager (parent-only). Lists all series with status filters (draft/pending/in_progress/archived), batch delete, progress tracking.
- `/task-series/new` and `/task-series/[seriesId]` — TipTap-based rich text editor for creating/editing task series. Supports slash commands, nested task indentation, drag-and-drop reordering, and day-break markers.
- `/familyMemberDetail` — Per-member allowance management: multiple currency envelopes, deposits/withdrawals/transfers between envelopes or to other members, transaction history, savings goals, recurring allowance schedule setup.
- `/allowance-distribution` — Parent-only allowance distribution workflow. Selects a period, calculates weight-based completion percentage, handles fixed up-for-grabs rewards, previews and executes payouts.
- `/files` — File manager backed by S3/MinIO. Upload images (resized server-side to 64/320/1200px via Sharp) and documents, grid gallery view, preview modal.
- `/settings` — Parent-only currency settings (toggle enabled currencies; at least one required).
- `/activate` — Device activation screen (enter shared `DEVICE_ACCESS_KEY`).

**Key components to know:**
- `ChoresTracker.tsx` / `ChoreList.tsx` — the core chore UI; chore display, completion toggling, and the `DetailedChoreForm.tsx` dialog for creating/editing chores (rrule picker, rotation, weight, up-for-grabs, reward type/currency, date preview).
- `FamilyMembersList.tsx` — member management with photo upload (crop), drag-and-drop reorder (Atlaskit PDND), role and PIN configuration.
- `TaskSeriesChecklist.tsx` — renders the rolling-queue task list inside a chore row, including nested sub-tasks, file/note previews, and a completion fireworks animation.
- `components/allowance/MemberAllowanceDetail.tsx` — the full envelope finance UI for one member (the largest single component at ~61KB).

**Server API routes:**
- `POST /api/device-activate` — sets device auth cookie
- `GET /api/instant-auth-token` / `POST /api/instant-auth-parent-token` — mint InstantDB principal tokens
- `POST /api/upload` (pages/api) — image upload with Sharp resizing
- `POST /api/delete-image` (pages/api) — image deletion
- `/api/mobile/*` — mobile-specific mirrors of auth/device/file endpoints

### Core business logic

- **Chore scheduling** (`lib/chore-utils.ts`): `rrule`-based recurrence. `createRRuleWithStartDate` / `toUTCDate` are the key helpers. Rotation types (`none` | `daily` | `weekly` | `monthly`) determine which family member is assigned on a given date.
- **Task series scheduler** (`lib/task-scheduler.ts`): `getTasksForDate` implements the "rolling queue" — tasks in a series advance based on completion, not calendar date. Day-break entities (`isDayBreak: true`) act as paginators between sessions.
- **Allowance** (`lib/chore-utils.ts` `CalculatedPeriod`): Weight-based percentage completion, fixed rewards for "up for grabs" chores, multi-currency envelope deposits.
- **Time machine** (`lib/time-machine.ts`): Dev/test utility that patches `Date` via a `localStorage` offset (`debug_time_offset`). Used extensively in tests; `packages/shared-core/src/time-provider.ts` exposes `getNow()` which tests can override.

### File storage

S3-compatible object storage (MinIO in self-hosted setup). Presigned URLs generated server-side in `app/actions.ts`. Image uploads go through `pages/api/upload.ts` which uses Sharp to produce three sizes (64px, 320px, 1200px). Configured via `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME` env vars.

### Monorepo workspace packages

- **`packages/shared-core`** (`@family-organizer/shared-core`): Pure TS utilities shared between web and mobile. Contains `chores.ts`, `date.ts`, `time-provider.ts`.
- **`packages/mobile-contracts`**: API contract types between the Next.js backend and the Expo mobile client.

### Mobile app (`mobile/`)

Expo/React Native app using Expo Router. Uses a **hybrid backend**: InstantDB (`@instantdb/react-native`) for live real-time queries/writes, plus the Next.js `/api/mobile/*` routes for auth token minting and device management. The mobile app does not talk to InstantDB admin directly — privileged ops go through the API. Base URL configured via `EXPO_PUBLIC_API_BASE_URL` (defaults to `http://localhost:3000`). API client lives in `mobile/src/lib/api-client.js`.

**Auth/session flow (mobile-specific):** Three provider layers compose in `mobile/src/providers/AppProviders.js`:
1. `DeviceSessionProvider` — device activation token persisted in AsyncStorage; refreshed on app resume. Activation calls `POST /api/mobile/device-activate`.
2. `InstantPrincipalProvider` — manages kid/parent InstantDB principal switching. Parent elevation calls `POST /api/mobile/instant-auth-parent-token` with PIN. In shared-device mode, parents are auto-demoted after a configurable idle timeout (default 15 min), tracked via `InteractionCapture`.
3. `FamilyAuthProvider` — tracks the currently selected family member; restores last selection on launch.

Navigation: unauthenticated device → `/activate`; no member selected → `/lock`; authenticated → tab navigator (`/dashboard`, `/chores`, `/calendar`, `/finance`, `/more`).

**Implemented screens:**
- **Dashboard** — XP scores, 7-day chore/task summary, recent transactions
- **Chores** — date-navigable chore list with per-member filtering and completion status
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
| `S3_ENDPOINT` / `NEXT_PUBLIC_S3_ENDPOINT` | MinIO/S3 endpoints (internal/public) |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_BUCKET_NAME` | S3 credentials |

## InstantDB reference

Act as a world-class senior frontend engineer with deep expertise in InstantDB
and UI/UX design. Your primary goal is to generate complete and functional apps
with excellent visual aesthetics using InstantDB as the backend.

### About InstantDB

Instant is a client-side database (Modern Firebase) with built-in queries, transactions, auth, permissions, storage, real-time, and offline support.

SDKs:
- `@instantdb/core` — vanilla JS
- `@instantdb/react` — React
- `@instantdb/react-native` — React Native / Expo
- `@instantdb/admin` — backend scripts / servers

### Managing the schema and permissions

`instant.schema.ts` and `instant.perms.ts` define the schema and permissions. App ID and admin token are in `.env`.

**Schema changes** — edit `instant.schema.ts`, then push:
```bash
npx instant-cli push schema --yes
# New fields = additions; missing fields = deletions.
# To rename: npx instant-cli push schema --rename 'posts.author:posts.creator' --yes
```

**Permission changes** — edit `instant.perms.ts`, then push:
```bash
npx instant-cli push perms --yes
```

**Pull current schema/perms from hosted app:**
```bash
npx instant-cli pull --yes
```

### CRITICAL query guidelines

- **Index any field** used in `where` filters or `order` in the schema, or you will get a runtime error.
- **Pagination** (`limit`, `offset`, `first`, `after`, `last`, `before`) only works on top-level namespaces — never on nested relations.
- **Rules of hooks** — never call `db.useQuery` conditionally.

Ordering:
```
order: { field: 'asc' | 'desc' }   // field must be indexed + typed; cannot order by nested attrs
```

Full `where` operator map:
```
Equality:      { field: value }
Inequality:    { field: { $ne: value } }
Null checks:   { field: { $isNull: true | false } }
Comparison:    $gt, $lt, $gte, $lte   (indexed + typed fields only)
Sets:          { field: { $in: [v1, v2] } }
Substring:     { field: { $like: 'Get%' } }      // case-sensitive
               { field: { $ilike: '%get%' } }    // case-insensitive
Logic:         and: [ {...}, {...} ]  /  or: [ {...}, {...} ]
Nested fields: 'relation.field': value
```

There is no `$exists`, `$nin`, or `$regex`. Use `$like`/`$ilike` for startsWith/endsWith/includes patterns.

If unsure how something works, fetch the relevant InstantDB docs URL listed at the end of this section.

### CRITICAL permission guidelines

**`data.ref`** — use for linked attributes; always returns a **list**; must end with an attribute.
```cel
// Correct
auth.id in data.ref('post.author.id')
data.ref('owner.id') == []

// Wrong
auth.id in data.post.author.id
auth.id == data.ref('owner.id')
data.ref('owner.id') == null
```

**`auth.ref`** — same as `data.ref` but path must start with `$user`.
```cel
// Correct
'admin' in auth.ref('$user.role.type')

// Wrong
auth.ref('role.type')
auth.ref('$user.role.type') == 'admin'
```

**`newData.ref`** and dynamic paths are unsupported.

**`$users`** — default `view` is `auth.id == data.id`; `create` and `delete` cannot be overridden.

**`$files`** — default permissions are all false; `data.ref` does not work; use `data.path.startsWith(...)` for path-based rules.

**Field-level permissions** — restrict specific fields while keeping the entity public:
```json
{ "$users": { "allow": { "view": "true" }, "fields": { "email": "auth.id == data.id" } } }
```

### Best practices

Always pass `schema` when initializing Instant for typed queries and transactions:
```tsx
import schema from '@/instant.schema';
const db = init({ appId, schema });                        // client
const adminDb = init({ appId, adminToken, schema });       // server
```

Use `id()` to generate IDs for new entities:
```tsx
import { id } from '@instantdb/react';
db.transact(db.tx.todos[id()].create({ title: 'New Todo' }));
```

Use `InstaQLEntity` to type query results:
```tsx
type Todo = InstaQLEntity<AppSchema, 'todos'>;
type PostWithAuthor = InstaQLEntity<AppSchema, 'posts', { author: { avatar: {} } }>;
```

### InstantDB documentation

- [Common mistakes](https://instantdb.com/docs/common-mistakes.md)
- [Initializing Instant](https://instantdb.com/docs/init.md)
- [Modeling data](https://instantdb.com/docs/modeling-data.md)
- [Writing data (InstaML)](https://instantdb.com/docs/instaml.md)
- [Reading data (InstaQL)](https://instantdb.com/docs/instaql.md)
- [Backend / Admin SDK](https://instantdb.com/docs/backend.md)
- [Patterns](https://instantdb.com/docs/patterns.md)
- [Auth](https://instantdb.com/docs/auth.md) · [Magic codes](https://instantdb.com/docs/auth/magic-codes.md)
- [Managing users](https://instantdb.com/docs/users.md)
- [Presence, Cursors, and Activity](https://instantdb.com/docs/presence-and-topics.md)
- [Instant CLI](https://instantdb.com/docs/cli.md)
- [Storage](https://instantdb.com/docs/storage.md)
- [Stripe Payments](https://instantdb.com/docs/stripe-payments.md)
