// lib/task-scheduler.ts
import { RRule } from 'rrule';
import { toUTCDate, createRRuleWithStartDate } from './chore-utils';
import { tx } from '@instantdb/react';

export interface Task {
    id: string;
    text: string;
    isCompleted: boolean;
    completedAt?: string;
    completedOnDate?: string;
    childTasksComplete?: boolean;
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
    // Explicitly use Local components to construct UTC 00:00
    // This effectively "shifts" Local Midnight to UTC Midnight
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
    // 1. Normalize dates
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

    // --- Trim leading ghost breaks ---
    // If pendingTasks starts with a DayBreak, check if it belongs to a previous (completed) task.
    if (pendingTasks.length > 0 && pendingTasks[0].isDayBreak) {
        const firstPendingId = pendingTasks[0].id;
        const allIndex = sortedTasks.findIndex((t) => t.id === firstPendingId);

        if (allIndex > 0) {
            const prevTask = sortedTasks[allIndex - 1];
            // If the task immediately before this break is NOT a break (it was real work)
            // AND it is completed (filtered out of pending), then this break is a "ghost" tail.
            if (!prevTask.isDayBreak && prevTask.isCompleted) {
                pendingTasks.shift();
            }
        }
    }

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

    // Logic Fix: Even if seriesStart is in future, if we are viewing Today,
    // we should align anchor to today if the series is active.
    // But sticking to original logic:
    if (seriesStartDateString) {
        const seriesStart = toUTCDate(new Date(seriesStartDateString));
        if (seriesStart.getTime() > today.getTime()) {
            anchorDate = seriesStart;
        }
    }

    // DEBUG: Log mismatch if detected
    if (utcViewDate.getTime() !== anchorDate.getTime() && Math.abs(utcViewDate.getTime() - anchorDate.getTime()) < 86400000) {
        // console.log(`[Scheduler Debug] View: ${utcViewDate.toISOString()}, Anchor: ${anchorDate.toISOString()}, Today: ${today.toISOString()}`);
    }

    // 8. "Current Block" Logic
    // If viewing the Anchor Date (usually Today), show Block 0 (Next Pending)
    if (utcViewDate.getTime() === anchorDate.getTime()) {
        // Find tasks completed today that might have been filtered out of pendingTasks if logic changed,
        // but strictly speaking pendingTasks (step 3) already includes today's completions.
        // However, we want to ensure we don't show duplicates or miss things.

        // Retrieve items from pendingTasks (which includes today's completed items + future items in block 0)
        // Since step 3 already kept "Today's Completed Items", blocks[0] should contain them.

        // Safety filter to ensure we strictly have block 0
        return blocks[0] || [];
    }

    // 9. Handle Future Dates Logic
    if (utcViewDate.getTime() > anchorDate.getTime()) {
        if (!rruleString) return [];

        const rrule = createRRuleWithStartDate(rruleString, startDateString);
        if (!rrule) return [];

        // Find occurrences starting from Anchor Date
        const relevantOccurrences = rrule.between(anchorDate, toUTCDate(new Date(utcViewDate.getTime() + 1000)), true);

        // Find the index of the viewDate in the sequence
        const occurrenceIndex = relevantOccurrences.findIndex((d) => toUTCDate(d).getTime() === utcViewDate.getTime());

        // --- FIX: Logic shift based on whether Anchor Date is ITSELF a scheduled day ---
        // Block 0 is ALWAYS shown on the *next available scheduled day* starting from Anchor Date.
        // If Anchor Date IS scheduled, Block 0 belongs to Anchor Date.
        // If Anchor Date IS NOT scheduled (e.g. today is Wed, schedule is Mon/Thu),
        // Block 0 belongs to the *first occurrence* after today (Thu).

        // We need to know if relevantOccurrences[0] represents the Anchor Date or a future date.
        // But regardless, relevantOccurrences[0] corresponds to Block 0.
        // So if viewDate is found at index `k`, it corresponds to Block `k`.

        if (occurrenceIndex === -1) return []; // The chore isn't scheduled for this future date

        // However, we must ensure we don't show "Past/Current" blocks for future dates if the queue hasn't advanced.
        // The blocks[] array represents "Remaining Work".
        // Block 0 is "Work to be done next".

        // If Anchor Date is Today, and Today is scheduled:
        // - Today shows Block 0.
        // - Next occurrence shows Block 1.

        // If Anchor Date is Today, and Today is NOT scheduled:
        // - Next occurrence (e.g. Thu) shows Block 0.

        // This simple indexing works! occurrenceIndex 0 -> Block 0.

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
    const rrule = createRRuleWithStartDate(rruleString, choreStartDateString);

    // 1. Basic Schedule Check
    if (!rrule && toUTCDate(new Date(choreStartDateString)).getTime() !== utcViewDate.getTime()) {
        return false;
    }
    if (rrule) {
        const isScheduled = rrule.between(utcViewDate, toUTCDate(new Date(utcViewDate.getTime() + 1000)), true).length > 0;

        if (!isScheduled) return false;
    }

    // 2. Series Range Check
    // ... (Keep existing range check logic)
    const sortedTasks = [...allTasks].sort((a, b) => (a.order || 0) - (b.order || 0));
    const firstRealTask = sortedTasks.find((t) => !t.isDayBreak);
    const lastRealTask = [...sortedTasks].reverse().find((t) => !t.isDayBreak);

    if (!firstRealTask || !lastRealTask) return false;

    const today = toLocalMidnight(new Date());
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

        // --- Trim leading ghost breaks (Must match getTasksForDate logic) ---
        if (pendingQueue.length > 0 && pendingQueue[0].isDayBreak) {
            const firstPendingId = pendingQueue[0].id;
            const allIndex = sortedTasks.findIndex((t) => t.id === firstPendingId);
            if (allIndex > 0) {
                const prevTask = sortedTasks[allIndex - 1];
                if (!prevTask.isDayBreak && prevTask.isCompleted) {
                    pendingQueue.shift();
                }
            }
        }

        // 2. Find where our target task sits in this queue
        const taskIndexInQueue = pendingQueue.findIndex((t) => t.id === task.id);
        if (taskIndexInQueue === -1) return null; // Should not happen if logic is consistent

        // 3. Calculate "Block Distance" (how many breaks precede it)
        let blockIndex = 0;
        for (let i = 0; i < taskIndexInQueue; i++) {
            if (pendingQueue[i].isDayBreak) blockIndex++;
        }

        if (!rrule) return blockIndex === 0 ? anchorDate.getTime() : null;

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

// ... (Keep getRecursiveTaskCompletionTransactions as is) ...
// Copy the existing getRecursiveTaskCompletionTransactions function here
export function getRecursiveTaskCompletionTransactions(taskId: string, isCompleted: boolean, allTasks: Task[], completedOnDateStr: string): any[] {
    const transactions: any[] = [];
    const now = new Date();

    // 1. Create a Mutable Map of the current state
    // We must update objects in this map as we go so subsequent checks (parents checking children)
    // see the *future* state of the tree within this transaction block.
    const taskMap = new Map<string, Task>();
    allTasks.forEach((t) => taskMap.set(t.id, { ...t }));

    // 2. Update the Target Task (The one the user clicked)
    const targetTask = taskMap.get(taskId);
    if (!targetTask) return [];

    // Update in-memory state
    targetTask.isCompleted = isCompleted;
    if (isCompleted) {
        targetTask.completedAt = now.toISOString();
        targetTask.completedOnDate = completedOnDateStr;
    } else {
        // When unchecking, clear dates
        targetTask.completedAt = undefined;
        targetTask.completedOnDate = undefined;
    }

    // Add transaction to persist this specific change
    transactions.push(
        tx.tasks[taskId].update({
            isCompleted: isCompleted,
            completedAt: isCompleted ? now : null,
            completedOnDate: isCompleted ? completedOnDateStr : null,
        })
    );

    // 3. Bubble Up Logic: "ChildTasksComplete"
    // We only need to check the ancestors of the modified task.
    let currentTask = targetTask;

    // Safety depth to prevent infinite loops in malformed cyclic trees
    let depth = 0;
    while (currentTask.parentTask && currentTask.parentTask.length > 0 && depth < 50) {
        const parentId = currentTask.parentTask[0].id;
        const parent = taskMap.get(parentId);

        if (!parent) break;

        // Find ALL immediate children of this parent from our (potentially updated) map
        // We look for tasks that point to this parent
        const children = Array.from(taskMap.values()).filter((t) => t.parentTask?.[0]?.id === parentId);

        // THE GOLDEN RULE:
        // Parent's 'childTasksComplete' is TRUE if and only if:
        // Every child is (isCompleted === true AND childTasksComplete === true)
        // Note: For leaf nodes, 'childTasksComplete' defaults to true (handled in Editor/Creation).
        // If a child is a leaf, we just check child.isCompleted && child.childTasksComplete (which should be true).

        const allChildrenFinished = children.every((child) => {
            // A child is finished if it is checked off...
            const isDone = child.isCompleted;
            // ...AND its own subtree is finished.
            // (If child.childTasksComplete is undefined, treat as true for safety/legacy,
            // but ideally it's initialized).
            const isSubtreeDone = child.childTasksComplete !== false;

            return isDone && isSubtreeDone;
        });

        // Did the status change?
        if (parent.childTasksComplete !== allChildrenFinished) {
            // Update in-memory map for the next loop iteration (grandparent check)
            parent.childTasksComplete = allChildrenFinished;

            // Add to transaction list
            transactions.push(
                tx.tasks[parent.id].update({
                    childTasksComplete: allChildrenFinished,
                })
            );
        }

        // Move up
        currentTask = parent;
        depth++;
    }

    return transactions;
}
