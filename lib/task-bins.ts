// lib/task-bins.ts
// Filtering, sorting, and utility functions for the Task Bins review page.

import {
    getLatestTaskUpdate,
    getTaskWorkflowState,
    isTaskNoted,
    type TaskUpdateLike,
    type TaskWorkflowState,
} from '@/lib/task-progress';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskBinTask {
    id: string;
    text: string;
    isCompleted?: boolean | null;
    workflowState?: string | null;
    notedUntilDate?: string | null;
    isNotedIndefinitely?: boolean | null;
    updates?: TaskUpdateLike[];
    responseFields?: Array<{
        id: string;
        type: string;
        label: string;
        required: boolean;
        order: number;
    }>;
    taskSeries?: Array<{ id: string; name?: string | null; familyMember?: Array<{ id: string }> | { id: string } | null }> | { id: string; name?: string | null; familyMember?: Array<{ id: string }> | { id: string } | null };
}

export interface TaskBinFilters {
    status?: TaskWorkflowState | 'all';
    familyMemberId?: string | 'all';
    taskSeriesId?: string | 'all';
    showNoted?: boolean;
}

export type TaskBinSort = 'newest' | 'oldest' | 'status';

export interface TaskBinEntry {
    task: TaskBinTask;
    latestUpdate: TaskUpdateLike | null;
    seriesName: string | null;
    isNoted: boolean;
    isOverdue: boolean;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/** Normalize an InstantDB has-one link that may be a single object or a 1-element array. */
function resolveOne<T>(value: T[] | T | null | undefined): T | null {
    if (!value) return null;
    if (Array.isArray(value)) return value[0] ?? null;
    return value;
}

const STATUS_ORDER: Record<TaskWorkflowState, number> = {
    needs_review: 0,
    blocked: 1,
    in_progress: 2,
    not_started: 3,
    skipped: 4,
    done: 5,
};

/**
 * Determines if a task is "overdue" — currently, tasks in needs_review or blocked
 * states are considered overdue (they require parent attention).
 */
export function isTaskOverdue(task: TaskBinTask): boolean {
    const state = getTaskWorkflowState(task);
    return state === 'needs_review' || state === 'blocked';
}

/**
 * Converts a flat list of tasks into TaskBinEntries with metadata, applying filters.
 */
export function buildTaskBinEntries(
    tasks: TaskBinTask[],
    filters: TaskBinFilters = {},
    todayKey?: string
): TaskBinEntry[] {
    const today = todayKey || new Date().toISOString().slice(0, 10);

    return tasks
        .map((task): TaskBinEntry | null => {
            const state = getTaskWorkflowState(task);
            const latestUpdate = getLatestTaskUpdate(task);
            const series = resolveOne(task.taskSeries);
            const seriesName = series?.name || null;
            const noted = isTaskNoted(task, today);
            const overdue = isTaskOverdue(task);

            // --- Filters ---
            if (filters.status && filters.status !== 'all' && state !== filters.status) {
                return null;
            }

            // Filter by family member: use the task series owner (familyMember link)
            if (filters.familyMemberId && filters.familyMemberId !== 'all') {
                const owner = series ? resolveOne(series.familyMember) : null;
                if (!owner || owner.id !== filters.familyMemberId) {
                    return null;
                }
            }

            // Filter by task series
            if (filters.taskSeriesId && filters.taskSeriesId !== 'all') {
                if (!series || series.id !== filters.taskSeriesId) {
                    return null;
                }
            }

            // Hide noted tasks unless explicitly showing them
            if (noted && !filters.showNoted) {
                return null;
            }

            return { task, latestUpdate, seriesName, isNoted: noted, isOverdue: overdue };
        })
        .filter((entry): entry is TaskBinEntry => entry !== null);
}

/**
 * Sorts TaskBinEntries by the given sort mode.
 */
export function sortTaskBinEntries(entries: TaskBinEntry[], sort: TaskBinSort): TaskBinEntry[] {
    const sorted = [...entries];

    switch (sort) {
        case 'newest':
            sorted.sort((a, b) => {
                const aTime = getUpdateTime(a.latestUpdate);
                const bTime = getUpdateTime(b.latestUpdate);
                return bTime - aTime;
            });
            break;
        case 'oldest':
            sorted.sort((a, b) => {
                const aTime = getUpdateTime(a.latestUpdate);
                const bTime = getUpdateTime(b.latestUpdate);
                return aTime - bTime;
            });
            break;
        case 'status':
            sorted.sort((a, b) => {
                const aState = getTaskWorkflowState(a.task) as TaskWorkflowState;
                const bState = getTaskWorkflowState(b.task) as TaskWorkflowState;
                const orderDiff = (STATUS_ORDER[aState] ?? 99) - (STATUS_ORDER[bState] ?? 99);
                if (orderDiff !== 0) return orderDiff;
                // Secondary sort by newest
                return getUpdateTime(b.latestUpdate) - getUpdateTime(a.latestUpdate);
            });
            break;
    }

    return sorted;
}

/**
 * Groups entries into "needs attention" (overdue, not noted) and "all".
 */
export function groupByAttention(entries: TaskBinEntry[]) {
    const needsAttention = entries.filter((e) => e.isOverdue && !e.isNoted);
    return { needsAttention, all: entries };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getUpdateTime(update: TaskUpdateLike | null): number {
    if (!update?.createdAt) return 0;
    if (typeof update.createdAt === 'number') return update.createdAt;
    const parsed = new Date(update.createdAt).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
}
