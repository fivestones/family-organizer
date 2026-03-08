// components/DraggableCalendarEvent.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { cn } from '../lib/utils';
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
    layout?: 'cell' | 'span';
    continuesBefore?: boolean;
    continuesAfter?: boolean;
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

export const DraggableCalendarEvent = ({
    item,
    index,
    onClick,
    layout = 'cell',
    continuesBefore = false,
    continuesAfter = false,
}: DraggableCalendarEventProps) => {
    const eventRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const members = item.pertainsTo || [];
    const visibleMembers = useMemo(() => members.slice(0, 3), [members]);
    const remainingMemberCount = Math.max(0, members.length - visibleMembers.length);
    const isSpanLayout = layout === 'span';
    const descriptionText = useMemo(() => String(item.description || '').replace(/\s+/g, ' ').trim(), [item.description]);
    const showAudienceInline = !isSpanLayout;
    const showDescriptionRow = !isSpanLayout && descriptionText.length > 0;

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
            className={cn(
                styles.calendarItem,
                styles.event,
                styles.circled,
                isSpanLayout && styles.eventSpan,
                isSpanLayout && continuesBefore && styles.eventSpanContinuesBefore,
                isSpanLayout && continuesAfter && styles.eventSpanContinuesAfter
            )}
            onClick={onClick}
        >
            <div className={cn(styles.eventHeaderRow, isSpanLayout && styles.eventHeaderRowSpan)}>
                {showAudienceInline ? (
                    <div className={cn(styles.eventAudienceRow, isSpanLayout && styles.eventAudienceRowSpan)}>
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
                ) : null}
                <div className={cn(styles.eventTitle, isSpanLayout && styles.eventTitleSpan)}>{item.title}</div>
            </div>
            {showDescriptionRow ? <div className={styles.eventMetaText}>{descriptionText}</div> : null}
        </div>
    );
};
