# Plan: Chore End Date, Extra Days & Breaks

> **Status, 11 October 2026 — read this before following anything below.**
>
> **All three outcomes are still wanted**: end dates, extra days, and breaks. None of them shipped. Verified against the current schema: `chores` has no `endDate`, `extraDays` or `breaks` field, and `allowExtraDays` exists but is referenced nowhere outside [instant.schema.ts](../instant.schema.ts). Only pause/resume exists, through `pauseState` and `exdates`.
>
> **The instructions below are stale and must not be followed as written.** This plan was authored before two quarters of change — the four July 2026 audits, the move of assignment, rotation and daily-XP logic into `packages/shared-core`, the occurrence-set and rotation-index caches, chore-deletion cascades, and the countdown engine. Its file-by-file assignments, and its scheduling-priority rules, may no longer match where the behavior actually lives.
>
> **The first step of implementing this is to audit this document**, not to start editing the seven files it names:
>
> 1. Confirm which of the named files still own the behavior assigned to them here.
> 2. Check the scheduling-priority rules against [lib/chore-schedule.ts](../lib/chore-schedule.ts) and [packages/shared-core/src/chores.ts](../packages/shared-core/src/chores.ts), which are now the authority.
> 3. Decide how end dates, extra days and breaks interact with the content-keyed occurrence and rotation caches added in July — a new exclusion or inclusion source has to invalidate correctly.
> 4. Decide whether `extraDays` and `breaks` should be `i.json()` as drafted, or should reuse the existing `exdates` and `pauseState` representations.
> 5. Rewrite this document from that audit, and date the rewrite here.
>
> Tracked as [Scope 4](../roadmap.md#scope-4--chore-scheduling-extras) on the roadmap. Previously lived at the repository root as `plan.md`, where `.gitignore` had been hiding it from version control by basename.


## Overview
Add three scheduling features to recurring chores:
1. **End date** (inclusive) — chore stops appearing after this date
2. **Extra days** — one-off additional days beyond normal recurrence
3. **Breaks** — single days or date ranges where the chore is paused

All three features apply **only to recurring chores** (ones with an rrule set). Breaks override everything including extra days.

## Data Structures

```ts
// On the chore entity:
endDate: string | null          // ISO date string "2026-06-30", already exists in schema
extraDays: string[] | null      // ["2026-03-11", "2026-04-15"]
breaks: Array<{start: string; end: string}> | null  // [{start: "2026-03-15", end: "2026-03-20"}]
// Single-day break: start === end
```

## Files to Modify (7 files)

### 1. `instant.schema.ts` — Add two new fields
- Add `extraDays: i.any().optional()` to `chores` entity
- Add `breaks: i.any().optional()` to `chores` entity
- `endDate` already exists, no change needed
- Then push schema: `npx instant-cli push schema --yes`

### 2. `lib/chore-utils.ts` — Core scheduling logic

**Add new exported function `isChoreScheduledOnDate(chore, date)`:**
Centralized check that handles all scheduling rules in priority order:
1. Before start date → false
2. Past end date (inclusive) → false
3. Falls within a break → false
4. Matches rrule → true
5. Is in extraDays → true
6. Otherwise → false

**Add helper `isRegularOccurrence(chore, date)`:** Returns true if the date matches the rrule (not an extra day). Needed for rotation logic.

**Update `Chore` interface:** Add optional `endDate`, `extraDays`, `breaks` fields.

**Update `getRotationIndex()`:** Add optional `extraDays` parameter.
- **Daily rotation**: Extra days count as additional occurrences advancing the rotation. Calculate: `regularOccurrencesUpToD + extraDaysBeforeD - 1` (0-based).
- **Weekly/Monthly rotation**: No change needed — extra days naturally inherit the rotation index of their week/month.

**Update `getAssignedMembersForChoreOnDate()`:**
- Use `isChoreScheduledOnDate()` instead of inline rrule check
- Pass `extraDays` to `getRotationIndex()` for daily rotation
- For non-rotating chores on extra days: return all assignees

**Update `getChoreOccurrencesForMemberInPeriod()`:**
- After getting rrule occurrences, filter out dates past endDate, dates within breaks
- Add extra days that fall within the period (and aren't in breaks or past endDate)
- Then check assignment for each date as before

**Update `getChoreAssignmentGridFromChore()`:**
- Same adjustments: filter by endDate/breaks, add extra days
- This function powers the ChoreCalendarView preview

### 3. `components/ChoreList.tsx` — Use centralized function

**Update `shouldShowChore()`:** Replace the inline rrule logic with a call to `isChoreScheduledOnDate()` from chore-utils. This makes ChoreList automatically respect end dates, breaks, and extra days.

### 4. `components/DetailedChoreForm.tsx` — Form UI for all three features

**New state variables:**
```ts
const [endDate, setEndDate] = useState<Date | null>(null);
const [hasEndDate, setHasEndDate] = useState(false);
const [extraDays, setExtraDays] = useState<string[]>([]);
const [newExtraDay, setNewExtraDay] = useState('');
const [breaks, setBreaks] = useState<Array<{start: string; end: string}>>([]);
const [newBreakStart, setNewBreakStart] = useState('');
const [newBreakEnd, setNewBreakEnd] = useState('');
const [newBreakType, setNewBreakType] = useState<'single' | 'range'>('single');
```

**Initialize from `initialChore`** in the existing useEffect.

**New UI sections** (placed between Frequency and Assignees, only shown when recurrence is set):

**End Date section:**
- Switch toggle "Set End Date"
- When enabled: date picker (must be >= startDate)

**Extra Days section:**
- Date input + "Add" button
- List of added dates with day-of-week label and remove (×) button
- Validation: don't allow adding a date that's already a regular occurrence or already in the list

**Breaks section:**
- Toggle: "Single Day" / "Date Range"
- Single: one date picker + Add
- Range: start date + end date pickers + Add
- List of breaks showing the date/range with remove (×) button

**Update `handleSave()`:** Include `endDate`, `extraDays`, `breaks` in save data.

**Update `ChoreSaveData` interface:** Add the three new fields.

**Update `choreForPreview`:** Include the three new fields so ChoreCalendarView shows them.

### 5. `components/ChoresTracker.tsx` — Save new fields to DB

**Update `addChore()`:** Include `endDate`, `extraDays`, `breaks` in the `tx.chores[choreId].update({...})` call.

**Update `updateChore()`:** Same — include the three new fields in the update transaction.

### 6. `components/ChoreCalendarView.tsx` — Preview respects new rules

The calendar preview gets its data from `getChoreAssignmentGridFromChore()`, which we're updating in step 2. The preview will automatically respect end dates, breaks, and show extra days once that function is updated. **No additional changes needed** in this file since it delegates to chore-utils.

### 7. Push schema changes
Run `npx instant-cli push schema --yes` after updating `instant.schema.ts`.

## Scheduling Logic Priority (for reference)
```
1. date < startDate        → NOT scheduled
2. date > endDate          → NOT scheduled
3. date in break range     → NOT scheduled (overrides extra days)
4. date matches rrule      → SCHEDULED
5. date in extraDays       → SCHEDULED
6. otherwise               → NOT scheduled
```

## Rotation Index with Extra Days (daily rotation only)
```
If target is a REGULAR day:
  index = rrule.between(start, target, true).length + extraDaysBefore(target) - 1

If target is an EXTRA day:
  index = rrule.between(start, dayBefore(target), true).length + extraDaysUpToAndIncluding(target) - 1
```
For weekly/monthly rotation: no change — extra days inherit the rotation of their week/month.
