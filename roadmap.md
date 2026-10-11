# Family Organizer roadmap

11 October 2026. The ordered list of everything left to build, and where each piece is specified.

This file says **what to do next and how far along it is**. It does not define behavior. Each item links to the document that says when it is done.

**Where things are written down**

| Document | What it holds |
| --- | --- |
| [docs/countdown-redesign.md](docs/countdown-redesign.md) | The countdown runner specification — the current work ([Scope 2](#scope-2--the-countdown-redesign)) |
| [docs/app-system-reference.md](docs/app-system-reference.md), [docs/chores-task-series.md](docs/chores-task-series.md), [docs/calendar-system.md](docs/calendar-system.md), [docs/allowance-finance-system.md](docs/allowance-finance-system.md), [docs/additional-app-areas-reference.md](docs/additional-app-areas-reference.md) | What the app does today |
| [docs/chore-scheduling-extras-plan.md](docs/chore-scheduling-extras-plan.md) | Chore end dates, extra days and breaks ([Scope 4](#scope-4--chore-scheduling-extras)) |
| [docs/organized-aspirational-features.md](docs/organized-aspirational-features.md) | The unordered idea backlog. Items graduate from there into a numbered scope here once they have a specification |
| [docs/audit-2026-07-*.md](docs/) | What the July 2026 audits found, fixed, and deliberately left alone. Their implementation logs are the record of what was built |
| [CLAUDE.md](CLAUDE.md) | Architecture, commands, and conventions |

**How to use it**

1. Take the first unchecked item in the earliest unfinished scope, unless David asks for something else. Within a group, items are roughly in dependency order.
2. Claim it in [docs/CURRENT.md](docs/CURRENT.md).
3. Read the specification sections it links to.
4. Build it with its tests.
5. Check it off here, and record what was built in the specification's implementation log, in the prose style the audits use.
6. If the work shows the specification to be wrong or incomplete, correct it in the same change. Ask David first when the correction changes behavior.

Items marked **(you)** need David's own devices, two people, or real-world timing. Don't attempt them — note that they are waiting and carry on.

Status marks: `[ ]` not started · `[~]` partly done, with a note saying what is left · `[x]` done.

## Scopes

1. **Done.** The shipped app and the four July 2026 audits.
2. **The countdown redesign.** Current work. Specified in full; nothing blocks it.
3. **The correctness sweep.** The real defects filed in the idea backlog, plus resolving `isJoint`. Small and bounded.
4. **Chore scheduling extras.** End dates, extra days and breaks. The specification exists but predates two quarters of change, so it is audited before it is followed.
5. **Promoted audit ideas.** The three the July audits left open that are worth doing next.
6. **Unscheduled.** Everything else talked through but neither built nor ordered. Items move from here into numbered scopes after David decides where they belong.

---

## Scope 1 — Done

The shipped surface is recorded in the reference documents above. In outline: the chore dashboard and inventory, task series with the rolling-queue scheduler and rich-text editor, the Gregorian/Nepali calendar with Apple CalDAV sync, envelope finance and allowance distribution, messaging, history, the file manager, the PIN/principal auth model, and the Expo iPhone app.

**The July 2026 audits are closed.** All four — [task series/login/nav](docs/audit-2026-07-task-series-login-nav.md), [chores](docs/audit-2026-07-chores.md), [finance/allowance](docs/audit-2026-07-finance-allowance.md), [remaining areas](docs/audit-2026-07-remaining-areas.md) — reconciled on 16 July 2026 with 130 test files / 839 tests, `tsc --noEmit`, a clean Expo lint, the hosted Instant permission matrix, and a production build passing. Each audit's "Improvement ideas (not defects)" section was deliberately left open; those ideas are carried in [Scope 5](#scope-5--promoted-audit-ideas) and [Scope 6](#scope-6--unscheduled).

---

## Scope 2 — The countdown redesign

[docs/countdown-redesign.md](docs/countdown-redesign.md) is the specification. It replaces the current planner — which schedules chores as late as possible and treats working ahead as an override — with a runner: start, a step gets a timer, finish it, the next begins, stop when you like. Nine decisions are settled; the three remaining questions are deliberately deferred to real use and block nothing.

The current `/countdown` page keeps working off the planner while the runner lands underneath it, so no phase leaves the app broken.

### 2.1 Schema and engine split

- [x] **The run record.** Add `countdownRuns` to [instant.schema.ts](instant.schema.ts) and member-scoped rules to [instant.perms.ts](instant.perms.ts), following the pattern the July audit applied to `choreCompletions` ([spec](docs/countdown-redesign.md#the-run-record)).
  - One row per member per family day: the live step, `stepStartedAt`, extension state, `lastInteractionAt`, `stoppedReason`.
  - A kid may write only their own run.
  - Push both with `instant-cli`.
- [x] **Split the engine into runner and planner** ([spec](docs/countdown-redesign.md#two-clocks)). The runner clock drives the ring from `stepStartedAt + durationSecs`; the planner keeps right-to-left deadline packing but only answers "am I ahead, and will I still make my hard deadlines".
  - The 42 existing engine tests ([engine](test/unit/packages/shared-core-chore-countdown-engine.node.test.ts), [golden scenarios](test/unit/packages/shared-core-chore-countdown-scenarios.node.test.ts)) cover the planner; keep them passing and add a runner suite beside them.
  - Done: [the runner](packages/shared-core/src/chore-countdown-runner.ts) and [its 63 tests](test/unit/packages/shared-core-chore-countdown-runner.node.test.ts).
- [x] **Honour the earliest-allowed gate** ([spec](docs/countdown-redesign.md#the-earliest-allowed-gate)). Every timing mode already resolves a floor; the runner must consult it. Today `handleStartNow` performs no check at all.
  - The runner honours it. `handleStartNow` itself goes when [2.2](#22-the-runner-ui) rebuilds the page on the run record.
- [x] **Untimed steps** ([decision 4](docs/countdown-redesign.md#decisions)). A step with no duration shows no ring and advances on tap. This also ends the silent dropping of chores that have timing but neither duration nor weight.
- [x] **Route countdown completions through the canonical path.** Both countdown completion paths bypass `toggleChoreDone`, so they write no history event, no `markedBy` link, and skip the up-for-grabs claim guard — chores finished on the countdown are invisible in `/history`.

### 2.2 The runner UI

- [x] **Rebuild `/countdown` around the run record** ([FocusedCountdownPage.tsx](components/countdown/FocusedCountdownPage.tsx)): start, advance, stop, untimed steps. Keep [RadialTimer](components/countdown/RadialTimer.tsx).
- [x] **The page owns its own background.** Every string is `text-white` but the page renders in the light app shell; its only dark backdrop is a `fixed inset-0 -z-10` gradient painted from inside `RadialTimer`, so loading, error, "No Countdown Chores" and "All Done!" are white on white.
- [x] **Ahead/behind and the deadline forecast**, replacing the single-slot delta that is currently labelled as a stack total.
- [x] **The "+5 min" control** on the running step ([spec](docs/countdown-redesign.md#step-overrun-and-abandonment)).
- [x] **Overrun and abandonment**: count up and wait, then the "Still working on this?" ladder, then auto-stop with `stoppedReason`. Idleness belongs to the run, not the device.
- [x] **Several people at once.** One run row per member, so a shared tablet can show more than one.

### 2.3 Routines

- [x] **`routines` and `routineSteps`** ([spec](docs/countdown-redesign.md#routines)), the join carrying step position, mirroring the existing `choreAssignments` ordering pattern.
- [x] **Both creation paths**: point a routine at existing chores, or type new steps and have the chores created. Routine order supersedes `after_chore` chaining.
- [x] **`onStepOverrun`** per routine: `wait` or `advance`.
- [x] **Day-list visibility** ([spec](docs/countdown-redesign.md#day-list-visibility)). Membership gates, the optional chore flag modifies, defaulted by creation path. The day list shows one collapsed routine row with its own XP contribution.
- [x] This closes **Routine manager** in the aspirational backlog ([§ Integrations](docs/organized-aspirational-features.md)).

### 2.4 Cleanup

- [~] **Delete `choreManualStarts`** — entity, permissions and both call sites. It is keyed by `choreId` alone so one kid's start shifts everyone's timeline, is never upserted, and is writable by any family principal.
  - Done in the code, [instant.schema.ts](instant.schema.ts) and [instant.perms.ts](instant.perms.ts).
  - **Left: the hosted entity and its rule**, which is the last check in [2.6](#26-checks-for-you). It waits for a deploy because the build running today still writes a manual start when someone presses Start Now.
- [x] **Delete the collision machinery** — `CollisionDecisionDialog`, `detectCollisions`, `applyCollisionDecisions` and the split/resume `isResume` handling. An overlap becomes a forecast line.
- [x] **Delete the `buffer` slot state.** Declared, styled and filtered for in five places; never emitted by the engine.
- [x] **Stop showing countdown pills on non-today dates.**
- [x] **Fix the chore form's pre-save lint.** It builds `between_times` as flat `{startTime, endTime}` while the save path and resolver both use `window: {…}`, so the chore being edited is excluded from its own overflow warning.
- [x] **Retire `autoMarkCompleteOnCountdownEnd`** ([decision 8](docs/countdown-redesign.md#decisions)) and remove it from [CountdownSettings](components/CountdownSettings.tsx).

### 2.5 Mobile

- [x] **A countdown screen in the Expo app.** The engine lives in `shared-core` precisely so mobile can use it; today mobile has no countdown at all.

### 2.6 Checks for you

Everything above this line in Scope 2 is built. None of it has been run in a browser or on a device — the tests, the typecheck, the production build and the iOS bundle are what stand behind it — so the first check is simply to use it.

- [ ] **(you)** Open `/countdown`, `/routines` and the phone's countdown and look at them. Say what reads wrong, looks wrong or feels wrong.
- [ ] **(you)** Run a real morning routine on the wall tablet and a phone at the same time, and say whether the two timers read correctly from one run record.
- [ ] **(you)** Work four afternoon chores forward from the morning and say whether the queue carries you the way you described it.
- [ ] **(you)** Tune the overrun numbers after a week of real use — the 5 min / 50% / 10 min / 2–3 extensions figures in the specification are starting values.
- [ ] **(you)** Say whether a gated step mid-queue should be skipped and resurfaced, or should block the queue.
- [ ] **(you)** Deploy the new build, then delete the hosted `choreManualStarts`. Once nothing deployed writes to it, run `npx instant-cli@latest push schema < /dev/null` to preview and then with `--yes`, and the same for `push perms`. The schema plan should list the `choreManualStarts` attributes and its two links as deletions and nothing else — but until the two undeclared calendar attributes in [Scope 3](#scope-3--the-correctness-sweep) are settled it will list those as deletions too, so settle them first.

---

## Scope 3 — The correctness sweep

Four of these are filed in [the idea backlog](docs/organized-aspirational-features.md) under "Bugs, Correctness Issues, and Behavior Gaps", which is the wrong place for them — they are defects, not aspirations. The fifth resolves a flag that currently does nothing. Small, bounded, and worth clearing before anything larger starts.

- [x] **Non-monetary up-for-grabs rewards are never deposited.** They appear in the allowance-distribution calculation but no deposit follows, while monetary rewards pay correctly. This is money that is earned and not paid, so it leads the scope.
  - Already fixed when this was written: the July finance audit paid fixed rewards in every earned unit ([§1.4](docs/audit-2026-07-finance-allowance.md)), and a non-monetary unit is paid the same way as a foreign currency. Checked on 11 October 2026 from the calculation through to the ledger write. The one untested link — the page splitting a period into its allowance amount and its other units — is now a single helper with tests, used by both payout buttons.
- [ ] **`familyMemberDetail` Total Balance hangs when a unit is undefined.** Create a currency with no exchange rate or type, deposit money in it, and Total Balance never finishes loading. Needs a defined behavior for an undefined unit rather than an unresolved promise.
- [ ] **Up-for-grabs completion tells the truth to everyone.**
  - A kid who finds the chore disabled is told who claimed it, instead of just being blocked.
  - The completer's own chore list stops striking the title through — for them it is done, not unavailable.
- [ ] **Allowance-distribution reporting for up-for-grabs** is laid out so the period's fixed rewards and weight-based share read clearly ([audit §6](docs/audit-2026-07-finance-allowance.md)).
- [ ] **Resolve `isJoint`.** The chore form offers it, the schema stores it, and the countdown engine propagates it, but the XP maths ignores it entirely. Either split the weight among completers or remove the control until it means something ([chores audit §6](docs/audit-2026-07-chores.md)).
- [ ] **Empty-envelope deletion** asks only for confirmation instead of asking where to transfer funds that do not exist.
- [ ] **(you)** **Decide what the two undeclared calendar attributes are.** The hosted app has `calendarSyncCalendars.ctag` and `calendarSyncCalendars.syncToken` (both optional JSON); [instant.schema.ts](instant.schema.ts) declares neither, and no code reads or writes them — the sync code uses `lastCtag` and `lastSyncToken`. Found on 11 October 2026 while pushing `countdownRuns`. Either declare them or delete them from the hosted app. Until then a plain `instant-cli push schema --yes` would delete them, because a field missing from the file is a deletion — see the note under Commands in [CLAUDE.md](CLAUDE.md).

When each is fixed, remove it from the idea backlog's bug group rather than leaving two records of it.

---

## Scope 4 — Chore scheduling extras

[docs/chore-scheduling-extras-plan.md](docs/chore-scheduling-extras-plan.md) specifies chore **end dates**, **extra days**, and **breaks**. All three outcomes are wanted. None of it shipped: `chores` has no `endDate`, `extraDays` or `breaks` field, and `allowExtraDays` sits in the schema referenced by nothing outside it. Only pause/resume exists, through `pauseState` and `exdates`.

The specification was written before two quarters of change — including the July audits, the move of assignment and rotation into `shared-core`, and the occurrence/rotation caches — so its file-by-file instructions cannot be trusted as written.

- [ ] **Audit the plan against the current code** before following any of it. Confirm which of its seven named files still own the behavior it assigns them, whether its scheduling-priority rules still agree with `lib/chore-schedule.ts` and `packages/shared-core/src/chores.ts`, and how end dates, extra days and breaks must interact with the occurrence and rotation caches. Correct the document in place and note the date of the audit at its top.
- [ ] **End dates** — inclusive; the chore stops appearing after the date.
- [ ] **Extra days** — one-off additional days beyond the recurrence.
- [ ] **Breaks** — single days or ranges where the chore is paused; these override everything, extra days included.
- [ ] **Remove the dead `allowExtraDays` schema field** once extra days have a real representation.
- [ ] This closes **Chore end dates, pauses, restarts, and schedule changes** and **One-off and exception-day chore changes** in the idea backlog.

---

## Scope 5 — Promoted audit ideas

Left open by the July audits as product decisions; chosen on 11 October 2026 as the three worth doing next.

- [ ] **Nav grouping** ([audit part 8](docs/audit-2026-07-task-series-login-nav.md)). Twelve top-level links collapse into an unlabeled overflow menu on a tablet in portrait. Group them — Chores/Tasks · Calendar · Money · Admin — so the common four stay visible. This is a wall-tablet app, so it costs something every day.
- [ ] **Parent review inbox with a nav badge** ([audit part 8](docs/audit-2026-07-task-series-login-nav.md)). Every `needs_review` item across all series on one screen, with one-tap approve and grade. `TaskBinsReview` is close but is series-centric rather than "what needs me now"-centric; a badge count on the Task Series nav entry closes the loop.
- [ ] **A Claim state for up-for-grabs chores** ([chores audit §6](docs/audit-2026-07-chores.md)). Claimed → doing → done, instead of instant completion. It removes the race at the UX level rather than only at the data level, where deterministic completion IDs already converge concurrent claims, and it lets a parent see who committed to what. Build it after [Scope 3](#scope-3--the-correctness-sweep)'s up-for-grabs work so the two do not fight over the same screens.

---

## Scope 6 — Unscheduled

Everything below has been talked through but is neither built nor ordered. **Nothing here is scheduled**; items move up into numbered scopes once David decides where they belong. Recorded so none of it is lost.

### 6.1 Deliberately-open audit ideas

Classified in July 2026 as product decisions rather than defects. The three promoted on 11 October are in [Scope 5](#scope-5--promoted-audit-ideas).

- **Chores** ([audit §6](docs/audit-2026-07-chores.md)): rotation transparency — show "Next: Judah (Tue), Maya (Wed)" on rotating chores and add a swap-turns action that writes an explicit override instead of forcing exdate tricks; surfacing `completedBy` vs `markedBy` when they differ.
- **Task series** ([audit part 8](docs/audit-2026-07-task-series-login-nav.md)): a kid-facing Today mode for `/tasks`; a work-ahead affordance on the empty state; series templates; paste-with-day-markers import; deferred-task visibility, so a task with a future `deferredUntilDate` shows greyed as "returns Mon" instead of vanishing; unifying the five structurally-similar `Task` types into one `shared-core` base.
- **Accessibility**: re-enable pinch zoom now the app shell is fixed.
- **Task dependencies**: a dependency-editing UI remains an explicit product decision; only the cycle crash was fixed.
- **Maintainability, named but not scheduled**: `Calendar.tsx` (~4,600 lines) to be split per view the next time it is touched; `MemberAllowanceDetail.tsx` (1,192 lines) consolidation; the allowance-distribution calculation extraction.

### 6.2 The idea backlog

[docs/organized-aspirational-features.md](docs/organized-aspirational-features.md), 62 open items in ten groups. Counts as of 11 October 2026:

| Group | Open | Notes |
| --- | --- | --- |
| Dashboards, daily views, and wall displays | 6 | |
| Goals, progress, and motivation | 3 | |
| Chores, scheduling, and chore views | 10 | Two close with [Scope 4](#scope-4--chore-scheduling-extras) |
| Task series, to-dos, and homeschool workflows | 8 | |
| Calendar, events, views, and planning | 10 | |
| Finance, allowance, and money tools | 8 | |
| Search, communication, and family life | 10 | |
| Integrations, platforms, and extensibility | 4 | Routine manager closed with [Scope 2.3](#23-routines) |
| Bugs, correctness issues, and behavior gaps | 3 | All promoted to [Scope 3](#scope-3--the-correctness-sweep) |

### 6.3 Checks for you, carried from the audits

- [ ] **(you)** iPad PWA keyboard and backgrounding verification, left open by the app-shell fix ([audit item 7](docs/audit-2026-07-task-series-login-nav.md)).
- [ ] **(you)** Rotate or revoke the external exchange-rate credential and set the server secret — an operator action, not a code change ([finance audit §4](docs/audit-2026-07-finance-allowance.md)).

---

## Decided against

Recorded so these are not reopened by accident.

- **Auto-completing a chore when its timer reaches zero.** It writes a real completion with `allowanceAwarded: false` — the shape allowance distribution pays out on — so a chore nobody did would earn XP and real money on a timer ([countdown decision 8](docs/countdown-redesign.md#decisions)).
- **Splitting a chore around another chore.** The collision split/resume machinery goes; an overlap becomes a forecast instead ([countdown spec](docs/countdown-redesign.md#removed)).
- **Scaled-integer money, for this deployment.** Four existing ledger rows store sub-cent amounts, and coercing them would silently rewrite a real event. A future version must dual-write, backfill with an approved per-unit rounding policy, and verify ledger parity before switching reads ([finance audit §5](docs/audit-2026-07-finance-allowance.md)).
- **Destructive history or message rollups.** History is the immutable family audit trail and removed messages stay soft-deleted; growth is bounded at read boundaries instead ([remaining-areas audit §5–6](docs/audit-2026-07-remaining-areas.md)).
- **Materializing every historical chore assignment.** An undistributed allowance period is recalculated against the current schedule; a completion keeps its durable `completedBy`; a distributed period is immutable ledger ([chores audit §1.3](docs/audit-2026-07-chores.md)).
- **Horizontal replicas of the Next app**, until distributed concurrency control exists. Money serialization currently assumes one instance ([finance audit §1.1](docs/audit-2026-07-finance-allowance.md)).
