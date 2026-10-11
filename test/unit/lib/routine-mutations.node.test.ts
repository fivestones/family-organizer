import { beforeEach, describe, expect, it } from 'vitest';
import {
    buildRoutineDeleteTransactions,
    buildRoutineSaveTransactions,
    validateRoutineDraft,
    type RoutineDraft,
} from '@/lib/routine-mutations';

function chain(entry: Record<string, unknown>) {
    return {
        ...entry,
        link(payload: unknown) {
            return { ...entry, links: payload };
        },
    };
}

const tx = new Proxy(
    {},
    {
        get(_root, entity: string) {
            return new Proxy(
                {},
                {
                    get(_entityObj, id: string) {
                        return {
                            update: (payload: unknown) => chain({ op: 'update', entity, id, payload }),
                            link: (payload: unknown) => ({ op: 'link', entity, id, payload }),
                            delete: () => ({ op: 'delete', entity, id }),
                        };
                    },
                },
            );
        },
    },
);

const NOW = new Date('2026-03-31T10:15:00');

let idCounter = 0;
function createId() {
    idCounter += 1;
    return `new-${idCounter}`;
}

function makeDraft(overrides: Partial<RoutineDraft> = {}): RoutineDraft {
    return {
        name: 'Morning Routine',
        onStepOverrun: 'wait',
        steps: [{ choreId: 'dishes', hideFromDayList: false }],
        newStepAssigneeIds: [],
        newStepRrule: null,
        ...overrides,
    };
}

const CHORES = [
    { id: 'dishes', title: 'Dishes', startDate: '2026-03-01', sortOrder: 3 },
    { id: 'teeth', title: 'Brush teeth', startDate: '2026-03-01', sortOrder: 7, hideFromDayList: true },
];

function save(draft: RoutineDraft, routines: any[] = []) {
    return buildRoutineSaveTransactions({ tx, createId, draft, routines, chores: CHORES, now: NOW });
}

function only(transactions: any[], op: string, entity: string) {
    return transactions.filter((entry) => entry.op === op && entry.entity === entity);
}

describe('routine mutations', () => {
    beforeEach(() => {
        idCounter = 0;
    });

    describe('validation', () => {
        it('accepts a named routine with steps', () => {
            expect(validateRoutineDraft(makeDraft())).toBeNull();
        });

        it('needs a name and at least one step', () => {
            expect(validateRoutineDraft(makeDraft({ name: '   ' }))).toBe('Give the routine a name.');
            expect(validateRoutineDraft(makeDraft({ steps: [] }))).toBe('Add at least one step.');
        });

        it('needs a title and an owner for every typed step', () => {
            const typed = (title: string) => makeDraft({ steps: [{ title, hideFromDayList: true }], newStepAssigneeIds: ['kid-a'] });
            expect(validateRoutineDraft(typed(' '))).toBe('Every new step needs a name.');
            expect(validateRoutineDraft({ ...typed('Brush teeth'), newStepAssigneeIds: [] })).toBe('Choose who the new steps are for.');
            expect(validateRoutineDraft(typed('Brush teeth'))).toBeNull();
        });

        it('rejects a zero-length timer and a repeated chore', () => {
            expect(
                validateRoutineDraft(
                    makeDraft({ steps: [{ title: 'Brush teeth', durationMins: 0, hideFromDayList: true }], newStepAssigneeIds: ['kid-a'] }),
                ),
            ).toMatch(/more than zero/);
            expect(
                validateRoutineDraft(
                    makeDraft({ steps: [{ choreId: 'dishes', hideFromDayList: false }, { choreId: 'dishes', hideFromDayList: false }] }),
                ),
            ).toBe('A chore can only appear once in a routine.');
        });

        it('refuses to build writes for an invalid draft', () => {
            expect(() => save(makeDraft({ name: '' }))).toThrow('Give the routine a name.');
        });
    });

    describe('pointing a routine at existing chores', () => {
        it('creates the routine and a positioned step per chore', () => {
            const { routineId, transactions, createdChoreIds } = save(
                makeDraft({ steps: [{ choreId: 'teeth', hideFromDayList: true }, { choreId: 'dishes', hideFromDayList: false }] }),
                [{ id: 'existing', sortOrder: 2 }],
            );

            expect(routineId).toBe('new-1');
            expect(createdChoreIds).toEqual([]);
            expect(only(transactions, 'update', 'routines')).toEqual([
                expect.objectContaining({
                    id: 'new-1',
                    payload: { name: 'Morning Routine', onStepOverrun: 'wait', createdAt: NOW.toISOString(), sortOrder: 3 },
                }),
            ]);
            expect(only(transactions, 'update', 'routineSteps')).toEqual([
                expect.objectContaining({ id: 'new-2', payload: { position: 0 }, links: { routine: 'new-1', chore: 'teeth' } }),
                expect.objectContaining({ id: 'new-3', payload: { position: 1 }, links: { routine: 'new-1', chore: 'dishes' } }),
            ]);
        });

        it('leaves an existing chore in the day list unless asked to fold it in', () => {
            expect(only(save(makeDraft()).transactions, 'update', 'chores')).toEqual([]);

            const folded = save(makeDraft({ steps: [{ choreId: 'dishes', hideFromDayList: true }] }));
            expect(only(folded.transactions, 'update', 'chores')).toEqual([
                expect.objectContaining({ id: 'dishes', payload: { hideFromDayList: true } }),
            ]);
        });

        it('can bring a folded chore back into view', () => {
            const { transactions } = save(makeDraft({ steps: [{ choreId: 'teeth', hideFromDayList: false }] }));
            expect(only(transactions, 'update', 'chores')).toEqual([
                expect.objectContaining({ id: 'teeth', payload: { hideFromDayList: false } }),
            ]);
        });
    });

    describe('typing new steps', () => {
        it('creates the chores, folded into the routine, for the chosen people', () => {
            const { transactions, createdChoreIds } = save(
                makeDraft({
                    steps: [
                        { title: '  Take vitamins ', hideFromDayList: true },
                        { title: 'Brush teeth', durationMins: 2.5, hideFromDayList: true },
                    ],
                    newStepAssigneeIds: ['kid-a', 'kid-b'],
                    newStepRrule: 'RRULE:FREQ=DAILY',
                }),
            );

            const created = only(transactions, 'update', 'chores');
            expect(createdChoreIds).toEqual(created.map((entry) => entry.id));
            expect(created.map((entry) => entry.payload)).toEqual([
                expect.objectContaining({
                    title: 'Take vitamins',
                    estimatedDurationSecs: null,
                    hideFromDayList: true,
                    rrule: 'RRULE:FREQ=DAILY',
                    startDate: '2026-03-31T00:00:00.000Z',
                    rotationType: 'none',
                    done: false,
                    sortOrder: 8,
                }),
                expect.objectContaining({ title: 'Brush teeth', estimatedDurationSecs: 150, sortOrder: 9 }),
            ]);

            // Each new chore is assigned to both kids, from both sides of the link.
            expect(only(transactions, 'link', 'chores')).toHaveLength(4);
            expect(only(transactions, 'link', 'familyMembers').map((entry) => entry.id)).toEqual(['kid-a', 'kid-b', 'kid-a', 'kid-b']);

            const steps = only(transactions, 'update', 'routineSteps');
            expect(steps.map((entry) => entry.links.chore)).toEqual(createdChoreIds);
        });

        it('mixes typed steps with existing chores in the order given', () => {
            const { transactions, createdChoreIds } = save(
                makeDraft({
                    steps: [{ choreId: 'dishes', hideFromDayList: false }, { title: 'Pack bag', hideFromDayList: true }],
                    newStepAssigneeIds: ['kid-a'],
                }),
            );
            expect(only(transactions, 'update', 'routineSteps').map((entry) => [entry.payload.position, entry.links.chore])).toEqual([
                [0, 'dishes'],
                [1, createdChoreIds[0]],
            ]);
        });
    });

    describe('editing a routine', () => {
        const existing = {
            id: 'morning',
            name: 'Morning',
            sortOrder: 0,
            steps: [
                { id: 'step-a', position: 0, chore: { id: 'dishes' } },
                { id: 'step-b', position: 1, chore: { id: 'teeth' } },
            ],
        };

        it('reorders by rewriting positions on the same step rows', () => {
            const { routineId, transactions } = save(
                makeDraft({
                    id: 'morning',
                    name: 'Mornings',
                    onStepOverrun: 'advance',
                    steps: [
                        { stepId: 'step-b', choreId: 'teeth', hideFromDayList: true },
                        { stepId: 'step-a', choreId: 'dishes', hideFromDayList: false },
                    ],
                }),
                [existing],
            );

            expect(routineId).toBe('morning');
            // An existing routine keeps its place and its creation time.
            expect(only(transactions, 'update', 'routines')[0].payload).toEqual({ name: 'Mornings', onStepOverrun: 'advance' });
            expect(only(transactions, 'update', 'routineSteps')).toEqual([
                expect.objectContaining({ id: 'step-b', payload: { position: 0 } }),
                expect.objectContaining({ id: 'step-a', payload: { position: 1 } }),
            ]);
            expect(only(transactions, 'update', 'routineSteps').every((entry) => !('links' in entry))).toBe(true);
            expect(only(transactions, 'delete', 'routineSteps')).toEqual([]);
        });

        it('removes a dropped step and leaves its chore alone', () => {
            const { transactions } = save(
                makeDraft({ id: 'morning', steps: [{ stepId: 'step-a', choreId: 'dishes', hideFromDayList: false }] }),
                [existing],
            );

            expect(only(transactions, 'delete', 'routineSteps')).toEqual([{ op: 'delete', entity: 'routineSteps', id: 'step-b' }]);
            expect(transactions.some((entry) => entry.op === 'delete' && entry.entity === 'chores')).toBe(false);
        });

        it('deletes a routine with its steps but never its chores', () => {
            expect(buildRoutineDeleteTransactions(tx, existing)).toEqual([
                { op: 'delete', entity: 'routineSteps', id: 'step-a' },
                { op: 'delete', entity: 'routineSteps', id: 'step-b' },
                { op: 'delete', entity: 'routines', id: 'morning' },
            ]);
        });
    });
});
