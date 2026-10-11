// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RoutineDayRows from '@/components/routines/RoutineDayRows';
import type { RoutineDaySummary } from '@/lib/routine-summary';

vi.mock('next/link', () => ({
    __esModule: true,
    default: ({ href, children, ...props }: any) => (
        <a href={typeof href === 'string' ? href : '#'} {...props}>
            {children}
        </a>
    ),
}));

function makeRoutine(overrides: Partial<RoutineDaySummary> = {}): RoutineDaySummary {
    return {
        id: 'morning',
        name: 'Morning Routine',
        completed: 1,
        total: 3,
        xpEarned: 2,
        xpPossible: 7,
        hiddenCount: 2,
        members: [{ id: 'kid-a', name: 'Alex', completed: 1, total: 3 }],
        steps: [
            { choreId: 'teeth', title: 'Brush teeth', hidden: true, members: [{ id: 'kid-a', name: 'Alex', done: true }] },
            { choreId: 'vitamins', title: 'Take vitamins', hidden: true, members: [{ id: 'kid-a', name: 'Alex', done: false }] },
            { choreId: 'dishes', title: 'Dishes', hidden: false, members: [{ id: 'kid-a', name: 'Alex', done: false }] },
        ],
        ...overrides,
    };
}

describe('RoutineDayRows', () => {
    it('renders nothing when no routine has steps due', () => {
        const { container } = render(<RoutineDayRows routines={[]} canRun showMembers={false} />);
        expect(container).toBeEmptyDOMElement();
    });

    it('shows one collapsed row with the routine’s progress and its own XP', () => {
        render(<RoutineDayRows routines={[makeRoutine()]} canRun showMembers={false} />);
        const row = screen.getByTestId('routine-day-row');

        expect(within(row).getByText('Morning Routine')).toBeInTheDocument();
        expect(within(row).getByText('1/3')).toBeInTheDocument();
        expect(within(row).getByText('2/7 XP')).toBeInTheDocument();
        expect(within(row).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
        // Collapsed: the steps are not listed until it is opened.
        expect(within(row).queryByText('Brush teeth')).not.toBeInTheDocument();
    });

    it('opens to the steps and ticks one for a person', () => {
        const onToggleStep = vi.fn();
        render(<RoutineDayRows routines={[makeRoutine()]} canRun showMembers={false} onToggleStep={onToggleStep} />);
        fireEvent.click(screen.getByRole('button', { name: /Morning Routine/ }));

        expect(screen.getByRole('checkbox', { name: 'Brush teeth for Alex' })).toHaveAttribute('aria-checked', 'true');
        const vitamins = screen.getByRole('checkbox', { name: 'Take vitamins for Alex' });
        expect(vitamins).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(vitamins);
        expect(onToggleStep).toHaveBeenCalledWith('vitamins', 'kid-a');
    });

    it('is read-only when this session may not change the day in view', () => {
        render(<RoutineDayRows routines={[makeRoutine()]} canRun={false} showMembers={false} />);
        fireEvent.click(screen.getByRole('button', { name: /Morning Routine/ }));

        expect(screen.getByRole('checkbox', { name: 'Take vitamins for Alex' })).toBeDisabled();
        expect(screen.queryByRole('link', { name: 'Run Morning Routine' })).not.toBeInTheDocument();
    });

    it('links to the countdown only while there is something left to run today', () => {
        const { rerender } = render(<RoutineDayRows routines={[makeRoutine()]} canRun showMembers={false} />);
        expect(screen.getByRole('link', { name: 'Run Morning Routine' })).toHaveAttribute('href', '/countdown');

        rerender(<RoutineDayRows routines={[makeRoutine({ completed: 3 })]} canRun showMembers={false} />);
        expect(screen.queryByRole('link', { name: 'Run Morning Routine' })).not.toBeInTheDocument();
    });

    it('names each person when several are in view, and hides the XP pill when there is none', () => {
        const shared = makeRoutine({
            xpPossible: 0,
            steps: [
                {
                    choreId: 'teeth',
                    title: 'Brush teeth',
                    hidden: true,
                    members: [
                        { id: 'kid-a', name: 'Alex', done: true },
                        { id: 'kid-b', name: 'Blair', done: false },
                    ],
                },
            ],
        });
        render(<RoutineDayRows routines={[shared]} canRun showMembers onToggleStep={vi.fn()} />);
        fireEvent.click(screen.getByRole('button', { name: /Morning Routine/ }));

        expect(screen.queryByText(/XP$/)).not.toBeInTheDocument();
        expect(screen.getByRole('checkbox', { name: 'Brush teeth for Alex' })).toHaveTextContent('Alex');
        expect(screen.getByRole('checkbox', { name: 'Brush teeth for Blair' })).toHaveTextContent('Blair');
    });
});
