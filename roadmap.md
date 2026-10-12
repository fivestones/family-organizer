# Family Organizer roadmap

12 October 2026. The ordered list of everything left to build, and where each piece is specified.

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
| [docs/dependency-maintenance.md](docs/dependency-maintenance.md) | Security updates and deployment dependency cleanup ([Scope 0](#scope-0--dependency-maintenance)) |
| [docs/powersync-migration.md](docs/powersync-migration.md) | The move off InstantDB to PowerSync and Postgres: decisions, target design, phases ([Scope 7](#scope-7--the-move-to-powersync)) |

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

0. **Dependency maintenance.** Critical security updates first, at David's request on 12 October 2026; the remaining dependency cleanup follows in the order below.
1. **Done.** The shipped app and the four July 2026 audits.
2. **The countdown redesign.** Current work. Specified in full; nothing blocks it.
3. **The correctness sweep.** The real defects filed in the idea backlog, plus resolving `isJoint`. Small and bounded.
4. **Chore scheduling extras.** End dates, extra days and breaks. The specification exists but predates two quarters of change, so it is audited before it is followed.
5. **Promoted audit ideas.** The three the July audits left open that are worth doing next.
6. **Unscheduled.** Everything else talked through but neither built nor ordered. Items move from here into numbered scopes after David decides where they belong.
7. **The move to PowerSync.** Instant Cloud stops on 31 August 2027. The app is rebuilt on PowerSync and Postgres natively, not adapted to them. Planned in full on 12 October 2026; nothing is built.

**Scope 7 is worked ahead of the unfinished product work in Scopes 4–6**, by David's decision of 11 October 2026 — it has a deadline and they do not. It is numbered last only so that no existing link breaks. Scope 0's remaining items can run alongside it, with one exception noted there.

---

## Scope 0 — Dependency maintenance

[docs/dependency-maintenance.md](docs/dependency-maintenance.md) defines the checks and records the updates. Deprecation warnings and security advisories are tracked separately; the first item takes priority over product work.

- [x] **Resolve critical audit findings.** Patch Next.js, XML parsing (including inherited copies), Vitest/coverage, and the `tar` and `shell-quote` dependency chains. Verify with a fresh audit, typechecks, tests and a production build.
  - Completed 12 October 2026: zero critical findings in the whole-monorepo audit; 1,074 tests, typechecking, the Node 20 Docker build and container/worker smoke checks passed. Versions and the temporary install-helper override are recorded in the specification's implementation log.
- [ ] **Review and resolve the remaining web/server security findings.** Prioritize reachable production code, then build/test tooling; record any remaining advisory with its dependency path and reason.
- [ ] **Exclude mobile tooling from the Docker install.** Install the root web app and required shared workspaces without Expo/React Native; verify the standalone website and calendar worker still build and run.
- [ ] **Remove unused dependencies.** Start with `react-beautiful-dnd`, checking source usage before removal and retaining the existing Pragmatic Drag and Drop behavior.
- [ ] **Modernize the PDF dependency chain.** Remove the obsolete optional `canvas` install chain; keep PDF preview/highlighting and the served worker compatible, and verify a real document in the browser.
- [ ] **Upgrade Expo/React Native together.** Follow the Expo compatibility matrix, rerun mobile typechecks/lint/bundling, and leave device checks explicitly for David.
  - Sequence this against [Scope 7](#scope-7--the-move-to-powersync): do it before that scope's phone work (7.6) or after its cutover, never in the same step as the change of sync library. Its spike (7.0) says whether Expo 54 is enough for PowerSync.
- [ ] **Retire framework deprecations.** Plan the web app's React 19 upgrade and Next's `middleware` → `proxy` migration, checking component-library compatibility and preserving device authorization before implementation. Both warnings appeared in the patched Docker build.

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
- [ ] **(you)** Run a real morning routine on two devices at the same time, and say whether the two timers read correctly from one run record.
- [ ] **(you)** Work four afternoon chores forward from the morning and say whether the queue carries you the way you described it.
- [ ] **(you)** Tune the overrun numbers after a week of real use — the 5 min / 50% / 10 min / 2–3 extensions figures in the specification are starting values.
- [ ] **(you)** Say whether a gated step mid-queue should be skipped and resurfaced, or should block the queue.
- [ ] **(you)** Deploy the new build, then delete the hosted `choreManualStarts`. Once nothing deployed writes to it, run `npx instant-cli@latest push schema < /dev/null` to preview and then with `--yes`, and the same for `push perms`. The schema plan should list the `choreManualStarts` attributes and its two links as deletions and nothing else — but until the two undeclared calendar attributes in [Scope 3](#scope-3--the-correctness-sweep) are settled it will list those as deletions too, so settle them first.

---

## Scope 3 — The correctness sweep

Four of these are filed in [the idea backlog](docs/organized-aspirational-features.md) under "Bugs, Correctness Issues, and Behavior Gaps", which is the wrong place for them — they are defects, not aspirations. The fifth resolves a flag that currently does nothing. Small, bounded, and worth clearing before anything larger starts.

- [x] **Non-monetary up-for-grabs rewards are never deposited.** They appear in the allowance-distribution calculation but no deposit follows, while monetary rewards pay correctly. This is money that is earned and not paid, so it leads the scope.
  - Already fixed when this was written: the July finance audit paid fixed rewards in every earned unit ([§1.4](docs/audit-2026-07-finance-allowance.md)), and a non-monetary unit is paid the same way as a foreign currency. Checked on 11 October 2026 from the calculation through to the ledger write. The one untested link — the page splitting a period into its allowance amount and its other units — is now a single helper with tests, used by both payout buttons.
- [x] **`familyMemberDetail` Total Balance hangs when a unit is undefined.** Create a currency with no exchange rate or type, deposit money in it, and Total Balance never finishes loading. Needs a defined behavior for an undefined unit rather than an unresolved promise.
  - The figure was computed, but "Calculating…" stayed up until a background rate refresh changed the cached rates — which it never does for a currency the rate service has not heard of. The defined behavior now: a balance with no usable rate is left out of the total and shown beside it, the figure appears as soon as cached rates are applied, and a pair is sent for refresh at most once every ten minutes. The calculation is [lib/combined-balance.ts](lib/combined-balance.ts), with tests.
- [x] **Up-for-grabs completion tells the truth to everyone.**
  - A kid who finds the chore disabled is told who claimed it, instead of just being blocked.
  - The completer's own chore list stops striking the title through — for them it is done, not unavailable.
  - The "who did it" message already existed, behind a natively disabled button that swallowed the tap. The avatar now takes the tap and explains, and the row's "Up for Grabs" label becomes "Claimed by …" so nobody has to tap to find out.
- [x] **Allowance-distribution reporting for up-for-grabs** is laid out so the period's fixed rewards and weight-based share read clearly ([audit §6](docs/audit-2026-07-finance-allowance.md)).
  - Each period now reads as a sum: the chore share (weight done, percentage, and how much of it came from up-for-grabs chores), the fixed rewards in every unit, and what the period pays — which follows the amount box as it is edited.
- [~] **Resolve `isJoint`.** The chore form offers it, the schema stores it, and the countdown engine propagates it, but the XP maths ignores it entirely. Either split the weight among completers or remove the control until it means something ([chores audit §6](docs/audit-2026-07-chores.md)).
  - **(you)** Left for David, because either answer changes behavior, and one of them changes money: XP sets the weight-based allowance, so splitting a joint chore's weight would pay each participant less than they are paid today.
  - What the flag does today is more than nothing — a joint chore is labelled "with …" in each person's list, and the planner starts it for everyone at the same time — so removing the control would take those away too.
  - Done meanwhile: the form now says so, including that each person still earns the full XP, so the control no longer implies a sharing it does not do.
  - Recommendation: keep it as it is now. If splitting is wanted, it should apply only to completions made after the change, so no past period is repriced.
- [x] **Empty-envelope deletion** asks only for confirmation instead of asking where to transfer funds that do not exist.
  - An envelope whose balances are all zero is now a plain "are you sure". If it is the default, the one question left is which envelope becomes the default.
- [ ] **(you)** **Decide what the two undeclared calendar attributes are.** The hosted app has `calendarSyncCalendars.ctag` and `calendarSyncCalendars.syncToken` (both optional JSON); [instant.schema.ts](instant.schema.ts) declares neither, and no code reads or writes them — the sync code uses `lastCtag` and `lastSyncToken`. Found on 11 October 2026 while pushing `countdownRuns`. Either declare them or delete them from the hosted app. Until then a plain `instant-cli push schema --yes` would delete them, because a field missing from the file is a deletion — see the note under Commands in [CLAUDE.md](CLAUDE.md).
  - The [PowerSync plan](docs/powersync-migration.md#what-is-added-and-what-is-left-behind) proposes not carrying them over, since nothing reads them. If that stands, the only thing left to decide here is whether to delete them from the hosted app before then.

When each is fixed, remove it from the idea backlog's bug group rather than leaving two records of it. Done for all four; the group is now empty and has been removed.

---

## Scope 4 — Chore scheduling extras

[docs/chore-scheduling-extras-plan.md](docs/chore-scheduling-extras-plan.md) covers chore **end dates**, **extra days**, and **breaks**. All three outcomes are wanted. It was audited and rewritten on 11 October 2026, and the audit changed the picture: end dates already exist, as the end condition of a chore's recurrence; breaks exist one at a time, as a pause with a resume date; only extra days are missing outright. `allowExtraDays` sits in the schema referenced by nothing.

The old plan's file-by-file instructions were written before the schedule engine was rebuilt and are replaced. What is left to build waits on two questions for David, set out at the end of the plan.

- [x] **Audit the plan against the current code** before following any of it. Confirm which of its seven named files still own the behavior it assigns them, whether its scheduling-priority rules still agree with `lib/chore-schedule.ts` and `packages/shared-core/src/chores.ts`, and how end dates, extra days and breaks must interact with the occurrence and rotation caches. Correct the document in place and note the date of the audit at its top.
  - Done. The plan is rewritten from the code. The scheduling logic is no longer in `lib/chore-utils.ts`: there are two occurrence engines, each with its own caches, and several callers — task series among them — hand the engine a cut-down schedule that would silently ignore a new field.
- [x] **End dates** — inclusive; the chore stops appearing after the date.
  - Already shipped, in a different shape from the old plan: Repeat → *End on date* in the chore form, and *End chore* in its schedule actions, both write the recurrence's end condition. No `endDate` field is needed or wanted. Inclusive in both engines, now [pinned by tests](test/unit/lib/chore-end-date.node.test.ts).
- [ ] **(you)** **Answer the plan's two questions** ([Questions for David](docs/chore-scheduling-extras-plan.md#questions-for-david)): whether a pause with a resume date should become a break, and whether an extra day takes a turn in a daily rotation. Both decide what is written to the schema, so they come before the build.
- [ ] **Extra days** — one-off additional days beyond the recurrence.
- [ ] **Breaks** — single days or ranges where the chore is paused; these override everything, extra days included.
- [ ] **Remove the dead `allowExtraDays` schema field** once extra days have a real representation.
- [ ] This closes **Chore end dates, pauses, restarts, and schedule changes** and **One-off and exception-day chore changes** in the idea backlog.

---

## Scope 5 — Promoted audit ideas

Left open by the July audits as product decisions; chosen on 11 October 2026 as the three worth doing next.

- [x] **Nav grouping** ([audit part 8](docs/audit-2026-07-task-series-login-nav.md)). Twelve top-level links collapse into an unlabeled overflow menu on a tablet in portrait. Group them — Chores/Tasks · Calendar · Money · Admin — so the common four stay visible. This is a wall-tablet app, so it costs something every day.
  - Fourteen links are now six entries: Dashboard · Chores ▾ · Calendar · Money ▾ · Messages · Admin ▾. A group's label is still a link to its everyday page (Chores, Finance), so nothing common costs a second tap; the chevron holds the rest. Whatever does not fit goes into a menu that keeps the group headings. Routines, which had no link at all, is under Chores.
  - **(you)** Not seen in a browser. Say whether Dashboard and Messages belong at the top level, and whether the order is right.
- [~] **Parent review inbox with a nav badge** ([audit part 8](docs/audit-2026-07-task-series-login-nav.md)). Every `needs_review` item across all series on one screen, with one-tap approve and grade. `TaskBinsReview` is close but is series-centric rather than "what needs me now"-centric; a badge count on the Task Series nav entry closes the loop.
  - Done: `/task-series/review` has a **To Review** view — every `needs_review` task across all series, longest-waiting first — with a one-tap Approve on each card and one-tap grades from the default grade type (letter steps or stars). `?view=review` opens it directly.
  - **Left: the nav badge.** `countTasksNeedingReview` in [lib/task-bins.ts](lib/task-bins.ts) is written and tested for it; it still needs a parent-only query and a badge on the Chores group in [MainNav.tsx](components/MainNav.tsx) linking to `/task-series/review?view=review`. Not seen in a browser.
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

[docs/organized-aspirational-features.md](docs/organized-aspirational-features.md), 59 open items in eight groups. Counts as of 11 October 2026:

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

The ninth group, "Bugs, correctness issues, and behavior gaps", is gone: its three entries were the defects in [Scope 3](#scope-3--the-correctness-sweep), and each was removed as it was fixed.

### 6.3 Checks for you, carried from the audits

- [ ] **(you)** iPad PWA keyboard and backgrounding verification, left open by the app-shell fix ([audit item 7](docs/audit-2026-07-task-series-login-nav.md)).
- [ ] **(you)** Rotate or revoke the external exchange-rate credential and set the server secret — an operator action, not a code change ([finance audit §4](docs/audit-2026-07-finance-allowance.md)).

---

## Scope 7 — The move to PowerSync

[docs/powersync-migration.md](docs/powersync-migration.md) is the specification. Instant's team has joined OpenAI and Instant Cloud stops on **31 August 2027**. The app moves to self-hosted PowerSync in front of Postgres: Postgres is the database, each device keeps a local SQLite copy, and PowerSync syncs between them.

**The finished app is built for PowerSync, not adapted to it** (David, 12 October 2026): a relational schema designed as one, reads and writes in SQL, the server on database transactions, and nothing left in an Instant shape because it used to be Instant's ([the finished app](docs/powersync-migration.md#the-finished-app)). There is no compatibility layer.

It gets there in two moves on `main`, so the app stays shippable ([how](docs/powersync-migration.md#how-the-app-gets-there)). First every screen moves to a shared data layer of typed reads and mutations, implemented over Instant (7.1). Then the same data layer is implemented natively on PowerSync behind a `DATA_BACKEND` flag (7.6), and the Instant implementation is deleted (7.8).

**If the rehearsal in 7.7 has not passed by 31 May 2027, self-host Instant first** — a configuration change — so the deadline cannot be missed ([why](docs/powersync-migration.md#why-and-by-when)).

**While this scope is open**, other work follows the rules [set out in the specification](docs/powersync-migration.md#working-on-main-while-this-is-in-flight). In short: once an area is converted in 7.1, its screens reach data only through its hooks and mutations; once it has a PowerSync implementation in 7.6, a change is made in both; and nothing new imports `@instantdb/*` outside the data layer.

7.0 and 7.1 can start at once. 7.2 to 7.5 do not wait on one another; 7.6 needs all of them. Everything from 7.2 on is provisional until the spike's findings are written into the specification.

### 7.0 The spike

A throwaway branch; its output is findings in the specification's log ([Phase 0](docs/powersync-migration.md#phase-0--the-spike)).

- [x] **Web**: PowerSync's web SDK in this app under Turbopack, in development and in the Docker build, with the service worker caching its files. Run it under Playwright in Chromium, Firefox and WebKit, in ordinary and private windows, with two tabs open.
  - Done on 12 October 2026 in a minimal Next 16.4 app with this app's build settings, not in the app itself, and with the standalone production build run directly rather than inside Docker. Every storage mode works in all three engines. Two findings for Safari: its private file system is unusable in a throwaway profile, so the fallback is needed; and its first sync over HTTP streaming took twenty seconds, so the web client connects by WebSocket ([log](docs/powersync-migration.md#implementation-log)).
- [ ] **(you)** Open the spike on an iPad and an iPhone — in a Safari tab, as a home-screen app, and in Orion — and in Firefox wherever the family uses it. Does it load, work offline, and survive being closed and reopened? Leave one untouched for eight days and say whether its data is still there ([why the browser matters](docs/powersync-migration.md#browsers-and-devices)).
  - Waiting on a way to reach the spike from those devices over HTTPS — a browser only allows the storage and the service worker this needs on a secure address, so the Mac's plain LAN address will not do. `spike/README.md` on the `spike/powersync` branch says what to point the reverse proxy at.
- [ ] **Phone**: the React Native SDK on Expo 54. **(you)** Install the build.
- [x] **Service**: self-hosted, Postgres storage, `edition: 3` and the timestamp text a device receives, a token signed with our own key, the three streams, a join table.
  - All as planned, on service 1.26.1 and Postgres 17. Timestamps need `timestamp_max_precision: milliseconds` to match what the app writes.
- [x] **Latency**: measure one device to another, and the replay of writes queued offline.
  - On one machine, so without a network: 1–3 ms locally; 870 ms to another device with the SDK's default upload throttle and 43 ms with it lowered; about 30 ms from a change made in Postgres. **(you)** The same over the real network is still to be felt on real devices.
- [ ] **The query layer**: the chore-day read and the complete-a-chore write over an export of the real data, in Kysely, Drizzle and plain SQL, timed on a phone and in a browser. Choose one.
- [x] **Switching principal** on a shared device, and **a refused write** end to end.
  - A refused write reverts on the device in under a tenth of a second. Switching principal works without clearing the device, but only once the device has caught up: one that switched the moment its upload queue emptied stopped applying downloads until its next upload. The rule is now in [the specification](docs/powersync-migration.md#which-principal-a-queued-write-belongs-to).
- [ ] **Test tooling**: choose the in-memory SQLite and in-process Postgres.
- [~] Write the findings into the specification and revise the later phases.
  - Done for everything above. Left: the phone, the query layer and the test tooling, and every check marked **(you)**.

### 7.1 The data layer, over Instant

On `main`, Instant still the only backend ([Phase 1](docs/powersync-migration.md#phase-1--the-data-layer-over-instant)). For each area: design its types, reads and mutations for the relational end state; implement them over Instant; move every web and phone screen to them; rewrite its tests. Each ends with **(you)** a look over that area's screens on the live app.

- [ ] Family and settings — first, because it is small and sets the pattern.
- [ ] Chores, routines and the countdown.
- [ ] Task series.
- [ ] Calendar.
- [ ] Finance.
- [ ] Messaging, including presence behind `useThreadPresence`.
- [ ] History.
- [ ] Content.
- [ ] Dashboards — last, because they mostly consume other areas' reads.
- [ ] The session module, replacing `db.useAuth()` in components.
- [ ] A lint rule forbidding `@instantdb/*` outside the data layer. Done when no screen imports Instant or builds a query.

### 7.2 The schema and the data

[Phase 2](docs/powersync-migration.md#phase-2--the-schema-and-the-data).

- [ ] The export script and its census, run read-only against the live app.
- [ ] The schema as SQL migrations, following [the design rules](docs/powersync-migration.md#design-rules), with the mapping from every Instant attribute and link to its column.
- [ ] Postgres and PowerSync in `docker-compose.yml`, with the setup script for keys, roles and the publication.
- [ ] The client schema and its indexes.
- [ ] The import script, with row and money verification. Done when a fresh import of the live data verifies clean.
- [ ] **(you)** A public hostname for the PowerSync service through the reverse proxy, with response buffering off.

### 7.3 Identity

[Phase 3](docs/powersync-migration.md#phase-3--identity).

- [ ] The app's own sessions, routes under `/api/auth/`, the PowerSync token route, and request authentication against sessions.
- [ ] The session module's PowerSync-era implementation on the web and the phone.
- [ ] `has_pin` in place of a synced PIN hash, and a server route that sets a PIN.

### 7.4 Sync and the write rules

[Phase 4](docs/powersync-migration.md#phase-4--sync-and-the-write-rules).

- [ ] The sync configuration: `family`, `messaging_member`, `messaging_parent`.
- [ ] `/api/sync/upload` and the shared write policy.
- [ ] The two permission contract suites and the live matrix, ported case by case. Done when all pass.
- [ ] The connector, keeping the previous session for sync until its queued writes have uploaded.
- [ ] The refusal toast and the server's record of refused writes.

### 7.5 The server on Postgres

[Phase 5](docs/powersync-migration.md#phase-5--the-server-on-postgres). Each service is rewritten against Postgres beside its Instant version, keeping its function signatures.

- [ ] Finance as locked database transactions.
- [ ] Messaging on unique constraints; calendar sync on advisory locks.
- [ ] Members and PINs, shortcuts, the content queue, exchange rates, the server actions.
- [ ] The report scripts rewritten; the backfill scripts removed.

### 7.6 The data layer, on PowerSync

[Phase 6](docs/powersync-migration.md#phase-6--the-data-layer-on-powersync). For each area: its reads and mutations in SQL behind the same interface, and its parity cases — the Instant implementation over the live data against the PowerSync one over the imported copy. Each ends with **(you)** a look over that area's screens on staging.

- [ ] Family and settings.
- [ ] Chores, routines and the countdown.
- [ ] Task series.
- [ ] Calendar.
- [ ] Finance.
- [ ] Messaging, with the presence server module.
- [ ] History.
- [ ] Content.
- [ ] Dashboards.
- [ ] Web: the provider, worker files, service-worker caching, the sync-status badge.
- [ ] Browsers: storage chosen per browser with its fallbacks, the storage-persistence request, a plain screen for a browser that cannot run the app, and Firefox and WebKit added to Playwright. The app must keep working for anyone it works for today.
- [ ] Phone: op-sqlite, a `backend` field in `/api/mobile/config`, and a build that carries both backends.

### 7.7 Rehearsal and cutover

[Phase 7](docs/powersync-migration.md#phase-7--rehearsal-and-cutover).

- [ ] A staging deployment on an imported copy of the live data; a timed export, import and verification.
- [ ] A restore of the nightly Postgres dump into an empty database.
- [ ] **(you)** Use staging on the family's real devices for a few days — chores, a countdown run, a message thread, an allowance payout, offline and back.
- [ ] **(you)** Install the phone build that carries both backends on every phone.
- [ ] **(you)** Cutover day, following [the runbook](docs/powersync-migration.md#phase-7--rehearsal-and-cutover): every device online and synced, Instant set read-only, export, import, verify, deploy, smoke-test each device before the family uses it.
- [ ] **(you)** Download a final Instant backup and leave the Instant app read-only until the deadline.

### 7.8 Cleanup

[Phase 8](docs/powersync-migration.md#phase-8--cleanup).

- [ ] Delete every Instant implementation in the data layer and on the server, the Instant packages, schema and permission files, the flag and the `instant-auth-*` routes.
- [ ] Rewrite [CLAUDE.md](CLAUDE.md) and `AGENTS.md`, which currently tell every agent to build on InstantDB.
- [ ] Rewrite the README's setup, add the upgrade guide for other people running the app, and note the PowerSync licence.
- [ ] Update the reference documents in `docs/`.
- [ ] Close what this makes moot: the hosted `choreManualStarts` deletion in [2.6](#26-checks-for-you) and the undeclared calendar attributes in [Scope 3](#scope-3--the-correctness-sweep).
- [ ] Ship the phone build without Instant. Done when a search of the repository for `instant` finds only history.

---

## Decided against

Recorded so these are not reopened by accident.

- **Auto-completing a chore when its timer reaches zero.** It writes a real completion with `allowanceAwarded: false` — the shape allowance distribution pays out on — so a chore nobody did would earn XP and real money on a timer ([countdown decision 8](docs/countdown-redesign.md#decisions)).
- **Splitting a chore around another chore.** The collision split/resume machinery goes; an overlap becomes a forecast instead ([countdown spec](docs/countdown-redesign.md#removed)).
- **Scaled-integer money, for this deployment.** Four existing ledger rows store sub-cent amounts, and coercing them would silently rewrite a real event. A future version must dual-write, backfill with an approved per-unit rounding policy, and verify ledger parity before switching reads ([finance audit §5](docs/audit-2026-07-finance-allowance.md)).
- **Destructive history or message rollups.** History is the immutable family audit trail and removed messages stay soft-deleted; growth is bounded at read boundaries instead ([remaining-areas audit §5–6](docs/audit-2026-07-remaining-areas.md)).
- **Materializing every historical chore assignment.** An undistributed allowance period is recalculated against the current schedule; a completion keeps its durable `completedBy`; a distributed period is immutable ledger ([chores audit §1.3](docs/audit-2026-07-chores.md)).
- **A compatibility layer, or another sync engine, for the move off Instant.** A layer imitating Instant's API on PowerSync would have left the app permanently shaped by a database it no longer uses; David ruled it out on 12 October 2026. Zero has no offline writes, Convex no offline sync, Electric leaves the write path to be assembled, and Pylon is one person's project, months old ([alternatives considered](docs/powersync-migration.md#alternatives-considered)).
- **Horizontal replicas of the Next app**, until distributed concurrency control exists. Money serialization currently assumes one instance ([finance audit §1.1](docs/audit-2026-07-finance-allowance.md)).
