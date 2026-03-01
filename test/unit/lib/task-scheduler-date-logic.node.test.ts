import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freezeTime } from '@/test/utils/fake-clock';

const instantMocks = vi.hoisted(() => ({
    tx: new Proxy(
        {},
        {
            get(_root, entity: string) {
                return new Proxy(
                    {},
                    {
                        get(_entityObj, id: string) {
                            return {
                                update(payload: unknown) {
                                    return { op: 'update', entity, id, payload };
                                },
                            };
                        },
                    }
                );
            },
        }
    ),
}));

vi.mock('@instantdb/react', () => ({
    tx: instantMocks.tx,
}));

vi.mock('@/lib/db', () => ({
    db: {},
}));

import { getRecursiveTaskCompletionTransactions, getTasksForDate, isSeriesActiveForDate, type Task } from '@/lib/task-scheduler';

function makeTask(overrides: Partial<Task> & Pick<Task, 'id' | 'text' | 'order'>): Task {
    return {
        id: overrides.id,
        text: overrides.text,
        order: overrides.order,
        isCompleted: false,
        isDayBreak: false,
        ...overrides,
    };
}

describe('task-scheduler date logic', () => {
    beforeEach(() => {
        freezeTime(new Date(2026, 2, 10, 12, 0, 0));
    });

    it('returns only tasks completed on a historical date before the anchor', () => {
        const tasks: Task[] = [
            makeTask({ id: 't1', text: 'Completed on Mar 8', order: 1, isCompleted: true, completedOnDate: '2026-03-08' }),
            makeTask({ id: 't2', text: 'Completed today', order: 2, isCompleted: true, completedOnDate: '2026-03-10' }),
            makeTask({ id: 't3', text: 'Pending', order: 3 }),
        ];

        const result = getTasksForDate(tasks, 'FREQ=DAILY', '2026-03-01', new Date(2026, 2, 8, 12, 0, 0));

        expect(result.map((task) => task.id)).toEqual(['t1']);
    });

    it('projects future blocks by day breaks on recurring schedules', () => {
        const tasks: Task[] = [
            makeTask({ id: 'a', text: 'Block A', order: 1 }),
            makeTask({ id: 'br1', text: 'Break', order: 2, isDayBreak: true }),
            makeTask({ id: 'b', text: 'Block B', order: 3 }),
            makeTask({ id: 'br2', text: 'Break', order: 4, isDayBreak: true }),
            makeTask({ id: 'c', text: 'Block C', order: 5 }),
        ];

        const onAnchor = getTasksForDate(tasks, 'FREQ=DAILY', '2026-03-01', new Date(2026, 2, 10, 12, 0, 0));
        const nextDay = getTasksForDate(tasks, 'FREQ=DAILY', '2026-03-01', new Date(2026, 2, 11, 12, 0, 0));
        const twoDaysLater = getTasksForDate(tasks, 'FREQ=DAILY', '2026-03-01', new Date(2026, 2, 12, 12, 0, 0));

        expect(onAnchor.map((task) => task.id)).toEqual(['a']);
        expect(nextDay.map((task) => task.id)).toEqual(['b']);
        expect(twoDaysLater.map((task) => task.id)).toEqual(['c']);
    });

    it('treats only scheduled dates inside the projected task range as active', () => {
        freezeTime(new Date(2026, 2, 2, 12, 0, 0)); // Monday

        const tasks: Task[] = [
            makeTask({ id: 'a', text: 'Block A', order: 1 }),
            makeTask({ id: 'br1', text: 'Break', order: 2, isDayBreak: true }),
            makeTask({ id: 'b', text: 'Block B', order: 3 }),
        ];

        expect(isSeriesActiveForDate(tasks, 'FREQ=WEEKLY;BYDAY=MO,WE', '2026-03-02', new Date(2026, 2, 3, 12, 0, 0))).toBe(false); // Tue
        expect(isSeriesActiveForDate(tasks, 'FREQ=WEEKLY;BYDAY=MO,WE', '2026-03-02', new Date(2026, 2, 4, 12, 0, 0))).toBe(true); // Wed
        expect(isSeriesActiveForDate(tasks, 'FREQ=WEEKLY;BYDAY=MO,WE', '2026-03-02', new Date(2026, 2, 9, 12, 0, 0))).toBe(false); // next Mon, past range
    });

    it('returns no tasks for future dates that are not scheduled occurrences', () => {
        const tasks: Task[] = [makeTask({ id: 'a', text: 'Block A', order: 1 })];

        const result = getTasksForDate(tasks, 'FREQ=WEEKLY;BYDAY=MO', '2026-03-02', new Date(2026, 2, 11, 12, 0, 0)); // Wed

        expect(result).toEqual([]);
    });

    it('keeps block 0 visible on an unscheduled anchor day and projects future scheduled occurrences from there', () => {
        freezeTime(new Date(2026, 2, 10, 12, 0, 0)); // Tue

        const tasks: Task[] = [
            makeTask({ id: 'a', text: 'Block A', order: 1 }),
            makeTask({ id: 'break', text: 'Break', order: 2, isDayBreak: true }),
            makeTask({ id: 'b', text: 'Block B', order: 3 }),
        ];

        const today = getTasksForDate(tasks, 'FREQ=WEEKLY;BYDAY=MO,TH', '2026-03-02', new Date(2026, 2, 10, 12, 0, 0)); // Tue (anchor, unscheduled)
        const thursday = getTasksForDate(tasks, 'FREQ=WEEKLY;BYDAY=MO,TH', '2026-03-02', new Date(2026, 2, 12, 12, 0, 0)); // Thu (next scheduled)
        const nextMonday = getTasksForDate(tasks, 'FREQ=WEEKLY;BYDAY=MO,TH', '2026-03-02', new Date(2026, 2, 16, 12, 0, 0)); // Mon

        expect(today.map((task) => task.id)).toEqual(['a']);
        expect(thursday.map((task) => task.id)).toEqual(['a']);
        expect(nextMonday.map((task) => task.id)).toEqual(['b']);
    });

    it('trims a leading ghost day-break after a previously completed task', () => {
        const tasks: Task[] = [
            makeTask({ id: 'done', text: 'Done', order: 1, isCompleted: true, completedOnDate: '2026-03-09' }),
            makeTask({ id: 'break', text: 'Break', order: 2, isDayBreak: true }),
            makeTask({ id: 'next', text: 'Next Block', order: 3 }),
        ];

        const result = getTasksForDate(tasks, 'FREQ=DAILY', '2026-03-01', new Date(2026, 2, 10, 12, 0, 0));

        expect(result.map((task) => task.id)).toEqual(['next']);
    });

    it('trims trailing day-break markers so they do not create dangling empty future blocks', () => {
        const tasks: Task[] = [
            makeTask({ id: 'only', text: 'Only block', order: 1 }),
            makeTask({ id: 'tail-break', text: 'Tail break', order: 2, isDayBreak: true }),
        ];

        const anchor = getTasksForDate(tasks, 'FREQ=DAILY', '2026-03-01', new Date(2026, 2, 10, 12, 0, 0));
        const nextDay = getTasksForDate(tasks, 'FREQ=DAILY', '2026-03-01', new Date(2026, 2, 11, 12, 0, 0));

        expect(anchor.map((task) => task.id)).toEqual(['only']);
        expect(nextDay).toEqual([]);
    });

    it('marks a child complete and bubbles childTasksComplete to its parent when all children are done', () => {
        freezeTime(new Date('2026-03-10T09:15:00Z'));

        const tasks: Task[] = [
            makeTask({ id: 'parent', text: 'Parent', order: 1, childTasksComplete: false }),
            makeTask({
                id: 'child',
                text: 'Child',
                order: 2,
                childTasksComplete: true,
                parentTask: [{ id: 'parent' }],
            }),
        ];

        const txs = getRecursiveTaskCompletionTransactions('child', true, tasks, '2026-03-10') as any[];

        expect(txs).toHaveLength(2);
        expect(txs[0]).toMatchObject({
            entity: 'tasks',
            id: 'child',
            payload: expect.objectContaining({
                isCompleted: true,
                completedOnDate: '2026-03-10',
            }),
        });
        expect(txs[0].payload.completedAt).toBeInstanceOf(Date);
        expect(txs[0].payload.completedAt.toISOString()).toBe('2026-03-10T09:15:00.000Z');
        expect(txs[1]).toMatchObject({
            entity: 'tasks',
            id: 'parent',
            payload: { childTasksComplete: true },
        });
    });

    it('does not update parent childTasksComplete when another sibling is still incomplete', () => {
        const tasks: Task[] = [
            makeTask({ id: 'parent', text: 'Parent', order: 1, childTasksComplete: false }),
            makeTask({
                id: 'child-1',
                text: 'Child 1',
                order: 2,
                childTasksComplete: true,
                parentTask: [{ id: 'parent' }],
            }),
            makeTask({
                id: 'child-2',
                text: 'Child 2',
                order: 3,
                childTasksComplete: true,
                isCompleted: false,
                parentTask: [{ id: 'parent' }],
            }),
        ];

        const txs = getRecursiveTaskCompletionTransactions('child-1', true, tasks, '2026-03-10') as any[];

        expect(txs).toHaveLength(1);
        expect(txs[0]).toMatchObject({
            entity: 'tasks',
            id: 'child-1',
            payload: expect.objectContaining({ isCompleted: true }),
        });
    });

    it('unchecking a child clears completion metadata and bubbles childTasksComplete=false to ancestors', () => {
        freezeTime(new Date('2026-03-10T09:15:00Z'));

        const tasks: Task[] = [
            makeTask({ id: 'parent', text: 'Parent', order: 1, childTasksComplete: true }),
            makeTask({
                id: 'child',
                text: 'Child',
                order: 2,
                isCompleted: true,
                childTasksComplete: true,
                completedAt: '2026-03-10T08:00:00Z',
                completedOnDate: '2026-03-10',
                parentTask: [{ id: 'parent' }],
            }),
        ];

        const txs = getRecursiveTaskCompletionTransactions('child', false, tasks, '2026-03-10') as any[];

        expect(txs).toHaveLength(2);
        expect(txs[0]).toMatchObject({
            entity: 'tasks',
            id: 'child',
            payload: {
                isCompleted: false,
                completedAt: null,
                completedOnDate: null,
            },
        });
        expect(txs[1]).toMatchObject({
            entity: 'tasks',
            id: 'parent',
            payload: { childTasksComplete: false },
        });
    });
});
