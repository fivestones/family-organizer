export const TASK_ACTIVE_STATES = ['not_started', 'in_progress'] as const;
export const TASK_BUCKET_STATES = ['blocked', 'skipped', 'needs_review', 'done'] as const;
export const TASK_WORKFLOW_STATES = [...TASK_ACTIVE_STATES, ...TASK_BUCKET_STATES] as const;

export type TaskActiveState = (typeof TASK_ACTIVE_STATES)[number];
export type TaskBucketState = (typeof TASK_BUCKET_STATES)[number];
export type TaskWorkflowState = (typeof TASK_WORKFLOW_STATES)[number];
export type TaskRestoreTiming = 'now' | 'next_scheduled';

export interface TaskUpdateAttachmentLike {
    id?: string;
    name?: string | null;
    type?: string | null;
    url?: string | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
    thumbnailUrl?: string | null;
    durationSec?: number | null;
    waveformPeaks?: number[] | null;
}

export interface TaskUpdateLike {
    id?: string;
    note?: string | null;
    fromState?: string | null;
    toState?: string | null;
    createdAt?: number | string | Date | null;
    scheduledForDate?: string | null;
    restoreTiming?: string | null;
    isDraft?: boolean | null;
    gradeDisplayValue?: string | null;
    gradeNumericValue?: number | null;
    gradeIsProvisional?: boolean | null;
    attachments?: TaskUpdateAttachmentLike[] | null;
    actor?: Array<{ id?: string; name?: string | null }> | { id?: string; name?: string | null } | null;
    affectedPerson?: Array<{ id?: string; name?: string | null }> | { id?: string; name?: string | null } | null;
    responseFieldValues?: Array<{
        id?: string;
        richTextContent?: string | null;
        fileUrl?: string | null;
        fileName?: string | null;
        fileType?: string | null;
        field?: Array<{ id?: string; label?: string | null }> | null;
    }> | null;
    gradeType?: Array<{ id?: string; name?: string | null; kind?: string | null }> | null;
}

export interface TaskProgressTaskLike {
    id: string;
    isDayBreak?: boolean | null;
    isCompleted?: boolean | null;
    workflowState?: string | null;
    lastActiveState?: string | null;
    deferredUntilDate?: string | null;
    notedUntilDate?: string | null;
    isNotedIndefinitely?: boolean | null;
    parentTask?: Array<{ id?: string | null }> | { id?: string | null } | null;
    updates?: TaskUpdateLike[] | null;
}

export function isTaskWorkflowState(value: unknown): value is TaskWorkflowState {
    return typeof value === 'string' && (TASK_WORKFLOW_STATES as readonly string[]).includes(value);
}

export function isTaskActiveState(value: unknown): value is TaskActiveState {
    return typeof value === 'string' && (TASK_ACTIVE_STATES as readonly string[]).includes(value);
}

export function isTaskBucketState(value: unknown): value is TaskBucketState {
    return typeof value === 'string' && (TASK_BUCKET_STATES as readonly string[]).includes(value);
}

export function getTaskWorkflowState(task: Pick<TaskProgressTaskLike, 'workflowState' | 'isCompleted'> | null | undefined): TaskWorkflowState {
    if (isTaskWorkflowState(task?.workflowState)) {
        return task.workflowState;
    }
    return task?.isCompleted ? 'done' : 'not_started';
}

export function getTaskLastActiveState(task: Pick<TaskProgressTaskLike, 'lastActiveState' | 'workflowState' | 'isCompleted'> | null | undefined): TaskActiveState {
    if (isTaskActiveState(task?.lastActiveState)) {
        return task.lastActiveState;
    }

    const workflowState = getTaskWorkflowState(task);
    return workflowState === 'in_progress' ? 'in_progress' : 'not_started';
}

export function isTaskDone(task: Pick<TaskProgressTaskLike, 'workflowState' | 'isCompleted'> | null | undefined): boolean {
    return getTaskWorkflowState(task) === 'done';
}

export function isTaskInActiveQueue(task: Pick<TaskProgressTaskLike, 'workflowState' | 'isCompleted' | 'deferredUntilDate'> | null | undefined, viewDateKey: string) {
    const workflowState = getTaskWorkflowState(task);
    if (!isTaskActiveState(workflowState)) return false;
    const deferredUntilDate = typeof task?.deferredUntilDate === 'string' ? task.deferredUntilDate : null;
    if (deferredUntilDate && deferredUntilDate > viewDateKey) return false;
    return true;
}

export function getTaskParentId(task: Pick<TaskProgressTaskLike, 'parentTask'> | null | undefined): string | undefined {
    if (!task?.parentTask) return undefined;
    if (Array.isArray(task.parentTask)) {
        return task.parentTask[0]?.id || undefined;
    }
    return task.parentTask.id || undefined;
}

export function taskHasChildren(taskId: string, allTasks: Array<Pick<TaskProgressTaskLike, 'id' | 'parentTask' | 'isDayBreak'>>): boolean {
    return allTasks.some((task) => !task?.isDayBreak && getTaskParentId(task) === taskId);
}

export function isActionableTask(
    task: Pick<TaskProgressTaskLike, 'id' | 'isDayBreak' | 'parentTask'>,
    allTasks: Array<Pick<TaskProgressTaskLike, 'id' | 'parentTask' | 'isDayBreak'>>
): boolean {
    if (task.isDayBreak) return false;
    return !taskHasChildren(task.id, allTasks);
}

function toComparableTime(value: number | string | Date | null | undefined): number {
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}

export function sortTaskUpdates(entries: TaskUpdateLike[] | null | undefined): TaskUpdateLike[] {
    return [...(entries || [])].sort((left, right) => toComparableTime(right?.createdAt || null) - toComparableTime(left?.createdAt || null));
}

export function getLatestTaskUpdate(task: Pick<TaskProgressTaskLike, 'updates'> | null | undefined): TaskUpdateLike | null {
    const nonDraftUpdates = (task?.updates || []).filter((u) => !u.isDraft);
    return sortTaskUpdates(nonDraftUpdates)[0] || null;
}

export function getLatestDraftUpdate(task: Pick<TaskProgressTaskLike, 'updates'> | null | undefined): TaskUpdateLike | null {
    const draftUpdates = (task?.updates || []).filter((u) => u.isDraft);
    return sortTaskUpdates(draftUpdates)[0] || null;
}

export function getBucketedTasks<T extends TaskProgressTaskLike>(
    allTasks: T[] | null | undefined,
    state: TaskBucketState
): T[] {
    const safeTasks = allTasks || [];
    return safeTasks.filter((task) => isActionableTask(task, safeTasks) && getTaskWorkflowState(task) === state);
}

export function getTaskBucketCounts(allTasks: TaskProgressTaskLike[] | null | undefined) {
    return {
        blocked: getBucketedTasks(allTasks, 'blocked').length,
        skipped: getBucketedTasks(allTasks, 'skipped').length,
        needs_review: getBucketedTasks(allTasks, 'needs_review').length,
        done: getBucketedTasks(allTasks, 'done').length,
    };
}

export function getTaskStatusLabel(state: TaskWorkflowState): string {
    switch (state) {
        case 'not_started':
            return 'Not started';
        case 'in_progress':
            return 'In progress';
        case 'blocked':
            return 'Blocked';
        case 'skipped':
            return 'Skipped';
        case 'needs_review':
            return 'Needs review';
        case 'done':
            return 'Done';
        default:
            return state;
    }
}

export function getTaskProgressPlaceholder(state: TaskWorkflowState): string {
    switch (state) {
        case 'blocked':
            return 'What is blocking this task, and what would unblock it?';
        case 'skipped':
            return 'Why is this task being skipped?';
        case 'needs_review':
            return 'What should a parent review here?';
        case 'done':
            return 'How did it go?';
        case 'in_progress':
            return 'What is finished, and what is left to do?';
        case 'not_started':
        default:
            return 'Add notes, plan your approach, or leave context for later.';
    }
}

export function getTaskUpdateActorName(
    entry: TaskUpdateLike | null | undefined,
): string | null {
    const actor = entry?.actor;
    if (Array.isArray(actor)) {
        return actor[0]?.name || null;
    }
    if (actor?.name) return actor.name;
    return null;
}

export function getTaskUpdateAffectedName(
    entry: TaskUpdateLike | null | undefined,
): string | null {
    const affectedPerson = entry?.affectedPerson;
    if (Array.isArray(affectedPerson)) {
        return affectedPerson[0]?.name || null;
    }
    if (affectedPerson?.name) return affectedPerson.name;
    return null;
}

/**
 * Returns true if a task is "noted" and should be hidden from the overdue
 * section of the needs-attention view.
 */
export function isTaskNoted(
    task: Pick<TaskProgressTaskLike, 'notedUntilDate' | 'isNotedIndefinitely'> | null | undefined,
    todayDateKey: string,
): boolean {
    if (task?.isNotedIndefinitely) return true;
    if (task?.notedUntilDate && task.notedUntilDate >= todayDateKey) return true;
    return false;
}
