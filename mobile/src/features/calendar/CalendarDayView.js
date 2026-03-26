import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radii, spacing, withAlpha } from '../../theme/tokens';
import { DraggableEvent, DropTarget } from './CalendarDragProvider';
import {
  addDays,
  compareEvents,
  eventOccursOnDay,
  eventStartsAt,
  eventEndsAt,
  formatClockTime,
  formatYmd,
  isImportedEvent,
  parseYmdLocal,
  startOfDay,
} from './calendar-utils';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_LABEL_WIDTH = 44;
const MIN_HOUR_HEIGHT = 44;
const ALL_DAY_LANE_HEIGHT = 26;
const ALL_DAY_GAP = 2;

// --- Overlap detection (ported from web DayCalendarView.tsx) ---

function getEventMinuteRange(event, day) {
  const dayStart = startOfDay(day);
  const dayEnd = addDays(dayStart, 1);
  let start = eventStartsAt(event);
  let end = eventEndsAt(event);
  if (!start || !end) return null;

  // Clamp to this day
  if (start < dayStart) start = dayStart;
  if (end > dayEnd) end = dayEnd;

  const startMinute = (start.getTime() - dayStart.getTime()) / 60000;
  const endMinute = (end.getTime() - dayStart.getTime()) / 60000;

  if (endMinute <= startMinute) return null;
  return { startMinute, endMinute: Math.min(endMinute, 1440) };
}

function layoutTimedEvents(segments) {
  // Sort by start, then duration (longest first), then title
  const sorted = [...segments].sort((a, b) => {
    const startDiff = a.startMinute - b.startMinute;
    if (startDiff !== 0) return startDiff;
    const endDiff = a.endMinute - b.endMinute;
    if (endDiff !== 0) return endDiff;
    return (a.event.title || '').localeCompare(b.event.title || '');
  });

  const positioned = [];
  let cluster = [];
  let clusterEndMinute = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const columnEnds = [];
    let maxColumnCount = 0;
    const working = cluster.map((seg) => {
      let columnIndex = 0;
      while (columnIndex < columnEnds.length && columnEnds[columnIndex] > seg.startMinute) {
        columnIndex++;
      }
      columnEnds[columnIndex] = seg.endMinute;
      maxColumnCount = Math.max(maxColumnCount, columnIndex + 1);
      return { ...seg, columnIndex };
    });

    for (const seg of working) {
      positioned.push({ ...seg, columnCount: Math.max(1, maxColumnCount) });
    }
    cluster = [];
    clusterEndMinute = -1;
  };

  for (const seg of sorted) {
    if (cluster.length === 0 || seg.startMinute < clusterEndMinute) {
      cluster.push(seg);
      clusterEndMinute = Math.max(clusterEndMinute, seg.endMinute);
    } else {
      flushCluster();
      cluster.push(seg);
      clusterEndMinute = seg.endMinute;
    }
  }
  flushCluster();
  return positioned;
}

/**
 * Day view — 1-14 day columns with hourly time grid.
 *
 * @param {Object} props
 * @param {Object} props.colors
 * @param {number} props.visibleDayCount - 1 to 14
 * @param {number} props.dayRowCount - 1 or 2
 * @param {number} props.hourHeight - px per hour slot
 * @param {Date} props.anchorDate
 * @param {Function} props.onAnchorDateChange
 * @param {Array} props.calendarItems
 * @param {Function} props.onEventPress
 * @param {Function} props.onAddEventPress
 * @param {boolean} props.canEditEvents
 */
export function CalendarDayView({
  colors,
  visibleDayCount = 1,
  dayRowCount = 1,
  hourHeight = MIN_HOUR_HEIGHT,
  anchorDate,
  onAnchorDateChange,
  calendarItems = [],
  onEventPress,
  onAddEventPress,
  canEditEvents,
}) {
  const styles = useMemo(() => createStyles(colors, hourHeight), [colors, hourHeight]);
  const scrollRef = useRef(null);
  const screenWidth = Dimensions.get('window').width;

  // Compute visible days
  const totalDays = visibleDayCount * dayRowCount;
  const visibleDays = useMemo(() => {
    return Array.from({ length: totalDays }, (_, i) => addDays(anchorDate, i));
  }, [anchorDate, totalDays]);

  const todayKey = formatYmd(new Date());

  // Compute day column width
  const dayColumnWidth = Math.max(60, (screenWidth - HOUR_LABEL_WIDTH) / Math.min(visibleDayCount, 7));

  // Group events by day
  const dayData = useMemo(() => {
    return visibleDays.map((day) => {
      const dayKey = formatYmd(day);
      const allEvents = calendarItems
        .filter((ev) => eventOccursOnDay(ev, day))
        .sort(compareEvents);
      const allDayEvents = allEvents.filter((ev) => ev.isAllDay);
      const timedEvents = allEvents.filter((ev) => !ev.isAllDay);

      // Layout timed events with overlap detection
      const timedSegments = timedEvents
        .map((event) => {
          const range = getEventMinuteRange(event, day);
          if (!range) return null;
          return { event, ...range };
        })
        .filter(Boolean);

      const positioned = layoutTimedEvents(timedSegments);

      return { day, dayKey, allDayEvents, timedEvents: positioned };
    });
  }, [visibleDays, calendarItems]);

  // Max all-day lanes across visible days
  const maxAllDayCount = useMemo(
    () => Math.max(0, ...dayData.map((d) => d.allDayEvents.length)),
    [dayData]
  );
  const allDaySectionHeight = maxAllDayCount > 0
    ? maxAllDayCount * (ALL_DAY_LANE_HEIGHT + ALL_DAY_GAP) + 8
    : 0;

  const totalHeight = hourHeight * 24;

  // Scroll to ~8am on mount
  const initialScrollDone = useRef(false);
  const handleLayout = useCallback(() => {
    if (!initialScrollDone.current && scrollRef.current) {
      initialScrollDone.current = true;
      scrollRef.current.scrollTo({ y: hourHeight * 8 - 20, animated: false });
    }
  }, [hourHeight]);

  function handleJumpForward() {
    onAnchorDateChange?.(addDays(anchorDate, visibleDayCount));
  }

  function handleJumpBack() {
    onAnchorDateChange?.(addDays(anchorDate, -visibleDayCount));
  }

  return (
    <View style={styles.container}>
      {/* Day column headers + jump buttons */}
      <View style={styles.headerRow}>
        <Pressable style={styles.jumpButton} onPress={handleJumpBack} accessibilityLabel="Previous days">
          <Ionicons name="chevron-back" size={18} color={colors.accentCalendar} />
        </Pressable>
        <View style={styles.dayHeaders}>
          {dayData.slice(0, visibleDayCount).map(({ day, dayKey }) => {
            const isToday = dayKey === todayKey;
            return (
              <View key={dayKey} style={[styles.dayHeaderCell, { width: dayColumnWidth }]}>
                <Text style={[styles.dayHeaderWeekday, isToday && styles.dayHeaderToday]} numberOfLines={1}>
                  {day.toLocaleDateString(undefined, { weekday: 'short' })}
                </Text>
                <Text style={[styles.dayHeaderDate, isToday && styles.dayHeaderToday]} numberOfLines={1}>
                  {day.getDate()}
                </Text>
              </View>
            );
          })}
        </View>
        <Pressable style={styles.jumpButton} onPress={handleJumpForward} accessibilityLabel="Next days">
          <Ionicons name="chevron-forward" size={18} color={colors.accentCalendar} />
        </Pressable>
      </View>

      {/* All-day section */}
      {allDaySectionHeight > 0 ? (
        <View style={[styles.allDaySection, { height: allDaySectionHeight }]}>
          <View style={styles.allDayLabelColumn}>
            <Text style={styles.allDayLabel}>All day</Text>
          </View>
          <View style={styles.allDayColumns}>
            {dayData.slice(0, visibleDayCount).map(({ dayKey, allDayEvents }) => (
              <DropTarget key={`ad-${dayKey}`} dayKey={dayKey} style={[styles.allDayColumn, { width: dayColumnWidth }]}>
                {allDayEvents.map((event) => (
                  <DraggableEvent
                    key={event.id}
                    event={event}
                    onPress={(ev) => onEventPress?.(ev)}
                    enabled={canEditEvents}
                  >
                    <View
                      style={styles.allDayChip}
                      accessibilityLabel={event.title || 'All day event'}
                    >
                      <Text style={styles.allDayChipText} numberOfLines={1}>{event.title || 'Untitled'}</Text>
                    </View>
                  </DraggableEvent>
                ))}
              </DropTarget>
            ))}
          </View>
        </View>
      ) : null}

      {/* Time grid with scrollable hours */}
      <ScrollView
        ref={scrollRef}
        style={styles.timeGrid}
        contentContainerStyle={{ height: totalHeight }}
        showsVerticalScrollIndicator={false}
        onLayout={handleLayout}
      >
        {/* Hour lines + labels */}
        {HOURS.map((hour) => (
          <View key={`hour-${hour}`} style={[styles.hourRow, { top: hour * hourHeight, height: hourHeight }]}>
            <View style={styles.hourLabelColumn}>
              <Text style={styles.hourLabel}>
                {hour === 0 ? '12 AM' : hour < 12 ? `${hour} AM` : hour === 12 ? '12 PM' : `${hour - 12} PM`}
              </Text>
            </View>
            <View style={styles.hourLine} />
          </View>
        ))}

        {/* Day columns with timed events */}
        <View style={[styles.dayColumnsOverlay, { left: HOUR_LABEL_WIDTH }]}>
          {dayData.slice(0, visibleDayCount).map(({ dayKey, timedEvents, day }, dayIndex) => (
            <DropTarget
              key={`col-${dayKey}`}
              dayKey={dayKey}
              style={[styles.dayColumn, { width: dayColumnWidth }]}
              totalHeight={totalHeight}
              hourHeight={hourHeight}
            >
              {/* Now indicator */}
              {dayKey === todayKey ? (
                <View
                  style={[
                    styles.nowIndicator,
                    {
                      top: ((new Date().getHours() * 60 + new Date().getMinutes()) / 1440) * totalHeight,
                    },
                  ]}
                />
              ) : null}

              {/* Timed event blocks */}
              {timedEvents.map((seg) => {
                const top = (seg.startMinute / 1440) * totalHeight;
                const height = Math.max(16, ((seg.endMinute - seg.startMinute) / 1440) * totalHeight);
                const columnWidth = dayColumnWidth / seg.columnCount;
                const left = seg.columnIndex * columnWidth;

                return (
                  <DraggableEvent
                    key={`${dayKey}-${seg.event.id}`}
                    event={seg.event}
                    onPress={(ev) => onEventPress?.(ev)}
                    enabled={canEditEvents}
                  >
                    <View
                      style={[
                        styles.timedEventBlock,
                        {
                          position: 'absolute',
                          top,
                          left: left + 1,
                          width: columnWidth - 2,
                          height: height - 1,
                        },
                      ]}
                      accessibilityLabel={`${seg.event.title || 'Untitled'}, ${formatClockTime(seg.event.startDate)}`}
                    >
                      <Text style={styles.timedEventTitle} numberOfLines={1}>{seg.event.title || 'Untitled'}</Text>
                      {height > 32 ? (
                        <Text style={styles.timedEventTime} numberOfLines={1}>
                          {formatClockTime(seg.event.startDate)}
                        </Text>
                      ) : null}
                    </View>
                  </DraggableEvent>
                );
              })}

              {/* Tap empty slot to add event */}
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => onAddEventPress?.(day)}
                accessibilityLabel={`Add event on ${formatYmd(day)}`}
              />
            </DropTarget>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const createStyles = (colors, hourHeight) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    // Header
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
      backgroundColor: colors.panelElevated,
    },
    jumpButton: {
      padding: 8,
    },
    dayHeaders: {
      flex: 1,
      flexDirection: 'row',
    },
    dayHeaderCell: {
      alignItems: 'center',
      paddingVertical: 6,
    },
    dayHeaderWeekday: {
      color: colors.inkMuted,
      fontWeight: '600',
      fontSize: 11,
    },
    dayHeaderDate: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 16,
    },
    dayHeaderToday: {
      color: colors.accentCalendar,
    },
    // All-day section
    allDaySection: {
      flexDirection: 'row',
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
      backgroundColor: colors.panelElevated,
    },
    allDayLabelColumn: {
      width: HOUR_LABEL_WIDTH,
      justifyContent: 'center',
      alignItems: 'center',
    },
    allDayLabel: {
      color: colors.inkMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    allDayColumns: {
      flex: 1,
      flexDirection: 'row',
    },
    allDayColumn: {
      paddingHorizontal: 1,
      paddingVertical: 4,
      gap: ALL_DAY_GAP,
    },
    allDayChip: {
      height: ALL_DAY_LANE_HEIGHT,
      backgroundColor: withAlpha(colors.accentCalendar, 0.15),
      borderRadius: 4,
      paddingHorizontal: 4,
      justifyContent: 'center',
    },
    allDayChipText: {
      color: colors.accentCalendar,
      fontSize: 11,
      fontWeight: '700',
    },
    // Time grid
    timeGrid: {
      flex: 1,
    },
    hourRow: {
      position: 'absolute',
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    hourLabelColumn: {
      width: HOUR_LABEL_WIDTH,
      alignItems: 'flex-end',
      paddingRight: 6,
    },
    hourLabel: {
      color: colors.inkMuted,
      fontSize: 10,
      fontWeight: '600',
      marginTop: -6,
    },
    hourLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.line,
    },
    // Day columns overlay
    dayColumnsOverlay: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      flexDirection: 'row',
    },
    dayColumn: {
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: withAlpha(colors.line, 0.5),
    },
    nowIndicator: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 2,
      backgroundColor: colors.danger,
      zIndex: 10,
    },
    timedEventBlock: {
      backgroundColor: withAlpha(colors.warning, 0.18),
      borderLeftWidth: 3,
      borderLeftColor: colors.warning,
      borderRadius: 4,
      paddingHorizontal: 4,
      paddingVertical: 2,
      overflow: 'hidden',
      zIndex: 5,
    },
    timedEventTitle: {
      color: colors.ink,
      fontSize: 11,
      fontWeight: '700',
    },
    timedEventTime: {
      color: colors.inkMuted,
      fontSize: 9,
      fontWeight: '600',
    },
  });
