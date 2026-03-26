import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { radii, shadows, spacing, withAlpha } from '../../theme/tokens';
import { DraggableEvent, DropTarget } from './CalendarDragProvider';
import {
  WEEKDAY_LABELS,
  addDays,
  formatYmd,
  formatDayTitle,
  formatEventRangeLabel,
  formatMonthTitle,
  isImportedEvent,
  startOfDay,
  startOfWeekSunday,
  startOfMonth,
  computeBikramMetaByDayKey,
} from './calendar-utils';

const WEEKS_INITIAL = 52; // ~1 year of weeks
const WEEKS_EXPAND = 13; // ~3 months per expansion
const WEEKS_MAX = 260; // ~5 years max
const WEEK_ROW_HEIGHT = 72; // Fixed height per week row
const MONTH_HEADER_HEIGHT = 36;

/**
 * Build an array of row items (week rows + month headers) centered on today.
 */
function buildWeekRows(centerDate, weeksBefore, weeksAfter) {
  const todayWeekStart = startOfWeekSunday(centerDate);
  const rows = [];
  let prevMonth = null;

  for (let i = -weeksBefore; i <= weeksAfter; i++) {
    const weekStart = addDays(todayWeekStart, i * 7);
    const days = Array.from({ length: 7 }, (_, d) => addDays(weekStart, d));

    // Check if a new month starts in this week
    for (const day of days) {
      if (day.getDate() === 1) {
        const monthKey = `${day.getFullYear()}-${day.getMonth()}`;
        if (monthKey !== prevMonth) {
          rows.push({
            type: 'month-header',
            key: `mh-${monthKey}`,
            date: day,
            label: formatMonthTitle(day),
          });
          prevMonth = monthKey;
        }
        break;
      }
    }

    // If no month header was added but this is the first row, add one
    if (rows.length === 0 || (rows.length > 0 && rows[rows.length - 1].type === 'month-header' && rows[rows.length - 1].key !== `mh-${days[0].getFullYear()}-${days[0].getMonth()}`)) {
      // This handles the first row if it doesn't start on the 1st
      if (rows.length === 0) {
        const d = days[0];
        const monthKey = `${d.getFullYear()}-${d.getMonth()}`;
        rows.push({
          type: 'month-header',
          key: `mh-${monthKey}`,
          date: d,
          label: formatMonthTitle(d),
        });
        prevMonth = monthKey;
      }
    }

    rows.push({
      type: 'week',
      key: `w-${formatYmd(weekStart)}`,
      days,
      weekStart,
    });
  }

  return rows;
}

function findTodayIndex(rows) {
  const todayKey = formatYmd(new Date());
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'week') {
      for (const day of rows[i].days) {
        if (formatYmd(day) === todayKey) return i;
      }
    }
  }
  return Math.floor(rows.length / 2);
}

/**
 * Memoized day cell component.
 */
const MonthDayCell = React.memo(function MonthDayCell({
  day,
  dayKey,
  isCurrentMonth,
  isSelected,
  isToday,
  eventCount,
  allDayCount,
  timedCount,
  bikramMeta,
  onPress,
  styles,
  dayIndex,
  weekIndex,
}) {
  return (
    <DropTarget dayKey={dayKey} style={[
      styles.dayCell,
      !isCurrentMonth && styles.dayCellOutsideMonth,
      dayIndex > 0 && styles.dayCellDividerLeft,
      weekIndex > 0 && styles.dayCellDividerTop,
      isSelected && styles.dayCellSelected,
      isToday && !isSelected && styles.dayCellToday,
    ]}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${formatDayTitle(day)}, ${eventCount} events`}
      style={StyleSheet.absoluteFill}
      onPress={() => onPress(day)}
    >
      <View style={styles.dayHeader}>
        <View style={styles.dayHeaderLeft}>
          <Text
            style={[
              styles.dayNumber,
              !isCurrentMonth && styles.dayNumberOutsideMonth,
              isSelected && styles.dayNumberSelected,
              isToday && !isSelected && styles.dayNumberToday,
            ]}
          >
            {day.getDate()}
          </Text>
          {bikramMeta?.showGregorianMonthTransition ? (
            <Text
              style={[
                styles.gregorianMonthTransition,
                !isCurrentMonth && styles.gregorianMonthTransitionMuted,
                isSelected && styles.accentText,
              ]}
              numberOfLines={1}
            >
              {bikramMeta.gregorianMonthShort}
            </Text>
          ) : null}
        </View>
        <View style={styles.dayHeaderRight}>
          {bikramMeta?.showBsMonthTransition ? (
            <Text
              style={[
                styles.bsMonthTransition,
                !isCurrentMonth && styles.bsLabelMuted,
                isSelected && styles.accentText,
              ]}
              numberOfLines={1}
            >
              {bikramMeta.monthNameDevanagari}
            </Text>
          ) : null}
          {bikramMeta ? (
            <Text
              style={[styles.bsDayNumber, !isCurrentMonth && styles.bsLabelMuted, isSelected && styles.accentText]}
              numberOfLines={1}
            >
              {bikramMeta.dayLabelDevanagari}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.dayEventDots}>
        {allDayCount > 0 ? Array.from({ length: Math.min(allDayCount, 2) }, (_, i) => (
          <View key={`ad-${i}`} style={[styles.dayEventDot, styles.dayEventDotAllDay]} />
        )) : null}
        {timedCount > 0 ? Array.from({ length: Math.min(timedCount, 2) }, (_, i) => (
          <View key={`td-${i}`} style={[styles.dayEventDot, styles.dayEventDotTimed]} />
        )) : null}
        {eventCount > 3 ? (
          <Text style={[styles.moreCount, isSelected && styles.accentText]}>+{eventCount - 3}</Text>
        ) : null}
      </View>
    </Pressable>
    </DropTarget>
  );
});

/**
 * Infinite-scroll month view using FlashList.
 */
export function CalendarMonthView({
  viewMonth,
  selectedDate,
  selectedDayKey,
  eventsByDayKey,
  selectedDayEvents,
  canEditEvents,
  isLoading,
  error,
  currentUser,
  onSelectDate,
  onAddEvent,
  onOpenEvent,
  onPrevMonth,
  onNextMonth,
  onVisibleMonthChange,
  colors,
}) {
  const styles = useMemo(() => createMonthViewStyles(colors), [colors]);
  const flashListRef = useRef(null);
  const todayKey = formatYmd(new Date());

  // Build week rows
  const [weeksBefore, setWeeksBefore] = useState(WEEKS_INITIAL / 2);
  const [weeksAfter, setWeeksAfter] = useState(WEEKS_INITIAL / 2);

  const rows = useMemo(
    () => buildWeekRows(new Date(), weeksBefore, weeksAfter),
    [weeksBefore, weeksAfter]
  );

  const todayIndex = useMemo(() => findTodayIndex(rows), [rows]);

  // Compute bikram metadata for all visible days
  const allDays = useMemo(() => {
    const days = [];
    for (const row of rows) {
      if (row.type === 'week') {
        days.push(...row.days);
      }
    }
    return days;
  }, [rows]);

  const bikramMetaByDayKey = useMemo(
    () => computeBikramMetaByDayKey(allDays),
    [allDays]
  );

  // Expand range when scrolling to edges
  const handleStartReached = useCallback(() => {
    if (weeksBefore + weeksAfter < WEEKS_MAX) {
      setWeeksBefore((prev) => prev + WEEKS_EXPAND);
    }
  }, [weeksBefore, weeksAfter]);

  const handleEndReached = useCallback(() => {
    if (weeksBefore + weeksAfter < WEEKS_MAX) {
      setWeeksAfter((prev) => prev + WEEKS_EXPAND);
    }
  }, [weeksBefore, weeksAfter]);

  // Report visible month to header
  const handleViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (!viewableItems || viewableItems.length === 0) return;
    // Find the first visible week row
    const firstWeek = viewableItems.find((v) => v.item?.type === 'week');
    if (firstWeek && onVisibleMonthChange) {
      const midDay = firstWeek.item.days[3]; // Wednesday of the week
      onVisibleMonthChange(midDay);
    }
  }, [onVisibleMonthChange]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 100 });

  // Scroll to today
  const scrollToToday = useCallback(() => {
    if (flashListRef.current && todayIndex >= 0) {
      flashListRef.current.scrollToIndex({ index: todayIndex, animated: true });
    }
  }, [todayIndex]);

  // Expose scrollToToday
  useEffect(() => {
    // On mount, the FlashList starts at initialScrollIndex which is todayIndex
  }, []);

  const getItemType = useCallback((item) => item.type, []);

  const keyExtractor = useCallback((item) => item.key, []);

  const overrideItemLayout = useCallback((layout, item) => {
    if (item.type === 'month-header') {
      layout.size = MONTH_HEADER_HEIGHT;
    } else {
      layout.size = WEEK_ROW_HEIGHT;
    }
  }, []);

  const renderItem = useCallback(({ item, index }) => {
    if (item.type === 'month-header') {
      return (
        <View style={styles.monthHeaderRow}>
          <Text style={styles.monthHeaderText}>{item.label}</Text>
        </View>
      );
    }

    // Week row
    const viewMonthMonth = viewMonth.getMonth();
    return (
      <View style={styles.weekRow}>
        {item.days.map((day, dayIndex) => {
          const dayKey = formatYmd(day);
          const dayEvents = eventsByDayKey.get(dayKey) || [];
          const allDayCount = dayEvents.filter((e) => e.isAllDay).length;
          const timedCount = dayEvents.length - allDayCount;
          const bikramMeta = bikramMetaByDayKey.get(dayKey);
          // Determine which month this cell "belongs to" based on the majority month of the week
          const midDay = item.days[3];
          const isCurrentMonth = day.getMonth() === midDay.getMonth();

          return (
            <MonthDayCell
              key={dayKey}
              day={day}
              dayKey={dayKey}
              isCurrentMonth={isCurrentMonth}
              isSelected={dayKey === selectedDayKey}
              isToday={dayKey === todayKey}
              eventCount={dayEvents.length}
              allDayCount={allDayCount}
              timedCount={timedCount}
              bikramMeta={bikramMeta}
              onPress={onSelectDate}
              styles={styles}
              dayIndex={dayIndex}
              weekIndex={1} // Always show top border since we're in FlashList
            />
          );
        })}
      </View>
    );
  }, [eventsByDayKey, bikramMetaByDayKey, selectedDayKey, todayKey, onSelectDate, styles, viewMonth]);

  return (
    <View style={styles.container}>
      {/* Weekday header (sticky) */}
      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label) => (
          <Text key={label} style={styles.weekdayLabel}>{label}</Text>
        ))}
      </View>

      {/* Infinite scroll grid */}
      <View style={styles.gridContainer}>
        <FlashList
          ref={flashListRef}
          data={rows}
          renderItem={renderItem}
          getItemType={getItemType}
          keyExtractor={keyExtractor}
          estimatedItemSize={WEEK_ROW_HEIGHT}
          overrideItemLayout={overrideItemLayout}
          initialScrollIndex={todayIndex > 0 ? todayIndex - 1 : 0}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.3}
          onViewableItemsChanged={handleViewableItemsChanged}
          viewabilityConfig={viewabilityConfig.current}
          showsVerticalScrollIndicator={false}
        />
      </View>

      {/* Selected day panel */}
      <View style={styles.panel}>
        <View style={styles.panelHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.panelTitle}>{formatDayTitle(selectedDate)}</Text>
            <Text style={styles.metaText}>
              {selectedDayEvents.length} event{selectedDayEvents.length === 1 ? '' : 's'}
              {currentUser?.name ? ` · ${currentUser.name}` : ''}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add event for selected day"
            onPress={() => onAddEvent(selectedDate)}
            style={[styles.addButton, !canEditEvents && styles.addButtonLocked]}
          >
            <Text style={[styles.addButtonText, !canEditEvents && styles.addButtonTextLocked]}>
              {canEditEvents ? '+ Add' : 'Parent Login'}
            </Text>
          </Pressable>
        </View>

        {error ? (
          <Text style={styles.errorText}>{error.message || 'Failed to load'}</Text>
        ) : isLoading ? (
          <Text style={styles.emptyText}>Loading...</Text>
        ) : selectedDayEvents.length === 0 ? (
          <Text style={styles.emptyText}>No events</Text>
        ) : (
          <View style={styles.eventList}>
            {selectedDayEvents.map((event) => (
              <DraggableEvent
                key={event.id}
                event={event}
                onPress={onOpenEvent}
                enabled={canEditEvents}
              >
                <View
                  accessibilityRole="button"
                  accessibilityLabel={`${canEditEvents ? 'Edit' : 'View'} ${event.title || 'Untitled'}`}
                  style={[styles.eventCard, !canEditEvents && styles.eventCardReadOnly]}
                >
                  <View style={styles.eventRowTop}>
                    <Text style={styles.eventTitle} numberOfLines={1}>{event.title || 'Untitled event'}</Text>
                    <View style={[styles.eventBadge, event.isAllDay ? styles.eventBadgeAllDay : styles.eventBadgeTimed]}>
                      <Text style={[styles.eventBadgeText, event.isAllDay ? styles.eventBadgeTextAllDay : styles.eventBadgeTextTimed]}>
                        {event.isAllDay ? 'All day' : 'Timed'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.eventMeta}>{formatEventRangeLabel(event)}</Text>
                  {event.tags?.length ? (
                    <View style={styles.eventTagRow}>
                      {event.tags.map((tag) => (
                        <View key={`${event.id}-${tag.normalizedName}`} style={styles.eventTag}>
                          <Text style={styles.eventTagText}>{tag.name}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              </DraggableEvent>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const createMonthViewStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    weekdayRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
      backgroundColor: colors.bg,
    },
    weekdayLabel: {
      flex: 1,
      textAlign: 'center',
      color: colors.inkMuted,
      fontWeight: '700',
      fontSize: 12,
    },
    gridContainer: {
      flex: 1,
      minHeight: WEEK_ROW_HEIGHT * 6,
    },
    monthHeaderRow: {
      height: MONTH_HEADER_HEIGHT,
      justifyContent: 'flex-end',
      paddingHorizontal: spacing.md,
      paddingBottom: 4,
    },
    monthHeaderText: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 14,
    },
    weekRow: {
      flexDirection: 'row',
      height: WEEK_ROW_HEIGHT,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.line,
    },
    // Day cell
    dayCell: {
      flex: 1,
      paddingHorizontal: 3,
      paddingVertical: 3,
      gap: 2,
      backgroundColor: colors.panelElevated,
    },
    dayCellDividerLeft: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.line,
    },
    dayCellDividerTop: {},
    dayCellOutsideMonth: {
      backgroundColor: withAlpha(colors.locked, 0.08),
    },
    dayCellSelected: {
      backgroundColor: withAlpha(colors.accentCalendar, 0.12),
    },
    dayCellToday: {
      backgroundColor: withAlpha(colors.accentCalendar, 0.05),
    },
    dayHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: 2,
      minHeight: 24,
    },
    dayHeaderLeft: {
      minWidth: 12,
      gap: 1,
    },
    dayHeaderRight: {
      flex: 1,
      alignItems: 'flex-end',
      justifyContent: 'flex-start',
      gap: 1,
    },
    dayNumber: {
      fontSize: 13,
      fontWeight: '800',
      color: colors.ink,
      lineHeight: 15,
    },
    dayNumberOutsideMonth: {
      color: colors.inkMuted,
    },
    dayNumberSelected: {
      color: colors.accentCalendar,
    },
    dayNumberToday: {
      color: colors.accentCalendar,
    },
    accentText: {
      color: colors.accentCalendar,
    },
    gregorianMonthTransition: {
      fontSize: 7,
      lineHeight: 9,
      fontWeight: '700',
      color: colors.inkMuted,
    },
    gregorianMonthTransitionMuted: {
      color: withAlpha(colors.inkMuted, 0.7),
    },
    bsMonthTransition: {
      fontSize: 7,
      fontWeight: '700',
      color: colors.inkMuted,
      lineHeight: 9,
      maxWidth: '100%',
    },
    bsDayNumber: {
      fontSize: 9,
      fontWeight: '700',
      color: colors.inkMuted,
      lineHeight: 11,
    },
    bsLabelMuted: {
      color: withAlpha(colors.inkMuted, 0.7),
    },
    dayEventDots: {
      minHeight: 9,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      flexWrap: 'wrap',
      marginTop: 'auto',
    },
    dayEventDot: {
      width: 5,
      height: 5,
      borderRadius: 999,
    },
    dayEventDotAllDay: {
      backgroundColor: colors.accentCalendar,
    },
    dayEventDotTimed: {
      backgroundColor: colors.warning,
    },
    moreCount: {
      fontSize: 9,
      color: colors.inkMuted,
      fontWeight: '700',
    },
    // Selected day panel
    panel: {
      backgroundColor: colors.panelElevated,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      padding: spacing.md,
      gap: spacing.sm,
      maxHeight: 240,
    },
    panelHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    panelTitle: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 15,
      lineHeight: 20,
    },
    metaText: {
      color: colors.inkMuted,
      fontSize: 11,
      lineHeight: 15,
    },
    addButton: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: withAlpha(colors.accentCalendar, 0.24),
      backgroundColor: withAlpha(colors.accentCalendar, 0.1),
      paddingHorizontal: 12,
      paddingVertical: 6,
    },
    addButtonLocked: {
      backgroundColor: withAlpha(colors.locked, 0.18),
      borderColor: withAlpha(colors.locked, 0.32),
    },
    addButtonText: {
      color: colors.accentCalendar,
      fontWeight: '800',
      fontSize: 12,
    },
    addButtonTextLocked: {
      color: colors.inkMuted,
    },
    emptyText: {
      color: colors.inkMuted,
      fontSize: 13,
    },
    errorText: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '600',
    },
    eventList: {
      gap: spacing.xs,
    },
    eventCard: {
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radii.sm,
      backgroundColor: colors.panel,
      padding: spacing.sm,
      gap: 4,
    },
    eventCardReadOnly: {
      backgroundColor: withAlpha(colors.locked, 0.08),
    },
    eventRowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    eventTitle: {
      flex: 1,
      color: colors.ink,
      fontWeight: '700',
      fontSize: 14,
    },
    eventBadge: {
      borderRadius: radii.pill,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderWidth: 1,
    },
    eventBadgeAllDay: {
      backgroundColor: withAlpha(colors.accentCalendar, 0.1),
      borderColor: withAlpha(colors.accentCalendar, 0.24),
    },
    eventBadgeTimed: {
      backgroundColor: withAlpha(colors.warning, 0.12),
      borderColor: withAlpha(colors.warning, 0.24),
    },
    eventBadgeText: {
      fontSize: 10,
      fontWeight: '700',
    },
    eventBadgeTextAllDay: {
      color: colors.accentCalendar,
    },
    eventBadgeTextTimed: {
      color: colors.warning,
    },
    eventMeta: {
      color: colors.inkMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    eventTagRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
    },
    eventTag: {
      borderRadius: radii.pill,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderWidth: 1,
      borderColor: withAlpha(colors.accentCalendar, 0.24),
      backgroundColor: withAlpha(colors.accentCalendar, 0.08),
    },
    eventTagText: {
      color: colors.accentCalendar,
      fontSize: 10,
      fontWeight: '700',
    },
  });
