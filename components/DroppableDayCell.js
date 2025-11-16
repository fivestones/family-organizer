// components/DroppableDayCell.js
import React, { useRef, useEffect, useState } from 'react';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { attachClosestEdge, extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { DropIndicator } from '@atlaskit/pragmatic-drag-and-drop-react-drop-indicator/box';

export const DroppableDayCell = ({ day, dateStr, className, onClick, children }) => {
    const cellRef = useRef(null);
    const [dropIndicatorEdge, setDropIndicatorEdge] = useState(null);

    useEffect(() => {
        const cell = cellRef.current;
        if (!cell) return;

        const cleanupDropTarget = dropTargetForElements({
            element: cell,
            canDrop: (args) => args.source.data.type === 'calendar-event',
            getIsSticky: () => true,
            getData: ({ input, element }) => {
                // Attach closest edge info (top/bottom) to our data
                const data = { type: 'calendar-day', dateStr: dateStr };
                return attachClosestEdge(data, {
                    input,
                    element,
                    allowedEdges: ['top', 'bottom'], // Only care about top/bottom for day cells
                });
            },
            onDrag: (args) => {
                setDropIndicatorEdge(extractClosestEdge(args.self.data));
            },
            onDragLeave: () => {
                setDropIndicatorEdge(null);
            },
            onDrop: () => {
                setDropIndicatorEdge(null);
            },
        });

        return cleanupDropTarget;
    }, [dateStr]); // Re-run if the date string changes

    return (
        <td ref={cellRef} className={className} onClick={() => onClick(day)}>
            {/* Render drop indicator */}
            {dropIndicatorEdge === 'top' && <DropIndicator edge="top" />}
            {dropIndicatorEdge === 'bottom' && <DropIndicator edge="bottom" />}

            {/* Render the cell's content */}
            {children}
        </td>
    );
};
