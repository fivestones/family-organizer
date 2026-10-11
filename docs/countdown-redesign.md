# Countdown Redesign

**Date:** 2026-08-02
**Status:** Agreed design, being implemented. Phases 1 to 4 are built; see the implementation log.
**Supersedes:** the countdown behaviour described in `audit-2026-07-chores.md` §5.2.

---

## Implementation log

- **2026-10-11 — Completed: the old machinery is removed (phase 4). One hosted deletion is deliberately left.**
  The planner no longer takes manual starts or collision decisions. `detectCollisions`, `applyCollisionDecisions`, the split/resume `isResume` handling and `CollisionDecisionDialog` are deleted; a start-driven slot and a deadline-driven slot that overlap are now simply both planned, and the runner's forecast says what the overlap costs. The `buffer` and `waiting_decision` slot states are gone from the types, the pill, the sequence graph and the chore list, and `scheduleType` loses `manual`. An `anytime` chore has no plan slot at all; it is the runner that queues it. The engine is 706 lines, down from 903.
  `autoMarkCompleteOnCountdownEnd` is retired: removed from the settings type, its parser and the settings form. A stored value is ignored.
  Countdown pills show for today only. The chore form builds its timing config in one place, used by the save path, the live preview and the pre-save lint, so a "between two times" chore is now included in its own overflow warning instead of being silently skipped.
  `choreManualStarts` is removed from the schema file, the rules file and every call site. **The hosted entity and its rule are still there on purpose.** The build deployed today still writes a manual start when someone presses Start Now, and removing the entity under it would break that button until the new build is live. Deploy first, then push — see the roadmap.
  Verification: the planner keeps 32 focused tests and 5 golden scenarios (five tests for removed features went with them, and the split scenario became an overlap scenario); 1 new chore-list test and 1 new chore-form regression test — 1,032 local tests in all; `tsc --noEmit` passes.

- **2026-10-11 — Completed and deployed: routines (phase 3).**
  `routines` and `routineSteps` are in the schema and the hosted app. A step is a join row carrying `position`, linked to one routine and one chore and cascading from both, which mirrors `choreAssignments`. Parents manage routines; the family can read them. `chores` gains the optional `hideFromDayList` flag.
  `/routines` is the parent-only manager, reached from the countdown and from a day-list routine row. Its editor builds a routine both ways in one list: point it at chores that already exist, or type new steps and have the chores created on save — for the people and the days chosen there. Steps are reordered with up and down buttons; each has an eye toggle for whether it still lists by itself in the day list. The routine's order supersedes `after_chore` between its own steps, and a routine chooses whether a step at zero waits or moves on.
  On the countdown a person sees the routines that have a step on their plate today, with progress, and starts one with a tap. A run keeps to the routine it was started on, follows its positions, and finishes after its last open step. Steps folded into a routine are left out of the day's own queue, so they are run from the routine and nowhere else.
  The day list drops folded steps and shows one collapsed row per routine with steps due — `Morning Routine 3/12` — with a progress bar and the routine's own XP, so the sidebar's totals still visibly add up. The row opens to its steps, where each can be ticked for each person through the same path as any other chore. `Run` goes to the countdown.
  Verification: 23 mutation and helper tests, 12 editor-draft tests, 9 day-summary tests, 9 manager and 6 day-row DOM tests, 9 routine cases on the countdown page and 5 in the day list, plus 1 permission contract — 1,035 local tests in all; `tsc --noEmit` passes; the schema and rules pushes were previewed and add only the routine entities, their links and `chores.hideFromDayList`; the hosted matrix proves kid writes are denied and that deleting a routine takes its steps and leaves its chores.

- **2026-10-11 — Completed: `/countdown` is rebuilt around the run record (phase 2).**
  The page is three pieces. `useCountdownRunner` reads the day — chores, today's completions, the run rows — builds each person's queue from one plan, and owns every write: start, done, "+5 min", stop, and the transitions nobody taps for. `RunnerPanel` draws one person's countdown. `FocusedCountdownPage` is the shell: who is on screen, the grid, full screen.
  A live timed step runs on the runner clock, so a 2pm chore started at 10am shows its own budget. Past zero it turns red and counts up. An untimed step has no ring and waits for Done. Done writes the completion through the canonical path and moves the run to the next open step in the same transaction; the next step's timer starts after the stack buffer, which is the celebration. When no step is open the run finishes, and the steps still gated are listed with when they unlock.
  The single-slot figure that was labelled a stack total is gone. In its place are two readouts: ahead/behind against the planner's schedule, and a forecast sentence — either the first hard deadline the current pace misses, or the room left before the tightest one.
  The overrun ladder runs from the run row, so it reads the same on every device: a prompt once the step is well over and nobody has touched the countdown, five more minutes when it is answered, an offer to stop after two extensions, and a `timeout` stop when it goes unanswered. A device also advances a run whose live step was finished in the day list, and sweeps a run left running when its family day ended.
  The page paints its own background and each panel paints its own, so loading, error, empty and finished states are no longer white on white. `RadialTimer` lost its `fixed` backdrop and gained per-instance SVG ids, so several can share a screen. Any number of people can be shown side by side; a kid sees a sibling's run but cannot drive it.
  Verification: 30 page tests and 22 display tests — 960 local tests in all; `tsc --noEmit` and the production build pass. Not exercised in a browser: the roadmap leaves that to David.

- **2026-10-11 — Completed and deployed: the run record, the runner, the gate, untimed steps and the canonical completion path (phase 1).**
  `countdownRuns` is in the schema and the hosted app, one row per member per family day with a UUIDv5 id derived from `(familyMemberId, date)`, so two devices starting the same run converge on one row. Its rule follows the `choreCompletions` pattern: a member-scoped kid may create only a run stamped with their own `familyMemberId` and may update only the run's working fields on it — never `familyMemberId` or `date` — while the shared kid principal can write nothing and parents can drive, sweep or delete anyone's. The run carries no links; identity lives in indexed attributes.
  The engine is now two modules. `chore-countdown-engine.ts` is the planner, unchanged in behaviour. `chore-countdown-runner.ts` is the runner: `buildRunnerQueue` lists everything on a person's plate in the day list's own order (or a routine's), `selectNextRunnerStep` picks the first unfinished step whose gate is open, `getRunnerClock` runs the ring from `stepStartedAt + durationSecs + extensions`, `getRunnerOverrunStatus` is the abandonment ladder, `computeRunnerStanding` is the ahead/behind figure and the deadline forecast, and the `buildRun…Patch` functions are the only writers of a run row. A step with no duration is queued as untimed rather than dropped, and `anytime` chores are queued like any other.
  Completions no longer have three implementations. `lib/chore-completion.ts` builds the writes for the day list, the countdown and the sequence view alike, so a chore finished on the countdown now carries a history event and a `markedBy` link and cannot overwrite somebody else's up-for-grabs claim.
  The `/countdown` page still renders from the planner; it starts reading the run record in phase 2.
  Verification: 63 new runner tests beside the planner's 42, 9 completion-path tests and 1 permission contract — 912 local tests in all; `tsc --noEmit` passes; the schema and rules pushes succeeded, each previewed first and adding only `countdownRuns`; the hosted member-kid/shared-kid/parent matrix for `countdownRuns` passes.

Decisions the build had to make where this document was silent are marked **(built)** below.

---

## Vision

The countdown makes it easy for a family member to see **what they should be doing right
now and how long they have**, so that everything on their plate for the day gets done.

Three consequences follow from that sentence, and they are the whole design:

1. **It is a runner, not a schedule viewer.** You start; a step gets a timer; you finish
   it; the next step begins. You keep going until you decide to stop.
2. **Working ahead is the normal case, not an override.** If four things are scheduled for
   this afternoon but could all be done now, you start the first one and the queue carries
   you through the rest.
3. **Some things are genuinely gated.** If a chore cannot be done before a certain time,
   the runner will not let you start it early.

The same machinery serves a named routine — "Morning Routine", "Evening Routine" — the way
apps like Routinist do. A routine is a saved, ordered queue; the day itself is an ad-hoc one.

---

## What is wrong with what exists

The current system is a **planner that schedules chores as late as possible**.
`packDeadlineDriven` packs backwards from each deadline, so a chore's computed start is
"the latest moment you could begin and still finish in time". The countdown page reads the
wall clock and displays whichever slot is currently active. That is an alarm clock, and it
is the opposite default from the one the vision needs.

The headline scenario does not work today:

- `Start Now` writes a `choreManualStarts` row that shifts **only that one chore**
  ([FocusedCountdownPage.tsx:485](../components/countdown/FocusedCountdownPage.tsx#L485)).
- The pull-forward in `applyStartsAndChain`
  ([chore-countdown-engine.ts:700](../packages/shared-core/src/chore-countdown-engine.ts#L700))
  only advances the next chore when the two were packed *exactly* adjacent in the static
  plan (`targetEndMs + buffer === targetStartMs`) or explicitly chained with `after_chore`.
  Four independent 2pm/3pm/4pm chores satisfy neither test.
- So finishing the first chore at 10am leaves the second sitting at 2pm showing
  "starts in 4h". Running the stack early requires four separate `Start Now` taps.

And the gate does not exist at all: `handleStartNow` performs no earliest-allowed check.
The information is present — `after_time`, `after_marker`, `between_times` all resolve a
`startOffset` — the runner simply never consults it.

---

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | **The ring counts down the step's own duration.** | Starting a 2pm chore at 10am should show a 12:00 budget, not 4 hours. Wall-clock deadlines demote to a secondary readout. |
| 2 | **Run state is persisted per member in Instant.** | Survives reload, lets several people run simultaneously, lets a parent see who is mid-routine on the family tablet. |
| 3 | **A routine is a named, ordered group of chores.** | Point it at existing chores, or type new steps and have the chores created for you. Routine membership carries the ordering, so `after_chore` chains are derived, never hand-built. |
| 4 | **Steps may be untimed.** | "Take vitamins" needs no ring. An untimed step shows no timer and advances on tap. Also gives a clean answer for existing chores with neither duration nor weight, which today are silently dropped from the countdown. |
| 5 | **Routine steps are hidden from the day chore list but still count.** | A 12-step morning routine collapses to one "Morning Routine" row instead of 12. XP and allowance work normally because the steps are real chores with real completions. |
| 6 | **Stopping mid-queue reverts the rest to their scheduled times.** | You did 3 of 4 early; the fourth goes back to being an ordinary 4pm chore and its countdown reappears then. The run simply ends. |
| 7 | **Day-list visibility: routine membership gates it, an optional chore flag modifies it.** | The two creation paths produce different kinds of step and need different defaults. See "Day-list visibility". |
| 8 | **A timed step that hits zero counts up and waits.** Named routines may opt into auto-advance. | The ad-hoc day queue must never invent completions or silently skip. A routine that has to end when the bus arrives genuinely wants the clock in charge. |
| 9 | **Overrun escalates through an "Are you still here?" prompt before auto-stopping.** | Distinguishes a long chore from an abandoned one by asking, rather than guessing at a threshold. |

**Retired by decision 8:** `autoMarkCompleteOnCountdownEnd`. It writes a real
`choreCompletions` row with `allowanceAwarded: false` — the exact shape allowance
distribution later pays out on — so a chore nobody did earns XP and real money on a timer.
That is a data-integrity problem in a system that moves actual currency, not a UX preference.

---

## Target model

### Two clocks

The engine splits into a **runner** and a **planner**, and they answer different questions.

**Runner clock — drives the ring.** The live step's timer is `stepStartedAt + durationSecs`.
Nothing about it depends on the wall-clock schedule. An untimed step has no runner clock at
all; it just waits for a tap.

**Planner clock — drives the ahead/behind readout and the forecast.** The existing
right-to-left deadline packing stays, but it stops deciding when your timer runs. It now
answers: *are you ahead of where you needed to be, and if you keep going at this rate, will
you still make your hard deadlines?* The current `targetStartMs` / `targetEndMs` pair was
always the reference point for this, so the ahead/behind arithmetic survives intact.

### The earliest-allowed gate

Every chore already resolves an earliest-allowed moment; the runner must start honouring it:

| Timing mode | Floor |
|---|---|
| `after_time`, `after_marker`, `after_chore` | the resolved `startOffset` |
| `between_times`, `named_window` | the window start |
| `before_time`, `before_marker`, `before_chore` | day start (freely pullable forward) |
| `anytime` | day start |

When the queue reaches a step whose floor is still in the future, the runner skips past it
and resurfaces it once it unlocks, rather than blocking the whole queue. *(Confirm this
skip-and-resurface behaviour during implementation — blocking is the alternative.)*

**(built)** Skip-and-resurface is what shipped. Selection always starts from the top of the
queue, so a gated step comes back on the first advance after it unlocks; nothing interrupts
the step that is live. Three details the table does not cover:

- **Queue order.** The ad-hoc day queue follows the day list's own order — late, then now,
  then upcoming, by deadline within each — so the countdown never disagrees with the list
  beside it. A routine follows its step positions.
- **`after_chore` with nothing to wait for.** A step that follows a chore not due today is
  not gated at all, since that chore can never be finished. A step whose anchor is due but
  undone waits for it, or for its fallback time if it has one.
- **Nothing left but gated steps.** The run ends rather than idling; the gated steps go back
  to being ordinary scheduled chores, exactly as decision 6 describes for a manual stop.

### The run record

One row per member per family day:

```
countdownRuns
  familyMemberId    indexed
  date              indexed   family-day key
  routineId         optional  null = the day's ad-hoc queue
  status            'running' | 'stopped'
  currentChoreId    the live step
  stepStartedAt     ISO timestamp, basis for the ring
  stepExtensionSecs accumulated "+5 min" grants for the live step
  stepExtensionCount how many times the live step has been extended
  skippedChoreIds   steps a routine set to `advance` moved past      (built)
  lastInteractionAt any tap on any device; basis for the idle check
  startedAt / stoppedAt
  stoppedReason     'user' | 'timeout' | 'day_boundary' | 'finished' (built)
```

Completions already record what was finished, so the run does not duplicate that.
Permissions follow the member-scoped pattern the July audit applied to `choreCompletions`:
a kid may write only their own run.

**(built)** Two additions. `finished` is the queue running out of steps that can be done
now — the other three reasons all stop a run that still had a live step, and a parent
reading the row needs to tell "ran out of things to do" from "stopped". `skippedChoreIds`
exists because a routine set to `advance` leaves steps undone, and without a record of them
the runner would select the same step again on the very next advance. A stopped run keeps
its `currentChoreId`, so the row still says where the run ended.

### The runner screen

**(built)** How the page behaves, where the sections above leave it open:

- **With no run, the planner's slot is a reminder.** Before a step's scheduled start the
  page shows it as "up next" with Start. Once the scheduled start arrives the ring comes
  back, counting down to the planned end — this is decision 6's "its countdown reappears
  then". Pressing Start at any point begins a run with the step's full budget, and the
  lateness shows up as "behind".
- **The celebration is the stack buffer.** Done advances the run at once, with the next
  step's `stepStartedAt` set one buffer into the future. Every device shows the same pause
  because it is read from the run row.
- **Any tap is presence.** A click or key press on a device showing the countdown stamps
  `lastInteractionAt` on the runs that device may write, at most once a minute.
- **Who may drive a run.** The member themselves, or a parent. Anyone else sees it
  read-only, which is the same boundary the permission rule enforces.
- **Transitions nobody taps for** — advancing past a step finished elsewhere, the timeout
  stop, the day-boundary sweep — are made by whichever open device may write that run. If no
  such device is open, nothing happens until one is.
- **Several people.** Tapping a person adds or removes them from the screen; someone is
  always shown. The choice is remembered per device.

### Routines

```
routines
  name, sortOrder, (icon/color)
  onStepOverrun    'wait' | 'advance'   default 'wait'

routineSteps          join carrying order
  routineId, choreId, position
```

A join entity is needed because Instant links cannot carry attributes; this mirrors the
existing `choreAssignments` pattern, which already carries `order`.

Creating a routine from scratch spawns chores for steps that do not yet exist. Within a
routine, step order supersedes `after_chore`; the timing mode remains for genuine one-off
cross-routine dependencies.

**(built)** What the model above leaves open:

- **A routine belongs to nobody in particular.** It is a list of chores, and each chore has
  its own assignees, so one "Morning Routine" serves every child whose chores are in it:
  each person runs the steps that are on their own plate that day.
- **Typed steps need a who and a when.** The editor asks once — which people, which days —
  and applies it to every chore it creates. They are created as `anytime`, untimed unless
  minutes are given, with no XP weight; all of that is editable on the chore afterwards.
- **A chore may be a step of more than one routine**, but appears once in each.
- **Icon and colour** are not built. Nothing else depends on them.
- **Deleting a routine** removes its steps and never its chores.

### Day-list visibility

```
hidden = hasRoutineMembership && (chore.hideFromDayList ?? defaultForCreationPath)
```

The two creation paths produce different kinds of step and need opposite defaults:

- **Pointing a routine at existing chores.** These were already in the day list and were
  fine there. Default **visible** — an organisational change should not silently remove a
  real chore from view.
- **Typing new steps, chores auto-created.** "Brush teeth", "take vitamins". These are the
  clutter the decision exists to remove. Default **hidden**.

**(built)** The default is applied when the step is created, so the stored rule is simply
`hidden = hasRoutineMembership && chore.hideFromDayList === true`: a typed step is written
with the flag set, and an existing chore is left without it. The editor's eye toggle changes
it either way. The flag is the chore's, so it reads the same from every routine it is in.

Membership gates the rule, so the flag is inert on a chore that belongs to no routine.
Removing a chore from its last routine therefore restores it to the day list automatically,
with no stale state to clean up — the failure mode of a bare flag, which would otherwise
leave a chore invisible in the day list *and* absent from any routine.

Either way the day list renders one collapsed `Morning Routine — 3/12` row, so
`trackerQuery` gains `routineSteps: { routine: {} }` under `chores` regardless of which
approach is taken; the join is not a differentiator.

XP is computed from chores rather than from the rendered list, so hiding rows changes no
totals. It does mean the sidebar's possible-XP denominator includes rows that are not
visible, so the collapsed routine row should surface its own XP contribution or the numbers
will not visibly reconcile.

**(built)** Three things about the row and the queue:

- **A folded step can still be ticked from the day list.** The routine row opens to its
  steps with a tick per person. Without that, a parent could only mark "brush teeth" done by
  running the countdown.
- **Folded steps are left out of the day's ad-hoc queue** on the countdown, for the same
  reason they are left out of the list: they belong to their routine. A step that still
  lists by itself is in both.
- **The tasks page ignores the flag.** A chore that carries a task series stays on `/tasks`
  whether or not it is folded into a routine.

### Step overrun and abandonment

A timed step reaching zero counts up in red and waits (decision 8). Overrun folds into the
ahead/behind figure in real time. Nothing is marked, skipped or invented.

Distinguishing a long chore from an abandoned one is then handled by an escalating check,
modelled on the "Are you still there?" pattern banks use:

| Stage | Condition | Behaviour |
|---|---|---|
| 1 | Overdue by `max(5 min, 50% of step duration)` **and** untouched since the step started | Prompt: *"Still working on Brush Teeth?"* |
| 2 | Prompt answered | Grants +5 min, exactly as the manual control does |
| 3 | Prompt unanswered for a further ~10 min | Run flips to `stopped` with `stoppedReason: 'timeout'` |
| 4 | After 2–3 extensions on the same step | The question changes to *"Still working on this, or should I stop the run?"* with explicit choices |

Design constraints:

- **The trigger is the conjunction of overdue and idle, not overdue alone.** They come apart
  in both directions: a genuinely slow chore is overdue but present, and a 45-minute chore
  abandoned at minute one is idle but not overdue. Prompting purely on overrun trains the
  user to dismiss it reflexively.
- **Idleness is a property of the run, not the device.** `lastInteractionAt` lives on the run
  record; a tap on any device updates it, and the prompt renders wherever someone is
  looking. Without this, a wall tablet displaying a run would auto-stop a session the user
  is actively driving from their phone.
- **Execution is client-side.** If every device is closed nothing fires and the run simply
  persists until the family-day boundary sweeps it (`stoppedReason: 'day_boundary'`). No
  cron job is required.
- **An auto-stop means exactly what a manual stop means** (decision 6): remaining steps
  revert to their scheduled times, and the step that was live stays incomplete with no
  completion row. Only `stoppedReason` differs, so a parent can later distinguish "did 3 of
  4 and stopped" from "walked away".
- Thresholds are settings, not constants — this is the sort of thing that wants tuning after
  a week of real use.

**(built)** The thresholds are five fields on the stored countdown settings:
`overrunPromptMinSecs` (300), `overrunPromptFraction` (0.5), `overrunPromptGraceSecs` (600),
`stepExtensionSecs` (300) and `overrunStopOfferAfterExtensions` (2). Two readings the table
left open:

- **"Untouched since the step started" is "untouched for the threshold".** The prompt is due
  at `max(step's end, last interaction) + threshold`. On a step nobody has touched since it
  began this is exactly stage 1. It also covers what the table does not: a stray tap after
  zero postpones the prompt by one threshold instead of silencing it for the rest of the
  day, and the prompt comes round again after an extension, which stage 4 depends on.
- **"+5 min" on a step already past zero grants five minutes from now.** Adding five minutes
  to a budget that ran out eight minutes ago would leave the ring red and the button
  apparently broken. Pressed with time still on the clock, it simply adds five minutes.

An untimed step has no clock to run over, so it never prompts; an abandoned one is ended by
the day-boundary sweep.

Both platforms already track idle time: `AuthProvider.tsx:32` (`IDLE_TIMEOUT_MS`, parent
de-elevation) on web, and `InteractionCapture` in `mobile/src/providers/AppProviders.js`.
This is a second consumer of an existing pattern rather than a new primitive.

---

## What changes

### Kept

- The timing vocabulary in `chore-timing.ts`. It already expresses both "not before X" and
  "must be done by Y" — exactly the pair a runner needs.
- Durations from `estimatedDurationSecs` with the `weight × 60` fallback.
- The stack buffer setting.
- `targetEnd` vs effective end as the ahead/behind yardstick.
- `RadialTimer`. It is the good part.
- **`SequenceTimeline`** (the git-graph at `/chores/all` → Sequence). It visualises a *plan*
  rather than a run, so it sits outside the runner, but it is retained as a parent-facing
  planning view and has further plans of its own.

### Removed

- **`choreManualStarts`** entity and permissions — replaced by `countdownRuns`. It was keyed
  by `choreId` alone (ignoring the member, so one kid's start shifted everyone's timeline),
  never upserted, and writable by any family principal.
- **The collision dialog and split/resume machinery** — `CollisionDecisionDialog`,
  `detectCollisions`, `applyCollisionDecisions`, and the `isResume` slot handling. In a
  runner, an overlap stops being a modal decision and becomes a forecast: *"keep going and
  you will miss Dinner Dishes by 12 minutes."* Splitting a chore in half around another one
  is a great deal of engine for something the vision never asks for.
- **The `buffer` slot state** — declared, styled and filtered for in the types, the pill, the
  graph and both pages, and never once emitted by the engine.
- **Countdown pills on non-today dates** — a countdown for last Tuesday is meaningless.

### Carried along by the rewrite

These are existing defects that the redesign fixes as a side effect rather than as separate
work:

- Countdown completions currently bypass `toggleChoreDone`, so they write **no history
  event, no `markedBy` link, and skip the up-for-grabs "already claimed" guard**
  ([FocusedCountdownPage.tsx:464](../components/countdown/FocusedCountdownPage.tsx#L464),
  [ChoresTracker.tsx:1614](../components/ChoresTracker.tsx#L1614)). Chores finished on the
  countdown are invisible in `/history`.
- `anytime` chores can never enter the countdown: the engine supports them via manual start
  ([chore-countdown-engine.ts:149](../packages/shared-core/src/chore-countdown-engine.ts#L149))
  but all three callers filter them out first. Decision 4 makes them runnable.
- The chore form's pre-save lint builds `between_times` as flat `{startTime, endTime}` while
  the save path and resolver both use `window: {…}`, so the chore being edited is excluded
  from its own overflow warning.
- `/countdown` is styled entirely in `text-white` but renders inside the light app shell.
  Its only dark backdrop is a `fixed inset-0 -z-10` gradient painted from *inside*
  `RadialTimer` — so every state where the ring is not mounted (loading, error, "No
  Countdown Chores", "All Done!") is white text on a light canvas. The page must own its
  own background.

### Open

- **Gated steps mid-queue.** The runner skips past a step whose earliest-allowed time is
  still in the future and resurfaces it once it unlocks. Blocking the queue instead is the
  alternative; confirm against real use.
- **Overrun thresholds.** The 5 min / 50% / 10 min / 2–3 extensions figures above are
  starting values to tune once the runner is in daily use.
- **Skipped steps under `onStepOverrun: 'advance'`.** Whether an auto-advanced step
  resurfaces at the end of the routine or is simply left undone for the day. **(built)**
  Left undone for that run: it stays an ordinary unfinished chore in the day list. This is
  the starting behaviour, not a settled answer.

---

## Phasing

1. **Schema and engine split.** Add `countdownRuns`, split the engine into runner and
   planner, honour the earliest-allowed gate, route completions through the canonical path.
2. **Runner UI.** Rebuild `/countdown` around the run record: start, advance, stop, untimed
   steps, correct page background, ahead/behind and deadline forecast readouts.
3. **Routines.** `routines` + `routineSteps`, the routine editor with both creation paths,
   auto-chaining.
4. **Cleanup.** Remove `choreManualStarts`, collision machinery and the `buffer` state;
   collapse routine steps in the day list; fix the chore-form lint.
5. **Mobile.** The engine lives in `shared-core` precisely so mobile can use it; today mobile
   has no countdown at all.
