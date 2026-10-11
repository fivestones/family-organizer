// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    data: null as any,
    transact: vi.fn(),
    toast: vi.fn(),
    nextId: 0,
}));

vi.mock('@/lib/db', () => ({
    db: {
        useQuery: () => ({ isLoading: false, error: null, data: mocks.data }),
        transact: (...args: any[]) => mocks.transact(...args),
    },
}));

vi.mock('@instantdb/react', () => {
    const chain = (entry: Record<string, unknown>) => ({ ...entry, link: (payload: unknown) => ({ ...entry, links: payload }) });
    const tx = new Proxy(
        {},
        {
            get(_root, entity: string) {
                return new Proxy(
                    {},
                    {
                        get(_entity, id: string) {
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
    return { tx, id: () => `new-${(mocks.nextId += 1)}` };
});

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

vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ open, children }: any) => (open ? <div role="dialog">{children}</div> : null),
    DialogContent: ({ children }: any) => <div>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <h2>{children}</h2>,
    DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
    AlertDialog: ({ open, children }: any) => (open ? <div role="alertdialog">{children}</div> : null),
    AlertDialogContent: ({ children }: any) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
    AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
    AlertDialogCancel: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
    AlertDialogAction: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));

import RoutineManager from '@/components/routines/RoutineManager';

function makeData(overrides: Record<string, unknown> = {}) {
    return {
        familyMembers: [
            { id: 'kid-a', name: 'Alex' },
            { id: 'kid-b', name: 'Blair' },
        ],
        chores: [
            { id: 'dishes', title: 'Dishes', startDate: '2026-03-01', sortOrder: 4, estimatedDurationSecs: 600, assignees: [{ id: 'kid-a' }], routineSteps: [] },
            { id: 'laundry', title: 'Laundry', startDate: '2026-03-01', sortOrder: 5, assignees: [{ id: 'kid-b' }], routineSteps: [] },
        ],
        routines: [],
        ...overrides,
    };
}

const EXISTING = {
    id: 'morning',
    name: 'Morning Routine',
    sortOrder: 0,
    onStepOverrun: 'advance',
    steps: [
        { id: 'step-a', position: 0, chore: { id: 'dishes' } },
        { id: 'step-b', position: 1, chore: { id: 'laundry' } },
    ],
};

function lastTransaction(): any[] {
    const calls = mocks.transact.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][0];
}

const only = (transaction: any[], op: string, entity: string) =>
    transaction.filter((entry) => entry.op === op && entry.entity === entity);

function typeStep(title: string, minutes = '') {
    fireEvent.change(screen.getByLabelText('New step name'), { target: { value: title } });
    if (minutes) fireEvent.change(screen.getByLabelText('New step minutes'), { target: { value: minutes } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

describe('RoutineManager', () => {
    beforeEach(() => {
        mocks.data = makeData();
        mocks.transact.mockReset().mockResolvedValue(undefined);
        mocks.toast.mockClear();
        mocks.nextId = 0;
    });

    it('invites a first routine when there are none', () => {
        render(<RoutineManager />);
        expect(screen.getByText('No routines yet')).toBeInTheDocument();
    });

    it('creates a routine from typed steps, with the chores created for it', async () => {
        render(<RoutineManager />);
        fireEvent.click(screen.getAllByRole('button', { name: 'New routine' })[0]);

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Morning Routine' } });
        typeStep('Brush teeth', '2');
        typeStep('Take vitamins');

        // Typed steps ask who and when; Alex is the default, and Blair is added.
        fireEvent.click(within(screen.getByRole('group', { name: 'Who the new steps are for' })).getByRole('button', { name: 'Blair' }));
        fireEvent.click(screen.getByRole('button', { name: 'Weekdays' }));
        fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));

        await waitFor(() => expect(mocks.transact).toHaveBeenCalledTimes(1));
        const transaction = lastTransaction();

        expect(only(transaction, 'update', 'routines')[0].payload).toMatchObject({ name: 'Morning Routine', onStepOverrun: 'wait', sortOrder: 0 });
        expect(only(transaction, 'update', 'chores').map((entry) => entry.payload)).toEqual([
            expect.objectContaining({
                title: 'Brush teeth',
                estimatedDurationSecs: 120,
                hideFromDayList: true,
                rrule: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
                sortOrder: 6,
            }),
            expect.objectContaining({ title: 'Take vitamins', estimatedDurationSecs: null, hideFromDayList: true, sortOrder: 7 }),
        ]);
        expect(only(transaction, 'link', 'familyMembers').map((entry) => entry.id)).toEqual(['kid-a', 'kid-b', 'kid-a', 'kid-b']);
        expect(only(transaction, 'update', 'routineSteps').map((entry) => entry.payload.position)).toEqual([0, 1]);
        expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Routine created' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('creates a routine by pointing at existing chores, leaving them in the day list', async () => {
        render(<RoutineManager />);
        fireEvent.click(screen.getAllByRole('button', { name: 'New routine' })[0]);
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'After School' } });

        fireEvent.click(screen.getByRole('button', { name: 'Add a chore you already have' }));
        fireEvent.change(screen.getByLabelText('Search chores'), { target: { value: 'laun' } });
        expect(screen.queryByRole('button', { name: /Dishes/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Laundry/ }));
        fireEvent.change(screen.getByLabelText('Search chores'), { target: { value: '' } });
        fireEvent.click(screen.getByRole('button', { name: /Dishes/ }));

        // Pointing at chores asks nothing about who or when.
        expect(screen.queryByRole('group', { name: 'Who the new steps are for' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));

        await waitFor(() => expect(mocks.transact).toHaveBeenCalledTimes(1));
        const transaction = lastTransaction();
        expect(only(transaction, 'update', 'chores')).toEqual([]);
        expect(only(transaction, 'update', 'routineSteps').map((entry) => entry.links)).toEqual([
            { routine: 'new-1', chore: 'laundry' },
            { routine: 'new-1', chore: 'dishes' },
        ]);
    });

    it('can fold an existing chore into the routine’s row', async () => {
        render(<RoutineManager />);
        fireEvent.click(screen.getAllByRole('button', { name: 'New routine' })[0]);
        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'After School' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add a chore you already have' }));
        fireEvent.click(screen.getByRole('button', { name: /Dishes/ }));

        const visibility = screen.getByRole('switch', { name: 'Show Dishes in the day list' });
        expect(visibility).toHaveAttribute('aria-checked', 'true');
        fireEvent.click(visibility);
        fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));

        await waitFor(() => expect(mocks.transact).toHaveBeenCalledTimes(1));
        expect(only(lastTransaction(), 'update', 'chores')).toEqual([
            expect.objectContaining({ id: 'dishes', payload: { hideFromDayList: true } }),
        ]);
    });

    it('says what is wrong instead of saving an incomplete routine', () => {
        render(<RoutineManager />);
        fireEvent.click(screen.getAllByRole('button', { name: 'New routine' })[0]);
        fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Give the routine a name.');

        fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Morning' } });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Create routine' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Add at least one step.');
        expect(mocks.transact).not.toHaveBeenCalled();
    });

    describe('with an existing routine', () => {
        beforeEach(() => {
            mocks.data = makeData({ routines: [EXISTING] });
        });

        it('lists it with its steps, people, length and overrun policy', () => {
            render(<RoutineManager />);
            const card = screen.getByTestId('routine-card');
            expect(within(card).getByRole('heading', { name: 'Morning Routine' })).toBeInTheDocument();
            expect(within(card).getByText('2 steps · 10 min · Alex, Blair')).toBeInTheDocument();
            expect(within(card).getByText('Moves on at zero')).toBeInTheDocument();
        });

        it('reorders steps and changes the overrun policy', async () => {
            render(<RoutineManager />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit Morning Routine' }));

            const steps = () => screen.getAllByTestId('routine-step').map((step) => step.textContent);
            expect(steps()[0]).toContain('Dishes');
            fireEvent.click(screen.getByRole('button', { name: 'Move Dishes down' }));
            expect(steps()[0]).toContain('Laundry');

            fireEvent.click(screen.getByRole('radio', { name: /Wait for Done/ }));
            fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));

            await waitFor(() => expect(mocks.transact).toHaveBeenCalledTimes(1));
            const transaction = lastTransaction();
            expect(only(transaction, 'update', 'routines')[0]).toMatchObject({ id: 'morning', payload: { onStepOverrun: 'wait' } });
            expect(only(transaction, 'update', 'routineSteps').map((entry) => [entry.id, entry.payload.position])).toEqual([
                ['step-b', 0],
                ['step-a', 1],
            ]);
        });

        it('removes a step without deleting its chore', async () => {
            render(<RoutineManager />);
            fireEvent.click(screen.getByRole('button', { name: 'Edit Morning Routine' }));
            fireEvent.click(screen.getByRole('button', { name: 'Remove Laundry' }));
            fireEvent.click(screen.getByRole('button', { name: 'Save routine' }));

            await waitFor(() => expect(mocks.transact).toHaveBeenCalledTimes(1));
            const transaction = lastTransaction();
            expect(only(transaction, 'delete', 'routineSteps')).toEqual([{ op: 'delete', entity: 'routineSteps', id: 'step-b' }]);
            expect(only(transaction, 'delete', 'chores')).toEqual([]);
        });

        it('deletes the routine after confirming, and keeps its chores', async () => {
            render(<RoutineManager />);
            fireEvent.click(screen.getByRole('button', { name: 'Delete Morning Routine' }));
            expect(screen.getByRole('alertdialog')).toHaveTextContent('its chores stay');
            fireEvent.click(screen.getByRole('button', { name: 'Delete routine' }));

            await waitFor(() => expect(mocks.transact).toHaveBeenCalledTimes(1));
            expect(lastTransaction()).toEqual([
                { op: 'delete', entity: 'routineSteps', id: 'step-a' },
                { op: 'delete', entity: 'routineSteps', id: 'step-b' },
                { op: 'delete', entity: 'routines', id: 'morning' },
            ]);
        });
    });
});
