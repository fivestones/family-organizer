import { describe, expect, it } from 'vitest';
import {
    getNextRoutineSortOrder,
    getRoutineChoreIds,
    getRoutineOverrunPolicy,
    isChoreHiddenFromDayList,
    sortRoutines,
} from '@family-organizer/shared-core';

describe('shared-core routines', () => {
    describe('step order', () => {
        it('reads a routine’s chores in position order', () => {
            const routine = {
                steps: [
                    { id: 'c', position: 2, chore: { id: 'dress' } },
                    { id: 'a', position: 0, chore: [{ id: 'teeth' }] },
                    { id: 'b', position: 1, chore: { id: 'vitamins' } },
                ],
            };
            expect(getRoutineChoreIds(routine)).toEqual(['teeth', 'vitamins', 'dress']);
        });

        it('skips steps whose chore is gone and keeps a repeated chore once', () => {
            const routine = {
                steps: [
                    { id: 'a', position: 0, chore: { id: 'teeth' } },
                    { id: 'b', position: 1, chore: null },
                    { id: 'c', position: 2, chore: { id: 'teeth' } },
                    { id: 'd', position: 3, chore: [] },
                ],
            };
            expect(getRoutineChoreIds(routine)).toEqual(['teeth']);
        });

        it('puts steps with no position last, in a stable order', () => {
            const routine = {
                steps: [
                    { id: 'z', chore: { id: 'last-z' } },
                    { id: 'a', chore: { id: 'last-a' } },
                    { id: 'm', position: 0, chore: { id: 'first' } },
                ],
            };
            expect(getRoutineChoreIds(routine)).toEqual(['first', 'last-a', 'last-z']);
        });

        it('handles a routine with no steps', () => {
            expect(getRoutineChoreIds({ steps: null })).toEqual([]);
            expect(getRoutineChoreIds(null)).toEqual([]);
        });
    });

    describe('overrun policy', () => {
        it('waits unless the routine opts into advancing', () => {
            expect(getRoutineOverrunPolicy({ onStepOverrun: 'advance' })).toBe('advance');
            expect(getRoutineOverrunPolicy({ onStepOverrun: 'wait' })).toBe('wait');
            expect(getRoutineOverrunPolicy({ onStepOverrun: null })).toBe('wait');
            expect(getRoutineOverrunPolicy({ onStepOverrun: 'something-else' })).toBe('wait');
            expect(getRoutineOverrunPolicy(null)).toBe('wait');
        });
    });

    describe('routine order', () => {
        it('sorts by sort order, then name', () => {
            const sorted = sortRoutines([
                { id: '3', name: 'Evening', sortOrder: 1 },
                { id: '1', name: 'morning' },
                { id: '2', name: 'Bedtime' },
                { id: '4', name: 'After School', sortOrder: 0 },
            ]);
            expect(sorted.map((routine) => routine.name)).toEqual(['After School', 'Evening', 'Bedtime', 'morning']);
        });

        it('gives a new routine the next place in the list', () => {
            expect(getNextRoutineSortOrder([])).toBe(0);
            expect(getNextRoutineSortOrder([{ id: 'a', sortOrder: 4 }, { id: 'b' }, { id: 'c', sortOrder: 1 }])).toBe(5);
        });
    });

    describe('day-list visibility', () => {
        const inRoutine = [{ id: 'step-1' }];

        it('hides a routine step that is flagged', () => {
            expect(isChoreHiddenFromDayList({ routineSteps: inRoutine, hideFromDayList: true })).toBe(true);
        });

        it('shows a routine step that is not flagged', () => {
            // Pointing a routine at an existing chore must not remove it from view.
            expect(isChoreHiddenFromDayList({ routineSteps: inRoutine, hideFromDayList: false })).toBe(false);
            expect(isChoreHiddenFromDayList({ routineSteps: inRoutine })).toBe(false);
            expect(isChoreHiddenFromDayList({ routineSteps: inRoutine, hideFromDayList: null })).toBe(false);
        });

        it('ignores the flag on a chore that belongs to no routine', () => {
            // Leaving its last routine restores a chore to the day list with no cleanup.
            expect(isChoreHiddenFromDayList({ routineSteps: [], hideFromDayList: true })).toBe(false);
            expect(isChoreHiddenFromDayList({ hideFromDayList: true })).toBe(false);
            expect(isChoreHiddenFromDayList(null)).toBe(false);
        });
    });
});
