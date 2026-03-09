// components/DraggableCalendarEvent.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { cn } from '../lib/utils';
import { CALENDAR_YEAR_FONT_SCALE_MAX, CALENDAR_YEAR_FONT_SCALE_MIN } from '../lib/calendar-controls';
import { buildMemberColorMap, getReadableTextColor, hexToRgbaString } from '../lib/family-member-colors';
import styles from '../styles/Calendar.module.css'; // Import your calendar styles

interface EventFamilyMember {
    id: string;
    name?: string | null;
    color?: string | null;
}

interface EventMemberIndicator {
    id: string;
    name: string | null;
    initials: string;
    color: string;
    textColor: string;
    tintColor: string;
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
    memberIndicatorStyle?: 'badge' | 'dot';
    scale?: number;
    className?: string;
    continuesBefore?: boolean;
    continuesAfter?: boolean;
    draggableEnabled?: boolean;
    testId?: string | null;
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
    memberIndicatorStyle = 'badge',
    scale = 1,
    className,
    continuesBefore = false,
    continuesAfter = false,
    draggableEnabled = true,
    testId,
}: DraggableCalendarEventProps) => {
    const eventRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const members = item.pertainsTo || [];
    const isSpanLayout = layout === 'span';
    const isYearLayout = layout === 'year';
    const effectiveScale = Number.isFinite(scale)
        ? Math.min(CALENDAR_YEAR_FONT_SCALE_MAX, Math.max(CALENDAR_YEAR_FONT_SCALE_MIN, scale))
        : 1;
    const itemKind = item.calendarItemKind === 'chore' ? 'chore' : 'event';
    const isInteractive = draggableEnabled || typeof onClick === 'function';
    const descriptionText = useMemo(() => String(item.description || '').replace(/\s+/g, ' ').trim(), [item.description]);
    const showDescriptionRow = !isSpanLayout && !isYearLayout && descriptionText.length > 0;
    const memberIndicators = useMemo<EventMemberIndicator[]>(() => {
        const memberColorsById = buildMemberColorMap(members);

        return members
            .map((member) => {
                const memberId = typeof member?.id === 'string' ? member.id.trim() : '';
                if (!memberId) {
                    return null;
                }

                const color = memberColorsById[memberId];
                if (!color) {
                    return null;
                }

                return {
                    id: memberId,
                    name: member.name || null,
                    initials: getMemberInitials(member.name),
                    color,
                    textColor: getReadableTextColor(color),
                    tintColor: hexToRgbaString(color, 0.16),
                };
            })
            .filter((member): member is EventMemberIndicator => Boolean(member));
    }, [members]);
    const usesDotIndicators = memberIndicatorStyle === 'dot';

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
            data-testid={testId === null ? undefined : (testId ?? `calendar-event-${item.id}`)}
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
                {memberIndicators.length > 0 ? (
                    <div
                        className={cn(
                            styles.eventAudienceRow,
                            isSpanLayout && styles.eventAudienceRowSpan,
                            usesDotIndicators && styles.eventAudienceRowDots
                        )}
                    >
                        {memberIndicators.map((member) => (
                            <span
                                key={member.id}
                                title={member.name || 'Unknown member'}
                                data-calendar-member-indicator={usesDotIndicators ? 'dot' : 'badge'}
                                className={usesDotIndicators ? styles.eventMemberDot : styles.eventAudienceAvatar}
                                style={
                                    {
                                        '--calendar-member-indicator-color': member.color,
                                        '--calendar-member-indicator-soft': member.tintColor,
                                        '--calendar-member-indicator-text': member.textColor,
                                    } as React.CSSProperties
                                }
                            >
                                {usesDotIndicators ? null : member.initials}
                            </span>
                        ))}
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
