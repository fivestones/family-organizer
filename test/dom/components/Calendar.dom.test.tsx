// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CALENDAR_COMMAND_EVENT } from '@/lib/calendar-controls';

const mocks = vi.hoisted(() => ({
    dbUseQuery: vi.fn(),
    dbTransact: vi.fn(),
    monitorForElements: vi.fn(),
    monitorCleanup: vi.fn(),
    monitorConfig: null as any,
}));

vi.mock('next/font/local', () => ({
    __esModule: true,
    default: () => ({ className: 'mock-local-font' }),
}));

vi.mock('nepali-date-converter', () => ({
    __esModule: true,
    default: class FakeNepaliDate {
        private d: Date;
        constructor(date: Date) {
            this.d = date instanceof Date ? date : new Date(date);
        }
        getYear() {
            return this.d.getFullYear() + 57;
        }
        getMonth() {
            return this.d.getMonth();
        }
        getDate() {
            return this.d.getDate();
        }
        format(token: string) {
            if (token === 'YYYY') return String(this.getYear());
            if (token === 'D') return String(this.getDate());
            return '';
        }
    },
}));

vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
    monitorForElements: (config: any) => {
        mocks.monitorConfig = config;
        mocks.monitorForElements(config);
        return mocks.monitorCleanup;
    },
}));

vi.mock('@/components/DroppableDayCell', () => ({
    DroppableDayCell: ({ day, dateStr, onClick, children }: any) => (
        <td data-testid={`day-cell-${dateStr}`} onClick={() => onClick(day)}>
            {children}
        </td>
    ),
}));

vi.mock('@/components/DraggableCalendarEvent', () => ({
    DraggableCalendarEvent: ({ item, onClick }: any) => (
        <button type="button" data-testid={`calendar-event-${item.id}`} onClick={(e) => onClick(e)}>
            {item.title}
        </button>
    ),
}));

vi.mock('@/components/AddEvent', () => ({
    __esModule: true,
    default: ({ selectedDate, selectedEvent }: any) => (
        <div
            data-testid="add-event-form"
            data-selected-date={
                selectedDate instanceof Date && !Number.isNaN(selectedDate.getTime())
                    ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`
                    : ''
            }
            data-selected-event-id={selectedEvent?.id ?? ''}
        />
    ),
}));

vi.mock('@/components/RecurrenceScopeDialog', () => ({
    RecurrenceScopeDialog: ({ open, onSelect }: any) =>
        open ? (
            <div data-testid="recurrence-scope-dialog">
                <button type="button" onClick={() => onSelect('single')}>
                    Only this event
                </button>
                <button type="button" onClick={() => onSelect('following')}>
                    This and following events
                </button>
                <button type="button" onClick={() => onSelect('cancel')}>
                    Cancel
                </button>
            </div>
        ) : null,
}));

vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ open, children }: any) => (open ? <div data-testid="dialog-root">{children}</div> : null),
    DialogContent: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock('@instantdb/react', () => ({
    id: () => 'evt-generated',
    tx: {
        calendarItems: new Proxy(
            {},
            {
                get(_target, key: string) {
                    return {
                        update(payload: any) {
                            return { entity: 'calendarItems', id: String(key), op: 'update', payload };
                        },
                    };
                },
            }
        ),
    },
}));

vi.mock('@/lib/db', () => ({
    db: {
        useQuery: mocks.dbUseQuery,
        transact: mocks.dbTransact,
    },
}));

import Calendar from '@/components/Calendar';

function renderCalendarWithItems(items: any[], props?: Partial<React.ComponentProps<typeof Calendar>>) {
    mocks.dbUseQuery.mockReturnValue({
        isLoading: false,
        error: null,
        data: { calendarItems: items },
    });
    render(<Calendar currentDate={new Date(2026, 2, 15)} numWeeks={1} displayBS={false} {...props} />);
}

describe('Calendar', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.dbUseQuery.mockReset();
        mocks.dbTransact.mockReset();
        mocks.monitorForElements.mockReset();
        mocks.monitorCleanup.mockReset();
        mocks.monitorConfig = null;
    });

    it('opens the add-event modal in create mode when a day cell is clicked', () => {
        renderCalendarWithItems([]);

        const firstDayCell = screen.getByTestId('day-cell-2026-03-15');
        fireEvent.click(firstDayCell);

        const form = screen.getByTestId('add-event-form');
        expect(form).toHaveAttribute('data-selected-date', '2026-03-15');
        expect(form).toHaveAttribute('data-selected-event-id', '');
    });

    it('opens the add-event modal in edit mode when an existing event is clicked', () => {
        renderCalendarWithItems([
            {
                id: 'evt-1',
                title: 'Family Lunch',
                description: '',
                startDate: '2026-03-15',
                endDate: '2026-03-16',
                isAllDay: true,
            },
        ]);

        fireEvent.click(screen.getByTestId('calendar-event-evt-1'));

        const form = screen.getByTestId('add-event-form');
        expect(form).toHaveAttribute('data-selected-date', '2026-03-15');
        expect(form).toHaveAttribute('data-selected-event-id', 'evt-1');
    });

    it('reschedules an event via drag-drop monitor and persists the moved date', () => {
        renderCalendarWithItems([
            {
                id: 'evt-1',
                title: 'Soccer',
                description: '',
                startDate: '2026-03-15',
                endDate: '2026-03-16',
                isAllDay: true,
            },
        ]);

        expect(mocks.monitorForElements.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(mocks.monitorConfig).toBeTruthy();

        act(() => {
            mocks.monitorConfig.onDrop({
                source: {
                    data: {
                        type: 'calendar-event',
                        event: {
                            id: 'evt-1',
                            title: 'Soccer',
                            startDate: '2026-03-15',
                            endDate: '2026-03-16',
                            isAllDay: true,
                        },
                    },
                },
                location: {
                    current: {
                        dropTargets: [{ data: { type: 'calendar-day', dateStr: '2026-03-17' } }],
                    },
                },
            });
        });

        expect(mocks.dbTransact).toHaveBeenCalledTimes(1);
        const [ops] = mocks.dbTransact.mock.calls[0];
        expect(ops).toHaveLength(1);
        expect(ops[0]).toMatchObject({
            entity: 'calendarItems',
            id: 'evt-1',
            op: 'update',
            payload: {
                startDate: '2026-03-17',
                endDate: '2026-03-18',
                year: 2026,
                month: 3,
                dayOfMonth: 17,
                sequence: 1,
            },
        });
        expect(typeof ops[0].payload.updatedAt).toBe('string');
        expect(typeof ops[0].payload.lastModified).toBe('string');
        expect(typeof ops[0].payload.dtStamp).toBe('string');
    });

    it('ignores drops onto the same day or non-calendar targets', () => {
        renderCalendarWithItems([
            {
                id: 'evt-1',
                title: 'Soccer',
                startDate: '2026-03-15',
                endDate: '2026-03-16',
                isAllDay: true,
            },
        ]);

        act(() => {
            mocks.monitorConfig.onDrop({
                source: { data: { type: 'calendar-event', event: { id: 'evt-1', startDate: '2026-03-15', endDate: '2026-03-16', isAllDay: true } } },
                location: { current: { dropTargets: [{ data: { type: 'calendar-day', dateStr: '2026-03-15' } }] } },
            });
        });
        act(() => {
            mocks.monitorConfig.onDrop({
                source: { data: { type: 'not-calendar' } },
                location: { current: { dropTargets: [{ data: { type: 'calendar-day', dateStr: '2026-03-17' } }] } },
            });
        });

        expect(mocks.dbTransact).not.toHaveBeenCalled();
    });

    it('lists same-day events in ascending start-time order', () => {
        renderCalendarWithItems([
            {
                id: 'evt-2',
                title: 'Later event',
                startDate: '2026-03-15T14:00:00.000Z',
                endDate: '2026-03-15T15:00:00.000Z',
                isAllDay: false,
            },
            {
                id: 'evt-1',
                title: 'Earlier event',
                startDate: '2026-03-15T09:00:00.000Z',
                endDate: '2026-03-15T10:00:00.000Z',
                isAllDay: false,
            },
        ]);

        const dayCell = screen.getByTestId('day-cell-2026-03-15');
        const eventButtons = within(dayCell).getAllByRole('button');
        expect(eventButtons.map((button) => button.textContent)).toEqual(['Earlier event', 'Later event']);
    });

    it('expands RRULE events onto matching recurrence days', () => {
        renderCalendarWithItems([
            {
                id: 'evt-recurring',
                title: 'Family Lunch',
                startDate: '2026-03-15',
                endDate: '2026-03-16',
                isAllDay: true,
                rrule: 'RRULE:FREQ=WEEKLY;BYDAY=SU',
            },
        ]);

        expect(within(screen.getByTestId('day-cell-2026-03-15')).getByRole('button', { name: 'Family Lunch' })).toBeInTheDocument();
        expect(within(screen.getByTestId('day-cell-2026-03-22')).getByRole('button', { name: 'Family Lunch' })).toBeInTheDocument();
        expect(within(screen.getByTestId('day-cell-2026-03-29')).getByRole('button', { name: 'Family Lunch' })).toBeInTheDocument();
    });

    it('skips EXDATE occurrences when expanding RRULE events', () => {
        renderCalendarWithItems([
            {
                id: 'evt-recurring',
                title: 'Family Lunch',
                startDate: '2026-03-15',
                endDate: '2026-03-16',
                isAllDay: true,
                rrule: 'RRULE:FREQ=WEEKLY;BYDAY=SU',
                exdates: ['2026-03-22'],
            },
        ]);

        expect(within(screen.getByTestId('day-cell-2026-03-15')).getByRole('button', { name: 'Family Lunch' })).toBeInTheDocument();
        expect(within(screen.getByTestId('day-cell-2026-03-29')).getByRole('button', { name: 'Family Lunch' })).toBeInTheDocument();
        expect(within(screen.getByTestId('day-cell-2026-03-22')).queryByRole('button', { name: 'Family Lunch' })).toBeNull();
    });

    it('keeps the original start-day event visible even when RRULE BYDAY differs', () => {
        renderCalendarWithItems([
            {
                id: 'evt-recurring',
                title: 'Weekly Class',
                startDate: '2026-03-23',
                endDate: '2026-03-24',
                isAllDay: true,
                rrule: 'RRULE:FREQ=WEEKLY;BYDAY=TU',
            },
        ]);

        expect(within(screen.getByTestId('day-cell-2026-03-23')).getByRole('button', { name: 'Weekly Class' })).toBeInTheDocument();
        expect(within(screen.getByTestId('day-cell-2026-03-24')).getByRole('button', { name: 'Weekly Class' })).toBeInTheDocument();
    });

    it('after dragging a recurring master to another weekday, keeps start day and RRULE weekdays visible', async () => {
        renderCalendarWithItems([
            {
                id: 'evt-1',
                title: 'Soccer',
                startDate: '2026-03-17',
                endDate: '2026-03-18',
                isAllDay: true,
                rrule: 'RRULE:FREQ=WEEKLY;BYDAY=TU',
            },
        ]);

        act(() => {
            mocks.monitorConfig.onDrop({
                source: {
                    data: {
                        type: 'calendar-event',
                        event: {
                            id: 'evt-1',
                            title: 'Soccer',
                            startDate: '2026-03-17',
                            endDate: '2026-03-18',
                            isAllDay: true,
                            rrule: 'RRULE:FREQ=WEEKLY;BYDAY=TU',
                        },
                    },
                },
                location: {
                    current: {
                        dropTargets: [{ data: { type: 'calendar-day', dateStr: '2026-03-19' } }],
                    },
                },
            });
        });
        fireEvent.click(screen.getByRole('button', { name: 'This and following events' }));

        await waitFor(() => {
            expect(within(screen.getByTestId('day-cell-2026-03-19')).getByRole('button', { name: 'Soccer' })).toBeInTheDocument();
            expect(within(screen.getByTestId('day-cell-2026-03-24')).getByRole('button', { name: 'Soccer' })).toBeInTheDocument();
        });
    });

    it('can drag one recurring occurrence as a single override when choosing single scope', async () => {
        renderCalendarWithItems([
            {
                id: 'evt-master',
                title: 'Soccer',
                startDate: '2026-03-17',
                endDate: '2026-03-18',
                isAllDay: true,
                rrule: 'RRULE:FREQ=WEEKLY;BYDAY=TU',
                recurrenceLines: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
            },
        ]);

        act(() => {
            mocks.monitorConfig.onDrop({
                source: {
                    data: {
                        type: 'calendar-event',
                        event: {
                            id: 'evt-master',
                            title: 'Soccer',
                            startDate: '2026-03-24',
                            endDate: '2026-03-25',
                            isAllDay: true,
                            rrule: 'RRULE:FREQ=WEEKLY;BYDAY=TU',
                            recurrenceLines: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
                            __isRecurrenceInstance: true,
                            __masterEvent: {
                                id: 'evt-master',
                                title: 'Soccer',
                                startDate: '2026-03-17',
                                endDate: '2026-03-18',
                                isAllDay: true,
                                rrule: 'RRULE:FREQ=WEEKLY;BYDAY=TU',
                                recurrenceLines: ['RRULE:FREQ=WEEKLY;BYDAY=TU'],
                            },
                        },
                    },
                },
                location: {
                    current: {
                        dropTargets: [{ data: { type: 'calendar-day', dateStr: '2026-03-26' } }],
                    },
                },
            });
        });
        fireEvent.click(screen.getByRole('button', { name: 'Only this event' }));

        await waitFor(() => {
            expect(mocks.dbTransact).toHaveBeenCalledTimes(1);
        });
        const [ops] = mocks.dbTransact.mock.calls[0];
        expect(ops).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    entity: 'calendarItems',
                    id: 'evt-master',
                    op: 'update',
                    payload: expect.objectContaining({
                        exdates: expect.arrayContaining(['2026-03-24']),
                    }),
                }),
                expect.objectContaining({
                    entity: 'calendarItems',
                    id: 'evt-generated',
                    op: 'update',
                    payload: expect.objectContaining({
                        recurringEventId: 'evt-master',
                        recurrenceId: '2026-03-24',
                        startDate: '2026-03-26',
                    }),
                }),
            ])
        );
    });

    it('filters calendar events by selected family members when Everyone is off', () => {
        renderCalendarWithItems([
            {
                id: 'evt-everyone',
                title: 'All Hands',
                startDate: '2026-03-15',
                endDate: '2026-03-16',
                isAllDay: true,
            },
            {
                id: 'evt-alex',
                title: 'Alex Event',
                startDate: '2026-03-15',
                endDate: '2026-03-16',
                isAllDay: true,
                pertainsTo: [{ id: 'member-alex', name: 'Alex' }],
            },
            {
                id: 'evt-sam',
                title: 'Sam Event',
                startDate: '2026-03-15',
                endDate: '2026-03-16',
                isAllDay: true,
                pertainsTo: [{ id: 'member-sam', name: 'Sam' }],
            },
        ]);

        const dayCell = screen.getByTestId('day-cell-2026-03-15');
        expect(within(dayCell).getByRole('button', { name: 'All Hands' })).toBeInTheDocument();
        expect(within(dayCell).getByRole('button', { name: 'Alex Event' })).toBeInTheDocument();
        expect(within(dayCell).getByRole('button', { name: 'Sam Event' })).toBeInTheDocument();

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: {
                        type: 'setMemberFilter',
                        everyoneSelected: false,
                        selectedMemberIds: ['member-sam'],
                    },
                })
            );
        });

        expect(within(dayCell).getByRole('button', { name: 'All Hands' })).toBeInTheDocument();
        expect(within(dayCell).queryByRole('button', { name: 'Alex Event' })).toBeNull();
        expect(within(dayCell).getByRole('button', { name: 'Sam Event' })).toBeInTheDocument();

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: {
                        type: 'setMemberFilter',
                        everyoneSelected: false,
                        selectedMemberIds: [],
                    },
                })
            );
        });

        expect(within(dayCell).queryByRole('button', { name: 'All Hands' })).toBeNull();
        expect(within(dayCell).queryByRole('button', { name: 'Alex Event' })).toBeNull();
        expect(within(dayCell).queryByRole('button', { name: 'Sam Event' })).toBeNull();

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: {
                        type: 'setMemberFilter',
                        everyoneSelected: true,
                        selectedMemberIds: [],
                    },
                })
            );
        });

        expect(within(dayCell).getByRole('button', { name: 'All Hands' })).toBeInTheDocument();
        expect(within(dayCell).getByRole('button', { name: 'Alex Event' })).toBeInTheDocument();
        expect(within(dayCell).getByRole('button', { name: 'Sam Event' })).toBeInTheDocument();
    });

    it('includes recurring masters in the Instant query filter', () => {
        renderCalendarWithItems([]);

        expect(mocks.dbUseQuery).toHaveBeenCalled();
        const queryArg = mocks.dbUseQuery.mock.calls[0][0];
        const orConditions = queryArg?.calendarItems?.$?.where?.or;

        expect(Array.isArray(orConditions)).toBe(true);
        expect(orConditions).toEqual(expect.arrayContaining([expect.objectContaining({ rrule: { $isNull: false } })]));
    });
});
