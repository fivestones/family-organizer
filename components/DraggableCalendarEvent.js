// components/DraggableCalendarEvent.js
import React, { useRef, useEffect, useState } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import styles from '../styles/Calendar.module.css'; // Import your calendar styles

export const DraggableCalendarEvent = ({ item, index, onClick }) => {
    const eventRef = useRef(null);
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
