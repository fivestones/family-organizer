import { v5 as uuidv5 } from 'uuid';
import {
  formatDateKeyUTC,
  getAssignedMembersForChoreOnDate,
  type SharedChoreLike,
} from './chores';
import {
  getChoreTimingMode,
  sortChoresForDisplay,
  type SharedTimingMode,
} from './chore-timing';
import {
  COUNTDOWN_DEADLINE_MODES,
  buildCountdownTimingContext,
  computeCountdownTimelines,
  getCountdownAnchorChoreId,
  getCountdownDurationSecs,
  offsetToTimestampMs,
  toCountdownTimingChore,
} from './chore-countdown-engine';
import type {
  CountdownChoreInput,
  CountdownEngineInput,
  CountdownEngineOutput,
  CountdownSettings,
} from './chore-countdown-types';

// ---------------------------------------------------------------------------
// The countdown has two clocks.
//
// The planner (chore-countdown-engine.ts) packs chores as late as their
// deadlines allow. It answers "where did I need to be by now?".
//
// The runner (this file) drives the ring. A step's timer is
// `stepStartedAt + durationSecs`, and nothing about it depends on the
// wall-clock schedule: start a 2pm chore at 10am and it still gets its own
// twelve minutes. The planner's slots are only the yardstick the runner is
// measured against.
// ---------------------------------------------------------------------------

const COUNTDOWN_RUN_NAMESPACE = '2f0c1d5e-7a64-4f0b-9d3c-5b8e61a4c7d2';

/** Timing modes whose resolved start is a floor the runner must not cross. */
const GATED_MODES = new Set<SharedTimingMode>([
  'after_time',
  'after_marker',
  'after_chore',
  'between_times',
  'named_window',
]);

// ---------------------------------------------------------------------------
// The run record
// ---------------------------------------------------------------------------

export type CountdownRunStatus = 'running' | 'stopped';

/**
 * Why a run ended. `finished` is the queue running out of steps that can be
 * done now; the other three stop a run that still had a live step.
 */
export type CountdownRunStoppedReason = 'user' | 'timeout' | 'day_boundary' | 'finished';

/** A `countdownRuns` row: one per member per family day. */
export interface CountdownRunLike {
  id?: string | null;
  familyMemberId: string;
  /** Family-day key, YYYY-MM-DD. */
  date: string;
  /** Null for the day's ad-hoc queue. */
  routineId?: string | null;
  status?: string | null;
  /** The live step. Kept on a stopped run so a parent can see where it ended. */
  currentChoreId?: string | null;
  /** ISO timestamp the ring counts from. */
  stepStartedAt?: string | null;
  stepExtensionSecs?: number | null;
  stepExtensionCount?: number | null;
  /** Steps a routine set to `advance` moved past without completing. */
  skippedChoreIds?: unknown;
  /** Any tap on any device — idleness belongs to the run, not the device. */
  lastInteractionAt?: string | null;
  startedAt?: string | null;
  stoppedAt?: string | null;
  stoppedReason?: string | null;
}

export type CountdownRunPatch = Partial<Omit<CountdownRunLike, 'id' | 'skippedChoreIds'>> & {
  skippedChoreIds?: string[];
};

/**
 * One row per member per family day, so the id is derived rather than random:
 * two devices starting the same run converge on one row instead of forking it.
 */
export function createCountdownRunId(familyMemberId: string, dateKey: string): string {
  const memberId = String(familyMemberId || '').trim();
  const date = String(dateKey || '').trim();
  if (!memberId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('A family member id and YYYY-MM-DD date are required for a countdown run');
  }
  return uuidv5(`${memberId}:${date}`, COUNTDOWN_RUN_NAMESPACE);
}

export function findCountdownRun<TRun extends CountdownRunLike>(
  runs: TRun[] | null | undefined,
  familyMemberId: string,
  dateKey: string,
): TRun | null {
  return (runs || []).find((run) => run.familyMemberId === familyMemberId && run.date === dateKey) ?? null;
}

export function isCountdownRunLive(run: CountdownRunLike | null | undefined): boolean {
  return run?.status === 'running' && !!run.currentChoreId;
}

/** A run still marked running on a family day that has ended. Any client may sweep it. */
export function isCountdownRunStale(run: CountdownRunLike | null | undefined, todayKey: string): boolean {
  return run?.status === 'running' && String(run.date || '') < todayKey;
}

function getSkippedChoreIds(run: CountdownRunLike | null | undefined): string[] {
  return Array.isArray(run?.skippedChoreIds) ? run.skippedChoreIds.map(String) : [];
}

function toMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

// ---------------------------------------------------------------------------
// Engine inputs
// ---------------------------------------------------------------------------

export interface CountdownChoreSource extends SharedChoreLike {
  estimatedDurationSecs?: number | null;
}

/**
 * Flatten the chores due on `date` into engine inputs. Every timing mode is
 * included — `anytime` and untimed chores are runnable steps even though the
 * planner cannot pack them.
 */
export function buildCountdownChoreInputs(
  chores: CountdownChoreSource[],
  date: Date,
  now: Date = new Date(),
): CountdownChoreInput[] {
  const dateKey = formatDateKeyUTC(date);
  const inputs: CountdownChoreInput[] = [];

  for (const chore of chores || []) {
    const assigned = getAssignedMembersForChoreOnDate(chore, date);
    if (assigned.length === 0) continue;

    const memberCompletions: Record<string, string> = {};
    for (const completion of chore.completions || []) {
      if (!completion?.completed || completion.dateDue !== dateKey) continue;
      const completedBy = Array.isArray(completion.completedBy) ? completion.completedBy[0] : completion.completedBy;
      if (completedBy?.id) {
        memberCompletions[completedBy.id] = completion.dateCompleted || now.toISOString();
      }
    }

    // A claimed up-for-grabs chore is off everyone else's plate for the day.
    const claimedBy = chore.isUpForGrabs ? Object.keys(memberCompletions) : [];
    const assigneeIds = claimedBy.length > 0 ? claimedBy : assigned.map((member) => member.id);

    inputs.push({
      id: chore.id,
      title: chore.title || '',
      estimatedDurationSecs: chore.estimatedDurationSecs ?? null,
      weight: chore.weight ?? null,
      sortOrder: chore.sortOrder ?? null,
      isJoint: chore.isJoint ?? false,
      assigneeIds,
      timingMode: chore.timingMode || 'anytime',
      timingConfig: chore.timingConfig || null,
      timeBucket: chore.timeBucket || null,
      completedAt: null,
      memberCompletions,
    });
  }

  return inputs;
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

export interface RunnerStep {
  choreId: string;
  title: string;
  personId: string;
  timingMode: SharedTimingMode;
  /** The step's own budget. Null is an untimed step: no ring, advance on tap. */
  durationSecs: number | null;
  /**
   * The earliest-allowed gate, as an absolute timestamp. Null means the step
   * waits on `waitingOnChoreId` and has no fallback time.
   */
  earliestStartMs: number | null;
  /** The chore this step follows, while that chore is still undone today. */
  waitingOnChoreId: string | null;
  waitingOnTitle: string | null;
  /** Hard deadline for deadline-driven timing modes, else null. */
  deadlineMs: number | null;
  /** The planner's latest-possible slot for this step, when it packed one. */
  plannedStartMs: number | null;
  plannedEndMs: number | null;
  /** When this person finished the step today, else null. */
  completedAtMs: number | null;
  isJoint: boolean;
}

export interface RunnerQueueOptions {
  personId: string;
  /**
   * A routine's step order. When given, only these chores are queued, in this
   * order, and the order supersedes `after_chore` chaining between them.
   */
  orderedChoreIds?: string[] | null;
  /**
   * Chores to leave out of the day's ad-hoc queue: routine steps folded into
   * their routine, which are run from the routine instead.
   */
  excludeChoreIds?: Iterable<string> | null;
  /** A plan already computed from the same input, to avoid packing twice. */
  plan?: CountdownEngineOutput | null;
}

/**
 * Everything on one person's plate for the day, in the order the runner works
 * through it. The ad-hoc day queue follows the day list's own order (late, then
 * now, then upcoming), so the countdown never disagrees with the list beside it.
 */
export function buildRunnerQueue(input: CountdownEngineInput, options: RunnerQueueOptions): RunnerStep[] {
  const { personId } = options;
  const routineOrder = options.orderedChoreIds ? options.orderedChoreIds.map(String) : null;
  const routineChoreIds = new Set(routineOrder ?? []);
  const excludedChoreIds = new Set(routineOrder ? [] : Array.from(options.excludeChoreIds ?? []));
  const todaysChoresById = new Map(input.chores.map((chore) => [chore.id, chore]));

  const mine = input.chores.filter(
    (chore) =>
      chore.assigneeIds.includes(personId) &&
      (!routineOrder || routineChoreIds.has(chore.id)) &&
      !excludedChoreIds.has(chore.id),
  );
  if (mine.length === 0) return [];

  const plan = options.plan ?? computeCountdownTimelines(input);
  const plannedSlots = new Map(
    (plan.timelines[personId]?.slots ?? []).filter((slot) => !slot.isResume).map((slot) => [slot.choreId, slot]),
  );

  const context = buildCountdownTimingContext(input);
  const inputsById = new Map(mine.map((chore) => [chore.id, chore]));
  const dayStartMs = offsetToTimestampMs(0, input.date, input.scheduleSettings);
  const toTimestamp = (offset: number | null) =>
    offset == null ? null : offsetToTimestampMs(offset, input.date, input.scheduleSettings);

  const sorted = sortChoresForDisplay(
    mine.map((chore) => toCountdownTimingChore(chore, input.date)),
    context,
  );

  const steps = sorted.map(({ chore: timingChore, timing }): RunnerStep => {
    const chore = inputsById.get(timingChore.id)!;
    const timingMode = getChoreTimingMode(timingChore);
    const planned = plannedSlots.get(chore.id);

    let earliestStartMs: number | null = dayStartMs;
    let waitingOnChoreId: string | null = null;

    if (timingMode === 'after_chore') {
      const anchorId = getCountdownAnchorChoreId(chore);
      const anchor = anchorId ? todaysChoresById.get(anchorId) : undefined;
      const anchorIsDone = !!anchor && Object.keys(anchor.memberCompletions).length > 0;
      if (anchorId && routineChoreIds.has(anchorId)) {
        // Routine order already places this step after its anchor.
      } else if (anchor && !anchorIsDone) {
        waitingOnChoreId = anchor.id;
        earliestStartMs = toTimestamp(timing.startOffset);
      } else if (anchorIsDone) {
        earliestStartMs = toTimestamp(timing.startOffset) ?? dayStartMs;
      }
      // An anchor that is not due today can never be finished, so it gates nothing.
    } else if (GATED_MODES.has(timingMode)) {
      earliestStartMs = toTimestamp(timing.startOffset) ?? dayStartMs;
    }

    return {
      choreId: chore.id,
      title: chore.title,
      personId,
      timingMode,
      durationSecs: getCountdownDurationSecs(chore),
      earliestStartMs,
      waitingOnChoreId,
      waitingOnTitle: waitingOnChoreId ? todaysChoresById.get(waitingOnChoreId)?.title ?? null : null,
      deadlineMs: COUNTDOWN_DEADLINE_MODES.has(timingMode) ? toTimestamp(timing.endOffset) : null,
      plannedStartMs: planned?.targetStartMs ?? null,
      plannedEndMs: planned?.targetEndMs ?? null,
      completedAtMs: toMs(chore.memberCompletions[personId]),
      isJoint: chore.isJoint,
    };
  });

  if (!routineOrder) return steps;

  const position = new Map(routineOrder.map((choreId, index) => [choreId, index]));
  return steps.sort((left, right) => position.get(left.choreId)! - position.get(right.choreId)!);
}

export interface RunnerSelectionOptions {
  /** Chores to pass over: skipped steps, or the step being left. */
  excludeChoreIds?: Iterable<string>;
  /**
   * Chores finished in the same transaction as this selection. The queue was
   * built before that write landed, so they are treated as done here.
   */
  settledChoreIds?: Iterable<string>;
}

/** True while the step's earliest-allowed gate is still closed. */
export function isRunnerStepLocked(
  step: RunnerStep,
  nowMs: number,
  settledChoreIds?: Iterable<string>,
): boolean {
  if (step.waitingOnChoreId && settledChoreIds && new Set(settledChoreIds).has(step.waitingOnChoreId)) {
    return false;
  }
  return step.earliestStartMs == null || step.earliestStartMs > nowMs;
}

/**
 * The next step the runner may begin: the first unfinished step whose gate is
 * open. A gated step is passed over, not waited on, and because selection always
 * starts from the top it resurfaces on the first advance after it unlocks.
 */
export function selectNextRunnerStep(
  queue: RunnerStep[],
  nowMs: number,
  options: RunnerSelectionOptions = {},
): RunnerStep | null {
  const excluded = new Set(options.excludeChoreIds ?? []);
  const settled = new Set(options.settledChoreIds ?? []);
  return (
    queue.find(
      (step) =>
        step.completedAtMs == null &&
        !excluded.has(step.choreId) &&
        !settled.has(step.choreId) &&
        !isRunnerStepLocked(step, nowMs, settled),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// The runner clock
// ---------------------------------------------------------------------------

export type RunnerClockState = 'untimed' | 'starting' | 'running' | 'overrun';

export interface RunnerClock {
  state: RunnerClockState;
  startMs: number;
  /** `stepStartedAt + duration + extensions`. Null for an untimed step. */
  endMs: number | null;
  /** Positive while time remains, negative once the step is counting up. */
  remainingMs: number | null;
  /** How far past its budget the step is; 0 while within it. */
  overrunMs: number;
  /** 0 → 1 through the step's budget. */
  progress: number;
}

export function getRunnerClock(
  run: CountdownRunLike | null | undefined,
  step: RunnerStep | null | undefined,
  nowMs: number,
): RunnerClock | null {
  if (!run || !step || run.currentChoreId !== step.choreId) return null;
  const startMs = toMs(run.stepStartedAt);
  if (startMs == null) return null;

  if (step.durationSecs == null) {
    return { state: 'untimed', startMs, endMs: null, remainingMs: null, overrunMs: 0, progress: 0 };
  }

  const budgetMs = (step.durationSecs + Math.max(0, run.stepExtensionSecs ?? 0)) * 1000;
  const endMs = startMs + budgetMs;
  const remainingMs = endMs - Math.max(nowMs, startMs);
  const overrunMs = Math.max(0, nowMs - endMs);
  return {
    state: nowMs < startMs ? 'starting' : overrunMs > 0 ? 'overrun' : 'running',
    startMs,
    endMs,
    remainingMs: nowMs >= endMs ? endMs - nowMs : remainingMs,
    overrunMs,
    progress: budgetMs > 0 ? Math.max(0, Math.min(1, (nowMs - startMs) / budgetMs)) : 1,
  };
}

// ---------------------------------------------------------------------------
// Overrun and abandonment
// ---------------------------------------------------------------------------

export type RunnerOverrunPrompt = 'none' | 'still_working' | 'still_working_or_stop';

export interface RunnerOverrunStatus {
  prompt: RunnerOverrunPrompt;
  /** When the prompt became due; null while none is due. */
  promptSinceMs: number | null;
  /** The prompt went unanswered for the grace period: stop the run as `timeout`. */
  timedOut: boolean;
  /** A routine set to `advance` should move on — this step's time is up. */
  shouldAutoAdvance: boolean;
}

const NO_OVERRUN: RunnerOverrunStatus = {
  prompt: 'none',
  promptSinceMs: null,
  timedOut: false,
  shouldAutoAdvance: false,
};

/**
 * A step that hits zero counts up and waits; nothing is marked or skipped.
 * Telling a long chore from an abandoned one needs both halves of the test —
 * overdue *and* idle — because a slow chore is overdue but present, and a
 * long chore abandoned at minute one is idle but not overdue.
 */
export function getRunnerOverrunStatus(
  run: CountdownRunLike | null | undefined,
  step: RunnerStep | null | undefined,
  settings: CountdownSettings,
  nowMs: number,
  onStepOverrun: 'wait' | 'advance' | null = 'wait',
): RunnerOverrunStatus {
  const clock = getRunnerClock(run, step, nowMs);
  if (!run || !step || !clock || clock.endMs == null || clock.overrunMs <= 0) return NO_OVERRUN;
  if (onStepOverrun === 'advance') return { ...NO_OVERRUN, shouldAutoAdvance: true };

  const thresholdMs =
    Math.max(settings.overrunPromptMinSecs, settings.overrunPromptFraction * (step.durationSecs ?? 0)) * 1000;
  const lastInteractionMs = toMs(run.lastInteractionAt) ?? clock.startMs;
  const promptSinceMs = Math.max(clock.endMs, lastInteractionMs) + thresholdMs;
  if (nowMs < promptSinceMs) return NO_OVERRUN;

  return {
    prompt:
      (run.stepExtensionCount ?? 0) >= settings.overrunStopOfferAfterExtensions
        ? 'still_working_or_stop'
        : 'still_working',
    promptSinceMs,
    timedOut: nowMs >= promptSinceMs + settings.overrunPromptGraceSecs * 1000,
    shouldAutoAdvance: false,
  };
}

// ---------------------------------------------------------------------------
// Ahead/behind and the deadline forecast
// ---------------------------------------------------------------------------

export interface RunnerProjectionEntry {
  choreId: string;
  title: string;
  projectedStartMs: number;
  projectedEndMs: number;
  deadlineMs: number | null;
  /** `deadline − projected end` in seconds; negative means the deadline is missed. */
  marginSecs: number | null;
}

export interface RunnerStanding {
  /**
   * Seconds ahead (+) or behind (−) of the planner's latest-possible schedule,
   * measured on the first planned step the current pace reaches. Null when
   * nothing reachable is planned.
   */
  aheadSecs: number | null;
  /** Where the current pace puts every remaining step, in the order they would run. */
  projection: RunnerProjectionEntry[];
  /** The first hard deadline the current pace misses. */
  firstMiss: RunnerProjectionEntry | null;
  /** The hard deadline with the least room to spare. */
  tightest: RunnerProjectionEntry | null;
}

/**
 * Carry the current pace forward through the rest of the queue: the live step
 * to its (possibly overrun) end, then each remaining step in turn, waiting at
 * a gate when nothing else is open.
 */
export function computeRunnerStanding(
  queue: RunnerStep[],
  run: CountdownRunLike | null | undefined,
  settings: CountdownSettings,
  nowMs: number,
): RunnerStanding {
  const bufferMs = Math.max(0, settings.stackBufferSecs) * 1000;
  const skipped = new Set(getSkippedChoreIds(run));
  const liveStep = isCountdownRunLive(run) ? queue.find((step) => step.choreId === run!.currentChoreId) : undefined;
  const liveClock = getRunnerClock(run, liveStep, nowMs);

  const projection: RunnerProjectionEntry[] = [];
  let aheadSecs: number | null = null;
  let waitedAtGate = false;
  let cursorMs = nowMs;

  const project = (step: RunnerStep, startMs: number, endMs: number) => {
    projection.push({
      choreId: step.choreId,
      title: step.title,
      projectedStartMs: startMs,
      projectedEndMs: endMs,
      deadlineMs: step.deadlineMs,
      marginSecs: step.deadlineMs == null ? null : (step.deadlineMs - endMs) / 1000,
    });
    // Time spent waiting at a gate is not the runner's to win or lose, so only
    // steps reached without waiting count toward ahead/behind.
    if (aheadSecs == null && !waitedAtGate && step.plannedEndMs != null) {
      aheadSecs = (step.plannedEndMs - endMs) / 1000;
    }
    cursorMs = endMs;
  };

  if (liveStep && liveClock && liveStep.completedAtMs == null) {
    project(liveStep, liveClock.startMs, Math.max(nowMs, liveClock.endMs ?? nowMs));
  }

  const pending = queue.filter(
    (step) => step.completedAtMs == null && !skipped.has(step.choreId) && step.choreId !== liveStep?.choreId,
  );

  while (pending.length > 0) {
    const readyMs = projection.length > 0 ? cursorMs + bufferMs : cursorMs;
    let index = pending.findIndex((step) => step.earliestStartMs != null && step.earliestStartMs <= readyMs);
    let startMs = readyMs;

    if (index === -1) {
      // Nothing is open: wait for the gate that opens soonest.
      let soonestMs = Infinity;
      pending.forEach((step, candidate) => {
        if (step.earliestStartMs != null && step.earliestStartMs < soonestMs) {
          soonestMs = step.earliestStartMs;
          index = candidate;
        }
      });
      if (index === -1) break; // Only steps waiting on an unfinished chore remain.
      startMs = soonestMs;
      waitedAtGate = true;
    }

    const [step] = pending.splice(index, 1);
    project(step, startMs, startMs + (step.durationSecs ?? 0) * 1000);
  }

  const withDeadline = projection.filter((entry) => entry.marginSecs != null);
  return {
    aheadSecs,
    projection,
    firstMiss: withDeadline.find((entry) => entry.marginSecs! < 0) ?? null,
    tightest: withDeadline.reduce<RunnerProjectionEntry | null>(
      (tightest, entry) => (!tightest || entry.marginSecs! < tightest.marginSecs! ? entry : tightest),
      null,
    ),
  };
}

// ---------------------------------------------------------------------------
// The resolved state a countdown screen renders
// ---------------------------------------------------------------------------

export interface RunnerState {
  /** `running` while the run has a live step; otherwise `idle`. */
  phase: 'idle' | 'running';
  queue: RunnerStep[];
  totalCount: number;
  completedCount: number;
  /** Every step in the queue is finished. */
  allDone: boolean;
  liveStep: RunnerStep | null;
  clock: RunnerClock | null;
  /** Idle: the step Start would begin. Running: the step after the live one. */
  nextStep: RunnerStep | null;
  /** Unfinished steps whose gate is still closed. */
  lockedSteps: RunnerStep[];
  standing: RunnerStanding;
  overrun: RunnerOverrunStatus;
  /**
   * The live step was finished somewhere else (the day list, another device)
   * or is no longer in the queue. A client that may write the run should advance it.
   */
  needsAdvance: boolean;
}

export interface RunnerStateInput {
  queue: RunnerStep[];
  run: CountdownRunLike | null | undefined;
  settings: CountdownSettings;
  nowMs: number;
  /** The live routine's overrun policy. The ad-hoc day queue always waits. */
  onStepOverrun?: 'wait' | 'advance' | null;
}

export function resolveRunnerState(input: RunnerStateInput): RunnerState {
  const { queue, run, settings, nowMs } = input;
  const live = isCountdownRunLive(run);
  const liveStep = live ? queue.find((step) => step.choreId === run!.currentChoreId) ?? null : null;
  const skipped = getSkippedChoreIds(run);
  const completedCount = queue.filter((step) => step.completedAtMs != null).length;

  return {
    phase: live ? 'running' : 'idle',
    queue,
    totalCount: queue.length,
    completedCount,
    allDone: queue.length > 0 && completedCount === queue.length,
    liveStep,
    clock: getRunnerClock(run, liveStep, nowMs),
    nextStep: selectNextRunnerStep(queue, nowMs, {
      excludeChoreIds: live ? [...skipped, run!.currentChoreId!] : [],
    }),
    lockedSteps: queue.filter(
      (step) => step.completedAtMs == null && step.choreId !== liveStep?.choreId && isRunnerStepLocked(step, nowMs),
    ),
    standing: computeRunnerStanding(queue, run, settings, nowMs),
    overrun: getRunnerOverrunStatus(run, liveStep, settings, nowMs, input.onStepOverrun ?? 'wait'),
    needsAdvance: live && (!liveStep || liveStep.completedAtMs != null),
  };
}

// ---------------------------------------------------------------------------
// Transitions — each returns the patch to write to the run row
// ---------------------------------------------------------------------------

function buildStepPatch(step: RunnerStep, stepStartedAt: string, nowIso: string): CountdownRunPatch {
  return {
    currentChoreId: step.choreId,
    stepStartedAt,
    stepExtensionSecs: 0,
    stepExtensionCount: 0,
    lastInteractionAt: nowIso,
  };
}

export interface RunStartInput {
  familyMemberId: string;
  date: string;
  routineId?: string | null;
  step: RunnerStep;
  nowMs: number;
  /** The member's row for today, when one already exists. */
  existingRun?: CountdownRunLike | null;
}

/**
 * Begin a run on `step`. The row's identity fields are written only when the
 * row is created, so restarting a run later the same day never touches them.
 */
export function buildRunStartPatch(input: RunStartInput): CountdownRunPatch {
  const nowIso = new Date(input.nowMs).toISOString();
  return {
    ...(input.existingRun ? {} : { familyMemberId: input.familyMemberId, date: input.date }),
    routineId: input.routineId ?? null,
    status: 'running',
    ...buildStepPatch(input.step, nowIso, nowIso),
    skippedChoreIds: [],
    startedAt: nowIso,
    stoppedAt: null,
    stoppedReason: null,
  };
}

/**
 * Stopping reverts the rest of the queue to its scheduled times and writes no
 * completion. An automatic stop means exactly what a manual one does; only the
 * reason differs.
 */
export function buildRunStopPatch(reason: CountdownRunStoppedReason, nowMs: number): CountdownRunPatch {
  return {
    status: 'stopped',
    stoppedAt: new Date(nowMs).toISOString(),
    stoppedReason: reason,
  };
}

export interface RunAdvanceOptions extends RunnerSelectionOptions {
  /** Leave the live step undone and move on (a routine set to `advance`). */
  skipCurrent?: boolean;
  /** Seconds before the next step's timer starts — the pause that celebrates the last one. */
  startDelaySecs?: number;
}

/** Move to the next open step, or finish the run when none is left. */
export function buildRunAdvancePatch(
  run: CountdownRunLike,
  queue: RunnerStep[],
  nowMs: number,
  options: RunAdvanceOptions = {},
): CountdownRunPatch {
  const skipped = getSkippedChoreIds(run);
  if (options.skipCurrent && run.currentChoreId && !skipped.includes(run.currentChoreId)) {
    skipped.push(run.currentChoreId);
  }

  const next = selectNextRunnerStep(queue, nowMs, {
    excludeChoreIds: [
      ...skipped,
      ...Array.from(options.excludeChoreIds ?? []),
      ...(run.currentChoreId ? [run.currentChoreId] : []),
    ],
    settledChoreIds: options.settledChoreIds,
  });
  const skippedPatch = options.skipCurrent ? { skippedChoreIds: skipped } : {};

  if (!next) return { ...buildRunStopPatch('finished', nowMs), ...skippedPatch };

  const startsAt = new Date(nowMs + Math.max(0, options.startDelaySecs ?? 0) * 1000).toISOString();
  return { ...buildStepPatch(next, startsAt, new Date(nowMs).toISOString()), ...skippedPatch };
}

/**
 * Grant the live step more time. An overrun step is given the full extension
 * from now, so pressing "+5 min" always leaves five minutes on the ring.
 */
export function buildRunExtendPatch(
  run: CountdownRunLike,
  step: RunnerStep,
  settings: CountdownSettings,
  nowMs: number,
): CountdownRunPatch {
  const clock = getRunnerClock(run, step, nowMs);
  const alreadyOverSecs = Math.ceil((clock?.overrunMs ?? 0) / 1000);
  return {
    stepExtensionSecs: Math.max(0, run.stepExtensionSecs ?? 0) + alreadyOverSecs + settings.stepExtensionSecs,
    stepExtensionCount: Math.max(0, run.stepExtensionCount ?? 0) + 1,
    lastInteractionAt: new Date(nowMs).toISOString(),
  };
}

export function buildRunTouchPatch(nowMs: number): CountdownRunPatch {
  return { lastInteractionAt: new Date(nowMs).toISOString() };
}

/** Taps arrive in bursts; one write a minute is enough to prove someone is there. */
export function shouldRecordRunInteraction(
  run: CountdownRunLike | null | undefined,
  nowMs: number,
  minIntervalMs = 60_000,
): boolean {
  if (!isCountdownRunLive(run)) return false;
  const lastInteractionMs = toMs(run!.lastInteractionAt);
  return lastInteractionMs == null || nowMs - lastInteractionMs >= minIntervalMs;
}
