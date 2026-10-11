# Countdown Redesign

**Date:** 2026-08-02
**Status:** Agreed design, not yet implemented.
**Supersedes:** the countdown behaviour described in `audit-2026-07-chores.md` §5.2.

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
  lastInteractionAt any tap on any device; basis for the idle check
  startedAt / stoppedAt
  stoppedReason     'user' | 'timeout' | 'day_boundary'
```

Completions already record what was finished, so the run does not duplicate that.
Permissions follow the member-scoped pattern the July audit applied to `choreCompletions`:
a kid may write only their own run.

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
  resurfaces at the end of the routine or is simply left undone for the day.

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
