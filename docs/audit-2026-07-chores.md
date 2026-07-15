# Audit: Chores System

**Date:** 2026-07-12
**Scope:** `lib/chore-utils.ts`, `lib/chore-schedule.ts`, `lib/recurrence.ts`, `packages/shared-core/src/chores.ts` + `chore-countdown-engine.ts`, `components/ChoresTracker.tsx` (mutation paths), `components/ChoreList.tsx` (completion flows), `components/DetailedChoreForm.tsx`, chore-related permissions in `instant.perms.ts`.
**Method:** Static code-path tracing. Query over-fetching for the chores dashboard was covered in the task-series audit (finding 4.3) and is not repeated here.

---

## Implementation progress

- **2026-07-15 — Completed: chore-form validation is nonblocking and accessible (§1.4).** All 12 repeat, reward, timing-window, marker, and chore-anchor validation exits now feed one persistent inline `role="alert"` panel with a clear “needs attention” heading instead of opening a browser modal. A new validation attempt clears stale content, and a successful retry removes the panel before save; timeline-warning state is reset when a true validation error takes precedence. Verification: source search finds no `alert()` call in `DetailedChoreForm`, all 6 form DOM tests pass (including invalid fixed reward → visible error → corrected save with no native alert), and `tsc --noEmit` passes.
- **2026-07-15 — Completed: countdown packing has table-driven golden scenarios (§5.2).** A separate fixture-to-layout suite now verifies the interacting rules as complete timelines rather than one assertion at a time: a buffered three-chore deadline stack, exact-completion pull-forward, second-precision `after_chore`, a start-driven split/resume around a deadline collision, and joint-chore constraint propagation across otherwise independent people. The normalized expectations preserve effective and target times plus unresolved collision IDs. Verification: all 42 countdown-engine tests pass (5 golden scenarios plus the existing 37 focused cases); `tsc --noEmit` passes.
- **2026-07-15 — Completed and deployed: kid-created history is self-attributed (§2.2).** A member-scoped kid may create an immutable history event only when `actorFamilyMemberId` equals the authenticated family-member identity; the shared kid principal has no identity and cannot create one. The actor relation is restricted on both the history-event and family-member sides, so a kid cannot pair a truthful scalar stamp with a forged sibling actor link. Parents retain delegated/system history creation, while update, delete, and unlink remain denied. Verification: all 11 permission-contract tests and `tsc --noEmit` pass; the permissions push succeeded; the 3-test hosted Instant matrix proves own creation and parent delegation succeed while forged scalar, forged link, and identity-less shared-kid creation are denied.
- **2026-07-15 — Completed: pause/rotation and historical-XP semantics are explicit and covered (§1.3).** Exdates, including those produced by a bounded pause, do not consume turns; the next real occurrence continues the prior daily/weekly/monthly sequence. Uncompleted history and allowance periods that have not been distributed intentionally remain projections of the currently edited schedule. Once a completion exists, its `completedBy` link is the durable XP beneficiary, so a later exdate or rotation edit cannot erase that member's earned/possible XP for the completed date. Already-created allowance-period and finance records remain stored records rather than live schedule views. Verification: 41 focused shared-core, schedule, and allowance tests pass, including a bounded-pause rotation sequence and a retroactive-exdate XP regression; `tsc --noEmit` passes.
- **2026-07-15 — Completed: repeated chore schedule and rotation work is cached (§5.1, Phase 3).** Both the shared-core/mobile assignment engine and the richer web schedule engine now keep bounded content-keyed LRUs for parsed `RRuleSet`s and expanded date ranges; shared rotation indices are additionally cached by normalized schedule, rotation type, and target date. Equivalent object instances with the same RRULE/start/exdates reuse results, while schedule edits naturally produce a new key. The countdown builder now resolves a timed chore's assignment once and carries it into the input instead of repeating the same call in `.filter()` and `.map()`. Verification: 43 focused shared/web/ChoresTracker tests pass, including parser/range invocation counts and the per-render countdown lookup delta; `tsc --noEmit` passes.
- **2026-07-15 — Completed: shared-core is the single assignment and daily-XP implementation (§3.1, Phase 2).** The web compatibility exports in `lib/chore-utils.ts` now delegate directly to the same `getAssignedMembersForChoreOnDate` and `calculateDailyXP` functions used by dashboard widgets and mobile; the duplicate web rotation index, assignee selection, and XP loops were removed. Shared assignee normalization now preserves the optional color used by web calendar surfaces. Verification: all 33 web/shared chore tests pass, including an explicit cross-entry-point contract covering exdates, rotation, completion XP, and color; `tsc --noEmit` passes.
- **2026-07-15 — Completed and deployed: chore deletion is impact-aware and preserves scheduled task series (§4.1, Phase 1).** A parent delete request now performs an on-demand chore-ID query for the complete completion, rotation-assignment, and dependent-task-series relationships instead of trusting the selected-day list projection. The dialog reports destructive row counts and blocks deletion while any task series still uses the chore as its scheduled activity, naming those series and linking to the first editor. An allowed confirmation re-reads the impact immediately before deletion and closes only after success. Hosted `choresCompletions` and `choresAssignments` links now cascade from chore deletion. Verification: all 11 `ChoreList` DOM tests and 10 schema/permission contracts pass; `tsc --noEmit` passes; the schema push succeeded and the 3-test hosted Instant matrix proves both child namespaces are empty after deleting only the chore.
- **2026-07-14 — Completed: removed schema-invalid and unresolved chore helpers (§1.5, §3.2).** Deleted the unused `getNextOccurrence`/`getOccurrences` wrappers with unresolved local-vs-UTC behavior, the unused async assignment/grid helpers that queried nonexistent `choreCompletions.date`, and the empty hardcoded family-member UUID branch. Live allowance callers of `createRRuleWithStartDate` remain intact. Verification: repository search finds no remaining references or flagged literals, 32 chore/shared-core tests pass, and `tsc --noEmit` passes.
- **2026-07-14 — Completed: weightless chores remain editable (§1.4).** A blank weight is now a valid explicit weightless value and saves as `null`; invalid non-empty numeric input is still rejected. The form no longer marks weight required or disables the save/update button solely because the field is blank, and its helper text explains blank/zero exclusion. Verification: all 5 `DetailedChoreForm` DOM tests pass, including editing an existing null-weight chore, and `tsc --noEmit` passes.
- **2026-07-14 — Completed: bulk task completion uses one evolving task snapshot (§1.2).** `buildBulkTaskUpdateTransactions` owns a shared cloned task map and feeds it through each child update, so sibling transitions and ancestor rollups accumulate within the same Instant transaction batch. `ChoreList` now uses that helper for “Mark All Done & Complete”; duplicate task IDs are ignored. A three-sibling regression proves the final parent update is `done`, `isCompleted: true`, and `childTasksComplete: true`. Verification: all 7 task-update mutation tests and `tsc --noEmit` pass.
- **2026-07-14 — Completed and deployed: chore-completion ownership and payout-field isolation (§2.1).** Member-scoped kids can create completion rows only with `allowanceAwarded: false`, link `completedBy`/`markedBy` only to their authenticated family member, and update only their own `completed`, `notDone`, and `dateCompleted` fields. They cannot update a sibling's row, change `dateDue`, re-arm `allowanceAwarded`, delete/unlink completions, or create rows from the shared kid principal; parents retain the administrative paths. The rules were pushed to the configured Instant app. Verification: 7 local permission-contract tests, the focused shared-principal unit test, `tsc --noEmit`, and the hosted anonymous/shared-kid/member-kid/parent matrix pass using the same multi-step transaction shape as `ChoresTracker`.
- **2026-07-14 — Completed: up-for-grabs claims converge and legacy duplicates cannot double-credit (§1.1).** A shared UUIDv5 helper derives the completion row ID from `(choreId, dateDue)` for up-for-grabs chores, so concurrent web, countdown/sequence, and mobile claims update/link the same Instant row instead of creating two rewards. Normal assigned chores retain random IDs. Existing duplicate rows are canonicalized by earliest `dateCompleted`: XP credits only that winner, and allowance preprocessing suppresses losing rows while expanding the winner's award-mark set to close every duplicate. Verification: 37 focused shared-core/chore-utils/ChoresTracker tests pass; `tsc --noEmit` passes.
- **2026-07-13 — Completed: second-precision `after_chore` countdown anchoring (§5.2).** Completion-anchored chores now use the anchor chore's exact completion timestamp rather than its minute-truncated schedule offset, and the packing pass no longer pushes the dependent chore behind the already-completed anchor's old slot window. The focused countdown-engine suite passes all 37 scenarios, including a completion at `08:03:45` that starts the dependent chore exactly five minutes later.

---

## Executive summary

| # | Severity | Finding |
|---|----------|---------|
| 1 | **Completed 2026-07-14** | Up-for-grabs claims now converge on a deterministic row; legacy duplicates are canonicalized for XP and payout |
| 2 | **Completed 2026-07-14** | Kid completion writes are member-scoped; payout/date fields and administrative delete/unlink paths are parent-only |
| 3 | **Completed 2026-07-14** | Bulk completion now shares evolving task state, so final ancestor workflow/child-completion fields are correct |
| 4 | **Completed 2026-07-15** | Web compatibility exports, dashboard, and mobile now use one shared-core assignment/XP implementation |
| 5 | **Completed 2026-07-15** | Rotation pauses preserve turns, completed XP is stable after later schedule edits, schedule work is cached, and countdown no longer resolves the same assignment twice |
| 6 | **Completed 2026-07-15** | Deletion reports/cascades chore-owned rows and is blocked while a task series still depends on the schedule |
| 7 | **Completed 2026-07-14** | Schema-invalid dead helpers, the hardcoded debug branch, and unresolved occurrence wrappers were removed |
| 8 | **Completed 2026-07-15** | Immutable kid-created history events and actor links are bound to the authenticated family member |
| 9 | **Completed 2026-07-15** | Countdown packing combinations are covered by normalized table-driven timeline scenarios |
| 10 | **Completed 2026-07-15** | Chore-form validation uses one accessible inline error panel instead of blocking browser alerts |

---

## 1. Correctness

### 1.1 Up-for-grabs double-completion race — **Completed 2026-07-14**

`toggleChoreDone` guards up-for-grabs claims purely client-side: it checks the locally-cached `allChoreCompletions` for an existing completion ([ChoresTracker.tsx:753-776](components/ChoresTracker.tsx:753)) before creating a new completion row with a fresh random ID ([ChoresTracker.tsx:825-838](components/ChoresTracker.tsx:825)). Two kids tapping the same up-for-grabs chore within the sync window (a second or two, longer offline) both pass the check and both create completions. Consequences:

- `calculateDailyXP` credits **both** completers ([chore-utils.ts:733-744](lib/chore-utils.ts:733)).
- `calculatePeriodDetails` pays the **fixed reward twice** — it iterates all completions in the period with no per-(chore, date) dedupe ([chore-utils.ts:544-584](lib/chore-utils.ts:544)).
- Display code assumes one completer (`completionsOnDate[0]`), so the UI hides the duplicate while the money/XP double-count stands.

**Completed:** `createChoreCompletionRecordId` uses UUIDv5 over `(choreId, dateDue)` for up-for-grabs completions and is used by every current web/countdown/sequence/mobile create path. Concurrent claims therefore target one valid Instant UUID and the has-one `completedBy` relationship converges on a single winner. For pre-fix duplicate rows, the earliest completion is canonical: both XP implementations credit only it, while allowance preprocessing pays only its member and includes every duplicate ID in the award-mark transaction. The loser device receives the converged row through Instant's subscription and the existing "already completed" UI takes over.

### 1.2 Bulk "Mark all & complete" corrupts parent-task state — **Completed 2026-07-14**

`confirmMarkAllAndComplete` flat-maps one `buildTaskUpdateTransactions` call per incomplete task ([ChoreList.tsx:526-540](components/ChoreList.tsx:526)). Each call clones the *same* `allTasks` snapshot, so each transaction's ancestor-sync (`syncAncestorChildCompletionState`) sees all *other* siblings as still incomplete. Completing the last 3 children of a parent this way leaves the parent `in_progress` with `childTasksComplete: false` even though every child is now `done` in the database.

**Completed:** `buildBulkTaskUpdateTransactions` clones the full task list once, passes the same mutable map through each existing task-update build, and appends each result to one transaction array. The existing builder already mutates the target and every rolled-up ancestor in that map, so later sibling updates observe earlier transitions and the final parent write reflects the complete batch. `ChoreList.confirmMarkAllAndComplete` now calls the bulk helper instead of flat-mapping isolated builders. The regression covers three incomplete siblings under one parent and asserts the final parent write is fully done.

### 1.3 Rotation semantics are retroactively unstable — **Completed 2026-07-15**

`getRotationIndex` counts *actual occurrences* from the chore's start date to the target date ([chore-utils.ts:266-300](lib/chore-utils.ts:266), duplicated in [shared-core/chores.ts:142-184](packages/shared-core/src/chores.ts:142)). Because the index is derived from the full occurrence history:

- Adding an exdate (skip a day / pause) shifts **every future** assignee by one — plausibly intended ("nobody loses a turn").
- It also shifts the computed assignee for **past** dates whenever the schedule is edited retroactively, so historical XP, "who was assigned" displays, and allowance `totalWeight` recalculations silently change after a schedule edit.
- Weekly/monthly bucketing counts *distinct buckets containing occurrences*, so a week with all occurrences excluded doesn't advance the rotation — again arguably intended, but none of this is written down or tested against the pause feature.

**Completed:** the schedule-derived invariant is now deliberate: an excluded occurrence does not consume a turn, so a bounded pause resumes with the assignee who would have followed the last actual occurrence. A five-day regression pairs `createChorePausePatch` with the shared assignment engine and proves the sequence `A, B, paused, paused, A`. Uncompleted historical dates remain derived from the current schedule because the application does not materialize assignment rows for untouched occurrences; likewise, an allowance period that has not yet been distributed is intentionally recalculated against the current schedule.

Completed history has a stronger invariant without adding a redundant relation: every completion already stores its durable beneficiary in `completedBy` (while `markedBy` records the actor). Daily XP now includes that beneficiary even if a later exdate or rotation edit makes the occurrence or current derived assignee disappear, and the regression proves the recorded member retains both earned and possible XP. Distributed allowance and finance rows are persisted snapshots and are not rewritten by this calculation path. A separate `assignedTo` snapshot would only add information for unfinished occurrences, which have no completion row to carry it; preserving those would require materializing every scheduled assignment and is intentionally out of scope.

### 1.4 Editing a chore that has no weight can't be saved — **Completed 2026-07-14**

On edit, a null weight hydrates the input as `''` ([DetailedChoreForm.tsx:196](components/DetailedChoreForm.tsx:196)), and `handleSave` rejects `parseFloat('') = NaN` with an alert ([DetailedChoreForm.tsx:493-498](components/DetailedChoreForm.tsx:493)) — so saving *any* edit to a weightless chore demands entering a number. Treat empty as null (weightless) instead. While in there: the form's ~10 validation paths use native `alert()`; the rest of the app uses toasts.

**Completed:** `handleSave` distinguishes blank input from malformed non-empty input and persists blank as `null`. The HTML required marker and button-level `!weight` gate were removed, while numeric values—including zero and negatives—continue through the existing path. The separate form-polish cleanup is also complete: every validation exit uses one accessible inline error panel, native browser alerts are gone, and a corrected retry clears the error and proceeds normally.

### 1.5 Unresolved UTC questions in occurrence helpers — **Completed 2026-07-14**

`getNextOccurrence` / `getOccurrences` ([chore-utils.ts:133-147](lib/chore-utils.ts:133)) pass raw local `Date`s to `rrule.after/between` and carry literal "gemini thinks we need…" comments in place of a decision. Everything on the hot paths now goes through `lib/chore-schedule.ts` (which does this correctly), so audit the remaining callers of these two, migrate them, and delete the helpers.

**Completed:** repository-wide search found no callers, so both wrappers and their unresolved comments were deleted. `createRRuleWithStartDate` remains because allowance distribution and period calculation still call it directly.

---

## 2. Permissions (CEL rules)

### 2.1 `choreCompletions` are wide open to kids — **Completed 2026-07-14**

[instant.perms.ts:819-837](instant.perms.ts:819): `create` and `update` are `isFamilyPrincipal`. A kid principal can therefore, via the API (nothing in the UI offers it, but the rules are the boundary):

- Set `allowanceAwarded: true/false` on any completion — hiding chores from payout or re-arming already-paid ones for double payment.
- Flip `completed` on a sibling's completion, or change `dateDue` to move a completion into a richer allowance period.
- Create completions linked to any member (`familyMembers` link `$default` is `isFamilyPrincipal`), i.e. complete chores *as* someone else without the `markedBy` audit trail parents get.

**Completed:** kid creation requires a non-empty authenticated member identity and `allowanceAwarded == false`. Link rules on `familyMembers.completedChores` and `markedCompletions` allow a kid to target only that authenticated member, covering both the array-style transactions used by `ChoresTracker` and chained completion links. Kid updates require ownership through `data.ref('completedBy.id')` and `request.modifiedFields` permits only `completed`, `notDone`, and `dateCompleted`; `dateDue` and `allowanceAwarded` are therefore immutable to kids after creation. Delete/unlink remain parent-only. Shared kid tokens explicitly carry no usable member identity. The hosted matrix proves own create/toggle, parent payout update, and denials for sibling create/update, payout/date mutation, shared-principal creation, and malformed permission evaluation.

### 2.2 Related rule gaps

- **Routine-marker boundary verified 2026-07-15:** the web list shows controls only when `canEditChores` (parent) and today are both true. Focused countdown and dashboard surfaces only read marker statuses. Mobile's routine-marker screen checks `principalType` before rendering the mutation UI and routes kid sessions through `useParentActionGate`; after elevation it writes as the parent principal. The parent-only rule therefore matches every current mutation path.
- **History-event attribution completed and deployed 2026-07-15:** member-kid creation requires a nonempty authenticated family-member identity and an exact match in the immutable `actorFamilyMemberId` field. The actor link is independently constrained on both relation ends, closing the route where a kid could stamp their own scalar ID but link a sibling as actor. The shared kid principal cannot create history because it has no member identity; parents can still create delegated and system-authored entries. A hosted matrix covers own creation, forged scalar/link denial, shared-principal denial, and parent delegation.

---

## 3. Duplication / architecture

### 3.1 Two implementations of the core assignment/XP logic — **Completed 2026-07-15**

`getAssignedMembersForChoreOnDate`, `getRotationIndex`, occurrence-set construction, exdate parsing, and `calculateDailyXP` all exist twice:

- `lib/chore-utils.ts` (+ `lib/chore-schedule.ts`) — used by ChoresTracker, ChoreList, FamilyMembersList (6 import sites).
- `packages/shared-core/src/chores.ts` — used by the dashboard widgets (`DashboardHeader`, `TodaysChoresWidget`, `TodaysTasksWidget`, `UpcomingChoresWidget`) and the mobile app.

They were *near*-identical (the shared-core copy skipped `normalizeRrule`, dropped assignee `color`, and its `getRotationIndex` took an extra param). Any future tweak — joint-chore XP, negative-weight capping, rrule normalization fixes — could land in one copy and make the dashboard's XP quietly disagree with the sidebar's.

**Completed:** `shared-core` now owns assignment occurrence/rotation selection and daily XP. `lib/chore-utils.ts` retains typed compatibility exports for its existing web imports but delegates directly to those shared functions; its duplicate rotation and XP implementations are gone. Shared assignee types/normalization retain `color`, removing the one web-visible data loss. A contract fixture with an exdate, rotating assignees, a completion, and colors asserts that both entry points return identical assignment and XP results. The richer web-only schedule module remains for pause editing and allowance-range operations, not as an alternate assignment/XP engine.

### 3.2 Dead and debug code — **Completed 2026-07-14**

- **Completed:** removed the empty `if (memberId == 'c72238c8-…') { }` branch with its hardcoded family-member UUID.
- **Completed:** removed `isChoreAssignedForPersonOnDate` and `getChoreAssignmentGrid`; both were unused, self-annotated `TODO`s and queried a `date` field that does not exist on `choreCompletions` (`dateDue`/`dateCompleted` are the live fields).

---

## 4. Data integrity

### 4.1 `deleteChore` leaves orphans and silently breaks task series — **Completed 2026-07-15**

[ChoresTracker.tsx:1160-1175](components/ChoresTracker.tsx:1160) deletes only the chore row (the comment admits the open question). No `onDelete: cascade` exists on `choresCompletions` or the assignments link, so completions and `choreAssignments` rows are orphaned. Worse: any task series linked via `scheduledActivity` loses its schedule — the series silently reverts to draft status and disappears from `/tasks` with no warning.

**Fix:** a confirmation dialog in the same style as `TaskDeleteConfirmDialog` ("this chore has 214 completions and drives the '7th Grade Math' task series"), plus either schema cascades for completions/assignments or explicit cleanup transactions. Blocked deletion (or a prompt to relink) when a task series depends on the chore.

**Completed and deployed:** clicking delete now loads the selected chore alone with its complete `completions`, `assignments`, and reverse `taskSeries` relationships. If a series is present, the dialog cannot delete; it names every dependent series and offers to open the first one for relinking. Otherwise it states the exact child-row impact. Confirm performs the same impact query again immediately before the write, so a series linked while the prompt was open fails closed, and the asynchronous dialog remains open on failure. Both child has-one links carry `onDelete: 'cascade'` in the checked-in and hosted schema. A live smoke test creates one chore plus both child rows, deletes only the chore, and proves all three namespaces are empty.

---

## 5. Performance

### 5.1 Rotation/occurrence math is O(history) per call — **Completed 2026-07-15**

`getRotationIndex` expands **every occurrence since the chore's start date** ([chore-utils.ts:269](lib/chore-utils.ts:269)). A daily rotating chore two years old = ~700 rrule occurrences materialized *per call*. Callers include `getAssignedMembersForChoreOnDate`, which itself runs:

- twice per chore in the countdown input builder ([ChoresTracker.tsx:400-410](components/ChoresTracker.tsx:400) — once in `.filter`, again in `.map`),
- per chore per avatar in `ChoreList`,
- per chore per day in `calculateDailyXP` (dashboard runs 7-day summaries),
- per occurrence in allowance-period calculations.

Likewise `choreOccursOnDate` builds a fresh `RRuleSet` (parse + exdate loop) for every single-day check ([chore-schedule.ts:56-80](lib/chore-schedule.ts:56)).

**Fix:** (a) memoize occurrence sets per `(rrule, startDate, exdates)` — a tiny LRU in `chore-schedule.ts` transparently fixes every caller; (b) for rotation, derive the index arithmetically where possible (daily/interval rules don't need materialization) or cache `(choreId → sorted occurrence keys)` per render; (c) deduplicate the double call in the countdown builder.

**Completed:** bounded LRUs now cache parsed occurrence sets and expanded date ranges by normalized RRULE, UTC start date, normalized exdates, and requested range. Shared-core also caches the final rotation index by that schedule key plus rotation type and occurrence date, so repeated list, XP, dashboard, and allowance calls do not re-walk history. Cache values are content-addressed rather than object-identity based, so fresh Instant result objects reuse them and schedule/exdate edits invalidate naturally. Each cache has a fixed eviction limit. `ChoresTracker` uses one `flatMap` pass and carries its single assignment result into the countdown input. Tests spy on `RRule.parseString` and `RRuleSet.between` to prove identical calls hit the caches.

### 5.2 Countdown engine — **Completed 2026-07-15**

`packages/shared-core/src/chore-countdown-engine.ts` (903 lines) is the most intricate module in the repo. The second-precision `after_chore` anchoring work is now implemented and covered by the focused engine suite (see the implementation log above). The collision/packing rules (`packStartDriven`) still have three interacting special cases (buffer, completion-anchored slots skipping their anchor, after-anchor default delay), so add a broader table-driven scenario file (chore fixtures → expected slot layout) before the next behavioral change.

**Completed:** `shared-core-chore-countdown-scenarios.node.test.ts` supplies five declarative chore-fixture scenarios and compares the complete normalized per-person slot layout. Expectations include effective start/end, unshifted target start/end, resume segments, and unresolved collision pairs. Together the scenarios cover right-to-left deadline packing with buffers, completion-driven forward chaining, pre-countdown `after_chore` timing with second precision, collision split/resume behavior, and joint constraints across two independently packed timelines. The original 37 focused tests remain for branch-level diagnosis; the 5 golden cases guard their cross-rule composition.

---

## 6. Improvement ideas (not defects)

- **Claim button for up-for-grabs:** an explicit "Claim" state (claimed → do it → done) instead of instant completion would kill the race at the UX level too, and lets a parent see who committed to what.
- **Rotation transparency:** show "Next: Judah (Tue), Maya (Wed)" on rotating chores; add a "swap turns" action that writes an explicit override instead of forcing exdate tricks.
- **Expose completion attribution:** `completedBy` now provides the durable XP beneficiary and `markedBy` the actor; surface both when they differ to make "completed for someone else" reporting explicit.
- **Backfill affordance:** parents currently can't fix "we forgot to check it yesterday" without the debug time machine; a parent-only complete-for-date action (already have `markedBy` audit) closes that.
- **Merge the XP heuristics:** `isJoint` exists on chores but XP math ignores it — either split weight among completers or remove the flag from the form until it means something.
- **`estimatedDurationSecs` + weight double as countdown inputs** — the form warns on timeline overflow only when duration is set; surface "this chore has timing but no duration" as a lint in the inventory view.

---

## 7. Fix plan

**Phase 0 — money/fairness correctness:** ~~1.1 deterministic up-for-grabs completion IDs + period dedupe~~ **completed 2026-07-14**; ~~2.1 completion permission tightening~~ **completed and deployed 2026-07-14**; ~~1.2 shared-map bulk completion~~ **completed 2026-07-14**.
**Phase 1 — integrity:** ~~4.1 chore deletion impact dialog + hosted cascades + dependent-series block~~ **completed 2026-07-15**; ~~1.4 weightless-chore save fix~~ **completed 2026-07-14**.
**Phase 2 — consolidation:** ~~3.1 single shared-core assignment/XP implementation + compatibility contract~~ **completed 2026-07-15**; ~~3.2 dead-code removal~~ **completed 2026-07-14**; ~~1.5 delete unused legacy occurrence wrappers~~ **completed 2026-07-14**.
**Phase 3 — performance:** ~~5.1 occurrence-set/range memoization + rotation-index caching; deduplicate countdown builder calls~~ **completed 2026-07-15**.
**Phase 4 — polish:** ~~rotation pause/history semantics~~ **completed 2026-07-15**; ~~countdown golden scenarios (5.2)~~ **completed 2026-07-15**; ~~nonblocking chore-form validation~~ **completed 2026-07-15**; rotation transparency, claim flow, backfill, joint-chore XP decision.
