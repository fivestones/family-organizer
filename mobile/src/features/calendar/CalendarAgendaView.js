import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { radii, spacing, withAlpha } from '../../theme/tokens';
import {
  addDays,
  compareEvents,
  eventOccursOnDay,
  formatClockTime,
  formatEventRangeLabel,
  formatYmd,
  isImportedEvent,
  parseYmdLocal,
  startOfDay,
} from './calendar-utils';

const DAYS_INITIAL = 60; // ~2 months
const DAYS_EXPAND = 30; // ~1 month per expansion
const DAYS_MAX = 365 * 3; // ~3 years
const DATE_HEADER_HEIGHT = 38;
const EVENT_ROW_HEIGHT = 68;

/**
 * Build flat list data for the agenda: alternating date headers + event rows.
 * Only includes dates that have events.
 */
function buildAgendaData(calendarItems, daysBefore, daysAfter) {
  const today = startOfDay(new Date());
  const rows = [];
  let todayIndex = -1;

  for (let offset = -daysBefore; offset <= daysAfter; offset++) {
    const day = addDays(today, offset);
    const dayKey = formatYmd(day);
    const dayEvents = calendarItems
      .filter((event) => eventOccursOnDay(event, day))
      .sort(compareEvents);

    if (dayEvents.length === 0) continue;

    if (todayIndex === -1 && offset >= 0) {
      todayIndex = rows.length;
    }

    rows.push({
      type: 'date-header',
      key: `dh-${dayKey}`,
      dayKey,
      date: day,
      eventCount: dayEvents.length,
      isToday: offset === 0,
    });

    for (const event of dayEvents) {
      rows.push({
        type: 'event',
        key: `ev-${dayKey}-${event.id}`,
        event,
        dayKey,
      });
    }
  }

  return { rows, todayIndex: Math.max(todayIndex, 0) };
}

/**
 * Infinite-scroll agenda view using FlashList.
 */
export function CalendarAgendaView({
  colors,
  anchorDate,
  calendarItems,
  onEventPress,
  onAddEventPress,
  canEditEvents,
}) {
  const styles = useMemo(() => createStyles(colors), [colors]);
  const flashListRef = useRef(null);

  const [daysBefore, setDaysBefore] = useState(DAYS_INITIAL / 2);
  const [daysAfter, setDaysAfter] = useState(DAYS_INITIAL / 2);

  const { rows, todayIndex } = useMemo(
    () => buildAgendaData(calendarItems || [], daysBefore, daysAfter),
    [calendarItems, daysBefore, daysAfter]
  );

  const handleEndReached = useCallback(() => {
    if (daysBefore + daysAfter < DAYS_MAX) {
      setDaysAfter((prev) => prev + DAYS_EXPAND);
    }
  }, [daysBefore, daysAfter]);

  const handleStartReached = useCallback(() => {
    if (daysBefore + daysAfter < DAYS_MAX) {
      setDaysBefore((prev) => prev + DAYS_EXPAND);
    }
  }, [daysBefore, daysAfter]);

  const getItemType = useCallback((item) => item.type, []);
  const keyExtractor = useCallback((item) => item.key, []);

  const overrideItemLayout = useCallback((layout, item) => {
    layout.size = item.type === 'date-header' ? DATE_HEADER_HEIGHT : EVENT_ROW_HEIGHT;
  }, []);

  const renderItem = useCallback(({ item }) => {
    if (item.type === 'date-header') {
      const dayLabel = item.isToday
        ? 'Today'
        : item.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

      return (
        <View style={[styles.dateHeader, item.isToday && styles.dateHeaderToday]}>
          <Text style={[styles.dateHeaderText, item.isToday && styles.dateHeaderTextToday]}>
            {dayLabel}
          </Text>
          <Text style={styles.dateHeaderCount}>{item.eventCount}</Text>
        </View>
      );
    }

    // Event row
    const event = item.event;
    const imported = isImportedEvent(event);

    return (
      <Pressable
        style={styles.eventRow}
        onPress={() => onEventPress?.(event)}
        accessibilityRole="button"
        accessibilityLabel={`${event.title || 'Untitled'}, ${formatEventRangeLabel(event)}`}
      >
        <View style={[styles.eventColorBar, event.isAllDay ? styles.colorBarAllDay : styles.colorBarTimed]} />
        <View style={styles.eventContent}>
          <View style={styles.eventTopRow}>
            <Text style={styles.eventTitle} numberOfLines={1}>{event.title || 'Untitled event'}</Text>
            {imported ? (
              <Ionicons name="cloud-outline" size={12} color={colors.inkMuted} style={{ marginLeft: 4 }} />
            ) : null}
          </View>
          <Text style={styles.eventTime} numberOfLines={1}>
            {event.isAllDay ? 'All day' : `${formatClockTime(event.startDate)} – ${formatClockTime(event.endDate)}`}
          </Text>
          {event.tags?.length > 0 ? (
            <View style={styles.eventTagRow}>
              {event.tags.slice(0, 3).map((tag) => (
                <View key={tag.normalizedName} style={styles.eventTag}>
                  <Text style={styles.eventTagText}>{tag.name}</Text>
                </View>
              ))}
              {event.tags.length > 3 ? (
                <Text style={styles.eventTagMore}>+{event.tags.length - 3}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  }, [onEventPress, styles, colors]);

  if (rows.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Ionicons name="calendar-outline" size={48} color={withAlpha(colors.inkMuted, 0.4)} />
        <Text style={styles.emptyTitle}>No events</Text>
        <Text style={styles.emptySubtitle}>
          {canEditEvents
            ? 'Tap + to add your first event.'
            : 'No events found in this range.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlashList
        ref={flashListRef}
        data={rows}
        renderItem={renderItem}
        getItemType={getItemType}
        keyExtractor={keyExtractor}
        estimatedItemSize={EVENT_ROW_HEIGHT}
        overrideItemLayout={overrideItemLayout}
        initialScrollIndex={todayIndex > 0 ? todayIndex : 0}
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.5}
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      gap: spacing.sm,
    },
    emptyTitle: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 18,
    },
    emptySubtitle: {
      color: colors.inkMuted,
      fontSize: 14,
      textAlign: 'center',
    },
    // Date header
    dateHeader: {
      height: DATE_HEADER_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      backgroundColor: colors.bg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    dateHeaderToday: {
      backgroundColor: withAlpha(colors.accentCalendar, 0.06),
    },
    dateHeaderText: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 14,
    },
    dateHeaderTextToday: {
      color: colors.accentCalendar,
    },
    dateHeaderCount: {
      color: colors.inkMuted,
      fontWeight: '700',
      fontSize: 12,
    },
    // Event row
    eventRow: {
      height: EVENT_ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: spacing.md,
      backgroundColor: colors.panelElevated,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.line,
    },
    eventColorBar: {
      width: 4,
      height: '100%',
    },
    colorBarAllDay: {
      backgroundColor: colors.accentCalendar,
    },
    colorBarTimed: {
      backgroundColor: colors.warning,
    },
    eventContent: {
      flex: 1,
      paddingHorizontal: spacing.sm,
      paddingVertical: 8,
      gap: 2,
    },
    eventTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    eventTitle: {
      flex: 1,
      color: colors.ink,
      fontWeight: '700',
      fontSize: 14,
    },
    eventTime: {
      color: colors.inkMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    eventTagRow: {
      flexDirection: 'row',
      gap: 4,
      marginTop: 2,
    },
    eventTag: {
      borderRadius: radii.pill,
      paddingHorizontal: 6,
      paddingVertical: 1,
      backgroundColor: withAlpha(colors.accentCalendar, 0.1),
    },
    eventTagText: {
      color: colors.accentCalendar,
      fontSize: 10,
      fontWeight: '700',
    },
    eventTagMore: {
      color: colors.inkMuted,
      fontSize: 10,
      fontWeight: '700',
      alignSelf: 'center',
    },
  });
