import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freezeTime } from '@/test/utils/fake-clock';
import { buildTaskProgressUpdateTransactions } from '@/lib/task-progress-mutations';

function makeTxProxy() {
    return new Proxy(
        {},
        {
            get(_root, entity: string) {
                return new Proxy(
                    {},
                    {
                        get(_entityObj, entityId: string) {
                            return {
                                update(payload: unknown) {
                                    return { op: 'update', entity, id: entityId, payload };
                                },
                                link(payload: unknown) {
                                    return { op: 'link', entity, id: entityId, payload };
                                },
                            };
                        },
                    }
                );
            },
        }
    );
}

function makeTask(overrides: Record<string, unknown> = {}) {
    return {
        id: 'task-1',
        text: 'Task',
        order: 0,
        isDayBreak: false,
        isCompleted: false,
        workflowState: 'not_started',
        lastActiveState: 'not_started',
        ...overrides,
    } as any;
}

describe('task-progress-mutations', () => {
    beforeEach(() => {
        freezeTime(new Date('2026-03-10T09:15:00.000Z'));
    });

    it('creates a restore update that defers the task until the next scheduled day', () => {
        const tx = makeTxProxy();
        const task = makeTask({
            id: 'task-blocked',
            workflowState: 'blocked',
            lastActiveState: 'in_progress',
        });

        const transactions = buildTaskProgressUpdateTransactions({
            tx,
            createId: vi.fn()
                .mockReturnValueOnce('entry-1')
                .mockReturnValueOnce('unused'),
            taskId: 'task-blocked',
            allTasks: [task],
            nextState: 'in_progress',
            selectedDateKey: '2026-03-10',
            actorFamilyMemberId: 'member-1',
            restoreTiming: 'next_scheduled',
            schedule: {
                startDate: '2026-03-01',
                rrule: 'FREQ=DAILY',
                exdates: [],
            },
            referenceDate: new Date('2026-03-10T12:00:00.000Z'),
        }) as any[];

        expect(transactions[0]).toMatchObject({
            entity: 'tasks',
            id: 'task-blocked',
            payload: expect.objectContaining({
                workflowState: 'in_progress',
                lastActiveState: 'in_progress',
                deferredUntilDate: '2026-03-11',
                isCompleted: false,
            }),
        });
        expect(transactions[1]).toMatchObject({
            entity: 'taskProgressEntries',
            id: 'entry-1',
            payload: expect.objectContaining({
                fromState: 'blocked',
                toState: 'in_progress',
                restoreTiming: 'next_scheduled',
                actorFamilyMemberId: 'member-1',
            }),
        });
    });

    it('keeps completion metadata intact when adding a note-only update to a done task', () => {
        const tx = makeTxProxy();
        const task = makeTask({
            id: 'task-done',
            isCompleted: true,
            workflowState: 'done',
            lastActiveState: 'in_progress',
            completedAt: '2026-03-09T18:00:00.000Z',
            completedOnDate: '2026-03-09',
        });

        const transactions = buildTaskProgressUpdateTransactions({
            tx,
            createId: vi.fn()
                .mockReturnValueOnce('entry-done')
                .mockReturnValueOnce('attachment-1'),
            taskId: 'task-done',
            allTasks: [task],
            nextState: 'done',
            selectedDateKey: '2026-03-10',
            note: 'Parent checked the work and added a note.',
            attachments: [{ id: 'attachment-1', name: 'proof.png', type: 'image/png', url: 'task-attachment--proof.png' }],
        }) as any[];

        expect(transactions[0]).toMatchObject({
            entity: 'tasks',
            id: 'task-done',
            payload: expect.objectContaining({
                workflowState: 'done',
                isCompleted: true,
                completedOnDate: '2026-03-09',
            }),
        });
        expect(String(transactions[0].payload.completedAt)).toContain('2026-03-09');
        expect(transactions[1]).toMatchObject({
            entity: 'taskProgressEntries',
            id: 'entry-done',
            payload: expect.objectContaining({
                fromState: 'done',
                toState: 'done',
                note: 'Parent checked the work and added a note.',
            }),
        });
        expect(transactions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    op: 'update',
                    entity: 'taskProgressAttachments',
                    id: 'attachment-1',
                }),
                expect.objectContaining({
                    op: 'link',
                    entity: 'taskProgressEntries',
                    id: 'entry-done',
                    payload: { attachments: 'attachment-1' },
                }),
            ])
        );
    });
});
