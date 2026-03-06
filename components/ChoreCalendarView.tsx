import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getChoreAssignmentGridFromChore, toUTCDate } from '@/lib/chore-utils';
import { cn } from '@/lib/utils';
import { useDebouncedCallback } from 'use-debounce';

type DotStatus = 'completed' | 'missed' | 'future';

function getDotStatus(
  assignment: { assigned: boolean; completed: boolean } | undefined,
  date: Date,
  today: Date
): DotStatus | null {
  if (!assignment?.assigned) return null;
  if (assignment.completed) return 'completed';
  return date.getTime() > today.getTime() ? 'future' : 'missed';
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getTime() === b.getTime();
}

const DOT_CLASSES: Record<DotStatus, string> = {
  completed: 'bg-green-500',
  missed: 'bg-orange-500',
  future: 'bg-gray-300',
};

const ChoreCalendarView: React.FC<{ chore: any }> = ({ chore }) => {
  const today = useMemo(() => toUTCDate(new Date()), []);

  const [dateAssignments, setDateAssignments] = useState<Record<string, Record<string, { assigned: boolean; completed: boolean }>>>({});
  const [dates, setDates] = useState<Date[]>([]);
  const [familyMembers, setFamilyMembers] = useState<any[]>([]);
  const [rangeStart, setRangeStart] = useState<Date | null>(null);
  const [rangeEnd, setRangeEnd] = useState<Date | null>(null);
  const [choreStartDate, setChoreStartDate] = useState<Date | null>(null);
  const [atLeftBoundary, setAtLeftBoundary] = useState(false);
  const [loadingLeft, setLoadingLeft] = useState(false);
  const [loadingRight, setLoadingRight] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const todayColRef = useRef<HTMLTableCellElement>(null);
  const hasScrolledToToday = useRef(false);
  const pendingScrollAdjust = useRef<{ prevScrollLeft: number; prevScrollWidth: number } | null>(null);
  const observersReady = useRef(false);

  // Derive months from dates
  const months = useMemo(() => {
    const monthMap = new Map<string, { key: string; monthName: string; dates: Date[] }>();
    dates.forEach(date => {
      const monthKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
      let month = monthMap.get(monthKey);
      if (!month) {
        month = {
          key: monthKey,
          monthName: date.toLocaleString('default', { month: 'short', timeZone: 'UTC' }),
          dates: [],
        };
        monthMap.set(monthKey, month);
      }
      month.dates.push(date);
    });
    return Array.from(monthMap.values());
  }, [dates]);

  // Generate a dates array between two dates (inclusive)
  const generateDatesArray = useCallback((start: Date, end: Date): Date[] => {
    const arr: Date[] = [];
    const current = new Date(start);
    while (current <= end) {
      arr.push(toUTCDate(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }
    return arr;
  }, []);

  // Extract family members from chore (only on chore change)
  useEffect(() => {
    const members = (chore.assignments && chore.assignments.length > 0)
      ? chore.assignments.filter((a: any) => a?.familyMember).map((a: any) => a.familyMember)
      : (chore.assignees || []).filter(Boolean);
    setFamilyMembers(members);
  }, [chore]);

  // Initial load: compute range and grid data
  useEffect(() => {
    const choreStart = toUTCDate(chore.startDate);
    const oneMonthAgo = toUTCDate(new Date());
    oneMonthAgo.setUTCMonth(oneMonthAgo.getUTCMonth() - 1);
    const initialStart = choreStart.getTime() > oneMonthAgo.getTime() ? choreStart : oneMonthAgo;

    const threeMonthsForward = toUTCDate(new Date());
    threeMonthsForward.setUTCMonth(threeMonthsForward.getUTCMonth() + 3);

    setChoreStartDate(choreStart);
    setRangeStart(initialStart);
    setRangeEnd(threeMonthsForward);
    setAtLeftBoundary(initialStart.getTime() <= choreStart.getTime());
    hasScrolledToToday.current = false;
    observersReady.current = false;

    (async () => {
      const assignments = await getChoreAssignmentGridFromChore(chore, initialStart, threeMonthsForward);
      setDateAssignments(assignments);
      setDates(generateDatesArray(initialStart, threeMonthsForward));
    })();
  }, [chore, generateDatesArray]);

  // Auto-scroll to today on initial render
  useLayoutEffect(() => {
    if (!hasScrolledToToday.current && todayColRef.current && scrollContainerRef.current && dates.length > 0) {
      todayColRef.current.scrollIntoView({ inline: 'center', block: 'nearest' });
      hasScrolledToToday.current = true;
      // Enable observers after a short delay to avoid immediate triggering
      requestAnimationFrame(() => {
        observersReady.current = true;
      });
    }
  }, [dates]);

  // Scroll position preservation on left expansion
  useLayoutEffect(() => {
    if (pendingScrollAdjust.current && scrollContainerRef.current) {
      const { prevScrollLeft, prevScrollWidth } = pendingScrollAdjust.current;
      const newScrollWidth = scrollContainerRef.current.scrollWidth;
      const widthAdded = newScrollWidth - prevScrollWidth;
      scrollContainerRef.current.scrollLeft = prevScrollLeft + widthAdded;
      pendingScrollAdjust.current = null;
    }
  }, [dates]);

  // Expand range in a given direction
  const expandRange = useCallback(async (direction: 'left' | 'right') => {
    if (!rangeStart || !rangeEnd || !choreStartDate) return;

    if (direction === 'left') {
      if (atLeftBoundary || loadingLeft) return;
      setLoadingLeft(true);

      const newStart = new Date(rangeStart);
      newStart.setUTCMonth(newStart.getUTCMonth() - 1);
      const clamped = newStart.getTime() < choreStartDate.getTime() ? choreStartDate : toUTCDate(newStart);

      if (clamped.getTime() >= rangeStart.getTime()) {
        setAtLeftBoundary(true);
        setLoadingLeft(false);
        return;
      }

      // Capture scroll position before prepending
      if (scrollContainerRef.current) {
        pendingScrollAdjust.current = {
          prevScrollLeft: scrollContainerRef.current.scrollLeft,
          prevScrollWidth: scrollContainerRef.current.scrollWidth,
        };
      }

      const endForSegment = new Date(rangeStart);
      endForSegment.setUTCDate(endForSegment.getUTCDate() - 1);
      const newAssignments = await getChoreAssignmentGridFromChore(chore, clamped, endForSegment);
      const newDates = generateDatesArray(clamped, endForSegment);

      setDates(prev => [...newDates, ...prev]);
      setDateAssignments(prev => ({ ...newAssignments, ...prev }));
      setRangeStart(clamped);
      setAtLeftBoundary(clamped.getTime() <= choreStartDate.getTime());
      setLoadingLeft(false);
    } else {
      if (loadingRight) return;
      setLoadingRight(true);

      const newEnd = toUTCDate(new Date(rangeEnd));
      newEnd.setUTCMonth(newEnd.getUTCMonth() + 1);

      const startForSegment = new Date(rangeEnd);
      startForSegment.setUTCDate(startForSegment.getUTCDate() + 1);
      const newAssignments = await getChoreAssignmentGridFromChore(chore, toUTCDate(startForSegment), newEnd);
      const newDates = generateDatesArray(toUTCDate(startForSegment), newEnd);

      setDates(prev => [...prev, ...newDates]);
      setDateAssignments(prev => ({ ...prev, ...newAssignments }));
      setRangeEnd(newEnd);
      setLoadingRight(false);
    }
  }, [rangeStart, rangeEnd, choreStartDate, atLeftBoundary, loadingLeft, loadingRight, chore, generateDatesArray]);

  const debouncedExpandLeft = useDebouncedCallback(() => expandRange('left'), 200);
  const debouncedExpandRight = useDebouncedCallback(() => expandRange('right'), 200);

  // IntersectionObserver for sentinel elements
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || dates.length === 0) return;

    const leftSentinel = container.querySelector('[data-sentinel="left"]');
    const rightSentinel = container.querySelector('[data-sentinel="right"]');
    if (!leftSentinel || !rightSentinel) return;

    const leftObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && observersReady.current) {
          debouncedExpandLeft();
        }
      },
      { root: container, rootMargin: '0px 0px 0px 100px', threshold: 0 }
    );

    const rightObserver = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && observersReady.current) {
          debouncedExpandRight();
        }
      },
      { root: container, rootMargin: '0px 100px 0px 0px', threshold: 0 }
    );

    leftObserver.observe(leftSentinel);
    rightObserver.observe(rightSentinel);

    return () => {
      leftObserver.disconnect();
      rightObserver.disconnect();
    };
  }, [dates, debouncedExpandLeft, debouncedExpandRight]);

  if (dates.length === 0) return null;

  return (
    <div ref={scrollContainerRef} className="overflow-x-auto relative scrollbar-hide">
      <div data-sentinel="left" className="absolute left-0 top-0 w-1 h-full pointer-events-none" />
      <table className="w-full table-auto divide-y divide-gray-200 dark:divide-gray-700 relative">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th
              className="px-2 py-1 text-left bg-gray-100 dark:bg-gray-800 sticky left-0 z-20"
              rowSpan={2}
            >
              Name
            </th>
            {months.map(month => (
              <th
                key={month.key}
                className="px-1 py-1 bg-gray-100 dark:bg-gray-800 min-w-[2rem] relative"
                colSpan={month.dates.length}
              >
                <div
                  className="text-xs font-semibold text-left bg-gray-100 dark:bg-gray-800"
                  style={{ position: 'sticky', left: '0', minWidth: 'fit-content', zIndex: 10 }}
                >
                  {month.monthName}
                </div>
              </th>
            ))}
          </tr>
          <tr>
            {dates.map(date => {
              const dateStr = date.toISOString().split('T')[0];
              const todayMatch = isSameDay(date, today);
              return (
                <th
                  key={dateStr}
                  ref={todayMatch ? todayColRef : undefined}
                  className={cn(
                    'px-1 py-1 text-center min-w-[2rem]',
                    todayMatch ? 'bg-blue-100 dark:bg-blue-900' : 'bg-gray-100 dark:bg-gray-800'
                  )}
                >
                  <div className="text-sm">{date.getUTCDate()}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {familyMembers.map((member, index) => (
            <tr key={member?.id || `unknown-${index}`}>
              <td className="px-2 py-1 bg-gray-50 dark:bg-gray-800 sticky left-0 z-10 whitespace-nowrap">
                {member?.name || `Unknown Member ${index + 1}`}
              </td>
              {dates.map(date => {
                const dateStr = date.toISOString().split('T')[0];
                const assignment = dateAssignments[dateStr]?.[member.id];
                const status = getDotStatus(assignment, date, today);
                return (
                  <td
                    key={dateStr}
                    className={cn(
                      'px-1 py-1 text-center',
                      isSameDay(date, today) && 'bg-blue-50 dark:bg-blue-900/30'
                    )}
                  >
                    {status && (
                      <span className={cn('inline-block w-2 h-2 rounded-full', DOT_CLASSES[status])} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div data-sentinel="right" className="absolute right-0 top-0 w-1 h-full pointer-events-none" />
    </div>
  );
};

export default ChoreCalendarView;
