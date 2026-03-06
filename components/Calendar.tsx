'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from '../styles/Calendar.module.css';
import {
    addDays,
    addMonths,
    addWeeks,
    differenceInDays,
    endOfMonth,
    endOfWeek,
    format,
    getDate,
    getMonth,
    parseISO,
    startOfMonth,
    startOfWeek,
} from 'date-fns';
import { tx } from '@instantdb/react';
import NepaliDate from 'nepali-date-converter';
import AddEventForm from './AddEvent';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import localFont from 'next/font/local';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { DroppableDayCell } from './DroppableDayCell'; // Import new component
// Import the component and the interface
import { DraggableCalendarEvent, CalendarItem } from './DraggableCalendarEvent';
import { db } from '@/lib/db';
import {
    CALENDAR_COMMAND_EVENT,
    CALENDAR_DAY_HEIGHT_DEFAULT,
    CALENDAR_DAY_HEIGHT_MAX,
    CALENDAR_DAY_HEIGHT_MIN,
    CALENDAR_DAY_HEIGHT_STORAGE_KEY,
    CALENDAR_STATE_EVENT,
    CALENDAR_VISIBLE_WEEKS_MAX,
    CALENDAR_VISIBLE_WEEKS_MIN,
    type CalendarCommandDetail,
    type CalendarStateDetail,
} from '@/lib/calendar-controls';

const ebGaramond = localFont({
    src: '../public/fonts/EBGaramond-Regular.ttf',
    weight: '400',
    display: 'swap',
});

interface CalendarProps {
    currentDate?: Date;
    numWeeks?: number;
    displayBS?: boolean;
}

interface MonthLabel {
    key: string;
    gregorianMonth: string;
    gregorianYear: string;
    nepaliMonth: string;
    nepaliYearDevanagari: string;
}

interface PendingScrollAdjust {
    prevScrollTop: number;
    prevScrollHeight: number;
    anchorDateStr?: string | null;
    anchorOffset?: number | null;
}

const WEEK_STARTS_ON = 0;
const WEEKS_PER_LOAD = 8;
const MONTH_MEMORY_CAP = 240;
const MEMORY_CAP_WEEKS = Math.round((MONTH_MEMORY_CAP * 365.2425) / 12 / 7);
const MONTH_FADE_MS = 260;
const EDGE_TRIGGER_PX = 220;
const EDGE_LOAD_COOLDOWN_MS = 220;
const MONTH_BOX_HORIZONTAL_PADDING = 16;
const MONTH_BOX_VERTICAL_PADDING = 10;

const nepaliMonthsCommonRoman = ['Baisakh', 'Jeth', 'Asar', 'Saun', 'Bhadau', 'Asoj', 'Kattik', 'Mangsir', 'Poush', 'Magh', 'Phagun', 'Chait'];
const nepaliMonthsCommonDevanagari = ['वैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज', 'कात्तिक', 'मंसिर', 'पुष', 'माघ', 'फागुन', 'चैत'];
const devanagariDigits = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];

const toDevanagariDigits = (value: string | number) =>
    String(value).replace(/\d/g, (digit) => devanagariDigits[Number(digit)] ?? digit);

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const Calendar = ({ currentDate = new Date(), numWeeks = 5, displayBS = true }: CalendarProps) => {
    // TODO: add displayInNepali = false, displayInRoman = true, can both be true and it will show them both
    // add displayOfficialNepaliMonthNames = false, when false will give the short month names everybody uses
    // and displayMonthNumber = false, to display the month number as well as the name.
    const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedEvent, setSelectedEvent] = useState<CalendarItem | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [dayCellHeight, setDayCellHeight] = useState<number>(() => {
        if (typeof window === 'undefined') {
            return CALENDAR_DAY_HEIGHT_DEFAULT;
        }

        const stored = window.localStorage.getItem(CALENDAR_DAY_HEIGHT_STORAGE_KEY);
        if (!stored) {
            return CALENDAR_DAY_HEIGHT_DEFAULT;
        }

        const parsed = Number(stored);
        if (!Number.isFinite(parsed)) {
            return CALENDAR_DAY_HEIGHT_DEFAULT;
        }

        return clampNumber(Math.round(parsed), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX);
    });

    const initialWeeksPerSide = Math.max(6, numWeeks);
    const [rangeStart, setRangeStart] = useState<Date>(() =>
        startOfWeek(addWeeks(currentDate, -initialWeeksPerSide), { weekStartsOn: WEEK_STARTS_ON })
    );
    const [rangeEnd, setRangeEnd] = useState<Date>(() =>
        endOfWeek(addWeeks(currentDate, initialWeeksPerSide), { weekStartsOn: WEEK_STARTS_ON })
    );
    const [scrollContainerHeight, setScrollContainerHeight] = useState<number | null>(null);
    const [dayNumberStickyTop, setDayNumberStickyTop] = useState(0);
    const stickyMonthTop = 2;
    const [monthBoxSize, setMonthBoxSize] = useState<{ width: number; height: number } | null>(null);
    const [activeMonthLabel, setActiveMonthLabel] = useState<MonthLabel>(() => {
        // @ts-ignore - package has no strict Date typing
        const nepaliDate = new NepaliDate(currentDate);
        const nepaliMonth = nepaliDate.getMonth();
        const nepaliYear = String(nepaliDate.getYear());
        return {
            key: `${format(currentDate, 'yyyy-MM')}-${nepaliDate.getYear()}-${nepaliMonth}`,
            gregorianMonth: format(currentDate, 'MMMM'),
            gregorianYear: format(currentDate, 'yyyy'),
            nepaliMonth: `${nepaliMonthsCommonDevanagari[nepaliMonth]} (${nepaliMonthsCommonRoman[nepaliMonth]})`,
            nepaliYearDevanagari: toDevanagariDigits(nepaliYear),
        };
    });
    const [previousMonthLabel, setPreviousMonthLabel] = useState<MonthLabel | null>(null);
    const [isMonthTransitioning, setIsMonthTransitioning] = useState(false);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLTableSectionElement>(null);
    const pendingTopScrollAdjustRef = useRef<PendingScrollAdjust | null>(null);
    const expandLockRef = useRef(false);
    const monthFadeTimerRef = useRef<number | null>(null);
    const monthLabelRef = useRef<MonthLabel>(activeMonthLabel);
    const scrollRafRef = useRef<number | null>(null);
    const lastScrollTopRef = useRef<number | null>(null);
    const lastTopLoadAtRef = useRef(0);
    const lastBottomLoadAtRef = useRef(0);
    // const lastTopTriggerScrollTopRef = useRef<number>(Number.POSITIVE_INFINITY);
    // const lastBottomTriggerScrollTopRef = useRef<number>(Number.NEGATIVE_INFINITY);
    const activeMonthMeasureRef = useRef<HTMLDivElement>(null);
    const previousMonthMeasureRef = useRef<HTMLDivElement>(null);
    const pendingScrollToDateRef = useRef<string | null>(null);

    const buildMonthLabel = useCallback((date: Date): MonthLabel => {
        // @ts-ignore - package has no strict Date typing
        const nepaliDate = new NepaliDate(date);
        const nepaliMonth = nepaliDate.getMonth();
        const nepaliYear = String(nepaliDate.getYear());
        return {
            key: `${format(date, 'yyyy-MM')}-${nepaliDate.getYear()}-${nepaliMonth}`,
            gregorianMonth: format(date, 'MMMM'),
            gregorianYear: format(date, 'yyyy'),
            nepaliMonth: `${nepaliMonthsCommonDevanagari[nepaliMonth]} (${nepaliMonthsCommonRoman[nepaliMonth]})`,
            nepaliYearDevanagari: toDevanagariDigits(nepaliYear),
        };
    }, []);

    const renderMonthLabel = useCallback((label: MonthLabel) => {
        return (
            <div className={styles.stickyMonthLabel}>
                <div className={`${styles.stickyMonthLine} ${styles.stickyMonthMonthLine}`}>
                    <span>{label.gregorianMonth}</span>
                    <span className={styles.stickyMonthNepali}>{label.nepaliMonth}</span>
                </div>
                <div className={`${styles.stickyMonthLine} ${styles.stickyMonthYearLine}`}>
                    <span>{label.gregorianYear}</span>
                    <span className={styles.stickyMonthYearNepali}>{label.nepaliYearDevanagari}</span>
                </div>
            </div>
        );
    }, []);

    const scrollToDateStr = useCallback((dateStr: string, behavior: ScrollBehavior = 'smooth') => {
        const container = scrollContainerRef.current;
        if (!container) return false;

        const targetCell = container.querySelector<HTMLElement>(`[data-calendar-cell-date="${dateStr}"]`);
        if (!targetCell) return false;

        const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
        const targetTop = Math.max(0, targetCell.offsetTop - headerHeight - 8);
        container.scrollTo({ top: targetTop, behavior });
        return true;
    }, []);

    const recalculateMonthBoxSize = useCallback(() => {
        const activeRect = activeMonthMeasureRef.current?.getBoundingClientRect();
        const previousRect = previousMonthMeasureRef.current?.getBoundingClientRect();

        const baseWidth = Math.ceil(Math.max(activeRect?.width ?? 0, previousRect?.width ?? 0));
        const baseHeight = Math.ceil(Math.max(activeRect?.height ?? 0, previousRect?.height ?? 0));

        if (baseWidth === 0 || baseHeight === 0) {
            return;
        }

        const nextSize = {
            width: baseWidth + MONTH_BOX_HORIZONTAL_PADDING,
            height: baseHeight + MONTH_BOX_VERTICAL_PADDING,
        };

        setMonthBoxSize((previousSize) => {
            if (previousSize && previousSize.width === nextSize.width && previousSize.height === nextSize.height) {
            return previousSize;
            }
            return nextSize;
        });
    }, []);

    const days = useMemo(() => {
        const generatedDays: Date[] = [];
        let cursor = rangeStart;
        while (cursor.getTime() <= rangeEnd.getTime()) {
            generatedDays.push(cursor);
            cursor = addDays(cursor, 1);
        }
        return generatedDays;
    }, [rangeStart, rangeEnd]);

    const weeks = useMemo(() => {
        const generatedWeeks: Date[][] = [];
        for (let i = 0; i < days.length; i += 7) {
            generatedWeeks.push(days.slice(i, i + 7));
        }
        return generatedWeeks;
    }, [days]);

    const monthConditions = useMemo(() => {
        const bufferedStart = startOfMonth(addMonths(rangeStart, -1));
        const bufferedEnd = endOfMonth(addMonths(rangeEnd, 1));
        const monthsByYear = new Map<number, number[]>();
        let monthCursor = new Date(bufferedStart);

        while (monthCursor.getTime() <= bufferedEnd.getTime()) {
            const year = monthCursor.getFullYear();
            const month = monthCursor.getMonth() + 1;
            const existing = monthsByYear.get(year) || [];
            if (!existing.includes(month)) {
                existing.push(month);
                monthsByYear.set(year, existing);
            }
            monthCursor = addMonths(monthCursor, 1);
        }

        return Array.from(monthsByYear.entries()).map(([year, months]) => ({
            year,
            month: { in: months },
        }));
    }, [rangeStart, rangeEnd]);

    const capRangeByMemory = useCallback((start: Date, end: Date, direction: 'up' | 'down') => {
        let cappedStart = start;
        let cappedEnd = end;

        if (direction === 'down') {
            const minimumStart = startOfWeek(addWeeks(cappedEnd, -MEMORY_CAP_WEEKS), { weekStartsOn: WEEK_STARTS_ON });
            if (cappedStart.getTime() < minimumStart.getTime()) {
                cappedStart = minimumStart;
            }
        } else {
            const maximumEnd = endOfWeek(addWeeks(cappedStart, MEMORY_CAP_WEEKS), { weekStartsOn: WEEK_STARTS_ON });
            if (cappedEnd.getTime() > maximumEnd.getTime()) {
                cappedEnd = maximumEnd;
            }
        }

        return { cappedStart, cappedEnd };
    }, []);

    const captureTopScrollAnchor = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        let anchorDateStr: string | null = null;
        let anchorOffset: number | null = null;

        const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
        const containerTop = container.getBoundingClientRect().top;
        const scanLine = containerTop + headerHeight;

        const dayMarkers = Array.from(container.querySelectorAll<HTMLElement>('[data-calendar-cell-date]'));
        for (const marker of dayMarkers) {
            const rect = marker.getBoundingClientRect();
            if (rect.bottom > scanLine) {
                anchorDateStr = marker.dataset.calendarCellDate ?? null;
                anchorOffset = rect.top - containerTop;
                break;
            }
        }

        pendingTopScrollAdjustRef.current = {
            prevScrollTop: container.scrollTop,
            prevScrollHeight: container.scrollHeight,
            anchorDateStr,
            anchorOffset,
        };
    }, []);

    const expandRange = useCallback(
        (direction: 'up' | 'down') => {
            if (expandLockRef.current) {
                return;
            }

            expandLockRef.current = true;

            let nextStart = rangeStart;
            let nextEnd = rangeEnd;

            if (direction === 'up') {
                nextStart = startOfWeek(addWeeks(rangeStart, -WEEKS_PER_LOAD), { weekStartsOn: WEEK_STARTS_ON });
            } else {
                nextEnd = endOfWeek(addWeeks(rangeEnd, WEEKS_PER_LOAD), { weekStartsOn: WEEK_STARTS_ON });
            }

            const { cappedStart, cappedEnd } = capRangeByMemory(nextStart, nextEnd, direction);
            const topChanged = cappedStart.getTime() !== rangeStart.getTime();

            if (topChanged) {
                captureTopScrollAnchor();
            }

            setRangeStart(cappedStart);
            setRangeEnd(cappedEnd);

            window.requestAnimationFrame(() => {
                expandLockRef.current = false;
            });
        },
        [rangeStart, rangeEnd, capRangeByMemory, captureTopScrollAnchor]
    );

    const handleDayClick = (day: Date) => {
        setSelectedDate(day);
        setSelectedEvent(null);
        setIsModalOpen(true);
    };

    const handleEventClick = (e: React.MouseEvent, calendarEvent: CalendarItem) => {
        e.stopPropagation();
        setSelectedDate(parseISO(calendarEvent.startDate));
        setSelectedEvent(calendarEvent);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedDate(null);
        setSelectedEvent(null);
    };

    const setDayHeight = useCallback((nextHeight: number) => {
        const clampedHeight = clampNumber(Math.round(nextHeight), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX);
        setDayCellHeight(clampedHeight);
    }, []);

    const visibleWeeksEstimate = useMemo(() => {
        if (!scrollContainerHeight) {
            return 6;
        }
        const headerHeight = Math.max(0, dayNumberStickyTop - 2);
        const usableHeight = Math.max(1, scrollContainerHeight - headerHeight);
        return clampNumber(Math.round(usableHeight / dayCellHeight), CALENDAR_VISIBLE_WEEKS_MIN, CALENDAR_VISIBLE_WEEKS_MAX);
    }, [scrollContainerHeight, dayNumberStickyTop, dayCellHeight]);

    const applyVisibleWeeks = useCallback(
        (nextVisibleWeeks: number) => {
            const requestedWeeks = clampNumber(
                Math.round(nextVisibleWeeks),
                CALENDAR_VISIBLE_WEEKS_MIN,
                CALENDAR_VISIBLE_WEEKS_MAX
            );
            const container = scrollContainerRef.current;
            const headerHeight = headerRef.current?.getBoundingClientRect().height ?? Math.max(0, dayNumberStickyTop - 2);
            const viewportHeight = container?.clientHeight ?? scrollContainerHeight ?? 0;
            const usableHeight = Math.max(1, viewportHeight - headerHeight);
            setDayHeight(usableHeight / requestedWeeks);
        },
        [dayNumberStickyTop, scrollContainerHeight, setDayHeight]
    );

    const handleTodayClick = useCallback(() => {
        const today = new Date();
        const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayStr = format(normalizedToday, 'yyyy-MM-dd');

        if (scrollToDateStr(todayStr, 'smooth')) {
            return;
        }

        pendingTopScrollAdjustRef.current = null;
        pendingScrollToDateRef.current = todayStr;
        setRangeStart(startOfWeek(addWeeks(normalizedToday, -initialWeeksPerSide), { weekStartsOn: WEEK_STARTS_ON }));
        setRangeEnd(endOfWeek(addWeeks(normalizedToday, initialWeeksPerSide), { weekStartsOn: WEEK_STARTS_ON }));
    }, [initialWeeksPerSide, scrollToDateStr]);

    const handleQuickAddClick = useCallback(() => {
        const today = new Date();
        const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        setSelectedDate(normalizedToday);
        setSelectedEvent(null);
        setIsModalOpen(true);
    }, []);

    // Code to allow dragging items from one day to another
    useEffect(() => {
        const cleanup = monitorForElements({
            onDrop: (args) => {
                const { source, location } = args;
                const destination = location.current.dropTargets[0];

                const sourceData = source.data;
                const destData = destination?.data;

                if (!destination || sourceData.type !== 'calendar-event' || destData?.type !== 'calendar-day') {
                    return;
                }

                const event = sourceData.event as CalendarItem; // Get the event object
                const destinationDateStr = destData.dateStr as string; // Get the YYYY-MM-DD string

                const sourceDate = parseISO(event.isAllDay ? event.startDate : format(parseISO(event.startDate), 'yyyy-MM-dd'));
                const destinationDate = parseISO(destinationDateStr);
                const daysDifference = differenceInDays(destinationDate, sourceDate);

                if (daysDifference === 0) {
                    return;
                }

                let newStartDate, newEndDate;

                if (event.isAllDay) {
                    newStartDate = format(addDays(parseISO(event.startDate), daysDifference), 'yyyy-MM-dd');
                    newEndDate = format(addDays(parseISO(event.endDate), daysDifference), 'yyyy-MM-dd');
                } else {
                    newStartDate = addDays(parseISO(event.startDate), daysDifference).toISOString();
                    newEndDate = addDays(parseISO(event.endDate), daysDifference).toISOString();
                }

                const updatedItems = calendarItems.map((item) => (item.id === event.id ? { ...item, startDate: newStartDate, endDate: newEndDate } : item));
                setCalendarItems(updatedItems);

                db.transact([
                    tx.calendarItems[event.id].update({
                        startDate: newStartDate,
                        endDate: newEndDate,
                        year: destinationDate.getFullYear(),
                        month: destinationDate.getMonth() + 1,
                        dayOfMonth: destinationDate.getDate(),
                    }),
                ]);
            },
        });

        return cleanup;
    }, [calendarItems]);

    useLayoutEffect(() => {
        const pendingAdjust = pendingTopScrollAdjustRef.current;
        const container = scrollContainerRef.current;
        if (!pendingAdjust || !container) return;

        let adjusted = false;

        // 1. Try to anchor to the exact physical element we tracked
        if (pendingAdjust.anchorDateStr) {
            const anchorElement = container.querySelector<HTMLElement>(`[data-calendar-cell-date="${pendingAdjust.anchorDateStr}"]`);
            if (anchorElement) {
                const containerTop = container.getBoundingClientRect().top;
                const currentOffset = anchorElement.getBoundingClientRect().top - containerTop;
                const shift = currentOffset - pendingAdjust.anchorOffset;

                if (shift !== 0) {
                    container.scrollTop += shift;
                    adjusted = true;
                }
            }
        }

        // 2. Fallback to the old logic if the anchor element vanished (unlikely)
        if (!adjusted && pendingAdjust.prevScrollHeight) {
            const deltaHeight = container.scrollHeight - pendingAdjust.prevScrollHeight;
            container.scrollTop = Math.max(0, pendingAdjust.prevScrollTop + deltaHeight);
        }

        pendingTopScrollAdjustRef.current = null;
    }, [rangeStart, rangeEnd]);

    useLayoutEffect(() => {
        const syncContainerHeight = () => {
            const container = scrollContainerRef.current;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const remaining = window.innerHeight - rect.top - 8;
            setScrollContainerHeight(Math.max(360, Math.floor(remaining)));
            const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
            setDayNumberStickyTop(Math.max(0, Math.ceil(headerHeight) + 2));
        };

        syncContainerHeight();
        window.addEventListener('resize', syncContainerHeight);
        return () => window.removeEventListener('resize', syncContainerHeight);
    }, []);

    useLayoutEffect(() => {
        recalculateMonthBoxSize();
    }, [activeMonthLabel, previousMonthLabel, recalculateMonthBoxSize]);

    useEffect(() => {
        window.addEventListener('resize', recalculateMonthBoxSize);
        return () => window.removeEventListener('resize', recalculateMonthBoxSize);
    }, [recalculateMonthBoxSize]);

    const transitionToMonth = useCallback((nextMonth: MonthLabel) => {
        const current = monthLabelRef.current;
        if (current.key === nextMonth.key) {
            return;
        }

        setPreviousMonthLabel(current);
        setActiveMonthLabel(nextMonth);
        setIsMonthTransitioning(true);

        if (monthFadeTimerRef.current !== null) {
            window.clearTimeout(monthFadeTimerRef.current);
        }

        monthFadeTimerRef.current = window.setTimeout(() => {
            setPreviousMonthLabel(null);
            setIsMonthTransitioning(false);
            monthFadeTimerRef.current = null;
        }, MONTH_FADE_MS);

        monthLabelRef.current = nextMonth;
    }, []);

    const updateVisibleMonthFromScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
        const containerTop = container.getBoundingClientRect().top;
        const scanLine = containerTop + headerHeight + 8;
        const dayMarkers = Array.from(container.querySelectorAll<HTMLElement>('[data-calendar-cell-date]'));

        if (dayMarkers.length === 0) return;

        let activeMarker: HTMLElement | null = null;
        for (const marker of dayMarkers) {
            const rect = marker.getBoundingClientRect();
            if (rect.bottom >= scanLine) {
                activeMarker = marker;
                break;
            }
        }

        if (!activeMarker) {
            activeMarker = dayMarkers[dayMarkers.length - 1];
        }

        const dateStr = activeMarker.dataset.calendarCellDate;
        if (!dateStr) return;

        const visibleDate = parseISO(dateStr);
        if (Number.isNaN(visibleDate.getTime())) return;

        transitionToMonth(buildMonthLabel(visibleDate));
    }, [buildMonthLabel, transitionToMonth]);

    const expandRangeRef = useRef(expandRange);
    useEffect(() => {
        expandRangeRef.current = expandRange;
    }, [expandRange]);

    const updateVisibleMonthFromScrollRef = useRef(updateVisibleMonthFromScroll);
    useEffect(() => {
        updateVisibleMonthFromScrollRef.current = updateVisibleMonthFromScroll;
    }, [updateVisibleMonthFromScroll]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const onScroll = () => {
            if (scrollRafRef.current !== null) return;
            scrollRafRef.current = window.requestAnimationFrame(() => {
                scrollRafRef.current = null;
                
                updateVisibleMonthFromScrollRef.current(); 
                
                const activeContainer = scrollContainerRef.current;
                if (!activeContainer) return;

                const now = Date.now();
                const scrollTop = activeContainer.scrollTop;
                const previousScrollTop = lastScrollTopRef.current;
                const scrollDelta = previousScrollTop === null ? 0 : scrollTop - previousScrollTop;
                lastScrollTopRef.current = scrollTop;

                const nearTop = activeContainer.scrollTop <= EDGE_TRIGGER_PX;
                const nearBottom = activeContainer.scrollHeight - activeContainer.clientHeight - activeContainer.scrollTop <= EDGE_TRIGGER_PX;

                // Simplified Top Trigger
                if (nearTop && scrollDelta < 0) {
                    const cooldownElapsed = now - lastTopLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                    if (cooldownElapsed) {
                        lastTopLoadAtRef.current = now;
                        expandRangeRef.current('up'); 
                    }
                }

                // Simplified Bottom Trigger
                if (nearBottom && scrollDelta > 0) {
                    const cooldownElapsed = now - lastBottomLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                    if (cooldownElapsed) {
                        lastBottomLoadAtRef.current = now;
                        expandRangeRef.current('down'); 
                    }
                }
            });
        };

        const onWheel = (event: WheelEvent) => {
            const activeContainer = scrollContainerRef.current;
            if (!activeContainer) return;

            const now = Date.now();
            const nearTop = activeContainer.scrollTop <= EDGE_TRIGGER_PX;
            const nearBottom = activeContainer.scrollHeight - activeContainer.clientHeight - activeContainer.scrollTop <= EDGE_TRIGGER_PX;

            if (event.deltaY < 0 && nearTop) {
                const cooldownElapsed = now - lastTopLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                if (cooldownElapsed) {
                    lastTopLoadAtRef.current = now;
                    expandRangeRef.current('up');
                }
            }

            if (event.deltaY > 0 && nearBottom) {
                const cooldownElapsed = now - lastBottomLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                if (cooldownElapsed) {
                    lastBottomLoadAtRef.current = now;
                    expandRangeRef.current('down');
                }
            }
        };

        updateVisibleMonthFromScrollRef.current();
        lastScrollTopRef.current = container.scrollTop;
        container.addEventListener('scroll', onScroll, { passive: true });
        container.addEventListener('wheel', onWheel, { passive: true });

        return () => {
            container.removeEventListener('scroll', onScroll);
            container.removeEventListener('wheel', onWheel);
            if (scrollRafRef.current !== null) {
                window.cancelAnimationFrame(scrollRafRef.current);
                scrollRafRef.current = null;
            }
            // Do NOT reset lastScrollTopRef.current here anymore
        };
    }, []); // <-- Empty dependency array!

    useEffect(() => {
        updateVisibleMonthFromScroll();
    }, [weeks.length, updateVisibleMonthFromScroll]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(CALENDAR_DAY_HEIGHT_STORAGE_KEY, String(dayCellHeight));
    }, [dayCellHeight]);

    useEffect(() => {
        const detail: CalendarStateDetail = {
            dayHeight: dayCellHeight,
            visibleWeeks: visibleWeeksEstimate,
        };
        window.dispatchEvent(new CustomEvent<CalendarStateDetail>(CALENDAR_STATE_EVENT, { detail }));
    }, [dayCellHeight, visibleWeeksEstimate]);

    useEffect(() => {
        const onCalendarCommand = (event: Event) => {
            const detail = (event as CustomEvent<CalendarCommandDetail>).detail;
            if (!detail) return;

            if (detail.type === 'setDayHeight') {
                setDayHeight(detail.dayHeight);
                return;
            }

            if (detail.type === 'setVisibleWeeks') {
                applyVisibleWeeks(detail.visibleWeeks);
                return;
            }

            if (detail.type === 'scrollToday') {
                handleTodayClick();
                return;
            }

            if (detail.type === 'quickAdd') {
                handleQuickAddClick();
                return;
            }

            if (detail.type === 'requestState') {
                const stateDetail: CalendarStateDetail = {
                    dayHeight: dayCellHeight,
                    visibleWeeks: visibleWeeksEstimate,
                };
                window.dispatchEvent(new CustomEvent<CalendarStateDetail>(CALENDAR_STATE_EVENT, { detail: stateDetail }));
            }
        };

        window.addEventListener(CALENDAR_COMMAND_EVENT, onCalendarCommand);
        return () => {
            window.removeEventListener(CALENDAR_COMMAND_EVENT, onCalendarCommand);
        };
    }, [applyVisibleWeeks, dayCellHeight, handleQuickAddClick, handleTodayClick, setDayHeight, visibleWeeksEstimate]);

    useEffect(() => {
        const pendingDate = pendingScrollToDateRef.current;
        if (!pendingDate) return;

        if (scrollToDateStr(pendingDate, 'smooth')) {
            pendingScrollToDateRef.current = null;
        }
    }, [weeks.length, scrollToDateStr]);

    useEffect(() => {
        monthLabelRef.current = activeMonthLabel;
    }, [activeMonthLabel]);

    useEffect(() => {
        return () => {
            if (monthFadeTimerRef.current !== null) {
                window.clearTimeout(monthFadeTimerRef.current);
            }
        };
    }, []);

    const query = useMemo(
        () => ({
            calendarItems: {
                $: {
                    where: {
                        or: monthConditions,
                    },
                },
            },
        }),
        [monthConditions]
    );

    const queryResult = (db as any).useQuery(query) as any;
    const { isLoading, error, data } = queryResult;

    useEffect(() => {
        if (!isLoading && !error && data) {
            setCalendarItems(data.calendarItems as CalendarItem[]);
        }
    }, [isLoading, data, error]);

    const dayItemsByDate = useMemo(() => {
        const byDate = new Map<string, CalendarItem[]>();
        const rangeStartTime = rangeStart.getTime();
        const rangeEndTime = rangeEnd.getTime();

        const pushByDate = (dateKey: string, item: CalendarItem) => {
            const existing = byDate.get(dateKey);
            if (existing) {
                existing.push(item);
            } else {
                byDate.set(dateKey, [item]);
            }
        };

        for (const item of calendarItems) {
            if (item.isAllDay) {
                const start = parseISO(item.startDate);
                const exclusiveEnd = parseISO(item.endDate);
                if (Number.isNaN(start.getTime()) || Number.isNaN(exclusiveEnd.getTime())) {
                    continue;
                }

                let cursor = new Date(start);
                while (cursor.getTime() < exclusiveEnd.getTime()) {
                    const time = cursor.getTime();
                    if (time >= rangeStartTime && time <= rangeEndTime) {
                        pushByDate(format(cursor, 'yyyy-MM-dd'), item);
                    }
                    cursor = addDays(cursor, 1);
                }
            } else {
                const start = parseISO(item.startDate);
                if (Number.isNaN(start.getTime())) {
                    continue;
                }

                const time = start.getTime();
                if (time >= rangeStartTime && time <= rangeEndTime) {
                    pushByDate(format(start, 'yyyy-MM-dd'), item);
                }
            }
        }

        return byDate;
    }, [calendarItems, rangeStart, rangeEnd]);

    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let lastMonth: Date | null = null;
    let lastNepaliMonth: any = null;
    let isYearSet = false;
    let shouldDisplayBothYears = false;
    let shouldDisplayYear = false;
    let shouldDisplayNepaliYear = true;

    return (
        <>
            <div
                ref={scrollContainerRef}
                className={styles.calendarScrollContainer}
                style={
                    scrollContainerHeight
                        ? ({
                              height: `${scrollContainerHeight}px`,
                              '--calendar-day-number-top': `${dayNumberStickyTop}px`,
                              '--calendar-day-cell-height': `${dayCellHeight}px`,
                          } as React.CSSProperties)
                        : undefined
                }
            >
                <div className={styles.stickyMonthBox} style={{ top: `${stickyMonthTop}px` }}>
                    <div
                        className={styles.stickyMonthFrame}
                        style={monthBoxSize ? { width: `${monthBoxSize.width}px`, height: `${monthBoxSize.height}px` } : undefined}
                    >
                        <div ref={activeMonthMeasureRef} className={styles.stickyMonthMeasure}>
                            {renderMonthLabel(activeMonthLabel)}
                        </div>
                        {previousMonthLabel && (
                            <div ref={previousMonthMeasureRef} className={styles.stickyMonthMeasure}>
                                {renderMonthLabel(previousMonthLabel)}
                            </div>
                        )}
                        {previousMonthLabel && (
                            <div className={`${styles.stickyMonthText} ${isMonthTransitioning ? styles.monthFadeOut : ''}`}>
                                {renderMonthLabel(previousMonthLabel)}
                            </div>
                        )}
                        <div className={`${styles.stickyMonthText} ${isMonthTransitioning ? styles.monthFadeIn : styles.monthStatic}`}>
                            {renderMonthLabel(activeMonthLabel)}
                        </div>
                    </div>
                </div>

                <table className={styles.calendarTable}>
                    <thead ref={headerRef} className={ebGaramond.className}>
                        <tr>
                            {daysOfWeek.map((day, index) => (
                                <th key={index} className={styles.headerCell}>
                                    {day}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {weeks.map((week, weekIndex) => (
                            <tr key={format(week[0], 'yyyy-MM-dd')}>
                                {week.map((day, dayIndex) => {
                                    // @ts-ignore
                                    const nepaliDate = new NepaliDate(day);
                                    const currentMonth = format(day, 'MMMM');
                                    const isFirstDayOfMonth = getDate(day) === 1;
                                    const isFirstWeekOfMonthButNotFirstDay =
                                        getDate(day) === 2 ||
                                        getDate(day) === 3 ||
                                        getDate(day) === 4 ||
                                        getDate(day) === 5 ||
                                        getDate(day) === 6 ||
                                        getDate(day) === 7;
                                    const isFirstDayOfYear = getDate(day) === 1 && getMonth(day) === 0;
                                    const year = format(day, 'yyyy');
                                    const nepaliYear = nepaliDate.format('YYYY');
                                shouldDisplayBothYears = false;
                                const dateStr = format(day, 'yyyy-MM-dd');

                                const isFirstDayOfNepaliMonth = nepaliDate.getDate() === 1;
                                const isFirstWeekOfNepaliMonthButNotFirstDay =
                                    nepaliDate.getDate() === 2 ||
                                    nepaliDate.getDate() === 3 ||
                                    nepaliDate.getDate() === 4 ||
                                    nepaliDate.getDate() === 5 ||
                                    nepaliDate.getDate() === 6 ||
                                    nepaliDate.getDate() === 7;
                                const isFirstDayOfNepaliYear = nepaliDate.getDate() === 1 && nepaliDate.getMonth() === 0;

                                shouldDisplayYear = (!isYearSet && dayIndex === 0 && weekIndex === 0) || isFirstDayOfYear;
                                if (shouldDisplayYear) {
                                    isYearSet = true;
                                }

                                shouldDisplayNepaliYear = displayBS && ((dayIndex === 0 && weekIndex === 0) || isFirstDayOfNepaliYear);

                                if (shouldDisplayYear && shouldDisplayNepaliYear) {
                                    shouldDisplayBothYears = true;
                                    shouldDisplayYear = false;
                                    shouldDisplayNepaliYear = false;
                                }

                                const displayMonthName = !lastMonth || getMonth(day) !== getMonth(lastMonth);
                                if (displayMonthName) {
                                    lastMonth = day;
                                }

                                let displayNepaliMonthName = false;
                                if (displayBS) {
                                    if (!lastNepaliMonth || nepaliDate.getMonth() !== lastNepaliMonth.getMonth()) {
                                        displayNepaliMonthName = true;
                                    }
                                    if (displayNepaliMonthName) {
                                        lastNepaliMonth = nepaliDate;
                                    }
                                }

                                    const dayItems = dayItemsByDate.get(dateStr) || [];

                                    return (
                                        <DroppableDayCell
                                            key={dateStr}
                                            day={day}
                                            dateStr={dateStr}
                                            onClick={handleDayClick}
                                            className={`${styles.dayCell} ${isFirstDayOfYear ? styles.firstDayOfYear : ''} ${
                                                isFirstDayOfMonth ? styles.firstDayOfMonth : ''
                                            } ${isFirstWeekOfMonthButNotFirstDay ? styles.firstWeekOfMonth : ''} ${
                                                displayBS && isFirstDayOfNepaliYear ? styles.firstDayOfNepaliYear : ''
                                            } ${displayBS && isFirstDayOfNepaliMonth ? styles.firstDayOfNepaliMonth : ''} ${
                                                displayBS && isFirstWeekOfNepaliMonthButNotFirstDay ? styles.firstWeekOfNepaliMonth : ''
                                            }`}
                                        >
                                            {shouldDisplayYear && <div className={styles.yearNumber}>{year}</div>}
                                            {shouldDisplayNepaliYear && <div className={styles.nepaliYearNumber}>{nepaliYear}</div>}
                                            {shouldDisplayBothYears && (
                                                <div className={styles.yearNumber}>
                                                    {year} / {nepaliYear}
                                                </div>
                                            )}
                                            {displayMonthName && <div className={styles.monthName}>{currentMonth}</div>}
                                            {displayNepaliMonthName && (
                                                <div className={styles.nepaliMonthName}>
                                                    {nepaliMonthsCommonDevanagari[nepaliDate.getMonth()] +
                                                        ' (' +
                                                        nepaliMonthsCommonRoman[nepaliDate.getMonth()] +
                                                        ')'}
                                                </div>
                                            )}
                                            <div className={styles.dayNumber} data-calendar-date={dateStr}>
                                                {format(day, 'd')} {displayBS ? ' / ' + nepaliDate.format('D', 'np') : ''}
                                            </div>

                                            {dayItems.map((item, index) => (
                                                <DraggableCalendarEvent key={item.id} item={item} index={index} onClick={(e) => handleEventClick(e, item)} />
                                            ))}
                                        </DroppableDayCell>
                                    );
                                })}
                            </tr>
                        ))}

                    </tbody>
                </table>
            </div>

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent>
                    <AddEventForm selectedDate={selectedDate} selectedEvent={selectedEvent} onClose={handleCloseModal} />
                </DialogContent>
            </Dialog>
        </>
    );
};

export default Calendar;
