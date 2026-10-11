import type { SharedChoreLike } from './chores';
import {
  resolveChoreTimingForDate,
  getDayBoundaryMinute,
  getChoreTimingMode,
  getRoutineMarkerPreset,
  type SharedScheduleSettings,
  type SharedRoutineMarkerStatusLike,
  type SharedTimingMode,
  type SharedChoreTimingContext,
} from './chore-timing';

import type {
  CountdownChoreInput,
  CountdownEngineInput,
  CountdownEngineOutput,
  CountdownSlot,
  CountdownSlotState,
  CountdownWarning,
  PersonCountdownTimeline,
  ResolvedCountdownChore,
} from './chore-countdown-types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a family-day minute offset to an absolute timestamp (ms).
 *
 * Offset 0 = the day boundary time on `date`. For a 03:00 boundary and
 * date = 2026-03-31, offset 0 = 2026-03-31T03:00 local. Offsets can go
 * up to 1440 (next day boundary).
 */
export function offsetToTimestampMs(
  offsetMinutes: number,
  date: Date,
  scheduleSettings: SharedScheduleSettings,
): number {
  const boundaryMinute = getDayBoundaryMinute(scheduleSettings);

  // `date` is the calendar date (e.g. 2026-03-31). The family day starts at
  // boundaryMinute on that calendar date.
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  // Base = midnight UTC of the calendar date, then add boundary + offset.
  // We use local times conceptually but store as UTC-date-keyed, so we
  // build a Date from the calendar date components.
  const baseMidnight = new Date(year, month, day, 0, 0, 0, 0);
  const totalMinutes = boundaryMinute + offsetMinutes;
  return baseMidnight.getTime() + totalMinutes * 60_000;
}

/**
 * Convert an absolute timestamp to a family-day minute offset.
 */
export function timestampMsToOffset(
  timestampMs: number,
  date: Date,
  scheduleSettings: SharedScheduleSettings,
): number {
  const zeroMs = offsetToTimestampMs(0, date, scheduleSettings);
  return (timestampMs - zeroMs) / 60_000;
}

/**
 * A chore's own time budget: its estimated duration, else one minute per XP of
 * weight. Null means the chore is untimed — the planner cannot pack it, and the
 * runner shows it without a ring.
 */
export function getCountdownDurationSecs(
  chore: Pick<CountdownChoreInput, 'estimatedDurationSecs' | 'weight'>,
): number | null {
  if (chore.estimatedDurationSecs != null && chore.estimatedDurationSecs > 0) {
    return chore.estimatedDurationSecs;
  }
  const weight = chore.weight;
  if (weight != null && weight > 0) {
    return weight * 60; // 1 XP = 1 minute
  }
  return null;
}

export function getCountdownAnchorChoreId(chore: Pick<CountdownChoreInput, 'timingConfig'>): string | null {
  if (
    chore.timingConfig &&
    typeof chore.timingConfig === 'object' &&
    'anchor' in chore.timingConfig
  ) {
    const anchor = (chore.timingConfig as Record<string, any>).anchor;
    if (anchor && typeof anchor === 'object' && 'sourceChoreId' in anchor) {
      return String(anchor.sourceChoreId || '') || null;
    }
  }
  return null;
}

/** The minimal chore shape the timing resolver reads, built from an engine input. */
export function toCountdownTimingChore(chore: CountdownChoreInput, date: Date): SharedChoreLike {
  return {
    id: chore.id,
    title: chore.title,
    startDate: date.toISOString().slice(0, 10),
    timingMode: chore.timingMode,
    timingConfig: chore.timingConfig,
    timeBucket: chore.timeBucket,
    sortOrder: chore.sortOrder,
    assignees: chore.assigneeIds.map((id) => ({ id })),
  };
}

/** Timing modes that carry a hard deadline the planner packs against. */
export const COUNTDOWN_DEADLINE_MODES = new Set<SharedTimingMode>([
  'before_time',
  'before_marker',
  'before_chore',
  'named_window',
  'between_times',
]);

const START_MODES = new Set<SharedTimingMode>([
  'after_time',
  'after_marker',
  'after_chore',
]);

// ---------------------------------------------------------------------------
// Step 1: Collect & resolve eligible chores
// ---------------------------------------------------------------------------

export function buildCountdownTimingContext(
  input: CountdownEngineInput,
): SharedChoreTimingContext {
  return {
    date: input.date,
    now: input.now,
    routineMarkerStatuses: input.routineMarkerStatuses,
    chores: input.allChoresRaw,
    scheduleSettings: input.scheduleSettings,
  };
}

function resolveChores(input: CountdownEngineInput): ResolvedCountdownChore[] {
  const context = buildCountdownTimingContext(input);
  const results: ResolvedCountdownChore[] = [];

  for (const chore of input.chores) {
    // Skip completed chores (all members done).
    if (chore.completedAt != null) continue;

    const durationSecs = getCountdownDurationSecs(chore);
    if (durationSecs == null || durationSecs <= 0) continue;

    const choreLike = toCountdownTimingChore(chore, input.date);

    const timingMode = getChoreTimingMode(choreLike);
    // An anytime chore has no deadline to pack against and no anchor to start
    // from, so the plan has no slot for it. The runner queues it all the same.
    if (timingMode === 'anytime') continue;

    const resolved = resolveChoreTimingForDate(choreLike, context);

    if (COUNTDOWN_DEADLINE_MODES.has(timingMode)) {
      const deadlineOffset = resolved.endOffset;
      if (deadlineOffset == null) continue;

      // For before_chore: resolve the chain to find the ultimate deadline.
      // The existing resolver already does this via buildResolvedWindow.
      results.push({
        input: chore,
        durationSecs,
        timingMode,
        deadlineOffset,
        startAnchorOffset: resolved.startOffset,
        scheduleType: 'deadline',
      });
    } else if (START_MODES.has(timingMode)) {
      const startAnchorOffset = resolved.startOffset;
      if (startAnchorOffset == null) continue;

      results.push({
        input: chore,
        durationSecs,
        timingMode,
        deadlineOffset: resolved.endOffset,
        startAnchorOffset,
        scheduleType: 'start',
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Step 2: Group by person
// ---------------------------------------------------------------------------

interface PerPersonChore {
  resolved: ResolvedCountdownChore;
  personId: string;
}

function groupByPerson(
  resolved: ResolvedCountdownChore[],
): Map<string, PerPersonChore[]> {
  const map = new Map<string, PerPersonChore[]>();

  for (const r of resolved) {
    for (const personId of r.input.assigneeIds) {
      const list = map.get(personId) ?? [];
      list.push({ resolved: r, personId });
      map.set(personId, list);
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Step 3: Pack deadline-driven chores (right-to-left)
// ---------------------------------------------------------------------------

interface PlacedSlot {
  choreId: string;
  choreTitle: string;
  personId: string;
  /** Effective start — shifted by the chain walk. */
  startMs: number;
  /** Effective end — shifted by the chain walk. */
  endMs: number;
  /** Static planned start, unchanged by the chain walk. */
  targetStartMs: number;
  /** Static planned end, unchanged by the chain walk. */
  targetEndMs: number;
  durationSecs: number;
  isJoint: boolean;
  jointParticipantIds: string[];
  deadlineOffset: number | null;
  scheduleType: 'deadline' | 'start';
  /** Original sortOrder for tie-breaking. */
  sortOrder: number;
  /** For after_chore slots: the chore ID this slot is anchored to. */
  anchorChoreId: string | null;
}

function packDeadlineDriven(
  chores: PerPersonChore[],
  personId: string,
  input: CountdownEngineInput,
): PlacedSlot[] {
  const deadlineChores = chores
    .filter((c) => c.resolved.scheduleType === 'deadline')
    .map((c) => c.resolved);

  if (deadlineChores.length === 0) return [];

  // Sort by deadline ASC, then sortOrder DESC (higher sortOrder = closer to deadline).
  // We process in this order, placing each chore just before the previous one,
  // so the first chore processed lands closest to the deadline.
  deadlineChores.sort((a, b) => {
    const da = a.deadlineOffset ?? Infinity;
    const db = b.deadlineOffset ?? Infinity;
    if (da !== db) return da - db;
    const sa = a.input.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const sb = b.input.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (sa !== sb) return sb - sa; // DESC: higher sortOrder first
    return (b.input.title || '').localeCompare(a.input.title || '');
  });

  const bufferSecs = input.countdownSettings.stackBufferSecs;
  const slots: PlacedSlot[] = [];

  // Process each chore and pack it right-to-left.
  // The array is sorted deadline ASC, sortOrder DESC. For each chore:
  // - Its end time is the minimum of its deadline and the start of
  //   any already-placed slot that it must precede.
  for (const chore of deadlineChores) {
    const deadlineMs = offsetToTimestampMs(
      chore.deadlineOffset!,
      input.date,
      input.scheduleSettings,
    );

    // Start at the chore's deadline, then check if any existing slot
    // overlaps with the proposed placement. Only push earlier when
    // there is an actual temporal overlap — chores with later deadlines
    // should NOT be forced before earlier-deadline chores that occupy a
    // completely separate time range.
    let endMs = deadlineMs;
    let adjusted = true;
    while (adjusted) {
      adjusted = false;
      const proposedStart = endMs - chore.durationSecs * 1000;
      for (const existing of slots) {
        if (existing.startMs < endMs && existing.endMs > proposedStart) {
          endMs = existing.startMs - bufferSecs * 1000;
          adjusted = true;
          break;
        }
      }
    }

    const startMs = endMs - chore.durationSecs * 1000;

    slots.push({
      choreId: chore.input.id,
      choreTitle: chore.input.title,
      personId,
      startMs,
      endMs,
      targetStartMs: startMs,
      targetEndMs: endMs,
      durationSecs: chore.durationSecs,
      isJoint: chore.input.isJoint,
      jointParticipantIds: chore.input.isJoint ? chore.input.assigneeIds : [],
      deadlineOffset: chore.deadlineOffset,
      scheduleType: 'deadline',
      sortOrder: chore.input.sortOrder ?? Number.MAX_SAFE_INTEGER,
      anchorChoreId: getCountdownAnchorChoreId(chore.input),
    });
  }

  // Sort by start time for consistent output.
  slots.sort((a, b) => a.startMs - b.startMs);

  return slots;
}

// ---------------------------------------------------------------------------
// Step 4: Pack start-driven chores (left-to-right)
// ---------------------------------------------------------------------------

function getAfterDelay(
  chore: ResolvedCountdownChore,
  input: CountdownEngineInput,
): number {
  // Check for per-marker override (settings override > preset afterDelaySecs > global default).
  if (
    (chore.timingMode === 'after_marker') &&
    chore.input.timingConfig &&
    typeof chore.input.timingConfig === 'object'
  ) {
    const config = chore.input.timingConfig as Record<string, any>;
    const anchor = config.anchor;
    if (anchor && typeof anchor === 'object' && 'routineKey' in anchor) {
      const markerKey = String(anchor.routineKey || '');
      // Highest priority: explicit per-marker override in countdown settings.
      const override = input.countdownSettings.perMarkerAfterDelaySecs?.[markerKey];
      if (override != null) return override;
      // Next: afterDelaySecs on the marker preset itself.
      const preset = getRoutineMarkerPreset(markerKey, input.scheduleSettings);
      if (preset?.afterDelaySecs != null) return preset.afterDelaySecs;
    }
  }
  return input.countdownSettings.afterAnchorDefaultDelaySecs;
}

function packStartDriven(
  chores: PerPersonChore[],
  personId: string,
  input: CountdownEngineInput,
): PlacedSlot[] {
  const startChores = chores
    .filter((c) => c.resolved.scheduleType === 'start')
    .map((c) => c.resolved);

  if (startChores.length === 0) return [];

  // Sort by start anchor ASC, then sortOrder ASC, then title.
  startChores.sort((a, b) => {
    const sa = a.startAnchorOffset ?? -Infinity;
    const sb = b.startAnchorOffset ?? -Infinity;
    if (sa !== sb) return sa - sb;
    const oa = a.input.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const ob = b.input.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (oa !== ob) return oa - ob;
    return (a.input.title || '').localeCompare(b.input.title || '');
  });

  const bufferSecs = input.countdownSettings.stackBufferSecs;
  const slots: PlacedSlot[] = [];

  const choreInputMap = new Map(input.chores.map((c) => [c.id, c]));

  for (const chore of startChores) {
    const afterDelay = getAfterDelay(chore, input);

    // For after_chore slots, use the anchor chore's completion timestamp
    // with second precision instead of the minute-truncated offset from the
    // timing resolver. This prevents the afterDelay from appearing shortened
    // due to seconds being dropped.
    let anchorMs: number;
    const anchorChoreId = getCountdownAnchorChoreId(chore.input);
    const anchorChoreCompletion = anchorChoreId
      ? choreInputMap.get(anchorChoreId)?.memberCompletions[personId]
      : null;
    if (anchorChoreCompletion && chore.timingMode === 'after_chore') {
      anchorMs = new Date(anchorChoreCompletion).getTime();
    } else {
      anchorMs = offsetToTimestampMs(
        chore.startAnchorOffset!,
        input.date,
        input.scheduleSettings,
      );
    }

    let targetStart = anchorMs + afterDelay * 1000;

    // Check if we collide with already-placed start-driven slots.
    // Skip the anchor chore when the placement is completion-based — the
    // after_chore slot is explicitly tied to the anchor's completion time,
    // not to the anchor's remaining slot window.
    for (const existing of slots) {
      if (anchorChoreCompletion && existing.choreId === anchorChoreId) continue;
      if (targetStart < existing.targetEndMs + bufferSecs * 1000) {
        targetStart = existing.targetEndMs + bufferSecs * 1000;
      }
    }

    const targetEnd = targetStart + chore.durationSecs * 1000;
    // Effective start/end are equal to target at this stage — the chain-shift
    // pass runs later and may move them based on completions.
    const startMs = targetStart;
    const endMs = targetEnd;

    slots.push({
      choreId: chore.input.id,
      choreTitle: chore.input.title,
      personId,
      startMs,
      endMs,
      targetStartMs: targetStart,
      targetEndMs: targetEnd,
      durationSecs: chore.durationSecs,
      isJoint: chore.input.isJoint,
      jointParticipantIds: chore.input.isJoint ? chore.input.assigneeIds : [],
      deadlineOffset: chore.deadlineOffset,
      scheduleType: 'start',
      sortOrder: chore.input.sortOrder ?? Number.MAX_SAFE_INTEGER,
      anchorChoreId: getCountdownAnchorChoreId(chore.input),
    });
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Step 5: Joint chore constraint propagation
// ---------------------------------------------------------------------------

function propagateJointConstraints(
  allTimelines: Map<string, PlacedSlot[]>,
  bufferSecs: number,
): void {
  const MAX_ITERATIONS = 10;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let changed = false;

    // Collect all joint chore IDs.
    const jointChoreIds = new Set<string>();
    for (const slots of Array.from(allTimelines.values())) {
      for (const slot of slots) {
        if (slot.isJoint) jointChoreIds.add(slot.choreId);
      }
    }

    for (const choreId of Array.from(jointChoreIds)) {
      // Find the earliest required start across all participants.
      let earliestStart = Infinity;
      const participantSlots: Array<{ personId: string; slot: PlacedSlot; index: number }> = [];

      for (const [personId, slots] of Array.from(allTimelines)) {
        for (let i = 0; i < slots.length; i++) {
          if (slots[i].choreId === choreId) {
            participantSlots.push({ personId, slot: slots[i], index: i });
            earliestStart = Math.min(earliestStart, slots[i].startMs);
          }
        }
      }

      if (participantSlots.length <= 1) continue;

      // Force all participants to the earliest start.
      for (const { personId, slot, index } of participantSlots) {
        if (slot.startMs !== earliestStart) {
          const slots = allTimelines.get(personId)!;
          const newEnd = earliestStart + slot.durationSecs * 1000;
          slots[index] = {
            ...slot,
            startMs: earliestStart,
            endMs: newEnd,
            targetStartMs: earliestStart,
            targetEndMs: newEnd,
          };

          // Push preceding slots earlier by the same delta.
          for (let i = index - 1; i >= 0; i--) {
            const prev = slots[i];
            const requiredEnd = slots[i + 1].startMs - bufferSecs * 1000;
            if (prev.endMs > requiredEnd) {
              const newPrevStart = requiredEnd - prev.durationSecs * 1000;
              slots[i] = {
                ...prev,
                endMs: requiredEnd,
                startMs: newPrevStart,
                targetStartMs: newPrevStart,
                targetEndMs: requiredEnd,
              };
              changed = true;
            }
          }

          changed = true;
        }
      }
    }

    if (!changed) break;
  }
}

// ---------------------------------------------------------------------------
// Step 6: Compute slot states
// ---------------------------------------------------------------------------

function computeSlotState(slot: PlacedSlot, nowMs: number): CountdownSlotState {
  if (nowMs < slot.startMs) return 'upcoming';
  if (nowMs >= slot.startMs && nowMs < slot.endMs) return 'active';
  // Past end time.
  return 'overdue_active';
}

// ---------------------------------------------------------------------------
// Step 7: Chain stacked completions
// ---------------------------------------------------------------------------

/**
 * Mutates each slot's effective `startMs` / `endMs` so that when a chore in a
 * stack is completed, the next stacked chore starts at `completionTime + buffer`.
 *
 * Two adjacent slots are "stacked" when either:
 *   - The earlier slot's targetEnd + buffer exactly equals the later slot's
 *     targetStart (placed tight by the deadline packer), OR
 *   - The later slot is an `after_chore` chore anchored to the earlier slot's
 *     chore (they form an explicit chain regardless of the afterDelay gap).
 *
 * The static planned times (`targetStartMs` / `targetEndMs`) are NOT modified
 * — they remain the reference point for the ahead/behind delta.
 */
function chainStackedCompletions(
  slots: PlacedSlot[],
  chores: CountdownChoreInput[],
  personId: string,
  bufferSecs: number,
): void {
  if (slots.length === 0) return;

  slots.sort((a, b) => a.targetStartMs - b.targetStartMs);

  const bufferMs = bufferSecs * 1000;
  const choreMap = new Map(chores.map((c) => [c.id, c]));

  for (let i = 0; i < slots.length - 1; i++) {
    const slot = slots[i];
    const next = slots[i + 1];
    const packerStacked = slot.targetEndMs + bufferMs === next.targetStartMs;
    const anchorStacked = next.anchorChoreId === slot.choreId;
    if (!packerStacked && !anchorStacked) continue;

    // Shift the next slot only if the completion happened during or after
    // this slot's countdown. If the chore was completed before its countdown
    // started (e.g. marked done from the chores list), the normal afterDelay
    // placement already accounts for the completion timestamp, so it is not
    // overridden with a buffer-only chain.
    const completionStr = choreMap.get(slot.choreId)?.memberCompletions[personId];
    if (!completionStr) continue;
    const completionMs = new Date(completionStr).getTime();
    if (completionMs >= slot.startMs) {
      next.startMs = completionMs + bufferMs;
      next.endMs = next.startMs + next.durationSecs * 1000;
    }
  }
}

// ---------------------------------------------------------------------------
// Step 8: Generate warnings
// ---------------------------------------------------------------------------

function generateWarnings(
  slots: PlacedSlot[],
  personId: string,
  nowMs: number,
  date: Date,
  scheduleSettings: SharedScheduleSettings,
): CountdownWarning[] {
  const warnings: CountdownWarning[] = [];

  // Check if any slot starts before the day boundary (offset < 0).
  const dayStartMs = offsetToTimestampMs(0, date, scheduleSettings);
  for (const slot of slots) {
    if (slot.startMs < dayStartMs) {
      warnings.push({
        personId,
        message: `"${slot.choreTitle}" is scheduled to start before the family day begins. There may not be enough time for all chores.`,
        severity: 'warning',
      });
      break; // One warning per person is enough.
    }
  }

  // Check if any upcoming slot starts in the past.
  const overdueSlotsStartingInPast = slots.filter(
    (s) => s.startMs < nowMs && s.endMs > nowMs,
  );
  // This is expected (active state), not a warning.

  // Check if total duration exceeds window for deadline groups.
  // (We detect this by a slot being pushed before day boundary — handled above.)

  return warnings;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function computeCountdownTimelines(
  input: CountdownEngineInput,
): CountdownEngineOutput {
  const nowMs = input.now.getTime();
  const resolved = resolveChores(input);
  const byPerson = groupByPerson(resolved);
  const bufferSecs = input.countdownSettings.stackBufferSecs;

  const allTimelines = new Map<string, PlacedSlot[]>();

  // Phase 1: Pack each person's timeline independently. Deadline-driven and
  // start-driven slots may overlap; the plan reports where things were meant
  // to be, and the runner turns an overlap into a forecast.
  for (const [personId, personChores] of Array.from(byPerson)) {
    const placedSlots = [
      ...packDeadlineDriven(personChores, personId, input),
      ...packStartDriven(personChores, personId, input),
    ];
    placedSlots.sort((a, b) => a.startMs - b.startMs);
    allTimelines.set(personId, placedSlots);
  }

  // Phase 2: Propagate joint constraints across all people.
  propagateJointConstraints(allTimelines, bufferSecs);

  // Phase 3: Build output.
  const output: CountdownEngineOutput = { timelines: {} };

  for (const [personId, placedSlots] of Array.from(allTimelines)) {
    // Chain stacked completions forward. Leaves targetStartMs/targetEndMs untouched.
    chainStackedCompletions(placedSlots, input.chores, personId, bufferSecs);

    const slots: CountdownSlot[] = placedSlots.map((ps) => ({
      choreId: ps.choreId,
      choreTitle: ps.choreTitle,
      personId: ps.personId,
      countdownStartMs: ps.startMs,
      countdownEndMs: ps.endMs,
      targetStartMs: ps.targetStartMs,
      targetEndMs: ps.targetEndMs,
      durationSecs: ps.durationSecs,
      state: computeSlotState(ps, nowMs),
      isJoint: ps.isJoint,
      jointParticipantIds: ps.jointParticipantIds,
      deadlineOffset: ps.deadlineOffset,
      scheduleType: ps.scheduleType,
    }));

    // Mark completed slots.
    const choreInputMap = new Map(input.chores.map((c) => [c.id, c]));
    for (const slot of slots) {
      const chore = choreInputMap.get(slot.choreId);
      if (chore?.memberCompletions[personId]) {
        slot.state = 'completed';
      }
    }

    const warnings = generateWarnings(
      placedSlots,
      personId,
      nowMs,
      input.date,
      input.scheduleSettings,
    );

    const timeline: PersonCountdownTimeline = {
      personId,
      slots,
      warnings,
    };

    output.timelines[personId] = timeline;
  }

  return output;
}
