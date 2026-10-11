// ---------------------------------------------------------------------------
// Routines
//
// A routine is a named, ordered group of chores — "Morning Routine" — run by
// the same countdown machinery as the day itself. Membership lives on
// `routineSteps`, a join row that carries each step's position, because an
// Instant link cannot hold an attribute.
// ---------------------------------------------------------------------------

type LinkedRef = { id?: string | null } | Array<{ id?: string | null }> | null | undefined;

export type RoutineOverrunPolicy = 'wait' | 'advance';

export interface SharedRoutineStepLike {
  id: string;
  position?: number | null;
  chore?: LinkedRef;
  routine?: LinkedRef;
}

export interface SharedRoutineLike {
  id: string;
  name?: string | null;
  sortOrder?: number | null;
  /** What a timed step does at zero: wait for Done, or move on by itself. */
  onStepOverrun?: string | null;
  steps?: SharedRoutineStepLike[] | null;
}

function linkedId(value: LinkedRef): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.id ? String(first.id) : null;
}

/**
 * A step reaching zero waits unless the routine says otherwise. The routine
 * that has to end when the bus arrives is the exception, not the rule.
 */
export function getRoutineOverrunPolicy(routine: Pick<SharedRoutineLike, 'onStepOverrun'> | null | undefined): RoutineOverrunPolicy {
  return routine?.onStepOverrun === 'advance' ? 'advance' : 'wait';
}

function compareSteps(left: SharedRoutineStepLike, right: SharedRoutineStepLike): number {
  const leftPosition = Number.isFinite(Number(left.position)) ? Number(left.position) : Number.MAX_SAFE_INTEGER;
  const rightPosition = Number.isFinite(Number(right.position)) ? Number(right.position) : Number.MAX_SAFE_INTEGER;
  return leftPosition - rightPosition || String(left.id).localeCompare(String(right.id));
}

export function sortRoutineSteps<TStep extends SharedRoutineStepLike>(steps: TStep[] | null | undefined): TStep[] {
  return [...(steps || [])].sort(compareSteps);
}

/** The routine's chores in step order. A chore listed twice keeps its first position. */
export function getRoutineChoreIds(routine: Pick<SharedRoutineLike, 'steps'> | null | undefined): string[] {
  const choreIds: string[] = [];
  for (const step of sortRoutineSteps(routine?.steps)) {
    const choreId = linkedId(step.chore);
    if (choreId && !choreIds.includes(choreId)) choreIds.push(choreId);
  }
  return choreIds;
}

export function sortRoutines<TRoutine extends SharedRoutineLike>(routines: TRoutine[] | null | undefined): TRoutine[] {
  return [...(routines || [])].sort((left, right) => {
    const leftOrder = Number.isFinite(Number(left.sortOrder)) ? Number(left.sortOrder) : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(Number(right.sortOrder)) ? Number(right.sortOrder) : Number.MAX_SAFE_INTEGER;
    return (
      leftOrder - rightOrder ||
      String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' }) ||
      String(left.id).localeCompare(String(right.id))
    );
  });
}

export function getNextRoutineSortOrder(routines: SharedRoutineLike[] | null | undefined): number {
  return (
    (routines || []).reduce((max, routine) => {
      const value = Number(routine?.sortOrder);
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, -1) + 1
  );
}

export interface DayListVisibilityChore {
  hideFromDayList?: boolean | null;
  routineSteps?: unknown[] | null;
}

/**
 * Whether a chore is folded into its routine's row instead of listed by itself.
 *
 * Membership gates the rule and the flag only modifies it, so the flag is inert
 * on a chore that belongs to no routine: taking a chore out of its last routine
 * puts it back in the day list with no stale state to clean up.
 */
export function isChoreHiddenFromDayList(chore: DayListVisibilityChore | null | undefined): boolean {
  return (chore?.routineSteps?.length ?? 0) > 0 && chore?.hideFromDayList === true;
}
