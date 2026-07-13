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
