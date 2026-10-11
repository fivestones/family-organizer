import {
    getRoutineOverrunPolicy,
    sortRoutineSteps,
    type RoutineOverrunPolicy,
    type SharedChoreLike,
    type SharedRoutineLike,
} from '@family-organizer/shared-core';
import type { RoutineDraft } from '@/lib/routine-mutations';

// ---------------------------------------------------------------------------
// The editor's working copy of a routine.
// ---------------------------------------------------------------------------

export interface EditorStep {
    /** Stable for the life of the editor, for React keys and reordering. */
    key: string;
    /** The saved `routineSteps` row, when there is one. */
    stepId: string | null;
    /** The chore this step points at; null for a step typed here and not yet saved. */
    choreId: string | null;
    title: string;
    /** Minutes as typed. Only editable on a step that is not saved yet. */
    durationMins: string;
    /** Whether the chore still appears by itself in the day list. */
    showInDayList: boolean;
}

export type WeekdayCode = 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA';
export const WEEKDAYS: Array<{ code: WeekdayCode; label: string; short: string }> = [
    { code: 'MO', label: 'Monday', short: 'M' },
    { code: 'TU', label: 'Tuesday', short: 'T' },
    { code: 'WE', label: 'Wednesday', short: 'W' },
    { code: 'TH', label: 'Thursday', short: 'T' },
    { code: 'FR', label: 'Friday', short: 'F' },
    { code: 'SA', label: 'Saturday', short: 'S' },
    { code: 'SU', label: 'Sunday', short: 'S' },
];
export const EVERY_DAY: WeekdayCode[] = WEEKDAYS.map((day) => day.code);
export const SCHOOL_DAYS: WeekdayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR'];
export const WEEKEND_DAYS: WeekdayCode[] = ['SA', 'SU'];

export interface RoutineEditorState {
    id: string | null;
    name: string;
    onStepOverrun: RoutineOverrunPolicy;
    steps: EditorStep[];
    /** Who the chores created for typed steps belong to. */
    assigneeIds: string[];
    /** Which days those chores repeat on. */
    days: WeekdayCode[];
}

let editorKeyCounter = 0;
export function createEditorKey(): string {
    editorKeyCounter += 1;
    return `step-${editorKeyCounter}`;
}

function linkedId(value: unknown): string | null {
    const first = Array.isArray(value) ? value[0] : value;
    return first && typeof first === 'object' && 'id' in first && first.id ? String(first.id) : null;
}

/** Open an existing routine for editing, or start a blank one. */
export function createRoutineEditorState(
    routine: SharedRoutineLike | null,
    chores: SharedChoreLike[],
    defaultAssigneeIds: string[] = [],
): RoutineEditorState {
    const choresById = new Map(chores.map((chore) => [chore.id, chore]));
    const steps: EditorStep[] = [];
    const assigneeIds = new Set<string>();

    for (const step of sortRoutineSteps(routine?.steps)) {
        const chore = choresById.get(linkedId(step.chore) ?? '');
        if (!chore || steps.some((entry) => entry.choreId === chore.id)) continue;
        for (const assignee of chore.assignees || []) assigneeIds.add(assignee.id);
        steps.push({
            key: createEditorKey(),
            stepId: step.id,
            choreId: chore.id,
            title: chore.title || 'Untitled chore',
            durationMins: '',
            showInDayList: chore.hideFromDayList !== true,
        });
    }

    return {
        id: routine?.id ?? null,
        name: routine?.name || '',
        onStepOverrun: getRoutineOverrunPolicy(routine),
        steps,
        // New steps default to whoever the routine already involves.
        assigneeIds: assigneeIds.size > 0 ? Array.from(assigneeIds) : defaultAssigneeIds,
        days: EVERY_DAY,
    };
}

/** Typing a step creates a chore that lives in the routine, so it starts folded in. */
export function createTypedStep(title: string, durationMins: string): EditorStep {
    return { key: createEditorKey(), stepId: null, choreId: null, title, durationMins, showInDayList: false };
}

/** Pointing at an existing chore leaves it wherever it already shows. */
export function createChoreStep(chore: SharedChoreLike): EditorStep {
    return {
        key: createEditorKey(),
        stepId: null,
        choreId: chore.id,
        title: chore.title || 'Untitled chore',
        durationMins: '',
        showInDayList: chore.hideFromDayList !== true,
    };
}

export function moveStep(steps: EditorStep[], index: number, direction: -1 | 1): EditorStep[] {
    const target = index + direction;
    if (index < 0 || index >= steps.length || target < 0 || target >= steps.length) return steps;
    const next = [...steps];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

/** `RRULE:FREQ=DAILY` for every day, otherwise a weekly rule on the chosen days. */
export function buildWeekdayRrule(days: WeekdayCode[]): string | null {
    const chosen = EVERY_DAY.filter((day) => days.includes(day));
    if (chosen.length === 0) return null;
    if (chosen.length === EVERY_DAY.length) return 'RRULE:FREQ=DAILY';
    return `RRULE:FREQ=WEEKLY;BYDAY=${chosen.join(',')}`;
}

export function describeDays(days: WeekdayCode[]): string {
    const chosen = EVERY_DAY.filter((day) => days.includes(day));
    const is = (set: WeekdayCode[]) => chosen.length === set.length && set.every((day) => chosen.includes(day));
    if (is(EVERY_DAY)) return 'every day';
    if (is(SCHOOL_DAYS)) return 'on weekdays';
    if (is(WEEKEND_DAYS)) return 'on weekends';
    if (chosen.length === 0) return 'on no days';
    return `on ${chosen.map((code) => WEEKDAYS.find((day) => day.code === code)!.label.slice(0, 3)).join(', ')}`;
}

function parseMinutes(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    // An unreadable entry is passed through as zero so validation can reject it.
    return Number.isFinite(parsed) ? parsed : 0;
}

export function toRoutineDraft(state: RoutineEditorState): RoutineDraft {
    return {
        id: state.id,
        name: state.name,
        onStepOverrun: state.onStepOverrun,
        steps: state.steps.map((step) => ({
            stepId: step.stepId,
            choreId: step.choreId,
            title: step.title,
            durationMins: step.choreId ? null : parseMinutes(step.durationMins),
            hideFromDayList: !step.showInDayList,
        })),
        newStepAssigneeIds: state.assigneeIds,
        newStepRrule: buildWeekdayRrule(state.days),
    };
}

/** How long a routine takes end to end, counting only the steps that have a timer. */
export function sumRoutineDurationSecs(chores: Array<{ estimatedDurationSecs?: number | null; weight?: number | null }>): number {
    return chores.reduce((total, chore) => {
        if (chore.estimatedDurationSecs != null && chore.estimatedDurationSecs > 0) return total + chore.estimatedDurationSecs;
        return chore.weight != null && chore.weight > 0 ? total + chore.weight * 60 : total;
    }, 0);
}
