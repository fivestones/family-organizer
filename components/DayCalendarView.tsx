'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import NepaliDate from 'nepali-date-converter';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { addDays, format, parseISO } from 'date-fns';
import styles from '@/styles/Calendar.module.css';
import { DraggableCalendarEvent, type CalendarItem } from '@/components/DraggableCalendarEvent';
import type { CalendarDraftSelection } from '@/components/AddEvent';
import { getCalendarDayViewSnapMinutes } from '@/lib/calendar-controls';

const DAY_VIEW_BUFFER_DAYS = 21;
const DAY_VIEW_HOUR_LABEL_WIDTH_PX = 74;
const DAY_VIEW_HEADER_HEIGHT_PX = 68;
const DAY_VIEW_ALL_DAY_LANE_HEIGHT_PX = 24;
const DAY_VIEW_ALL_DAY_LANE_GAP_PX = 4;
const DAY_VIEW_ALL_DAY_OVERFLOW_HEIGHT_PX = 18;
const DAY_VIEW_DEFAULT_START_HOUR = 7;
const DAY_VIEW_CREATION_DRAG_THRESHOLD_MINUTES = 10;

interface DayCalendarViewProps {
    anchorDate: Date;
    renderedDays: Date[];
    visibleDayCount: number;
    hourHeight: number;
    containerHeight: number | null;
    displayBS: boolean;
    items: CalendarItem[];
    verticalResetKey: number;
    onAnchorDateChange: (date: Date) => void;
    onBackgroundClick: () => void;
    onCreateDraft: (draft: CalendarDraftSelection) => void;
    onEventClick: (event: React.MouseEvent, item: CalendarItem) => void;
    onEventDoubleClick: (event: React.MouseEvent, item: CalendarItem) => void;
    onTimedResize: (args: {
        item: CalendarItem;
        nextStartDate: string;
        nextEndDate: string;
        input?: { altKey?: boolean; shiftKey?: boolean } | null;
    }) => void;
    isEventSelected: (item: CalendarItem) => boolean;
}

interface AllDaySegment {
    key: string;
    item: CalendarItem;
    startCol: number;
    endCol: number;
    continuesBefore: boolean;
    continuesAfter: boolean;
    chipOnly?: boolean;
}

interface TimedSegment {
    key: string;
    item: CalendarItem;
    dayKey: string;
    dayIndex: number;
    startMinute: number;
    endMinute: number;
    columnIndex: number;
    columnCount: number;
    continuesBefore: boolean;
    continuesAfter: boolean;
    displayItem: CalendarItem;
}

interface ResizeState {
    segmentKey: string;
    edge: 'start' | 'end';
    item: CalendarItem;
    originalStartMs: number;
    originalEndMs: number;
    dayStartMs: number;
    dayEndMs: number;
    startClientY: number;
    snapMinutes: number;
}

interface DraftState {
    dayKey: string;
    startMinute: number;
    endMinute: number;
}

function startOfDayDate(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function formatDayKey(date: Date) {
    return format(date, 'yyyy-MM-dd');
}

function parseEventStart(item: CalendarItem) {
    const parsed = parseISO(String(item.startDate || ''));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseEventEnd(item: CalendarItem) {
    const parsed = parseISO(String(item.endDate || ''));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatHourLabel(hour: number) {
    const normalized = ((hour % 24) + 24) % 24;
    const meridiem = normalized >= 12 ? 'PM' : 'AM';
    const twelveHour = normalized % 12 === 0 ? 12 : normalized % 12;
    return `${twelveHour} ${meridiem}`;
}

function clampNumber(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function snapMinute(minute: number, step: number) {
    return clampNumber(Math.round(minute / step) * step, 0, 24 * 60);
}

function dateAtMinute(day: Date, minute: number) {
    return new Date(startOfDayDate(day).getTime() + minute * 60 * 1000);
}

function determineAllDayLaneCap(containerHeight: number | null) {
    if (!containerHeight || containerHeight < 680) return 2;
    if (containerHeight < 940) return 3;
    return 4;
}

function assignSpanLanes<T extends { startCol: number; endCol: number }>(segments: T[]) {
    const sorted = [...segments].sort((left, right) => {
        const startDiff = left.startCol - right.startCol;
        if (startDiff !== 0) return startDiff;

        const widthDiff = right.endCol - left.endCol;
        if (widthDiff !== 0) return widthDiff;

        return 0;
    });

    const laneEndColumns: number[] = [];
    const lanes: T[][] = [];

    for (const segment of sorted) {
        let laneIndex = 0;
        while (laneIndex < laneEndColumns.length && laneEndColumns[laneIndex] >= segment.startCol) {
            laneIndex += 1;
        }

        laneEndColumns[laneIndex] = segment.endCol;
        if (!lanes[laneIndex]) {
            lanes[laneIndex] = [];
        }
        lanes[laneIndex].push(segment);
    }

    return lanes;
}

function layoutTimedSegmentsByDay(segments: Array<Omit<TimedSegment, 'columnIndex' | 'columnCount'>>) {
    const byDay = new Map<string, Array<Omit<TimedSegment, 'columnIndex' | 'columnCount'>>>();
    for (const segment of segments) {
        const existing = byDay.get(segment.dayKey);
        if (existing) {
            existing.push(segment);
        } else {
            byDay.set(segment.dayKey, [segment]);
        }
    }

    const positioned: TimedSegment[] = [];

    for (const daySegments of Array.from(byDay.values())) {
        const sorted = [...daySegments].sort((left, right) => {
            const startDiff = left.startMinute - right.startMinute;
            if (startDiff !== 0) return startDiff;

            const endDiff = left.endMinute - right.endMinute;
            if (endDiff !== 0) return endDiff;

            return String(left.item.title || '').localeCompare(String(right.item.title || ''));
        });

        let cluster: typeof sorted = [];
        let clusterEndMinute = -1;

        const flushCluster = () => {
            if (cluster.length === 0) return;

            const columnEnds: number[] = [];
            let maxColumnCount = 0;
            const working = cluster.map((segment) => {
                let columnIndex = 0;
                while (columnIndex < columnEnds.length && columnEnds[columnIndex] > segment.startMinute) {
                    columnIndex += 1;
                }
                columnEnds[columnIndex] = segment.endMinute;
                maxColumnCount = Math.max(maxColumnCount, columnIndex + 1);
                return { ...segment, columnIndex };
            });

            for (const segment of working) {
                positioned.push({
                    ...segment,
                    columnCount: Math.max(1, maxColumnCount),
                });
            }

            cluster = [];
            clusterEndMinute = -1;
        };

        for (const segment of sorted) {
            if (cluster.length === 0 || segment.startMinute < clusterEndMinute) {
                cluster.push(segment);
                clusterEndMinute = Math.max(clusterEndMinute, segment.endMinute);
            } else {
                flushCluster();
                cluster.push(segment);
                clusterEndMinute = segment.endMinute;
            }
        }

        flushCluster();
    }

    return positioned;
}

function DayViewDropAllDayCell({
    dateStr,
    day,
    children,
    onClick,
    onDoubleClick,
}: {
    dateStr: string;
    day: Date;
    children: React.ReactNode;
    onClick: () => void;
    onDoubleClick: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [isDraggedOver, setIsDraggedOver] = useState(false);

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        return dropTargetForElements({
            element,
            canDrop: ({ source }) => {
                const item = (source.data as { event?: CalendarItem }).event;
                return (source.data as { type?: string }).type === 'calendar-event' && Boolean(item?.isAllDay);
            },
            getData: () => ({
                type: 'calendar-all-day',
                surfaceKind: 'allDay',
                dateStr,
            }),
            getIsSticky: () => true,
            onDragEnter: () => setIsDraggedOver(true),
            onDragLeave: () => setIsDraggedOver(false),
            onDrop: () => setIsDraggedOver(false),
        });
    }, [dateStr]);

    return (
        <div
            ref={ref}
            data-testid={`day-view-all-day-${dateStr}`}
            className={`${styles.dayViewAllDayCell}${isDraggedOver ? ` ${styles.dragOverCell}` : ''}`}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            data-calendar-day-key={dateStr}
            data-calendar-day={formatDayKey(day)}
        >
            {children}
        </div>
    );
}

function DayViewTimedColumn({
    date,
    dayIndex,
    dayWidth,
    hourHeight,
    verticalScrollTop,
    snapMinutes,
    children,
    onBackgroundClick,
    onCreateDraft,
    onDraftStart,
    onDraftMove,
    onDraftEnd,
}: {
    date: Date;
    dayIndex: number;
    dayWidth: number;
    hourHeight: number;
    verticalScrollTop: number;
    snapMinutes: number;
    children: React.ReactNode;
    onBackgroundClick: () => void;
    onCreateDraft: (draft: CalendarDraftSelection) => void;
    onDraftStart: (dayKey: string, minute: number) => void;
    onDraftMove: (minute: number) => void;
    onDraftEnd: () => void;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const [isDraggedOver, setIsDraggedOver] = useState(false);
    const pointerStateRef = useRef<{ pointerId: number; startMinute: number; moved: boolean } | null>(null);
    const dateStr = formatDayKey(date);

    const minuteFromClientY = (clientY: number) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect) return 0;
        const rawMinute = ((clientY - rect.top + verticalScrollTop) / hourHeight) * 60;
        return snapMinute(rawMinute, snapMinutes);
    };

    useEffect(() => {
        const element = ref.current;
        if (!element) return;

        return dropTargetForElements({
            element,
            canDrop: ({ source }) => {
                const item = (source.data as { event?: CalendarItem }).event;
                return (source.data as { type?: string }).type === 'calendar-event' && Boolean(item && !item.isAllDay);
            },
            getData: ({ input }) => ({
                type: 'calendar-time-slot',
                surfaceKind: 'timed',
                dateStr,
                dayIndex,
                minuteOfDay: minuteFromClientY(input.clientY),
            }),
            getIsSticky: () => true,
            onDragEnter: () => setIsDraggedOver(true),
            onDragLeave: () => setIsDraggedOver(false),
            onDrop: () => setIsDraggedOver(false),
        });
    }, [dateStr, dayIndex, hourHeight, minuteFromClientY, snapMinutes, verticalScrollTop]);

    return (
        <div
            ref={ref}
            data-testid={`day-view-timed-column-${dateStr}`}
            className={`${styles.dayViewTimedColumn}${isDraggedOver ? ` ${styles.dragOverCell}` : ''}`}
            style={{ width: `${dayWidth}px` }}
            onClick={onBackgroundClick}
            onDoubleClick={(event) => {
                const minute = minuteFromClientY(event.clientY);
                const start = dateAtMinute(date, minute);
                const end = dateAtMinute(date, clampNumber(minute + 60, snapMinutes, 24 * 60));
                onCreateDraft({
                    start,
                    end,
                    isAllDay: false,
                });
            }}
            onPointerDown={(event) => {
                const target = event.target as HTMLElement | null;
                if (!target || target.closest('[data-calendar-event-wrapper="true"]')) {
                    return;
                }
                if (event.button !== 0) {
                    return;
                }

                const minute = minuteFromClientY(event.clientY);
                pointerStateRef.current = {
                    pointerId: event.pointerId,
                    startMinute: minute,
                    moved: false,
                };
                onDraftStart(dateStr, minute);
                (event.currentTarget as HTMLDivElement).setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
                const state = pointerStateRef.current;
                if (!state || state.pointerId !== event.pointerId) {
                    return;
                }
                const minute = minuteFromClientY(event.clientY);
                state.moved =
                    state.moved || Math.abs(minute - state.startMinute) >= Math.max(snapMinutes, DAY_VIEW_CREATION_DRAG_THRESHOLD_MINUTES);
                onDraftMove(minute);
            }}
            onPointerUp={(event) => {
                const state = pointerStateRef.current;
                if (!state || state.pointerId !== event.pointerId) {
                    return;
                }
                (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
                pointerStateRef.current = null;
                onDraftEnd();
            }}
            onPointerCancel={(event) => {
                const state = pointerStateRef.current;
                if (!state || state.pointerId !== event.pointerId) {
                    return;
                }
                (event.currentTarget as HTMLDivElement).releasePointerCapture(event.pointerId);
                pointerStateRef.current = null;
                onDraftEnd();
            }}
        >
            {children}
        </div>
    );
}

export default function DayCalendarView({
    anchorDate,
    renderedDays,
    visibleDayCount,
    hourHeight,
    containerHeight,
    displayBS,
    items,
    verticalResetKey,
    onAnchorDateChange,
    onBackgroundClick,
    onCreateDraft,
    onEventClick,
    onEventDoubleClick,
    onTimedResize,
    isEventSelected,
}: DayCalendarViewProps) {
    const topViewportRef = useRef<HTMLDivElement>(null);
    const bodyHorizontalViewportRef = useRef<HTMLDivElement>(null);
    const bodyVerticalScrollRef = useRef<HTMLDivElement>(null);
    const horizontalAnchorTimerRef = useRef<number | null>(null);
    const suppressAnchorSyncRef = useRef(false);
    const [viewportWidth, setViewportWidth] = useState(0);
    const [verticalScrollTop, setVerticalScrollTop] = useState(0);
    const [draftState, setDraftState] = useState<DraftState | null>(null);
    const [resizePreview, setResizePreview] = useState<{ segmentKey: string; startMs: number; endMs: number } | null>(null);
    const resizeStateRef = useRef<ResizeState | null>(null);
    const [now, setNow] = useState(() => new Date());

    const snapMinutes = useMemo(() => getCalendarDayViewSnapMinutes(hourHeight), [hourHeight]);
    const allDayLaneCap = useMemo(() => determineAllDayLaneCap(containerHeight), [containerHeight]);
    const dayWidth = useMemo(() => (viewportWidth > 0 ? viewportWidth / Math.max(1, visibleDayCount) : 280), [viewportWidth, visibleDayCount]);
    const totalTrackWidth = useMemo(() => renderedDays.length * dayWidth, [dayWidth, renderedDays.length]);
    const gridHeight = useMemo(() => 24 * hourHeight, [hourHeight]);
    const allDayVisibleHeight = useMemo(() => {
        const lanesHeight = allDayLaneCap * DAY_VIEW_ALL_DAY_LANE_HEIGHT_PX + Math.max(0, allDayLaneCap - 1) * DAY_VIEW_ALL_DAY_LANE_GAP_PX;
        return lanesHeight + DAY_VIEW_ALL_DAY_OVERFLOW_HEIGHT_PX;
    }, [allDayLaneCap]);
    const timedViewportHeight = useMemo(() => {
        const total = containerHeight ?? 680;
        return Math.max(220, total - DAY_VIEW_HEADER_HEIGHT_PX - allDayVisibleHeight);
    }, [allDayVisibleHeight, containerHeight]);
    const renderedDayMap = useMemo(
        () => new Map(renderedDays.map((day, index) => [formatDayKey(day), index] as const)),
        [renderedDays]
    );
    const visibleStartKey = formatDayKey(anchorDate);
    const visibleEndKey = formatDayKey(addDays(anchorDate, visibleDayCount - 1));

    useEffect(() => {
        const interval = window.setInterval(() => setNow(new Date()), 60 * 1000);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        const element = bodyHorizontalViewportRef.current;
        if (!element || typeof ResizeObserver === 'undefined') {
            setViewportWidth(element?.clientWidth ?? 0);
            return;
        }

        const updateSize = () => {
            setViewportWidth(element.clientWidth);
        };

        updateSize();
        const observer = new ResizeObserver(updateSize);
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useLayoutEffect(() => {
        const viewport = bodyHorizontalViewportRef.current;
        if (!viewport || dayWidth <= 0) return;

        suppressAnchorSyncRef.current = true;
        const nextScrollLeft = DAY_VIEW_BUFFER_DAYS * dayWidth;
        viewport.scrollLeft = nextScrollLeft;
        if (topViewportRef.current) {
            topViewportRef.current.scrollLeft = nextScrollLeft;
        }

        window.requestAnimationFrame(() => {
            suppressAnchorSyncRef.current = false;
        });
    }, [anchorDate, dayWidth]);

    useLayoutEffect(() => {
        const verticalScroller = bodyVerticalScrollRef.current;
        if (!verticalScroller) return;

        const nextTop = DAY_VIEW_DEFAULT_START_HOUR * hourHeight;
        verticalScroller.scrollTop = nextTop;
        setVerticalScrollTop(nextTop);
    }, [hourHeight, verticalResetKey]);

    useEffect(() => {
        return () => {
            if (horizontalAnchorTimerRef.current != null) {
                window.clearTimeout(horizontalAnchorTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const handleWindowPointerMove = (event: PointerEvent) => {
            const resizeState = resizeStateRef.current;
            if (!resizeState) return;

            const deltaMinutes = Math.round(((event.clientY - resizeState.startClientY) / hourHeight) * (60 / resizeState.snapMinutes)) * resizeState.snapMinutes;
            if (resizeState.edge === 'start') {
                const nextStartMs = clampNumber(
                    resizeState.originalStartMs + deltaMinutes * 60 * 1000,
                    resizeState.dayStartMs,
                    resizeState.originalEndMs - resizeState.snapMinutes * 60 * 1000
                );
                setResizePreview({
                    segmentKey: resizeState.segmentKey,
                    startMs: nextStartMs,
                    endMs: resizeState.originalEndMs,
                });
                return;
            }

            const nextEndMs = clampNumber(
                resizeState.originalEndMs + deltaMinutes * 60 * 1000,
                resizeState.originalStartMs + resizeState.snapMinutes * 60 * 1000,
                resizeState.dayEndMs
            );
            setResizePreview({
                segmentKey: resizeState.segmentKey,
                startMs: resizeState.originalStartMs,
                endMs: nextEndMs,
            });
        };

        const handleWindowPointerUp = (event: PointerEvent) => {
            const resizeState = resizeStateRef.current;
            if (!resizeState) return;

            const preview = resizePreview;
            resizeStateRef.current = null;
            if (!preview) {
                setResizePreview(null);
                return;
            }

            const startChanged = preview.startMs !== resizeState.originalStartMs;
            const endChanged = preview.endMs !== resizeState.originalEndMs;
            if (startChanged || endChanged) {
                onTimedResize({
                    item: resizeState.item,
                    nextStartDate: new Date(preview.startMs).toISOString(),
                    nextEndDate: new Date(preview.endMs).toISOString(),
                    input: {
                        altKey: event.altKey,
                        shiftKey: event.shiftKey,
                    },
                });
            }

            setResizePreview(null);
        };

        window.addEventListener('pointermove', handleWindowPointerMove);
        window.addEventListener('pointerup', handleWindowPointerUp);
        window.addEventListener('pointercancel', handleWindowPointerUp);
        return () => {
            window.removeEventListener('pointermove', handleWindowPointerMove);
            window.removeEventListener('pointerup', handleWindowPointerUp);
            window.removeEventListener('pointercancel', handleWindowPointerUp);
        };
    }, [hourHeight, onTimedResize, resizePreview]);

    const { allDayVisibleLanes, allDayOverflowByColumn, timedSegments } = useMemo(() => {
        const renderedStart = renderedDays[0] ? startOfDayDate(renderedDays[0]) : startOfDayDate(anchorDate);
        const renderedEnd = renderedDays[renderedDays.length - 1] ? startOfDayDate(renderedDays[renderedDays.length - 1]) : renderedStart;
        const allDaySegments: AllDaySegment[] = [];
        const timedBaseSegments: Array<Omit<TimedSegment, 'columnIndex' | 'columnCount'>> = [];

        for (const item of items) {
            const start = parseEventStart(item);
            const end = parseEventEnd(item);
            if (!start || !end || end.getTime() <= start.getTime()) {
                continue;
            }

            if (item.isAllDay) {
                const startDay = startOfDayDate(start);
                const endInclusive = startOfDayDate(new Date(end.getTime() - 1));
                const overlapsRendered = startDay.getTime() <= renderedEnd.getTime() && endInclusive.getTime() >= renderedStart.getTime();
                if (!overlapsRendered) continue;

                const spansFullyVisible = formatDayKey(startDay) >= visibleStartKey && formatDayKey(endInclusive) <= visibleEndKey;
                const firstVisibleDay = startDay.getTime() < renderedStart.getTime() ? renderedStart : startDay;
                const lastVisibleDay = endInclusive.getTime() > renderedEnd.getTime() ? renderedEnd : endInclusive;

                if (item.calendarItemKind === 'chore' || !spansFullyVisible || firstVisibleDay.getTime() === lastVisibleDay.getTime()) {
                    for (
                        let dayCursor = firstVisibleDay;
                        dayCursor.getTime() <= lastVisibleDay.getTime();
                        dayCursor = addDays(dayCursor, 1)
                    ) {
                        const dayKey = formatDayKey(dayCursor);
                        const dayIndex = renderedDayMap.get(dayKey);
                        if (dayIndex == null) continue;
                        allDaySegments.push({
                            key: `${item.id}-${dayKey}-chip`,
                            item: {
                                ...item,
                                __displayDate: dayKey,
                                __dragAnchorStartDate: dayKey,
                            },
                            startCol: dayIndex,
                            endCol: dayIndex,
                            continuesBefore: dayCursor.getTime() > startDay.getTime(),
                            continuesAfter: dayCursor.getTime() < endInclusive.getTime(),
                            chipOnly: true,
                        });
                    }
                    continue;
                }

                const startCol = renderedDayMap.get(formatDayKey(startDay));
                const endCol = renderedDayMap.get(formatDayKey(endInclusive));
                if (startCol == null || endCol == null) {
                    continue;
                }
                allDaySegments.push({
                    key: `${item.id}-${formatDayKey(startDay)}-${formatDayKey(endInclusive)}-span`,
                    item,
                    startCol,
                    endCol,
                    continuesBefore: false,
                    continuesAfter: false,
                });
                continue;
            }

            const firstDay = startOfDayDate(start);
            const lastDay = startOfDayDate(new Date(end.getTime() - 1));
            for (let dayCursor = firstDay; dayCursor.getTime() <= lastDay.getTime(); dayCursor = addDays(dayCursor, 1)) {
                const dayKey = formatDayKey(dayCursor);
                const dayIndex = renderedDayMap.get(dayKey);
                if (dayIndex == null) continue;

                const dayStartMs = dayCursor.getTime();
                const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
                const segmentStartMs = Math.max(start.getTime(), dayStartMs);
                const segmentEndMs = Math.min(end.getTime(), dayEndMs);
                if (segmentEndMs <= segmentStartMs) continue;

                const startMinute = clampNumber(Math.floor((segmentStartMs - dayStartMs) / 60000), 0, 24 * 60);
                const endMinute = clampNumber(Math.ceil((segmentEndMs - dayStartMs) / 60000), startMinute + 1, 24 * 60);

                timedBaseSegments.push({
                    key: `${item.id}-${dayKey}-${segmentStartMs}-${segmentEndMs}`,
                    item,
                    dayKey,
                    dayIndex,
                    startMinute,
                    endMinute,
                    continuesBefore: start.getTime() < dayStartMs,
                    continuesAfter: end.getTime() > dayEndMs,
                    displayItem: {
                        ...item,
                        __displayDate: dayKey,
                        __dragAnchorStartDate: new Date(segmentStartMs).toISOString(),
                    },
                });
            }
        }

        const allDayLanes = assignSpanLanes(allDaySegments);
        const overflowByColumn = Array.from({ length: renderedDays.length }, () => 0);
        for (let laneIndex = allDayLaneCap; laneIndex < allDayLanes.length; laneIndex += 1) {
            for (const segment of allDayLanes[laneIndex]) {
                for (let column = segment.startCol; column <= segment.endCol; column += 1) {
                    overflowByColumn[column] += 1;
                }
            }
        }

        return {
            allDayVisibleLanes: allDayLanes.slice(0, allDayLaneCap),
            allDayOverflowByColumn: overflowByColumn,
            timedSegments: layoutTimedSegmentsByDay(timedBaseSegments),
        };
    }, [allDayLaneCap, anchorDate, items, renderedDayMap, renderedDays, visibleEndKey, visibleStartKey]);

    const currentTimeIndicator = useMemo(() => {
        const todayKey = formatDayKey(now);
        const dayIndex = renderedDayMap.get(todayKey);
        if (dayIndex == null) return null;
        return {
            dayIndex,
            top: ((now.getHours() * 60 + now.getMinutes()) / 60) * hourHeight,
        };
    }, [hourHeight, now, renderedDayMap]);

    const handleHorizontalScroll = () => {
        const viewport = bodyHorizontalViewportRef.current;
        if (!viewport) return;

        if (topViewportRef.current) {
            topViewportRef.current.scrollLeft = viewport.scrollLeft;
        }

        if (suppressAnchorSyncRef.current) {
            return;
        }

        if (horizontalAnchorTimerRef.current != null) {
            window.clearTimeout(horizontalAnchorTimerRef.current);
        }

        horizontalAnchorTimerRef.current = window.setTimeout(() => {
            const activeViewport = bodyHorizontalViewportRef.current;
            if (!activeViewport || dayWidth <= 0) return;

            const snappedIndex = clampNumber(
                Math.round(activeViewport.scrollLeft / dayWidth),
                0,
                Math.max(0, renderedDays.length - visibleDayCount)
            );
            const snappedLeft = snappedIndex * dayWidth;
            if (Math.abs(activeViewport.scrollLeft - snappedLeft) > 1) {
                activeViewport.scrollTo({ left: snappedLeft, behavior: 'smooth' });
            }

            const nextAnchor = renderedDays[snappedIndex];
            if (nextAnchor && formatDayKey(nextAnchor) !== formatDayKey(anchorDate)) {
                onAnchorDateChange(startOfDayDate(nextAnchor));
            }
        }, 120);
    };

    const hourLabels = useMemo(() => Array.from({ length: 25 }, (_unused, hour) => hour), []);
    const timedHourLineBackground = useMemo(
        () => ({
            backgroundSize: `100% ${hourHeight}px`,
        }),
        [hourHeight]
    );
    const timedSubhourLineBackground = useMemo(() => {
        if (snapMinutes >= 15) return null;
        return {
            backgroundSize: `100% ${(hourHeight * snapMinutes) / 60}px`,
        };
    }, [hourHeight, snapMinutes]);

    return (
        <div className={styles.dayViewShell}>
            <div className={styles.dayViewTopRow}>
                <div className={styles.dayViewTimeHeaderSpacer} style={{ width: `${DAY_VIEW_HOUR_LABEL_WIDTH_PX}px` }}>
                    <div className={styles.dayViewTimeHeaderLabel}>Daily View</div>
                </div>
                <div ref={topViewportRef} className={styles.dayViewHorizontalViewport}>
                    <div className={styles.dayViewTrack} style={{ width: `${totalTrackWidth}px` }}>
                        <div className={styles.dayViewHeaderRow} style={{ height: `${DAY_VIEW_HEADER_HEIGHT_PX}px` }}>
                            {renderedDays.map((day) => {
                                const dateKey = formatDayKey(day);
                                const weekday = day.toLocaleDateString(undefined, { weekday: 'long' });
                                const gregorian = day.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
                                let bsLabel = '';
                                if (displayBS) {
                                    try {
                                        const nepaliDate = new NepaliDate(day);
                                        bsLabel = `${weekday} • ${nepaliDate.format('YYYY MMMM D', 'np')}`;
                                    } catch {
                                        bsLabel = weekday;
                                    }
                                }

                                return (
                                    <div
                                        key={`day-header-${dateKey}`}
                                        data-testid={`day-view-header-${dateKey}`}
                                        className={styles.dayViewHeaderCell}
                                        style={{ width: `${dayWidth}px` }}
                                    >
                                        <div className={styles.dayViewHeaderWeekday}>{weekday}</div>
                                        <div className={styles.dayViewHeaderGregorian}>{gregorian}</div>
                                        {displayBS ? <div className={styles.dayViewHeaderBs}>{bsLabel}</div> : null}
                                    </div>
                                );
                            })}
                        </div>

                        <div
                            className={styles.dayViewAllDayTrack}
                            style={{ height: `${allDayVisibleHeight}px` }}
                        >
                            {renderedDays.map((day, index) => {
                                const dateKey = formatDayKey(day);
                                return (
                                    <div
                                        key={`all-day-cell-wrap-${dateKey}`}
                                        className={styles.dayViewAllDayCellWrap}
                                        style={{ width: `${dayWidth}px` }}
                                    >
                                        <DayViewDropAllDayCell
                                            dateStr={dateKey}
                                            day={day}
                                            onClick={onBackgroundClick}
                                            onDoubleClick={() =>
                                                onCreateDraft({
                                                    start: startOfDayDate(day),
                                                    end: addDays(startOfDayDate(day), 1),
                                                    isAllDay: true,
                                                })
                                            }
                                        >
                                            {allDayOverflowByColumn[index] > 0 ? (
                                                <div className={styles.dayViewAllDayOverflow}>+{allDayOverflowByColumn[index]} more</div>
                                            ) : null}
                                        </DayViewDropAllDayCell>
                                    </div>
                                );
                            })}

                            <div className={styles.dayViewAllDayOverlay}>
                                {allDayVisibleLanes.map((lane, laneIndex) => (
                                    <div
                                        key={`all-day-lane-${laneIndex}`}
                                        className={styles.dayViewAllDayLane}
                                        style={{
                                            top: `${laneIndex * (DAY_VIEW_ALL_DAY_LANE_HEIGHT_PX + DAY_VIEW_ALL_DAY_LANE_GAP_PX)}px`,
                                            height: `${DAY_VIEW_ALL_DAY_LANE_HEIGHT_PX}px`,
                                        }}
                                    >
                                        {lane.map((segment) => (
                                            <div
                                                key={segment.key}
                                                className={styles.dayViewAllDaySegment}
                                                style={{
                                                    left: `${segment.startCol * dayWidth}px`,
                                                    width: `${(segment.endCol - segment.startCol + 1) * dayWidth}px`,
                                                }}
                                            >
                                                <DraggableCalendarEvent
                                                    item={segment.item}
                                                    index={laneIndex}
                                                    layout="span"
                                                    selected={isEventSelected(segment.item)}
                                                    continuesBefore={segment.continuesBefore}
                                                    continuesAfter={segment.continuesAfter}
                                                    draggableEnabled={segment.item.calendarItemKind !== 'chore'}
                                                    onClick={(event) => onEventClick(event, segment.item)}
                                                    onDoubleClick={(event) => onEventDoubleClick(event, segment.item)}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className={styles.dayViewBodyRow}>
                <div className={styles.dayViewTimeGutter} style={{ width: `${DAY_VIEW_HOUR_LABEL_WIDTH_PX}px`, height: `${timedViewportHeight}px` }}>
                    <div
                        className={styles.dayViewTimeGutterInner}
                        style={{
                            height: `${gridHeight}px`,
                            transform: `translateY(${-verticalScrollTop}px)`,
                        }}
                    >
                        {hourLabels.map((hour) => (
                            <div
                                key={`time-label-${hour}`}
                                className={styles.dayViewTimeLabel}
                                style={{ top: `${hour * hourHeight}px` }}
                            >
                                {formatHourLabel(hour)}
                            </div>
                        ))}
                    </div>
                </div>

                <div
                    ref={bodyHorizontalViewportRef}
                    className={styles.dayViewHorizontalViewport}
                    onScroll={handleHorizontalScroll}
                >
                    <div className={styles.dayViewTrack} style={{ width: `${totalTrackWidth}px` }}>
                        <div
                            ref={bodyVerticalScrollRef}
                            className={styles.dayViewVerticalScroller}
                            style={{ height: `${timedViewportHeight}px` }}
                            onScroll={(event) => setVerticalScrollTop(event.currentTarget.scrollTop)}
                        >
                            <div className={styles.dayViewTimedGrid} style={{ width: `${totalTrackWidth}px`, height: `${gridHeight}px` }}>
                                <div className={styles.dayViewHourLines} style={timedHourLineBackground} />
                                {timedSubhourLineBackground ? (
                                    <div className={styles.dayViewSubhourLines} style={timedSubhourLineBackground} />
                                ) : null}

                                <div className={styles.dayViewColumnsRow}>
                                    {renderedDays.map((day, index) => (
                                        <DayViewTimedColumn
                                            key={`timed-column-${formatDayKey(day)}`}
                                            date={day}
                                            dayIndex={index}
                                            dayWidth={dayWidth}
                                            hourHeight={hourHeight}
                                            verticalScrollTop={verticalScrollTop}
                                            snapMinutes={snapMinutes}
                                            onBackgroundClick={onBackgroundClick}
                                            onCreateDraft={onCreateDraft}
                                            onDraftStart={(dayKey, minute) => {
                                                setDraftState({ dayKey, startMinute: minute, endMinute: minute });
                                            }}
                                            onDraftMove={(minute) => {
                                                setDraftState((current) => (current ? { ...current, endMinute: minute } : current));
                                            }}
                                            onDraftEnd={() => {
                                                setDraftState((current) => {
                                                    if (!current) return null;
                                                    const startMinute = Math.min(current.startMinute, current.endMinute);
                                                    const endMinute = Math.max(current.startMinute, current.endMinute);
                                                    const draggedMinutes = endMinute - startMinute;
                                                    if (draggedMinutes >= Math.max(snapMinutes, DAY_VIEW_CREATION_DRAG_THRESHOLD_MINUTES)) {
                                                        const day = renderedDays[renderedDayMap.get(current.dayKey) || 0];
                                                        onCreateDraft({
                                                            start: dateAtMinute(day, startMinute),
                                                            end: dateAtMinute(day, Math.max(startMinute + snapMinutes, endMinute)),
                                                            isAllDay: false,
                                                        });
                                                    }
                                                    return null;
                                                });
                                            }}
                                        >
                                            {draftState && draftState.dayKey === formatDayKey(day) ? (
                                                <div
                                                    className={styles.dayViewDraftBlock}
                                                    style={{
                                                        top: `${(Math.min(draftState.startMinute, draftState.endMinute) / 60) * hourHeight}px`,
                                                        height: `${(Math.max(snapMinutes, Math.abs(draftState.endMinute - draftState.startMinute)) / 60) * hourHeight}px`,
                                                    }}
                                                />
                                            ) : null}
                                        </DayViewTimedColumn>
                                    ))}
                                </div>

                                {currentTimeIndicator ? (
                                    <div
                                        className={styles.dayViewCurrentTimeLine}
                                        style={{
                                            left: `${currentTimeIndicator.dayIndex * dayWidth}px`,
                                            top: `${currentTimeIndicator.top}px`,
                                            width: `${dayWidth}px`,
                                        }}
                                    />
                                ) : null}

                                {timedSegments.map((segment) => {
                                    const preview =
                                        resizePreview && resizePreview.segmentKey === segment.key && !segment.continuesBefore && !segment.continuesAfter
                                            ? resizePreview
                                            : null;
                                    const displayStartMinute = preview
                                        ? clampNumber((preview.startMs - startOfDayDate(parseISO(`${segment.dayKey}T00:00:00`)).getTime()) / 60000, 0, 24 * 60)
                                        : segment.startMinute;
                                    const displayEndMinute = preview
                                        ? clampNumber((preview.endMs - startOfDayDate(parseISO(`${segment.dayKey}T00:00:00`)).getTime()) / 60000, 1, 24 * 60)
                                        : segment.endMinute;

                                    return (
                                        <div
                                            key={segment.key}
                                            data-calendar-event-wrapper="true"
                                            className={styles.dayViewTimedEventWrapper}
                                            style={{
                                                left: `${segment.dayIndex * dayWidth + (segment.columnIndex / segment.columnCount) * dayWidth}px`,
                                                top: `${(displayStartMinute / 60) * hourHeight}px`,
                                                width: `${dayWidth / segment.columnCount}px`,
                                                height: `${Math.max(18, ((displayEndMinute - displayStartMinute) / 60) * hourHeight)}px`,
                                            }}
                                        >
                                            {!segment.continuesBefore && !segment.continuesAfter && segment.item.calendarItemKind !== 'chore' ? (
                                                <button
                                                    type="button"
                                                    aria-label={`Resize ${segment.item.title || 'event'} earlier`}
                                                    className={styles.dayViewResizeHandle}
                                                    onPointerDown={(event) => {
                                                        event.stopPropagation();
                                                        const start = parseEventStart(segment.item);
                                                        const end = parseEventEnd(segment.item);
                                                        if (!start || !end) return;
                                                        const dayStart = startOfDayDate(start).getTime();
                                                        resizeStateRef.current = {
                                                            edge: 'start',
                                                            segmentKey: segment.key,
                                                            item: segment.item,
                                                            originalStartMs: start.getTime(),
                                                            originalEndMs: end.getTime(),
                                                            dayStartMs: dayStart,
                                                            dayEndMs: dayStart + 24 * 60 * 60 * 1000,
                                                            startClientY: event.clientY,
                                                            snapMinutes,
                                                        };
                                                        setResizePreview({
                                                            segmentKey: segment.key,
                                                            startMs: start.getTime(),
                                                            endMs: end.getTime(),
                                                        });
                                                    }}
                                                />
                                            ) : null}

                                            <DraggableCalendarEvent
                                                item={segment.displayItem}
                                                index={segment.columnIndex}
                                                selected={isEventSelected(segment.item)}
                                                draggableEnabled={segment.item.calendarItemKind !== 'chore'}
                                                className={styles.dayViewTimedEventCard}
                                                onClick={(event) => onEventClick(event, segment.item)}
                                                onDoubleClick={(event) => onEventDoubleClick(event, segment.item)}
                                            />

                                            {!segment.continuesBefore && !segment.continuesAfter && segment.item.calendarItemKind !== 'chore' ? (
                                                <button
                                                    type="button"
                                                    aria-label={`Resize ${segment.item.title || 'event'} later`}
                                                    className={`${styles.dayViewResizeHandle} ${styles.dayViewResizeHandleBottom}`}
                                                    onPointerDown={(event) => {
                                                        event.stopPropagation();
                                                        const start = parseEventStart(segment.item);
                                                        const end = parseEventEnd(segment.item);
                                                        if (!start || !end) return;
                                                        const dayStart = startOfDayDate(start).getTime();
                                                        resizeStateRef.current = {
                                                            edge: 'end',
                                                            segmentKey: segment.key,
                                                            item: segment.item,
                                                            originalStartMs: start.getTime(),
                                                            originalEndMs: end.getTime(),
                                                            dayStartMs: dayStart,
                                                            dayEndMs: dayStart + 24 * 60 * 60 * 1000,
                                                            startClientY: event.clientY,
                                                            snapMinutes,
                                                        };
                                                        setResizePreview({
                                                            segmentKey: segment.key,
                                                            startMs: start.getTime(),
                                                            endMs: end.getTime(),
                                                        });
                                                    }}
                                                />
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export { DAY_VIEW_BUFFER_DAYS };
