// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const choreListMocks = vi.hoisted(() => ({
    toast: vi.fn(),
    getAssignedMembersForChoreOnDate: vi.fn((chore: any) => chore.assignees || []),
    createRRuleWithStartDate: vi.fn(),
    getTasksForDate: vi.fn(() => []),
    isSeriesActiveForDate: vi.fn(() => false),
    taskSeriesChecklist: vi.fn(),
}));

vi.mock('@/components/ui/use-toast', () => ({
    useToast: () => ({
        toast: choreListMocks.toast,
    }),
}));

vi.mock('@/components/ui/button', async () => {
    const React = await import('react');
    const Button = React.forwardRef<HTMLButtonElement, any>(function MockButton({ children, ...props }, ref) {
        return (
            <button ref={ref} type={props.type ?? 'button'} {...props}>
                {children}
            </button>
        );
    });
    return { Button };
});

vi.mock('@/components/ui/scroll-area', () => ({
    ScrollArea: ({ children, ...props }: any) => <div {...props}>{children}</div>,
}));

vi.mock('@/components/ui/dialog', async () => {
    const React = await import('react');
    const DialogCtx = React.createContext(false);

    return {
        Dialog: ({ open, children }: any) => <DialogCtx.Provider value={Boolean(open)}>{children}</DialogCtx.Provider>,
        DialogContent: ({ children, ...props }: any) => {
            const open = React.useContext(DialogCtx);
            return open ? <div {...props}>{children}</div> : null;
        },
        DialogHeader: ({ children }: any) => <div>{children}</div>,
        DialogTitle: ({ children }: any) => <h2>{children}</h2>,
        DialogDescription: ({ children }: any) => <p>{children}</p>,
        DialogFooter: ({ children }: any) => <div>{children}</div>,
    };
});

vi.mock('lucide-react', () => ({
    Trash2: () => <span>Trash2</span>,
}));

vi.mock('@/components/ui/ToggleableAvatar', () => ({
    __esModule: true,
    default: ({ name, onToggle, isComplete, isDisabled }: any) => (
        <button type="button" onClick={onToggle} disabled={Boolean(isDisabled)}>
            Avatar {name} {isComplete ? 'done' : 'todo'}
        </button>
    ),
}));

vi.mock('@/components/DetailedChoreForm', () => ({
    __esModule: true,
    default: ({ initialChore }: any) => <div data-testid="detailed-chore-form">Editing {initialChore?.title}</div>,
}));

vi.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, ...props }: any) => (
        <a href={typeof href === 'string' ? href : '#'} {...props}>
            {children}
        </a>
    ),
}));

vi.mock('@/components/TaskSeriesChecklist', () => ({
    TaskSeriesChecklist: (props: any) => {
        choreListMocks.taskSeriesChecklist(props);
        return <div data-testid="task-series-checklist" />;
    },
}));

vi.mock('@/lib/task-scheduler', () => ({
    getTasksForDate: choreListMocks.getTasksForDate,
    isSeriesActiveForDate: choreListMocks.isSeriesActiveForDate,
}));

vi.mock('@/lib/chore-utils', async () => {
    const actual = await vi.importActual<typeof import('@/lib/chore-utils')>('@/lib/chore-utils');
    return {
        ...actual,
        createRRuleWithStartDate: choreListMocks.createRRuleWithStartDate,
        getAssignedMembersForChoreOnDate: choreListMocks.getAssignedMembersForChoreOnDate,
    };
});

const instantMocks = vi.hoisted(() => ({
    tx: new Proxy(
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
                            };
                        },
                    }
                );
            },
        }
    ),
}));

vi.mock('@instantdb/react', () => ({
    tx: instantMocks.tx,
}));

import ChoreList, { TASK_SERIES_EXPANSION_STORAGE_KEY } from '@/components/ChoreList';

const familyMembers = [
    { id: 'kid-a', name: 'Alex' },
    { id: 'kid-b', name: 'Blair' },
];

function makeChore(overrides: any = {}) {
    return {
        id: overrides.id ?? 'chore-1',
        title: overrides.title ?? 'Test Chore',
        description: overrides.description ?? '',
        startDate: overrides.startDate ?? '2026-04-02',
        rrule: overrides.rrule ?? null,
        assignees: overrides.assignees ?? [{ id: 'kid-a', name: 'Alex' }],
        rotationType: overrides.rotationType ?? 'none',
        completions: overrides.completions ?? [],
        taskSeries: overrides.taskSeries ?? [],
        weight: overrides.weight ?? 1,
        ...overrides,
    };
}

function renderChoreList(overrides: any = {}) {
    const props = {
        chores: [makeChore()],
        familyMembers,
        selectedMember: 'All',
        selectedDate: new Date('2026-04-02T00:00:00Z'),
        toggleChoreDone: vi.fn(),
        updateChore: vi.fn(),
        deleteChore: vi.fn(),
        db: { transact: vi.fn() },
        unitDefinitions: [],
        currencyOptions: [],
        onEditTaskSeries: vi.fn(),
        currentUser: { id: 'parent-1', role: 'parent' },
        canEditChores: true,
        showChoreDescriptions: false,
        showTaskDetails: false,
        ...overrides,
    };

    return { ...render(<ChoreList {...props} />), props };
}

describe('ChoreList', () => {
    beforeEach(() => {
        window.localStorage.clear();
        choreListMocks.toast.mockReset();
        choreListMocks.getAssignedMembersForChoreOnDate.mockClear();
        choreListMocks.createRRuleWithStartDate.mockReset();
        choreListMocks.getTasksForDate.mockReset();
        choreListMocks.isSeriesActiveForDate.mockReset();
        choreListMocks.taskSeriesChecklist.mockReset();
        choreListMocks.getTasksForDate.mockReturnValue([]);
        choreListMocks.isSeriesActiveForDate.mockReturnValue(false);
    });

    it('restores and persists per-member task-series expansion choices', async () => {
        const user = userEvent.setup();
        const tasks = [
            { id: 'task-1', text: 'First', order: 1, isDayBreak: false, isCompleted: false },
            { id: 'task-2', text: 'Second', order: 2, isDayBreak: false, isCompleted: false },
            { id: 'task-3', text: 'Third', order: 3, isDayBreak: false, isCompleted: false },
        ];
        choreListMocks.getTasksForDate.mockReturnValue(tasks);
        window.localStorage.setItem(
            TASK_SERIES_EXPANSION_STORAGE_KEY,
            JSON.stringify({
                byMember: { 'kid-a': { 'chore-1:series-1': false } },
                allView: {},
            })
        );

        renderChoreList({
            pageMode: 'tasks',
            selectedMember: 'kid-a',
            chores: [
                makeChore({
                    id: 'chore-1',
                    taskSeries: [
                        {
                            id: 'series-1',
                            name: 'Three-part series',
                            familyMember: [{ id: 'kid-a', name: 'Alex' }],
                            tasks,
                        },
                    ],
                }),
            ],
        });

        await waitFor(() => {
            expect(screen.getByRole('button', { name: /view more/i })).toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: /view more/i }));
        expect(screen.getByRole('button', { name: /hide tasks/i })).toBeInTheDocument();
        expect(JSON.parse(window.localStorage.getItem(TASK_SERIES_EXPANSION_STORAGE_KEY) || '{}')).toEqual({
            byMember: { 'kid-a': { 'chore-1:series-1': true } },
            allView: {},
        });
    });

    it('filters chores by selected member and selected date', () => {
        renderChoreList({
            selectedMember: 'kid-a',
            showChoreDescriptions: false,
            chores: [
                makeChore({ id: 'a', title: 'Alex Today', description: 'Visible only when descriptions enabled', assignees: [{ id: 'kid-a', name: 'Alex' }] }),
                makeChore({ id: 'b', title: 'Blair Today', assignees: [{ id: 'kid-b', name: 'Blair' }] }),
                makeChore({ id: 'c', title: 'Alex Tomorrow', startDate: '2026-04-03', assignees: [{ id: 'kid-a', name: 'Alex' }] }),
            ],
        });

        expect(screen.getAllByText('Alex Today').length).toBeGreaterThan(0);
        expect(screen.queryByText('Blair Today')).not.toBeInTheDocument();
        expect(screen.queryByText('Alex Tomorrow')).not.toBeInTheDocument();
        expect(screen.queryByText('Visible only when descriptions enabled')).not.toBeInTheDocument();
    });

    it('allows parent backfill on a past task date while keeping child sessions read-only', async () => {
        const scheduledTask = { id: 'task-1', text: 'Past assignment', order: 1, isDayBreak: false, isCompleted: false };
        const pastChore = makeChore({
            startDate: '2026-04-02',
            taskSeries: [
                {
                    id: 'series-1',
                    name: 'Past series',
                    familyMember: [{ id: 'kid-a', name: 'Alex' }],
                    tasks: [scheduledTask],
                },
            ],
        });
        choreListMocks.getTasksForDate.mockReturnValue([scheduledTask]);

        const parentRender = renderChoreList({
            pageMode: 'tasks',
            selectedMember: 'kid-a',
            chores: [pastChore],
            canEditChores: true,
            currentUser: { id: 'parent-1', role: 'parent' },
        });

        await waitFor(() => expect(choreListMocks.taskSeriesChecklist).toHaveBeenCalled());
        expect(choreListMocks.taskSeriesChecklist).toHaveBeenLastCalledWith(
            expect.objectContaining({ isReadOnly: false, isBackfillMode: true })
        );

        parentRender.unmount();
        choreListMocks.taskSeriesChecklist.mockReset();

        renderChoreList({
            pageMode: 'tasks',
            selectedMember: 'kid-a',
            chores: [pastChore],
            canEditChores: false,
            currentUser: { id: 'kid-a', role: 'child' },
        });

        await waitFor(() => expect(choreListMocks.taskSeriesChecklist).toHaveBeenCalled());
        expect(choreListMocks.taskSeriesChecklist).toHaveBeenLastCalledWith(
            expect.objectContaining({ isReadOnly: true, isBackfillMode: false })
        );
    });

    it('shows chore descriptions only when the global description setting is enabled', () => {
        renderChoreList({
            selectedMember: 'kid-a',
            showChoreDescriptions: true,
            chores: [makeChore({ id: 'a', title: 'Alex Today', description: 'Visible description', assignees: [{ id: 'kid-a', name: 'Alex' }] })],
        });

        expect(screen.getAllByText('Visible description').length).toBeGreaterThan(0);
    });

    it('hides routine marker controls for non-parent viewers', () => {
        renderChoreList({
            canEditChores: false,
            currentUser: { id: 'kid-a', role: 'child' },
            scheduleSettings: {
                dayBoundaryTime: '03:00',
                timeBuckets: [],
                routineMarkers: [{ key: 'breakfast', label: 'Breakfast', defaultTime: '08:00' }],
            },
        });

        expect(screen.queryByText(/routine markers/i)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /start/i })).not.toBeInTheDocument();
    });

    it('opens the detail modal from the chore title and blocks edit/delete actions for non-parent users', async () => {
        const user = userEvent.setup();
        const { props } = renderChoreList({
            canEditChores: false,
            currentUser: { id: 'kid-a', role: 'child' },
        });

        await user.click(screen.getAllByRole('button', { name: /test chore/i })[0]);
        expect(screen.getByRole('heading', { name: /test chore/i })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /edit chore/i }));
        await user.click(screen.getAllByRole('button', { name: /trash2/i })[0]);

        expect(choreListMocks.toast).toHaveBeenCalledTimes(2);
        expect(choreListMocks.toast).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                title: 'Access Denied',
                description: expect.stringMatching(/only parents can edit chores/i),
                variant: 'destructive',
            })
        );
        expect(choreListMocks.toast).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                title: 'Access Denied',
                description: expect.stringMatching(/only parents can delete chores/i),
                variant: 'destructive',
            })
        );
        expect(props.updateChore).not.toHaveBeenCalled();
        expect(props.deleteChore).not.toHaveBeenCalled();
        expect(screen.queryByRole('heading', { name: /edit chore/i })).not.toBeInTheDocument();
    });

    it('opens detail metadata, then edit and delete flows for parents', async () => {
        const user = userEvent.setup();
        const { props } = renderChoreList({
            chores: [makeChore({ id: 'chore-parent', title: 'Parent Editable Chore' })],
            canEditChores: true,
        });

        await user.click(screen.getAllByRole('button', { name: /parent editable chore/i })[0]);
        expect(screen.getByRole('heading', { name: /parent editable chore/i })).toBeInTheDocument();
        expect(screen.getByText(/selected date/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /schedule/i })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /edit chore/i }));
        expect(screen.getByRole('heading', { name: /edit chore/i })).toBeInTheDocument();
        expect(screen.getByTestId('detailed-chore-form')).toHaveTextContent('Editing Parent Editable Chore');

        await user.click(screen.getAllByRole('button', { name: /trash2/i })[0]);
        expect(screen.getByRole('heading', { name: /delete chore/i })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: /^delete$/i }));
        expect(props.deleteChore).toHaveBeenCalledWith('chore-parent');
    });

    it('shows a simplified task preview in chores mode and links into the tasks page', () => {
        choreListMocks.getTasksForDate.mockReturnValue([
            { id: 'task-1', text: 'Read chapter 1', order: 1, isDayBreak: false, isCompleted: false },
            { id: 'task-2', text: 'Answer questions', order: 2, isDayBreak: false, isCompleted: false, notes: 'Should stay hidden in preview' },
            { id: 'task-3', text: 'Write summary', order: 3, isDayBreak: false, isCompleted: false },
        ]);

        renderChoreList({
            pageMode: 'chores',
            chores: [
                makeChore({
                    id: 'chore-1',
                    title: 'Language Arts',
                    taskSeries: [
                        {
                            id: 'series-1',
                            name: 'ELA',
                            tasks: [
                                { id: 'task-1', text: 'Read chapter 1', order: 1, isDayBreak: false, isCompleted: false },
                                { id: 'task-2', text: 'Answer questions', order: 2, isDayBreak: false, isCompleted: false, notes: 'Should stay hidden in preview' },
                                { id: 'task-3', text: 'Write summary', order: 3, isDayBreak: false, isCompleted: false },
                            ],
                        },
                    ],
                }),
            ],
        });

        expect(screen.getByText('Read chapter 1')).toBeInTheDocument();
        expect(screen.getByText('Answer questions')).toBeInTheDocument();
        expect(screen.queryByText('Write summary')).not.toBeInTheDocument();
        expect(screen.queryByText(/should stay hidden in preview/i)).not.toBeInTheDocument();

        const openTasksLink = screen.getByRole('link', { name: /open tasks/i });
        expect(openTasksLink).toHaveAttribute('href', '/tasks?date=2026-04-02&member=All&choreId=chore-1#chore-chore-1');
        expect(screen.getByRole('link', { name: /1\+ more/i })).toHaveAttribute(
            'href',
            '/tasks?date=2026-04-02&member=All&choreId=chore-1#chore-chore-1'
        );
    });

    it('renders an owned pulled-forward series today when the chore is off schedule', () => {
        choreListMocks.getTasksForDate.mockReturnValue([
            { id: 'task-2', text: 'Work ahead', order: 2, isDayBreak: false, isCompleted: false },
        ]);
        choreListMocks.isSeriesActiveForDate.mockReturnValue(true);

        renderChoreList({
            pageMode: 'tasks',
            selectedDateKey: '2026-04-02',
            todayDateKey: '2026-04-02',
            chores: [
                makeChore({
                    title: 'Off-day curriculum',
                    rrule: 'FREQ=WEEKLY;BYDAY=MO,WE',
                    assignees: [],
                    taskSeries: [
                        {
                            id: 'series-pulled',
                            name: 'Pulled curriculum',
                            pullForwardCount: 1,
                            familyMember: [{ id: 'kid-a', name: 'Alex' }],
                            tasks: [{ id: 'task-2', text: 'Work ahead', order: 2, isDayBreak: false, isCompleted: false }],
                        },
                    ],
                }),
            ],
        });

        expect(screen.getAllByText('Off-day curriculum').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Pulled curriculum').length).toBeGreaterThan(0);
        expect(screen.getByText('Pulled forward')).toBeInTheDocument();
        expect(screen.getByTestId('task-series-checklist')).toBeInTheDocument();
    });

    it('hides a task-series row when only historical done tasks remain', () => {
        choreListMocks.getTasksForDate.mockReturnValue([]);
        choreListMocks.isSeriesActiveForDate.mockReturnValue(false);

        renderChoreList({
            pageMode: 'tasks',
            chores: [
                makeChore({
                    title: 'Finished curriculum',
                    taskSeries: [
                        {
                            id: 'series-done',
                            name: 'Finished series',
                            familyMember: [{ id: 'kid-a', name: 'Alex' }],
                            tasks: [
                                {
                                    id: 'task-done',
                                    text: 'Already finished',
                                    order: 1,
                                    isDayBreak: false,
                                    isCompleted: true,
                                    workflowState: 'done',
                                    completedOnDate: '2026-04-01',
                                },
                            ],
                        },
                    ],
                }),
            ],
        });

        expect(screen.queryByText('Finished curriculum')).not.toBeInTheDocument();
        expect(screen.queryByTestId('task-series-checklist')).not.toBeInTheDocument();
    });
});
