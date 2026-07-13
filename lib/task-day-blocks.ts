import { isActionableTask, type TaskProgressTaskLike } from '@/lib/task-progress';

type OrderedTaskLike = TaskProgressTaskLike & {
    order?: number | null;
};

/**
 * Split task definitions at day-break markers. Empty segments (leading,
 * trailing, or between consecutive markers) are intentionally ignored: a
 * task day exists only when it contains at least one actionable definition.
 */
export function splitTaskDayBlocks<T extends OrderedTaskLike>(allTasks: T[]): T[][] {
    const sortedTasks = [...allTasks].sort((left, right) => (left.order || 0) - (right.order || 0));
    const blocks: T[][] = [];
    let currentBlock: T[] = [];

    for (const task of sortedTasks) {
        if (task.isDayBreak) {
            if (currentBlock.length > 0) blocks.push(currentBlock);
            currentBlock = [];
            continue;
        }

        if (isActionableTask(task, sortedTasks)) {
            currentBlock.push(task);
        }
    }

    if (currentBlock.length > 0) blocks.push(currentBlock);
    return blocks;
}
