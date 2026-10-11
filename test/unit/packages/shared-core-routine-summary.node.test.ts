import { describe, expect, it } from 'vitest';
import { summarizeRoutinesForDay } from '@family-organizer/shared-core';

const DATE = new Date('2026-03-31T00:00:00Z');
const DATE_KEY = '2026-03-31';

const FAMILY = [
    { id: 'kid-a', name: 'Alex' },
    { id: 'kid-b', name: 'Blair' },
];

function chore(id: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        title: id,
        startDate: DATE_KEY,
        rrule: null,
        rotationType: 'none',
        weight: 2,
        assignees: [{ id: 'kid-a' }],
        completions: [] as any[],
        routineSteps: [{ id: `step-${id}` }],
        hideFromDayList: true,
        ...overrides,
    };
}

function done(memberId: string, dateDue = DATE_KEY) {
    return { id: `${memberId}-${dateDue}`, completed: true, dateDue, completedBy: { id: memberId } };
}

function routine(id: string, choreIds: string[], overrides: Record<string, unknown> = {}) {
    return {
        id,
        name: id,
        steps: choreIds.map((choreId, position) => ({ id: `${id}-${position}`, position, chore: { id: choreId } })),
        ...overrides,
    };
}

describe('summarizeRoutinesForDay', () => {
    it('counts a routine’s steps and how many are done', () => {
        const chores = [chore('teeth', { completions: [done('kid-a')] }), chore('dress'), chore('vitamins')];
        const [summary] = summarizeRoutinesForDay([routine('Morning', ['teeth', 'dress', 'vitamins'])], chores, FAMILY, DATE);

        expect(summary).toMatchObject({ name: 'Morning', completed: 1, total: 3, hiddenCount: 3 });
        expect(summary.steps.map((step) => [step.title, step.members[0].done])).toEqual([
            ['teeth', true],
            ['dress', false],
            ['vitamins', false],
        ]);
    });

    it('carries the routine’s own XP so hidden steps still reconcile', () => {
        const chores = [
            chore('teeth', { weight: 2, completions: [done('kid-a')] }),
            chore('dress', { weight: 3 }),
            chore('vitamins', { weight: null }),
            chore('paid', { weight: 5, rewardType: 'fixed' }),
        ];
        const [summary] = summarizeRoutinesForDay([routine('Morning', ['teeth', 'dress', 'vitamins', 'paid'])], chores, FAMILY, DATE);

        // Weightless and fixed-reward chores earn no XP, exactly as in the sidebar.
        expect(summary).toMatchObject({ xpEarned: 2, xpPossible: 5 });
    });

    it('keeps steps in routine order whatever order the chores arrive in', () => {
        const chores = [chore('vitamins'), chore('teeth'), chore('dress')];
        const [summary] = summarizeRoutinesForDay([routine('Morning', ['teeth', 'dress', 'vitamins'])], chores, FAMILY, DATE);
        expect(summary.steps.map((step) => step.choreId)).toEqual(['teeth', 'dress', 'vitamins']);
    });

    it('counts a shared step once per person and breaks the tally down', () => {
        const both = [{ id: 'kid-a' }, { id: 'kid-b' }];
        const chores = [chore('teeth', { assignees: both, completions: [done('kid-b')] }), chore('dress', { assignees: both })];
        const [summary] = summarizeRoutinesForDay([routine('Morning', ['teeth', 'dress'])], chores, FAMILY, DATE);

        expect(summary).toMatchObject({ completed: 1, total: 4, xpEarned: 2, xpPossible: 8 });
        expect(summary.members).toEqual([
            { id: 'kid-a', name: 'Alex', completed: 0, total: 2 },
            { id: 'kid-b', name: 'Blair', completed: 1, total: 2 },
        ]);
    });

    it('narrows to one person when the day list is filtered', () => {
        const both = [{ id: 'kid-a' }, { id: 'kid-b' }];
        const chores = [chore('teeth', { assignees: both, completions: [done('kid-b')] }), chore('laundry', { assignees: [{ id: 'kid-b' }] })];
        const routines = [routine('Morning', ['teeth', 'laundry'])];

        expect(summarizeRoutinesForDay(routines, chores, FAMILY, DATE, 'kid-a')[0]).toMatchObject({
            completed: 0,
            total: 1,
            xpEarned: 0,
            xpPossible: 2,
        });
        expect(summarizeRoutinesForDay(routines, chores, FAMILY, DATE, 'kid-b')[0]).toMatchObject({
            completed: 1,
            total: 2,
            xpEarned: 2,
            xpPossible: 4,
        });
    });

    it('leaves out steps that are not due and routines with nothing due', () => {
        const chores = [chore('teeth'), chore('tomorrow', { startDate: '2026-04-01' })];
        const summaries = summarizeRoutinesForDay(
            [routine('Morning', ['teeth', 'tomorrow']), routine('Weekend', ['tomorrow']), routine('Empty', [])],
            chores,
            FAMILY,
            DATE,
        );

        expect(summaries.map((summary) => summary.name)).toEqual(['Morning']);
        expect(summaries[0].total).toBe(1);
    });

    it('ignores completions from other days', () => {
        const chores = [chore('teeth', { completions: [done('kid-a', '2026-03-30')] })];
        expect(summarizeRoutinesForDay([routine('Morning', ['teeth'])], chores, FAMILY, DATE)[0].completed).toBe(0);
    });

    it('says how many steps are folded away and how many still show', () => {
        const chores = [chore('teeth'), chore('dishes', { hideFromDayList: false })];
        const [summary] = summarizeRoutinesForDay([routine('Morning', ['teeth', 'dishes'])], chores, FAMILY, DATE);

        expect(summary.hiddenCount).toBe(1);
        expect(summary.steps.map((step) => step.hidden)).toEqual([true, false]);
    });

    it('lists routines in their saved order', () => {
        const chores = [chore('teeth'), chore('pyjamas')];
        const summaries = summarizeRoutinesForDay(
            [routine('Bedtime', ['pyjamas'], { sortOrder: 1 }), routine('Morning', ['teeth'], { sortOrder: 0 })],
            chores,
            FAMILY,
            DATE,
        );
        expect(summaries.map((summary) => summary.name)).toEqual(['Morning', 'Bedtime']);
    });
});
