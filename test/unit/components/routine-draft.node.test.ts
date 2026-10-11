import { describe, expect, it } from 'vitest';
import {
    EVERY_DAY,
    SCHOOL_DAYS,
    WEEKEND_DAYS,
    buildWeekdayRrule,
    createChoreStep,
    createRoutineEditorState,
    createTypedStep,
    describeDays,
    moveStep,
    sumRoutineDurationSecs,
    toRoutineDraft,
} from '@/components/routines/routine-draft';

const CHORES = [
    { id: 'dishes', title: 'Dishes', startDate: '2026-03-01', assignees: [{ id: 'kid-a' }] },
    { id: 'teeth', title: 'Brush teeth', startDate: '2026-03-01', assignees: [{ id: 'kid-a' }, { id: 'kid-b' }], hideFromDayList: true },
];

const ROUTINE = {
    id: 'morning',
    name: 'Morning',
    onStepOverrun: 'advance',
    steps: [
        { id: 'step-b', position: 1, chore: { id: 'dishes' } },
        { id: 'step-a', position: 0, chore: [{ id: 'teeth' }] },
        { id: 'step-c', position: 2, chore: { id: 'deleted-chore' } },
    ],
};

describe('routine editor draft', () => {
    describe('opening', () => {
        it('starts a blank routine for the default person, every day, waiting at zero', () => {
            const state = createRoutineEditorState(null, CHORES, ['kid-a']);
            expect(state).toMatchObject({ id: null, name: '', onStepOverrun: 'wait', steps: [], assigneeIds: ['kid-a'], days: EVERY_DAY });
        });

        it('loads an existing routine’s steps in order with each chore’s visibility', () => {
            const state = createRoutineEditorState(ROUTINE, CHORES, ['kid-z']);

            expect(state).toMatchObject({ id: 'morning', name: 'Morning', onStepOverrun: 'advance' });
            // A step whose chore has been deleted is dropped rather than shown blank.
            expect(state.steps.map((step) => [step.stepId, step.choreId, step.title, step.showInDayList])).toEqual([
                ['step-a', 'teeth', 'Brush teeth', false],
                ['step-b', 'dishes', 'Dishes', true],
            ]);
            // New steps default to the people the routine already involves.
            expect(state.assigneeIds.sort()).toEqual(['kid-a', 'kid-b']);
        });
    });

    describe('the two ways to add a step', () => {
        it('folds a typed step into the routine by default', () => {
            expect(createTypedStep('Take vitamins', '')).toMatchObject({ choreId: null, stepId: null, showInDayList: false });
        });

        it('leaves an existing chore wherever it already shows', () => {
            expect(createChoreStep(CHORES[0])).toMatchObject({ choreId: 'dishes', title: 'Dishes', showInDayList: true });
            expect(createChoreStep(CHORES[1])).toMatchObject({ choreId: 'teeth', showInDayList: false });
        });

        it('gives every step its own key', () => {
            expect(createTypedStep('a', '').key).not.toBe(createTypedStep('b', '').key);
        });
    });

    describe('reordering', () => {
        const steps = [createTypedStep('one', ''), createTypedStep('two', ''), createTypedStep('three', '')];
        const titles = (list: typeof steps) => list.map((step) => step.title);

        it('moves a step up or down', () => {
            expect(titles(moveStep(steps, 1, -1))).toEqual(['two', 'one', 'three']);
            expect(titles(moveStep(steps, 1, 1))).toEqual(['one', 'three', 'two']);
        });

        it('leaves the ends where they are', () => {
            expect(moveStep(steps, 0, -1)).toBe(steps);
            expect(moveStep(steps, 2, 1)).toBe(steps);
        });
    });

    describe('days', () => {
        it('builds a daily rule for every day and a weekly rule otherwise', () => {
            expect(buildWeekdayRrule(EVERY_DAY)).toBe('RRULE:FREQ=DAILY');
            expect(buildWeekdayRrule(SCHOOL_DAYS)).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
            // Days are written in week order however they were picked.
            expect(buildWeekdayRrule(['SU', 'WE', 'MO'])).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,WE,SU');
            expect(buildWeekdayRrule([])).toBeNull();
        });

        it('describes the days in words', () => {
            expect(describeDays(EVERY_DAY)).toBe('every day');
            expect(describeDays(SCHOOL_DAYS)).toBe('on weekdays');
            expect(describeDays(WEEKEND_DAYS)).toBe('on weekends');
            expect(describeDays(['MO', 'WE'])).toBe('on Mon, Wed');
        });
    });

    describe('saving', () => {
        it('turns the editor state into a draft the mutations understand', () => {
            const state = createRoutineEditorState(ROUTINE, CHORES);
            state.steps.push(createTypedStep('Pack bag', '2.5'), createTypedStep('Shoes on', ' '));
            state.days = SCHOOL_DAYS;

            const draft = toRoutineDraft(state);
            expect(draft).toMatchObject({
                id: 'morning',
                name: 'Morning',
                onStepOverrun: 'advance',
                newStepRrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
            });
            expect(draft.steps).toEqual([
                { stepId: 'step-a', choreId: 'teeth', title: 'Brush teeth', durationMins: null, hideFromDayList: true },
                { stepId: 'step-b', choreId: 'dishes', title: 'Dishes', durationMins: null, hideFromDayList: false },
                { stepId: null, choreId: null, title: 'Pack bag', durationMins: 2.5, hideFromDayList: true },
                { stepId: null, choreId: null, title: 'Shoes on', durationMins: null, hideFromDayList: true },
            ]);
        });

        it('passes an unreadable time through as zero for validation to reject', () => {
            const state = createRoutineEditorState(null, CHORES);
            state.steps.push(createTypedStep('Pack bag', 'soon'));
            expect(toRoutineDraft(state).steps[0].durationMins).toBe(0);
        });
    });

    it('totals a routine’s timed steps', () => {
        expect(
            sumRoutineDurationSecs([{ estimatedDurationSecs: 120 }, { weight: 3 }, { estimatedDurationSecs: null, weight: null }, {}]),
        ).toBe(300);
    });
});
