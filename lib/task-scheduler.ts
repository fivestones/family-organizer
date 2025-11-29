// lib/task-scheduler.ts
import { RRule } from 'rrule';
import { toUTCDate, createRRuleWithStartDate } from './chore-utils';

export interface Task {
    id: string;
    text: string;
    isCompleted: boolean;
    completedAt?: string;
    isDayBreak: boolean;
    order: number;
    indentationLevel?: number;
}

/**
 * Determines which tasks from a series should be displayed for a specific date
 * based on the "Rolling Queue" logic + Future Simulation.
 */
export function getTasksForDate(allTasks: Task[], rruleString: string | null, startDateString: string, viewDate: Date): Task[] {
    const utcViewDate = toUTCDate(viewDate);
    const today = toUTCDate(new Date());

    // 1. Sort tasks by order
    const sortedTasks = [...allTasks].sort((a, b) => (a.order || 0) - (b.order || 0));

    // 2. Handle Past Dates (Historical Record)
    // If viewing a past date, only show tasks specifically completed on that date.
    if (utcViewDate.getTime() < today.getTime()) {
        return sortedTasks.filter((t) => {
            if (!t.completedAt) return false;
            const completedDate = toUTCDate(new Date(t.completedAt));
            return completedDate.getTime() === utcViewDate.getTime();
        });
    }

    // 3. Prepare Queue of Remaining Work
    // We filter out anything completed before today (completedAt < today)
    const pendingTasks = sortedTasks.filter((t) => {
        if (!t.isCompleted) return true; // Not done yet
        // If it WAS done, but done TODAY, keep it in the list so it doesn't vanish instantly
        if (t.completedAt) {
            const cDate = toUTCDate(new Date(t.completedAt));
            return cDate.getTime() === today.getTime();
        }
        return false; // Done in the past
    });

    if (pendingTasks.length === 0) return [];

    // 4. Group remaining work into "Day Blocks"
    // A block is a sequence of tasks terminated by an isDayBreak (or end of list).
    const blocks: Task[][] = [];
    let currentBlock: Task[] = [];

    for (const task of pendingTasks) {
        if (task.isDayBreak) {
            // End of block.
            // If currentBlock has content, push it.
            if (currentBlock.length > 0) {
                blocks.push(currentBlock);
                currentBlock = [];
            }
            // DayBreaks themselves are usually invisible structural markers,
            // but if you want to visualize them, add them here. We skip them for the UI list.
        } else {
            currentBlock.push(task);
        }
    }
    // Push the final block if exists
    if (currentBlock.length > 0) blocks.push(currentBlock);

    // 5. Handle Today (The Active Queue)
    if (utcViewDate.getTime() === today.getTime()) {
        // Return the first block of uncompleted work
        // Note: You might also want to append tasks completed *today* to the top of this list
        // so they don't disappear instantly upon checking.
        const finishedToday = sortedTasks.filter((t) => {
            if (!t.isCompleted || !t.completedAt) return false;
            const cDate = toUTCDate(new Date(t.completedAt));
            return cDate.getTime() === today.getTime();
        });

        return [...finishedToday, ...(blocks[0] || [])];
    }

    // 6. Handle Future Dates (Simulation)
    if (utcViewDate.getTime() > today.getTime()) {
        // If not recurring, it might just be the specific start date
        // But assuming RRule for series:
        if (!rruleString) {
            // If manual date match, maybe show next block?
            // For now return empty if no pattern logic
            return [];
        }

        const rrule = createRRuleWithStartDate(rruleString, startDateString);
        if (!rrule) return [];

        // Get occurrences starting from Tomorrow
        // (Today is handled in step 5, so we look for occurrences > today)
        // We add a large buffer (e.g. 1 year) or just enough to catch the viewDate.
        // Optimization: Just check if viewDate is an occurrence.

        // However, to know WHICH block to show, we need the *sequence* of occurrences.
        // 1. Get all occurrences from Today until ViewDate.
        const relevantOccurrences = rrule.between(today, toUTCDate(new Date(utcViewDate.getTime() + 1000)), true);

        // relevantOccurrences includes Today if it matches.
        // Index 0 = Today (if scheduled) -> Block 0
        // Index 1 = Next Date -> Block 1

        // Find the index of the viewDate in this sequence
        const occurrenceIndex = relevantOccurrences.findIndex((d) => toUTCDate(d).getTime() === utcViewDate.getTime());

        if (occurrenceIndex === -1) return []; // The chore isn't scheduled for this future date

        // Map index to block
        // Block 0 is "Next available work" (Today's work).
        // Block 1 is "Work for the next scheduled occurrence".
        // So occurrenceIndex corresponds to blockIndex.

        return blocks[occurrenceIndex] || [];
    }

    return [];
}
