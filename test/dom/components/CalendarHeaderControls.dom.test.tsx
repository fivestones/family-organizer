// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbUseQuery: vi.fn(),
}));

vi.mock('next/navigation', () => ({
    usePathname: () => '/calendar',
}));

vi.mock('@/lib/db', () => ({
    db: {
        useQuery: mocks.dbUseQuery,
    },
}));

vi.mock('@/components/ui/popover', () => ({
    Popover: ({ children }: any) => <div>{children}</div>,
    PopoverTrigger: ({ children }: any) => <>{children}</>,
    PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@/components/ui/checkbox', () => ({
    Checkbox: ({ id, checked, onCheckedChange }: any) => (
        <input
            id={id}
            type="checkbox"
            checked={Boolean(checked)}
            onChange={(event) => onCheckedChange?.(event.target.checked)}
        />
    ),
}));

import CalendarHeaderControls from '@/components/CalendarHeaderControls';

describe('CalendarHeaderControls member filter summary', () => {
    beforeEach(() => {
        mocks.dbUseQuery.mockReset();
        mocks.dbUseQuery.mockReturnValue({
            isLoading: false,
            error: null,
            data: {
                familyMembers: [
                    { id: 'member-alex', name: 'Alex' },
                    { id: 'member-sam', name: 'Sam' },
                ],
            },
        });
    });

    it('shows natural language summary for the key filter states', async () => {
        render(<CalendarHeaderControls />);

        await waitFor(() => {
            expect(screen.getByText('Show all events')).toBeInTheDocument();
        });

        fireEvent.click(screen.getByLabelText('Everyone'));
        expect(screen.getByText('Show events pertaining to Alex and Sam')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Sam'));
        expect(screen.getByText('Show events pertaining to Alex')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('Everyone'));
        fireEvent.click(screen.getByLabelText('Alex'));
        expect(screen.getByText("Show only events that don't pertain to any individual family members")).toBeInTheDocument();
    });
});
