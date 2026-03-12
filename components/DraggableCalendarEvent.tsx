// components/DraggableCalendarEvent.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { cn } from '../lib/utils';
import { CALENDAR_YEAR_FONT_SCALE_MAX, CALENDAR_YEAR_FONT_SCALE_MIN } from '../lib/calendar-controls';
import { buildCalendarOccurrenceKey } from '@/lib/calendar-search';
import { buildMemberColorMap, getReadableTextColor, hexToRgbaString } from '../lib/family-member-colors';
import { getPhotoUrl } from '@/lib/photo-urls';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import styles from '../styles/Calendar.module.css'; // Import your calendar styles

interface EventFamilyMember {
    id: string;
    name?: string | null;
    color?: string | null;
    photoUrls?: any;
}

interface EventMemberIndicator {
    id: string;
    name: string | null;
    initials: string;
    color: string;
    contrastSurface: string;
    photoUrl?: string;
}

export interface CalendarItem {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    isAllDay: boolean;
    description?: string;
    pertainsTo?: EventFamilyMember[];
    tags?: Array<{ id?: string; name: string; normalizedName?: string }>;
    calendarItemKind?: 'event' | 'chore';
    // Allow flexible properties for InstantDB data
    [key: string]: any;
}

interface DraggableCalendarEventProps {
    item: CalendarItem;
    index: number;
    onClick?: (e: React.MouseEvent) => void;
    onDoubleClick?: (e: React.MouseEvent) => void;
    layout?: 'cell' | 'span' | 'year';
    memberIndicatorStyle?: 'badge' | 'dot';
    scale?: number;
    className?: string;
    continuesBefore?: boolean;
    continuesAfter?: boolean;
    draggableEnabled?: boolean;
    testId?: string | null;
    selected?: boolean;
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
    onDoubleClick,
    layout = 'cell',
    memberIndicatorStyle = 'badge',
    scale = 1,
    className,
    continuesBefore = false,
    continuesAfter = false,
    draggableEnabled = true,
    testId,
    selected = false,
}: DraggableCalendarEventProps) => {
    const eventRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const members = item.pertainsTo || [];
    const isSpanLayout = layout === 'span';
    const isYearLayout = layout === 'year';
    const effectiveScale = Number.isFinite(scale)
        ? Math.min(CALENDAR_YEAR_FONT_SCALE_MAX, Math.max(CALENDAR_YEAR_FONT_SCALE_MIN, scale))
        : 1;
    const appearance = item.__calendarAppearance === 'day' ? 'day' : 'default';
    const itemKind = item.calendarItemKind === 'chore' ? 'chore' : 'event';
    const usesChipChrome = itemKind === 'event' && (item.isAllDay || isSpanLayout);
    const isInteractive = draggableEnabled || typeof onClick === 'function';
    const occurrenceKey = useMemo(() => buildCalendarOccurrenceKey(item), [item]);
    const searchState = item.__liveSearchState === 'match' || item.__liveSearchState === 'dim' ? item.__liveSearchState : 'normal';
    const descriptionText = useMemo(() => String(item.description || '').replace(/\s+/g, ' ').trim(), [item.description]);
    const metaText = useMemo(
        () => String(item.__calendarMetaLabel || (appearance === 'day' ? '' : descriptionText)).replace(/\s+/g, ' ').trim(),
        [appearance, descriptionText, item.__calendarMetaLabel]
    );
    const showDescriptionRow = !isSpanLayout && !isYearLayout && metaText.length > 0;
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
                    contrastSurface: getReadableTextColor(color) === '#0F172A' ? '#000000' : '#FFFFFF',
                    photoUrl: getPhotoUrl((member as any).photoUrls, '64'),
                };
            })
            .filter(Boolean) as EventMemberIndicator[];
    }, [members]);
    const usesDotIndicators = memberIndicatorStyle === 'dot';
    const primaryMemberColor = memberIndicators[0]?.color || '#1D4ED8';
    const readableTextColor = getReadableTextColor(primaryMemberColor);
    const eventSurfaceStyle = useMemo(() => {
        if (appearance !== 'day') {
            return {
                opacity: isDragging ? 0.4 : 1,
                '--calendar-item-scale': String(effectiveScale),
            } as React.CSSProperties;
        }

        return {
            opacity: isDragging ? 0.4 : 1,
            '--calendar-item-scale': String(effectiveScale),
            '--calendar-day-event-primary': primaryMemberColor,
            '--calendar-day-event-outline': hexToRgbaString(primaryMemberColor, 0.72),
            '--calendar-day-event-bg': `linear-gradient(180deg, ${hexToRgbaString(primaryMemberColor, 0.42)}, ${hexToRgbaString(primaryMemberColor, 0.28)})`,
            '--calendar-day-event-text': readableTextColor,
            '--calendar-day-event-muted': readableTextColor === '#0F172A' ? 'rgba(15, 23, 42, 0.72)' : 'rgba(248, 250, 252, 0.84)',
            '--calendar-day-event-shadow': hexToRgbaString(primaryMemberColor, 0.18),
        } as React.CSSProperties;
    }, [appearance, effectiveScale, isDragging, primaryMemberColor, readableTextColor]);

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
            data-calendar-chip-surface={usesChipChrome ? 'chip' : 'plain'}
            data-calendar-selected={selected ? 'true' : 'false'}
            data-calendar-occurrence-key={occurrenceKey}
            data-calendar-appearance={appearance}
            data-calendar-search-state={searchState}
            style={eventSurfaceStyle}
            className={cn(
                styles.calendarItem,
                styles[itemKind],
                usesChipChrome ? styles.circled : styles.calendarItemPlain,
                !usesChipChrome && itemKind === 'event' && styles.eventPlain,
                !usesChipChrome && itemKind === 'chore' && styles.chorePlain,
                isInteractive ? styles.calendarItemInteractive : styles.calendarItemStatic,
                effectiveScale !== 1 && styles.calendarItemScaled,
                isYearLayout && styles.calendarItemYear,
                selected && styles.calendarItemSelected,
                selected && !usesChipChrome && styles.calendarItemPlainSelected,
                searchState === 'match' && styles.calendarItemSearchMatch,
                searchState === 'dim' && styles.calendarItemSearchDim,
                isSpanLayout && styles.eventSpan,
                isSpanLayout && continuesBefore && styles.eventSpanContinuesBefore,
                isSpanLayout && continuesAfter && styles.eventSpanContinuesAfter,
                appearance === 'day' && styles.dayEventCard,
                className
            )}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            title={item.title}
        >
            {appearance === 'day' ? (
                <>
                    <div className={styles.dayEventMemberRail} aria-hidden="true">
                        {(memberIndicators.length > 0 ? memberIndicators : [{ id: 'default', name: null, initials: '', color: primaryMemberColor, contrastSurface: readableTextColor }]).map((member) => (
                            <span
                                key={member.id}
                                className={styles.dayEventMemberRailSegment}
                                style={{ background: member.color }}
                            />
                        ))}
                    </div>
                    <div className={styles.dayEventCardBody}>
                        <div className={styles.dayEventCardTopRow}>
                            <div className={styles.dayEventCardTitleBlock}>
                                <div className={styles.dayEventCardTitle}>{item.title}</div>
                                {showDescriptionRow ? <div className={styles.dayEventCardMeta}>{metaText}</div> : null}
                            </div>
                            {memberIndicators.length > 0 ? (
                                <div className={styles.dayEventAvatarStack}>
                                    {memberIndicators.map((member) => (
                                        <Avatar
                                            key={member.id}
                                            className={styles.dayEventAvatar}
                                            style={
                                                {
                                                    '--calendar-day-avatar-border': member.color,
                                                    '--calendar-day-avatar-text': member.contrastSurface,
                                                } as React.CSSProperties
                                            }
                                        >
                                            {member.photoUrl ? <AvatarImage src={member.photoUrl} alt={member.name || 'Family member'} /> : null}
                                            <AvatarFallback className={styles.dayEventAvatarFallback}>{member.initials}</AvatarFallback>
                                        </Avatar>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </>
            ) : (
                <>
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
                                                '--calendar-member-indicator-contrast-surface': member.contrastSurface,
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
                    {showDescriptionRow ? <div className={styles.eventMetaText}>{metaText}</div> : null}
                </>
            )}
        </div>
    );
};
