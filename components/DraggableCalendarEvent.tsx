// components/DraggableCalendarEvent.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import styles from '../styles/Calendar.module.css'; // Import your calendar styles

interface EventFamilyMember {
    id: string;
    name?: string | null;
}

export interface CalendarItem {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    isAllDay: boolean;
    description?: string;
    pertainsTo?: EventFamilyMember[];
    // Allow flexible properties for InstantDB data
    [key: string]: any;
}

interface DraggableCalendarEventProps {
    item: CalendarItem;
    index: number;
    onClick: (e: React.MouseEvent) => void;
}

const getMemberInitials = (name: string | null | undefined) => {
    if (!name) {
        return '?';
    }

    const words = name
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (words.length === 0) {
        return '?';
    }

    if (words.length === 1) {
        return words[0].slice(0, 2).toUpperCase();
    }

    return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
};

export const DraggableCalendarEvent = ({ item, index, onClick }: DraggableCalendarEventProps) => {
    const eventRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const members = item.pertainsTo || [];
    const visibleMembers = useMemo(() => members.slice(0, 3), [members]);
    const remainingMemberCount = Math.max(0, members.length - visibleMembers.length);

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
            data-testid={`calendar-event-${item.id}`}
            style={{ opacity: isDragging ? 0.4 : 1 }} // Style when dragging
            className={`${styles.calendarItem} ${styles.event} ${styles.circled}`}
            onClick={onClick}
        >
            <div className={styles.eventTitle}>{item.title}</div>
            <div className={styles.eventAudienceRow}>
                {members.length === 0 ? (
                    <span className={styles.eventAudienceAll}>All</span>
                ) : (
                    <>
                        {visibleMembers.map((member) => (
                            <span
                                key={member.id}
                                title={member.name || 'Unknown member'}
                                className={styles.eventAudienceAvatar}
                            >
                                {getMemberInitials(member.name)}
                            </span>
                        ))}
                        {remainingMemberCount > 0 && <span className={styles.eventAudienceCount}>+{remainingMemberCount}</span>}
                    </>
                )}
            </div>
        </div>
    );
};
