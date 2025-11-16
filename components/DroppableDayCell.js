// components/DroppableDayCell.js
import React, { useRef, useEffect, useState } from 'react';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
// REMOVED: Edge detection and DropIndicator imports
import { cn } from '../lib/utils'; // Import cn utility
import styles from '../styles/Calendar.module.css'; // Import styles

export const DroppableDayCell = ({ day, dateStr, className, onClick, children }) => {
    const cellRef = useRef(null);
    // NEW: State to track if the cell is being dragged over
    const [isBeingDraggedOver, setIsBeingDraggedOver] = useState(false);

    useEffect(() => {
        const cell = cellRef.current;
        if (!cell) return;

        const cleanupDropTarget = dropTargetForElements({
            element: cell,
            canDrop: (args) => args.source.data.type === 'calendar-event',
            getIsSticky: () => true,
            getData: () => {
                // CHANGED: Simplified data, no edge detection needed
                return { type: 'calendar-day', dateStr: dateStr };
            },
            // NEW: Set state on drag enter
            onDragEnter: () => setIsBeingDraggedOver(true),
            // REMOVED: onDrag handler
            onDragLeave: () => {
                // CHANGED: Set state on drag leave
                setIsBeingDraggedOver(false);
            },
            onDrop: () => {
                // CHANGED: Set state on drop
                setIsBeingDraggedOver(false);
            },
        });

        return cleanupDropTarget;
    }, [dateStr]); // Re-run if the date string changes

    return (
        // CHANGED: Apply conditional class for drag-over state
        <td ref={cellRef} className={cn(className, isBeingDraggedOver && styles.dragOverCell)} onClick={() => onClick(day)}>
            {/* REMOVED: DropIndicator elements */}
            {/* Render the cell's content */}
            {children}
        </td>
    );
};
