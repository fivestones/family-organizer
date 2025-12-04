// components/DraggableCalendarEvent.tsx
'use client';

import React, { useRef, useEffect, useState } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import styles from '../styles/Calendar.module.css'; // Import your calendar styles

// Defining this interface here for now so we can type the props
export interface CalendarItem {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    isAllDay: boolean;
    description?: string;
    // Allow flexible properties for InstantDB data
    [key: string]: any;
}

interface DraggableCalendarEventProps {
    item: CalendarItem;
    index: number;
    onClick: (e: React.MouseEvent) => void;
}

export const DraggableCalendarEvent = ({ item, index, onClick }: DraggableCalendarEventProps) => {
    const eventRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const element = eventRef.current;
        if (!element) return;

        const cleanupDraggable = draggable({
            element: element,
            getInitialData: () => ({ type: 'calendar-event', event: item, index: index }),
            onDragStart: () => setIsDragging(true),
            onDrop: () => setIsDragging(false),
        });

        return cleanupDraggable;
    }, [item, index]);

    return (
        <div
            ref={eventRef}
            style={{ opacity: isDragging ? 0.4 : 1 }} // Style when dragging
            className={`${styles.calendarItem} ${styles.event} ${styles.circled}`}
            onClick={onClick}
        >
            {item.title}
        </div>
    );
};
