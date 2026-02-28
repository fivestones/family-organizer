// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const choreUtilsMocks = vi.hoisted(() => ({
    getChoreAssignmentGridFromChore: vi.fn(),
    toUTCDate: vi.fn((value: any) => {
        const d = value instanceof Date ? new Date(value) : new Date(value);
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }),
    createRRuleWithStartDate: vi.fn(),
}));

vi.mock('@/lib/chore-utils', () => ({
    getChoreAssignmentGridFromChore: choreUtilsMocks.getChoreAssignmentGridFromChore,
    toUTCDate: choreUtilsMocks.toUTCDate,
    createRRuleWithStartDate: choreUtilsMocks.createRRuleWithStartDate,
}));

import ChoreCalendarView from '@/components/ChoreCalendarView';

describe('ChoreCalendarView', () => {
    beforeEach(() => {
        choreUtilsMocks.getChoreAssignmentGridFromChore.mockReset();
        choreUtilsMocks.toUTCDate.mockClear();
        choreUtilsMocks.getChoreAssignmentGridFromChore.mockResolvedValue({});
    });

    it('derives preview rows from rotation assignments when present', async () => {
        choreUtilsMocks.getChoreAssignmentGridFromChore.mockResolvedValue({});

        render(
            <ChoreCalendarView
                chore={{
                    id: 'chore-1',
                    title: 'Trash',
                    startDate: '2026-03-01T00:00:00.000Z',
                    assignments: [
                        { order: 0, familyMember: { id: 'm1', name: 'Ava' } },
                        { order: 1, familyMember: { id: 'm2', name: 'Ben' } },
                    ],
                }}
            />
        );

        expect(await screen.findByText('Ava')).toBeInTheDocument();
        expect(screen.getByText('Ben')).toBeInTheDocument();

        await waitFor(() => expect(choreUtilsMocks.getChoreAssignmentGridFromChore).toHaveBeenCalledTimes(1));
        const [choreArg, choreStartDateArg, endDateArg] = choreUtilsMocks.getChoreAssignmentGridFromChore.mock.calls[0];
        expect(choreArg.id).toBe('chore-1');
        expect(choreStartDateArg).toBeInstanceOf(Date);
        expect(endDateArg).toBeInstanceOf(Date);
    });

    it('falls back to assignees and renders completion dots from assignment grid', async () => {
        const todayKey = new Date().toISOString().split('T')[0];
        choreUtilsMocks.getChoreAssignmentGridFromChore.mockResolvedValue({
            [todayKey]: {
                m1: { assigned: true, completed: true },
                m2: { assigned: true, completed: false },
            },
        });

        const { container } = render(
            <ChoreCalendarView
                chore={{
                    id: 'chore-2',
                    title: 'Laundry',
                    startDate: new Date().toISOString(),
                    assignees: [
                        { id: 'm1', name: 'Ava' },
                        { id: 'm2', name: 'Ben' },
                    ],
                }}
            />
        );

        expect(await screen.findByText('Ava')).toBeInTheDocument();
        expect(screen.getByText('Ben')).toBeInTheDocument();

        await waitFor(() => {
            expect(container.querySelectorAll('span.bg-green-500')).toHaveLength(1);
            expect(container.querySelectorAll('span.bg-red-500')).toHaveLength(1);
        });
    });
});
