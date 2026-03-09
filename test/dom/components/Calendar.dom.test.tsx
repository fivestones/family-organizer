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
    DroppableDayCell: ({ day, dateStr, onClick, onDoubleClick, children, className, style }: any) => (
        <td
            data-testid={`day-cell-${dateStr}`}
            data-calendar-cell-date={dateStr}
            className={className}
            style={style}
            onClick={() => onClick?.(day)}
            onDoubleClick={() => onDoubleClick?.(day)}
        >
            {children}
        </td>
    ),
}));

vi.mock('@/components/DraggableCalendarEvent', () => ({
    DraggableCalendarEvent: ({ item, onClick, onDoubleClick, memberIndicatorStyle, layout, selected }: any) => {
        const usesChipChrome = (item.calendarItemKind || 'event') === 'event' && (item.isAllDay || layout === 'span');

        return (
            <button
                type="button"
                data-testid={`calendar-event-${item.id}`}
                data-calendar-item-kind={item.calendarItemKind || 'event'}
                data-calendar-chip-surface={usesChipChrome ? 'chip' : 'plain'}
                data-calendar-selected={selected ? 'true' : 'false'}
                data-member-colors={(item.pertainsTo || []).map((member: any) => member?.color || '').join(',')}
                data-member-indicator-style={memberIndicatorStyle || 'badge'}
                onClick={(e) => onClick?.(e)}
                onDoubleClick={(e) => onDoubleClick?.(e)}
            >
                {item.title}
            </button>
        );
    },
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
    RecurrenceScopeDialog: ({ action, open, onSelect, scopeMode }: any) =>
        open ? (
            <div data-testid="recurrence-scope-dialog">
                <button type="button" onClick={() => onSelect('single')}>
                    Only this event
                </button>
                <button type="button" onClick={() => onSelect(action === 'delete' ? 'following' : scopeMode === 'all' ? 'all' : 'following')}>
                    {action === 'delete' ? 'This and all following events' : scopeMode === 'all' ? 'All events' : 'This and following events'}
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

vi.mock('@/components/ui/alert-dialog', () => ({
    AlertDialog: ({ open, children }: any) => (open ? <div data-testid="delete-confirm-dialog">{children}</div> : null),
    AlertDialogContent: ({ children }: any) => <div>{children}</div>,
    AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
    AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
    AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
    AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
    AlertDialogCancel: ({ children }: any) => <button type="button">{children}</button>,
    AlertDialogAction: ({ children, onClick }: any) => (
        <button type="button" onClick={onClick}>
            {children}
        </button>
    ),
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
                        delete() {
                            return { entity: 'calendarItems', id: String(key), op: 'delete' };
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

function renderCalendarWithData(
    { calendarItems = [], chores = [], familyMembers = [] }: { calendarItems?: any[]; chores?: any[]; familyMembers?: any[] },
    props?: Partial<React.ComponentProps<typeof Calendar>>
) {
    mocks.dbUseQuery.mockReturnValue({
        isLoading: false,
        error: null,
        data: { calendarItems, chores, familyMembers },
    });
    render(<Calendar currentDate={new Date(2026, 2, 15)} numWeeks={1} displayBS={false} {...props} />);
}

function renderCalendarWithItems(items: any[], props?: Partial<React.ComponentProps<typeof Calendar>>) {
    renderCalendarWithData({ calendarItems: items }, props);
}

describe('Calendar', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.dbUseQuery.mockReset();
        mocks.dbTransact.mockReset();
        mocks.monitorForElements.mockReset();
        mocks.monitorCleanup.mockReset();
        mocks.monitorConfig = null;
        window.localStorage.clear();
    });

    it('opens the add-event modal in create mode when a day cell is double-clicked', () => {
        renderCalendarWithItems([]);

        const firstDayCell = screen.getByTestId('day-cell-2026-03-15');
        fireEvent.doubleClick(firstDayCell);

        const form = screen.getByTestId('add-event-form');
        expect(form).toHaveAttribute('data-selected-date', '2026-03-15');
        expect(form).toHaveAttribute('data-selected-event-id', '');
    });

    it('selects an event on single click and opens edit mode on double click', () => {
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

        expect(screen.queryByTestId('add-event-form')).toBeNull();
        expect(screen.getByTestId('calendar-event-evt-1')).toHaveAttribute('data-calendar-selected', 'true');

        fireEvent.doubleClick(screen.getByTestId('calendar-event-evt-1'));

        const form = screen.getByTestId('add-event-form');
        expect(form).toHaveAttribute('data-selected-date', '2026-03-15');
        expect(form).toHaveAttribute('data-selected-event-id', 'evt-1');
    });

    it('clears selection when a day cell is single-clicked', () => {
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
        expect(screen.getByTestId('calendar-event-evt-1')).toHaveAttribute('data-calendar-selected', 'true');

        fireEvent.click(screen.getByTestId('day-cell-2026-03-16'));
        expect(screen.getByTestId('calendar-event-evt-1')).toHaveAttribute('data-calendar-selected', 'false');
    });

    it('resolves member colors for regular events and chores before rendering event chips', () => {
        renderCalendarWithData(
            {
                familyMembers: [
                    { id: 'member-1', name: 'Judah', color: '#3B82F6' },
                    { id: 'member-2', name: 'Ava', color: '#EF4444' },
                ],
                calendarItems: [
                    {
                        id: 'evt-1',
                        title: 'Piano',
                        description: '',
                        startDate: '2026-03-15',
                        endDate: '2026-03-16',
                        isAllDay: true,
                        pertainsTo: [{ id: 'member-1', name: 'Judah' }],
                    },
                ],
                chores: [
                    {
                        id: 'chore-1',
                        title: 'Kitchen reset',
                        description: '',
                        startDate: '2026-03-15',
                        rotationType: 'none',
                        assignees: [{ id: 'member-2', name: 'Ava' }],
                        assignments: [],
                        isJoint: false,
                        isUpForGrabs: false,
                    },
                ],
            },
            { showChores: true }
        );

        expect(screen.getByTestId('calendar-event-evt-1')).toHaveAttribute('data-member-colors', '#3B82F6');
        expect(screen.getByTestId('calendar-event-evt-1')).toHaveAttribute('data-member-indicator-style', 'badge');
        expect(screen.getByTestId('calendar-event-chore-chore-1-2026-03-15')).toHaveAttribute('data-member-colors', '#EF4444');
        expect(screen.getByTestId('calendar-event-chore-chore-1-2026-03-15')).toHaveAttribute('data-calendar-chip-surface', 'plain');
    });

    it('opens a delete confirmation for a selected non-recurring event and deletes it with the keyboard', async () => {
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
        fireEvent.keyDown(window, { key: 'Delete' });

        expect(screen.getByTestId('delete-confirm-dialog')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Delete'));

        await waitFor(() => {
            expect(mocks.dbTransact).toHaveBeenCalledWith([{ entity: 'calendarItems', id: 'evt-1', op: 'delete' }]);
        });
    });

    it('uses the recurrence scope flow when deleting a selected recurring event with the keyboard', async () => {
        renderCalendarWithItems([
            {
                id: 'evt-recurring',
                title: 'Lesson',
                description: '',
                startDate: '2026-03-15',
                endDate: '2026-03-16',
                isAllDay: true,
                rrule: 'RRULE:FREQ=WEEKLY',
            },
        ]);

        fireEvent.click(screen.getAllByTestId('calendar-event-evt-recurring')[0]);
        fireEvent.keyDown(window, { key: 'Delete' });

        expect(screen.getByTestId('recurrence-scope-dialog')).toBeInTheDocument();

        fireEvent.click(screen.getByText('Only this event'));

        await waitFor(() => {
            expect(mocks.dbTransact).toHaveBeenCalledTimes(1);
        });

        const txOps = mocks.dbTransact.mock.calls[0][0];
        expect(txOps[0]).toMatchObject({ entity: 'calendarItems', id: 'evt-recurring', op: 'update' });
        expect(txOps[0].payload.exdates).toContain('2026-03-15');
    });

    it('positions today on the top visible row when the calendar first renders', async () => {
        const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
        const originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
        const scrollToMock = vi.fn(function scrollTo(this: HTMLElement, options: ScrollToOptions) {
            this.scrollTop = Number(options?.top || 0);
        });

        Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
            configurable: true,
            value: scrollToMock,
        });
        Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
            configurable: true,
            get() {
                return this.getAttribute?.('data-calendar-cell-date') === '2026-03-15' ? 420 : 0;
            },
        });

        try {
            renderCalendarWithItems([], { currentDate: new Date(2026, 2, 15) });

            await waitFor(() => {
                expect(scrollToMock).toHaveBeenCalledWith({ top: 412, behavior: 'auto' });
            });

            expect(screen.getByTestId('calendar-scroll-container')).toHaveProperty('scrollTop', 412);
        } finally {
            if (originalScrollTo) {
                Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
            } else {
                delete (HTMLElement.prototype as any).scrollTo;
            }

            if (originalOffsetTop) {
                Object.defineProperty(HTMLElement.prototype, 'offsetTop', originalOffsetTop);
            } else {
                delete (HTMLElement.prototype as any).offsetTop;
            }
        }
    });

    it('renders vertical month labels only on the first day of the respective month', () => {
        renderCalendarWithItems([], {
            currentDate: new Date(2026, 0, 18),
            displayBS: true,
        });

        const leadingCell = screen.getByTestId('day-cell-2025-12-07');
        expect(within(leadingCell).queryByText('December')).toBeNull();
        expect(within(leadingCell).queryByText('चैत (Chait)')).toBeNull();

        const firstOfMonthCell = screen.getByTestId('day-cell-2026-01-01');
        expect(within(firstOfMonthCell).getByText('January')).toBeInTheDocument();
        expect(within(firstOfMonthCell).getByText('वैशाख (Baisakh)')).toBeInTheDocument();
    });

    it('switches into the full year view and renders discrete month cards', async () => {
        renderCalendarWithItems([], {
            currentDate: new Date(2026, 2, 15),
            displayBS: true,
        });

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'setViewMode', viewMode: 'year' },
                })
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId('year-month-gregorian-2026-03')).toBeInTheDocument();
            expect(screen.getByTestId('year-month-gregorian-2027-02')).toBeInTheDocument();
        });
    });

    it('shifts the year view by one month when the shift command is dispatched', async () => {
        renderCalendarWithItems([], {
            currentDate: new Date(2026, 2, 15),
            displayBS: true,
        });

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'setViewMode', viewMode: 'year' },
                })
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId('year-month-gregorian-2025-03')).toBeInTheDocument();
            expect(screen.getByTestId('year-month-gregorian-2028-02')).toBeInTheDocument();
        });

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'shiftYearView', direction: 'left' },
                })
            );
        });

        expect(screen.getByTestId('year-month-gregorian-2025-03')).toBeInTheDocument();
        expect(screen.queryByTestId('year-month-gregorian-2028-03')).not.toBeInTheDocument();

        await waitFor(() => {
            expect(screen.queryByTestId('year-month-gregorian-2025-03')).not.toBeInTheDocument();
            expect(screen.getByTestId('year-month-gregorian-2025-04')).toBeInTheDocument();
            expect(screen.getByTestId('year-month-gregorian-2028-03')).toBeInTheDocument();
        });
    });

    it('allows consecutive year-view shifts in both directions', async () => {
        renderCalendarWithItems([], {
            currentDate: new Date(2026, 2, 15),
            displayBS: true,
        });

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'setViewMode', viewMode: 'year' },
                })
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId('year-month-gregorian-2026-03')).toBeInTheDocument();
        });

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'shiftYearView', direction: 'right' },
                })
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId('year-month-gregorian-2026-02')).toBeInTheDocument();
            expect(screen.queryByTestId('year-month-gregorian-2028-02')).not.toBeInTheDocument();
        });

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'shiftYearView', direction: 'left' },
                })
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId('year-month-gregorian-2026-03')).toBeInTheDocument();
            expect(screen.getByTestId('year-month-gregorian-2027-02')).toBeInTheDocument();
        });
    });

    it('keeps multi-day events as shared span bars in the year view', async () => {
        renderCalendarWithItems([
            {
                id: 'evt-span',
                title: 'Spring Break',
                description: '',
                startDate: '2026-03-18',
                endDate: '2026-03-21',
                isAllDay: true,
            },
        ], {
            currentDate: new Date(2026, 2, 15),
            displayBS: true,
        });

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'setViewMode', viewMode: 'year' },
                })
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId('year-month-gregorian-2026-03')).toBeInTheDocument();
        });

        expect(screen.getAllByTestId('calendar-event-evt-span')).toHaveLength(1);
    });

    it('uses compact member indicators in the year view', async () => {
        renderCalendarWithData(
            {
                familyMembers: [{ id: 'member-1', name: 'Judah', color: '#3B82F6' }],
                calendarItems: [
                    {
                        id: 'evt-dot',
                        title: 'Piano',
                        description: '',
                        startDate: '2026-03-15',
                        endDate: '2026-03-16',
                        isAllDay: true,
                        pertainsTo: [{ id: 'member-1', name: 'Judah' }],
                    },
                ],
            },
            {
                currentDate: new Date(2026, 2, 15),
                displayBS: true,
            }
        );

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'setViewMode', viewMode: 'year' },
                })
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId('calendar-event-evt-dot')).toHaveAttribute('data-member-indicator-style', 'dot');
        });
    });

    it('lets single-day year-view events rise when no multi-day span occupies that day', async () => {
        renderCalendarWithItems(
            [
                {
                    id: 'evt-span',
                    title: 'School Trip',
                    description: '',
                    startDate: '2026-03-11',
                    endDate: '2026-03-14',
                    isAllDay: true,
                },
                {
                    id: 'evt-single',
                    title: 'Something',
                    description: '',
                    startDate: '2026-03-14',
                    endDate: '2026-03-15',
                    isAllDay: true,
                },
            ],
            {
                currentDate: new Date(2026, 2, 15),
                displayBS: true,
            }
        );

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'setViewMode', viewMode: 'year' },
                })
            );
        });

        await waitFor(() => {
            expect(screen.getByTestId('year-month-gregorian-2026-03')).toBeInTheDocument();
        });

        const spanEndDay = screen.getByTestId('day-cell-2026-03-13');
        const adjacentSingleDay = screen.getByTestId('day-cell-2026-03-14');
        const spanSpacer = spanEndDay.querySelector<HTMLElement>('[aria-hidden="true"]');
        const adjacentSpacer = adjacentSingleDay.querySelector<HTMLElement>('[aria-hidden="true"]');

        expect(within(adjacentSingleDay).getByTestId('calendar-event-evt-single')).toBeInTheDocument();
        expect(spanSpacer).not.toBeNull();
        expect(adjacentSpacer).toBeNull();
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

    it('keeps chores hidden by default and shows them once the chore overlay is enabled', async () => {
        renderCalendarWithData({
            chores: [
                {
                    id: 'chore-alex',
                    title: 'Take out trash',
                    description: 'Bins to the curb',
                    startDate: '2026-03-15',
                    rotationType: 'none',
                    assignees: [{ id: 'member-alex', name: 'Alex' }],
                },
            ],
        });

        expect(within(screen.getByTestId('day-cell-2026-03-15')).queryByRole('button', { name: 'Take out trash' })).toBeNull();

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'setShowChores', showChores: true },
                })
            );
        });

        await waitFor(() => {
            const choreButton = within(screen.getByTestId('day-cell-2026-03-15')).getByRole('button', { name: 'Take out trash' });
            expect(choreButton).toHaveAttribute('data-calendar-item-kind', 'chore');
        });
    });

    it('applies the member filter to chores and shows joint or up-for-grabs chores when any selected assignee matches', async () => {
        renderCalendarWithData({
            chores: [
                {
                    id: 'chore-alex-only',
                    title: 'Alex solo chore',
                    startDate: '2026-03-15',
                    rotationType: 'none',
                    assignees: [{ id: 'member-alex', name: 'Alex' }],
                },
                {
                    id: 'chore-sam-only',
                    title: 'Sam solo chore',
                    startDate: '2026-03-15',
                    rotationType: 'none',
                    assignees: [{ id: 'member-sam', name: 'Sam' }],
                },
                {
                    id: 'chore-joint',
                    title: 'Joint kitchen reset',
                    startDate: '2026-03-15',
                    rotationType: 'none',
                    isJoint: true,
                    assignees: [
                        { id: 'member-alex', name: 'Alex' },
                        { id: 'member-sam', name: 'Sam' },
                    ],
                },
                {
                    id: 'chore-up-for-grabs',
                    title: 'Feed the dog',
                    startDate: '2026-03-15',
                    rotationType: 'none',
                    isUpForGrabs: true,
                    assignees: [
                        { id: 'member-alex', name: 'Alex' },
                        { id: 'member-sam', name: 'Sam' },
                    ],
                },
            ],
        });

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'setShowChores', showChores: true },
                })
            );
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

        await waitFor(() => {
            const dayCell = screen.getByTestId('day-cell-2026-03-15');
            expect(within(dayCell).queryByRole('button', { name: 'Alex solo chore' })).toBeNull();
            expect(within(dayCell).getByRole('button', { name: 'Sam solo chore' })).toBeInTheDocument();
            expect(within(dayCell).getByRole('button', { name: 'Joint kitchen reset' })).toBeInTheDocument();
            expect(within(dayCell).getByRole('button', { name: 'Feed the dog' })).toBeInTheDocument();
        });
    });

    it('applies the specific chores filter when chores are shown on the calendar', async () => {
        renderCalendarWithData({
            chores: [
                {
                    id: 'chore-trash',
                    title: 'Take out trash',
                    startDate: '2026-03-15',
                    rotationType: 'none',
                    assignees: [{ id: 'member-alex', name: 'Alex' }],
                },
                {
                    id: 'chore-dishes',
                    title: 'Wash dishes',
                    startDate: '2026-03-15',
                    rotationType: 'none',
                    assignees: [{ id: 'member-alex', name: 'Alex' }],
                },
            ],
        });

        act(() => {
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'setShowChores', showChores: true },
                })
            );
            window.dispatchEvent(
                new CustomEvent(CALENDAR_COMMAND_EVENT, {
                    detail: { type: 'setChoreFilter', selectedChoreIds: ['chore-dishes'] },
                })
            );
        });

        await waitFor(() => {
            const dayCell = screen.getByTestId('day-cell-2026-03-15');
            expect(within(dayCell).queryByRole('button', { name: 'Take out trash' })).toBeNull();
            expect(within(dayCell).getByRole('button', { name: 'Wash dishes' })).toBeInTheDocument();
        });
    });

    it('after dragging the original recurring event and choosing "all events", moves the whole series', async () => {
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
        fireEvent.click(screen.getByRole('button', { name: 'All events' }));

        await waitFor(() => {
            expect(within(screen.getByTestId('day-cell-2026-03-19')).getByRole('button', { name: 'Soccer' })).toBeInTheDocument();
            expect(within(screen.getByTestId('day-cell-2026-03-26')).getByRole('button', { name: 'Soccer' })).toBeInTheDocument();
        });
        expect(within(screen.getByTestId('day-cell-2026-03-24')).queryByRole('button', { name: 'Soccer' })).toBeNull();

        await waitFor(() => {
            expect(mocks.dbTransact).toHaveBeenCalled();
        });
        const allOps = mocks.dbTransact.mock.calls.flatMap((call) => call[0] || []);
        expect(allOps).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    entity: 'calendarItems',
                    id: 'evt-1',
                    op: 'update',
                    payload: expect.objectContaining({
                        startDate: '2026-03-19',
                        endDate: '2026-03-20',
                        rrule: 'RRULE:FREQ=WEEKLY;BYDAY=TH',
                    }),
                }),
            ])
        );
    });

    it('uses the Alt drag hotkey to move only this recurring occurrence and shows a cursor indicator', async () => {
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

        const recurringOccurrence = {
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
        };

        act(() => {
            mocks.monitorConfig.onDrag({
                source: { data: { type: 'calendar-event', event: recurringOccurrence } },
                location: { current: { input: { altKey: true, clientX: 180, clientY: 220 } } },
            });
        });

        expect(screen.getByTestId('drag-recurrence-indicator')).toBeInTheDocument();
        expect(screen.getByText('Only this event')).toBeInTheDocument();
        expect(screen.getByText('Alt')).toBeInTheDocument();

        act(() => {
            mocks.monitorConfig.onDrop({
                source: { data: { type: 'calendar-event', event: recurringOccurrence } },
                location: {
                    current: {
                        input: { altKey: true, clientX: 180, clientY: 220 },
                        dropTargets: [{ data: { type: 'calendar-day', dateStr: '2026-03-26' } }],
                    },
                },
            });
        });

        expect(screen.queryByTestId('recurrence-scope-dialog')).toBeNull();
        expect(screen.queryByTestId('drag-recurrence-indicator')).toBeNull();

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

    it('uses the Shift drag hotkey to move this and following recurring events without opening the scope dialog', async () => {
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

        const recurringOccurrence = {
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
        };

        act(() => {
            mocks.monitorConfig.onDrag({
                source: { data: { type: 'calendar-event', event: recurringOccurrence } },
                location: { current: { input: { shiftKey: true, clientX: 210, clientY: 240 } } },
            });
        });

        expect(screen.getByTestId('drag-recurrence-indicator')).toBeInTheDocument();
        expect(screen.getByText('This and following events')).toBeInTheDocument();
        expect(screen.getByText('Shift')).toBeInTheDocument();

        act(() => {
            mocks.monitorConfig.onDrop({
                source: { data: { type: 'calendar-event', event: recurringOccurrence } },
                location: {
                    current: {
                        input: { shiftKey: true, clientX: 210, clientY: 240 },
                        dropTargets: [{ data: { type: 'calendar-day', dateStr: '2026-03-26' } }],
                    },
                },
            });
        });

        expect(screen.queryByTestId('recurrence-scope-dialog')).toBeNull();
        expect(screen.queryByTestId('drag-recurrence-indicator')).toBeNull();

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
                        rrule: expect.stringContaining('UNTIL='),
                    }),
                }),
                expect.objectContaining({
                    entity: 'calendarItems',
                    id: 'evt-generated',
                    op: 'update',
                    payload: expect.objectContaining({
                        startDate: '2026-03-26',
                        endDate: '2026-03-27',
                        rrule: 'RRULE:FREQ=WEEKLY;BYDAY=TH',
                    }),
                }),
            ])
        );
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

        expect(within(dayCell).queryByRole('button', { name: 'All Hands' })).toBeNull();
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
        expect(within(dayCell).queryByRole('button', { name: 'Alex Event' })).toBeNull();
        expect(within(dayCell).queryByRole('button', { name: 'Sam Event' })).toBeNull();
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
