import { describe, expect, it } from 'vitest';
import { buildTaskIdRepairPlan } from '@/lib/task-editor-ids';

describe('task editor ID repair', () => {
    it('keeps surviving document nodes and re-IDs pasted duplicates', () => {
        const ids = ['new-task', 'new-break'];
        const repairs = buildTaskIdRepairPlan(
            [
                { pos: 0, id: 'task-a' },
                { pos: 5, id: 'task-a' },
                { pos: 10, id: 'break-a' },
                { pos: 15, id: 'break-a' },
            ],
            new Set([0, 10]),
            () => ids.shift()!
        );

        expect(Array.from(repairs.entries())).toEqual([
            [5, 'new-task'],
            [15, 'new-break'],
        ]);
    });

    it('re-IDs every foreign or missing ID while avoiding generated collisions', () => {
        const ids = ['kept-id', 'foreign-copy', 'missing-copy'];
        const repairs = buildTaskIdRepairPlan(
            [
                { pos: 0, id: 'kept-id' },
                { pos: 5, id: 'foreign-id' },
                { pos: 10, id: null },
            ],
            new Set([0]),
            () => ids.shift()!
        );

        expect(Array.from(repairs.entries())).toEqual([
            [5, 'foreign-copy'],
            [10, 'missing-copy'],
        ]);
    });
});
