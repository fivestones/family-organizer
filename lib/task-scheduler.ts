// lib/task-scheduler.ts
import { RRule } from 'rrule';
import { toUTCDate, createRRuleWithStartDate } from './chore-utils';
import { tx } from '@instantdb/react';

export interface Task {
    id: string;
    text: string;
    isCompleted: boolean;
    completedAt?: string;
    completedOnDate?: string; // <--- NEW FIELD
    isDayBreak: boolean;
    order: number;
    indentationLevel?: number;
    parentTask?: { id: string }[];
    subTasks?: { id: string }[];
}

// FIX: Helper to convert any timestamp (string or date) into a Date object representing
// Midnight of that day in the LOCAL timezone, but stored as a UTC object.
// This ensures comparisons align with "Today" relative to the user, not strict UTC.
// Example: Nov 29 11:00 PM CST -> Nov 29 00:00 UTC (Stored)
function toLocalMidnight(dateInput: Date | string): Date {
    const d = new Date(dateInput);
    return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
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
    seriesStartDateString?: string | null
): Task[] {
    const utcViewDate = toUTCDate(viewDate);
    const viewDateString = utcViewDate.toISOString().slice(0, 10); // "YYYY-MM-DD"
    const today = toLocalMidnight(new Date());

    // 1. Sort tasks by order
    const sortedTasks = [...allTasks].sort((a, b) => (a.order || 0) - (b.order || 0));

    // 2. Handle Past Dates (Historical Record)
    // If viewing a past date, only show tasks specifically completed on that date.
    if (utcViewDate.getTime() < today.getTime()) {
        return sortedTasks.filter((t) => {
            // Priority 1: Check Sticky Date (Robust)
            if (t.isCompleted && t.completedOnDate) {
                return t.completedOnDate === viewDateString;
            }
            // Priority 2: Legacy Check (Fallback for old data)
            if (t.isCompleted && t.completedAt) {
                const completedDate = toLocalMidnight(t.completedAt);
                return completedDate.getTime() === utcViewDate.getTime();
            }
            return false;
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
        if (!t.isCompleted) return true;

        // IF COMPLETED: Should we show it today?
        // Yes, if it was completed FOR today (or historically on today).

        // Priority 1: Check Sticky Date
        if (t.completedOnDate) {
            // Show if it matches the current view date (which is Today/Future in this block logic)
            return t.completedOnDate === viewDateString;
        }

        // Priority 2: Legacy Check
        if (t.completedAt) {
            // FIX: Use toLocalMidnight so late-night completions count as "Today"
            const cDate = toLocalMidnight(t.completedAt);
            // In the "Pending Queue" logic, we typically look relative to 'today' (Local)
            // But if we are viewing a specific date, we should match that.
            // However, the original logic compared to 'today' to keep items visible immediately after checking.
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
        // Find tasks completed today that might have been filtered out of pendingTasks if logic changed,
        // but strictly speaking pendingTasks (step 3) already includes today's completions.
        // However, we want to ensure we don't show duplicates or miss things.

        // Retrieve items from pendingTasks (which includes today's completed items + future items in block 0)
        // Since step 3 already kept "Today's Completed Items", blocks[0] should contain them.

        // Safety filter to ensure we strictly have block 0
        return blocks[0] || [];
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

/**
 * Checks if the given viewDate falls within the "Active Range" of a task series.
 * The Active Range is defined as:
 * - Start: Date of the FIRST non-break task (completed or projected).
 * - End: Date of the LAST non-break task (completed or projected).
 * * Returns TRUE if:
 * 1. viewDate is between Start and End (inclusive).
 * 2. viewDate is a valid scheduled occurrence for the Chore.
 */
export function isSeriesActiveForDate(
    allTasks: Task[],
    rruleString: string | null,
    choreStartDateString: string,
    viewDate: Date,
    seriesStartDateString?: string | null
): boolean {
    if (!allTasks || allTasks.length === 0) return false;

    const utcViewDate = toUTCDate(viewDate);
    const viewDateString = utcViewDate.toISOString().slice(0, 10);
    const today = toLocalMidnight(new Date());
    const sortedTasks = [...allTasks].sort((a, b) => (a.order || 0) - (b.order || 0));

    // 1. Check if viewDate is a scheduled occurrence (Fundamental check)
    // If it's not a scheduled day, the label should never show.
    const rrule = createRRuleWithStartDate(rruleString, choreStartDateString);
    if (!rrule && toUTCDate(new Date(choreStartDateString)).getTime() !== utcViewDate.getTime()) {
        return false; // Not start date and no rrule
    }
    if (rrule) {
        const isScheduled = rrule.between(utcViewDate, toUTCDate(new Date(utcViewDate.getTime() + 1000)), true).length > 0;
        if (!isScheduled) return false;
    }

    // 2. Identify First and Last "Real" Tasks
    // We ignore dayBreaks for determining the start/end of the series content.
    const firstRealTask = sortedTasks.find((t) => !t.isDayBreak);
    const lastRealTask = [...sortedTasks].reverse().find((t) => !t.isDayBreak);

    if (!firstRealTask || !lastRealTask) return false; // Series is only breaks?

    // 3. Determine Series Anchor Date (Projection Start)
    let anchorDate = today;
    if (seriesStartDateString) {
        const seriesStart = toUTCDate(new Date(seriesStartDateString));
        if (seriesStart.getTime() > today.getTime()) {
            anchorDate = seriesStart;
        }
    }

    // --- Helper: Calculate Date for a Specific Task ---
    const getTaskDate = (task: Task): number | null => {
        // A. If Completed
        if (task.isCompleted) {
            // FIX: Priority check to completedOnDate
            if (task.completedOnDate) {
                return toUTCDate(new Date(task.completedOnDate)).getTime();
            }
            if (task.completedAt) {
                return toLocalMidnight(task.completedAt).getTime();
            }
        }

        // B. If Pending: Project future date
        // 1. Filter tasks to just the "Pending Queue" (not completed before today)
        //    (Logic must match getTasksForDate queue logic)
        const pendingQueue = sortedTasks.filter((t) => {
            if (!t.isCompleted) return true;
            // Matches getTasksForDate filtering logic
            if (t.completedOnDate) return t.completedOnDate === toUTCDate(today).toISOString().slice(0, 10);
            if (t.completedAt) return toLocalMidnight(t.completedAt).getTime() === today.getTime();
            return false;
        });

        // 2. Find where our target task sits in this queue
        const taskIndexInQueue = pendingQueue.findIndex((t) => t.id === task.id);
        if (taskIndexInQueue === -1) return null; // Should not happen if logic is consistent

        // 3. Calculate "Block Distance" (how many breaks precede it)
        let blockIndex = 0;
        for (let i = 0; i < taskIndexInQueue; i++) {
            if (pendingQueue[i].isDayBreak) {
                blockIndex++;
            }
        }

        // 4. Map Block Index to RRule Occurrences
        if (!rrule) {
            // No rrule: All pending blocks fall on Anchor Date? Or just valid for one day?
            return blockIndex === 0 ? anchorDate.getTime() : null;
        }

        // We need the (blockIndex)-th occurrence starting from AnchorDate.
        // We fetch enough occurrences to cover the index.
        // Optimization: limit the range to 5 years to avoid infinite loops on high indices.
        const occurrences = rrule.between(anchorDate, new Date(anchorDate.getTime() + 1000 * 60 * 60 * 24 * 365 * 5), true, (_, i) => i <= blockIndex);

        const targetDate = occurrences[blockIndex];
        return targetDate ? toUTCDate(targetDate).getTime() : null;
    };

    const firstTaskDate = getTaskDate(firstRealTask);
    const lastTaskDate = getTaskDate(lastRealTask);

    if (firstTaskDate === null || lastTaskDate === null) return false;

    // 4. Final Range Check
    const viewTime = utcViewDate.getTime();
    return viewTime >= firstTaskDate && viewTime <= lastTaskDate;
}

// --- Recursive Completion Transactions ---
// FIX: Added 'completedOnDateStr' parameter
export function getRecursiveTaskCompletionTransactions(
    taskId: string,
    isCompleted: boolean,
    allTasks: Task[],
    completedOnDateStr: string // <--- REQUIRED: YYYY-MM-DD of the view
): any[] {
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
                completedOnDate: status ? completedOnDateStr : null, // <--- SAVE IT
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
