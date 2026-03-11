// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CALENDAR_COMMAND_EVENT } from '@/lib/calendar-controls';

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
        window.localStorage.clear();
        mocks.dbUseQuery.mockReturnValue({
            isLoading: false,
            error: null,
            data: {
                familyMembers: [
                    { id: 'member-alex', name: 'Alex' },
                    { id: 'member-sam', name: 'Sam' },
                ],
                chores: [
                    { id: 'chore-trash', title: 'Take out trash' },
                    { id: 'chore-dishes', title: 'Wash dishes' },
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

    it('offers a default-off show chores toggle in calendar settings', async () => {
        const receivedCommands: any[] = [];
        const handleCommand = (event: Event) => {
            receivedCommands.push((event as CustomEvent).detail);
        };
        window.addEventListener(CALENDAR_COMMAND_EVENT, handleCommand);

        render(<CalendarHeaderControls />);

        const choresToggle = document.getElementById('calendar-show-chores-header') as HTMLInputElement | null;
        expect(choresToggle).not.toBeNull();
        expect(choresToggle).not.toBeChecked();

        fireEvent.click(choresToggle);

        await waitFor(() => {
            expect(receivedCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'setShowChores',
                        showChores: true,
                    }),
                ])
            );
        });

        window.removeEventListener(CALENDAR_COMMAND_EVENT, handleCommand);
    });

    it('shows a collapsible specific chores filter with select all and select none when chores are visible', async () => {
        const receivedCommands: any[] = [];
        const handleCommand = (event: Event) => {
            receivedCommands.push((event as CustomEvent).detail);
        };
        window.addEventListener(CALENDAR_COMMAND_EVENT, handleCommand);
        window.localStorage.setItem('calendar.showChores', 'true');

        render(<CalendarHeaderControls />);

        await waitFor(() => {
            expect(receivedCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'setChoreFilter',
                        selectedChoreIds: ['chore-trash', 'chore-dishes'],
                    }),
                ])
            );
        });

        receivedCommands.length = 0;

        fireEvent.click(screen.getByRole('button', { name: /specific chores/i }));

        const options = await screen.findByTestId('calendar-chore-filter-options');
        expect(within(options).getByText('Take out trash')).toBeInTheDocument();
        expect(within(options).getByText('Wash dishes')).toBeInTheDocument();

        fireEvent.click(within(options).getByRole('button', { name: 'Select none' }));
        await waitFor(() => {
            expect(receivedCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'setChoreFilter',
                        selectedChoreIds: [],
                    }),
                ])
            );
        });

        receivedCommands.length = 0;

        fireEvent.click(within(options).getByRole('button', { name: 'Select all' }));
        await waitFor(() => {
            expect(receivedCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'setChoreFilter',
                        selectedChoreIds: ['chore-trash', 'chore-dishes'],
                    }),
                ])
            );
        });

        window.removeEventListener(CALENDAR_COMMAND_EVENT, handleCommand);
    });

    it('offers full year view controls and dispatches year-specific settings', async () => {
        const receivedCommands: any[] = [];
        const handleCommand = (event: Event) => {
            receivedCommands.push((event as CustomEvent).detail);
        };
        window.addEventListener(CALENDAR_COMMAND_EVENT, handleCommand);

        render(<CalendarHeaderControls />);

        const viewSelect = screen.getByLabelText('View') as HTMLSelectElement;
        fireEvent.change(viewSelect, { target: { value: 'year' } });

        await waitFor(() => {
            expect(receivedCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'setViewMode',
                        viewMode: 'year',
                    }),
                ])
            );
        });

        const basisSelect = screen.getByLabelText('Year View Month Basis') as HTMLSelectElement;
        fireEvent.change(basisSelect, { target: { value: 'bs' } });

        await waitFor(() => {
            expect(receivedCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'setYearMonthBasis',
                        yearMonthBasis: 'bs',
                    }),
                ])
            );
        });

        const fontScaleSlider = screen.getByLabelText('Event Font Size') as HTMLInputElement;
        expect(fontScaleSlider).toHaveAttribute('min', '0.08');
        expect(fontScaleSlider).toHaveAttribute('max', '2');

        fireEvent.click(screen.getByRole('button', { name: 'Shift left' }));
        fireEvent.click(screen.getByRole('button', { name: 'Shift right' }));

        await waitFor(() => {
            expect(receivedCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'shiftYearView',
                        direction: 'left',
                    }),
                    expect.objectContaining({
                        type: 'shiftYearView',
                        direction: 'right',
                    }),
                ])
            );
        });

        window.removeEventListener(CALENDAR_COMMAND_EVENT, handleCommand);
    });

    it('offers Gregorian and BS label toggles for month and year views', async () => {
        const receivedCommands: any[] = [];
        const handleCommand = (event: Event) => {
            receivedCommands.push((event as CustomEvent).detail);
        };
        window.addEventListener(CALENDAR_COMMAND_EVENT, handleCommand);

        render(<CalendarHeaderControls />);

        fireEvent.change(screen.getByLabelText('View'), { target: { value: 'year' } });
        expect(screen.getByLabelText('Year View Month Basis')).toBeInTheDocument();
        expect(document.getElementById('calendar-show-inline-non-basis-breaks-header')).not.toBeNull();
        fireEvent.click(document.getElementById('calendar-show-gregorian-header') as HTMLInputElement);

        await waitFor(() => {
            expect(screen.queryByLabelText('Year View Month Basis')).toBeNull();
            expect(document.getElementById('calendar-show-inline-non-basis-breaks-header')).toBeNull();
        });

        fireEvent.click(document.getElementById('calendar-show-gregorian-header') as HTMLInputElement);
        fireEvent.click(document.getElementById('calendar-show-inline-non-basis-breaks-header') as HTMLInputElement);
        fireEvent.click(document.getElementById('calendar-show-gregorian-header') as HTMLInputElement);
        fireEvent.click(document.getElementById('calendar-show-bs-header') as HTMLInputElement);

        await waitFor(() => {
            expect(receivedCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'setShowGregorianCalendar',
                        showGregorianCalendar: false,
                    }),
                    expect.objectContaining({
                        type: 'setShowBsCalendar',
                        showBsCalendar: false,
                    }),
                    expect.objectContaining({
                        type: 'setShowInlineNonBasisMonthBreaks',
                        showInlineNonBasisMonthBreaks: false,
                    }),
                ])
            );
        });

        window.removeEventListener(CALENDAR_COMMAND_EVENT, handleCommand);
    });

    it('offers day view controls and dispatches day-specific settings', async () => {
        const receivedCommands: any[] = [];
        const handleCommand = (event: Event) => {
            receivedCommands.push((event as CustomEvent).detail);
        };
        window.addEventListener(CALENDAR_COMMAND_EVENT, handleCommand);

        render(<CalendarHeaderControls />);

        const viewSelect = screen.getByLabelText('View') as HTMLSelectElement;
        fireEvent.change(viewSelect, { target: { value: 'day' } });

        await waitFor(() => {
            expect(receivedCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'setViewMode',
                        viewMode: 'day',
                    }),
                ])
            );
        });

        fireEvent.change(screen.getByLabelText('Visible Days'), { target: { value: '3' } });
        fireEvent.click(screen.getByText('Second row of days'));
        fireEvent.change(screen.getByLabelText('Hour Zoom'), { target: { value: '72' } });

        await waitFor(() => {
            expect(receivedCommands).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'setDayVisibleDays',
                        dayVisibleDays: 3,
                    }),
                    expect.objectContaining({
                        type: 'setDayRowCount',
                        dayRowCount: 2,
                    }),
                    expect.objectContaining({
                        type: 'setDayHourHeight',
                        dayHourHeight: 72,
                    }),
                ])
            );
        });

        window.removeEventListener(CALENDAR_COMMAND_EVENT, handleCommand);
    });
});
