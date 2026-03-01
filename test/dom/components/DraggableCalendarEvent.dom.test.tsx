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

        const eventNode = screen.getByText('Piano');
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
});
