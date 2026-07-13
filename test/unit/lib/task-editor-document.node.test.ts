import { describe, expect, it } from 'vitest';
import { buildSchedulerTasksFromEditorDocument, restorePersistedTaskNodes } from '@/lib/task-editor-document';

describe('restorePersistedTaskNodes', () => {
    it('restores missing tasks in persisted order without duplicating existing nodes', () => {
        const result = restorePersistedTaskNodes(
            {
                type: 'doc',
                content: [
                    { type: 'taskItem', attrs: { id: 'first', indentationLevel: 0, isDayBreak: false } },
                    { type: 'taskItem', attrs: { id: 'last', indentationLevel: 0, isDayBreak: false } },
                ],
            },
            [
                { id: 'middle', text: 'Restored', order: 1, indentationLevel: 2, isDayBreak: false },
                { id: 'first', text: 'Do not duplicate', order: 0, indentationLevel: 0, isDayBreak: false },
            ]
        );

        expect(result.content?.map((node) => node.attrs.id)).toEqual(['first', 'middle', 'last']);
        expect(result.content?.[1]).toEqual({
            type: 'taskItem',
            attrs: { id: 'middle', indentationLevel: 2, isDayBreak: false },
            content: [{ type: 'text', text: 'Restored' }],
        });
    });
});

describe('buildSchedulerTasksFromEditorDocument', () => {
    it('uses current JSON order and hierarchy while retaining persisted workflow state', () => {
        const result = buildSchedulerTasksFromEditorDocument(
            {
                type: 'doc',
                content: [
                    {
                        type: 'taskItem',
                        attrs: { id: 'parent', indentationLevel: 0, isDayBreak: false },
                        content: [{ type: 'text', text: 'Current parent' }],
                    },
                    {
                        type: 'taskItem',
                        attrs: { id: 'new-child', indentationLevel: 1, isDayBreak: false },
                        content: [{ type: 'text', text: 'New child' }],
                    },
                    { type: 'taskItem', attrs: { id: 'break', indentationLevel: 0, isDayBreak: true } },
                    {
                        type: 'taskItem',
                        attrs: { id: 'done', indentationLevel: 0, isDayBreak: false },
                        content: [{ type: 'text', text: 'Finished task' }],
                    },
                ],
            },
            [
                { id: 'parent', text: 'Stale parent', order: 3, isDayBreak: false },
                { id: 'deleted', text: 'Deleted in editor', order: 0, isDayBreak: false },
                { id: 'done', text: 'Finished task', order: 1, isDayBreak: false, workflowState: 'done', isCompleted: true },
            ]
        );

        expect(result.map((task) => task.id)).toEqual(['parent', 'new-child', 'break', 'done']);
        expect(result[0]).toMatchObject({ text: 'Current parent', order: 0, parentTask: [] });
        expect(result[1]).toMatchObject({ order: 1, parentTask: [{ id: 'parent' }], isCompleted: false });
        expect(result[2]).toMatchObject({ order: 2, isDayBreak: true, parentTask: [] });
        expect(result[3]).toMatchObject({ order: 3, workflowState: 'done', isCompleted: true, parentTask: [] });
    });
});
