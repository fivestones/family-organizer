import { getNextChoreOccurrence } from '@/lib/chore-schedule';
import { buildHistoryEventTransactions } from '@/lib/history-events';
import {
    getTaskLastActiveState,
    getTaskParentId,
    getTaskWorkflowState,
    getTaskStatusLabel,
    isTaskDone,
    isTaskWorkflowState,
    type TaskActiveState,
    type TaskRestoreTiming,
    type TaskWorkflowState,
} from '@/lib/task-progress';

export interface TaskMutationTaskLike {
    id: string;
    text?: string | null;
    isCompleted?: boolean | null;
    completedAt?: Date | string | null;
    completedOnDate?: string | null;
    workflowState?: string | null;
    lastActiveState?: string | null;
    deferredUntilDate?: string | null;
    parentTask?: Array<{ id?: string | null }> | { id?: string | null } | null;
    childTasksComplete?: boolean | null;
}

export interface TaskProgressAttachmentInput {
    id: string;
    name: string;
    type: string;
    url: string;
    kind?: string | null;
    sizeBytes?: number | null;
    width?: number | null;
    height?: number | null;
    durationSec?: number | null;
    thumbnailUrl?: string | null;
    thumbnailWidth?: number | null;
    thumbnailHeight?: number | null;
    blurhash?: string | null;
    waveformPeaks?: number[] | null;
}

export interface BuildTaskProgressUpdateTransactionsParams {
    tx: any;
    taskId: string;
    allTasks: TaskMutationTaskLike[];
    nextState: TaskWorkflowState;
    selectedDateKey: string;
    note?: string;
    actorFamilyMemberId?: string | null;
    restoreTiming?: TaskRestoreTiming | null;
    schedule?: {
        startDate: string;
        rrule?: string | null;
        exdates?: string[] | null;
    } | null;
    referenceDate?: Date | null;
    createId: () => string;
    attachments?: TaskProgressAttachmentInput[];
    taskSeriesId?: string | null;
    choreId?: string | null;
    affectedFamilyMemberIds?: string[];
}

function toDateKey(value: Date | string): string {
    return new Date(value).toISOString().slice(0, 10);
}

function getDeferredUntilDate(params: {
    nextState: TaskWorkflowState;
    restoreTiming?: TaskRestoreTiming | null;
    schedule?: BuildTaskProgressUpdateTransactionsParams['schedule'];
    referenceDate?: Date | null;
}): string | null {
    if (params.nextState !== 'not_started' && params.nextState !== 'in_progress') return null;
    if (params.restoreTiming !== 'next_scheduled' || !params.schedule?.startDate) return null;

    const anchorDate = params.referenceDate || new Date();
    const nextOccurrence = getNextChoreOccurrence(
        {
            startDate: params.schedule.startDate,
            rrule: params.schedule.rrule || null,
            exdates: params.schedule.exdates || [],
        },
        anchorDate,
        false
    );

    return nextOccurrence ? toDateKey(nextOccurrence) : null;
}

function syncAncestorChildCompletionState(params: {
    tx: any;
    taskMap: Map<string, TaskMutationTaskLike>;
    transactions: any[];
    startingTaskId: string;
}) {
    let currentTask = params.taskMap.get(params.startingTaskId);
    let parentId = currentTask ? getTaskParentId(currentTask) : undefined;
    let depth = 0;

    while (parentId && depth < 50) {
        const parent = params.taskMap.get(parentId);
        if (!parent) break;

        const children = Array.from(params.taskMap.values()).filter((task) => getTaskParentId(task) === parentId);
        const allChildrenFinished = children.every((child) => isTaskDone(child) && child.childTasksComplete !== false);

        if (parent.childTasksComplete !== allChildrenFinished) {
            parent.childTasksComplete = allChildrenFinished;
            params.transactions.push(
                params.tx.tasks[parent.id].update({
                    childTasksComplete: allChildrenFinished,
                })
            );
        }

        currentTask = parent;
        parentId = currentTask ? getTaskParentId(currentTask) : undefined;
        depth += 1;
    }
}

export function buildTaskProgressUpdateTransactions(params: BuildTaskProgressUpdateTransactionsParams) {
    if (!isTaskWorkflowState(params.nextState)) {
        return [];
    }

    const taskMap = new Map<string, TaskMutationTaskLike>();
    params.allTasks.forEach((task) => {
        taskMap.set(task.id, { ...task });
    });

    const targetTask = taskMap.get(params.taskId);
    if (!targetTask) return [];

    const now = new Date();
    const currentState = getTaskWorkflowState(targetTask);
    const previousActiveState = getTaskLastActiveState(targetTask);
    const nextActiveState: TaskActiveState =
        params.nextState === 'not_started' || params.nextState === 'in_progress' ? params.nextState : previousActiveState;
    const deferredUntilDate = getDeferredUntilDate({
        nextState: params.nextState,
        restoreTiming: params.restoreTiming,
        schedule: params.schedule,
        referenceDate: params.referenceDate,
    });

    targetTask.workflowState = params.nextState;
    targetTask.lastActiveState = nextActiveState;
    targetTask.deferredUntilDate = deferredUntilDate;
    targetTask.isCompleted = params.nextState === 'done';

    const transactions: any[] = [];

    if (params.nextState === 'done') {
        transactions.push(
            params.tx.tasks[params.taskId].update({
                workflowState: params.nextState,
                lastActiveState: previousActiveState,
                deferredUntilDate: null,
                isCompleted: true,
                completedAt: currentState === 'done' ? targetTask.completedAt || null : now,
                completedOnDate: currentState === 'done' ? targetTask.completedOnDate || null : params.selectedDateKey,
            })
        );
    } else {
        transactions.push(
            params.tx.tasks[params.taskId].update({
                workflowState: params.nextState,
                lastActiveState: nextActiveState,
                deferredUntilDate: deferredUntilDate,
                isCompleted: false,
                completedAt: null,
                completedOnDate: null,
            })
        );
    }

    const progressEntryId = params.createId();
    const trimmedNote = params.note?.trim() || null;
    transactions.push(
        params.tx.taskProgressEntries[progressEntryId].update({
            actorFamilyMemberId: params.actorFamilyMemberId || null,
            createdAt: now.toISOString(),
            fromState: currentState,
            note: trimmedNote,
            restoreTiming: params.restoreTiming || null,
            scheduledForDate: params.selectedDateKey,
            toState: params.nextState,
        })
    );
    if (typeof params.tx.tasks[params.taskId].link === 'function') {
        transactions.push(params.tx.tasks[params.taskId].link({ progressEntries: progressEntryId }));
    }

    for (const attachment of params.attachments || []) {
        if (typeof params.tx.taskProgressAttachments?.[attachment.id]?.update === 'function') {
            transactions.push(
                params.tx.taskProgressAttachments[attachment.id].update({
                    blurhash: attachment.blurhash || null,
                    createdAt: now.toISOString(),
                    durationSec: attachment.durationSec ?? null,
                    height: attachment.height ?? null,
                    kind: attachment.kind || null,
                    name: attachment.name,
                    sizeBytes: attachment.sizeBytes ?? null,
                    thumbnailHeight: attachment.thumbnailHeight ?? null,
                    thumbnailUrl: attachment.thumbnailUrl || null,
                    thumbnailWidth: attachment.thumbnailWidth ?? null,
                    type: attachment.type,
                    updatedAt: now.toISOString(),
                    url: attachment.url,
                    waveformPeaks: attachment.waveformPeaks || null,
                    width: attachment.width ?? null,
                })
            );
        }
        if (typeof params.tx.taskProgressEntries?.[progressEntryId]?.link === 'function') {
            transactions.push(params.tx.taskProgressEntries[progressEntryId].link({ attachments: attachment.id }));
        }
    }

    const taskLabel = String(targetTask.text || '').trim() || 'Task';
    const summary =
        params.restoreTiming && (params.nextState === 'not_started' || params.nextState === 'in_progress')
            ? `Restored "${taskLabel}" to ${getTaskStatusLabel(params.nextState)}`
            : params.nextState === 'done'
              ? `Marked "${taskLabel}" done`
              : currentState === params.nextState
                ? `Updated "${taskLabel}"`
                : `Moved "${taskLabel}" to ${getTaskStatusLabel(params.nextState)}`;

    const historyEvent = buildHistoryEventTransactions({
        tx: params.tx,
        createId: params.createId,
        occurredAt: now.toISOString(),
        domain: 'tasks',
        actionType: params.restoreTiming ? 'task_restored' : 'task_progress_updated',
        summary,
        source: 'manual',
        actorFamilyMemberId: params.actorFamilyMemberId || null,
        affectedFamilyMemberIds: params.affectedFamilyMemberIds || [],
        taskSeriesId: params.taskSeriesId || null,
        taskId: params.taskId,
        choreId: params.choreId || null,
        scheduledForDate: params.selectedDateKey,
        restoreTiming: params.restoreTiming || null,
        metadata: {
            fromState: currentState,
            toState: params.nextState,
            note: trimmedNote,
            taskText: taskLabel,
        },
        attachments: params.attachments || [],
    });
    transactions.push(...historyEvent.transactions);

    syncAncestorChildCompletionState({
        tx: params.tx,
        taskMap,
        transactions,
        startingTaskId: params.taskId,
    });

    return transactions;
}
