interface PersistedEditorTask {
    id: string;
    text?: string | null;
    order?: number | null;
    indentationLevel?: number | null;
    isDayBreak?: boolean | null;
}

interface EditorDocument {
    type?: string;
    content?: any[];
    [key: string]: unknown;
}

interface PersistedSchedulerTask extends PersistedEditorTask {
    isCompleted?: boolean | null;
    workflowState?: string | null;
    lastActiveState?: string | null;
    completedAt?: string | null;
    completedOnDate?: string | null;
}

export type AdjacentTaskDayDirection = 'previous' | 'next';

type AdjacentDayMovePlan = {
    startIndex: number;
    endIndex: number;
    breakIndex: number;
    rootIndentation: number;
};

const getAdjacentDayMovePlan = (
    document: EditorDocument,
    taskId: string,
    direction: AdjacentTaskDayDirection
): AdjacentDayMovePlan | null => {
    const content = document.content || [];
    const startIndex = content.findIndex(
        (node) => node?.type === 'taskItem' && node?.attrs?.id === taskId && node?.attrs?.isDayBreak !== true
    );
    if (startIndex < 0) return null;

    const rootIndentation = Number(content[startIndex]?.attrs?.indentationLevel || 0);
    let endIndex = startIndex + 1;
    while (endIndex < content.length) {
        const candidate = content[endIndex];
        if (candidate?.type !== 'taskItem' || candidate?.attrs?.isDayBreak === true) break;
        if (Number(candidate?.attrs?.indentationLevel || 0) <= rootIndentation) break;
        endIndex += 1;
    }

    if (direction === 'previous') {
        for (let index = startIndex - 1; index >= 0; index -= 1) {
            if (content[index]?.type === 'taskItem' && content[index]?.attrs?.isDayBreak === true) {
                return { startIndex, endIndex, breakIndex: index, rootIndentation };
            }
        }
        return null;
    }

    for (let index = endIndex; index < content.length; index += 1) {
        if (content[index]?.type === 'taskItem' && content[index]?.attrs?.isDayBreak === true) {
            return { startIndex, endIndex, breakIndex: index, rootIndentation };
        }
    }
    return null;
};

/**
 * Move one task and its descendant nodes across the nearest day break. A nested
 * task becomes a destination-day root while its descendants retain their
 * relative indentation, preventing a hidden parent link across day blocks.
 */
export function moveTaskSubtreeToAdjacentDay(
    document: EditorDocument,
    taskId: string,
    direction: AdjacentTaskDayDirection
): EditorDocument | null {
    const plan = getAdjacentDayMovePlan(document, taskId, direction);
    if (!plan) return null;

    const content = [...(document.content || [])];
    const movingNodes = content
        .slice(plan.startIndex, plan.endIndex)
        .map((node) => ({
            ...node,
            attrs: {
                ...(node.attrs || {}),
                indentationLevel: Math.max(0, Number(node.attrs?.indentationLevel || 0) - plan.rootIndentation),
            },
        }));
    const movingCount = plan.endIndex - plan.startIndex;
    content.splice(plan.startIndex, movingCount);

    let insertionIndex = direction === 'previous' ? plan.breakIndex : plan.breakIndex + 1;
    if (insertionIndex > plan.startIndex) insertionIndex -= movingCount;
    content.splice(insertionIndex, 0, ...movingNodes);

    return { ...document, type: document.type || 'doc', content };
}

/**
 * Project the current editor JSON into scheduler-shaped tasks without reading
 * TipTap/ProseMirror private node arrays. Persisted workflow state is retained,
 * while order, text, breaks, and hierarchy come from the document being saved.
 */
export function buildSchedulerTasksFromEditorDocument(
    document: EditorDocument,
    persistedTasks: PersistedSchedulerTask[]
) {
    const persistedById = new Map(persistedTasks.map((task) => [task.id, task]));
    const stack: Array<{ id: string; indentationLevel: number }> = [];
    const schedulerTasks: Array<PersistedSchedulerTask & {
        text: string;
        order: number;
        indentationLevel: number;
        isDayBreak: boolean;
        isCompleted: boolean;
        parentTask: Array<{ id: string }>;
    }> = [];

    const content = document.content || [];
    for (let order = 0; order < content.length; order += 1) {
        const node = content[order];
        if (node?.type !== 'taskItem') continue;

        const id = typeof node.attrs?.id === 'string' && node.attrs.id ? node.attrs.id : `draft-${order}`;
        const indentationLevel = Number(node.attrs?.indentationLevel || 0);
        const isDayBreak = Boolean(node.attrs?.isDayBreak);
        const persisted = persistedById.get(id);

        while (stack.length > 0 && stack[stack.length - 1].indentationLevel >= indentationLevel) {
            stack.pop();
        }
        const parent = isDayBreak ? null : stack[stack.length - 1] || null;

        schedulerTasks.push({
            ...persisted,
            id,
            text: isDayBreak ? '' : node.content?.find((child: any) => child?.type === 'text')?.text || '',
            order,
            indentationLevel,
            isDayBreak,
            isCompleted: persisted?.isCompleted === true,
            parentTask: parent ? [{ id: parent.id }] : [],
        });

        if (isDayBreak) {
            stack.length = 0;
        } else {
            stack.push({ id, indentationLevel });
        }
    }

    return schedulerTasks;
}

/** Restore protected persisted tasks into their original document positions. */
export function restorePersistedTaskNodes(
    document: EditorDocument,
    tasks: PersistedEditorTask[]
): EditorDocument {
    const content = [...(document.content || [])];
    const existingIds = new Set(
        content
            .filter((node) => node?.type === 'taskItem' && node?.attrs?.id)
            .map((node) => node.attrs.id as string)
    );

    for (const task of [...tasks].sort((left, right) => (left.order || 0) - (right.order || 0))) {
        if (!task.id || existingIds.has(task.id)) continue;
        const isDayBreak = task.isDayBreak === true;
        const node = {
            type: 'taskItem',
            attrs: {
                id: task.id,
                indentationLevel: task.indentationLevel || 0,
                isDayBreak,
            },
            ...(!isDayBreak && task.text
                ? { content: [{ type: 'text', text: task.text }] }
                : {}),
        };
        const insertAt = Math.max(0, Math.min(task.order || 0, content.length));
        content.splice(insertAt, 0, node);
        existingIds.add(task.id);
    }

    return { ...document, type: document.type || 'doc', content };
}
