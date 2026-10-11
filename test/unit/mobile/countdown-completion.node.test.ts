import { beforeEach, describe, expect, it } from 'vitest';
import { createChoreCompletionRecordId } from '@family-organizer/shared-core';
import { buildCountdownCompletion } from '../../../mobile/src/features/countdown/completion.js';

const tx = new Proxy(
    {},
    {
        get(_root, entity: string) {
            return new Proxy(
                {},
                {
                    get(_entityObj, id: string) {
                        return {
                            update: (payload: unknown) => ({ op: 'update', entity, id, payload }),
                            link: (payload: unknown) => ({ op: 'link', entity, id, payload }),
                        };
                    },
                },
            );
        },
    },
);

const DATE_KEY = '2026-03-31';
const NOW = new Date('2026-03-31T10:15:00Z');

let idCounter = 0;
const createId = () => `mock-id-${(idCounter += 1)}`;

function build(chore: Record<string, unknown>, overrides: Record<string, unknown> = {}): any {
    return buildCountdownCompletion({
        tx,
        createId,
        chore: { id: 'chore-1', title: 'Dishes', completions: [], ...chore },
        familyMemberId: 'kid-a',
        executorId: 'kid-a',
        dateKey: DATE_KEY,
        now: NOW,
        ...overrides,
    });
}

describe('mobile countdown completion', () => {
    beforeEach(() => {
        idCounter = 0;
    });

    it('creates the completion with its chore, member and marked-by links', () => {
        const change = build({}, { executorId: 'parent-1' });

        expect(change.status).toBe('completed');
        expect(change.transactions).toEqual([
            {
                op: 'update',
                entity: 'choreCompletions',
                id: 'mock-id-1',
                payload: { dateDue: DATE_KEY, dateCompleted: NOW.toISOString(), completed: true, allowanceAwarded: false },
            },
            { op: 'link', entity: 'chores', id: 'chore-1', payload: { completions: 'mock-id-1' } },
            { op: 'link', entity: 'familyMembers', id: 'kid-a', payload: { completedChores: 'mock-id-1' } },
            { op: 'link', entity: 'familyMembers', id: 'parent-1', payload: { markedCompletions: 'mock-id-1' } },
        ]);
    });

    it('never undoes a chore this person has already finished', () => {
        const chore = { completions: [{ id: 'done', completed: true, dateDue: DATE_KEY, completedBy: { id: 'kid-a' } }] };
        expect(build(chore)).toEqual({ status: 'unchanged' });
    });

    it('completes an existing row that was reopened or marked not done', () => {
        const chore = { completions: [{ id: 'row', completed: false, dateDue: DATE_KEY, completedBy: [{ id: 'kid-a' }] }] };
        expect(build(chore)).toEqual({
            status: 'completed',
            transactions: [
                {
                    op: 'update',
                    entity: 'choreCompletions',
                    id: 'row',
                    payload: { completed: true, notDone: false, dateCompleted: NOW.toISOString() },
                },
            ],
        });
    });

    it('ignores other days and other people', () => {
        const chore = {
            completions: [
                { id: 'yesterday', completed: true, dateDue: '2026-03-30', completedBy: { id: 'kid-a' } },
                { id: 'sibling', completed: true, dateDue: DATE_KEY, completedBy: { id: 'kid-b' } },
            ],
        };
        expect(build(chore).status).toBe('completed');
    });

    it('uses the deterministic id for an up-for-grabs chore so concurrent claims converge', () => {
        const change = build({ isUpForGrabs: true });
        expect(change.transactions[0].id).toBe(createChoreCompletionRecordId('chore-1', DATE_KEY, true, createId));
    });

    it('reports who claimed an up-for-grabs chore instead of overwriting them', () => {
        const chore = {
            isUpForGrabs: true,
            completions: [{ id: 'claim', completed: true, dateDue: DATE_KEY, completedBy: { id: 'kid-b' } }],
        };
        expect(build(chore)).toEqual({ status: 'claimed', claimedById: 'kid-b' });
    });
});
