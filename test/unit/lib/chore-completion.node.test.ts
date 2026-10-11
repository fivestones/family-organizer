import { beforeEach, describe, expect, it } from 'vitest';
import { createChoreCompletionRecordId } from '@family-organizer/shared-core';
import { buildChoreCompletionChange, type ChoreCompletionTarget } from '@/lib/chore-completion';

const tx = new Proxy(
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
                            link(payload: unknown) {
                                return { op: 'link', entity, id, payload };
                            },
                        };
                    },
                }
            );
        },
    }
);

const DATE_KEY = '2026-03-31';
const NOW = new Date('2026-03-31T10:15:00Z');

let idCounter = 0;
function createId() {
    idCounter += 1;
    return `mock-id-${idCounter}`;
}

function makeChore(overrides: Partial<ChoreCompletionTarget> = {}): ChoreCompletionTarget {
    return { id: 'chore-1', title: 'Dishes', isUpForGrabs: false, completions: [], ...overrides };
}

function build(chore: ChoreCompletionTarget, overrides: Record<string, unknown> = {}) {
    return buildChoreCompletionChange({
        tx,
        createId,
        chore,
        familyMemberId: 'kid-a',
        dateKey: DATE_KEY,
        now: NOW,
        ...overrides,
    });
}

function find(transactions: any[], op: string, entity: string) {
    return transactions.filter((entry) => entry.op === op && entry.entity === entity);
}

describe('buildChoreCompletionChange', () => {
    beforeEach(() => {
        idCounter = 0;
    });

    it('creates a completion with its links, a markedBy link and a history event', () => {
        const change = build(makeChore(), { executorId: 'parent-1' });
        if (change.status !== 'completed') throw new Error(`unexpected status ${change.status}`);

        expect(change.occurredAt).toBe(NOW.toISOString());
        expect(find(change.transactions, 'update', 'choreCompletions')).toEqual([
            {
                op: 'update',
                entity: 'choreCompletions',
                id: change.completionId,
                payload: { dateDue: DATE_KEY, dateCompleted: NOW.toISOString(), completed: true, allowanceAwarded: false },
            },
        ]);
        expect(find(change.transactions, 'link', 'chores')).toEqual([
            { op: 'link', entity: 'chores', id: 'chore-1', payload: { completions: change.completionId } },
        ]);
        expect(find(change.transactions, 'link', 'familyMembers')).toEqual([
            { op: 'link', entity: 'familyMembers', id: 'kid-a', payload: { completedChores: change.completionId } },
            { op: 'link', entity: 'familyMembers', id: 'parent-1', payload: { markedCompletions: change.completionId } },
        ]);

        const [historyEvent] = find(change.transactions, 'update', 'historyEvents');
        expect(historyEvent.payload).toMatchObject({
            domain: 'chores',
            actionType: 'chore_marked_done',
            summary: 'Completed "Dishes"',
            actorFamilyMemberId: 'parent-1',
            choreId: 'chore-1',
            scheduledForDate: DATE_KEY,
            occurredAt: NOW.toISOString(),
        });
    });

    it('records the member as the actor when nobody else made the change', () => {
        const change = build(makeChore());
        if (change.status !== 'completed') throw new Error(`unexpected status ${change.status}`);

        expect(find(change.transactions, 'link', 'familyMembers')).toHaveLength(1);
        expect(find(change.transactions, 'update', 'historyEvents')[0].payload.actorFamilyMemberId).toBe('kid-a');
    });

    it('reopens the member’s own completion when toggled', () => {
        const chore = makeChore({
            completions: [{ id: 'completion-1', completed: true, dateDue: DATE_KEY, completedBy: { id: 'kid-a' } }],
        });
        const change = build(chore);
        if (change.status !== 'reopened') throw new Error(`unexpected status ${change.status}`);

        expect(change.completionId).toBe('completion-1');
        expect(find(change.transactions, 'update', 'choreCompletions')[0].payload).toEqual({
            completed: false,
            notDone: false,
            dateCompleted: null,
        });
        expect(find(change.transactions, 'update', 'historyEvents')[0].payload).toMatchObject({
            actionType: 'chore_marked_undone',
            summary: 'Marked "Dishes" not done',
        });
    });

    it('never undoes a completion when the intent is only to finish', () => {
        const chore = makeChore({
            completions: [{ id: 'completion-1', completed: true, dateDue: DATE_KEY, completedBy: [{ id: 'kid-a' }] }],
        });
        expect(build(chore, { intent: 'done' })).toEqual({ status: 'unchanged' });
    });

    it('completes an existing row that was reopened or marked not done', () => {
        const chore = makeChore({
            completions: [{ id: 'completion-1', completed: false, dateDue: DATE_KEY, completedBy: { id: 'kid-a' } }],
        });
        const change = build(chore, { intent: 'done' });
        if (change.status !== 'completed') throw new Error(`unexpected status ${change.status}`);

        expect(change.completionId).toBe('completion-1');
        expect(find(change.transactions, 'update', 'choreCompletions')[0].payload).toEqual({
            completed: true,
            notDone: false,
            dateCompleted: NOW.toISOString(),
        });
        expect(find(change.transactions, 'link', 'chores')).toEqual([]);
    });

    it('ignores completions for other days and other members', () => {
        const chore = makeChore({
            completions: [
                { id: 'yesterday', completed: true, dateDue: '2026-03-30', completedBy: { id: 'kid-a' } },
                { id: 'sibling', completed: true, dateDue: DATE_KEY, completedBy: { id: 'kid-b' } },
            ],
        });
        const change = build(chore, { intent: 'done' });
        expect(change.status).toBe('completed');
    });

    describe('up-for-grabs chores', () => {
        it('uses the deterministic completion id so concurrent claims converge', () => {
            const change = build(makeChore({ isUpForGrabs: true }));
            if (change.status !== 'completed') throw new Error(`unexpected status ${change.status}`);
            expect(change.completionId).toBe(createChoreCompletionRecordId('chore-1', DATE_KEY, true, createId));
        });

        it('reports who claimed the chore instead of overwriting their completion', () => {
            const chore = makeChore({
                isUpForGrabs: true,
                completions: [{ id: 'claim', completed: true, dateDue: DATE_KEY, completedBy: { id: 'kid-b' } }],
            });
            expect(build(chore)).toEqual({ status: 'claimed', claimedById: 'kid-b' });
            expect(build(chore, { intent: 'done' })).toEqual({ status: 'claimed', claimedById: 'kid-b' });
        });

        it('still lets the claimer undo their own claim', () => {
            const chore = makeChore({
                isUpForGrabs: true,
                completions: [{ id: 'claim', completed: true, dateDue: DATE_KEY, completedBy: { id: 'kid-a' } }],
            });
            expect(build(chore).status).toBe('reopened');
        });
    });
});
