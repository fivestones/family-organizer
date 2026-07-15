// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const taskBinsMocks = vi.hoisted(() => {
    const baseTask = {
        id: 'task-1',
        text: 'Review task',
        order: 0,
        isDayBreak: false,
        workflowState: 'in_progress',
        updates: [
            {
                id: 'update-1',
                fromState: 'not_started',
                toState: 'in_progress',
                createdAt: 1,
                note: 'Started',
                actor: [{ id: 'parent-1', name: 'Parent' }],
                responseFieldValues: [],
            },
        ],
        taskSeries: [
            {
                id: 'series-1',
                name: 'Series One',
                familyMember: [{ id: 'kid-1', name: 'Kid One' }],
                scheduledActivity: [],
            },
        ],
    };
    const fullTask = {
        ...baseTask,
        responseFields: [{ id: 'field-1', type: 'rich_text', label: 'Answer', required: true, order: 0 }],
    };

    return {
        baseTask,
        fullTask,
        dbUseQuery: vi.fn((query: any) =>
            query.tasks?.$
                ? { data: { tasks: [fullTask] }, isLoading: false, error: null }
                : {
                      data: {
                          tasks: [baseTask],
                          familyMembers: [{ id: 'kid-1', name: 'Kid One' }],
                          taskSeries: [{ id: 'series-1', name: 'Series One' }],
                          gradeTypes: [],
                      },
                      isLoading: false,
                      error: null,
                  }
        ),
        dbTransact: vi.fn().mockResolvedValue(undefined),
        routerPush: vi.fn(),
    };
});

vi.mock('@/lib/db', () => ({
    db: {
        useQuery: (query: any) => taskBinsMocks.dbUseQuery(query),
        transact: (transactions: any) => taskBinsMocks.dbTransact(transactions),
    },
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: taskBinsMocks.routerPush }),
    useSearchParams: () => ({ get: (key: string) => (key === 'seriesId' ? 'series-1' : null) }),
}));

vi.mock('@/components/AuthProvider', () => ({
    useAuth: () => ({ currentUser: { id: 'parent-1', name: 'Parent', role: 'parent' } }),
}));

vi.mock('@/components/ui/use-toast', () => ({
    useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/components/ui/button', async () => {
    const React = await import('react');
    const Button = React.forwardRef<HTMLButtonElement, any>(function MockButton(
        { children, variant: _variant, size: _size, className, ...props },
        ref
    ) {
        return (
            <button ref={ref} type={props.type ?? 'button'} className={className} {...props}>
                {children}
            </button>
        );
    });
    return { Button };
});

vi.mock('@/components/ui/select', () => ({
    Select: ({ children }: any) => <div>{children}</div>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children }: any) => <div>{children}</div>,
    SelectTrigger: ({ children }: any) => <div>{children}</div>,
    SelectValue: () => <span />,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuItem: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/ui/popover', () => ({
    Popover: ({ children }: any) => <div>{children}</div>,
    PopoverContent: ({ children }: any) => <div>{children}</div>,
    PopoverTrigger: ({ children }: any) => <>{children}</>,
}));

vi.mock('@/components/ui/calendar', () => ({ Calendar: () => <div /> }));

vi.mock('@/components/task-updates/TaskUpdatePanel', () => ({
    TaskUpdatePanel: ({ task }: any) => <div data-testid="task-update-panel">{task.id}</div>,
}));

vi.mock('@/components/task-updates/UpdateHistory', () => ({
    UpdateHistory: ({ updates }: any) => <div data-testid="update-history">{updates.length}</div>,
}));

vi.mock('@/components/attachments/AttachmentThumbnail', () => ({
    AttachmentThumbnailRow: () => <div data-testid="attachment-row" />,
}));

vi.mock('@instantdb/react', () => ({
    id: vi.fn(() => 'generated-id'),
    tx: {},
}));

import { TaskBinsReview } from '@/components/task-series/TaskBinsReview';

describe('TaskBinsReview', () => {
    beforeEach(() => {
        taskBinsMocks.dbUseQuery.mockClear();
        taskBinsMocks.dbTransact.mockClear();
    });

    it('keeps the list query lean and fetches full task details only after expansion', async () => {
        const user = userEvent.setup();
        render(<TaskBinsReview />);

        const baseQuery = taskBinsMocks.dbUseQuery.mock.calls[0]?.[0];
        expect(baseQuery.tasks).not.toHaveProperty('responseFields');
        expect(baseQuery.tasks.updates).toEqual({
            actor: {},
            affectedPerson: {},
            responseFieldValues: {},
            gradeType: {},
            attachments: {},
        });
        expect(taskBinsMocks.dbUseQuery.mock.calls.some(([query]) => Boolean(query.tasks?.$))).toBe(false);

        await user.click(screen.getByRole('button', { name: /review task/i }));

        await waitFor(() => {
            expect(screen.getByTestId('task-update-panel')).toHaveTextContent('task-1');
        });
        const detailQuery = taskBinsMocks.dbUseQuery.mock.calls.find(([query]) => Boolean(query.tasks?.$))?.[0];
        expect(detailQuery.tasks).toEqual(
            expect.objectContaining({
                $: { where: { id: 'task-1' } },
                responseFields: {},
                updates: expect.objectContaining({
                    responseFieldValues: { field: {} },
                    replies: expect.any(Object),
                }),
            })
        );
    });
});
