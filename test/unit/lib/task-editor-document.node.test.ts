import { describe, expect, it } from 'vitest';
import { restorePersistedTaskNodes } from '@/lib/task-editor-document';

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
