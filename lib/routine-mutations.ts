import {
    getNextChoreSortOrder,
    getNextRoutineSortOrder,
    localDateToUTC,
    type RoutineOverrunPolicy,
    type SharedChoreLike,
    type SharedRoutineLike,
} from '@family-organizer/shared-core';

/**
 * A routine can be built two ways, and they make different kinds of step.
 *
 * Pointing it at chores that already exist is an organisational change: those
 * chores were in the day list and stay there unless someone says otherwise.
 * Typing new steps — "brush teeth", "take vitamins" — creates chores whose only
 * home is the routine, so they are folded into the routine's row from the start.
 */

export interface RoutineDraftStep {
    /** The saved `routineSteps` row, when this step already exists. */
    stepId?: string | null;
    /** The chore this step points at. Absent for a step typed into the editor. */
    choreId?: string | null;
    /** A typed step's title; the chore is created on save. */
    title?: string | null;
    /** A typed step's budget in minutes. Blank makes it untimed. */
    durationMins?: number | null;
    /** Fold the chore into the routine's row instead of listing it by itself. */
    hideFromDayList: boolean;
}

export interface RoutineDraft {
    /** The routine being edited; absent for a new one. */
    id?: string | null;
    name: string;
    onStepOverrun: RoutineOverrunPolicy;
    steps: RoutineDraftStep[];
    /** Who the chores created for typed steps are assigned to. */
    newStepAssigneeIds: string[];
    /** The recurrence for chores created for typed steps; null means today only. */
    newStepRrule: string | null;
}

/** The first thing wrong with a draft, in words a parent can act on. */
export function validateRoutineDraft(draft: RoutineDraft): string | null {
    if (!draft.name.trim()) return 'Give the routine a name.';
    if (draft.steps.length === 0) return 'Add at least one step.';

    const typedSteps = draft.steps.filter((step) => !step.choreId);
    if (typedSteps.some((step) => !String(step.title || '').trim())) return 'Every new step needs a name.';
    if (typedSteps.some((step) => step.durationMins != null && !(step.durationMins > 0))) {
        return 'A step’s time must be more than zero, or left blank for no timer.';
    }
    if (typedSteps.length > 0 && draft.newStepAssigneeIds.length === 0) return 'Choose who the new steps are for.';

    const choreIds = draft.steps.map((step) => step.choreId).filter(Boolean);
    if (new Set(choreIds).size !== choreIds.length) return 'A chore can only appear once in a routine.';
    return null;
}

export interface BuildRoutineSaveParams {
    tx: any;
    createId: () => string;
    draft: RoutineDraft;
    /** Every routine, for the new routine's place in the list. */
    routines: SharedRoutineLike[];
    /** Every chore, for new chores' sort order and to see which flags change. */
    chores: SharedChoreLike[];
    now?: Date;
}

export interface RoutineSaveResult {
    routineId: string;
    createdChoreIds: string[];
    transactions: any[];
}

export function buildRoutineSaveTransactions(params: BuildRoutineSaveParams): RoutineSaveResult {
    const { tx, createId, draft, routines, chores } = params;
    const problem = validateRoutineDraft(draft);
    if (problem) throw new Error(problem);

    const now = params.now ?? new Date();
    const existingRoutine = draft.id ? routines.find((routine) => routine.id === draft.id) ?? null : null;
    const routineId = existingRoutine?.id ?? draft.id ?? createId();
    const choresById = new Map(chores.map((chore) => [chore.id, chore]));
    const transactions: any[] = [
        tx.routines[routineId].update({
            name: draft.name.trim(),
            onStepOverrun: draft.onStepOverrun,
            ...(existingRoutine ? {} : { createdAt: now.toISOString(), sortOrder: getNextRoutineSortOrder(routines) }),
        }),
    ];

    // Steps the draft no longer mentions leave the routine. Their chores stay:
    // a chore out of its last routine simply returns to the day list.
    const keptStepIds = new Set(draft.steps.map((step) => step.stepId).filter(Boolean));
    for (const step of existingRoutine?.steps || []) {
        if (!keptStepIds.has(step.id)) transactions.push(tx.routineSteps[step.id].delete());
    }

    const createdChoreIds: string[] = [];
    let nextSortOrder = getNextChoreSortOrder(chores);

    draft.steps.forEach((step, position) => {
        let choreId = step.choreId || null;

        if (!choreId) {
            choreId = createId();
            createdChoreIds.push(choreId);
            transactions.push(
                tx.chores[choreId].update({
                    title: String(step.title).trim(),
                    createdAt: now.toISOString(),
                    description: '',
                    startDate: localDateToUTC(now).toISOString(),
                    done: false,
                    rrule: draft.newStepRrule,
                    exdates: [],
                    pauseState: null,
                    rotationType: 'none',
                    sortOrder: nextSortOrder++,
                    weight: null,
                    estimatedDurationSecs: step.durationMins != null ? Math.round(step.durationMins * 60) : null,
                    isUpForGrabs: false,
                    isJoint: false,
                    rewardType: null,
                    rewardAmount: null,
                    rewardCurrency: null,
                    timeBucket: null,
                    timingMode: null,
                    timingConfig: null,
                    hideFromDayList: step.hideFromDayList,
                }),
            );
            for (const memberId of draft.newStepAssigneeIds) {
                transactions.push(
                    tx.chores[choreId].link({ assignees: memberId }),
                    tx.familyMembers[memberId].link({ assignedChores: choreId }),
                );
            }
        } else if (Boolean(choresById.get(choreId)?.hideFromDayList) !== step.hideFromDayList) {
            transactions.push(tx.chores[choreId].update({ hideFromDayList: step.hideFromDayList }));
        }

        if (step.stepId) {
            transactions.push(tx.routineSteps[step.stepId].update({ position }));
        } else {
            transactions.push(tx.routineSteps[createId()].update({ position }).link({ routine: routineId, chore: choreId }));
        }
    });

    return { routineId, createdChoreIds, transactions };
}

/** Deleting a routine removes its steps and leaves every chore in place. */
export function buildRoutineDeleteTransactions(tx: any, routine: SharedRoutineLike): any[] {
    return [...(routine.steps || []).map((step) => tx.routineSteps[step.id].delete()), tx.routines[routine.id].delete()];
}
