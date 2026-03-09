'use client';

import React, { useMemo } from 'react';
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
import { type YearCalendarMonthDescriptor, yearCalendarDateBelongsToMonth } from '@/lib/calendar-year-layout';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const YEAR_DAY_BASE_TOP_CHROME_PX = 12;
const YEAR_DAY_TRANSITION_MONTH_BONUS_PX = 8;
const YEAR_DAY_TRANSITION_YEAR_BONUS_PX = 6;
const YEAR_MORE_ROW_PX = 11;
const YEAR_EVENT_ROW_PX = 16;
const YEAR_EVENT_ROW_GAP_PX = 2;
const YEAR_SPAN_TOP_OFFSET_PX = 15;

interface YearCalendarViewProps {
    months: YearCalendarMonthDescriptor[];
    monthBasis: CalendarYearMonthBasis;
    dayItemsByDate: Map<string, CalendarItem[]>;
    weekSpanLanesByWeek: Map<string, CalendarWeekSpanSegmentLike[][]>;
    columns: number;
    dayCellHeight: number;
    chipScale: number;
    fontScale: number;
    displayBS: boolean;
    onDayClick: (day: Date) => void;
    onEventClick: (event: React.MouseEvent, item: CalendarItem) => void;
}

const getScaledPx = (basePx: number, scale: number, minimumPx: number) => Math.max(minimumPx, Math.round(basePx * scale));

const getVisibleEventSlots = ({
    dayCellHeight,
    reservedHeight,
    totalItems,
    eventScale,
    showTransitionMonth,
    showTransitionYear,
}: {
    dayCellHeight: number;
    reservedHeight: number;
    totalItems: number;
    eventScale: number;
    showTransitionMonth: boolean;
    showTransitionYear: boolean;
}) => {
    const topChromePx =
        getScaledPx(YEAR_DAY_BASE_TOP_CHROME_PX, eventScale, 10) +
        (showTransitionMonth ? getScaledPx(YEAR_DAY_TRANSITION_MONTH_BONUS_PX, eventScale, 6) : 0) +
        (showTransitionYear ? getScaledPx(YEAR_DAY_TRANSITION_YEAR_BONUS_PX, eventScale, 5) : 0);
    const eventRowPx = getScaledPx(YEAR_EVENT_ROW_PX, eventScale, 11);
    const eventGapPx = getScaledPx(YEAR_EVENT_ROW_GAP_PX, eventScale, 1);
    const moreRowPx = getScaledPx(YEAR_MORE_ROW_PX, eventScale, 9);
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

export default function YearCalendarView({
    months,
    monthBasis,
    dayItemsByDate,
    weekSpanLanesByWeek,
    columns,
    dayCellHeight,
    chipScale,
    fontScale,
    displayBS,
    onDayClick,
    onEventClick,
}: YearCalendarViewProps) {
    const effectiveEventScale = Math.max(0.6, Math.min(1, chipScale * fontScale));
    const spanLaneHeightPx = getScaledPx(YEAR_EVENT_ROW_PX, effectiveEventScale, 11);
    const spanLaneGapPx = getScaledPx(YEAR_EVENT_ROW_GAP_PX, effectiveEventScale, 1);
    const spanTopOffsetPx = getScaledPx(YEAR_SPAN_TOP_OFFSET_PX, effectiveEventScale, 11);

    const gridStyle = useMemo(
        () =>
            ({
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                '--calendar-year-day-cell-height': `${dayCellHeight}px`,
                '--calendar-year-font-scale': effectiveEventScale.toString(),
            } as React.CSSProperties),
        [columns, dayCellHeight, effectiveEventScale]
    );

    return (
        <div className={styles.yearCalendarGrid} style={gridStyle}>
            {months.map((month) => (
                <div
                    key={month.key}
                    data-testid={`year-month-${month.key}`}
                    data-calendar-month-offset={month.offset}
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
                                const weekSpanLanes = weekSpanLanesByWeek.get(weekKey) || [];
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
                                            const reservedHeight = weekSpanReservedHeightsByCol[dayIndex] || 0;
                                            const visibleSlots = getVisibleEventSlots({
                                                dayCellHeight,
                                                reservedHeight,
                                                totalItems: dayItems.length,
                                                eventScale: effectiveEventScale,
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
                                                            eventScale={effectiveEventScale}
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
                                                                    scale={effectiveEventScale}
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
    );
}
