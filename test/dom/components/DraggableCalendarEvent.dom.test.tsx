// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dndMocks = vi.hoisted(() => ({
    draggable: vi.fn(),
    cleanup: vi.fn(),
    lastConfig: null as any,
}));

vi.mock('@atlaskit/pragmatic-drag-and-drop/element/adapter', () => ({
    draggable: (config: any) => {
        dndMocks.lastConfig = config;
        dndMocks.draggable(config);
        return dndMocks.cleanup;
    },
}));

import { DraggableCalendarEvent } from '@/components/DraggableCalendarEvent';

describe('DraggableCalendarEvent', () => {
    beforeEach(() => {
        dndMocks.draggable.mockReset();
        dndMocks.cleanup.mockReset();
        dndMocks.lastConfig = null;
    });

    it('registers draggable metadata and toggles drag style during drag lifecycle', () => {
        const onClick = vi.fn();
        const item = {
            id: 'evt-1',
            title: 'Piano',
            startDate: '2026-04-01',
            endDate: '2026-04-02',
            isAllDay: true,
        };

        const { unmount } = render(<DraggableCalendarEvent item={item} index={2} onClick={onClick} />);

        expect(dndMocks.draggable).toHaveBeenCalledTimes(1);
        expect(dndMocks.lastConfig.getInitialData()).toEqual({
            type: 'calendar-event',
            event: item,
            index: 2,
        });

        const eventNode = screen.getByTestId('calendar-event-evt-1');
        expect(eventNode).toHaveStyle({ opacity: '1' });

        act(() => {
            dndMocks.lastConfig.onDragStart();
        });
        expect(eventNode).toHaveStyle({ opacity: '0.4' });

        act(() => {
            dndMocks.lastConfig.onDrop();
        });
        expect(eventNode).toHaveStyle({ opacity: '1' });

        fireEvent.click(eventNode);
        expect(onClick).toHaveBeenCalledTimes(1);

        unmount();
        expect(dndMocks.cleanup).toHaveBeenCalledTimes(1);
    });

    it('renders chores with the shared card UI without enabling drag behavior', () => {
        const item = {
            id: 'chore-1',
            title: 'Kitchen reset',
            startDate: '2026-04-01',
            endDate: '2026-04-02',
            isAllDay: true,
            calendarItemKind: 'chore' as const,
        };

        render(<DraggableCalendarEvent item={item} index={0} draggableEnabled={false} />);

        expect(dndMocks.draggable).not.toHaveBeenCalled();
        expect(screen.getByTestId('calendar-event-chore-1')).toHaveAttribute('data-calendar-item-kind', 'chore');
        expect(screen.getByTestId('calendar-event-chore-1')).toHaveAttribute('data-calendar-chip-surface', 'plain');
    });

    it('shows colored initials badges in roomy layouts', () => {
        render(
            <DraggableCalendarEvent
                item={{
                    id: 'evt-2',
                    title: 'Music lesson',
                    startDate: '2026-04-01',
                    endDate: '2026-04-02',
                    isAllDay: true,
                    pertainsTo: [
                        { id: 'member-1', name: 'Judah Bell', color: '#3B82F6' },
                        { id: 'member-2', name: 'Ava Bell', color: '#EF4444' },
                    ],
                }}
                index={0}
                draggableEnabled={false}
            />
        );

        const eventNode = screen.getByTestId('calendar-event-evt-2');
        const badges = eventNode.querySelectorAll('[data-calendar-member-indicator="badge"]');

        expect(badges).toHaveLength(2);
        expect(eventNode).toHaveTextContent('JB');
        expect(eventNode).toHaveTextContent('AB');
        expect(eventNode).toHaveAttribute('data-calendar-chip-surface', 'chip');
        expect((badges[0] as HTMLElement).style.getPropertyValue('--calendar-member-indicator-color')).toBe('#3B82F6');
        expect((badges[0] as HTMLElement).style.getPropertyValue('--calendar-member-indicator-contrast-surface')).toBe('#FFFFFF');
        expect((badges[1] as HTMLElement).style.getPropertyValue('--calendar-member-indicator-color')).toBe('#EF4444');
        expect((badges[1] as HTMLElement).style.getPropertyValue('--calendar-member-indicator-contrast-surface')).toBe('#FFFFFF');
    });

    it('shows compact color dots without initials in compact layouts', () => {
        render(
            <DraggableCalendarEvent
                item={{
                    id: 'evt-3',
                    title: 'Doctor visit',
                    startDate: '2026-04-01',
                    endDate: '2026-04-02',
                    isAllDay: true,
                    pertainsTo: [
                        { id: 'member-1', name: 'Judah Bell', color: '#3B82F6' },
                        { id: 'member-2', name: 'Ava Bell', color: '#EF4444' },
                    ],
                }}
                index={0}
                layout="year"
                memberIndicatorStyle="dot"
                draggableEnabled={false}
            />
        );

        const eventNode = screen.getByTestId('calendar-event-evt-3');
        const dots = eventNode.querySelectorAll('[data-calendar-member-indicator="dot"]');

        expect(dots).toHaveLength(2);
        expect(eventNode).not.toHaveTextContent('JB');
        expect(eventNode).not.toHaveTextContent('AB');
    });

    it('uses a plain surface for timed events while keeping the member badge', () => {
        render(
            <DraggableCalendarEvent
                item={{
                    id: 'evt-4',
                    title: 'Math tutoring',
                    startDate: '2026-04-01T15:00:00.000Z',
                    endDate: '2026-04-01T16:00:00.000Z',
                    isAllDay: false,
                    pertainsTo: [{ id: 'member-1', name: 'Sunny Kid', color: '#FDE68A' }],
                }}
                index={0}
                draggableEnabled={false}
            />
        );

        const eventNode = screen.getByTestId('calendar-event-evt-4');
        const badge = eventNode.querySelector('[data-calendar-member-indicator="badge"]') as HTMLElement | null;

        expect(eventNode).toHaveAttribute('data-calendar-chip-surface', 'plain');
        expect(badge).not.toBeNull();
        expect(badge?.style.getPropertyValue('--calendar-member-indicator-contrast-surface')).toBe('#000000');
    });

    it('marks multi-day span events as selected when chosen', () => {
        render(
            <DraggableCalendarEvent
                item={{
                    id: 'evt-5',
                    title: 'Spring break',
                    startDate: '2026-04-01',
                    endDate: '2026-04-04',
                    isAllDay: true,
                }}
                index={0}
                layout="span"
                selected
                draggableEnabled={false}
            />
        );

        expect(screen.getByTestId('calendar-event-evt-5')).toHaveAttribute('data-calendar-selected', 'true');
    });
});
