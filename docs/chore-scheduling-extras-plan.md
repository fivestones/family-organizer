# Chore end dates, extra days and breaks

**Audited and rewritten:** 11 October 2026, against the code as it stands after the July audits and the countdown redesign.
**Status:** End dates are shipped. Breaks are half-shipped. Extra days do not exist. Two design questions need David before the rest is built — see [Questions](#questions-for-david).
**Tracked as:** [Scope 4](../roadmap.md#scope-4--chore-scheduling-extras) on the roadmap.

This replaces the plan that used to live at the repository root as `plan.md`. That plan named seven files and gave line-level instructions; it was written before the schedule engine it describes was rebuilt, and most of what it says to add or edit either already exists in another form or now lives somewhere else. Nothing in it should be followed. What it wanted is kept here; how to get there is redone from the code.

---

## What was wanted

Three things for recurring chores:

1. **End date**, inclusive — the chore stops appearing after it.
2. **Extra days** — one-off days the chore also happens on, beyond its recurrence.
3. **Breaks** — single days or ranges where the chore does not happen. A break wins over everything, an extra day included.

## What the audit found

### End dates already exist

A chore's end date is the end condition of its recurrence, and there are three ways to set one today:

- **In the chore form.** Repeat → *End on date* writes `UNTIL=` into the chore's `rrule`; *End after occurrences* writes `COUNT=` ([ChoreRecurrenceFields.tsx](../components/ChoreRecurrenceFields.tsx), [lib/recurrence.ts](../lib/recurrence.ts)).
- **From the chore's schedule actions.** *End chore* caps the rule before the first occurrence that should no longer happen and records an open-ended pause with intent `ended`, so it can be undone ([ChoreScheduleActions.tsx](../components/ChoreScheduleActions.tsx), `createChorePausePatch` in [lib/chore-schedule.ts](../lib/chore-schedule.ts)).

The date is inclusive in both occurrence engines. That is now pinned by [test/unit/lib/chore-end-date.node.test.ts](../test/unit/lib/chore-end-date.node.test.ts).

The old plan's `endDate` field should **not** be added. It would be a second source of truth beside `UNTIL`, and the pause machinery already rewrites the rule's end condition and remembers the original in `pauseState.originalEndCondition` so that resuming restores it. A separate field would have to be kept in step with all of that for no gain.

### Breaks exist one at a time

*Pause*, with "resume automatically on" a date, is a break: `createChorePausePatch` adds an exdate for every occurrence in the window and stores them in `pauseState.generatedExdates` so that cancelling or resuming early can take them back out.

What is missing against what was wanted:

- **Only one at a time.** `pauseState` holds a single pause. A second break cannot be planned until the first has finished.
- **No list.** There is nowhere to see the breaks a chore has, past or planned.
- **Tied to the schedule at the moment of pausing.** The exdates are worked out from the rule as it was. Change the chore from Mondays to Tuesdays during a planned break and the break silently stops applying, because none of its exdates fall on a Tuesday.
- **It cannot beat an extra day**, because there are no extra days yet — and a list of exdates could not express it anyway.

### Extra days do not exist

Nothing adds an occurrence outside the rule. `chores.allowExtraDays` is in the schema and is referenced nowhere; it was presumably a placeholder for this.

### Where the behaviour lives now

The old plan put the scheduling logic in `lib/chore-utils.ts`. It is not there any more. There are **two** occurrence engines, and both would have to change:

| Engine | File | Used by |
| --- | --- | --- |
| Shared | [packages/shared-core/src/chores.ts](../packages/shared-core/src/chores.ts) — `createOccurrenceSet`, `getChoreOccurrencesInRange`, `getRotationIndex`, `getAssignedMembersForChoreOnDate`, `calculateDailyXP` | Who is assigned on a day, rotation, daily XP, the countdown and routine queues, the whole Expo app |
| Web | [lib/chore-schedule.ts](../lib/chore-schedule.ts) — `createOccurrenceSet`, `getChoreOccurrencesInRange`, `choreOccursOnDate`, `getNextChoreOccurrence`, and all pause/resume logic | The day list ([ChoreList.tsx](../components/ChoreList.tsx) `shouldShowChore`), the allowance period calculation and the assignment preview grid ([lib/chore-utils.ts](../lib/chore-utils.ts)), the chore inventory ([lib/chore-catalog.ts](../lib/chore-catalog.ts)), and — easy to miss — task series ([lib/task-scheduler.ts](../lib/task-scheduler.ts), [lib/task-bins.ts](../lib/task-bins.ts)), whose rolling queue advances on the chore's occurrences |

Each builds an `RRuleSet` from `rrule` and `exdates`, and each keeps its own content-keyed caches.

Of the seven files the old plan named:

| Old plan | Now |
| --- | --- |
| `instant.schema.ts` — add `extraDays`, `breaks`; `endDate` "already exists" | `endDate` does not exist and should not. The other two are still the right additions; see the design below. |
| `lib/chore-utils.ts` — `isChoreScheduledOnDate`, `isRegularOccurrence`, edit `getRotationIndex` | None of these belong here. `chore-utils` delegates assignment and XP to shared-core and occurrences to `lib/chore-schedule.ts`. `getRotationIndex` is in shared-core. |
| `components/ChoreList.tsx` — replace inline rrule logic in `shouldShowChore` | Already done: it calls `choreOccursOnDate`. It will follow the engine with no edit. |
| `components/DetailedChoreForm.tsx` — end-date switch, extra days, breaks | The end date is already in the Repeat section. Extra days and breaks are still to add. |
| `components/ChoresTracker.tsx` — save the fields | Still true for `extraDays` and `breaks`, in `addChore` and `updateChore`. |
| `components/ChoreCalendarView.tsx` — "no change needed" | Still true: it reads `getChoreAssignmentGridFromChore`, which reads the web engine. |
| "Push schema" | Preview first — see the note under Commands in [CLAUDE.md](../CLAUDE.md). |

### What the caches need

Both engines key their caches on the schedule's content: the normalised rule, the start date and the sorted exdates. Extra days and breaks are part of what makes two schedules the same or different, so **both must go into both cache keys** — the occurrence-set key, which the range and rotation keys are built from. Leave them out and a chore edited to add a break would keep serving its old occurrences until the cache turned over. Nothing else about the caches has to change: a new key is a new entry, and the old one ages out.

### The hazard: partial schedule objects

Several callers do not pass the chore to the engine. They pass a hand-built `{ startDate, rrule, exdates }`:

- `ChoreList.tsx`, when deciding whether a pulled-forward task series is off schedule
- `lib/task-scheduler.ts` and `lib/task-bins.ts`, for the task-series queue — `getTasksForDate` takes the rule and the exdates as separate arguments, so its signature and every caller change too
- `createChorePausePatch` and `resumeChorePatch`, when working out which occurrences a pause covers

Any of these that is not given the new fields will quietly compute a schedule without them. A task series would not advance on an extra day; a pause would generate exdates for days that are already inside a break. This is the part most likely to go wrong, and the reason to make the change in one pass with a test for each caller rather than field by field.

---

## Proposed design

Not yet agreed — it depends on the two questions below.

```ts
// chores
extraDays: string[]                          // i.json().optional() — ["2026-03-11"]
breaks: Array<{ start: string; end: string }> // i.json().optional() — a single day has start === end
```

Evaluated by the engines in this order, which is the old plan's order with the end date read from the rule:

```
1. before the start date                 → no
2. inside a break                        → no    (beats an extra day)
3. matches the rule, and not an exdate   → yes   (the rule's own UNTIL or COUNT has already applied)
4. is an extra day, on or before UNTIL   → yes
5. otherwise                             → no
```

In `RRuleSet` terms: `rdate` for each extra day that is inside no break and not past `UNTIL`, and an `exdate` for each rule occurrence inside a break — computed when the set is built, from the ranges, so that a break keeps applying when the rule is edited.

- **Ranges, not exdates, for breaks.** This is the one real departure from "reuse what exists". A range survives a change of schedule and can override an extra day; a list of exdates can do neither.
- **`pauseState` stays as it is**, for *Pause until further notice* and *End chore*, which are open-ended and are about the rule's end condition. A bounded pause and a break are the same thing to the person using it, so the bounded form should write a break instead of exdates — see the first question.
- **Rotation.** An extra day is a real occurrence, so for a daily rotation it takes a turn, exactly as the old plan said. This falls out of `getRotationIndex` counting the set's occurrences; there is nothing to special-case. Weekly and monthly rotations already bucket by week and month, so an extra day inherits its bucket.
- **Remove `chores.allowExtraDays`** in the same schema push.

### Where it would be built

1. Both engines' `createOccurrenceSet` and cache keys, behind one shared function that turns `{ rrule, startDate, exdates, extraDays, breaks }` into the set, so the two cannot drift.
2. Every partial-schedule caller listed above, each with a test.
3. `ChoreSchedulePatch` and the pause functions, so a patch carries the new fields through.
4. The chore form: two list editors under Repeat, shown only for a recurring chore.
5. `ChoresTracker` `addChore` / `updateChore`, and the schema.
6. The Expo app needs no change: it reads the shared engine, and a chore's new attributes arrive with the chore.

---

## Questions for David

1. **Should a bounded pause become a break?** Today *Pause · resume automatically on 20 March* writes exdates and a `pauseState`. With breaks in place, the same action could simply add a break, and the Pause dialog would be left with the two open-ended choices. That is cleaner, and it is what makes several planned breaks possible — but it changes what an existing control does, and any bounded pause already scheduled would need converting. The alternative is to leave Pause alone and add breaks beside it, which gives two ways to do one thing.

2. **Does an extra day take a turn in a daily rotation?** The old plan says yes, and it is the natural reading: it is a real occurrence. But it shifts everyone after it by one — add an extra Saturday and the following Monday goes to a different child than it would have. If extra days are meant as "this child, one more time", they should not advance the rotation, and need an explicit assignee instead.

Neither changes whether the feature is built; both change what gets written to the schema, which is why they come first.

---

## What closes with this

In the idea backlog: **Chore end dates, pauses, restarts, and schedule changes**, and **One-off and exception-day chore changes**. The first is already mostly met by end dates and pause; the second waits for extra days and breaks.
