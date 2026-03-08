# Family Organizer App System Reference

This document is the current implementation guide for the Family Organizer app. It is meant to serve as the single high-level reference for how the app works today across web, iPhone, InstantDB, and the small amount of server code around auth, files, and bootstrap flows.

The major app areas covered here are:

1. Authentication, device activation, and principal/session switching
2. Dashboard and top-level app shell behavior on web and iPhone
3. Chores and task series
4. Calendar
5. Allowance and finance
6. Family administration and settings
7. Files, attachments, and media
8. Cross-cutting sync, PWA, and debug tooling
9. The `/childwidget` demo route

## Scope

This document describes the current implementation across:

- InstantDB schema, links, and permissions
- the Next.js web app
- the Expo / iPhone app
- the small amount of server code that exists for auth, files, and bootstrap support

It is intentionally descriptive, not aspirational. When the code and older notes disagree, trust the code.

## App-Wide Architecture

At a high level, the product is still a client-heavy InstantDB application.

- InstantDB is the main source of truth for family members, chores, task series, calendar items, allowance data, settings, units, and attachments.
- The web app uses `@instantdb/react` through `lib/db.ts`.
- The iPhone app uses `@instantdb/react-native` through `mobile/src/lib/instant-db.js`.
- Most CRUD flows happen directly from clients with `db.useQuery(...)` and `db.transact(...)`.
- The server layer mainly exists for device activation, auth token minting, S3 signing, and a few admin/backfill scripts.

Important consequence: if behavior is wrong, the fix is usually in client components or shared helpers, not in API routes.

## Top-Level Surface Map

### Web routes

- `/` -> household dashboard
- `/chores` -> chores management
- `/calendar` -> event calendar
- `/task-series` -> task-series manager
- `/task-series/new` and `/task-series/[seriesId]` -> editor flows
- `/familyMemberDetail` -> detailed finance management
- `/allowance-distribution` -> allowance payout workflow
- `/settings` -> family administration and currency settings
- `/files` -> web file browser
- `/activate` -> web/PWA device activation
- `/childwidget` -> static demo widget

### iPhone routes

- `/activate` -> native device activation
- `/lock` -> family-member selection and PIN entry
- tabs:
  - `/dashboard`
  - `/chores`
  - `/calendar`
  - `/finance`
  - `/more`
- More screens:
  - `/more/task-series`
  - `/more/family-members`
  - `/more/allowance-distribution`
  - `/more/files`
  - `/more/settings`
  - `/more/dev-tools`

## Shared Data Model

The most relevant Instant entities for the currently implemented product are:

| Entity | Main purpose |
| --- | --- |
| `familyMembers` | Household roster, roles, PINs, preferences, allowance settings, photo metadata |
| `allowanceEnvelopes` | Member-owned balance buckets |
| `allowanceTransactions` | Ledger rows for deposits, withdrawals, transfers, and setup |
| `calendarItems` | Household events and recurring event overrides |
| `chores` | Recurring or one-off chores, including reward metadata |
| `choreAssignments` | Rotation order for rotating chores |
| `choreCompletions` | Per-member, per-date completion rows |
| `taskSeries` | Multi-step plans tied to a member and optionally to a chore |
| `tasks` | Individual checklist nodes inside a series |
| `taskAttachments` | File metadata attached to tasks |
| `unitDefinitions` | Shared formatting for currencies and custom units |
| `settings` | Shared app settings like enabled currencies and family photo URLs |
| `exchangeRates` | Cached conversion data used by web finance |
| `calculatedAllowancePeriods` | Present in schema but not meaningfully used today |
| `deviceSessions` | Present in schema but not materially used by the current runtime device-session flow |

Other schema entities like `timeOfDayDefinitions` and `todos` exist, but I did not find meaningful product surfaces using them right now.

## Authentication, Activation, And Session Model

This area affects almost every screen in the app.

### Core model

The app effectively uses three layers of identity:

1. Device authorization
2. Instant principal authorization (`kid` or `parent`)
3. Selected family member for household UX

Those layers are related but not identical.

### Web activation and auth flow

Relevant files:

- `app/activate/page.tsx`
- `components/auth/DeviceActivationForm.tsx`
- `app/api/device-activate/route.ts`
- `components/InstantFamilySessionProvider.tsx`
- `components/AuthProvider.tsx`
- `components/auth/LoginModal.tsx`
- `components/auth/useInstantPrincipalSwitching.ts`
- `lib/instant-principal-storage.ts`

Current behavior:

- Web device activation is cookie-based.
- `POST /api/device-activate` validates `DEVICE_ACCESS_KEY` and sets `family_device_auth=true`.
- The `/activate` route redirects home if the cookie is already valid.
- After activation, the web app bootstraps an Instant session through `InstantFamilySessionProvider`.
- The provider prefers a cached parent principal only when parent mode was already unlocked and a cached token exists.
- Otherwise it ensures the `kid` principal and later elevates to `parent` only when needed.

### Web login behavior

Current web login is a family-member picker, not email/password auth.

- `LoginModal` queries `familyMembers`, displays avatars, and lets the user pick a member.
- Child accounts can log in immediately if no PIN is set.
- Child accounts with a PIN verify the hash locally when possible, with a server-side hash fallback.
- Parent login requires parent principal elevation through `/api/instant-auth-parent-token`.
- Parent mode can be marked as "shared device", which enables automatic timeout and demotion behavior.
- `AuthProvider` stores the selected family-member id in local storage and can auto-logout after one hour unless "remember me" is enabled.

### Web parent mode and principal switching

The web app separates:

- selected current family member
- active Instant principal

That means:

- a child selection normally runs on the `kid` principal
- a parent selection must elevate the principal to `parent`
- logging out or timing out a shared-device parent session explicitly demotes the principal back to `kid`

Shared-device parent state is persisted in local storage:

- cached kid token
- cached parent token
- parent unlocked flag
- shared-device flag
- last parent activity timestamp
- preferred principal

### iPhone activation and auth flow

Relevant files:

- `mobile/app/_layout.js`
- `mobile/app/index.js`
- `mobile/app/activate.js`
- `mobile/app/lock.js`
- `mobile/src/providers/DeviceSessionProvider.js`
- `mobile/src/providers/InstantPrincipalProvider.js`
- `mobile/src/providers/FamilyAuthProvider.js`
- `mobile/src/providers/AppProviders.js`
- `app/api/mobile/device-activate/route.ts`
- `app/api/mobile/device-session/refresh/route.ts`
- `app/api/mobile/device-session/revoke/route.ts`
- `app/api/mobile/config/route.ts`
- `app/api/mobile/instant-auth-token/route.ts`
- `app/api/mobile/instant-auth-parent-token/route.ts`
- `lib/device-auth-server.ts`

Current behavior:

- iPhone activation is bearer-token based, not cookie-based.
- `POST /api/mobile/device-activate` validates the access key and issues a signed device session token.
- `DeviceSessionProvider` loads the token from device storage, refreshes it on launch and on foreground resume, and clears it when the server rejects it.
- `mobile/app/_layout.js` fetches server config first, then initializes Instant with the app id and optional API/WebSocket URIs.
- The lock screen is the family-member selector and PIN gate for mobile.
- Parent login uses server-backed elevation.
- Child login reuses or restores the kid principal.

### iPhone shared-device parent mode

Mobile has a similar concept to web shared-device parent mode:

- parent unlock state is stored separately from the current family-member selection
- parent shared-device sessions track last activity
- inactivity demotes the session back to kid mode
- the More tab and admin subscreens use `useParentActionGate` to interrupt navigation and request parent elevation when needed

## Dashboard And App Shell

This is a real product surface, not just framing around the app.

### Web shell

Relevant files:

- `app/layout.tsx`
- `components/MainNav.tsx`
- `components/auth/UserMenu.tsx`
- `components/SyncStatusBadge.tsx`
- `components/NavbarDate.tsx`
- `components/CalendarHeaderControls.tsx`
- `components/PwaServiceWorkerRegistration.tsx`
- `components/debug/DebugTimeWidget.tsx`

The global web shell currently provides:

- a persistent header
- main navigation between dashboard, chores, calendar, task series, finance, allowance distribution, and settings
- current date and calendar controls in the header
- sync status derived from browser online state plus Instant connection state
- a user menu that reflects parent mode and shared-device timeout state
- PWA service worker registration
- a development-only time-travel widget

### Web dashboard

Relevant files:

- `app/page.tsx`
- `components/dashboard/WebFamilyDashboard.tsx`

The web dashboard is a live household overview, not just a landing page.

It queries:

- `familyMembers`
- `allowanceEnvelopes`
- `unitDefinitions`
- `chores`
- `calendarItems`
- task series through nested chore data

It computes:

- per-member combined balances
- daily XP
- chores due today
- overdue chores
- recently completed chores
- upcoming task-series work
- upcoming calendar items

It also renders a rotating beatitudes quote block, which is a real UI detail but not an architectural dependency.

### iPhone dashboard

Relevant files:

- `mobile/app/(tabs)/dashboard.js`

The iPhone dashboard is more action-oriented than the web dashboard.

It supports:

- selecting which family member to view
- moving across a short date strip
- seeing per-member balances and XP
- viewing due chores and task-series work
- toggling chore completion directly from the dashboard
- opening attachment links and task links

This means mobile dashboard behavior overlaps both chores and task series, not just "home."

### Demo widget route

Relevant files:

- `app/childwidget/page.tsx`
- `components/dashboard/ChildWidget.tsx`

`/childwidget` is currently a static demo route with hardcoded sample data. It is useful as a design/prototype surface but it is not wired to live app data.

## Chores And Task Series

### High-level architecture

- InstantDB is the source of truth.
- Web chores and task-series screens are mostly client-side query + transact flows.
- iPhone also reads and writes directly to Instant.
- There is no dedicated chores/task-series CRUD API.
- Task attachment support goes through file/signing routes rather than a chores-specific backend.

### Important duplication warning

There are two major duplication points that still matter:

1. Chore assignment, date, and XP logic is duplicated between `packages/shared-core/src/chores.ts` and `lib/chore-utils.ts`.
2. Task-series status logic is duplicated between the web task-series manager and the mobile task-series summary logic.

Changes to scheduling, XP, status, or allowance-linked chore behavior should check both copies.

### Core data model

Chore-related entities:

- `chores`
- `choreAssignments`
- `choreCompletions`

Task-series entities:

- `taskSeries`
- `tasks`
- `taskAttachments`

Important family-member fields used here:

- `role`
- `pinHash`
- `viewShowChoreDescriptions`
- `viewShowTaskDetails`

### Shared chore semantics

Current real behavior:

- chore dates are normalized to UTC day keys
- chores without `rrule` are one-time
- chores with `rrule` are matched against due dates
- rotation works only when there are assignments, `rotationType !== 'none'`, and the chore is not up-for-grabs
- up-for-grabs chores ignore rotation and can be claimed by the first completer
- fixed-reward chores contribute no XP
- weighted chores contribute to XP and, indirectly, allowance
- completions are scoped by chore + assignee + due date

### Shared task-series semantics

Current real behavior:

- a series belongs to one family member
- a series can link to a chore as `scheduledActivity`
- tasks are hierarchical via `parentTask`
- day-break rows are real task nodes used by the scheduler
- completion can propagate upward through parent tasks
- status and visible work are computed, not stored as a simple single field

### Web chores features

The web chores page currently supports:

- create, edit, and delete for parents
- recurring chores
- rotating chores
- up-for-grabs chores
- joint-chore labeling
- chore descriptions and reward metadata
- a separate chore preview calendar widget

The web app does not currently provide a deep dedicated backend service for chores.

### Web task-series features

The web task-series area currently includes:

- a manager page
- a series editor
- slash-command style task insertion helpers
- task metadata popovers
- embedded checklist behavior
- parent gating

### Mobile chores and task-series features

Current mobile state:

- the chores tab is implemented and is useful
- the dashboard tab also exposes task-series work
- More > Task Series provides a manager-style summary
- mobile parity still lags the web manager/editor

### Current gaps worth preserving

- duplicated business logic is still a real maintenance risk
- several schema fields exist but are not materially surfaced
- mobile task-series behavior is still partial compared to web

### Best starting points

- shared behavior: `packages/shared-core/src/chores.ts`, `lib/chore-utils.ts`, `lib/task-scheduler.ts`
- web chores: `components/ChoresTracker.tsx`, `components/ChoreList.tsx`, `components/DetailedChoreForm.tsx`
- web task series: `components/task-series/*`
- mobile: `mobile/app/(tabs)/chores.js`, `mobile/app/(tabs)/dashboard.js`, `mobile/app/more/task-series.js`

## Calendar

### High-level architecture

- `calendarItems` is the single event entity.
- Calendar CRUD is client-driven on both web and iPhone.
- The server mainly contributes permissions, auth plumbing, and a repair script.
- Recurrence expansion is primarily a web-client concern.

### Important fields

Core event fields:

- `title`
- `description`
- `startDate`
- `endDate`
- `isAllDay`
- `year`, `month`, `dayOfMonth`
- `pertainsTo`

Recurrence fields:

- `rrule`
- `rdates`
- `exdates`
- `recurrenceLines`
- `recurringEventId`
- `recurrenceId`
- `recurrenceIdRange`
- `xProps`

Metadata fields:

- `uid`
- `sequence`
- `status`
- `timeZone`
- `createdAt`, `updatedAt`, `dtStamp`, `lastModified`
- `eventType`, `visibility`, `transparency`
- `alarms`
- travel-duration metadata

There are also metadata-ish fields present in schema but not materially surfaced in the product, such as attendees, organizer, conference data, priority, and URL.

### Important semantics

- all-day events use exclusive end dates
- timed events use ISO timestamps
- recurring series use a master event row plus override rows
- `recurrenceId` is critical for suppressing or replacing generated occurrences
- the app stores recurrence information in several parallel shapes, and that is intentional

### Permissions and backend

- family principals can read calendar items
- only parents can create, update, delete, link, and unlink them
- there is no calendar CRUD route on the server
- `scripts/backfill-calendar-events.js` repairs missing metadata on old rows

### Web calendar behavior

The web calendar includes:

- month-style event rendering
- drag and drop
- add/edit modal flows
- recurrence editing
- recurrence-scope delete/update handling
- multi-day rendering
- optimistic client updates

Most complexity lives in:

- `components/Calendar.tsx`
- `components/AddEvent.tsx`
- `components/RecurrenceScopeDialog.tsx`
- `components/DroppableDayCell.tsx`
- `components/DraggableCalendarEvent.tsx`

### iPhone calendar behavior

The iPhone calendar is real but simpler.

Current state:

- parent-gated editing exists
- save behavior exists
- recurrence support is much shallower than web
- multi-day rendering is simpler than web
- mobile is not feature-parity with the web recurrence editor

### Current gaps worth preserving

- recurrence is meaningfully more complete on web than on mobile
- there is no server-owned calendar service
- some metadata fields are stored but not productized
- alerts are stored but there is no delivery engine in this repo

### Tests worth checking

- `test/dom/components/Calendar.dom.test.tsx`
- `test/dom/components/AddEvent.dom.test.tsx`
- `test/dom/components/CalendarHeaderControls.dom.test.tsx`
- `e2e/calendar-event-regression.spec.ts`

## Allowance And Finance

### High-level product model

The app models family money as a lightweight household ledger on top of InstantDB.

- each `familyMember` can have allowance settings
- each member can have multiple `allowanceEnvelopes`
- envelope balances are cached on the envelope row
- `allowanceTransactions` act as the audit trail
- chore completions feed allowance calculations
- `unitDefinitions` control formatting for currencies and custom units

### Core entities

- `familyMembers`
- `allowanceEnvelopes`
- `allowanceTransactions`
- `exchangeRates`
- `unitDefinitions`
- `chores`
- `choreCompletions`
- `calculatedAllowancePeriods` (currently unused in practice)

### Permissions and auth shape

Current practical rules:

- family principals can read finance data
- `allowanceTransactions` are effectively append-only for normal clients
- parents can delete transactions
- `allowanceEnvelopes` are readable by family principals and writable by both parent and kid principals in the current model
- `familyMembers` are mostly parent-writable, with a small kid-safe update subset

Finance actions stamp both:

- `createdBy` -> Instant auth user id
- `createdByFamilyMemberId` -> selected household member id

### Ledger versus cache

Balances are stored twice:

1. denormalized `balances` on each envelope
2. replayable rows in `allowanceTransactions`

`lib/currency-utils.ts` includes reconciliation helpers, but the UI does not automatically reconcile on load. Balance correctness still depends on each mutation path updating both layers correctly.

### Shared finance behavior

Important current rules:

- members are expected to have at least one default envelope, usually `Savings`
- web often auto-repairs missing defaults
- mobile currently does not auto-create missing envelopes on entry
- transaction types are not fully normalized between web and mobile
- allowance is derived from chores, not from an actively used persisted payout-period entity

### Web finance features

Main web surfaces:

- `/familyMemberDetail`
- `/allowance-distribution`
- dashboard finance summaries

Current web features include:

- envelope creation and editing
- deposits, withdrawals, and transfers
- person-to-person transfers
- transaction history
- balance formatting and conversion
- savings-goal UI
- allowance configuration
- a parent-oriented allowance distribution workflow

### iPhone finance features

Main iPhone surfaces:

- `mobile/app/(tabs)/finance.js`
- `mobile/app/more/allowance-distribution.js`
- `mobile/app/more/settings.js`

Current iPhone behavior includes:

- finance tab overview
- member filtering
- envelope display
- transaction listing
- parent-gated money actions
- visibility into allowance-related data

Native finance still trails the web workflow in breadth and consistency.

### Current gaps worth preserving

- no dedicated finance backend service
- `calculatedAllowancePeriods` exists but is not actively used
- web payout execution is not atomic with completion marking
- fixed-reward payout handling is incomplete for multi-currency cases
- transaction type naming differs across platforms
- envelope creation and deletion behavior is inconsistent between web and iPhone
- exchange-rate refresh is client-owned
- transaction-heavy views do not yet paginate

### Best starting points

- shared/backend: `instant.schema.ts`, `instant.perms.ts`, `lib/chore-utils.ts`, `lib/currency-utils.ts`
- web: `components/allowance/*`, `app/familyMemberDetail/page.tsx`, `app/allowance-distribution/page.tsx`
- iPhone: `mobile/app/(tabs)/finance.js`, `mobile/app/more/allowance-distribution.js`

## Family Administration And Settings

This area covers both household administration and shared app-level settings.

### Web settings

Relevant files:

- `app/settings/page.tsx`
- `components/FamilyMembersList.tsx`
- `components/CurrencySettings.tsx`
- `app/actions.ts`
- `lib/photo-urls.ts`

Current web settings behavior:

- parent-gated
- shows family members ordered by `order`
- uses `FamilyMembersList` in always-edit mode
- supports member creation, editing, deletion, and drag reordering
- supports roles and PIN hashing
- supports profile photo uploads with generated `64`, `320`, and `1200` variants
- supports family photo storage via the `settings` row `familyPhotoUrls`
- can internally compute balance and XP summaries from shared data when needed
- exposes simple enabled-currency toggles through the `settings` row `enabledCurrencies`

### Mobile settings and family administration

Relevant files:

- `mobile/app/more/settings.js`
- `mobile/app/more/family-members.js`

Current mobile behavior:

- More > Settings is partly local and partly shared
- theme selection is local to the device
- unit-definition creation is shared through Instant and parent-gated
- server URL can be changed on-device, which forces a reconnect/re-activation path
- More > Family Members is parent-gated and currently functions as a live roster snapshot
- mobile family roster shows roles, PIN state, email, envelope count, and view preferences
- photo editing and drag reordering are still web-first features

### Settings model notes

The `settings` entity is being used as a flexible bucket for shared app-level values. In practice today that includes at least:

- `enabledCurrencies`
- `familyPhotoUrls`

That is simple, but it also means settings are not strongly typed by entity shape in the way core domain data is.

## Files, Attachments, And Media

This is a real subsystem on both web and mobile.

### Core file/storage architecture

Relevant files:

- `app/files/page.tsx`
- `components/FileManager.tsx`
- `app/actions.ts`
- `lib/s3-file-service.ts`
- `app/files/[filename]/route.ts`
- `app/api/mobile/files/route.ts`
- `app/api/mobile/files/presign/route.ts`
- `app/api/mobile/files/[filename]/route.ts`
- `mobile/app/more/files.js`
- `mobile/src/lib/api-client.js`

Current behavior:

- storage is backed by S3-compatible infrastructure, usually MinIO in local/dev setups
- uploads use presigned POSTs
- web file listing uses a server action gated by device auth
- web download/display uses `/files/[filename]`, which returns a 307 redirect to a presigned S3 URL
- mobile file listing uses bearer-auth JSON routes
- mobile file open/download uses a route that returns a presigned URL in JSON because React Native image/file consumers do not reliably follow redirects

### File access differences

Web:

- hidden route from nav, but fully implemented
- gated by device auth cookie in server actions and route handlers
- not explicitly parent-gated in the page component

Mobile:

- exposed from More > Files
- parent-gated
- uses device-session bearer auth

### Task attachments and media

Task attachments are part of the task-series model and connect to the file system.

- `taskAttachments` store metadata and URLs
- mobile dashboard can open task links and attachments
- mobile also has a dedicated presign route for uploading `task-attachment` files

### Avatar and family photo media

Photo handling is another real storage subsystem:

- member profile photos are stored as multiple size variants
- family photo URLs are stored in `settings`
- `lib/photo-urls.ts` chooses the preferred size URL for rendering

## Cross-Cutting Sync, PWA, And Debug Tooling

These are cross-cutting platform and operational concerns that affect multiple features.

### Sync and connectivity

Relevant files:

- `components/SyncStatusBadge.tsx`
- `lib/sync-status.ts`
- `mobile/src/providers/NetworkStatusProvider.js`

Current behavior:

- web sync badge combines browser online/offline state with Instant connection state
- mobile providers track online state and expose it to tabs and admin screens
- many mobile admin screens surface connectivity in status chips

### PWA support

Relevant files:

- `app/layout.tsx`
- `components/PwaServiceWorkerRegistration.tsx`

Current behavior:

- the web app registers `/sw.js` in production
- metadata and viewport are configured for PWA/home-screen installation
- `/activate` exists partly to support installed-device activation flows cleanly

### Debug and testing tools

Relevant files:

- `components/debug/DebugTimeWidget.tsx`
- `lib/time-machine.ts`
- `mobile/app/more/dev-tools.js`

Current behavior:

- web includes a development-only time-machine widget that patches `Date`
- the root layout also injects an early date-patching script before hydration
- mobile More > Dev Tools shows a live session snapshot for simulator/device debugging

These are not business features, but they matter when reasoning about date-sensitive chores, calendar recurrence, and shared-device behavior.

## Current Big-Picture Risks And Gaps

Across the whole app, the biggest structural themes are:

1. Most product logic is still client-owned, so consistency depends heavily on shared helpers and permissions rather than server-owned workflows.
2. Some important business logic is duplicated across web/mobile or shared/web implementations.
3. Mobile parity is improving, but calendar, finance, and family-admin flows are still not fully aligned with web.
4. Several schema entities or fields appear to be forward-looking rather than fully productized today.
5. Settings and media flows are real subsystems, not just side features.

## Best File Map For Future Work

### Auth and session

- `components/InstantFamilySessionProvider.tsx`
- `components/AuthProvider.tsx`
- `components/auth/LoginModal.tsx`
- `components/auth/useInstantPrincipalSwitching.ts`
- `mobile/src/providers/DeviceSessionProvider.js`
- `mobile/src/providers/InstantPrincipalProvider.js`
- `mobile/src/providers/FamilyAuthProvider.js`
- `lib/device-auth-server.ts`

### Dashboard and shell

- `app/layout.tsx`
- `components/MainNav.tsx`
- `components/dashboard/WebFamilyDashboard.tsx`
- `mobile/app/(tabs)/dashboard.js`

### Chores and task series

- `lib/chore-utils.ts`
- `packages/shared-core/src/chores.ts`
- `lib/task-scheduler.ts`
- `components/ChoresTracker.tsx`
- `components/task-series/*`
- `mobile/app/(tabs)/chores.js`
- `mobile/app/more/task-series.js`

### Calendar

- `components/Calendar.tsx`
- `components/AddEvent.tsx`
- `components/RecurrenceScopeDialog.tsx`
- `mobile/app/(tabs)/calendar.js`

### Finance

- `components/allowance/*`
- `lib/currency-utils.ts`
- `app/familyMemberDetail/page.tsx`
- `app/allowance-distribution/page.tsx`
- `mobile/app/(tabs)/finance.js`
- `mobile/app/more/allowance-distribution.js`

### Settings, files, and media

- `components/FamilyMembersList.tsx`
- `components/CurrencySettings.tsx`
- `app/actions.ts`
- `components/FileManager.tsx`
- `lib/s3-file-service.ts`
- `mobile/app/more/settings.js`
- `mobile/app/more/family-members.js`
- `mobile/app/more/files.js`

## Bottom Line

Family Organizer today is made of six major layers:

1. auth, activation, and principal switching
2. dashboard and shell
3. chores and task series
4. calendar
5. allowance and finance
6. settings, family admin, files, and media

If you are making changes in this repo, it is worth checking both the domain section you care about and the auth/session layer, because most non-trivial features depend on both.
