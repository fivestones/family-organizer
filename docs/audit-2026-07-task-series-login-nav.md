# Audit: Task Series, `/tasks` Presentation, Login, and Nav Bar

**Date:** 2026-07-12
**Scope:** `lib/task-*`, `components/task-series/*`, `components/TaskSeriesChecklist.tsx`, the `/tasks` page pipeline (`ChoresTracker` → `ChoreList`), the auth stack (`AuthProvider`, `InstantFamilySessionProvider`, `LoginModal`, gates, token routes), and the app shell (`layout.tsx`, `ThemedAppShell.tsx`, `MainNav.tsx`).
**Method:** Static code review plus a synthetic browser reproduction of the app-shell CSS (sticky header, flex body, `overflow-hidden` main, dashboard body-lock). I did not drive the real app UI, per project convention. Findings marked **Confirmed** were proven either by tracing a complete code path or by the repro; **Probable** means the mechanism is solid but depends on device/timing.

---

## Implementation progress

- **2026-07-14 — Completed: cancelling manager deletion clears its pending target (Part 3 #5).** The controlled alert-dialog callback now clears `seriesToDelete` whenever the prompt closes, including Cancel, escape, and outside-close paths; failed and successful delete closures use the same cleanup boundary. Verification: all 9 manager DOM tests pass, including cancel-without-write followed by a clean second-series prompt; `tsc --noEmit` passes.
- **2026-07-14 — Completed: failed manager catch-up writes surface honest feedback (Part 3 #4).** `handleCatchUp` now catches transaction failures, records the underlying error, and shows a destructive toast stating that the planned end date was not changed; the success toast is emitted only after the write resolves. Verification: all 8 manager DOM tests pass, including a rejected-write regression that proves no false success; `tsc --noEmit` passes.
- **2026-07-14 — Completed: Task Series Manager rolls status across midnight (Part 3 #3).** The manager's local date key is now state refreshed every minute and on `visibilitychange` when the tab returns to the foreground. Date-derived status, drift, and catch-up inputs recompute only when the calendar key actually changes. Verification: all 7 manager DOM tests pass, including a fake-clock transition from 23:59 Pending to 00:00 In Progress without remounting; `tsc --noEmit` passes.
- **2026-07-14 — Completed: one task-day block splitter now drives definitions and the live queue (§1.2–1.3, Phase 3).** `splitTaskDayBlocks` sorts once, excludes parent/header nodes through the shared actionable predicate, and defines leading, trailing, or consecutive empty break segments as non-days. `getTaskDayBlocks` wraps that primitive for planning/counts; `getTasksForDate` projects active or viewed-date-completed tasks from those same definition blocks and drops blocks with no remaining visible work. This removes the asymmetric final flush and neighbor-dependent empty-block filter. Verification: 43 focused schedule/scheduler tests pass, including table coverage for empty break segments and completed trailing definitions; `tsc --noEmit` passes.
- **2026-07-14 — Completed: task scheduling and bins share local-calendar “today” semantics (§1.4, Phase 3).** Shared core now exports `getLocalDateKey`/`getTodayKey`, based on local calendar components and evaluated at call time so the production-gated Date time machine remains effective. Scheduler anchors and pull-forward checks, task-bin overdue defaults, review updates, note-until dates/date-picker guards, My Task Series, and manager status all use the shared key instead of raw UTC `toISOString()` for “today.” Verification: 34 focused shared-date, scheduler, task-bin, and manager tests pass; `tsc --noEmit` passes.
- **2026-07-14 — Completed: task copy/paste can no longer duplicate or steal task IDs (§2.2, Phase 2).** The existing paste hook now maps exact pre-paste nodes into the new document and preserves those positions only; every inserted task or day break receives a fresh Instant ID even if clipboard HTML carries an ID already used in this series or a different one. A shared repair planner prevents generated collisions and is also used by the delete-confirm paste replay, which preserves each surviving old ID once and re-IDs duplicate, foreign, missing, and confirmed-deleted nodes. Verification: 2 ID-planner unit tests, all 10 `TaskSeriesEditor` DOM tests, and `tsc --noEmit` pass.
- **2026-07-14 — Database portion completed: task deletion cascades through task-owned records (§2.3, Phase 2).** The checked-in and hosted Instant schema now cascades task deletion into `taskUpdates`, `taskResponseFields`, and `taskAttachments`, then cascades response-field deletion into `taskResponseFieldValues`; existing update-owned attachments/response values continue to use their prior cascades. A hosted smoke test creates the full graph, deletes the task, and proves all five namespaces are empty. The schema push also removed stale live-only `calendarSyncCalendars.ctag`/`syncToken` attributes that were absent from the repo; current code and schema use `lastCtag`/`lastSyncToken`. Verification: 8 schema/permission contract tests, the 2-test hosted Instant matrix (including the new cascade proof), and `tsc --noEmit` pass. **Still open:** reference-aware S3 object reclamation; duplicate task attachments can share a stored-object URL, so deleting the object blindly with either metadata row would break the survivor.
- **2026-07-14 — Completed: task-series duplication preserves hierarchy and task-owned definitions (Part 3 #2, Phase 2).** Duplicate now preallocates an old→new task ID map, creates reset task rows with weights and correct parent/leaf completion defaults, then restores parent links in a second pass. Response-field definitions are recreated with fresh IDs, and task attachments receive fresh metadata rows linked to the copied task while sharing the immutable stored-object URL. The copy still intentionally starts unassigned, unscheduled, dependency-free, and with all workflow progress reset. Verification: all 6 `TaskSeriesManager` DOM tests pass with hierarchy/weight/field/attachment assertions; `tsc --noEmit` passes.
- **2026-07-14 — Completed: cyclic task-series dependencies no longer crash the manager (§1.5, Phase 2).** Status evaluation now tracks its active dependency stack, marks every series in a detected cycle, and treats only those cycle edges as non-blocking while normal dependencies retain their existing pending behavior. Both members of a two-series cycle resolve deterministically to their independent schedule/progress status instead of overflowing the stack. Verification: all 6 `TaskSeriesManager` DOM tests pass, including the cycle regression; `tsc --noEmit` passes.
- **2026-07-14 — Completed: historical Done tasks no longer keep task series visible forever (§4.1, Phase 0).** `ChoreList` and `TaskSeriesChecklist` now share `hasVisibleTaskSeriesContent`: scheduled tasks keep the series visible (including a Done task that the scheduler returned for its completion date), as do blocked/skipped/review items, but unrelated historical Done rows do not. This aligns row and checklist visibility and removes the empty “No active tasks” shells from future dates. Verification: 36 focused task-progress, `ChoreList`, and checklist tests pass; `tsc --noEmit` passes.
- **2026-07-14 — Completed: task-series autosave no longer replays stale workflow state (§2.1, Phase 0).** Existing-task autosaves now write only changed structural fields (`text`, `order`, indentation, day-break status, and `updatedAt`); workflow state, deferral state, completion flags, and `childTasksComplete` remain owned by checklist mutations. Unchanged tasks are skipped, new tasks alone receive workflow defaults and a series link, unchanged series metadata is not rewritten, and unchanged owner/activity links are not replayed. A completely no-op editor update now avoids `db.transact` altogether. Verification: 10 focused `TaskSeriesEditor` DOM tests pass, including stale-progress preservation, new-task initialization, metadata-only saves, and no-op saves; `tsc --noEmit` passes.
- **2026-07-14 — Completed: pulled-forward task series remain visible on off-schedule days (§1.1, Phase 0).** `/tasks` now treats a positive pull-forward on the selected family day as an explicit visibility override when the chore is not scheduled: the chore row, owned-series content, and series-name pill all remain eligible, while `getTasksForDate` still decides whether a real block exists. `isSeriesActiveForDate` recognizes the same today-only override and does not leak attention-state fallbacks onto arbitrary off-schedule dates. Verification: 16 scheduler unit tests and 7 `ChoreList` DOM tests pass, including a Mon/Wed series pulled forward on Tuesday; `tsc --noEmit` passes.
- **2026-07-14 — Completed: interactive principal switches preserve the app tree and header order (§5.2, Part 6).** `signInFamilyMember` now uses `isSwitchingPrincipal` without entering the bootstrap-only `signing-in` screen, so header, main content, subscriptions, and local state stay mounted. `LoginModal` closes before the auth swap starts, allowing Radix portal/focus cleanup to finish; the obsolete body `pointerEvents` patch was removed. `ThemedHeader` also carries `order-first` as flex-layout insurance. Verification: 8 focused modal/session/header DOM tests prove in-flight tree continuity, close-before-sign-in ordering, and header ordering; `tsc --noEmit` passes.
- **2026-07-14 — Completed: parent login no longer offers a false PIN bypass (§5.1).** The web modal now always requires a PIN for a parent selection, regardless of a cached parent token; the optional-PIN copy and enabling condition were removed. The token route records a parent elevation failure only for `Incorrect PIN`, not for an empty required field or unrelated token-minting error. The unused web `canUseCachedParentPrincipal` context value was removed (mobile has its own independent provider). Verification: 12 focused login-modal/session-provider/token-route tests and `tsc --noEmit` pass.
- **2026-07-14 — Completed: shared principals discard stale member identity.** Minting a shared kid or parent token now rewrites `$users.familyMemberId` to the explicit empty-string sentinel instead of preserving whichever member ID may have been attached by an older session. Instant permission CEL can compare that sentinel safely, while member-scoped tokens continue to carry a real family-member ID. This prevents a shared-device principal from silently inheriting a previously selected member's write identity. Verification: the focused `instant-admin` unit test and `tsc --noEmit` pass.
- **2026-07-13 — Completed: device-auth cookie hardening and domain guard (§5.4).** Device cookies now carry a SHA-256 token derived from the configured `DEVICE_ACCESS_KEY` instead of the forgeable literal `true`; rotating the access key therefore invalidates old cookies. Cookie-domain inference now leaves localhost, LAN IPv4/IPv6 hosts, root domains, and common multi-part public suffix roots host-only. Deployments that need sibling-subdomain SSO can set `DEVICE_AUTH_COOKIE_DOMAIN` explicitly. Existing devices must activate once after the cookie migration from `family_device_auth` to `activation_token`. Verification: 70 focused unit/integration assertions pass across middleware, activation, server actions, calendar auth, and mobile/file routes; `tsc --noEmit` reaches only three unrelated pre-existing errors recorded for follow-up.

---

## Executive summary

| # | Area | Severity | Finding |
|---|------|----------|---------|
| 1 | /tasks | **Completed 2026-07-14** | Pulled-forward rows, owned-series content, and pills remain visible today when the chore is off schedule |
| 2 | Login | **Completed 2026-07-14** | Parent selection always requires a PIN; empty submissions do not consume elevation backoff |
| 3 | Editor | **Completed 2026-07-14** | Autosave writes changed structure only; live checklist workflow state is no longer replayed from a stale editor snapshot |
| 4 | Nav bar | **Completed 2026-07-14** | Interactive sign-in keeps the tree mounted, closes the dialog first, and pins the header first in flex order |
| 5 | /tasks | **Completed 2026-07-14** | Done-only history no longer keeps a row alive; same-day completions remain available in the Done bin |
| 6 | Data | **DB rows completed 2026-07-14** | Cascades remove task-owned rows and response values; reference-aware S3 object reclamation remains open |
| 7 | Editor | **Completed 2026-07-14** | Paste and confirmed paste replay preserve old IDs once and assign fresh IDs to every inserted task/day break |
| 8 | Manager | **Completed 2026-07-14** | Duplicate preserves hierarchy, weights, response fields, and attachment metadata while resetting workflow progress |
| 9 | Login | **Completed 2026-07-14** | The blocking screen is bootstrap-only; interactive switches preserve app state and subscriptions |
| 10 | Perf | **Medium** | Unbounded queries fetch the entire task/update/completion history on list pages |
| 11 | Device auth | **Completed 2026-07-13** | Access-key-bound cookie shipped; invalid LAN/public-suffix domain inference fixed |

Details, evidence, and the fix plan follow.

---

## Part 1 — Task series engine (`lib/`)

### 1.1 Pulled-forward work is invisible on off-schedule days — **Completed 2026-07-14**

The whole point of `pullForwardCount` is doing tomorrow's block on a day the chore isn't scheduled. The scheduler supports this: on the anchor date (today), [task-scheduler.ts:160](lib/task-scheduler.ts:160) returns `normalizedBlocks[blockOffset]` regardless of whether today is a scheduled occurrence. `ChoresTracker` also explicitly includes chores with an active pull-forward in [ChoresTracker.tsx:1194](components/ChoresTracker.tsx:1194).

But `ChoreList.renderTaskSeries` then kills it:

- [chore-utils.ts:311](lib/chore-utils.ts:311) — `getAssignedMembersForChoreOnDate` returns `[]` when `choreOccursOnDate` is false.
- [ChoreList.tsx:940-943](components/ChoreList.tsx:940) — if the series has an owner and the owner isn't in `assignedMembers` today, the series is dropped (`if (!isOwnerAssignedToday) return null`).
- Result: `taskSeriesContent` is null → in tasks mode the whole row is hidden ([ChoreList.tsx:1138](components/ChoreList.tsx:1138)).

The "Pulled forward" banner at [ChoreList.tsx:1079](components/ChoreList.tsx:1079) was written for exactly this scenario and is unreachable for any owned series. `isSeriesActiveForDate` ([task-scheduler.ts:241](lib/task-scheduler.ts:241)) has the same blind spot — it returns false on unscheduled dates without considering pull-forward, so the series name pill hides too.

**Fix:** in `renderTaskSeries` (and the pill logic), when `series.pullForwardCount > 0` and the selected date is today, bypass the `isOwnerAssignedToday` check (owner assignment is meaningless on an unscheduled day) and let `getTasksForDate` decide. Add a unit test: chore scheduled Mon/Wed, today Tue, pullForwardCount 1 → block visible Tue.

**Completed:** `ChoreList` now recognizes a today-only, off-schedule pull-forward before its chore-level assignment filter and applies the same exception to the owned-series body and name pill. The exception remains scoped to `/tasks`, the selected family-day key, and a positive `pullForwardCount`; selected-member ownership is still enforced. `isSeriesActiveForDate` now permits that same current-day exception only when `getTasksForDate` returns a visible block, so exhausted pull-forwards and future off-schedule dates stay hidden. Regression coverage proves the scheduler and full rendered-row path for a Mon/Wed series viewed on Tuesday.

### 1.2 Block-splitting logic is internally inconsistent — **Completed 2026-07-14**

In `getTasksForDate` the push condition at a day-break ([task-scheduler.ts:124](lib/task-scheduler.ts:124)) is `currentBlock.length > 0 || !currentBlockHadActionableTasks`, but the final flush ([task-scheduler.ts:146](lib/task-scheduler.ts:146)) inverts it: `currentBlock.length > 0 || currentBlockHadActionableTasks`. Consequences:

- A *middle* segment whose tasks are all done disappears (queue advances — intended).
- A *trailing* segment whose tasks are all done is pushed as an **empty block**, unlike the identical middle case.
- The `normalizedBlocks` neighbor filter ([task-scheduler.ts:150-155](lib/task-scheduler.ts:150)) keeps a single empty block between two non-empty ones but drops **both** empties in a run: `[A, [], [], B]` → `[A, B]`. If two consecutive break-days were intended, future-date projection shifts by a day.

**Fix:** extract one `splitIntoBlocks(tasks)` shared by `getTasksForDate` and `getTaskDayBlocks` (they already disagree — see 1.3), make the flush condition symmetric, and codify empty-block semantics with table-driven unit tests. This function is the heart of the feature and currently exists in two divergent copies.

**Completed:** `splitTaskDayBlocks` is now the sole definition splitter. It ignores empty segments before, after, or between break markers because a task day must contain at least one actionable definition. The scheduler maps those blocks to active/viewed-date-completed work and then removes empty live blocks, so a completed middle or trailing block advances the queue identically. The old inverted break/final conditions and `previousBlock`/`nextBlock` normalization no longer exist.

### 1.3 Two divergent block-splitters — **Completed 2026-07-14**

`lib/task-series-schedule.ts` `getTaskDayBlocks` ([task-series-schedule.ts:27](lib/task-series-schedule.ts:27)) splits *definitions* (all actionable tasks), while `getTasksForDate` splits *remaining work* (queue-filtered). They share day-break mechanics but were written twice with subtly different push conditions. Progress counts ("Days 3/7"), drift, catch-up, and the visible queue can disagree after edge cases (e.g., a block whose tasks were all deleted). Same fix as 1.2: one primitive, two projections.

**Completed:** planning/counting and queue projection now start from the same actionable definition blocks. They intentionally diverge only after splitting: planning retains completed definitions for total/completed-day counts, while the live queue filters each block to work relevant to the viewed date.

### 1.4 "Today" is computed in two different timezones — **Completed 2026-07-14**

- The scheduler derives today from **local** midnight: `toLocalMidnight(new Date())` ([task-scheduler.ts:95](lib/task-scheduler.ts:95)).
- Task bins derive today from **UTC**: `new Date().toISOString().slice(0, 10)` ([task-bins.ts:135](lib/task-bins.ts:135), also [task-bins.ts:292](lib/task-bins.ts:292)).

In Nepal (UTC+5:45), from midnight to 05:44 local the two disagree: the checklist has rolled to the new day while the bins/overdue math still thinks it's yesterday (and vice versa for late-evening UTC rollover in other timezones). Overdue counts and "submitted N days late" labels shift depending on the hour.

**Fix:** one `getTodayKey()` in `shared-core` (local-midnight semantics, built on `getNow()` so the time machine keeps working), used by scheduler, bins, checklist (`selectedDateKey`), and MyTaskSeriesOverview.

**Completed:** `shared-core` now owns `getLocalDateKey(date)` and call-time `getTodayKey()`. The scheduler converts that key back to its canonical UTC-midnight date object, while bins and UI mutations consume the key directly. `TaskBinsReview` also stopped using UTC conversion for tomorrow/date-picker values and compares calendar keys when disabling past dates. My Task Series and the manager derive their midnight comparison date from the same key. The app's production-gated time machine patches `Date`, so evaluating the default at call time preserves simulated-time behavior without introducing a second clock abstraction.

### 1.5 Dependency status can recurse forever — **Completed 2026-07-14**

`TaskSeriesManager.computeStatus` ([TaskSeriesManager.tsx:161-208](components/task-series/TaskSeriesManager.tsx:161)) caches only *after* recursing into `dependsOnSeriesId`. A cycle (A depends on B, B on A) is a stack overflow that takes down the page. There is currently no UI that writes `dependsOnSeriesId` (the field is schema-only), which is itself a gap — the feature is half-shipped.

**Fix:** track an in-progress set (`visiting`) and treat cycles as non-blocking; decide whether to build the dependency UI or remove the field.

**Completed:** `computeStatus` now maintains both an in-progress set and ordered dependency stack. Encountering an active ID marks the full cycle segment; while the recursion unwinds, each member ignores its cyclic dependency edge and computes status from its own schedule and progress. Dependencies outside the cycle still block normally, and cached results remain stable regardless of which cycle member appears first in the list. The schema field remains for existing data, but creating a dependency-editing UI is still an explicit product decision rather than part of this crash fix.

### 1.6 Misleading name

`getRecursiveTaskCompletionTransactions` ([task-scheduler.ts:254](lib/task-scheduler.ts:254)) is not recursive over children — it completes one task and syncs ancestors. Rename (`buildTaskCompletionTransactions`) before someone trusts the name and completes a parent expecting children to follow.

---

## Part 2 — Task Series Editor (`TaskSeriesEditor.tsx`)

### 2.1 Autosave stomps live workflow state — **Completed 2026-07-14**

Every debounced save writes, for **every** node in the document ([TaskSeriesEditor.tsx:1418-1431](components/task-series/TaskSeriesEditor.tsx:1418)):

```ts
workflowState: existingTaskInDb?.workflowState ?? ...,
lastActiveState: existingTaskInDb?.lastActiveState ?? 'not_started',
deferredUntilDate: existingTaskInDb?.deferredUntilDate ?? null,
childTasksComplete: !isParent,
```

Problems:

1. **Race:** `existingTaskInDb` is a snapshot. A parent typing in the editor while a kid completes a task on the tablet can write back the stale pre-completion state within the ~1s debounce window. The kid's checkmark silently reverts.
2. **`childTasksComplete: !isParent`** unconditionally resets every parent task to `false` — even when all of its children are done — corrupting the flag that `syncAncestorChildCompletionState` ([task-update-mutations.ts:217](lib/task-update-mutations.ts:217)) reads. It self-heals only on the next child state change.
3. Every keystroke rewrites every task row (text, order, workflow fields) plus the series row — write amplification and needless realtime churn for every subscribed device.

**Fix:** the editor owns *structure* (text, order, indentation, isDayBreak, parent links). It must never write `workflowState` / `lastActiveState` / `deferredUntilDate` / `isCompleted` for existing tasks, and should set them only on `create` for new tasks. Compute `childTasksComplete` from actual child states (or drop it from the editor save entirely). Also: only push `tx.tasks[...].update` for nodes that actually changed (the code already computes the comparison; use it to skip no-op updates), and skip the series `update` when `metadataChanged` is false so `updatedAt` stops churning the manager's sort order.

**Completed:** existing tasks now receive an update only when their editor-owned structure changes, and that payload contains no workflow, completion, deferral, or child-completion fields. New task creation still initializes those fields once. The editor links only new tasks, updates series metadata only when it changed (or when creating a series), and changes owner/activity links only when their targets differ. If structure, hierarchy, metadata, and links are all unchanged, no transaction is sent. Regression tests prove that a stale persisted `done` snapshot cannot enter an existing-task autosave payload and that metadata-only typing does not rewrite task rows.

### 2.2 Pasting duplicates task IDs — **Completed 2026-07-14**

Task identity lives in the `id` node-attribute. Copying a task and pasting it (within or across series) keeps the same `id`; there is no uniqueness plugin (the only re-ID pass is the delete-guard confirm path, [TaskSeriesEditor.tsx:1007-1020](components/task-series/TaskSeriesEditor.tsx:1007)). With two nodes sharing an ID, `debouncedSave` writes the same row twice (last-one-wins on `text`/`order`), `currentIds` dedupes so nothing is deleted, and on reload one of the two visible tasks is gone. Cross-series paste is worse: the task row gets **re-linked to the new series** (`tx.taskSeries[seriesId].link({ tasks: taskId })`), stealing it (and its update history) from the original series.

**Fix:** add an `appendTransaction` ProseMirror plugin that scans for duplicate/foreign `id` attrs after any doc change and assigns fresh IDs to all but the first occurrence (fresh IDs to *all* pasted nodes whose ID already exists in `persistedTaskById` under a different series).

**Completed:** an `appendTransaction` hook already existed, but it skipped every pasted node whose ID appeared in the old document—the exact duplicate-ID case—and skipped day breaks entirely. It now maps the exact old node positions through the paste transaction and preserves only those surviving positions. All other task items, including day breaks and cross-series clipboard nodes, receive fresh IDs through a shared collision-safe planner. The delete-guard's whole-document paste replay uses the same planner with a preserve-once set, closing the alternate path that bypasses the normal paste metadata.

### 2.3 Deletions orphan task data and leak storage — **Database portion completed 2026-07-14**

Schema check ([instant.schema.ts:1161-1318](instant.schema.ts:1161)): `taskUpdatesTask`, `taskResponseFieldsTask`, and `tasksAttachments` have **no** `onDelete: 'cascade'` toward `tasks`. Cascades exist only from update→attachment and update→responseFieldValue. So:

- Editor task deletion ([TaskSeriesEditor.tsx:1503-1516](components/task-series/TaskSeriesEditor.tsx:1503)) deletes the `tasks` row only → its updates, response fields, and attachments become unreachable orphans.
- Manager series deletion ([TaskSeriesManager.tsx:336-348](components/task-series/TaskSeriesManager.tsx:336)) deletes series + tasks — same orphans, multiplied.
- No path ever deletes the underlying S3 objects (task attachments, update attachments, response-field files). `handleDeleteAttachment` ([TaskSeriesEditor.tsx:360](components/task-series/TaskSeriesEditor.tsx:360)) removes the row only.

**Fix:** add `onDelete: 'cascade'` on the has-one side of `taskUpdatesTask`, `taskResponseFieldsTask`, `tasksAttachments` (and `taskResponseFieldValuesField` if a field is deleted) and push perms/schema. For S3, collect URLs before deletion and call the existing delete endpoint (or accept the leak consciously and add a periodic orphan-sweep script under `scripts/`).

**Database rows completed and deployed:** all four missing has-one cascades are now in `instant.schema.ts` and the configured hosted Instant app. The live regression creates a task with an update, response field/value, and attachment, deletes only the task, then confirms that every dependent namespace is empty. This covers both editor task deletion and manager series deletion because both ultimately delete task rows.

**S3 cleanup still open:** attachment duplication now creates distinct metadata rows that intentionally share an immutable object URL. Calling the existing object-delete action when either task is removed could therefore break the remaining copy. Safe cleanup needs a reference-aware sweep: enumerate live task/update attachment URLs, list the task-upload prefix, and delete only objects absent from every live metadata row (with a grace period). Until that exists, row integrity is fixed but unreferenced object bytes may remain.

### 2.4 The delete-guard's "skip" branch leaves ghosts

When unconfirmed data-tasks disappear from the doc through a path the guard didn't catch, `debouncedSave` skips deleting them ([TaskSeriesEditor.tsx:1493-1506](components/task-series/TaskSeriesEditor.tsx:1493)) — the comment admits the "re-add to editor" half was never built. The rows silently linger in the DB (and reappear on reload, which will confuse whoever deleted them). Low frequency, but implement the re-add or surface a toast ("N tasks kept because they have data — reopen to restore or confirm deletion").

### 2.5 Date preview lies about in-progress series

`calculateDates` ([TaskSeriesEditor.tsx:717-809](components/task-series/TaskSeriesEditor.tsx:717)) overrides the chore rrule's `dtstart` with the series start date and evaluates in local time, while the real queue anchors on *today* (rolling queue) with the chore's own start date and UTC handling. For an in-progress or behind-schedule series, the editor's date chips show the original plan, not what the kid will actually see; timezone edges can shift chips by a day. **Fix:** compute preview dates through the same `getTaskDayBlocks` + `getNthOccurrence` pipeline used by `computeLiveProjectedEndDate`, and label plan vs. live ("planned Wed 7/15 · currently projected Fri 7/17").

### 2.6 Editor performance

- The card list re-renders every card on every keystroke (`updateTaskTitle` → full doc → `buildTaskCardItems`); `TaskSeriesCard` is not memoized. A 150-task curriculum will type sluggishly. Memoize on `(item, historyOpen)` and consider virtualization.
- The query ([TaskSeriesEditor.tsx:638-659](components/task-series/TaskSeriesEditor.tsx:638)) fetches every update with attachments/actors for every task (needed only when a history panel opens) and **all chores unfiltered** for the activity dropdown. Fetch updates lazily per-task; fetch chores as id+title only.
- `plannedEndDate` block-counting for unsaved nodes uses `order: 0` and reaches into `editor.state.doc.content.content` (private API) ([TaskSeriesEditor.tsx:1626-1644](components/task-series/TaskSeriesEditor.tsx:1626)) — derive from the JSON you already have (`json.content` order) instead.

### 2.7 Feature gaps noticed while auditing

- `tasks.weight` exists in the schema but has no editor UI.
- No way to reorder/move a task *between* day-blocks from the cards pane (only drag in bulk editor).
- Native `confirm()` for attachment removal while everything else uses styled dialogs.

---

## Part 3 — Manager list (`/task-series`)

1. **Over-fetch:** the list query ([TaskSeriesManager.tsx:62-77](components/task-series/TaskSeriesManager.tsx:62)) pulls the complete update/reply/attachment/response tree for every task of every series just to render progress bars and a grade chip. This page will get slower every month of use. Fetch tasks with only the fields needed for counting (`isDayBreak`, `order`, `workflowState`, `isCompleted`, `parentTask`), and compute grades from a narrower projection.
2. **Duplicate is lossy — Completed 2026-07-14.** The old path copied `indentationLevel` but not `parentTask` links, `responseFields`, `weight`, or task attachments. Duplicate now preallocates every copied task ID, creates reset task definitions, then restores parent links from the old→new map. It recreates response fields and attachment metadata with fresh IDs; attachment rows intentionally reuse the immutable object URL so files are not uploaded again. Assignee, scheduled activity, dependency, and progress remain intentionally reset for the new copy.
3. **`today` frozen at mount — Completed 2026-07-14.** The manager refreshes its shared local-calendar key every minute and whenever a visible tab returns from the background. Status, drift, and catch-up projections recompute when that key changes; a fake-clock DOM test proves the midnight transition without a reload.
4. **Catch-up error handling — Completed 2026-07-14.** A rejected transaction now produces a destructive “planned end date was not changed” toast and logs the underlying error; success feedback is emitted only after the write resolves. The DOM regression forces a rejection and proves no success toast is shown.
5. **Delete-dialog target cleanup — Completed 2026-07-14.** `onOpenChange(false)` now clears `seriesToDelete` for Cancel, escape, outside close, and post-delete closure. A DOM test cancels without transacting and opens a different series prompt cleanly.

---

## Part 4 — `/tasks` presentation

### 4.1 Completed series haunt every future date — **Completed 2026-07-14**

Visibility of the checklist section is `tasks.length > 0 || hasBucketedTasks` ([ChoreList.tsx:960-964](components/ChoreList.tsx:960)), and `getTaskBucketCounts` includes the **done** bucket ([task-progress.ts:377-384](lib/task-progress.ts:377)). `TaskSeriesChecklist` likewise renders whenever any bucket is non-empty ([TaskSeriesChecklist.tsx:266-279](components/TaskSeriesChecklist.tsx:266)). So once a series has a single completed task, its section renders on *every* date the owner is assigned — including long after the series is fully finished ("No active tasks are due right now" + a Done bin). Meanwhile the series-name pill uses a different rule (`isSeriesActiveForDate`, [ChoreList.tsx:890](components/ChoreList.tsx:890)), so pill and body can disagree.

**Fix:** exclude `done` from the "keep the section alive" test (show the Done bin only when there are also active/blocked/review items or when the completion happened on the viewed date); hide the section entirely when the series status is archived; use one shared visibility predicate for pill + body.

**Completed:** the row and checklist now call the same visibility predicate. A scheduled task returned for the viewed date keeps the series visible even when it is Done, so the user can still inspect a same-day completion. Outside that scheduler projection, only blocked, skipped, or needs-review buckets keep the series alive; historical Done tasks alone no longer render the row or its empty checklist shell. The series pill continues to use `isSeriesActiveForDate`, whose active/attention semantics now match the body for this case.

### 4.2 Checkbox is hardcoded unchecked; completions vanish

Active rows render `<Checkbox checked={false}>` ([TaskSeriesChecklist.tsx:651-655](components/TaskSeriesChecklist.tsx:651)) because done tasks are filtered out of Active Work ([TaskSeriesChecklist.tsx:213](components/TaskSeriesChecklist.tsx:213)) into a collapsed "Done" bin. Tapping the box gives no check animation — the task just disappears; undo requires finding and expanding the Done bin. For kids this is the single biggest motivational miss on the page. **Fix:** keep tasks completed *on the viewed date* in place, checked, with a brief celebration (the fireworks component already exists), and move them to the bin only on the next day.

### 4.3 The giant query — **Medium**

`ChoresTracker`'s query ([ChoresTracker.tsx:223-301](components/ChoresTracker.tsx:223)) fetches, on every `/`, `/chores`, and `/tasks` load: all chores × all task series × all tasks × all updates **including replies with actors/attachments/grades**, plus **every `choreCompletions` row ever created** (unbounded, grows forever), all envelopes, all assignments. Any write anywhere re-runs this. This is the main scalability cliff in the app.

**Fix plan:** split by page mode — `/tasks` doesn't need envelopes/completions; `/chores` doesn't need task-update trees. Constrain completions with an indexed `where: { dateDue: { $gte: <window> } }` (`dateDue` is already a string date-key; add index if missing). Fetch update replies only inside the composer dialog.

### 4.4 Smaller presentation issues

- `dangerouslySetInnerHTML` renders stored response HTML unsanitized in three places ([TaskSeriesChecklist.tsx:788](components/TaskSeriesChecklist.tsx:788), [TaskSeriesChecklist.tsx:1163](components/TaskSeriesChecklist.tsx:1163), TaskBinsReview equivalents). Content is TipTap-authored today, but any future input path makes this XSS. Run through DOMPurify or render with a read-only TipTap instance.
- Past dates are fully read-only (`isPastDate` → `isReadOnly`), so nobody can backfill yesterday's forgotten checkmark without the time machine. Consider allowing parents to complete-for-date.
- `/my-tasks` (MyTaskSeriesOverview) is a fully built page reachable by no nav link ([MainNav.tsx:17-30](components/MainNav.tsx:17)). Decide: add it to the nav (it's a better kid-facing view than `/tasks` in some ways) or delete it.
- Expansion state (`expandedTaskSeriesByMember`) is in-memory only and resets on navigation; persist per-member view prefs like `viewShowTaskDetails` already does.
- TaskBinsReview fetches **every task in the database** with full update trees ([TaskBinsReview.tsx:136-161](components/task-series/TaskBinsReview.tsx:136)); filter server-side by non-terminal `workflowState` (indexed) instead.

---

## Part 5 — Login / auth

### 5.1 "PIN optional on this device" is a lie — **Completed 2026-07-14**

- `LoginModal` shows "Parent mode is already unlocked on this device / PIN optional" and enables Continue with an empty PIN when `canUseCachedParentPrincipal` is true ([LoginModal.tsx:108-109](components/auth/LoginModal.tsx:108), [LoginModal.tsx:238](components/auth/LoginModal.tsx:238)).
- But `signInFamilyMember` *always* requests a fresh token with the typed PIN ([InstantFamilySessionProvider.tsx:118-150](components/InstantFamilySessionProvider.tsx:118)) — the cached token is never reused for an explicit login.
- The server *always* requires the PIN when a `pinHash` exists ([instant-admin.ts:133-141](lib/instant-admin.ts:133)).
- So an empty-PIN submit returns 400 "PIN is required", and **each attempt records a parent-elevation failure** ([app/api/instant-auth-token/route.ts:104-107](app/api/instant-auth-token/route.ts:104)) — a parent who trusts the UI a few times gets rate-limited (429) and locked out.

**Fix (choose one):**
a. Honest UI: drop `canUseCachedParentPrincipal` from the modal; always require the PIN. Simplest, most secure.
b. Real skip: when the current Instant session is already this parent (`auth.user.familyMemberId === member.id && principalType === 'parent'`), skip the token fetch entirely and just run the local `login()` bookkeeping. No server change needed; do *not* count it as an elevation.

Also stop counting "PIN is required" (empty submissions) as brute-force failures server-side — only count wrong PINs.

**Completed with option (a):** the modal no longer reads or displays cached-parent reuse state. Parent Continue stays disabled until a PIN is entered, and offline parent selection always explains that server verification is required. The token route now increments backoff only when credential verification returns `Incorrect PIN`; `PIN is required` returns 400 without changing rate-limit state.

### 5.2 Every login unmounts the whole app — **Completed 2026-07-14**

`InstantFamilySessionProvider` returns the full-screen "Connecting to family data..." panel whenever `status === 'signing-in'` ([InstantFamilySessionProvider.tsx:276-282](components/InstantFamilySessionProvider.tsx:276)) — which `signInFamilyMember` sets on every user switch. The entire tree (including the LoginModal that initiated the call) unmounts mid-await, all component state is lost, and InstantDB re-boots its subscriptions (the giant queries from 4.3 refetch). This is the "flash/reload feeling" on every login.

**Upgraded to High:** a captured DOM snapshot proved this remount is also the direct cause of the nav-bar-at-bottom bug — the re-insertion pass after the swap can put `<header>` after `<main>` (and inverted the dialog's overlay/content the same way). Full analysis and fix in Part 6.

**Fix:** reserve the blocking screen for the *initial* bootstrap (`checking`). For interactive switches, keep children mounted and let the modal show its own spinner (`isVerifying` already exists); close the dialog before initiating the switch. If some subtrees misbehave during principal swaps, gate those subtrees, not the root.

**Completed:** interactive `signInFamilyMember` calls no longer set the provider's bootstrap `signing-in` status. The context's `isSwitchingPrincipal` flag still reports progress without replacing children, and the modal is closed immediately before the switch begins. A deferred-token DOM regression holds the request open and proves the existing child tree remains rendered with no “Connecting to family data...” screen.

### 5.3 Idle-logout layering is confusing — **Medium**

Three timers/flows sign people out in different ways:

1. `AuthProvider` logs out any non-remembered user after 60 min idle ([AuthProvider.tsx:31](components/AuthProvider.tsx:31), [AuthProvider.tsx:126-151](components/AuthProvider.tsx:126)) — full Instant sign-out.
2. Parent shared-device mode demotes after 15 min idle (`useParentSharedDeviceTimeout`) — but `ensureKidPrincipal` doesn't demote to a kid at all: it **signs out completely** ([InstantFamilySessionProvider.tsx:79-85](components/InstantFamilySessionProvider.tsx:79)), so the kitchen tablet lands on the lock screen, not a kid view.
3. Parent tokens themselves expire server-side.

Net effect: the family sees "the app keeps logging me out" with different timings depending on who/where. Recommend one written policy, e.g.: kids never idle out on trusted devices (remember-me default ON in the modal), parent elevation always drops to the *previous kid selection* (true demotion — keep a kid token cached and `signInWithToken` back to it), and the 60-min blanket logout applies only when no remember-me. Also rename `ensureKidPrincipal` to what it does today (`signOutPrincipal`) until real demotion exists.

### 5.4 Smaller auth findings

- `getParentUnlocked() || true` is always true ([InstantFamilySessionProvider.tsx:111](components/InstantFamilySessionProvider.tsx:111)) — the persisted lock flag is dead on the restore path. Today it's mostly masked (demotion clears the token too), but the expression is wrong; use the stored value or delete the flag.
- **PIN hashing is unsalted SHA-256** ([instant-admin.ts:105-107](lib/instant-admin.ts:105), mirrored client-side in [pin-client.ts](lib/pin-client.ts)) — for 4-digit PINs the hash is decorative (10k guesses). Server-side, switch to HMAC with a server secret (or scrypt); rate-limit kid PIN attempts too (currently only parents are limited, [route.ts:60-66](app/api/instant-auth-token/route.ts:60)).
- `components/auth/useInstantPrincipalSwitching.ts` (168 lines) is imported nowhere — dead code; delete it before it drifts further from reality.
- **Completed 2026-07-14:** the `document.body.style.pointerEvents` patch was removed after the modal began closing before the principal swap and the full-tree remount was eliminated.
- `AuthProvider.isAuthenticated` requires the `familyMembers` roster row to resolve ([AuthProvider.tsx:57-72](components/AuthProvider.tsx:57)); a deleted member or slow roster query reads as "logged out" with no message.
- **Completed 2026-07-13 — device-auth WIP:** `getParentDomain` now returns no explicit domain for LAN IPv4/IPv6 hosts, localhost, root domains, and common multi-part public-suffix roots; `DEVICE_AUTH_COOKIE_DOMAIN` is the explicit override for sibling-subdomain deployments. The activation cookie is now bound to a digest of `DEVICE_ACCESS_KEY` rather than the literal `true`. The cookie rename to `activation_token` intentionally requires one re-activation on existing devices and future access-key rotations invalidate existing activation cookies.

---

## Part 6 — Nav bar moving to the bottom — **Completed 2026-07-14**

### Root cause

A DOM snapshot captured at the moment of failure (immediately after entering a PIN to switch users) shows the true cause: **the `<header>` element is physically the *last* child of `<body>`, after `<main>`** — reversed from the JSX order in [layout.tsx:135-158](app/layout.tsx:135). The nav bar isn't "sticking wrong"; its normal-flow position *is* the bottom of the page. `sticky top-0` can't help an element whose flow position is at the end of a non-scrolling body.

Three facts from the capture pin down how it happens:

1. **The server sent the correct order.** The RSC flight payload embedded in the same capture lists `ThemedHeader` (`$L5`) before `ThemedMain` (`$Le`). The DOM diverged on the client.
2. **Two independent sibling pairs were inverted, not just one.** The Radix dialog's children are declared Overlay-then-Content ([dialog.tsx:40-41](components/ui/dialog.tsx:40)), but the captured DOM has the content `div[role="dialog"]` *before* the overlay. Same inversion signature as header/main — this was a corrupted re-insertion pass, not a one-off.
3. **The remount interleaved with live Radix teardown state.** The body carries `data-scroll-locked="1"`, two focus-guard spans, and stale `aria-hidden`/`data-aria-hidden` marks applied *inside* the header (left nav div, date span, user button) while the header element itself is unmarked — marks from different DOM generations. The pre-existing `document.body.style.pointerEvents` hack in [LoginModal.tsx:55-67](components/auth/LoginModal.tsx:55) is earlier fallout from this same race.

The trigger is finding **5.2**: `signInFamilyMember` sets `status='signing-in'`, which makes `InstantFamilySessionProvider` swap the entire app tree (header, main, toaster, and the *open* login dialog with its portal, focus trap, scroll lock, and aria-hidden sweep) for the "Connecting to family data..." div, then swap everything back moments later. React re-inserts the remounted top-level nodes among the leftover/portal body children and the sibling order comes out wrong. It reproduces intermittently ("sometimes") because it depends on what portals/guards exist in `<body>` at swap time.

### Fix (in order of importance)

1. **Completed:** interactive sign-in no longer swaps the app tree for the bootstrap screen; the modal owns the progress state.
2. **Completed:** `LoginModal.handlePinSubmit` closes the dialog before calling `signInFamilyMember`, and the pointer-events cleanup workaround is gone.
3. **Completed:** `ThemedHeader` has `order-first`, with a DOM contract test locking the class in place.

### Secondary findings kept from the layout investigation

These are real but were not the cause of the captured incident:

- With `overflow-hidden` on `main` ([ThemedAppShell.tsx:99](components/ThemedAppShell.tsx:99)), `main` is a scroll container the user can't operate. I verified in a synthetic repro that focusing an element below the fold scrolls it internally (`scrollTop=1258`, no scrollbar, no way to scroll back) — content can appear cut off/shifted, especially while the dashboard body-lock ([ThemedAppShell.tsx:62-95](components/ThemedAppShell.tsx:62)) is active.
- The app runs as an iOS home-screen PWA with a `sticky` header and `min-h-screen`; iOS keyboard/visual-viewport panning can transiently displace sticky chrome. Converting to a single app-shell regime (body `h-dvh overflow-hidden`, header normal-flow, `main` as the only scroll container with `overflow-y-auto`, `viewportFit: 'cover'` + safe-area padding) removes the sticky dependency, fixes the focus-scroll trap, and deletes the dashboard's special body-locking effect. Worth doing as hardening after the primary fix lands.

---

## Part 7 — Fix plan

### Phase 0 — quick correctness wins (small diffs, high value)

1. ~~**Pull-forward visibility** (1.1): bypass owner-assignment check when `pullForwardCount > 0` on today; extend `isSeriesActiveForDate`.~~ **Completed 2026-07-14**, including the earlier chore-row filter and scheduler/DOM regressions.
2. ~~**PIN-optional lie** (5.1): remove the affordance and stop counting empty-PIN submits as failures.~~ **Completed 2026-07-14.**
3. ~~**Editor autosave scope** (2.1): stop writing workflow fields for existing tasks; skip no-op task updates and no-op series updates.~~ **Completed 2026-07-14**, including no-op link and transaction suppression.
4. ~~**Done-forever sections** (4.1): shared visibility predicate; exclude `done` bucket from keep-alive.~~ **Completed 2026-07-14**, while retaining same-day completions returned by the scheduler.
5. ~~**Device-auth WIP guard** (5.4): IP/localhost guard in `getParentDomain` before this branch ships.~~ **Completed 2026-07-13**, including IPv6, multi-part suffix handling, explicit domain configuration, and access-key-bound cookie values.

### Phase 1 — app shell / nav bar

6. ~~**Nav bar fix** (Part 6): keep the app mounted during sign-in (5.2), close the login dialog before switching principals, and add `order-first` to the header as CSS insurance.~~ **Completed 2026-07-14.**
7. App-shell hardening (Part 6 secondary): convert to the fixed layout (body `h-dvh overflow-hidden`, non-sticky header, `main` as sole scroll container). One PR touching `layout.tsx` + `ThemedAppShell.tsx`; manual pass on iPad PWA (keyboard open/close, backgrounding).

### Phase 2 — data integrity

8. **Partially completed 2026-07-14:** ~~schema cascades for task-owned children + hosted push (2.3).~~ S3 policy resolved in favor of a reference-aware orphan sweep; implementing that sweep remains open.
9. ~~Unique-ID enforcement plugin in the editor (2.2).~~ **Completed 2026-07-14** for normal paste and confirmed paste replay, including day breaks and foreign IDs.
10. ~~Faithful series duplication (Part 3 #2).~~ **Completed 2026-07-14** for hierarchy, weights, response fields, and attachment metadata.
11. ~~Cycle guard in `computeStatus` (1.5).~~ **Completed 2026-07-14** with deterministic non-blocking cycle edges.

### Phase 3 — engine consolidation

12. ~~Single `splitIntoBlocks` primitive + table-driven tests for empty-block/day-break semantics (1.2, 1.3).~~ **Completed 2026-07-14** with empty segments explicitly treated as non-days.
13. ~~`getTodayKey()` in shared-core; adopt everywhere (1.4).~~ **Completed 2026-07-14** across scheduler, bins/review actions, member overview, and manager status.
14. Align editor date preview with the live projection (2.5).

### Phase 4 — performance

15. Per-page lean queries: ChoresTracker split by pageMode; completions windowed; manager/bins narrow projections; editor lazy update-history (4.3, Part 3 #1, 2.6).
16. Memoize `TaskSeriesCard`; virtualize card list for big series.

### Phase 5 — UX & hardening polish

17. In-place completion feedback + Done-bin deferral (4.2).
18. One idle/lock policy; true kid demotion; rename `ensureKidPrincipal` (5.3).
19. HMAC/scrypt PINs + kid rate limiting (5.4).
20. Sanitize response-field HTML (4.4).
21. Delete `useInstantPrincipalSwitching.ts`; resolve `/my-tasks` (link it or remove it).
22. Retire the LoginModal pointer-events hack once Phase 1 items 6 have soaked.

---

## Part 8 — Improvement ideas (not defects)

- **Kid-facing "Today" mode for `/tasks`:** a per-kid hero view — big progress ring for today's block, remaining count, streak of fully-completed days, and the existing fireworks on block completion. The data (blocks, drift) already exists in `task-series-schedule.ts`.
- **"Work ahead" affordance on the empty state:** when today's block is done and `canPullForward` is true, the checklist's empty state should offer "Pull tomorrow's tasks" inline (today the flow lives elsewhere) — pairs naturally with the 1.1 fix.
- **Series templates:** the lossy Duplicate (Part 3 #2), once fixed, is 90% of a "Save as template / start from template" feature — useful for recurring curricula (summer reading, semester math).
- **Review inbox for parents:** `needs_review` items across all series with one-tap approve + grade from a single screen; TaskBinsReview is close but is series/task-centric rather than "what needs me now"-centric. A badge count on the nav's Task Series entry would close the loop.
- **Editor: import from paste with day markers:** the bulk editor already parses lines; recognizing a `---` or blank-line convention as day breaks would make pasting a curriculum from a syllabus one step.
- **Deferred-task visibility:** tasks with `deferredUntilDate` in the future are invisible until that date with no UI hint anywhere; show them greyed in the checklist ("returns Mon") so kids/parents don't think they vanished.
- **Unify `Task` types:** at least five structurally-similar task interfaces exist (`task-scheduler.Task`, editor `Task`/`PersistedTask`, `TaskBinTask`, `TaskUpdateTaskLike`, `TaskProgressTaskLike`). One `shared-core` base type with per-module extensions would prevent the field-drift that caused several of the bugs above.
- **Nav grouping:** 12 top-level links collapse into an unlabeled hamburger on tablets; grouping (Chores/Tasks · Calendar · Money · Admin) would keep the common four visible on an iPad in portrait.
- **Accessibility:** re-enable pinch zoom (`userScalable`) once the app-shell fix lands — with a non-sticky header, zoom no longer breaks the chrome, and iOS accessibility users get zoom back.

---

*Verification notes: findings in Parts 1–5 are from code-path tracing (file:line references throughout). Part 6's root cause is confirmed by a DOM snapshot captured at the moment of failure (header re-inserted after main during the sign-in remount, dialog overlay/content inverted the same way, RSC payload order correct); the shell CSS behavior was additionally verified with a synthetic browser reproduction.*
