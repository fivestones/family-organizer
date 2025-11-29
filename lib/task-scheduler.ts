// lib/task-scheduler.ts
import { RRule } from 'rrule';
import { toUTCDate, createRRuleWithStartDate } from './chore-utils';
import { tx } from '@instantdb/react';

export interface Task {
    id: string;
    text: string;
    isCompleted: boolean;
    completedAt?: string;
    isDayBreak: boolean;
    order: number;
    indentationLevel?: number;
    parentTask?: { id: string }[];
    subTasks?: { id: string }[];
}

/**
 * Determines which tasks from a series should be displayed for a specific date
 * based on the "Rolling Queue" logic + Future Simulation.
 * * Returns:
 * - Task[]: The list of tasks for the date.
 * - []: An empty array if the series is active but today is a break day.
 * - null: If the series is NOT active for this date (before start, finished, or not scheduled).
 */
export function getTasksForDate(
    allTasks: Task[],
    rruleString: string | null,
    startDateString: string,
    viewDate: Date,
    seriesStartDateString?: string | null // <--- New Argument
): Task[] {
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

    // --- NEW LOGIC: Check Series Start Date ---
    // If the series hasn't started yet relative to the view date, show nothing
    // (unless we caught historical data above).
    if (seriesStartDateString) {
        const seriesStart = toUTCDate(new Date(seriesStartDateString));
        if (utcViewDate.getTime() < seriesStart.getTime()) {
            return []; //series hasn't started yet
        }
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

    // --- TRIM TRAILING BREAKS ---
    // We ignore breaks at the very end of the series so they don't create dangling empty days.
    while (pendingTasks.length > 0 && pendingTasks[pendingTasks.length - 1].isDayBreak) {
        pendingTasks.pop();
    }

    if (pendingTasks.length === 0) return []; // Series is completely finished

    // 4. Group remaining work into "Day Blocks"
    // A block is a sequence of tasks terminated by an isDayBreak (or end of list).
    const blocks: Task[][] = [];
    let currentBlock: Task[] = [];

    for (const task of pendingTasks) {
        if (task.isDayBreak) {
            // End of block.
            // Push currentBlock even if empty. This allows back-to-back breaks to create
            // explicit "Rest Days" (empty blocks) in the schedule sequence.
            blocks.push(currentBlock);
            currentBlock = [];

            // DayBreaks themselves are usually invisible structural markers,
            // but if you want to visualize them, add them here. We skip them for the UI list.
        } else {
            currentBlock.push(task);
        }
    }
    // Push the final block if exists
    if (currentBlock.length > 0) blocks.push(currentBlock);

    // --- NEW LOGIC: Determine Anchor Date ---
    // The "queue" starts rolling from Today OR the Series Start Date, whichever is later.
    let anchorDate = today;
    if (seriesStartDateString) {
        const seriesStart = toUTCDate(new Date(seriesStartDateString));
        if (seriesStart.getTime() > today.getTime()) {
            anchorDate = seriesStart;
        }
    }

    // 5. Handle "Current Active Block" (Anchor Date)
    // If we are viewing the anchor date (Today, or the future Start Date), show the first block.
    if (utcViewDate.getTime() === anchorDate.getTime()) {
        // Return the first block of uncompleted work
        // Note: You might also want to append tasks completed *today* to the top of this list
        // so they don't disappear instantly upon checking.
        const finishedToday = sortedTasks.filter((t) => {
            if (!t.isCompleted || !t.completedAt) return false;
            const cDate = toUTCDate(new Date(t.completedAt));
            return cDate.getTime() === today.getTime();
        });

        // blocks[0] contains items from 'pendingTasks'.
        // 'pendingTasks' (from Step 3) deliberately includes tasks completed today.
        // Therefore, we must filter blocks[0] to prevent duplicating items already in 'finishedToday'.
        const remainingInBlock = (blocks[0] || []).filter((t) => !t.isCompleted);

        return [...finishedToday, ...remainingInBlock];
    }

    // 6. Handle Future Dates (Simulation)
    if (utcViewDate.getTime() > anchorDate.getTime()) {
        // If not recurring, it might just be the specific start date
        // But assuming RRule for series:
        if (!rruleString) {
            // If manual date match, maybe show next block?
            // For now return empty if no pattern logic
            return [];
        }

        const rrule = createRRuleWithStartDate(rruleString, startDateString);
        if (!rrule) return [];

        // Get occurrences starting from the Anchor Date
        // (Anchor Date is handled in step 5, so we look for occurrences > anchor)
        // We add a large buffer (e.g. 1 year) or just enough to catch the viewDate.
        // Optimization: Just check if viewDate is an occurrence.

        // However, to know WHICH block to show, we need the *sequence* of occurrences.
        // 1. Get all occurrences from Anchor Date until ViewDate.
        const relevantOccurrences = rrule.between(anchorDate, toUTCDate(new Date(utcViewDate.getTime() + 1000)), true);

        // relevantOccurrences includes Anchor Date if it matches.
        // Index 0 = Anchor Date (if scheduled) -> Block 0
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

// --- NEW Helper: Recursive Completion Transactions ---
export function getRecursiveTaskCompletionTransactions(taskId: string, isCompleted: boolean, allTasks: Task[]): any[] {
    const transactions: any[] = [];
    const now = new Date();

    // Helper map for fast lookups
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));

    // Recursive function to mark parents
    function processTask(currentId: string, status: boolean) {
        const task = taskMap.get(currentId);
        if (!task) return;

        // 1. Update Current Task
        transactions.push(
            tx.tasks[currentId].update({
                isCompleted: status,
                completedAt: status ? now : null,
            })
        );

        // Update local state in map for subsequent logic
        task.isCompleted = status;

        const parentId = task.parentTask?.[0]?.id;
        if (!parentId) return;

        const parent = taskMap.get(parentId);
        if (!parent) return;

        // 2. Decide if parent state needs to change
        if (status === false) {
            // Trickle Down: If child becomes incomplete, parent MUST be incomplete.
            if (parent.isCompleted) {
                processTask(parentId, false);
            }
        } else {
            // Bubble Up: If child becomes complete, check if ALL siblings are complete.
            // Find all children of this parent
            // Since we don't have explicit 'subTasks' loaded in the map keys sometimes, we rely on parentTask inverse.
            // But here we iterate allTasks to find siblings.
            const siblings = allTasks.filter((t) => t.parentTask?.[0]?.id === parentId);

            const allSiblingsDone = siblings.every((s) => s.isCompleted);

            if (allSiblingsDone && !parent.isCompleted) {
                processTask(parentId, true);
            }
        }
    }

    processTask(taskId, isCompleted);
    return transactions;
}
