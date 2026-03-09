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
    calendarItemKind?: 'event' | 'chore';
    // Allow flexible properties for InstantDB data
    [key: string]: any;
}

interface DraggableCalendarEventProps {
    item: CalendarItem;
    index: number;
    onClick?: (e: React.MouseEvent) => void;
    layout?: 'cell' | 'span' | 'year';
    scale?: number;
    className?: string;
    continuesBefore?: boolean;
    continuesAfter?: boolean;
    draggableEnabled?: boolean;
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
    scale = 1,
    className,
    continuesBefore = false,
    continuesAfter = false,
    draggableEnabled = true,
}: DraggableCalendarEventProps) => {
    const eventRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const members = item.pertainsTo || [];
    const visibleMembers = useMemo(() => members.slice(0, 3), [members]);
    const remainingMemberCount = Math.max(0, members.length - visibleMembers.length);
    const isSpanLayout = layout === 'span';
    const isYearLayout = layout === 'year';
    const effectiveScale = Number.isFinite(scale) ? Math.max(0.6, scale) : 1;
    const itemKind = item.calendarItemKind === 'chore' ? 'chore' : 'event';
    const isInteractive = draggableEnabled || typeof onClick === 'function';
    const descriptionText = useMemo(() => String(item.description || '').replace(/\s+/g, ' ').trim(), [item.description]);
    const showAudienceInline = !isSpanLayout && !isYearLayout;
    const showDescriptionRow = !isSpanLayout && !isYearLayout && descriptionText.length > 0;

    useEffect(() => {
        if (!draggableEnabled) {
            return;
        }

        const element = eventRef.current;
        if (!element) return;

        const cleanupDraggable = draggable({
            element: element,
            getInitialData: () => ({ type: 'calendar-event', event: item, index: index }),
            onDragStart: () => setIsDragging(true),
            onDrop: () => setIsDragging(false),
        });

        return cleanupDraggable;
    }, [draggableEnabled, item, index]);

    return (
        <div
            ref={eventRef}
            data-testid={`calendar-event-${item.id}`}
            data-calendar-item-kind={itemKind}
            style={
                {
                    opacity: isDragging ? 0.4 : 1,
                    '--calendar-item-scale': String(effectiveScale),
                } as React.CSSProperties
            }
            className={cn(
                styles.calendarItem,
                styles[itemKind],
                styles.circled,
                isInteractive ? styles.calendarItemInteractive : styles.calendarItemStatic,
                effectiveScale !== 1 && styles.calendarItemScaled,
                isYearLayout && styles.calendarItemYear,
                isSpanLayout && styles.eventSpan,
                isSpanLayout && continuesBefore && styles.eventSpanContinuesBefore,
                isSpanLayout && continuesAfter && styles.eventSpanContinuesAfter,
                className
            )}
            onClick={onClick}
            title={item.title}
        >
            <div className={cn(styles.eventHeaderRow, isSpanLayout && styles.eventHeaderRowSpan, isYearLayout && styles.eventHeaderRowYear)}>
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
                <div className={cn(styles.eventTitle, isSpanLayout && styles.eventTitleSpan, isYearLayout && styles.eventTitleYear)}>
                    {item.title}
                </div>
            </div>
            {showDescriptionRow ? <div className={styles.eventMetaText}>{descriptionText}</div> : null}
        </div>
    );
};
