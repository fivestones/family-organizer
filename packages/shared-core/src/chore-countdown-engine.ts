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
  CountdownCollision,
  CountdownWarning,
  PersonCountdownTimeline,
  ResolvedCountdownChore,
  CollisionDecision,
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

function getEffectiveDurationSecs(chore: CountdownChoreInput): number | null {
  if (chore.estimatedDurationSecs != null && chore.estimatedDurationSecs > 0) {
    return chore.estimatedDurationSecs;
  }
  const weight = chore.weight;
  if (weight != null && weight > 0) {
    return weight * 60; // 1 XP = 1 minute
  }
  return null;
}

const DEADLINE_MODES = new Set<SharedTimingMode>([
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

function buildTimingContext(
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
  const context = buildTimingContext(input);
  const results: ResolvedCountdownChore[] = [];

  for (const chore of input.chores) {
    // Skip completed chores (all members done).
    if (chore.completedAt != null) continue;

    const durationSecs = getEffectiveDurationSecs(chore);
    if (durationSecs == null || durationSecs <= 0) continue;

    // Build a minimal SharedChoreLike for the timing resolver.
    const choreLike: SharedChoreLike = {
      id: chore.id,
      title: chore.title,
      startDate: input.date.toISOString().slice(0, 10),
      timingMode: chore.timingMode,
      timingConfig: chore.timingConfig,
      timeBucket: chore.timeBucket,
      sortOrder: chore.sortOrder,
      assignees: chore.assigneeIds.map((id) => ({ id })),
    };

    const timingMode = getChoreTimingMode(choreLike);
    if (timingMode === 'anytime') {
      // Anytime chores only participate if manually started.
      if (input.manualStarts?.[chore.id]) {
        results.push({
          input: chore,
          durationSecs,
          timingMode,
          deadlineOffset: null,
          startAnchorOffset: null,
          scheduleType: 'start',
        });
      }
      continue;
    }

    const resolved = resolveChoreTimingForDate(choreLike, context);

    if (DEADLINE_MODES.has(timingMode)) {
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
  startMs: number;
  endMs: number;
  durationSecs: number;
  isJoint: boolean;
  jointParticipantIds: string[];
  deadlineOffset: number | null;
  scheduleType: 'deadline' | 'start' | 'manual';
  isResume: boolean;
  /** Original sortOrder for tie-breaking. */
  sortOrder: number;
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
    // forces us earlier (because we need to finish before it starts).
    let endMs = deadlineMs;
    for (const existing of slots) {
      if (existing.startMs < endMs) {
        endMs = Math.min(endMs, existing.startMs - bufferSecs * 1000);
      }
    }

    const startMs = endMs - chore.durationSecs * 1000;

    slots.push({
      choreId: chore.input.id,
      choreTitle: chore.input.title,
      personId,
      startMs,
      endMs,
      durationSecs: chore.durationSecs,
      isJoint: chore.input.isJoint,
      jointParticipantIds: chore.input.isJoint ? chore.input.assigneeIds : [],
      deadlineOffset: chore.deadlineOffset,
      scheduleType: 'deadline',
      isResume: false,
      sortOrder: chore.input.sortOrder ?? Number.MAX_SAFE_INTEGER,
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

  for (const chore of startChores) {
    const afterDelay = chore.timingMode === 'anytime'
      ? 0
      : getAfterDelay(chore, input);
    const anchorMs = offsetToTimestampMs(
      chore.startAnchorOffset!,
      input.date,
      input.scheduleSettings,
    );

    let startMs = anchorMs + afterDelay * 1000;

    // Check if we collide with already-placed start-driven slots.
    for (const existing of slots) {
      if (startMs < existing.endMs + bufferSecs * 1000) {
        startMs = existing.endMs + bufferSecs * 1000;
      }
    }

    // For manually started chores, override start time.
    const manualStart = input.manualStarts?.[chore.input.id];
    if (manualStart) {
      startMs = new Date(manualStart).getTime();
    }

    const endMs = startMs + chore.durationSecs * 1000;

    slots.push({
      choreId: chore.input.id,
      choreTitle: chore.input.title,
      personId,
      startMs,
      endMs,
      durationSecs: chore.durationSecs,
      isJoint: chore.input.isJoint,
      jointParticipantIds: chore.input.isJoint ? chore.input.assigneeIds : [],
      deadlineOffset: chore.deadlineOffset,
      scheduleType: chore.timingMode === 'anytime' ? 'manual' : 'start',
      isResume: false,
      sortOrder: chore.input.sortOrder ?? Number.MAX_SAFE_INTEGER,
    });
  }

  return slots;
}

// ---------------------------------------------------------------------------
// Step 5: Detect collisions between start-driven and deadline-driven
// ---------------------------------------------------------------------------

function detectCollisions(
  deadlineSlots: PlacedSlot[],
  startSlots: PlacedSlot[],
  personId: string,
): CountdownCollision[] {
  const collisions: CountdownCollision[] = [];

  for (const ss of startSlots) {
    for (const ds of deadlineSlots) {
      // Check overlap.
      const overlapStart = Math.max(ss.startMs, ds.startMs);
      const overlapEnd = Math.min(ss.endMs, ds.endMs);
      if (overlapStart < overlapEnd) {
        collisions.push({
          startDrivenChoreId: ss.choreId,
          startDrivenChoreTitle: ss.choreTitle,
          deadlineDrivenChoreId: ds.choreId,
          deadlineDrivenChoreTitle: ds.choreTitle,
          personId,
          overlapStartMs: overlapStart,
          overlapEndMs: overlapEnd,
        });
      }
    }
  }

  return collisions;
}

// ---------------------------------------------------------------------------
// Step 6: Apply collision decisions
// ---------------------------------------------------------------------------

function applyCollisionDecisions(
  deadlineSlots: PlacedSlot[],
  startSlots: PlacedSlot[],
  collisions: CountdownCollision[],
  decisions: Record<string, CollisionDecision> | undefined,
  bufferSecs: number,
): { resolvedSlots: PlacedSlot[]; unresolvedCollisions: CountdownCollision[] } {
  if (!decisions || collisions.length === 0) {
    return {
      resolvedSlots: [...deadlineSlots, ...startSlots],
      unresolvedCollisions: collisions,
    };
  }

  const resolved: PlacedSlot[] = [...deadlineSlots];
  const unresolvedCollisions: CountdownCollision[] = [];

  for (const ss of startSlots) {
    const collision = collisions.find(
      (c) => c.startDrivenChoreId === ss.choreId,
    );
    if (!collision) {
      resolved.push(ss);
      continue;
    }

    const decisionKey = `${collision.startDrivenChoreId}:${collision.deadlineDrivenChoreId}`;
    const decision = decisions[decisionKey];

    if (!decision) {
      resolved.push(ss);
      unresolvedCollisions.push(collision);
      continue;
    }

    if (decision === 'deadline_driven_first') {
      // Push the start-driven chore to after the deadline-driven chore.
      const ds = deadlineSlots.find(
        (d) => d.choreId === collision.deadlineDrivenChoreId,
      );
      if (ds) {
        const newStart = ds.endMs + bufferSecs * 1000;
        resolved.push({
          ...ss,
          startMs: newStart,
          endMs: newStart + ss.durationSecs * 1000,
        });
      } else {
        resolved.push(ss);
      }
    } else {
      // 'start_driven_first': split start-driven chore around the deadline-driven.
      const ds = deadlineSlots.find(
        (d) => d.choreId === collision.deadlineDrivenChoreId,
      );
      if (ds) {
        const firstPartEnd = ds.startMs - bufferSecs * 1000;
        const firstPartDuration = Math.max(0, (firstPartEnd - ss.startMs) / 1000);
        const remainingDuration = ss.durationSecs - firstPartDuration;

        if (firstPartDuration > 0) {
          resolved.push({
            ...ss,
            endMs: firstPartEnd,
            durationSecs: firstPartDuration,
            isResume: false,
          });
        }

        if (remainingDuration > 0) {
          const resumeStart = ds.endMs + bufferSecs * 1000;
          resolved.push({
            ...ss,
            startMs: resumeStart,
            endMs: resumeStart + remainingDuration * 1000,
            durationSecs: remainingDuration,
            isResume: true,
          });
        }
      } else {
        resolved.push(ss);
      }
    }
  }

  return { resolvedSlots: resolved, unresolvedCollisions };
}

// ---------------------------------------------------------------------------
// Step 7: Joint chore constraint propagation
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
          if (slots[i].choreId === choreId && !slots[i].isResume) {
            participantSlots.push({ personId, slot: slots[i], index: i });
            earliestStart = Math.min(earliestStart, slots[i].startMs);
          }
        }
      }

      if (participantSlots.length <= 1) continue;

      // Force all participants to the earliest start.
      for (const { personId, slot, index } of participantSlots) {
        if (slot.startMs !== earliestStart) {
          const delta = slot.startMs - earliestStart;
          const slots = allTimelines.get(personId)!;
          slots[index] = {
            ...slot,
            startMs: earliestStart,
            endMs: earliestStart + slot.durationSecs * 1000,
          };

          // Push preceding slots earlier by the same delta.
          for (let i = index - 1; i >= 0; i--) {
            const prev = slots[i];
            const requiredEnd = slots[i + 1].startMs - bufferSecs * 1000;
            if (prev.endMs > requiredEnd) {
              slots[i] = {
                ...prev,
                endMs: requiredEnd,
                startMs: requiredEnd - prev.durationSecs * 1000,
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
// Step 8: Compute slot states
// ---------------------------------------------------------------------------

function computeSlotState(
  slot: PlacedSlot,
  nowMs: number,
  hasUnresolvedCollision: boolean,
): CountdownSlotState {
  if (hasUnresolvedCollision) return 'waiting_decision';
  if (nowMs < slot.startMs) return 'upcoming';
  if (nowMs >= slot.startMs && nowMs < slot.endMs) return 'active';
  // Past end time.
  return 'overdue_active';
}

// ---------------------------------------------------------------------------
// Step 9: Compute ahead-of-schedule
// ---------------------------------------------------------------------------

function computeAheadBy(
  slots: PlacedSlot[],
  chores: CountdownChoreInput[],
  nowMs: number,
): number {
  let aheadMs = 0;
  const choreMap = new Map(chores.map((c) => [c.id, c]));

  for (const slot of slots) {
    const chore = choreMap.get(slot.choreId);
    if (!chore) continue;

    const memberCompletion = chore.memberCompletions[slot.personId];
    if (!memberCompletion) continue;

    const completedAtMs = new Date(memberCompletion).getTime();
    if (completedAtMs < slot.endMs) {
      // Completed before the slot end — they saved time.
      aheadMs += slot.endMs - completedAtMs;
    }
  }

  return Math.max(0, Math.round(aheadMs / 1000));
}

// ---------------------------------------------------------------------------
// Step 10: Generate warnings
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
  const allCollisions = new Map<string, CountdownCollision[]>();
  const allUnresolvedCollisions = new Map<string, CountdownCollision[]>();

  // Phase 1: Pack each person's timeline independently.
  for (const [personId, personChores] of Array.from(byPerson)) {
    const deadlineSlots = packDeadlineDriven(personChores, personId, input);
    const startSlots = packStartDriven(personChores, personId, input);

    const collisions = detectCollisions(deadlineSlots, startSlots, personId);
    allCollisions.set(personId, collisions);

    const { resolvedSlots, unresolvedCollisions } = applyCollisionDecisions(
      deadlineSlots,
      startSlots,
      collisions,
      input.collisionDecisions,
      bufferSecs,
    );

    allUnresolvedCollisions.set(personId, unresolvedCollisions);

    // Sort by start time.
    resolvedSlots.sort((a, b) => a.startMs - b.startMs);
    allTimelines.set(personId, resolvedSlots);
  }

  // Phase 2: Propagate joint constraints across all people.
  propagateJointConstraints(allTimelines, bufferSecs);

  // Phase 3: Build output.
  const output: CountdownEngineOutput = { timelines: {} };

  for (const [personId, placedSlots] of Array.from(allTimelines)) {
    const unresolvedCollisionChoreIds = new Set(
      (allUnresolvedCollisions.get(personId) ?? []).map(
        (c) => c.startDrivenChoreId,
      ),
    );

    const slots: CountdownSlot[] = placedSlots.map((ps) => ({
      choreId: ps.choreId,
      choreTitle: ps.choreTitle,
      personId: ps.personId,
      countdownStartMs: ps.startMs,
      countdownEndMs: ps.endMs,
      durationSecs: ps.durationSecs,
      state: computeSlotState(
        ps,
        nowMs,
        unresolvedCollisionChoreIds.has(ps.choreId),
      ),
      isJoint: ps.isJoint,
      jointParticipantIds: ps.jointParticipantIds,
      isResume: ps.isResume,
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

    const aheadBySeconds = computeAheadBy(
      placedSlots,
      input.chores,
      nowMs,
    );

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
      aheadBySeconds,
      collisions: allUnresolvedCollisions.get(personId) ?? [],
      warnings,
    };

    output.timelines[personId] = timeline;
  }

  return output;
}
