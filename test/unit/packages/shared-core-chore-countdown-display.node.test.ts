import { describe, expect, it } from 'vitest';
import {
    describeForecast,
    describeGate,
    describeLastStop,
    describePace,
    describeRunnerPanel,
    describeSchedule,
    formatCountdown,
    formatSpan,
    type RunnerClock,
    type RunnerProjectionEntry,
    type RunnerState,
    type RunnerStep,
} from '@family-organizer/shared-core';

const T0 = new Date('2026-03-31T10:00:00').getTime();
const MIN = 60_000;

function makeStep(overrides: Partial<RunnerStep> = {}): RunnerStep {
    return {
        choreId: 'dishes',
        title: 'Dishes',
        personId: 'kid-a',
        timingMode: 'before_time',
        durationSecs: 600,
        earliestStartMs: T0 - 7 * 60 * MIN,
        waitingOnChoreId: null,
        waitingOnTitle: null,
        deadlineMs: T0 + 4 * 60 * MIN,
        plannedStartMs: T0 + 230 * MIN,
        plannedEndMs: T0 + 240 * MIN,
        completedAtMs: null,
        isJoint: false,
        ...overrides,
    };
}

function makeState(overrides: Partial<RunnerState> = {}): RunnerState {
    return {
        phase: 'idle',
        queue: [],
        totalCount: 0,
        completedCount: 0,
        allDone: false,
        liveStep: null,
        clock: null,
        nextStep: null,
        lockedSteps: [],
        standing: { aheadSecs: null, projection: [], firstMiss: null, tightest: null },
        overrun: { prompt: 'none', promptSinceMs: null, timedOut: false, shouldAutoAdvance: false },
        needsAdvance: false,
        ...overrides,
    };
}

function makeClock(overrides: Partial<RunnerClock> = {}): RunnerClock {
    return { state: 'running', startMs: T0 - 4 * MIN, endMs: T0 + 6 * MIN, remainingMs: 6 * MIN, overrunMs: 0, progress: 0.4, ...overrides };
}

function running(clock: Partial<RunnerClock> = {}, overrides: Partial<RunnerState> = {}): RunnerState {
    return makeState({ phase: 'running', liveStep: makeStep(), clock: makeClock(clock), ...overrides });
}

function entry(overrides: Partial<RunnerProjectionEntry> = {}): RunnerProjectionEntry {
    return {
        choreId: 'dishes',
        title: 'Dishes',
        projectedStartMs: T0,
        projectedEndMs: T0 + 10 * MIN,
        deadlineMs: T0 + 4 * 60 * MIN,
        marginSecs: 230 * 60,
        ...overrides,
    };
}

describe('countdown runner display', () => {
    describe('formatting', () => {
        it('formats the ring digits', () => {
            expect(formatCountdown(6 * MIN)).toEqual({ main: '6:00', sub: '', sign: '' });
            expect(formatCountdown(65 * MIN + 7000)).toEqual({ main: '1:05', sub: '07', sign: '' });
            expect(formatCountdown(0)).toEqual({ main: '0:00', sub: '', sign: '' });
        });

        it('marks a step that is counting up', () => {
            expect(formatCountdown(-3 * MIN)).toEqual({ main: '3:00', sub: '', sign: '+' });
            // The half second around zero rounds to 0:00 and carries no sign.
            expect(formatCountdown(-400).sign).toBe('');
        });

        it('says a span of time in words', () => {
            expect(formatSpan(45)).toBe('45s');
            expect(formatSpan(300)).toBe('5m');
            expect(formatSpan(330)).toBe('5m 30s');
            expect(formatSpan(725)).toBe('12m');
            expect(formatSpan(13_800)).toBe('3h 50m');
            expect(formatSpan(7200)).toBe('2h');
            expect(formatSpan(-180)).toBe('3m');
        });
    });

    describe('what a panel shows', () => {
        it('runs a timed step on the runner clock', () => {
            const view = describeRunnerPanel(running(), T0);
            expect(view).toMatchObject({ mode: 'running', readoutMs: 6 * MIN, readoutLabel: null });
            expect(view.ring).toMatchObject({ startMs: T0 - 4 * MIN, endMs: T0 + 6 * MIN, state: 'active' });
        });

        it('counts an overrun step up in red', () => {
            const view = describeRunnerPanel(running({ state: 'overrun', remainingMs: -2 * MIN, overrunMs: 2 * MIN, progress: 1 }), T0);
            expect(view).toMatchObject({ mode: 'overrun', readoutMs: -2 * MIN, readoutLabel: 'Over time' });
            expect(view.ring?.state).toBe('overdue');
        });

        it('celebrates until a delayed start arrives', () => {
            const view = describeRunnerPanel(running({ state: 'starting', startMs: T0 + 20_000 }), T0);
            expect(view).toMatchObject({ mode: 'celebrating', readoutMs: 20_000 });
            expect(view.ring?.state).toBe('celebrating');
        });

        it('shows an untimed step with no ring', () => {
            const view = describeRunnerPanel(running({ state: 'untimed', endMs: null, remainingMs: null }), T0);
            expect(view).toMatchObject({ mode: 'untimed', ring: null, readoutMs: null });
        });

        it('is ready when a step could start before its slot', () => {
            const view = describeRunnerPanel(makeState({ nextStep: makeStep() }), T0);
            expect(view).toMatchObject({ mode: 'ready', ring: null });
            expect(view.step?.choreId).toBe('dishes');
        });

        it('brings the planner slot back once its time has come', () => {
            const state = makeState({ nextStep: makeStep({ plannedStartMs: T0 - 4 * MIN, plannedEndMs: T0 + 6 * MIN }) });
            expect(describeRunnerPanel(state, T0)).toMatchObject({
                mode: 'due',
                readoutMs: 6 * MIN,
                readoutLabel: 'Due in',
                ring: { state: 'active', progress: 0.4 },
            });
            expect(describeRunnerPanel(state, T0 + 8 * MIN)).toMatchObject({
                mode: 'due',
                readoutMs: -2 * MIN,
                readoutLabel: 'Past due',
                ring: { state: 'overdue', progress: 1 },
            });
        });

        it('never shows a planner ring for a step the planner did not pack', () => {
            const state = makeState({ nextStep: makeStep({ plannedStartMs: null, plannedEndMs: null }) });
            expect(describeRunnerPanel(state, T0).mode).toBe('ready');
        });

        it('waits when everything left is gated, and is done otherwise', () => {
            expect(describeRunnerPanel(makeState({ lockedSteps: [makeStep()] }), T0).mode).toBe('waiting');
            expect(describeRunnerPanel(makeState({ allDone: true }), T0).mode).toBe('done');
            expect(describeRunnerPanel(makeState(), T0).mode).toBe('done');
        });
    });

    describe('readouts', () => {
        const standing = (overrides: Partial<RunnerState['standing']>) => ({
            aheadSecs: null,
            projection: [],
            firstMiss: null,
            tightest: null,
            ...overrides,
        });

        it('reads ahead, behind, or on schedule while running', () => {
            expect(describePace(running({}, { standing: standing({ aheadSecs: 13_800 }) }))).toEqual({ tone: 'ahead', label: '3h 50m ahead' });
            expect(describePace(running({}, { standing: standing({ aheadSecs: -180 }) }))).toEqual({ tone: 'behind', label: '3m behind' });
            expect(describePace(running({}, { standing: standing({ aheadSecs: 12 }) }))).toEqual({ tone: 'even', label: 'On schedule' });
        });

        it('has no pace without a run or without a planned step', () => {
            expect(describePace(makeState({ standing: standing({ aheadSecs: 600 }) }))).toBeNull();
            expect(describePace(running())).toBeNull();
        });

        it('turns an overlap into a forecast sentence', () => {
            const miss = entry({ title: 'Dinner Dishes', marginSecs: -720 });
            expect(describeForecast(running({}, { standing: standing({ firstMiss: miss, tightest: miss }) }))).toEqual({
                tone: 'miss',
                label: 'Keep going and you will miss Dinner Dishes by 12m',
            });
            expect(describeForecast(makeState({ standing: standing({ firstMiss: miss, tightest: miss }) }))).toEqual({
                tone: 'miss',
                label: 'Even starting now, Dinner Dishes runs 12m late',
            });
        });

        it('says how much room the tightest deadline has, but only mid-run', () => {
            const tightest = entry();
            const forecast = describeForecast(running({}, { standing: standing({ tightest }) }));
            expect(forecast?.tone).toBe('clear');
            expect(forecast?.label).toMatch(/^3h 50m to spare before Dishes at 2:00\sPM$/);
            expect(describeForecast(makeState({ standing: standing({ tightest }) }))).toBeNull();
            expect(describeForecast(running())).toBeNull();
        });

        it('says when a gated step opens', () => {
            expect(describeGate(makeStep({ earliestStartMs: T0 + 6 * 60 * MIN }))).toMatch(/^Unlocks at 4:00\sPM$/);
            expect(describeGate(makeStep({ earliestStartMs: null, waitingOnTitle: 'Dishes' }))).toBe('After Dishes');
            expect(describeGate(makeStep({ earliestStartMs: T0 + 6 * 60 * MIN, waitingOnTitle: 'Dishes' }))).toMatch(
                /^After Dishes, or at 4:00\sPM$/,
            );
            expect(describeGate(makeStep({ earliestStartMs: null }))).toBe('Not available yet');
        });

        it('says when the plan wanted a step started', () => {
            expect(describeSchedule(makeStep(), T0)).toMatch(/^Start by 1:50\sPM · due 2:00\sPM$/);
            expect(describeSchedule(makeStep(), T0 + 235 * MIN)).toMatch(/^Was due to start at 1:50\sPM · due 2:00\sPM$/);
            expect(describeSchedule(makeStep({ plannedStartMs: null, plannedEndMs: null }), T0)).toMatch(/^Due by 2:00\sPM$/);
            expect(describeSchedule(makeStep({ plannedStartMs: null, plannedEndMs: null, deadlineMs: null }), T0)).toBeNull();
        });

        it('explains an automatic stop and stays quiet about an ordinary one', () => {
            const run = { familyMemberId: 'kid-a', date: '2026-03-31', status: 'stopped' };
            expect(describeLastStop({ ...run, stoppedReason: 'timeout' })).toMatch(/nobody answered/);
            expect(describeLastStop({ ...run, stoppedReason: 'day_boundary' })).toMatch(/day ended/);
            expect(describeLastStop({ ...run, stoppedReason: 'user' })).toBeNull();
            expect(describeLastStop({ ...run, stoppedReason: 'finished' })).toBeNull();
            expect(describeLastStop({ ...run, status: 'running', stoppedReason: 'timeout' })).toBeNull();
            expect(describeLastStop(null)).toBeNull();
        });
    });
});
