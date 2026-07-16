// @vitest-environment jsdom

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const editorMocks = vi.hoisted(() => {
    const queryState = {
        isLoading: false,
        data: null as any,
    };

    const chainObj: any = {
        focus: vi.fn(() => chainObj),
        deleteRange: vi.fn(() => chainObj),
        run: vi.fn(() => true),
        insertContentAt: vi.fn(() => chainObj),
        setTextSelection: vi.fn(() => chainObj),
        createParagraphNear: vi.fn(() => chainObj),
        splitBlock: vi.fn(() => chainObj),
        updateAttributes: vi.fn(() => chainObj),
        command: vi.fn((_fn?: any) => chainObj),
    };

    const editor = {
        isDestroyed: false,
        commands: {
            setContent: vi.fn(),
            blur: vi.fn(),
            setTextSelection: vi.fn(),
            createParagraphNear: vi.fn(),
            splitBlock: vi.fn(),
            updateAttributes: vi.fn(),
        },
        chain: vi.fn(() => chainObj),
        getJSON: vi.fn(() => ({
            type: 'doc',
            content: [
                {
                    type: 'taskItem',
                    attrs: { id: 'task-1', indentationLevel: 0, isDayBreak: false },
                    content: [{ type: 'text', text: 'Existing task' }],
                },
            ],
        })),
        state: {
            selection: {
                $from: {
                    after: () => 1,
                    end: () => 1,
                    parentOffset: 0,
                    pos: 1,
                    node: () => ({ textContent: '', attrs: { indentationLevel: 0 } }),
                },
            },
            doc: {
                content: { size: 0 },
                resolve: () => ({ index: () => 0, parent: { childCount: 0, child: () => null } }),
                descendants: (_cb: any) => {},
                nodeAt: () => null,
            },
        },
    } as any;

    const dbUseQuery = vi.fn((_query?: any) => ({ isLoading: queryState.isLoading, data: queryState.data }));
    const dbTransact = vi.fn().mockResolvedValue(undefined);

    const debounceState = {
        latestFn: null as any,
        lastArgs: null as any[] | null,
        wrapped: null as any,
    };

    return {
        queryState,
        editor,
        chainObj,
        dbUseQuery,
        dbTransact,
        useEditorOptions: null as any,
        monitorCleanup: vi.fn(),
        monitorForElements: vi.fn(),
        nextIdValues: [] as string[],
        debounceState,
        toast: vi.fn(),
    };
});

vi.mock('@/components/ui/use-toast', () => ({
    useToast: () => ({ toast: editorMocks.toast }),
}));

vi.mock('@/components/AuthProvider', () => ({
    useAuth: () => ({
        currentUser: { id: 'parent-1', name: 'Parent User' },
    }),
}));

vi.mock('@/lib/db', () => ({
    db: {
        useQuery: editorMocks.dbUseQuery,
        transact: editorMocks.dbTransact,
    },
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
    return { Button, buttonVariants: vi.fn(() => '') };
});

vi.mock('@/components/ui/input', async () => {
    const React = await import('react');
    const Input = React.forwardRef<HTMLInputElement, any>(function MockInput(props, ref) {
        return <input ref={ref} {...props} />;
    });
    return { Input };
});

vi.mock('lucide-react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('lucide-react')>();
    return {
        ...actual,
        Loader2: (props: any) => <span data-testid="loader" {...props} />,
    };
});

vi.mock('@tiptap/starter-kit', () => ({
    default: {
        configure: vi.fn(() => ({ name: 'starter-kit' })),
    },
}));

vi.mock('@/components/task-series/TaskItem', async () => {
    const React = await import('react');
    return {
        __esModule: true,
        default: { name: 'task-item-extension' },
        TaskDateContext: React.createContext<Record<string, any>>({}),
    };
});

vi.mock('@/components/task-series/TaskDetailsPopover', () => ({
    TaskDetailsPopover: () => null,
}));

vi.mock('@/components/task-series/SlashCommand', () => ({
    SlashCommand: {
        configure: vi.fn(() => ({ name: 'slash-command-extension' })),
    },
    slashCommandSuggestion: { items: vi.fn(), render: vi.fn() },
}));

vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
    monitorForElements: (...args: any[]) => editorMocks.monitorForElements(...args),
}));

vi.mock('use-debounce', () => ({
    useDebouncedCallback: (fn: any) => {
        editorMocks.debounceState.latestFn = fn;
        if (!editorMocks.debounceState.wrapped) {
            const wrapped: any = (...args: any[]) => {
                editorMocks.debounceState.lastArgs = args;
            };
            wrapped.flush = vi.fn(async () => {
                if (editorMocks.debounceState.lastArgs) {
                    return await editorMocks.debounceState.latestFn?.(...editorMocks.debounceState.lastArgs);
                }
            });
            editorMocks.debounceState.wrapped = wrapped;
        }
        return editorMocks.debounceState.wrapped;
    },
}));

vi.mock('@tiptap/react', () => ({
    useEditor: (options: any) => {
        editorMocks.useEditorOptions = options;
        return editorMocks.editor;
    },
    EditorContent: ({ editor }: any) => <div data-testid="editor-content">{editor ? 'editor-ready' : 'editor-missing'}</div>,
    Extension: {
        create: vi.fn((config: any) => config),
    },
}));

const instantMocks = vi.hoisted(() => ({
    tx: new Proxy(
        {},
        {
            get(_root, entity: string) {
                return new Proxy(
                    {},
                    {
                        get(_entityObj, entityId: string) {
                            return {
                                create(payload: unknown) {
                                    return { op: 'create', entity, id: entityId, payload };
                                },
                                update(payload: unknown) {
                                    return { op: 'update', entity, id: entityId, payload };
                                },
                                link(payload: unknown) {
                                    return { op: 'link', entity, id: entityId, payload };
                                },
                                unlink(payload: unknown) {
                                    return { op: 'unlink', entity, id: entityId, payload };
                                },
                                delete() {
                                    return { op: 'delete', entity, id: entityId };
                                },
                            };
                        },
                    }
                );
            },
        }
    ),
    id: vi.fn(() => editorMocks.nextIdValues.shift() ?? 'generated-id'),
}));

vi.mock('@instantdb/react', () => ({
    tx: instantMocks.tx,
    id: instantMocks.id,
    init: vi.fn(() => ({ useQuery: vi.fn(), transact: vi.fn() })),
}));

import TaskSeriesEditor, { areTaskSeriesCardPropsEqual } from '@/components/task-series/TaskSeriesEditor';

function makeDb() {
    return {
        useQuery: editorMocks.dbUseQuery,
        transact: editorMocks.dbTransact,
    };
}

function seedExistingSeries(overrides: any = {}) {
    const series = {
        id: 'series-1',
        name: 'Morning Routine',
        description: 'Daily prep list',
        startDate: '2026-04-01T00:00:00.000Z',
        targetEndDate: '2026-04-15T00:00:00.000Z',
        familyMember: null as any,
        scheduledActivity: null as any,
        tasks: [
            {
                id: 'task-1',
                text: 'Existing task',
                order: 0,
                indentationLevel: 0,
                isDayBreak: false,
                parentTask: [],
            },
        ],
        ...overrides,
    };

    editorMocks.queryState.data = {
        taskSeries: [series],
        familyMembers: [
            { id: 'fm-1', name: 'Alex' },
            { id: 'fm-2', name: 'Blair' },
        ],
        chores: [
            { id: 'chore-1', title: 'Morning Chore' },
            { id: 'chore-2', title: 'Evening Chore' },
        ],
    };

    return series;
}

function seedNewSeries() {
    editorMocks.queryState.data = {
        taskSeries: [],
        familyMembers: [
            { id: 'fm-1', name: 'Alex' },
            { id: 'fm-2', name: 'Blair' },
        ],
        chores: [
            { id: 'chore-1', title: 'Morning Chore' },
            { id: 'chore-2', title: 'Evening Chore' },
        ],
    };
}

async function flushDebouncedSave() {
    await act(async () => {
        await editorMocks.debounceState.wrapped?.flush?.();
    });
}

describe('TaskSeriesEditor', () => {
    beforeEach(() => {
        editorMocks.queryState.isLoading = false;
        seedExistingSeries();

        editorMocks.dbUseQuery.mockClear();
        editorMocks.dbTransact.mockClear();
        editorMocks.toast.mockClear();
        editorMocks.editor.commands.setContent.mockClear();
        editorMocks.editor.commands.blur.mockClear();
        editorMocks.editor.chain.mockClear();
        editorMocks.editor.getJSON.mockClear();
        editorMocks.chainObj.focus.mockClear();
        editorMocks.chainObj.deleteRange.mockClear();
        editorMocks.chainObj.run.mockClear();
        editorMocks.chainObj.insertContentAt.mockClear();
        editorMocks.chainObj.setTextSelection.mockClear();
        editorMocks.chainObj.command.mockClear();
        editorMocks.monitorCleanup.mockClear();
        editorMocks.monitorForElements.mockReset();
        editorMocks.monitorForElements.mockImplementation(() => editorMocks.monitorCleanup);
        editorMocks.nextIdValues = [];
        instantMocks.id.mockClear();
        editorMocks.editor.getJSON.mockImplementation(() => ({
            type: 'doc',
            content: [
                {
                    type: 'taskItem',
                    attrs: { id: 'task-1', indentationLevel: 0, isDayBreak: false },
                    content: [{ type: 'text', text: 'Existing task' }],
                },
            ],
        }));

        editorMocks.debounceState.latestFn = null;
        editorMocks.debounceState.lastArgs = null;
        if (editorMocks.debounceState.wrapped?.flush) {
            editorMocks.debounceState.wrapped.flush.mockClear();
        }
    });

    it('hydrates existing series metadata into header fields and renders close action', async () => {
        const onClose = vi.fn();
        const user = userEvent.setup();

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" onClose={onClose} />);

        expect(screen.getByRole('heading', { name: /task series editor/i })).toBeInTheDocument();
        expect(screen.getByDisplayValue('Morning Routine')).toBeInTheDocument();
        expect(screen.getByDisplayValue('Daily prep list')).toBeInTheDocument();
        expect(screen.getByDisplayValue('2026-04-01')).toBeInTheDocument();
        expect(screen.getByDisplayValue('2026-04-15')).toBeInTheDocument();
        expect(screen.getByTestId('editor-content')).toHaveTextContent('editor-ready');

        const comboboxes = screen.getAllByRole('combobox');
        expect(comboboxes).toHaveLength(2);
        expect((comboboxes[0] as HTMLSelectElement).value).toBe('');
        expect((comboboxes[1] as HTMLSelectElement).value).toBe('');

        expect(editorMocks.editor.commands.setContent).toHaveBeenCalledWith({
            type: 'doc',
            content: [
                {
                    type: 'taskItem',
                    attrs: {
                        id: 'task-1',
                        indentationLevel: 0,
                        isDayBreak: false,
                    },
                    content: [{ type: 'text', text: 'Existing task' }],
                },
            ],
        });

        await user.click(screen.getByRole('button', { name: /close/i }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('saves updated metadata and links selected assignee + chore in the transaction payload', async () => {
        const user = userEvent.setup();

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        const nameInput = screen.getByPlaceholderText('7th Grade Math...');
        await user.clear(nameInput);
        await user.type(nameInput, 'Morning Routine Updated');

        const [assigneeSelect, choreSelect] = screen.getAllByRole('combobox');
        await user.selectOptions(assigneeSelect, 'fm-2');
        await user.selectOptions(choreSelect, 'chore-2');

        await flushDebouncedSave();

        await waitFor(() => {
            expect(editorMocks.dbTransact).toHaveBeenCalled();
        });

        const txs = editorMocks.dbTransact.mock.calls.at(-1)?.[0] as any[];
        expect(txs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    op: 'update',
                    entity: 'taskSeries',
                    id: 'series-1',
                    payload: expect.objectContaining({
                        name: 'Morning Routine Updated',
                        description: 'Daily prep list',
                        targetEndDate: expect.any(Date),
                    }),
                }),
                { op: 'link', entity: 'taskSeries', id: 'series-1', payload: { familyMember: 'fm-2' } },
                { op: 'link', entity: 'taskSeries', id: 'series-1', payload: { scheduledActivity: 'chore-2' } },
            ])
        );
        expect(txs).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ op: 'update', entity: 'tasks', id: 'task-1' }),
            ])
        );
    });

    it('emits unlink operations when clearing existing assignee/chore links and flushes pending saves on unmount', async () => {
        const user = userEvent.setup();
        seedExistingSeries({
            familyMember: [{ id: 'fm-1', name: 'Alex' }],
            scheduledActivity: { id: 'chore-1', title: 'Morning Chore' },
        });

        const { unmount } = render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        const [assigneeSelect, choreSelect] = screen.getAllByRole('combobox');
        await user.selectOptions(assigneeSelect, '');
        await user.selectOptions(choreSelect, '');

        unmount();

        expect(editorMocks.debounceState.wrapped.flush).toHaveBeenCalled();

        await waitFor(() => {
            expect(editorMocks.dbTransact).toHaveBeenCalled();
        });

        const txs = editorMocks.dbTransact.mock.calls.at(-1)?.[0] as any[];
        expect(txs).toEqual(
            expect.arrayContaining([
                { op: 'unlink', entity: 'taskSeries', id: 'series-1', payload: { familyMember: 'fm-1' } },
                { op: 'unlink', entity: 'taskSeries', id: 'series-1', payload: { scheduledActivity: 'chore-1' } },
            ])
        );
    });

    it('persists a brand-new series when only metadata links change', async () => {
        const user = userEvent.setup();
        editorMocks.nextIdValues = ['series-new', 'task-empty'];
        editorMocks.editor.getJSON.mockImplementation(() => ({
            type: 'doc',
            content: [{ type: 'taskItem', attrs: { id: 'task-empty', indentationLevel: 0, isDayBreak: false } }],
        }));
        seedNewSeries();

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId={null} />);

        const [assigneeSelect] = screen.getAllByRole('combobox');
        await user.selectOptions(assigneeSelect, 'fm-2');

        await flushDebouncedSave();

        await waitFor(() => {
            expect(editorMocks.dbTransact).toHaveBeenCalled();
        });

        const txs = editorMocks.dbTransact.mock.calls.at(-1)?.[0] as any[];
        expect(txs).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    op: 'update',
                    entity: 'taskSeries',
                    id: 'series-new',
                    payload: expect.objectContaining({
                        name: '',
                        description: '',
                        createdAt: expect.any(Date),
                    }),
                }),
                expect.objectContaining({
                    op: 'create',
                    entity: 'tasks',
                    id: 'task-empty',
                    payload: expect.objectContaining({
                        workflowState: 'not_started',
                        lastActiveState: 'not_started',
                        deferredUntilDate: null,
                        childTasksComplete: true,
                    }),
                }),
                { op: 'link', entity: 'taskSeries', id: 'series-new', payload: { tasks: 'task-empty' } },
                { op: 'link', entity: 'taskSeries', id: 'series-new', payload: { familyMember: 'fm-2' } },
            ])
        );
    });

    it('updates only structural fields for existing tasks and leaves live workflow state untouched', async () => {
        seedExistingSeries({
            tasks: [
                {
                    id: 'task-1',
                    text: 'Existing task',
                    order: 0,
                    indentationLevel: 0,
                    isDayBreak: false,
                    workflowState: 'done',
                    lastActiveState: 'in_progress',
                    deferredUntilDate: '2026-04-20',
                    childTasksComplete: true,
                    parentTask: [],
                },
            ],
        });

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);
        editorMocks.editor.getJSON.mockReturnValue({
            type: 'doc',
            content: [
                {
                    type: 'taskItem',
                    attrs: { id: 'task-1', indentationLevel: 0, isDayBreak: false },
                    content: [{ type: 'text', text: 'Renamed task' }],
                },
            ],
        });

        act(() => {
            editorMocks.useEditorOptions.onUpdate({ editor: editorMocks.editor });
        });
        await flushDebouncedSave();

        const txs = editorMocks.dbTransact.mock.calls.at(-1)?.[0] as any[];
        const taskUpdate = txs.find((transaction) => transaction.op === 'update' && transaction.entity === 'tasks' && transaction.id === 'task-1');
        expect(taskUpdate.payload).toEqual({
            text: 'Renamed task',
            order: 0,
            indentationLevel: 0,
            isDayBreak: false,
            updatedAt: expect.any(Date),
        });
        expect(taskUpdate.payload).not.toHaveProperty('workflowState');
        expect(taskUpdate.payload).not.toHaveProperty('lastActiveState');
        expect(taskUpdate.payload).not.toHaveProperty('deferredUntilDate');
        expect(taskUpdate.payload).not.toHaveProperty('childTasksComplete');
        expect(txs).not.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ op: 'update', entity: 'taskSeries', id: 'series-1' }),
            ])
        );
    });

    it('does not transact when an editor update contains no structural or metadata changes', async () => {
        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        act(() => {
            editorMocks.useEditorOptions.onUpdate({ editor: editorMocks.editor });
        });
        await flushDebouncedSave();

        expect(editorMocks.dbTransact).not.toHaveBeenCalled();
    });

    it('restores a data-bearing task that reaches autosave without delete confirmation', async () => {
        seedExistingSeries({
            tasks: [
                {
                    id: 'task-1',
                    text: 'Protected task',
                    order: 0,
                    indentationLevel: 1,
                    isDayBreak: false,
                    parentTask: [],
                    updates: [{ id: 'update-1', toState: 'in_progress', note: 'Work saved' }],
                },
            ],
        });

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);
        editorMocks.editor.getJSON.mockReturnValue({ type: 'doc', content: [] });

        act(() => {
            editorMocks.useEditorOptions.onUpdate({ editor: editorMocks.editor });
        });
        await flushDebouncedSave();

        expect(editorMocks.editor.commands.setContent).toHaveBeenLastCalledWith(
            {
                type: 'doc',
                content: [
                    {
                        type: 'taskItem',
                        attrs: { id: 'task-1', indentationLevel: 1, isDayBreak: false },
                        content: [{ type: 'text', text: 'Protected task' }],
                    },
                ],
            },
            { emitUpdate: false }
        );
        expect(editorMocks.toast).toHaveBeenCalledWith(
            expect.objectContaining({ title: 'Task restored' })
        );
        expect(editorMocks.dbTransact).not.toHaveBeenCalled();
    });

    it('flushes a pending save before invoking close', async () => {
        const onClose = vi.fn();
        const user = userEvent.setup();

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" onClose={onClose} />);

        const nameInput = screen.getByPlaceholderText('7th Grade Math...');
        await user.clear(nameInput);
        await user.type(nameInput, 'Morning Routine Updated');
        await user.click(screen.getByRole('button', { name: /close/i }));

        await waitFor(() => {
            expect(editorMocks.dbTransact).toHaveBeenCalled();
        });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(editorMocks.dbTransact.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
    });

    it('renders the synced card view controls alongside the bulk editor', () => {
        seedExistingSeries({
            tasks: [
                {
                    id: 'task-1',
                    text: 'Existing task',
                    order: 0,
                    indentationLevel: 0,
                    isDayBreak: false,
                    notes: 'Bring workbook and pencil',
                    attachments: [{ id: 'attachment-1', name: 'worksheet.pdf', url: 'worksheet.pdf', type: 'application/pdf' }],
                    updates: [{ id: 'entry-1', toState: 'done', createdAt: '2026-04-03T12:00:00.000Z', note: 'Finished early' }],
                    parentTask: [],
                },
            ],
        });

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        expect(screen.getByTestId('task-series-editor-root').className).toContain('max-w-none');
        expect(screen.getByTestId('task-series-editor-layout').className).toContain('min-[1600px]:grid-cols-[minmax(0,38rem)_minmax(0,1fr)]');
        expect(screen.getByRole('button', { name: /collapse bulk editor/i })).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('heading', { name: /task cards/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^add day break$/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /add day break below existing task/i })).toBeInTheDocument();
        expect(screen.getByText(/saved when you leave the field/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^history$/i })).toBeInTheDocument();
        expect(screen.getByRole('spinbutton', { name: /weight for existing task/i })).toHaveValue(0);
    });

    it('memoizes unchanged card props while allowing edited and expanded cards to render', () => {
        const callback = vi.fn();
        const persistedTask = { id: 'task-1', text: 'Existing task' };
        const baseProps = {
            db: makeDb(),
            seriesId: 'series-1',
            item: {
                id: 'task-1',
                text: 'Existing task',
                indentationLevel: 0,
                isDayBreak: false,
                order: 0,
                parentId: null,
                parentText: null,
                dateLabel: 'Projected Wed, 4/1',
                dateValue: new Date('2026-04-01T12:00:00'),
                persistedTask,
            },
            historyOpen: false,
            canMoveToPreviousDay: false,
            canMoveToNextDay: true,
            onToggleHistory: callback,
            onDeleteTask: callback,
            onAddTaskBelow: callback,
            onAddDayBreakBelow: callback,
            onTitleChange: callback,
            onMoveToAdjacentDay: callback,
        };

        expect(
            areTaskSeriesCardPropsEqual(baseProps, {
                ...baseProps,
                item: { ...baseProps.item, dateValue: new Date('2026-04-01T12:00:00') },
            })
        ).toBe(true);
        expect(
            areTaskSeriesCardPropsEqual(baseProps, {
                ...baseProps,
                item: { ...baseProps.item, text: 'Edited task' },
            })
        ).toBe(false);
        expect(areTaskSeriesCardPropsEqual(baseProps, { ...baseProps, historyOpen: true })).toBe(false);
    });

    it('loads linked task history only after its card panel opens', async () => {
        const user = userEvent.setup();
        seedExistingSeries({
            tasks: [
                {
                    id: 'task-1',
                    text: 'Existing task',
                    order: 0,
                    indentationLevel: 0,
                    isDayBreak: false,
                    updates: [{ id: 'update-1', note: 'Progress', createdAt: '2026-04-02T12:00:00.000Z' }],
                    parentTask: [],
                },
            ],
        });

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        const mainQuery = editorMocks.dbUseQuery.mock.calls[0]?.[0];
        expect(mainQuery.taskSeries.tasks.updates).toEqual({});
        expect(editorMocks.dbUseQuery.mock.calls.some(([query]) => Boolean(query.tasks?.updates))).toBe(false);

        await user.click(screen.getByRole('button', { name: /^history$/i }));

        const historyQuery = editorMocks.dbUseQuery.mock.calls.find(([query]) => Boolean(query.tasks?.updates))?.[0];
        expect(historyQuery).toEqual(
            expect.objectContaining({
                tasks: expect.objectContaining({
                    $: { where: { id: 'task-1' } },
                    updates: expect.objectContaining({
                        actor: {},
                        attachments: {},
                        responseFieldValues: { field: {} },
                        replies: expect.any(Object),
                    }),
                }),
            })
        );
    });

    it('persists task weight from the card metadata surface', async () => {
        const user = userEvent.setup();
        seedExistingSeries({
            tasks: [
                {
                    id: 'task-1',
                    text: 'Existing task',
                    order: 0,
                    indentationLevel: 0,
                    isDayBreak: false,
                    weight: 1,
                    parentTask: [],
                },
            ],
        });

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        const weightInput = screen.getByRole('spinbutton', { name: /weight for existing task/i });
        await user.clear(weightInput);
        await user.type(weightInput, '2.5');
        await user.tab();

        await waitFor(() => {
            expect(editorMocks.dbTransact).toHaveBeenCalledWith([
                expect.objectContaining({
                    op: 'update',
                    entity: 'tasks',
                    id: 'task-1',
                    payload: expect.objectContaining({ weight: 2.5, updatedAt: expect.any(Date) }),
                }),
                { op: 'link', entity: 'taskSeries', id: 'series-1', payload: { tasks: 'task-1' } },
            ]);
        });
    });

    it('confirms attachment removal with the styled dialog before deleting', async () => {
        const user = userEvent.setup();
        seedExistingSeries({
            tasks: [
                {
                    id: 'task-1',
                    text: 'Existing task',
                    order: 0,
                    indentationLevel: 0,
                    isDayBreak: false,
                    attachments: [{ id: 'attachment-1', name: 'worksheet.pdf', url: 'worksheet.pdf', type: 'application/pdf' }],
                    parentTask: [],
                },
            ],
        });

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        await user.click(screen.getByRole('button', { name: /remove worksheet\.pdf/i }));
        expect(screen.getByRole('alertdialog')).toHaveTextContent('worksheet.pdf will be removed from this task');

        await user.click(screen.getByRole('button', { name: /keep attachment/i }));
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(editorMocks.dbTransact).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: /remove worksheet\.pdf/i }));
        await user.click(screen.getByRole('button', { name: /^remove attachment$/i }));

        await waitFor(() => {
            expect(editorMocks.dbTransact).toHaveBeenCalledWith([
                { op: 'delete', entity: 'taskAttachments', id: 'attachment-1' },
            ]);
        });
        await waitFor(() => {
            expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        });
    });

    it('labels completed, planned, and live-projected dates from the shared scheduler', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));
        seedExistingSeries({
            scheduledActivity: { id: 'chore-1', title: 'Morning Chore' },
            tasks: [
                {
                    id: 'done',
                    text: 'Finished task',
                    order: 0,
                    indentationLevel: 0,
                    isDayBreak: false,
                    workflowState: 'done',
                    isCompleted: true,
                    completedOnDate: '2026-04-01',
                    parentTask: [],
                },
                { id: 'break-1', text: '', order: 1, indentationLevel: 0, isDayBreak: true, parentTask: [] },
                {
                    id: 'current',
                    text: 'Current task',
                    order: 2,
                    indentationLevel: 0,
                    isDayBreak: false,
                    workflowState: 'in_progress',
                    parentTask: [],
                },
                { id: 'break-2', text: '', order: 3, indentationLevel: 0, isDayBreak: true, parentTask: [] },
                {
                    id: 'next',
                    text: 'Next task',
                    order: 4,
                    indentationLevel: 0,
                    isDayBreak: false,
                    workflowState: 'not_started',
                    parentTask: [],
                },
            ],
        });
        editorMocks.queryState.data.chores = [
            { id: 'chore-1', title: 'Morning Chore', startDate: '2026-04-01', rrule: 'RRULE:FREQ=DAILY', exdates: [] },
        ];
        editorMocks.editor.getJSON.mockReturnValue({
            type: 'doc',
            content: [
                {
                    type: 'taskItem',
                    attrs: { id: 'done', indentationLevel: 0, isDayBreak: false },
                    content: [{ type: 'text', text: 'Finished task' }],
                },
                { type: 'taskItem', attrs: { id: 'break-1', indentationLevel: 0, isDayBreak: true } },
                {
                    type: 'taskItem',
                    attrs: { id: 'current', indentationLevel: 0, isDayBreak: false },
                    content: [{ type: 'text', text: 'Current task' }],
                },
                { type: 'taskItem', attrs: { id: 'break-2', indentationLevel: 0, isDayBreak: true } },
                {
                    type: 'taskItem',
                    attrs: { id: 'next', indentationLevel: 0, isDayBreak: false },
                    content: [{ type: 'text', text: 'Next task' }],
                },
            ],
        });

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByLabelText('Task title for Finished task').closest('article')).toHaveTextContent('Completed Wed, 4/1');
        expect(screen.getByLabelText('Task title for Current task').closest('article')).toHaveTextContent('Plan Thu, 4/2 · now Fri, 4/3');
        expect(screen.getByLabelText('Task title for Next task').closest('article')).toHaveTextContent('Plan Fri, 4/3 · now Sat, 4/4');
    });

    it('starts with the bulk editor expanded and lets stacked layouts collapse it', async () => {
        const user = userEvent.setup();

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        const toggle = screen.getByRole('button', { name: /collapse bulk editor/i });
        const bulkPanel = screen.getByTestId('task-series-bulk-editor-panel');

        expect(bulkPanel).toHaveAttribute('data-collapsed', 'false');

        await user.click(toggle);

        expect(screen.getByRole('button', { name: /expand bulk editor/i })).toHaveAttribute('aria-expanded', 'false');
        expect(bulkPanel).toHaveAttribute('data-collapsed', 'true');
        expect(screen.getByText(/bulk editor collapsed/i)).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: /task cards/i })).toBeInTheDocument();
    });

    it('adds a day break section from the card toolbar', async () => {
        const user = userEvent.setup();
        editorMocks.nextIdValues = ['break-1', 'task-after-break'];

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        await user.click(screen.getByRole('button', { name: /^add day break$/i }));

        expect(editorMocks.chainObj.insertContentAt).toHaveBeenCalledWith(
            0,
            [
                {
                    type: 'taskItem',
                    attrs: {
                        id: 'break-1',
                        indentationLevel: 0,
                        isDayBreak: true,
                    },
                },
                {
                    type: 'taskItem',
                    attrs: {
                        id: 'task-after-break',
                        indentationLevel: 0,
                        isDayBreak: false,
                    },
                },
            ]
        );
        expect(editorMocks.chainObj.setTextSelection).toHaveBeenCalledWith(3);
    });

    it('moves a task across a day break from the card controls', async () => {
        const user = userEvent.setup();
        const document = {
            type: 'doc',
            content: [
                {
                    type: 'taskItem',
                    attrs: { id: 'task-1', indentationLevel: 0, isDayBreak: false },
                    content: [{ type: 'text', text: 'Existing task' }],
                },
                { type: 'taskItem', attrs: { id: 'break-1', indentationLevel: 0, isDayBreak: true } },
                {
                    type: 'taskItem',
                    attrs: { id: 'task-2', indentationLevel: 0, isDayBreak: false },
                    content: [{ type: 'text', text: 'Second-day task' }],
                },
            ],
        };
        seedExistingSeries({
            tasks: [
                { id: 'task-1', text: 'Existing task', order: 0, indentationLevel: 0, isDayBreak: false, parentTask: [] },
                { id: 'break-1', text: '', order: 1, indentationLevel: 0, isDayBreak: true, parentTask: [] },
                { id: 'task-2', text: 'Second-day task', order: 2, indentationLevel: 0, isDayBreak: false, parentTask: [] },
            ],
        });
        editorMocks.editor.getJSON.mockReturnValue(document);

        render(<TaskSeriesEditor db={makeDb()} initialSeriesId="series-1" />);

        expect(screen.getByRole('button', { name: /move existing task to previous day/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /move existing task to next day/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /move second-day task to previous day/i })).toBeEnabled();
        expect(screen.getByRole('button', { name: /move second-day task to next day/i })).toBeDisabled();

        await user.click(screen.getByRole('button', { name: /move existing task to next day/i }));

        expect(editorMocks.editor.commands.setContent).toHaveBeenLastCalledWith(
            {
                type: 'doc',
                content: [document.content[1], document.content[0], document.content[2]],
            },
            { emitUpdate: false }
        );
    });
});
