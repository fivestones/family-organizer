// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freezeTime } from '@/test/utils/fake-clock';
import { createCountdownRunId } from '@family-organizer/shared-core';

const DATE_KEY = '2026-03-31';

const mocks = vi.hoisted(() => ({
    data: null as any,
    isLoading: false,
    error: null as any,
    transact: vi.fn().mockResolvedValue(undefined),
    toast: vi.fn(),
    currentUser: { id: 'kid-a', name: 'Alex', role: 'child' } as any,
    isParentMode: false,
    nextId: 0,
}));

vi.mock('@/lib/db', () => ({
    db: {
        useQuery: () => ({ isLoading: mocks.isLoading, error: mocks.error, data: mocks.data }),
        transact: (...args: any[]) => mocks.transact(...args),
    },
}));

vi.mock('@instantdb/react', () => {
    const tx = new Proxy(
        {},
        {
            get(_root, entity: string) {
                return new Proxy(
                    {},
                    {
                        get(_entity, id: string) {
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
    return { tx, id: () => `mock-id-${(mocks.nextId += 1)}` };
});

vi.mock('@/components/AuthProvider', () => ({
    useAuth: () => ({ currentUser: mocks.currentUser }),
}));

vi.mock('@/components/auth/useParentMode', () => ({
    useParentMode: () => ({ isParentMode: mocks.isParentMode }),
}));

vi.mock('@/components/ui/use-toast', () => ({
    useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, ...props }: any) => (
        <a href={typeof href === 'string' ? href : '#'} {...props}>
            {children}
        </a>
    ),
}));

import FocusedCountdownPage from '@/components/countdown/FocusedCountdownPage';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function at(time: string): string {
    return new Date(`${DATE_KEY}T${time.length === 5 ? `${time}:00` : time}`).toISOString();
}

function makeChore(id: string, memberId: string, overrides: Record<string, unknown> = {}) {
    return {
        id,
        title: id,
        startDate: DATE_KEY,
        rrule: null,
        rotationType: 'none',
        assignees: [{ id: memberId }],
        assignments: [],
        estimatedDurationSecs: 600,
        ...overrides,
    };
}

const beforeTime = (time: string) => ({ timingMode: 'before_time', timingConfig: { mode: 'before_time', time } });

/** Alex: Dishes (due 14:00, ten minutes), then Homework (due 15:00), with Evening locked until 16:00. */
function makeData(overrides: Record<string, unknown> = {}) {
    return {
        settings: [],
        familyMembers: [
            { id: 'kid-a', name: 'Alex' },
            { id: 'kid-b', name: 'Blair' },
        ],
        chores: [
            makeChore('Dishes', 'kid-a', { ...beforeTime('14:00'), description: 'Rinse first' }),
            makeChore('Homework', 'kid-a', beforeTime('15:00')),
            makeChore('Evening', 'kid-a', { timingMode: 'after_time', timingConfig: { mode: 'after_time', time: '16:00' } }),
            makeChore('Laundry', 'kid-b', beforeTime('15:00')),
        ],
        choreCompletions: [],
        countdownRuns: [],
        routineMarkerStatuses: [],
        routines: [],
        ...overrides,
    };
}

/**
 * Alex's Morning Routine: Teeth (two minutes) and Vitamins (untimed) exist only
 * inside it; Dishes is an ordinary chore the routine also points at.
 */
function makeRoutineData(overrides: Record<string, unknown> = {}, onStepOverrun = 'wait') {
    const inRoutine = (id: string) => ({ routineSteps: [{ id: `step-${id}` }] });
    return makeData({
        chores: [
            makeChore('Dishes', 'kid-a', { ...beforeTime('14:00'), ...inRoutine('Dishes') }),
            makeChore('Homework', 'kid-a', beforeTime('15:00')),
            makeChore('Teeth', 'kid-a', { estimatedDurationSecs: 120, hideFromDayList: true, ...inRoutine('Teeth') }),
            makeChore('Vitamins', 'kid-a', { estimatedDurationSecs: null, hideFromDayList: true, ...inRoutine('Vitamins') }),
        ],
        routines: [
            {
                id: 'morning',
                name: 'Morning Routine',
                onStepOverrun,
                steps: [
                    { id: 'step-Teeth', position: 0, chore: { id: 'Teeth' } },
                    { id: 'step-Vitamins', position: 1, chore: { id: 'Vitamins' } },
                    { id: 'step-Dishes', position: 2, chore: { id: 'Dishes' } },
                ],
            },
        ],
        ...overrides,
    });
}

function makeRun(overrides: Record<string, unknown> = {}) {
    return {
        id: createCountdownRunId('kid-a', DATE_KEY),
        familyMemberId: 'kid-a',
        date: DATE_KEY,
        status: 'running',
        currentChoreId: 'Dishes',
        stepStartedAt: at('09:56'),
        stepExtensionSecs: 0,
        stepExtensionCount: 0,
        lastInteractionAt: at('09:59:30'),
        startedAt: at('09:56'),
        ...overrides,
    };
}

function lastTransaction(): any[] {
    const calls = mocks.transact.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const argument = calls[calls.length - 1][0];
    return Array.isArray(argument) ? argument : [argument];
}

function runUpdate(transaction: any[] = lastTransaction()) {
    return transaction.find((entry) => entry.op === 'update' && entry.entity === 'countdownRuns');
}

function panel(memberId = 'kid-a') {
    return screen.getByTestId(`countdown-panel-${memberId}`);
}

describe('FocusedCountdownPage', () => {
    beforeEach(() => {
        freezeTime(new Date(`${DATE_KEY}T10:00:00`));
        vi.stubGlobal(
            'ResizeObserver',
            class {
                observe() {}
                disconnect() {}
            },
        );
        mocks.data = makeData();
        mocks.isLoading = false;
        mocks.error = null;
        mocks.transact.mockReset().mockResolvedValue(undefined);
        mocks.toast.mockClear();
        mocks.currentUser = { id: 'kid-a', name: 'Alex', role: 'child' };
        mocks.isParentMode = false;
        mocks.nextId = 0;
    });

    describe('the page owns its background', () => {
        const expectBackdrop = (container: HTMLElement) =>
            expect((container.firstChild as HTMLElement).style.background).toContain('radial-gradient');

        it('paints it while loading', () => {
            mocks.isLoading = true;
            mocks.data = null;
            const { container } = render(<FocusedCountdownPage />);
            expect(screen.getByText('Loading the countdown…')).toBeInTheDocument();
            expectBackdrop(container);
        });

        it('paints it behind an error', () => {
            mocks.error = { message: 'Offline' };
            const { container } = render(<FocusedCountdownPage />);
            expect(screen.getByText('The countdown could not load')).toBeInTheDocument();
            expect(screen.getByText('Offline')).toBeInTheDocument();
            expectBackdrop(container);
        });

        it('paints it when nothing is due', () => {
            mocks.data = makeData({ chores: [] });
            const { container } = render(<FocusedCountdownPage />);
            expect(screen.getByText('Nothing to count down today')).toBeInTheDocument();
            expectBackdrop(container);
        });

        it('paints every panel, with or without a ring', () => {
            render(<FocusedCountdownPage />);
            expect(panel()).toHaveAttribute('data-mode', 'ready');
            expect((panel().firstChild as HTMLElement).style.background).toContain('radial-gradient');
        });
    });

    describe('starting', () => {
        it('offers the first open step and starts a run on it', () => {
            render(<FocusedCountdownPage />);

            expect(within(panel()).getByRole('heading', { name: 'Dishes' })).toBeInTheDocument();
            expect(within(panel()).getByText(/Start by 1:50\sPM · due 2:00\sPM/)).toBeInTheDocument();

            fireEvent.click(within(panel()).getByRole('button', { name: 'Start' }));

            expect(runUpdate()).toEqual({
                op: 'update',
                entity: 'countdownRuns',
                id: createCountdownRunId('kid-a', DATE_KEY),
                payload: expect.objectContaining({
                    familyMemberId: 'kid-a',
                    date: DATE_KEY,
                    status: 'running',
                    currentChoreId: 'Dishes',
                    stepStartedAt: at('10:00'),
                    routineId: null,
                }),
            });
        });

        it('lists a gated step as locked instead of offering it', () => {
            render(<FocusedCountdownPage />);
            const later = within(panel()).getByText('Evening').closest('li')!;
            expect(later).toHaveTextContent(/Unlocks at 4:00\sPM/);
        });

        it('shows what unlocks later when nothing can be started', () => {
            mocks.data = makeData({
                chores: [makeChore('Evening', 'kid-a', { timingMode: 'after_time', timingConfig: { mode: 'after_time', time: '16:00' } })],
            });
            render(<FocusedCountdownPage />);

            expect(panel()).toHaveAttribute('data-mode', 'waiting');
            expect(within(panel()).queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
            expect(within(panel()).getByText(/Unlocks at 4:00\sPM/)).toBeInTheDocument();
        });

        it('brings the scheduled slot back as a reminder once its time arrives', () => {
            freezeTime(new Date(`${DATE_KEY}T13:55:00`));
            render(<FocusedCountdownPage />);

            expect(panel()).toHaveAttribute('data-mode', 'due');
            expect(within(panel()).getByText('Due in')).toBeInTheDocument();
            expect(within(panel()).getByRole('timer')).toHaveAccessibleName('5:00');
            expect(within(panel()).getByRole('button', { name: 'Start' })).toBeInTheDocument();
        });

        it('restarts on the same row without rewriting its identity', () => {
            mocks.data = makeData({ countdownRuns: [makeRun({ status: 'stopped', stoppedReason: 'user' })] });
            render(<FocusedCountdownPage />);
            fireEvent.click(within(panel()).getByRole('button', { name: 'Start' }));

            const { payload } = runUpdate();
            expect(payload).not.toHaveProperty('familyMemberId');
            expect(payload).not.toHaveProperty('date');
            expect(payload.status).toBe('running');
        });
    });

    describe('running a step', () => {
        beforeEach(() => {
            mocks.data = makeData({ countdownRuns: [makeRun()] });
        });

        it('counts down the step’s own duration with its readouts', () => {
            render(<FocusedCountdownPage />);

            expect(panel()).toHaveAttribute('data-mode', 'running');
            // Ten minutes, started four minutes ago.
            expect(within(panel()).getByRole('timer')).toHaveAccessibleName('6:00');
            expect(within(panel()).getByText('Rinse first')).toBeInTheDocument();
            expect(within(panel()).getByText('3h 54m ahead')).toBeInTheDocument();
            expect(within(panel()).getByText(/to spare before Dishes at 2:00\sPM/)).toBeInTheDocument();
            expect(within(panel()).getByText('Homework')).toBeInTheDocument(); // Next:
        });

        it('completes through the canonical path and advances in one transaction', () => {
            render(<FocusedCountdownPage />);
            fireEvent.click(within(panel()).getByRole('button', { name: 'Done' }));

            expect(mocks.transact).toHaveBeenCalledTimes(1);
            const transaction = lastTransaction();
            expect(transaction.find((entry) => entry.entity === 'choreCompletions')?.payload).toMatchObject({
                completed: true,
                dateDue: DATE_KEY,
                allowanceAwarded: false,
            });
            expect(transaction.find((entry) => entry.entity === 'historyEvents')?.payload).toMatchObject({
                actionType: 'chore_marked_done',
                actorFamilyMemberId: 'kid-a',
            });
            expect(transaction.some((entry) => entry.op === 'link' && entry.payload.markedCompletions)).toBe(true);
            // The next step's timer waits out the default 30-second celebration.
            expect(runUpdate(transaction).payload).toMatchObject({
                currentChoreId: 'Homework',
                stepStartedAt: at('10:00:30'),
                stepExtensionSecs: 0,
            });
        });

        it('finishes the run when only gated steps are left', () => {
            mocks.data = makeData({
                chores: [makeChore('Dishes', 'kid-a', beforeTime('14:00')), makeData().chores[2]],
                countdownRuns: [makeRun()],
            });
            render(<FocusedCountdownPage />);
            fireEvent.click(within(panel()).getByRole('button', { name: 'Done' }));

            expect(runUpdate().payload).toMatchObject({ status: 'stopped', stoppedReason: 'finished' });
        });

        it('adds five minutes', () => {
            render(<FocusedCountdownPage />);
            fireEvent.click(within(panel()).getByRole('button', { name: 'Add 5m to this step' }));
            expect(runUpdate().payload).toMatchObject({ stepExtensionSecs: 300, stepExtensionCount: 1 });
        });

        it('stops without completing anything', () => {
            render(<FocusedCountdownPage />);
            fireEvent.click(within(panel()).getByRole('button', { name: 'Stop' }));

            const transaction = lastTransaction();
            expect(transaction).toHaveLength(1);
            expect(runUpdate(transaction).payload).toMatchObject({ status: 'stopped', stoppedReason: 'user' });
        });

        it('celebrates until the next step’s timer starts', () => {
            mocks.data = makeData({ countdownRuns: [makeRun({ currentChoreId: 'Homework', stepStartedAt: at('10:00:20') })] });
            render(<FocusedCountdownPage />);

            expect(panel()).toHaveAttribute('data-mode', 'celebrating');
            expect(within(panel()).getByRole('button', { name: 'Nice work!' })).toBeDisabled();
            expect(within(panel()).queryByRole('timer')).not.toBeInTheDocument();
        });

        it('shows an untimed step without a ring', () => {
            mocks.data = makeData({
                chores: [makeChore('Vitamins', 'kid-a', { estimatedDurationSecs: null })],
                countdownRuns: [makeRun({ currentChoreId: 'Vitamins' })],
            });
            render(<FocusedCountdownPage />);

            expect(panel()).toHaveAttribute('data-mode', 'untimed');
            expect(within(panel()).getByText('No timer')).toBeInTheDocument();
            expect(within(panel()).queryByRole('timer')).not.toBeInTheDocument();
            expect(within(panel()).queryByRole('button', { name: /Add 5m/ })).not.toBeInTheDocument();
            expect(within(panel()).getByRole('button', { name: 'Done' })).toBeInTheDocument();
        });

        it('records a tap as presence at most once a minute', () => {
            render(<FocusedCountdownPage />);
            fireEvent.click(document.body);
            expect(mocks.transact).not.toHaveBeenCalled(); // Touched 30 seconds ago.

            mocks.data = makeData({ countdownRuns: [makeRun({ lastInteractionAt: at('09:58') })] });
            render(<FocusedCountdownPage />);
            fireEvent.click(document.body);
            expect(runUpdate().payload).toEqual({ lastInteractionAt: at('10:00') });

            // A second tap straight away adds nothing.
            fireEvent.click(document.body);
            expect(mocks.transact).toHaveBeenCalledTimes(1);
        });

        it('does not record the tap that pressed a button as a second write', () => {
            mocks.data = makeData({ countdownRuns: [makeRun({ lastInteractionAt: at('09:58') })] });
            render(<FocusedCountdownPage />);
            fireEvent.click(within(panel()).getByRole('button', { name: 'Add 5m to this step' }));

            expect(mocks.transact).toHaveBeenCalledTimes(1);
            expect(runUpdate().payload).toMatchObject({ stepExtensionSecs: 300 });
        });
    });

    describe('overrun and abandonment', () => {
        // Ten minutes, started at 09:40: over at 09:50, prompt due at 09:55, auto-stop at 10:05.
        const overrunRun = (overrides: Record<string, unknown> = {}) =>
            makeRun({ stepStartedAt: at('09:40'), lastInteractionAt: at('09:40'), startedAt: at('09:40'), ...overrides });

        it('counts up and waits without prompting someone who is present', () => {
            mocks.data = makeData({ countdownRuns: [overrunRun({ lastInteractionAt: at('09:58') })] });
            render(<FocusedCountdownPage />);

            expect(panel()).toHaveAttribute('data-mode', 'overrun');
            expect(within(panel()).getByRole('timer')).toHaveAccessibleName('+10:00');
            expect(within(panel()).getByText('Over time')).toBeInTheDocument();
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
            expect(mocks.transact).not.toHaveBeenCalled();
        });

        it('asks whether you are still working, and grants five minutes from now', () => {
            mocks.data = makeData({ countdownRuns: [overrunRun()] });
            render(<FocusedCountdownPage />);

            const prompt = screen.getByRole('alertdialog');
            expect(within(prompt).getByText('Still working on Dishes?')).toBeInTheDocument();
            expect(within(prompt).getByText('This run stops by itself in 5m.')).toBeInTheDocument();

            fireEvent.click(within(prompt).getByRole('button', { name: 'Yes, 5m more' }));
            // Ten minutes over already, plus the five just granted.
            expect(runUpdate().payload).toMatchObject({ stepExtensionSecs: 900, stepExtensionCount: 1, lastInteractionAt: at('10:00') });
        });

        it('offers to stop the run after repeated extensions', () => {
            mocks.data = makeData({ countdownRuns: [overrunRun({ stepExtensionCount: 2 })] });
            render(<FocusedCountdownPage />);

            const prompt = screen.getByRole('alertdialog');
            expect(within(prompt).getByText('Still working on this, or should I stop the run?')).toBeInTheDocument();
            fireEvent.click(within(prompt).getByRole('button', { name: 'Stop the run' }));
            expect(runUpdate().payload).toMatchObject({ status: 'stopped', stoppedReason: 'user' });
        });

        it('stops the run by itself when the prompt goes unanswered', () => {
            freezeTime(new Date(`${DATE_KEY}T10:05:00`));
            mocks.data = makeData({ countdownRuns: [overrunRun()] });
            render(<FocusedCountdownPage />);

            expect(mocks.transact).toHaveBeenCalledTimes(1);
            const transaction = lastTransaction();
            expect(transaction).toHaveLength(1); // No completion is invented.
            expect(runUpdate(transaction).payload).toMatchObject({ status: 'stopped', stoppedReason: 'timeout' });
        });

        it('says why the last run ended', () => {
            mocks.data = makeData({ countdownRuns: [makeRun({ status: 'stopped', stoppedReason: 'timeout' })] });
            render(<FocusedCountdownPage />);
            expect(within(panel()).getByText('The last run stopped by itself because nobody answered.')).toBeInTheDocument();
        });
    });

    describe('keeping the run honest', () => {
        it('advances when the live step was finished somewhere else', () => {
            mocks.data = makeData({
                countdownRuns: [makeRun()],
                choreCompletions: [
                    {
                        id: 'completion-1',
                        completed: true,
                        dateDue: DATE_KEY,
                        dateCompleted: at('09:59'),
                        chore: { id: 'Dishes' },
                        completedBy: { id: 'kid-a' },
                    },
                ],
            });
            render(<FocusedCountdownPage />);

            const transaction = lastTransaction();
            expect(transaction).toHaveLength(1);
            expect(runUpdate(transaction).payload).toMatchObject({ currentChoreId: 'Homework', stepStartedAt: at('10:00') });
        });

        it('sweeps a run left running when its family day ended', () => {
            mocks.data = makeData({
                countdownRuns: [makeRun({ id: 'yesterday', date: '2026-03-30' })],
            });
            render(<FocusedCountdownPage />);

            expect(runUpdate()).toMatchObject({ id: 'yesterday', payload: { status: 'stopped', stoppedReason: 'day_boundary' } });
            // Yesterday's run is not today's: the panel is idle.
            expect(panel()).toHaveAttribute('data-mode', 'ready');
        });

        it('leaves a sibling’s stale run for a session that may write it', () => {
            mocks.data = makeData({
                countdownRuns: [makeRun({ id: 'yesterday', date: '2026-03-30', familyMemberId: 'kid-b' })],
            });
            render(<FocusedCountdownPage />);
            expect(mocks.transact).not.toHaveBeenCalled();
        });
    });

    describe('routines', () => {
        const routineRun = (overrides: Record<string, unknown> = {}) =>
            makeRun({ routineId: 'morning', currentChoreId: 'Teeth', stepStartedAt: at('09:59'), ...overrides });

        it('keeps folded steps out of the day queue and offers the routine instead', () => {
            mocks.data = makeRoutineData();
            render(<FocusedCountdownPage />);

            // The day's own queue is Dishes then Homework; Teeth and Vitamins belong to the routine.
            expect(within(panel()).getByRole('heading', { name: 'Dishes' })).toBeInTheDocument();
            const launcher = within(panel()).getByRole('button', { name: 'Start Morning Routine' });
            expect(launcher).toHaveTextContent('0/3');
        });

        it('starts a routine on its first step and records which routine it is', () => {
            mocks.data = makeRoutineData();
            render(<FocusedCountdownPage />);
            fireEvent.click(within(panel()).getByRole('button', { name: 'Start Morning Routine' }));

            expect(runUpdate().payload).toMatchObject({ status: 'running', routineId: 'morning', currentChoreId: 'Teeth' });
        });

        it('starts the day queue without a routine', () => {
            mocks.data = makeRoutineData();
            render(<FocusedCountdownPage />);
            fireEvent.click(within(panel()).getByRole('button', { name: 'Start' }));

            expect(runUpdate().payload).toMatchObject({ routineId: null, currentChoreId: 'Dishes' });
        });

        it('follows the routine’s order, not the day’s, once it is running', () => {
            mocks.data = makeRoutineData({ countdownRuns: [routineRun()] });
            render(<FocusedCountdownPage />);

            expect(within(panel()).getByText('Morning Routine')).toBeInTheDocument();
            expect(within(panel()).getByRole('timer')).toHaveAccessibleName('1:00');
            expect(within(panel()).getByRole('img', { name: '0 of 3 done' })).toBeInTheDocument();

            fireEvent.click(within(panel()).getByRole('button', { name: 'Done' }));
            expect(runUpdate().payload).toMatchObject({ currentChoreId: 'Vitamins' });
        });

        it('waits at zero by default', () => {
            mocks.data = makeRoutineData({ countdownRuns: [routineRun({ stepStartedAt: at('09:55') })] });
            render(<FocusedCountdownPage />);

            expect(panel()).toHaveAttribute('data-mode', 'overrun');
            expect(mocks.transact).not.toHaveBeenCalled();
        });

        it('moves on at zero when the routine says so, leaving the step undone', () => {
            mocks.data = makeRoutineData({ countdownRuns: [routineRun({ stepStartedAt: at('09:55') })] }, 'advance');
            render(<FocusedCountdownPage />);

            const transaction = lastTransaction();
            expect(transaction).toHaveLength(1); // No completion is invented for the skipped step.
            expect(runUpdate(transaction).payload).toMatchObject({ currentChoreId: 'Vitamins', skippedChoreIds: ['Teeth'] });
        });

        it('finishes the routine after its last step, even with day chores left', () => {
            mocks.data = makeRoutineData({
                countdownRuns: [routineRun({ currentChoreId: 'Dishes' })],
                choreCompletions: ['Teeth', 'Vitamins'].map((choreId) => ({
                    id: `done-${choreId}`,
                    completed: true,
                    dateDue: DATE_KEY,
                    dateCompleted: at('09:50'),
                    chore: { id: choreId },
                    completedBy: { id: 'kid-a' },
                })),
            });
            render(<FocusedCountdownPage />);
            fireEvent.click(within(panel()).getByRole('button', { name: 'Done' }));

            expect(runUpdate().payload).toMatchObject({ status: 'stopped', stoppedReason: 'finished' });
        });

        it('invites a routine when everything on the plate is folded into one', () => {
            const data = makeRoutineData();
            data.chores = (data.chores as any[]).filter((chore) => chore.hideFromDayList);
            mocks.data = data;
            render(<FocusedCountdownPage />);

            expect(within(panel()).getByRole('heading', { name: 'Pick a routine to start' })).toBeInTheDocument();
            expect(within(panel()).queryByRole('button', { name: 'Start' })).not.toBeInTheDocument();
            expect(within(panel()).getByRole('button', { name: 'Start Morning Routine' })).toBeEnabled();
        });

        it('links parents, and only parents, to the routine manager', () => {
            mocks.data = makeRoutineData();
            const { unmount } = render(<FocusedCountdownPage />);
            expect(screen.queryByRole('link', { name: 'Routines' })).not.toBeInTheDocument();
            unmount();

            mocks.isParentMode = true;
            render(<FocusedCountdownPage />);
            expect(screen.getByRole('link', { name: /Routines/ })).toHaveAttribute('href', '/routines');
        });
    });

    describe('several people at once', () => {
        it('starts on the signed-in member and adds others on request', () => {
            render(<FocusedCountdownPage />);
            expect(screen.queryByTestId('countdown-panel-kid-b')).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /Alex/ })).toHaveAttribute('aria-pressed', 'true');

            fireEvent.click(screen.getByRole('button', { name: /Blair/ }));

            expect(panel('kid-a')).toBeInTheDocument();
            expect(panel('kid-b')).toBeInTheDocument();
        });

        it('keeps someone on screen', () => {
            render(<FocusedCountdownPage />);
            fireEvent.click(screen.getByRole('button', { name: /Alex/ }));
            expect(panel('kid-a')).toBeInTheDocument();
        });

        it('shows a sibling’s run read-only to a kid', () => {
            mocks.data = makeData({
                countdownRuns: [
                    makeRun({
                        id: createCountdownRunId('kid-b', DATE_KEY),
                        familyMemberId: 'kid-b',
                        currentChoreId: 'Laundry',
                    }),
                ],
            });
            render(<FocusedCountdownPage />);
            fireEvent.click(screen.getByRole('button', { name: /Blair/ }));

            const blair = panel('kid-b');
            expect(blair).toHaveAttribute('data-mode', 'running');
            expect(within(blair).getByRole('timer')).toHaveAccessibleName('6:00');
            expect(within(blair).queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
            expect(within(blair).getByText('Only Blair or a parent can control this countdown.')).toBeInTheDocument();
        });

        it('lets a parent drive anyone’s run', () => {
            mocks.currentUser = { id: 'parent-1', name: 'Pat', role: 'parent' };
            mocks.isParentMode = true;
            render(<FocusedCountdownPage />);

            // Nobody signed in has chores, so the first person with some is shown.
            fireEvent.click(within(panel('kid-a')).getByRole('button', { name: 'Start' }));
            expect(runUpdate().payload).toMatchObject({ familyMemberId: 'kid-a', currentChoreId: 'Dishes' });
        });
    });
});
