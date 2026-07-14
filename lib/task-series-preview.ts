import { getTodayKey, getLocalDateKey } from '@family-organizer/shared-core';
import { choreOccursOnDate, getChoreOccurrencesInRange } from '@/lib/chore-schedule';
import { toUTCDate } from '@/lib/chore-utils';
import { getTasksForDate, type Task } from '@/lib/task-scheduler';
import { getTaskDayBlocks, type ChoreScheduleInfo } from '@/lib/task-series-schedule';
import { isTaskDone } from '@/lib/task-progress';

export type TaskSchedulePreview = {
    plannedDateKey: string | null;
    projectedDateKey: string | null;
    completedDateKey: string | null;
};

function dateKey(value: Date) {
    return toUTCDate(value).toISOString().slice(0, 10);
}

function addCandidate(target: Map<string, Date>, value: Date) {
    target.set(dateKey(value), toUTCDate(value));
}

/**
 * Build original-plan and rolling-queue dates for editor cards. The live side
 * deliberately calls getTasksForDate, keeping preview behavior aligned with
 * the same scheduler used by /tasks.
 */
export function buildTaskSchedulePreview(
    schedule: ChoreScheduleInfo,
    allTasks: Task[],
    pullForwardCount = 0
): Record<string, TaskSchedulePreview> {
    if (!schedule.rruleString) return {};

    const blocks = getTaskDayBlocks(allTasks);
    if (blocks.length === 0) return {};

    const result: Record<string, TaskSchedulePreview> = {};
    for (const task of allTasks) {
        const completedDateKey = isTaskDone(task)
            ? task.completedOnDate || (task.completedAt ? getLocalDateKey(new Date(task.completedAt)) : null)
            : null;
        result[task.id] = {
            plannedDateKey: null,
            projectedDateKey: null,
            completedDateKey,
        };
    }

    const recurrence = {
        startDate: schedule.startDate,
        rrule: schedule.rruleString,
        exdates: schedule.exdates,
    };
    const plannedAnchor = toUTCDate(new Date(schedule.seriesStartDate || schedule.startDate));
    const plannedFarFuture = new Date(plannedAnchor.getTime());
    plannedFarFuture.setUTCFullYear(plannedFarFuture.getUTCFullYear() + 5);
    const plannedOccurrences = getChoreOccurrencesInRange(recurrence, plannedAnchor, plannedFarFuture);

    blocks.forEach((block, blockIndex) => {
        const occurrence = plannedOccurrences[blockIndex];
        if (!occurrence) return;
        const plannedDateKey = dateKey(occurrence);
        for (const task of block.tasks) {
            if (result[task.id]) result[task.id].plannedDateKey = plannedDateKey;
        }
    });

    const today = toUTCDate(new Date(`${getTodayKey()}T00:00:00Z`));
    const seriesStart = schedule.seriesStartDate ? toUTCDate(new Date(schedule.seriesStartDate)) : null;
    const liveAnchor = seriesStart && seriesStart.getTime() > today.getTime() ? seriesStart : today;
    const liveFarFuture = new Date(liveAnchor.getTime());
    liveFarFuture.setUTCFullYear(liveFarFuture.getUTCFullYear() + 5);

    const candidates = new Map<string, Date>();
    if (pullForwardCount > 0 || choreOccursOnDate(recurrence, liveAnchor)) {
        addCandidate(candidates, liveAnchor);
    }
    for (const occurrence of getChoreOccurrencesInRange(recurrence, liveAnchor, liveFarFuture)) {
        addCandidate(candidates, occurrence);
        if (candidates.size >= blocks.length + Math.max(0, pullForwardCount) + 8) break;
    }

    for (const candidate of Array.from(candidates.values())) {
        const projectedTasks = getTasksForDate(
            allTasks,
            schedule.rruleString,
            schedule.startDate,
            candidate,
            schedule.seriesStartDate,
            schedule.exdates,
            pullForwardCount
        );
        const projectedDateKey = dateKey(candidate);
        for (const task of projectedTasks) {
            if (result[task.id] && !result[task.id].projectedDateKey) {
                result[task.id].projectedDateKey = projectedDateKey;
            }
        }
    }

    return result;
}
