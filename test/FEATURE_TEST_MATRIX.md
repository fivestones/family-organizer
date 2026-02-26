# Web Feature Test Matrix

Scope: Web app only (ignore iOS/mobile target for now). This matrix is based on the current codebase and uses the README as supporting context only.

Status labels:

- `Existing` = already covered by current automated tests
- `New (added)` = added in this pass
- `Planned` = recommended next implementation

Priority labels:

- `P0` = release-blocking / auth/security / money movement / critical user path
- `P1` = core workflow regression risk
- `P2` = important edge case / UX correctness

## Current coverage snapshot

- `Existing`: middleware device gate, device activation API, Instant auth token APIs, parent elevation API, upload/delete image APIs, file redirect route, app server actions auth gating, Instant perms contract/live smoke, parent elevation rate limiter, Instant family session DOM behavior, auth/device E2E smoke.
- `New (added)`: shared fake clock helper (`test/utils/fake-clock.ts`), Playwright app-time helper (`e2e/support/time-machine.ts`), deterministic shared-device expiry DOM timing, expanded date/allowance/task scheduling unit tests (`lib/task-scheduler.ts`, `lib/chore-utils.ts`), finance/currency core helper unit tests (`lib/currency-utils.ts`), auth DOM tests (`LoginModal`, `AuthProvider`, `ParentGate`, shared-device timeout hook, `UserMenu`), shell DOM tests (`DebugTimeWidget`, `SyncStatusBadge`, `PwaServiceWorkerRegistration`, `NavbarDate`, `MainNav`), auth helper unit tests (`instant-principal-storage`, `instant-principal-api`, `time-machine`), and Playwright time-machine/debug-widget smoke tests.

## Time-sensitive testing support

- Unit/integration/DOM: `test/utils/fake-clock.ts`
- Playwright (app time machine / `debug_time_offset`): `e2e/support/time-machine.ts`

Use fake time for:

- recurrence expansion and rotation
- allowance period boundaries/payout timing
- task-series queue projection
- parent shared-device idle expiry
- date-based filtering and “today vs historical” behavior

## A. Access control, device activation, auth, principals

- `AUTH-001` `P0` `Existing` Integration: Middleware blocks protected routes without device cookie and allows activation/required public paths.
- `AUTH-002` `P0` `Existing` Integration: `POST /api/device-activate` accepts valid key and rejects invalid key.
- `AUTH-003` `P0` `Existing` E2E: Magic-link activation (`/?activate=...`) activates device and allows app access.
- `AUTH-004` `P0` `Existing` Integration: `GET /api/instant-auth-token` returns kid principal token only for valid authenticated family session.
- `AUTH-005` `P0` `Existing` Integration: `POST /api/instant-auth-parent-token` verifies PIN and rate limits failures.
- `AUTH-006` `P0` `Existing` Unit: Parent elevation rate limiter backoff/window behavior.
- `AUTH-007` `P1` `Existing` DOM: `InstantFamilySessionProvider` keeps kid principal when already in kid mode.
- `AUTH-008` `P1` `Existing + New` DOM: Shared-device parent mode auto-expires and downgrades to kid principal (deterministic fake clock).
- `AUTH-009` `P1` `Existing` E2E: Parent can elevate to access restricted page and logout returns to restricted state.
- `AUTH-010` `P1` `New (added)` DOM: Login modal child PIN local hash success path and server-fallback path behavior.
- `AUTH-011` `P1` `New (added)` DOM: Login modal parent PIN path surfaces offline “internet required” error (fresh elevation required) and cached-parent optional PIN path.
- `AUTH-012` `P1` `Planned` DOM: Remember-me + shared-device checkboxes persist and restore across reload.
- `AUTH-013` `P1` `Planned` DOM/Integration: Switching from parent user to child clears parent principal cache/preferred principal.
- `AUTH-014` `P2` `New (added)` DOM: `ParentGate` loading, authorized render, restricted state, and login-modal auto-open behavior.
- `AUTH-015` `P2` `New (added)` E2E (env-gated): Idle timeout auto-expires parent mode during active session (via app time travel).
- `AUTH-016` `P1` `New (added)` DOM: `AuthProvider` login/logout persistence, idle auto-logout, remember-me skip, and parent-principal downgrade clearing.
- `AUTH-017` `P2` `New (added)` Unit: Instant principal localStorage helpers (cached tokens, flags, preferred principal, timeout env parsing).
- `AUTH-018` `P2` `New (added)` DOM: `useParentSharedDeviceTimeout` hook expiry gating, stale-session immediate expiry, and activity-based rescheduling.
- `AUTH-019` `P1` `New (added)` Unit: `fetchPrincipalToken` request defaults/overrides and token endpoint error handling.
- `AUTH-020` `P2` `New (added)` DOM: `UserMenu` guest/authenticated states, shared-device parent-mode info, switch-user modal trigger, and logout action.

## B. Family member management

- `FAM-001` `P1` `Planned` E2E: Parent adds child member with name/PIN/photo and member appears in list.
- `FAM-002` `P1` `Planned` DOM: Add/edit member form validation (required name, role-specific PIN expectations).
- `FAM-003` `P1` `Planned` E2E: Parent edits member name/role/PIN and changes persist after reload.
- `FAM-004` `P1` `Planned` E2E: Parent deletes member with confirmation and list updates.
- `FAM-005` `P1` `Planned` E2E: Drag-and-drop reorder persists member order.
- `FAM-006` `P1` `Existing` Integration: Upload API auth/method enforcement.
- `FAM-007` `P1` `Existing` Integration: Upload API image parsing/processing validation.
- `FAM-008` `P1` `Existing` Integration: Delete-image API auth and path traversal protections.
- `FAM-009` `P2` `Planned` DOM: Photo upload/delete button loading/error/success states.
- `FAM-010` `P2` `Planned` Contract/Live: `familyMembers.pinHash` field hidden from kid principal where intended.

## C. Chores dashboard, recurrence, rotation, completion

- `CHORE-001` `P0` `Planned` E2E: Parent creates a one-time chore assigned to a child; child sees it on correct date.
- `CHORE-002` `P0` `Planned` E2E: Child marks assigned chore complete and completion persists on reload.
- `CHORE-003` `P0` `Planned` Integration: Chore completion write stamps actor/marker identity correctly.
- `CHORE-004` `P1` `Planned` E2E: Parent edits chore details (title/description/weight/start date) and changes persist.
- `CHORE-005` `P1` `Planned` E2E: Parent deletes chore; child no longer sees it.
- `CHORE-006` `P1` `Planned` DOM: Chores filter by selected member and “All” state.
- `CHORE-007` `P1` `Planned` DOM: Date navigation updates visible chores and date labels.
- `CHORE-008` `P1` `Planned` DOM: View preference toggles (`showChoreDescriptions`, `showTaskDetails`) persist.
- `CHORE-009` `P1` `Planned` DOM: Parent-only add/edit/delete controls hidden for child users.
- `CHORE-010` `P1` `Planned` DOM: `DetailedChoreForm` recurrence controls validate daily/weekly/monthly variants.
- `CHORE-011` `P1` `Planned` DOM: Rotation controls and assignment ordering UI render only when enabled.
- `CHORE-012` `P1` `Planned` DOM: Joint chore + up-for-grabs options produce valid payloads and UI states.
- `CHORE-013` `P1` `Planned` DOM: Reward type switching (`weight` vs `fixed`) updates required fields/validation.
- `CHORE-014` `P1` `Planned` DOM: Chore preview calendar updates when recurrence/rotation settings change.
- `CHORE-015` `P1` `New (added)` Unit: Task-series rolling queue `getTasksForDate` future block projection across day breaks.
- `CHORE-016` `P1` `New (added)` Unit: `getTasksForDate` historical date returns only tasks completed on that date.
- `CHORE-017` `P1` `Planned` Unit: Monthly recurrence edge cases (short months / end-of-month behavior).
- `CHORE-018` `P1` `Planned` Unit: Rotation index for weekly/monthly recurrence with intervals.
- `CHORE-019` `P0` `Planned` E2E: Up-for-grabs chore completed by one child locks out second child and shows proper toast/message.
- `CHORE-020` `P0` `Planned` Integration: Up-for-grabs completion conflict path returns deterministic error response.
- `CHORE-021` `P1` `Planned` E2E: Joint chore completion behavior matches intended rules for multiple assignees.
- `CHORE-022` `P1` `Planned` E2E: Task-series-linked chore completion blocked until tasks complete; “mark all and complete” path works.
- `CHORE-023` `P2` `New (added)` Unit: XP calculation (`calculateDailyXP`) fixed reward exclusion and up-for-grabs claimed/unclaimed rules.
- `CHORE-024` `P2` `New (added)` Unit: `getChoreAssignmentGridFromChore` assignment-only preview for rotating chores.

## D. Task series editor, manager, checklist, attachments

- `TS-001` `P1` `Planned` E2E: Create task series with metadata (name/assignee/chore link/start/target dates) and save.
- `TS-002` `P1` `Planned` E2E: Duplicate and delete task series from manager.
- `TS-003` `P1` `Planned` DOM: Manager filtering/status tabs/multi-select/shift-select logic.
- `TS-004` `P1` `Planned` DOM: Editor autosave debounce and flush-on-unmount.
- `TS-005` `P1` `Planned` DOM: Slash command `/` inserts Day Break task node.
- `TS-006` `P1` `Planned` DOM: Keyboard editing behaviors (Tab/Shift-Tab, Enter, arrows, Backspace/Delete).
- `TS-007` `P1` `Planned` DOM: Drag reorder and indentation preview UI updates.
- `TS-008` `P1` `New (added)` Unit: `isSeriesActiveForDate` respects schedule + projected series range.
- `TS-009` `P1` `Planned` Unit: `getTasksForDate` anchor-date behavior when today is not a scheduled occurrence.
- `TS-010` `P1` `New (added)` Unit: `getTasksForDate` trims leading ghost day breaks after completed tasks (trailing case still worth adding).
- `TS-011` `P1` `New (added)` Unit: `getRecursiveTaskCompletionTransactions` propagates `childTasksComplete` through ancestors (including sibling-incomplete guard).
- `TS-012` `P1` `Planned` DOM: Checklist is interactive on today and read-only on non-today dates.
- `TS-013` `P1` `Planned` E2E: Checklist completion unlocks chore completion path.
- `TS-014` `P2` `Planned` DOM: Notes/attachments UI states (uploading, error, success, preview).
- `TS-015` `P2` `Planned` Integration: Attachment upload validation (size/type/path) and DB linking.
- `TS-016` `P2` `Planned` DOM/E2E: File preview modal handles image/text/PDF/fallback download.

## E. Calendar events

- `CAL-001` `P1` `Planned` E2E: Parent creates all-day calendar event and it appears on chosen date.
- `CAL-002` `P1` `Planned` E2E: Parent creates timed event and time displays correctly.
- `CAL-003` `P1` `Planned` E2E: Parent edits existing event and changes persist.
- `CAL-004` `P1` `Planned` E2E: Parent drags event to another day and persisted date updates.
- `CAL-005` `P1` `Planned` DOM: Add/edit event form validation for all-day vs timed payloads.
- `CAL-006` `P1` `Planned` Integration: Event CRUD transaction auth/perms (parent-only if intended by perms).
- `CAL-007` `P2` `Planned` DOM: Draggable and droppable visual states apply during drag operations.
- `CAL-008` `P2` `Planned` DOM: Nepali/Bikram Samvat date labels render without breaking Gregorian display.

## F. Finances, envelopes, transactions, allowance

- `FIN-001` `P0` `Planned` E2E: Parent opens member finance detail and default Savings envelope exists (auto-create/repair path).
- `FIN-002` `P0` `Planned` Integration: Default envelope invariant repair/creation behavior when missing.
- `FIN-003` `P0` `Planned` E2E: Parent creates/edits/deletes envelope and balances update correctly.
- `FIN-004` `P0` `Planned` E2E: Deposit transaction updates envelope balance and appears in history.
- `FIN-005` `P0` `Planned` E2E: Withdrawal transaction updates balance and appears with correct sign/type.
- `FIN-006` `P0` `Planned` E2E: Transfer between own envelopes creates paired transactions and updates both balances.
- `FIN-007` `P0` `Planned` E2E: Transfer to another person moves funds into recipient default envelope.
- `FIN-008` `P0` `Existing` Unit: Allowance transaction helper functions stamp `createdBy` audit fields for all mutation types.
- `FIN-009` `P0` `Planned` Integration: Envelope/transaction mutations enforce parent/self permissions and audit rules.
- `FIN-010` `P1` `Planned` DOM: Envelope forms validate amounts/currency/default selection/growth goal inputs.
- `FIN-011` `P1` `Planned` DOM: Withdraw/transfer forms block invalid amounts and same-envelope transfers.
- `FIN-012` `P1` `Planned` DOM: Transfer-to-person form limits valid recipients/destinations.
- `FIN-013` `P1` `Planned` DOM: Transaction history filters and labels dedupe/display paired intra-member transfers correctly.
- `FIN-014` `P1` `Planned` Unit: Currency conversion handles direct/inverse/USD-cross rates and stale cache fallback.
- `FIN-014` `P1` `New (added)` Unit: `getExchangeRate` identity/direct cache/USD-cross calculation/stale fallback/unavailable paths.
- `FIN-015` `P1` `Planned` DOM: Combined balance display shows monetary + non-monetary balances and conversion labels.
- `FIN-016` `P1` `Planned` E2E: Display currency preference persists across reload.
- `FIN-017` `P1` `Planned` E2E: Parent configures recurring allowance amount/currency/start date/payout delay.
- `FIN-018` `P0` `Planned` E2E: Allowance distribution page computes pending periods and distributes payouts.
- `FIN-019` `P0` `Planned` Integration: Allowance distribution write path prevents duplicate payout for same period.
- `FIN-020` `P1` `Planned` Unit: `getAllowancePeriodForDate` weekly/monthly boundary calculations.
- `FIN-021` `P1` `New (added)` Unit: `getAllowancePeriodForDate` weekly period boundary and pre-start null case.
- `FIN-022` `P1` `New (added)` Unit: `calculatePeriodDetails` weighted completion + fixed reward accumulation + up-for-grabs contribution.
- `FIN-023` `P2` `Planned` E2E: Child self-service actions allowed/blocked per product rules (withdraw/transfer/view history).
- `FIN-024` `P2` `Planned` Integration: Envelope deletion behavior for empty vs non-empty envelopes (README/code mismatch guard).
- `FIN-025` `P1` `New (added)` Unit: `setDefaultEnvelope` and `findOrDefaultEnvelope` default selection/repair paths (existing default, Savings, first envelope, create initial Savings).
- `FIN-026` `P1` `New (added)` Unit: `executeAllowanceTransaction` zero-amount skip and default-envelope deposit/withdraw routing.
- `FIN-027` `P2` `New (added)` Unit: `calculateEnvelopeProgress` cached/identity conversions with non-monetary balance exclusion.

## G. Files and uploads

- `FILE-001` `P0` `Existing` Integration: `app/actions` file actions require auth and validate payloads.
- `FILE-002` `P0` `Existing` Integration: `/files/[filename]` route returns signed redirect only for allowed requests.
- `FILE-003` `P1` `Planned` E2E: File manager uploads image and opens preview modal.
- `FILE-004` `P1` `Planned` E2E: File manager uploads non-image file and download flow works.
- `FILE-005` `P1` `Planned` DOM: File manager UI handles upload progress/success/error/list refresh.
- `FILE-006` `P1` `Planned` Integration: Upload size limit (10MB) returns expected error shape.
- `FILE-007` `P2` `Planned` E2E: Task attachment upload + preview + delete flow on checklist/editor.

## H. PWA/offline/sync/debug shell

- `SHELL-001` `P1` `Existing` Unit: Sync status badge presentation state mapping.
- `SHELL-002` `P1` `New (added)` DOM: `SyncStatusBadge` reacts to online/offline/syncing/reconnecting transitions.
- `SHELL-003` `P2` `Planned` E2E: Offline -> reconnect transitions preserve page usability and sync badge updates.
- `SHELL-004` `P2` `New (added)` DOM: `DebugTimeWidget` hidden in production mode and visible in dev/test mode.
- `SHELL-005` `P2` `New (added)` DOM: `DebugTimeWidget` opens, jumps days, and triggers travel/reset actions.
- `SHELL-006` `P2` `New (added)` Tooling: Playwright helper to drive app time machine via `debug_time_offset`.
- `SHELL-007` `P2` `Planned` E2E: Time travel forward/back changes date-sensitive UI (navbar date, chores for day).
- `SHELL-008` `P2` `New (added)` DOM: PWA service worker registration env gating, registration/update success, error warning, and unmount cancellation behavior.
- `SHELL-009` `P2` `New (added)` E2E: Time-machine helper bootstraps simulated clock via context init script and supports page-level travel/reset.
- `SHELL-010` `P2` `New (added)` E2E: `DebugTimeWidget` UI can travel and reset time end-to-end.
- `SHELL-011` `P2` `New (added)` Unit: `lib/time-machine` stores/clears offsets and computes deltas from `window.__RealDate` / `Date.now`.
- `SHELL-012` `P2` `New (added)` DOM: `NavbarDate` renders client-side formatted date (compatible with time-machine patched `Date`).
- `SHELL-013` `P2` `New (added)` DOM: `MainNav` active-link state (exact root + nested prefix match) and `onNavigate` callback wiring.

## I. Instant schema/perms contracts and live checks

- `PERM-001` `P0` `Existing` Contract: Every schema entity is covered by permission definitions (or explicit allowance).
- `PERM-002` `P0` `Existing` Live: Anonymous principal denied for protected data.
- `PERM-003` `P0` `Existing` Live: Kid principal read/write permissions align with expected limited scope.
- `PERM-004` `P0` `Existing` Live: Parent principal can perform parent-only actions.
- `PERM-005` `P0` `Planned` Live: Field-level restrictions validated for hidden sensitive fields (PIN hash).
- `PERM-006` `P0` `Planned` Contract/Live: Parent-only entities (`chores`, `calendarEvents`, task-series entities/settings) reject kid writes.
- `PERM-007` `P0` `Planned` Live: `allowanceTransactions.createdBy == auth.id` enforced on writes.

## J. Cross-cutting UX / resilience / accessibility (manual + selective automation)

- `UX-001` `P1` `Planned` Manual: Responsive layouts for `/`, `/calendar`, `/task-series`, `/familyMemberDetail`, `/files`.
- `UX-002` `P1` `Planned` Manual: Keyboard navigation and focus management in dialogs/forms/menus.
- `UX-003` `P1` `Planned` Manual: Touch drag/drop usability (calendar, family member reorder, task editor).
- `UX-004` `P2` `Planned` Manual: Photo crop and attachment preview UX for large images/PDFs.
- `UX-005` `P2` `Planned` Manual: PWA install/update behavior and cache refresh after deploy.

## Suggested execution packs

### PR smoke (fast)

- `AUTH-001` `AUTH-003` `AUTH-004` `AUTH-005` `AUTH-008` `AUTH-009`
- `CHORE-001` `CHORE-002`
- `CAL-001`
- `FILE-003`
- `PERM-001`
- `Typecheck + unit + integration tests touched by the PR`

### Nightly regression

- Full Vitest suite (`unit` + `dom` + `integration` + `contracts`)
- Full Playwright regression for chores/calendar/task-series/finance/files
- `test:perms:live`
- Multi-context conflict tests (up-for-grabs race, concurrent edits)

### Pre-release checklist

- Nightly regression pack
- Manual UX/accessibility sweep (`UX-*`)
- Offline/reconnect/PWA sanity (`SHELL-003`, `SHELL-008`, `UX-005`)
- Cross-browser sanity (Chromium + at least one secondary engine if supported)
