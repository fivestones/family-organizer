import { describe, expect, it } from 'vitest';
import {
    DEFAULT_COUNTDOWN_SETTINGS,
    buildCountdownChoreInputs,
    buildRunAdvancePatch,
    buildRunExtendPatch,
    buildRunStartPatch,
    buildRunStopPatch,
    buildRunnerQueue,
    computeRunnerStanding,
    createCountdownRunId,
    getDefaultScheduleSettings,
    getRunnerClock,
    getRunnerOverrunStatus,
    isCountdownRunStale,
    isRunnerStepLocked,
    resolveRunnerState,
    selectNextRunnerStep,
    shouldRecordRunInteraction,
    type CountdownChoreInput,
    type CountdownEngineInput,
    type CountdownRunLike,
    type CountdownSettings,
    type RunnerStep,
    type SharedChoreLike,
} from '@family-organizer/shared-core';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_DATE = new Date('2026-03-31T00:00:00Z');
const DATE_KEY = '2026-03-31';
const SCHEDULE = getDefaultScheduleSettings(); // dayBoundary = 03:00
const SETTINGS: CountdownSettings = { ...DEFAULT_COUNTDOWN_SETTINGS, stackBufferSecs: 0 };
const PERSON = 'person-a';

/** A local wall-clock time on the test day, as an absolute timestamp. */
function at(time: string): number {
    return new Date(`${DATE_KEY}T${time.length === 5 ? `${time}:00` : time}`).getTime();
}

function iso(time: string): string {
    return new Date(at(time)).toISOString();
}

function makeChore(overrides: Partial<CountdownChoreInput> = {}): CountdownChoreInput {
    return {
        id: overrides.id ?? 'chore-1',
        title: overrides.title ?? overrides.id ?? 'Test chore',
        estimatedDurationSecs: 'estimatedDurationSecs' in overrides ? overrides.estimatedDurationSecs! : 600,
        weight: overrides.weight ?? null,
        sortOrder: overrides.sortOrder ?? 0,
        isJoint: overrides.isJoint ?? false,
        assigneeIds: overrides.assigneeIds ?? [PERSON],
        timingMode: overrides.timingMode ?? 'anytime',
        timingConfig: overrides.timingConfig ?? null,
        timeBucket: overrides.timeBucket ?? null,
        completedAt: null,
        memberCompletions: overrides.memberCompletions ?? {},
    };
}

function before(id: string, time: string, overrides: Partial<CountdownChoreInput> = {}): CountdownChoreInput {
    return makeChore({ id, timingMode: 'before_time', timingConfig: { mode: 'before_time', time }, ...overrides });
}

function after(id: string, time: string, overrides: Partial<CountdownChoreInput> = {}): CountdownChoreInput {
    return makeChore({ id, timingMode: 'after_time', timingConfig: { mode: 'after_time', time }, ...overrides });
}

function afterChore(id: string, sourceChoreId: string, overrides: Partial<CountdownChoreInput> = {}): CountdownChoreInput {
    return makeChore({
        id,
        timingMode: 'after_chore',
        timingConfig: { mode: 'after_chore', anchor: { sourceType: 'chore', relation: 'after', sourceChoreId } },
        ...overrides,
    });
}

function toChoreLike(chore: CountdownChoreInput): SharedChoreLike {
    return {
        id: chore.id,
        title: chore.title,
        startDate: DATE_KEY,
        timingMode: chore.timingMode,
        timingConfig: chore.timingConfig,
        timeBucket: chore.timeBucket,
        sortOrder: chore.sortOrder,
        assignees: chore.assigneeIds.map((id) => ({ id })),
        completions: Object.entries(chore.memberCompletions).map(([memberId, dateCompleted], index) => ({
            id: `${chore.id}-completion-${index}`,
            completed: true,
            dateDue: DATE_KEY,
            dateCompleted,
            completedBy: { id: memberId },
        })),
    };
}

function makeInput(chores: CountdownChoreInput[], now = '10:00'): CountdownEngineInput {
    return {
        chores,
        routineMarkerStatuses: [],
        allChoresRaw: chores.map(toChoreLike),
        countdownSettings: SETTINGS,
        scheduleSettings: SCHEDULE,
        now: new Date(at(now)),
        date: TEST_DATE,
    };
}

function queueFor(chores: CountdownChoreInput[], now = '10:00', orderedChoreIds?: string[]): RunnerStep[] {
    return buildRunnerQueue(makeInput(chores, now), { personId: PERSON, orderedChoreIds });
}

function makeRun(overrides: Partial<CountdownRunLike> = {}): CountdownRunLike {
    return {
        familyMemberId: PERSON,
        date: DATE_KEY,
        status: 'running',
        currentChoreId: 'chore-1',
        stepStartedAt: iso('10:00'),
        stepExtensionSecs: 0,
        stepExtensionCount: 0,
        lastInteractionAt: iso('10:00'),
        startedAt: iso('10:00'),
        ...overrides,
    };
}

function ids(steps: Array<{ choreId: string }>): string[] {
    return steps.map((step) => step.choreId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('chore-countdown-runner', () => {
    describe('the run record', () => {
        it('derives one id per member per family day', () => {
            expect(createCountdownRunId(PERSON, DATE_KEY)).toBe(createCountdownRunId(PERSON, DATE_KEY));
            expect(createCountdownRunId(PERSON, DATE_KEY)).not.toBe(createCountdownRunId('person-b', DATE_KEY));
            expect(createCountdownRunId(PERSON, DATE_KEY)).not.toBe(createCountdownRunId(PERSON, '2026-04-01'));
        });

        it('refuses to derive an id without a member and a date key', () => {
            expect(() => createCountdownRunId('', DATE_KEY)).toThrow();
            expect(() => createCountdownRunId(PERSON, 'today')).toThrow();
        });

        it('treats a run left running on an earlier family day as stale', () => {
            expect(isCountdownRunStale(makeRun({ date: '2026-03-30' }), DATE_KEY)).toBe(true);
            expect(isCountdownRunStale(makeRun(), DATE_KEY)).toBe(false);
            expect(isCountdownRunStale(makeRun({ date: '2026-03-30', status: 'stopped' }), DATE_KEY)).toBe(false);
        });
    });

    describe('engine inputs', () => {
        const chore = (overrides: Record<string, unknown>) => ({
            id: 'c1',
            title: 'Chore',
            startDate: DATE_KEY,
            assignees: [{ id: PERSON }, { id: 'person-b' }],
            completions: [],
            ...overrides,
        });

        it('includes anytime and untimed chores, which the planner cannot pack', () => {
            const inputs = buildCountdownChoreInputs([chore({ id: 'vitamins' }) as any], TEST_DATE);
            expect(inputs).toHaveLength(1);
            expect(inputs[0]).toMatchObject({ id: 'vitamins', timingMode: 'anytime', estimatedDurationSecs: null });
        });

        it('leaves out chores that are not due on the date', () => {
            expect(buildCountdownChoreInputs([chore({ startDate: '2026-04-02' }) as any], TEST_DATE)).toEqual([]);
        });

        it('records who finished the chore today and ignores other days', () => {
            const inputs = buildCountdownChoreInputs(
                [
                    chore({
                        completions: [
                            { id: 'a', completed: true, dateDue: DATE_KEY, dateCompleted: iso('09:00'), completedBy: { id: PERSON } },
                            { id: 'b', completed: true, dateDue: '2026-03-30', dateCompleted: iso('09:00'), completedBy: { id: 'person-b' } },
                            { id: 'c', completed: false, dateDue: DATE_KEY, completedBy: [{ id: 'person-b' }] },
                        ],
                    }) as any,
                ],
                TEST_DATE,
            );
            expect(inputs[0].memberCompletions).toEqual({ [PERSON]: iso('09:00') });
        });

        it('takes a claimed up-for-grabs chore off everyone else for the day', () => {
            const inputs = buildCountdownChoreInputs(
                [
                    chore({
                        isUpForGrabs: true,
                        completions: [
                            { id: 'a', completed: true, dateDue: DATE_KEY, dateCompleted: iso('09:00'), completedBy: { id: 'person-b' } },
                        ],
                    }) as any,
                ],
                TEST_DATE,
            );
            expect(inputs[0].assigneeIds).toEqual(['person-b']);
        });
    });

    describe('the queue', () => {
        it('queues every chore on the plate, timed or not', () => {
            const queue = queueFor([
                before('dishes', '14:00'),
                makeChore({ id: 'vitamins', estimatedDurationSecs: null }),
                makeChore({ id: 'tidy', estimatedDurationSecs: null, weight: 3 }),
            ]);

            expect(ids(queue).sort()).toEqual(['dishes', 'tidy', 'vitamins']);
            expect(queue.find((step) => step.choreId === 'vitamins')!.durationSecs).toBeNull();
            expect(queue.find((step) => step.choreId === 'tidy')!.durationSecs).toBe(180);
        });

        it('queues only the chores assigned to that person', () => {
            const queue = queueFor([before('mine', '14:00'), before('theirs', '14:00', { assigneeIds: ['person-b'] })]);
            expect(ids(queue)).toEqual(['mine']);
        });

        it('follows the day list order: earlier deadlines first', () => {
            const queue = queueFor([before('five', '17:00'), before('two', '14:00'), before('four', '16:00'), before('three', '15:00')]);
            expect(ids(queue)).toEqual(['two', 'three', 'four', 'five']);
        });

        it('carries the planner slot as the yardstick, not as the timer', () => {
            const [step] = queueFor([before('dishes', '14:00', { estimatedDurationSecs: 720 })]);
            expect(step.durationSecs).toBe(720);
            expect(step.plannedStartMs).toBe(at('13:48'));
            expect(step.plannedEndMs).toBe(at('14:00'));
            expect(step.deadlineMs).toBe(at('14:00'));
        });

        it('follows a routine’s own order and leaves everything else out', () => {
            const queue = queueFor(
                [before('teeth', '09:00'), before('dress', '08:00'), before('unrelated', '07:00')],
                '06:00',
                ['teeth', 'dress'],
            );
            expect(ids(queue)).toEqual(['teeth', 'dress']);
        });
    });

    describe('the earliest-allowed gate', () => {
        const DAY_START = at('03:00');

        it('lets before_* and anytime chores start from the beginning of the day', () => {
            const queue = queueFor([
                before('before-time', '14:00'),
                makeChore({ id: 'anytime' }),
                makeChore({
                    id: 'before-marker',
                    timingMode: 'before_marker',
                    timingConfig: { mode: 'before_marker', anchor: { sourceType: 'routine', relation: 'before', routineKey: 'dinner' } },
                }),
            ]);
            for (const step of queue) {
                expect(step.earliestStartMs, step.choreId).toBe(DAY_START);
                expect(isRunnerStepLocked(step, at('10:00')), step.choreId).toBe(false);
            }
        });

        it('holds after_time and after_marker chores until their anchor', () => {
            const queue = queueFor([
                after('after-time', '16:00'),
                makeChore({
                    id: 'after-marker',
                    timingMode: 'after_marker',
                    timingConfig: { mode: 'after_marker', anchor: { sourceType: 'routine', relation: 'after', routineKey: 'dinner' } },
                }),
            ]);
            const afterTime = queue.find((step) => step.choreId === 'after-time')!;
            const afterMarker = queue.find((step) => step.choreId === 'after-marker')!;

            expect(afterTime.earliestStartMs).toBe(at('16:00'));
            expect(afterMarker.earliestStartMs).toBe(at('18:30')); // Dinner's default time
            expect(isRunnerStepLocked(afterTime, at('15:59'))).toBe(true);
            expect(isRunnerStepLocked(afterTime, at('16:00'))).toBe(false);
            // A start-driven chore has no hard deadline to miss.
            expect(afterTime.deadlineMs).toBeNull();
        });

        it('holds window chores until the window opens', () => {
            const queue = queueFor([
                makeChore({
                    id: 'between',
                    timingMode: 'between_times',
                    timingConfig: { mode: 'between_times', window: { startTime: '14:00', endTime: '15:00' } },
                }),
                makeChore({ id: 'evening', timingMode: 'named_window', timingConfig: { mode: 'named_window', namedWindowKey: 'evening' } }),
            ]);
            const between = queue.find((step) => step.choreId === 'between')!;
            const evening = queue.find((step) => step.choreId === 'evening')!;

            expect(between.earliestStartMs).toBe(at('14:00'));
            expect(between.deadlineMs).toBe(at('15:00'));
            expect(evening.earliestStartMs).toBe(at('17:00'));
            expect(evening.deadlineMs).toBe(at('21:00'));
        });

        it('holds an after_chore step until the chore it follows is done', () => {
            const waiting = queueFor([before('dishes', '14:00'), afterChore('sweep', 'dishes')]);
            const sweep = waiting.find((step) => step.choreId === 'sweep')!;
            expect(sweep.earliestStartMs).toBeNull();
            expect(sweep.waitingOnChoreId).toBe('dishes');
            expect(sweep.waitingOnTitle).toBe('dishes');
            expect(isRunnerStepLocked(sweep, at('23:00'))).toBe(true);

            const released = queueFor([
                before('dishes', '14:00', { memberCompletions: { [PERSON]: iso('10:05') } }),
                afterChore('sweep', 'dishes'),
            ]);
            const releasedSweep = released.find((step) => step.choreId === 'sweep')!;
            expect(releasedSweep.waitingOnChoreId).toBeNull();
            expect(isRunnerStepLocked(releasedSweep, at('10:05'))).toBe(false);
        });

        it('opens an after_chore step at its fallback time even if the anchor is undone', () => {
            const queue = queueFor([
                before('dishes', '14:00'),
                makeChore({
                    id: 'sweep',
                    timingMode: 'after_chore',
                    timingConfig: {
                        mode: 'after_chore',
                        anchor: { sourceType: 'chore', relation: 'after', sourceChoreId: 'dishes', fallbackTime: '16:00' },
                    },
                }),
            ]);
            const sweep = queue.find((step) => step.choreId === 'sweep')!;
            expect(sweep.earliestStartMs).toBe(at('16:00'));
            expect(sweep.waitingOnChoreId).toBe('dishes');
        });

        it('does not gate on an anchor that is not due today', () => {
            const [sweep] = queueFor([afterChore('sweep', 'not-today')]);
            expect(sweep.waitingOnChoreId).toBeNull();
            expect(isRunnerStepLocked(sweep, at('10:00'))).toBe(false);
        });

        it('lets routine order supersede after_chore chaining inside the routine', () => {
            const queue = queueFor([before('dishes', '14:00'), afterChore('sweep', 'dishes')], '10:00', ['sweep', 'dishes']);
            expect(ids(queue)).toEqual(['sweep', 'dishes']);
            expect(isRunnerStepLocked(queue[0], at('10:00'))).toBe(false);
        });
    });

    describe('choosing the next step', () => {
        it('works ahead through an afternoon of chores from the morning', () => {
            const chores = [before('two', '14:00'), before('three', '15:00'), before('four', '16:00'), before('five', '17:00')];
            expect(selectNextRunnerStep(queueFor(chores), at('10:00'))?.choreId).toBe('two');

            chores[0].memberCompletions[PERSON] = iso('10:08');
            expect(selectNextRunnerStep(queueFor(chores, '10:08'), at('10:08'))?.choreId).toBe('three');
        });

        it('skips a gated step and resurfaces it once it unlocks', () => {
            const chores = [
                makeChore({
                    id: 'gated',
                    timingMode: 'between_times',
                    timingConfig: { mode: 'between_times', window: { startTime: '11:00', endTime: '12:00' } },
                }),
                before('later', '15:00'),
                before('latest', '17:00'),
            ];

            expect(selectNextRunnerStep(queueFor(chores, '10:00'), at('10:00'))?.choreId).toBe('later');
            expect(selectNextRunnerStep(queueFor(chores, '11:00'), at('11:00'))?.choreId).toBe('gated');
        });

        it('returns nothing when every remaining step is still gated', () => {
            expect(selectNextRunnerStep(queueFor([after('evening', '16:00')]), at('10:00'))).toBeNull();
        });

        it('treats a chore finished in the same transaction as done', () => {
            const queue = queueFor([before('dishes', '14:00'), afterChore('sweep', 'dishes')]);
            expect(selectNextRunnerStep(queue, at('10:00'), { settledChoreIds: ['dishes'] })?.choreId).toBe('sweep');
        });
    });

    describe('the runner clock', () => {
        const [dishes] = queueFor([before('dishes', '14:00', { estimatedDurationSecs: 720 })]);
        const run = makeRun({ currentChoreId: 'dishes' });

        it('counts down the step’s own duration, not the time until its slot', () => {
            const clock = getRunnerClock(run, dishes, at('10:00'))!;
            expect(clock.state).toBe('running');
            expect(clock.remainingMs).toBe(720_000);
            expect(clock.endMs).toBe(at('10:12'));
            expect(getRunnerClock(run, dishes, at('10:06'))!.progress).toBeCloseTo(0.5);
        });

        it('counts up once the step passes zero', () => {
            const clock = getRunnerClock(run, dishes, at('10:15'))!;
            expect(clock.state).toBe('overrun');
            expect(clock.remainingMs).toBe(-180_000);
            expect(clock.overrunMs).toBe(180_000);
            expect(clock.progress).toBe(1);
        });

        it('adds granted extensions to the budget', () => {
            const clock = getRunnerClock({ ...run, stepExtensionSecs: 300 }, dishes, at('10:15'))!;
            expect(clock.state).toBe('running');
            expect(clock.remainingMs).toBe(120_000);
        });

        it('has no ring for an untimed step', () => {
            const [vitamins] = queueFor([makeChore({ id: 'vitamins', estimatedDurationSecs: null })]);
            const clock = getRunnerClock(makeRun({ currentChoreId: 'vitamins' }), vitamins, at('11:00'))!;
            expect(clock).toMatchObject({ state: 'untimed', endMs: null, remainingMs: null, overrunMs: 0 });
        });

        it('holds at a full budget until a delayed start arrives', () => {
            const clock = getRunnerClock({ ...run, stepStartedAt: iso('10:00:30') }, dishes, at('10:00'))!;
            expect(clock.state).toBe('starting');
            expect(clock.remainingMs).toBe(720_000);
            expect(clock.progress).toBe(0);
        });

        it('has no clock when the run is on a different step', () => {
            expect(getRunnerClock(makeRun({ currentChoreId: 'other' }), dishes, at('10:00'))).toBeNull();
        });
    });

    describe('overrun and abandonment', () => {
        // A two-minute step: the prompt threshold is max(5 min, 50% of 2 min) = 5 min.
        const [teeth] = queueFor([before('teeth', '14:00', { estimatedDurationSecs: 120 })]);
        const run = makeRun({ currentChoreId: 'teeth' });
        const status = (time: string, overrides: Partial<CountdownRunLike> = {}) =>
            getRunnerOverrunStatus({ ...run, ...overrides }, teeth, SETTINGS, at(time));

        it('stays quiet while the step is within its budget', () => {
            expect(status('10:01').prompt).toBe('none');
        });

        it('waits past zero without prompting until the threshold', () => {
            expect(status('10:06:59')).toMatchObject({ prompt: 'none', timedOut: false, shouldAutoAdvance: false });
        });

        it('asks whether you are still working once overdue and untouched', () => {
            expect(status('10:07')).toMatchObject({ prompt: 'still_working', promptSinceMs: at('10:07'), timedOut: false });
        });

        it('uses half the step’s duration when that is longer than the minimum', () => {
            const [long] = queueFor([before('long', '14:00', { estimatedDurationSecs: 1800 })]);
            const longRun = makeRun({ currentChoreId: 'long' });
            // 30 min step: threshold is 15 min, so the prompt is due at 10:45.
            expect(getRunnerOverrunStatus(longRun, long, SETTINGS, at('10:44')).prompt).toBe('none');
            expect(getRunnerOverrunStatus(longRun, long, SETTINGS, at('10:45')).prompt).toBe('still_working');
        });

        it('does not prompt someone who is overdue but present', () => {
            // A tap on any device at 10:06 proves someone is there.
            expect(status('10:07', { lastInteractionAt: iso('10:06') }).prompt).toBe('none');
            expect(status('10:11', { lastInteractionAt: iso('10:06') }).prompt).toBe('still_working');
        });

        it('does not prompt an idle run that is not yet overdue', () => {
            const [long] = queueFor([before('long', '14:00', { estimatedDurationSecs: 2700 })]);
            const abandoned = makeRun({ currentChoreId: 'long' });
            // A 45-minute chore abandoned at minute one: idle for half an hour, but still within budget.
            expect(getRunnerOverrunStatus(abandoned, long, SETTINGS, at('10:30')).prompt).toBe('none');
        });

        it('stops the run when the prompt goes unanswered for the grace period', () => {
            expect(status('10:16:59').timedOut).toBe(false);
            expect(status('10:17').timedOut).toBe(true);
        });

        it('offers to stop the run after repeated extensions on one step', () => {
            const extended = { stepExtensionCount: 2, stepExtensionSecs: 600, lastInteractionAt: iso('10:07') };
            // Budget is now 12 minutes, so the prompt is due again at 10:17.
            expect(status('10:16', extended).prompt).toBe('none');
            expect(status('10:17', extended).prompt).toBe('still_working_or_stop');
        });

        it('never prompts on an untimed step', () => {
            const [vitamins] = queueFor([makeChore({ id: 'vitamins', estimatedDurationSecs: null })]);
            const untimedRun = makeRun({ currentChoreId: 'vitamins' });
            expect(getRunnerOverrunStatus(untimedRun, vitamins, SETTINGS, at('20:00')).prompt).toBe('none');
        });

        it('moves a routine set to advance on as soon as the step’s time is up', () => {
            expect(getRunnerOverrunStatus(run, teeth, SETTINGS, at('10:01'), 'advance').shouldAutoAdvance).toBe(false);
            expect(getRunnerOverrunStatus(run, teeth, SETTINGS, at('10:02:01'), 'advance')).toMatchObject({
                prompt: 'none',
                shouldAutoAdvance: true,
            });
        });
    });

    describe('ahead/behind and the deadline forecast', () => {
        const afternoon = () => [
            before('two', '14:00'),
            before('three', '15:00'),
            before('four', '16:00'),
            before('five', '17:00'),
        ];

        it('reads hours ahead when an afternoon chore is started in the morning', () => {
            const standing = computeRunnerStanding(queueFor(afternoon()), makeRun({ currentChoreId: 'two' }), SETTINGS, at('10:00'));
            // Planned to end at 14:00; at this pace it ends at 10:10.
            expect(standing.aheadSecs).toBe((3 * 60 + 50) * 60);
            expect(ids(standing.projection)).toEqual(['two', 'three', 'four', 'five']);
            expect(standing.projection[3].projectedEndMs).toBe(at('10:40'));
            expect(standing.firstMiss).toBeNull();
            expect(standing.tightest?.choreId).toBe('two');
        });

        it('folds an overrun into the figure in real time', () => {
            const queue = queueFor(afternoon(), '13:55');
            const run = makeRun({ currentChoreId: 'two', stepStartedAt: iso('13:45') });
            // The ten-minute step should have ended at 13:55.
            expect(computeRunnerStanding(queue, run, SETTINGS, at('13:55')).aheadSecs).toBe(300);
            expect(computeRunnerStanding(queue, run, SETTINGS, at('14:03')).aheadSecs).toBe(-180);
        });

        it('forecasts the first hard deadline the current pace will miss', () => {
            const chores = [before('homework', '17:00', { estimatedDurationSecs: 3600 }), before('dishes', '17:30', { estimatedDurationSecs: 1800 })];
            const queue = queueFor(chores, '16:30');
            const standing = computeRunnerStanding(queue, makeRun({ currentChoreId: 'homework', stepStartedAt: iso('16:30') }), SETTINGS, at('16:30'));

            expect(standing.firstMiss).toMatchObject({ choreId: 'homework', marginSecs: -1800 });
            expect(standing.projection[1]).toMatchObject({ choreId: 'dishes', projectedEndMs: at('18:00'), marginSecs: -1800 });
            expect(standing.aheadSecs).toBe(-1800); // Planned to end at 17:00; at this pace it ends at 17:30.
        });

        it('puts the stack buffer between projected steps', () => {
            const buffered = { ...SETTINGS, stackBufferSecs: 30 };
            const input = { ...makeInput(afternoon()), countdownSettings: buffered };
            const queue = buildRunnerQueue(input, { personId: PERSON });
            const standing = computeRunnerStanding(queue, makeRun({ currentChoreId: 'two' }), buffered, at('10:00'));
            expect(standing.projection[1].projectedStartMs).toBe(at('10:10:30'));
        });

        it('projects from now when no run is live', () => {
            const standing = computeRunnerStanding(queueFor(afternoon()), null, SETTINGS, at('10:00'));
            expect(standing.projection[0]).toMatchObject({ choreId: 'two', projectedStartMs: at('10:00'), projectedEndMs: at('10:10') });
        });

        it('waits at a gate without counting the wait as ahead or behind', () => {
            const queue = queueFor([after('evening', '16:00'), makeChore({ id: 'vitamins', estimatedDurationSecs: null })]);
            const standing = computeRunnerStanding(queue, makeRun({ currentChoreId: 'vitamins' }), SETTINGS, at('10:00'));

            expect(ids(standing.projection)).toEqual(['vitamins', 'evening']);
            expect(standing.projection[1].projectedStartMs).toBe(at('16:00'));
            expect(standing.aheadSecs).toBeNull();
        });

        it('leaves out steps that wait on a chore nobody has finished', () => {
            const queue = queueFor([afterChore('sweep', 'dishes'), before('dishes', '14:00', { assigneeIds: ['person-b'] })]);
            expect(computeRunnerStanding(queue, null, SETTINGS, at('10:00')).projection).toEqual([]);
        });

        it('leaves finished and skipped steps out of the projection', () => {
            const chores = afternoon();
            chores[0].memberCompletions[PERSON] = iso('09:30');
            const run = makeRun({ currentChoreId: 'three', skippedChoreIds: ['four'] });
            expect(ids(computeRunnerStanding(queueFor(chores), run, SETTINGS, at('10:00')).projection)).toEqual(['three', 'five']);
        });
    });

    describe('transitions', () => {
        const chores = () => [before('two', '14:00'), before('three', '15:00'), after('evening', '16:00')];

        it('starts a run on a step with a fresh timer', () => {
            const [two] = queueFor(chores());
            const patch = buildRunStartPatch({ familyMemberId: PERSON, date: DATE_KEY, step: two, nowMs: at('10:00') });

            expect(patch).toEqual({
                familyMemberId: PERSON,
                date: DATE_KEY,
                routineId: null,
                status: 'running',
                currentChoreId: 'two',
                stepStartedAt: iso('10:00'),
                stepExtensionSecs: 0,
                stepExtensionCount: 0,
                skippedChoreIds: [],
                lastInteractionAt: iso('10:00'),
                startedAt: iso('10:00'),
                stoppedAt: null,
                stoppedReason: null,
            });
        });

        it('leaves the row’s identity alone when restarting later the same day', () => {
            const [two] = queueFor(chores());
            const patch = buildRunStartPatch({
                familyMemberId: PERSON,
                date: DATE_KEY,
                routineId: 'morning',
                step: two,
                nowMs: at('10:00'),
                existingRun: makeRun({ status: 'stopped' }),
            });
            expect(patch).not.toHaveProperty('familyMemberId');
            expect(patch).not.toHaveProperty('date');
            expect(patch.routineId).toBe('morning');
        });

        it('advances to the next open step and resets the extension state', () => {
            const run = makeRun({ currentChoreId: 'two', stepExtensionSecs: 300, stepExtensionCount: 1 });
            const patch = buildRunAdvancePatch(run, queueFor(chores()), at('10:08'), { settledChoreIds: ['two'] });

            expect(patch).toEqual({
                currentChoreId: 'three',
                stepStartedAt: iso('10:08'),
                stepExtensionSecs: 0,
                stepExtensionCount: 0,
                lastInteractionAt: iso('10:08'),
            });
        });

        it('delays the next step’s timer by the celebration pause', () => {
            const patch = buildRunAdvancePatch(makeRun({ currentChoreId: 'two' }), queueFor(chores()), at('10:08'), {
                settledChoreIds: ['two'],
                startDelaySecs: 30,
            });
            expect(patch.stepStartedAt).toBe(iso('10:08:30'));
            expect(patch.lastInteractionAt).toBe(iso('10:08'));
        });

        it('finishes the run when only gated steps are left', () => {
            const run = makeRun({ currentChoreId: 'three' });
            const queue = queueFor([before('three', '15:00'), after('evening', '16:00')]);
            const patch = buildRunAdvancePatch(run, queue, at('10:20'), { settledChoreIds: ['three'] });

            expect(patch).toEqual({ status: 'stopped', stoppedAt: iso('10:20'), stoppedReason: 'finished' });
        });

        it('skips the live step for a routine set to advance, and does not return to it', () => {
            const queue = queueFor(chores());
            const skipped = buildRunAdvancePatch(makeRun({ currentChoreId: 'two' }), queue, at('10:10'), { skipCurrent: true });
            expect(skipped).toMatchObject({ currentChoreId: 'three', skippedChoreIds: ['two'] });

            const afterSkip = makeRun({ currentChoreId: 'three', skippedChoreIds: ['two'] });
            const finished = buildRunAdvancePatch(afterSkip, queue, at('10:20'), { settledChoreIds: ['three'] });
            expect(finished.stoppedReason).toBe('finished');
        });

        it('stops without clearing the step the run ended on', () => {
            const patch = buildRunStopPatch('timeout', at('10:30'));
            expect(patch).toEqual({ status: 'stopped', stoppedAt: iso('10:30'), stoppedReason: 'timeout' });
            expect(patch).not.toHaveProperty('currentChoreId');
        });

        it('adds five minutes to a step that still has time', () => {
            const [two] = queueFor(chores());
            const patch = buildRunExtendPatch(makeRun({ currentChoreId: 'two' }), two, SETTINGS, at('10:04'));
            expect(patch).toEqual({ stepExtensionSecs: 300, stepExtensionCount: 1, lastInteractionAt: iso('10:04') });
        });

        it('gives an overrun step the full five minutes from now', () => {
            const [two] = queueFor(chores());
            const run = makeRun({ currentChoreId: 'two' });
            const extended = { ...run, ...buildRunExtendPatch(run, two, SETTINGS, at('10:13')) };

            expect(extended.stepExtensionCount).toBe(1);
            expect(getRunnerClock(extended, two, at('10:13'))!.remainingMs).toBe(300_000);
        });

        it('records at most one interaction a minute, and only on a live run', () => {
            const run = makeRun({ lastInteractionAt: iso('10:00') });
            expect(shouldRecordRunInteraction(run, at('10:00:30'))).toBe(false);
            expect(shouldRecordRunInteraction(run, at('10:01'))).toBe(true);
            expect(shouldRecordRunInteraction({ ...run, status: 'stopped' }, at('10:05'))).toBe(false);
            expect(shouldRecordRunInteraction(null, at('10:05'))).toBe(false);
        });
    });

    describe('the resolved state', () => {
        const chores = () => [before('two', '14:00'), before('three', '15:00'), after('evening', '16:00')];
        const resolve = (run: CountdownRunLike | null, source = chores(), now = '10:00') =>
            resolveRunnerState({ queue: queueFor(source, now), run, settings: SETTINGS, nowMs: at(now) });

        it('is idle with the first open step ready to start', () => {
            const state = resolve(null);
            expect(state).toMatchObject({ phase: 'idle', liveStep: null, clock: null, totalCount: 3, completedCount: 0 });
            expect(state.nextStep?.choreId).toBe('two');
            expect(ids(state.lockedSteps)).toEqual(['evening']);
        });

        it('runs the live step and previews the one after it', () => {
            const state = resolve(makeRun({ currentChoreId: 'two' }));
            expect(state.phase).toBe('running');
            expect(state.liveStep?.choreId).toBe('two');
            expect(state.clock?.remainingMs).toBe(600_000);
            expect(state.nextStep?.choreId).toBe('three');
            expect(state.needsAdvance).toBe(false);
        });

        it('goes back to idle once the run is stopped', () => {
            const state = resolve(makeRun({ currentChoreId: 'two', status: 'stopped', stoppedReason: 'user' }));
            expect(state.phase).toBe('idle');
            expect(state.nextStep?.choreId).toBe('two');
        });

        it('asks to be advanced when the live step was finished somewhere else', () => {
            const source = chores();
            source[0].memberCompletions[PERSON] = iso('10:05');
            expect(resolve(makeRun({ currentChoreId: 'two' }), source, '10:05').needsAdvance).toBe(true);
        });

        it('asks to be advanced when the live step has left the queue', () => {
            expect(resolve(makeRun({ currentChoreId: 'deleted' })).needsAdvance).toBe(true);
        });

        it('knows when everything is done', () => {
            const source = [before('two', '14:00', { memberCompletions: { [PERSON]: iso('09:00') } })];
            expect(resolve(null, source)).toMatchObject({ allDone: true, nextStep: null, completedCount: 1 });
        });
    });
});
