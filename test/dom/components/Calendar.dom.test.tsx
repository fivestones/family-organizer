// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ open, children }: any) => (open ? <div data-testid="dialog-root">{children}</div> : null),
    DialogContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock('@instantdb/react', () => ({
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
        expect(ops).toEqual([
            {
                entity: 'calendarItems',
                id: 'evt-1',
                op: 'update',
                payload: {
                    startDate: '2026-03-17',
                    endDate: '2026-03-18',
                    year: 2026,
                    month: 3,
                    dayOfMonth: 17,
                },
            },
        ]);
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
});
