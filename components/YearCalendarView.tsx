'use client';

import React, { useLayoutEffect, useMemo, useRef } from 'react';
import { format, getDate, getMonth } from 'date-fns';
import NepaliDate from 'nepali-date-converter';
import { DroppableDayCell } from '@/components/DroppableDayCell';
import CalendarWeekSpanOverlay, {
    getWeekSpanReservedHeightData,
    type CalendarWeekSpanSegmentLike,
} from '@/components/CalendarWeekSpanOverlay';
import { DraggableCalendarEvent, type CalendarItem } from '@/components/DraggableCalendarEvent';
import styles from '@/styles/Calendar.module.css';
import { formatCommonBsMonthLabel, toDevanagariDigits } from '@/lib/calendar-display';
import { type CalendarYearMonthBasis } from '@/lib/calendar-controls';
import { planYearShift, type YearShiftMonthSnapshot } from '@/lib/calendar-year-shift';
import { type YearCalendarMonthDescriptor, yearCalendarDateBelongsToMonth } from '@/lib/calendar-year-layout';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const YEAR_DAY_BASE_TOP_CHROME_PX = 12;
const YEAR_DAY_TRANSITION_MONTH_BONUS_PX = 8;
const YEAR_DAY_TRANSITION_YEAR_BONUS_PX = 6;
const YEAR_MORE_ROW_PX = 11;
const YEAR_EVENT_ROW_GAP_PX = 1;
const YEAR_SHIFT_ANIMATION_MS = 230;
const YEAR_SHIFT_ANIMATION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

interface YearCalendarViewProps {
    months: YearCalendarMonthDescriptor[];
    monthBasis: CalendarYearMonthBasis;
    dayItemsByDate: Map<string, CalendarItem[]>;
    weekSpanLanesByWeek: Map<string, CalendarWeekSpanSegmentLike[][]>;
    columns: number;
    dayCellHeight: number;
    chipScale: number;
    fontScale: number;
    shiftAnimation?: { key: number; direction: 'left' | 'right' } | null;
    displayBS: boolean;
    scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
    onDayClick: (day: Date) => void;
    onEventClick: (event: React.MouseEvent, item: CalendarItem) => void;
}

interface CapturedYearMonthSnapshot extends YearShiftMonthSnapshot {
    clone: HTMLElement;
}

const getScaledPx = (basePx: number, scale: number, minimumPx: number) => Math.max(minimumPx, Math.round(basePx * scale));

const getVisibleEventSlots = ({
    dayCellHeight,
    reservedHeight,
    totalItems,
    eventRowPx,
    eventGapPx,
    moreRowPx,
    showTransitionMonth,
    showTransitionYear,
}: {
    dayCellHeight: number;
    reservedHeight: number;
    totalItems: number;
    eventRowPx: number;
    eventGapPx: number;
    moreRowPx: number;
    showTransitionMonth: boolean;
    showTransitionYear: boolean;
}) => {
    const topChromePx =
        YEAR_DAY_BASE_TOP_CHROME_PX +
        (showTransitionMonth ? YEAR_DAY_TRANSITION_MONTH_BONUS_PX : 0) +
        (showTransitionYear ? YEAR_DAY_TRANSITION_YEAR_BONUS_PX : 0);
    const availableHeight = Math.max(0, dayCellHeight - topChromePx - reservedHeight);

    let slots = 0;
    let consumedHeight = 0;
    while (slots < totalItems) {
        const nextHeight = consumedHeight + (slots > 0 ? eventGapPx : 0) + eventRowPx;
        if (nextHeight > availableHeight) {
            break;
        }
        slots += 1;
        consumedHeight = nextHeight;
    }

    if (slots === 0 && totalItems > 0 && availableHeight >= eventRowPx) {
        slots = 1;
        consumedHeight = eventRowPx;
    }

    if (slots < totalItems && slots > 0 && consumedHeight + eventGapPx + moreRowPx > availableHeight) {
        slots -= 1;
    }

    return Math.max(0, slots);
};

const getDayMeta = (day: Date, monthBasis: CalendarYearMonthBasis, displayBS: boolean) => {
    const nepaliDate = new NepaliDate(day);
    const gregorianDate = getDate(day);
    const gregorianMonthIndex = getMonth(day);
    const gregorianYear = day.getFullYear();
    const bsDate = nepaliDate.getDate();
    const bsMonthIndex = nepaliDate.getMonth();
    const bsYear = nepaliDate.getYear();

    if (monthBasis === 'gregorian') {
        return {
            primaryLabel: String(gregorianDate),
            secondaryLabel: displayBS ? toDevanagariDigits(bsDate) : '',
            transitionMonthClassName: styles.nepaliMonthName,
            transitionMonthLabel: formatCommonBsMonthLabel(bsMonthIndex),
            showTransitionMonth: displayBS && bsDate === 1,
            transitionYearClassName: styles.nepaliYearNumber,
            transitionYearLabel: toDevanagariDigits(bsYear),
            showTransitionYear: displayBS && bsDate === 1 && bsMonthIndex === 0,
            firstTransitionDayClassName: styles.firstDayOfNepaliMonth,
            firstTransitionWeekClassName: styles.firstWeekOfNepaliMonth,
            firstTransitionYearClassName: styles.firstDayOfNepaliYear,
            isFirstTransitionDay: bsDate === 1,
            isFirstTransitionWeekButNotDay: bsDate >= 2 && bsDate <= 7,
            isFirstTransitionYear: bsDate === 1 && bsMonthIndex === 0,
        };
    }

    return {
        primaryLabel: toDevanagariDigits(bsDate),
        secondaryLabel: String(gregorianDate),
        transitionMonthClassName: styles.monthName,
        transitionMonthLabel: format(day, 'MMMM'),
        showTransitionMonth: gregorianDate === 1,
        transitionYearClassName: styles.yearNumber,
        transitionYearLabel: String(gregorianYear),
        showTransitionYear: gregorianDate === 1 && gregorianMonthIndex === 0,
        firstTransitionDayClassName: styles.firstDayOfMonth,
        firstTransitionWeekClassName: styles.firstWeekOfMonth,
        firstTransitionYearClassName: styles.firstDayOfYear,
        isFirstTransitionDay: gregorianDate === 1,
        isFirstTransitionWeekButNotDay: gregorianDate >= 2 && gregorianDate <= 7,
        isFirstTransitionYear: gregorianDate === 1 && gregorianMonthIndex === 0,
    };
};

const stripMonthCloneAttributes = (root: HTMLElement) => {
    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
    for (const element of elements) {
        element.removeAttribute('id');
        element.removeAttribute('data-testid');
        element.removeAttribute('data-calendar-month-key');
        element.removeAttribute('data-calendar-month-offset');
        element.removeAttribute('data-calendar-cell-date');
        element.setAttribute('aria-hidden', 'true');
        if ('tabIndex' in element) {
            element.tabIndex = -1;
        }
    }
};

const captureYearMonthSnapshots = ({
    grid,
    stage,
    columns,
}: {
    grid: HTMLDivElement;
    stage: HTMLDivElement;
    columns: number;
}): CapturedYearMonthSnapshot[] => {
    const stageRect = stage.getBoundingClientRect();
    const monthNodes = Array.from(grid.querySelectorAll<HTMLElement>('[data-calendar-month-key]'));

    return monthNodes
        .map((node, index) => {
            const key = node.dataset.calendarMonthKey;
            if (!key) {
                return null;
            }

            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) {
                return null;
            }

            const clone = node.cloneNode(true) as HTMLElement;
            stripMonthCloneAttributes(clone);

            return {
                key,
                rowIndex: Math.floor(index / columns),
                colIndex: index % columns,
                rect: {
                    top: rect.top - stageRect.top,
                    left: rect.left - stageRect.left,
                    width: rect.width,
                    height: rect.height,
                },
                clone,
            } satisfies CapturedYearMonthSnapshot;
        })
        .filter((snapshot): snapshot is CapturedYearMonthSnapshot => snapshot !== null);
};

export default function YearCalendarView({
    months,
    monthBasis,
    dayItemsByDate,
    weekSpanLanesByWeek,
    columns,
    dayCellHeight,
    chipScale,
    fontScale,
    shiftAnimation,
    displayBS,
    scrollContainerRef,
    onDayClick,
    onEventClick,
}: YearCalendarViewProps) {
    const effectiveEventFontScale = Math.max(0.6, Math.min(1, chipScale * fontScale));
    const eventGapPx = YEAR_EVENT_ROW_GAP_PX;
    const singleDayChipHeightPx = Math.max(11, Math.round(8 + effectiveEventFontScale * 6));
    const spanLaneHeightPx = singleDayChipHeightPx;
    const spanLaneGapPx = eventGapPx;
    const moreRowPx = Math.max(8, getScaledPx(YEAR_MORE_ROW_PX - 2, effectiveEventFontScale, 8));
    const spanTopOffsetPx = YEAR_DAY_BASE_TOP_CHROME_PX;
    const stageRef = useRef<HTMLDivElement>(null);
    const gridRef = useRef<HTMLDivElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const previousMonthSnapshotsRef = useRef<CapturedYearMonthSnapshot[]>([]);
    const lastAnimatedShiftKeyRef = useRef<number | null>(null);
    const animationCleanupTimerRef = useRef<number | null>(null);
    const animationFrameRef = useRef<number | null>(null);
    const scrollUnlockRef = useRef<(() => void) | null>(null);

    const gridStyle = useMemo(
        () =>
            ({
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                '--calendar-year-day-cell-height': `${dayCellHeight}px`,
                '--calendar-year-event-gap': `${eventGapPx}px`,
                '--calendar-year-event-font-scale': effectiveEventFontScale.toString(),
                '--calendar-year-single-event-height': `${singleDayChipHeightPx}px`,
                '--calendar-year-span-event-height': `${spanLaneHeightPx}px`,
            } as React.CSSProperties),
        [columns, dayCellHeight, effectiveEventFontScale, eventGapPx, singleDayChipHeightPx, spanLaneHeightPx]
    );

    const splitWeekSpanLanesForMonth = (
        month: YearCalendarMonthDescriptor,
        week: Date[],
        lanes: CalendarWeekSpanSegmentLike[][]
    ) => {
        const inMonthByCol = week.map((day) => yearCalendarDateBelongsToMonth(day, month));
        return lanes.map((lane) =>
            lane.flatMap((segment) => {
                const pieces: CalendarWeekSpanSegmentLike[] = [];
                let pieceStart = segment.startCol;
                let pieceInMonth = inMonthByCol[segment.startCol] ?? false;

                for (let col = segment.startCol + 1; col <= segment.endCol + 1; col += 1) {
                    const nextInMonth = col <= segment.endCol ? inMonthByCol[col] ?? false : pieceInMonth;
                    const shouldSplit = col > segment.endCol || nextInMonth !== pieceInMonth;
                    if (!shouldSplit) continue;

                    const pieceEnd = col - 1;
                    pieces.push({
                        ...segment,
                        segmentKey: `${segment.segmentKey}-${pieceStart}-${pieceEnd}`,
                        startCol: pieceStart,
                        endCol: pieceEnd,
                        continuesBefore: segment.continuesBefore || pieceStart > segment.startCol,
                        continuesAfter: segment.continuesAfter || pieceEnd < segment.endCol,
                        className: pieceInMonth ? undefined : styles.calendarItemCarryover,
                    });

                    pieceStart = col;
                    pieceInMonth = nextInMonth;
                }

                return pieces;
            })
        );
    };

    useLayoutEffect(() => {
        const stage = stageRef.current;
        const grid = gridRef.current;
        const overlay = overlayRef.current;
        if (!stage || !grid || !overlay) {
            return;
        }

        const clearAnimationSurface = () => {
            if (animationFrameRef.current !== null) {
                window.cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            if (animationCleanupTimerRef.current !== null) {
                window.clearTimeout(animationCleanupTimerRef.current);
                animationCleanupTimerRef.current = null;
            }
            scrollUnlockRef.current?.();
            scrollUnlockRef.current = null;
            overlay.replaceChildren();
            grid.style.visibility = '';
        };

        clearAnimationSurface();

        const nextMonthSnapshots = captureYearMonthSnapshots({
            grid,
            stage,
            columns,
        });
        const previousMonthSnapshots = previousMonthSnapshotsRef.current;
        previousMonthSnapshotsRef.current = nextMonthSnapshots;

        const shouldAnimate =
            Boolean(shiftAnimation) &&
            shiftAnimation?.key !== lastAnimatedShiftKeyRef.current &&
            previousMonthSnapshots.length > 0;

        if (!shouldAnimate) {
            if (shiftAnimation) {
                lastAnimatedShiftKeyRef.current = shiftAnimation.key;
            }
            return;
        }

        if (shiftAnimation) {
            lastAnimatedShiftKeyRef.current = shiftAnimation.key;
        }

        const animationPlan = planYearShift({
            previousSnapshots: previousMonthSnapshots,
            nextSnapshots: nextMonthSnapshots,
            columns,
            direction: shiftAnimation.direction,
            viewportWidth: stage.clientWidth,
        });

        if (!animationPlan || animationPlan.motions.length === 0) {
            return;
        }

        const previousSnapshotByKey = new Map(previousMonthSnapshots.map((snapshot) => [snapshot.key, snapshot] as const));
        const nextSnapshotByKey = new Map(nextMonthSnapshots.map((snapshot) => [snapshot.key, snapshot] as const));
        const animatedNodes: HTMLElement[] = [];

        for (const motion of animationPlan.motions) {
            const sourceSnapshot =
                motion.source === 'previous' ? previousSnapshotByKey.get(motion.key) : nextSnapshotByKey.get(motion.key);
            if (!sourceSnapshot) {
                continue;
            }

            const animatedNode = sourceSnapshot.clone.cloneNode(true) as HTMLElement;
            animatedNode.classList.add(styles.yearMonthCardGhost);
            animatedNode.style.left = `${motion.endRect.left}px`;
            animatedNode.style.top = `${motion.endRect.top}px`;
            animatedNode.style.width = `${motion.endRect.width}px`;
            animatedNode.style.height = `${motion.endRect.height}px`;
            animatedNode.style.transform = `translate(${motion.startRect.left - motion.endRect.left}px, ${
                motion.startRect.top - motion.endRect.top
            }px)`;
            animatedNode.style.zIndex = motion.phase === 'enter' ? '3' : motion.phase === 'exit' ? '2' : '1';
            overlay.appendChild(animatedNode);
            animatedNodes.push(animatedNode);
        }

        if (animatedNodes.length === 0) {
            overlay.replaceChildren();
            return;
        }

        const scrollViewport = scrollContainerRef?.current ?? null;
        if (scrollViewport) {
            const lockedScrollTop = scrollViewport.scrollTop;
            const restoreScrollPosition = () => {
                if (scrollViewport.scrollTop !== lockedScrollTop) {
                    scrollViewport.scrollTop = lockedScrollTop;
                }
            };

            const handleWheel = (event: WheelEvent) => {
                event.preventDefault();
                restoreScrollPosition();
            };

            const handleTouchMove = (event: TouchEvent) => {
                event.preventDefault();
                restoreScrollPosition();
            };

            const handleScroll = () => {
                restoreScrollPosition();
            };

            scrollViewport.addEventListener('wheel', handleWheel, { passive: false });
            scrollViewport.addEventListener('touchmove', handleTouchMove, { passive: false });
            scrollViewport.addEventListener('scroll', handleScroll, { passive: true });
            scrollUnlockRef.current = () => {
                scrollViewport.removeEventListener('wheel', handleWheel);
                scrollViewport.removeEventListener('touchmove', handleTouchMove);
                scrollViewport.removeEventListener('scroll', handleScroll);
            };
        }

        grid.style.visibility = 'hidden';
        overlay.getBoundingClientRect();

        animationFrameRef.current = window.requestAnimationFrame(() => {
            animationFrameRef.current = null;
            for (const node of animatedNodes) {
                node.style.transition = `transform ${YEAR_SHIFT_ANIMATION_MS}ms ${YEAR_SHIFT_ANIMATION_EASING}`;
                node.style.transform = 'translate(0px, 0px)';
            }
        });

        animationCleanupTimerRef.current = window.setTimeout(() => {
            clearAnimationSurface();
        }, YEAR_SHIFT_ANIMATION_MS + 48);

        return () => {
            clearAnimationSurface();
        };
    }, [columns, months, scrollContainerRef, shiftAnimation]);

    useLayoutEffect(() => {
        return () => {
            if (animationFrameRef.current !== null) {
                window.cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }
            if (animationCleanupTimerRef.current !== null) {
                window.clearTimeout(animationCleanupTimerRef.current);
                animationCleanupTimerRef.current = null;
            }
            scrollUnlockRef.current?.();
            scrollUnlockRef.current = null;
        };
    }, []);

    return (
        <div ref={stageRef} className={styles.yearCalendarStage}>
            <div ref={gridRef} className={styles.yearCalendarGrid} style={gridStyle}>
                {months.map((month) => (
                    <div
                        key={month.key}
                        data-testid={`year-month-${month.key}`}
                        data-calendar-month-offset={month.offset}
                        data-calendar-month-key={month.key}
                        className={styles.yearMonthCard}
                    >
                        <div className={styles.yearMonthHeader}>
                            {month.showYearLabel ? <div className={styles.yearMonthYear}>{month.yearLabel}</div> : null}
                            <div className={styles.yearMonthTitle}>{month.title}</div>
                        </div>

                        <table className={styles.yearMonthTable}>
                            <thead>
                                <tr>
                                    {WEEKDAY_LABELS.map((label) => (
                                        <th key={`${month.key}-${label}`} className={styles.yearMonthWeekdayCell}>
                                            {label}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {month.weeks.map((week, weekIndex) => {
                                    const weekKey = format(week[0], 'yyyy-MM-dd');
                                    const weekSpanLanes = splitWeekSpanLanesForMonth(month, week, weekSpanLanesByWeek.get(weekKey) || []);
                                    const { weekSpanReservedHeightsByCol } = getWeekSpanReservedHeightData(weekSpanLanes, {
                                        laneHeightPx: spanLaneHeightPx,
                                        laneGapPx: spanLaneGapPx,
                                    });

                                    return (
                                        <tr key={`${month.key}-week-${weekIndex}`} className={styles.yearWeekRow}>
                                            {week.map((day, dayIndex) => {
                                                const dayKey = format(day, 'yyyy-MM-dd');
                                                const inMonth = yearCalendarDateBelongsToMonth(day, month);
                                                const dayMeta = getDayMeta(day, monthBasis, displayBS);
                                                const dayItems = dayItemsByDate.get(dayKey) || [];
                                                const rawReservedHeight = weekSpanReservedHeightsByCol[dayIndex] || 0;
                                                const reservedHeight = rawReservedHeight > 0 ? rawReservedHeight + eventGapPx : 0;
                                                const visibleSlots = getVisibleEventSlots({
                                                    dayCellHeight,
                                                    reservedHeight,
                                                    totalItems: dayItems.length,
                                                    eventRowPx: singleDayChipHeightPx,
                                                    eventGapPx,
                                                    moreRowPx,
                                                    showTransitionMonth: dayMeta.showTransitionMonth,
                                                    showTransitionYear: dayMeta.showTransitionYear,
                                                });
                                                const visibleItems = dayItems.slice(0, visibleSlots);
                                                const hiddenCount = Math.max(0, dayItems.length - visibleItems.length);

                                                return (
                                                    <DroppableDayCell
                                                        key={`${month.key}-${dayKey}`}
                                                        day={day}
                                                        dateStr={dayKey}
                                                        onClick={onDayClick}
                                                        className={[
                                                            styles.yearDayCell,
                                                            !inMonth ? styles.yearDayCellOutsideMonth : '',
                                                            dayMeta.isFirstTransitionYear ? dayMeta.firstTransitionYearClassName : '',
                                                            dayMeta.isFirstTransitionDay ? dayMeta.firstTransitionDayClassName : '',
                                                            dayMeta.isFirstTransitionWeekButNotDay ? dayMeta.firstTransitionWeekClassName : '',
                                                        ]
                                                            .filter(Boolean)
                                                            .join(' ')}
                                                    >
                                                        {dayIndex === 0 && weekSpanLanes.length > 0 ? (
                                                            <CalendarWeekSpanOverlay
                                                                weekKey={`${month.key}-${weekKey}`}
                                                                weekSpanLanes={weekSpanLanes}
                                                                topOffsetPx={spanTopOffsetPx}
                                                                laneHeightPx={spanLaneHeightPx}
                                                                laneGapPx={spanLaneGapPx}
                                                                eventScale={effectiveEventFontScale}
                                                                onEventClick={onEventClick}
                                                            />
                                                        ) : null}

                                                        {dayMeta.showTransitionYear ? (
                                                            <div className={dayMeta.transitionYearClassName}>{dayMeta.transitionYearLabel}</div>
                                                        ) : null}
                                                        {dayMeta.showTransitionMonth ? (
                                                            <div className={dayMeta.transitionMonthClassName}>{dayMeta.transitionMonthLabel}</div>
                                                        ) : null}

                                                        <div className={styles.yearDayNumberWrap}>
                                                            <span className={`${styles.yearDayPrimary} ${!inMonth ? styles.yearDayMuted : ''}`}>
                                                                {dayMeta.primaryLabel}
                                                            </span>
                                                            {dayMeta.secondaryLabel ? (
                                                                <span className={`${styles.yearDaySecondary} ${!inMonth ? styles.yearDayMuted : ''}`}>
                                                                    {dayMeta.secondaryLabel}
                                                                </span>
                                                            ) : null}
                                                        </div>

                                                        {reservedHeight > 0 ? (
                                                            <div
                                                                className={styles.multiDayLaneSpacer}
                                                                style={{ height: `${reservedHeight}px` }}
                                                                aria-hidden="true"
                                                            />
                                                        ) : null}

                                                        {visibleItems.length > 0 ? (
                                                            <div
                                                                className={`${styles.yearDayEventStack}${
                                                                    reservedHeight <= 0 ? ` ${styles.dayEventStackWithTopGap}` : ''
                                                                }`}
                                                            >
                                                                {visibleItems.map((item, index) => (
                                                                    <DraggableCalendarEvent
                                                                        key={`${item.id}-${String(item.__displayDate || item.startDate)}-${index}`}
                                                                        item={item}
                                                                        index={index}
                                                                        layout="year"
                                                                        scale={effectiveEventFontScale}
                                                                        className={!inMonth ? styles.calendarItemCarryover : undefined}
                                                                        draggableEnabled={item.calendarItemKind !== 'chore'}
                                                                        onClick={
                                                                            item.calendarItemKind === 'chore'
                                                                                ? undefined
                                                                                : (event) => onEventClick(event, item)
                                                                        }
                                                                    />
                                                                ))}
                                                            </div>
                                                        ) : null}

                                                        {hiddenCount > 0 ? <div className={styles.yearDayMore}>+{hiddenCount} more</div> : null}
                                                    </DroppableDayCell>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ))}
            </div>
            <div ref={overlayRef} className={styles.yearShiftOverlay} aria-hidden="true" />
        </div>
    );
}
