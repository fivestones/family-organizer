import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { id, tx } from '@instantdb/react-native';
import { useLocalSearchParams } from 'expo-router';
import NepaliDate from 'nepali-date-converter';
import { ScreenScaffold } from '../../src/components/ScreenScaffold';
import { radii, shadows, spacing } from '../../src/theme/tokens';
import { useAppSession } from '../../src/providers/AppProviders';
import { clearPendingParentAction, getPendingParentAction } from '../../src/lib/session-prefs';
import { useParentActionGate } from '../../src/hooks/useParentActionGate';
import { useAppTheme } from '../../src/theme/ThemeProvider';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEVANAGARI_DIGITS = ['०', '१', '२', '३', '४', '५', '६', '७', '८', '९'];
const NEPALI_MONTHS_COMMON_DEVANAGARI = ['वैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज', 'कात्तिक', 'मंसिर', 'पुष', 'माघ', 'फागुन', 'चैत'];

function startOfDay(date) {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeekSunday(date) {
  const base = startOfDay(date);
  return addDays(base, -base.getDay());
}

function formatYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDevanagariDigits(value) {
  return String(value).replace(/\d/g, (digit) => DEVANAGARI_DIGITS[Number(digit)] || digit);
}

function parseYmdLocal(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    return null;
  }
  return startOfDay(date);
}

function parseTime(value) {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return { hours, minutes };
}

function combineLocalDateAndTime(dateValue, timeValue) {
  const date = parseYmdLocal(dateValue);
  const time = parseTime(timeValue);
  if (!date || !time) return null;
  const next = new Date(date);
  next.setHours(time.hours, time.minutes, 0, 0);
  return next;
}

function eventStartsAt(event) {
  if (!event) return null;
  if (event.isAllDay) return parseYmdLocal(event.startDate);
  const parsed = new Date(event.startDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventEndsAt(event) {
  if (!event) return null;
  if (event.isAllDay) return parseYmdLocal(event.endDate);
  const parsed = new Date(event.endDate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function eventOccursOnDay(event, day) {
  const dayStart = startOfDay(day);
  const nextDay = addDays(dayStart, 1);
  const start = eventStartsAt(event);
  const end = eventEndsAt(event);
  if (!start || !end) return false;
  return start < nextDay && end > dayStart;
}

function compareEvents(a, b) {
  if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
  const aStart = eventStartsAt(a)?.getTime() || 0;
  const bStart = eventStartsAt(b)?.getTime() || 0;
  if (aStart !== bStart) return aStart - bStart;
  return (a.title || '').localeCompare(b.title || '');
}

function formatMonthTitle(date) {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatDayTitle(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatClockTime(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatEventRangeLabel(event) {
  if (event.isAllDay) {
    const start = parseYmdLocal(event.startDate);
    const endExclusive = parseYmdLocal(event.endDate);
    if (!start || !endExclusive) return 'All day';
    const endInclusive = addDays(endExclusive, -1);
    if (formatYmd(start) === formatYmd(endInclusive)) return 'All day';
    return `All day · ${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${endInclusive.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  }

  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Timed event';

  const sameDay = formatYmd(start) === formatYmd(end);
  if (sameDay) return `${formatClockTime(start)} - ${formatClockTime(end)}`;
  return `${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${formatClockTime(start)} - ${end.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${formatClockTime(end)}`;
}

function getBikramDayMeta(date) {
  try {
    const nepali = new NepaliDate(date);
    return {
      year: nepali.getYear(),
      monthIndex: nepali.getMonth(),
      day: nepali.getDate(),
      monthNameDevanagari: NEPALI_MONTHS_COMMON_DEVANAGARI[nepali.getMonth()] || '',
    };
  } catch {
    return null;
  }
}

function getGregorianMonthShort(date) {
  return date.toLocaleDateString(undefined, { month: 'short' });
}

function buildMonthGrid(viewMonth) {
  const monthStart = startOfMonth(viewMonth);
  const gridStart = startOfWeekSunday(monthStart);
  const days = Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }
  return { monthStart, gridStart, days, weeks };
}

function getMonthWhereConditions(days) {
  const byYear = new Map();
  for (const day of days) {
    const year = day.getFullYear();
    const month = day.getMonth() + 1;
    const months = byYear.get(year) || new Set();
    months.add(month);
    byYear.set(year, months);
  }

  return Array.from(byYear.entries()).map(([year, months]) => ({
    year,
    month: { $in: Array.from(months).sort((a, b) => a - b) },
  }));
}

function buildInitialForm(date = new Date()) {
  const start = startOfDay(date);
  const end = new Date(start);
  end.setHours(11, 0, 0, 0);
  const startTimed = new Date(start);
  startTimed.setHours(10, 0, 0, 0);
  return {
    title: '',
    description: '',
    isAllDay: true,
    startDate: formatYmd(start),
    endDate: formatYmd(start),
    startTime: `${String(startTimed.getHours()).padStart(2, '0')}:${String(startTimed.getMinutes()).padStart(2, '0')}`,
    endTime: `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
  };
}

function formFromEvent(event) {
  if (!event) return buildInitialForm(new Date());

  if (event.isAllDay) {
    const start = parseYmdLocal(event.startDate) || new Date();
    const endExclusive = parseYmdLocal(event.endDate) || addDays(start, 1);
    const endInclusive = addDays(endExclusive, -1);
    return {
      title: event.title || '',
      description: event.description || '',
      isAllDay: true,
      startDate: formatYmd(start),
      endDate: formatYmd(endInclusive),
      startTime: '10:00',
      endTime: '11:00',
    };
  }

  const start = new Date(event.startDate);
  const end = new Date(event.endDate);
  return {
    title: event.title || '',
    description: event.description || '',
    isAllDay: false,
    startDate: Number.isNaN(start.getTime()) ? formatYmd(new Date()) : formatYmd(start),
    endDate: Number.isNaN(end.getTime()) ? formatYmd(new Date()) : formatYmd(end),
    startTime: Number.isNaN(start.getTime())
      ? '10:00'
      : `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`,
    endTime: Number.isNaN(end.getTime())
      ? '11:00'
      : `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`,
  };
}

function normalizeCalendarItem(item) {
  return {
    id: item.id,
    title: item.title || '',
    description: item.description || '',
    startDate: item.startDate,
    endDate: item.endDate,
    isAllDay: !!item.isAllDay,
    year: item.year,
    month: item.month,
    dayOfMonth: item.dayOfMonth,
  };
}

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default function CalendarTab() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const searchParams = useLocalSearchParams();
  const { requireParentAction } = useParentActionGate();
  const {
    db,
    isAuthenticated,
    instantReady,
    isOnline,
    connectionStatus,
    principalType,
    currentUser,
    recordParentActivity,
  } = useAppSession();

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => startOfDay(new Date()));
  const [modalVisible, setModalVisible] = useState(false);
  const [editingEventId, setEditingEventId] = useState(null);
  const [form, setForm] = useState(() => buildInitialForm(new Date()));
  const [saving, setSaving] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [resumePendingAction, setResumePendingAction] = useState(null);
  const [handledResumeNonce, setHandledResumeNonce] = useState('');

  const canEditEvents = principalType === 'parent';
  const grid = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const monthWhereConditions = useMemo(() => getMonthWhereConditions(grid.days), [grid.days]);

  const calendarQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          calendarItems: {
            $: {
              where:
                monthWhereConditions.length <= 1
                  ? monthWhereConditions[0] || {}
                  : { or: monthWhereConditions },
            },
          },
        }
      : null
  );

  const calendarItems = useMemo(
    () => (calendarQuery.data?.calendarItems || []).map(normalizeCalendarItem).sort(compareEvents),
    [calendarQuery.data?.calendarItems]
  );

  const eventsByDayKey = useMemo(() => {
    const map = new Map();
    for (const day of grid.days) {
      const key = formatYmd(day);
      const events = calendarItems.filter((event) => eventOccursOnDay(event, day));
      map.set(key, events.sort(compareEvents));
    }
    return map;
  }, [calendarItems, grid.days]);

  const selectedDayKey = formatYmd(selectedDate);
  const selectedDayEvents = eventsByDayKey.get(selectedDayKey) || [];

  useEffect(() => {
    const shouldResume = firstParam(searchParams.resumeParentAction) === '1';
    const resumeNonce = String(firstParam(searchParams.resumeNonce) || '');
    if (!shouldResume || !resumeNonce || resumeNonce === handledResumeNonce) return;

    let cancelled = false;
    async function loadPendingAction() {
      const pending = await getPendingParentAction();
      if (cancelled) return;
      setHandledResumeNonce(resumeNonce);
      if (pending?.actionId?.startsWith('calendar:')) {
        setResumePendingAction(pending);
      }
    }

    void loadPendingAction();
    return () => {
      cancelled = true;
    };
  }, [handledResumeNonce, searchParams.resumeParentAction, searchParams.resumeNonce]);

  useEffect(() => {
    if (!resumePendingAction) return;
    if (!isAuthenticated || principalType !== 'parent') return;

    const actionId = resumePendingAction.actionId;
    const payload = resumePendingAction.payload || {};
    const clearResume = async () => {
      await clearPendingParentAction();
      setResumePendingAction(null);
    };

    if (actionId === 'calendar:add-selected-day') {
      const resumeDate = parseYmdLocal(payload.selectedDayKey) || selectedDate;
      setSelectedDate(startOfDay(resumeDate));
      setViewMonth(startOfMonth(resumeDate));
      openNewEventModal(resumeDate);
      void clearResume();
      return;
    }

    if (actionId === 'calendar:edit-event') {
      const eventId = payload.eventId;
      const event = calendarItems.find((item) => item.id === eventId);
      if (!event) {
        if (calendarQuery.isLoading) return;
        const fallbackDate = parseYmdLocal(payload.selectedDayKey) || selectedDate;
        setSelectedDate(startOfDay(fallbackDate));
        setViewMonth(startOfMonth(fallbackDate));
        openNewEventModal(fallbackDate);
        void clearResume();
        return;
      }

      const eventStart = eventStartsAt(event) || selectedDate;
      setSelectedDate(startOfDay(eventStart));
      setViewMonth(startOfMonth(eventStart));
      openEditEventModal(event);
      void clearResume();
      return;
    }

    void clearResume();
  }, [calendarItems, calendarQuery.isLoading, isAuthenticated, principalType, resumePendingAction, selectedDate]);
  const bikramMetaByDayKey = useMemo(() => {
    const map = new Map();
    let previousBikram = null;
    let previousGregorian = null;

    for (const day of grid.days) {
      const dayKey = formatYmd(day);
      const currentBikram = getBikramDayMeta(day);
      const gregorianMonthChanged =
        !previousGregorian ||
        previousGregorian.getMonth() !== day.getMonth() ||
        previousGregorian.getFullYear() !== day.getFullYear();

      if (!currentBikram) {
        map.set(dayKey, null);
        previousGregorian = day;
        continue;
      }

      const bikramMonthChanged =
        !previousBikram ||
        previousBikram.monthIndex !== currentBikram.monthIndex ||
        previousBikram.year !== currentBikram.year;

      map.set(dayKey, {
        ...currentBikram,
        dayLabelDevanagari: toDevanagariDigits(currentBikram.day),
        showBsMonthTransition: bikramMonthChanged,
        showGregorianMonthTransition: gregorianMonthChanged,
        gregorianMonthShort: getGregorianMonthShort(day),
      });

      previousBikram = currentBikram;
      previousGregorian = day;
    }

    return map;
  }, [grid.days]);

  useEffect(() => {
    const subShow = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subHide = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(subShow, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(subHide, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  function openNewEventModal(date) {
    const baseDate = date || selectedDate || new Date();
    setEditingEventId(null);
    setForm(buildInitialForm(baseDate));
    setModalVisible(true);
  }

  function openEditEventModal(event) {
    setEditingEventId(event.id);
    setForm(formFromEvent(event));
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setSaving(false);
  }

  function handleSelectDate(day) {
    setSelectedDate(startOfDay(day));
    recordParentActivity();
  }

  function handleChange(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handoffToParentLogin(actionId, actionLabel, payload = {}) {
    await requireParentAction({
      actionId,
      actionLabel,
      payload,
      returnPath: '/calendar',
    });
  }

  async function handleAddEventPress(day) {
    recordParentActivity();
    if (!canEditEvents) {
      await handoffToParentLogin('calendar:add-selected-day', 'Add calendar event', {
        selectedDayKey: formatYmd(day || selectedDate || new Date()),
      });
      return;
    }

    openNewEventModal(day || selectedDate);
  }

  async function handleOpenEventPress(event) {
    recordParentActivity();
    if (!canEditEvents) {
      await handoffToParentLogin('calendar:edit-event', 'Edit calendar event', {
        eventId: event.id,
        selectedDayKey: selectedDayKey,
      });
      return;
    }

    openEditEventModal(event);
  }

  async function handleSave() {
    recordParentActivity();

    if (!canEditEvents) {
      await handoffToParentLogin(
        editingEventId ? 'calendar:edit-event' : 'calendar:add-selected-day',
        editingEventId ? 'Edit calendar event' : 'Add calendar event',
        editingEventId ? { eventId: editingEventId, selectedDayKey } : { selectedDayKey }
      );
      return;
    }

    const title = form.title.trim();
    if (!title) {
      Alert.alert('Missing title', 'Please add an event title.');
      return;
    }

    let payload;

    if (form.isAllDay) {
      const startDate = parseYmdLocal(form.startDate);
      const endDateInclusive = parseYmdLocal(form.endDate);
      if (!startDate || !endDateInclusive) {
        Alert.alert('Invalid date', 'Use YYYY-MM-DD for start and end dates.');
        return;
      }
      if (endDateInclusive < startDate) {
        Alert.alert('Invalid range', 'End date must be on or after the start date.');
        return;
      }

      const endDateExclusive = addDays(endDateInclusive, 1);
      payload = {
        title,
        description: form.description.trim(),
        startDate: formatYmd(startDate),
        endDate: formatYmd(endDateExclusive),
        isAllDay: true,
        year: startDate.getFullYear(),
        month: startDate.getMonth() + 1,
        dayOfMonth: startDate.getDate(),
      };
    } else {
      const start = combineLocalDateAndTime(form.startDate, form.startTime);
      const end = combineLocalDateAndTime(form.endDate, form.endTime);
      if (!start || !end) {
        Alert.alert('Invalid date/time', 'Use YYYY-MM-DD dates and HH:mm times.');
        return;
      }
      if (end <= start) {
        Alert.alert('Invalid range', 'End time must be after the start time.');
        return;
      }

      payload = {
        title,
        description: form.description.trim(),
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        isAllDay: false,
        year: start.getFullYear(),
        month: start.getMonth() + 1,
        dayOfMonth: start.getDate(),
      };
    }

    setSaving(true);
    try {
      const eventId = editingEventId || id();
      await db.transact([tx.calendarItems[eventId].update(payload)]);
      setSelectedDate(parseYmdLocal(form.startDate) || selectedDate);
      closeModal();
    } catch (error) {
      setSaving(false);
      Alert.alert('Unable to save event', error?.message || 'Please try again.');
    }
  }

  function handleDelete() {
    if (!editingEventId) return;
    recordParentActivity();

    if (!canEditEvents) {
      void handoffToParentLogin('calendar:edit-event', 'Delete calendar event', {
        eventId: editingEventId,
        selectedDayKey,
      });
      return;
    }

    Alert.alert('Delete event?', 'This will permanently remove the selected calendar item.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSaving(true);
            try {
              await db.transact([tx.calendarItems[editingEventId].delete()]);
              closeModal();
            } catch (error) {
              setSaving(false);
              Alert.alert('Unable to delete event', error?.message || 'Please try again.');
            }
          })();
        },
      },
    ]);
  }

  return (
    <ScreenScaffold
      title="Calendar"
      subtitle="Phase 3 is now live with a real month grid, Bikram Samvat labels, and native add/edit/delete for all-day and timed events."
      accent={colors.accentCalendar}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        {
          label: connectionStatus === 'authenticated' ? 'Instant connected' : connectionStatus || 'Connecting',
          tone: connectionStatus === 'authenticated' ? 'success' : 'neutral',
        },
        {
          label: canEditEvents ? 'Parent edit mode' : 'Kid read only',
          tone: canEditEvents ? 'accent' : 'neutral',
        },
      ]}
    >
      <ScrollView
        style={styles.screenScroll}
        contentContainerStyle={styles.screenContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.monthHeaderCard}>
          <View>
            <Text style={styles.eyebrow}>Month View</Text>
            <Text style={styles.monthTitle}>{formatMonthTitle(viewMonth)}</Text>
            <Text style={styles.monthSub}>Tap a day to review events. Parent mode can add or edit calendar items.</Text>
          </View>
          <View style={styles.monthHeaderButtons}>
            <Pressable
              testID="calendar-prev-month"
              accessibilityRole="button"
              accessibilityLabel="Show previous month"
              style={styles.navButton}
              onPress={() => {
                recordParentActivity();
                setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
              }}
            >
              <Text style={styles.navButtonText}>Prev</Text>
            </Pressable>
            <Pressable
              testID="calendar-today"
              accessibilityRole="button"
              accessibilityLabel="Jump to today"
              style={styles.navButton}
              onPress={() => {
                recordParentActivity();
                const today = startOfDay(new Date());
                setViewMonth(startOfMonth(today));
                setSelectedDate(today);
              }}
            >
              <Text style={styles.navButtonText}>Today</Text>
            </Pressable>
            <Pressable
              testID="calendar-next-month"
              accessibilityRole="button"
              accessibilityLabel="Show next month"
              style={styles.navButton}
              onPress={() => {
                recordParentActivity();
                setViewMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
              }}
            >
              <Text style={styles.navButtonText}>Next</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.calendarCard}>
          <View style={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((label) => (
              <Text key={label} style={styles.weekdayLabel}>
                {label}
              </Text>
            ))}
          </View>
          <View style={styles.gridWrap}>
            {grid.weeks.map((week, weekIndex) => (
              <View key={`week-${weekIndex}`} style={styles.weekRow}>
                {week.map((day, dayIndex) => {
                  const dayKey = formatYmd(day);
                  const inMonth = day.getMonth() === viewMonth.getMonth();
                  const selected = dayKey === selectedDayKey;
                  const today = dayKey === formatYmd(new Date());
                  const dayEvents = eventsByDayKey.get(dayKey) || [];
                  const bikramMeta = bikramMetaByDayKey.get(dayKey);

                  return (
                    <Pressable
                      key={dayKey}
                      testID={`calendar-day-${dayKey}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Open calendar day ${formatDayTitle(day)}`}
                      style={[
                        styles.dayCell,
                        !inMonth && styles.dayCellOutsideMonth,
                        dayIndex > 0 && styles.dayCellDividerLeft,
                        weekIndex > 0 && styles.dayCellDividerTop,
                        selected && styles.dayCellSelected,
                        today && styles.dayCellToday,
                        (selected || today) && styles.dayCellLayered,
                      ]}
                      onPress={() => handleSelectDate(day)}
                    >
                      <View style={styles.dayHeader}>
                        <View style={styles.dayHeaderLeft}>
                          <Text
                            style={[
                              styles.dayNumber,
                              !inMonth && styles.dayNumberOutsideMonth,
                              selected && styles.dayNumberSelected,
                            ]}
                          >
                            {day.getDate()}
                          </Text>
                          {bikramMeta?.showGregorianMonthTransition ? (
                            <Text
                              style={[
                                styles.gregorianMonthTransition,
                                !inMonth && styles.gregorianMonthTransitionMuted,
                                selected && styles.gregorianMonthTransitionSelected,
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
                                !inMonth && styles.bsLabelMuted,
                                selected && styles.bsLabelSelected,
                              ]}
                              numberOfLines={1}
                            >
                              {bikramMeta.monthNameDevanagari}
                            </Text>
                          ) : null}
                          {bikramMeta ? (
                            <Text
                              style={[styles.bsDayNumber, !inMonth && styles.bsLabelMuted, selected && styles.bsLabelSelected]}
                              numberOfLines={1}
                            >
                              {bikramMeta.dayLabelDevanagari}
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      <View style={styles.dayEventDots}>
                        {dayEvents.slice(0, 3).map((event) => (
                          <View
                            key={`${dayKey}-${event.id}`}
                            style={[
                              styles.dayEventDot,
                              event.isAllDay ? styles.dayEventDotAllDay : styles.dayEventDotTimed,
                            ]}
                          />
                        ))}
                        {dayEvents.length > 3 ? (
                          <Text style={[styles.moreCount, selected && styles.moreCountSelected]}>+{dayEvents.length - 3}</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
        <View style={styles.panel}>
          <View style={styles.panelHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.panelTitle}>{formatDayTitle(selectedDate)}</Text>
              <Text style={styles.metaText}>
                {selectedDayEvents.length} event{selectedDayEvents.length === 1 ? '' : 's'}
                {currentUser?.name ? ` • viewing as ${currentUser.name}` : ''}
              </Text>
            </View>
            <Pressable
              testID="calendar-add-selected-day"
              accessibilityRole="button"
              accessibilityLabel="Add event for selected day"
              onPress={() => {
                void handleAddEventPress(selectedDate);
              }}
              style={[styles.addButton, !canEditEvents && styles.addButtonLocked]}
            >
              <Text style={[styles.addButtonText, !canEditEvents && styles.addButtonTextLocked]}>
                {canEditEvents ? 'Add Event' : 'Parent Login'}
              </Text>
            </Pressable>
          </View>

          {calendarQuery.error ? (
            <Text style={styles.errorText}>{calendarQuery.error.message || 'Failed to load calendar items'}</Text>
          ) : calendarQuery.isLoading ? (
            <Text style={styles.emptyText}>Loading calendar items...</Text>
          ) : selectedDayEvents.length === 0 ? (
            <Text style={styles.emptyText}>
              No events on this day yet. {canEditEvents ? 'Tap Add Event to create one.' : 'Switch to parent mode to add or edit events.'}
            </Text>
          ) : (
            <View style={styles.eventList}>
              {selectedDayEvents.map((event) => (
                <Pressable
                  key={event.id}
                  testID={`calendar-event-row-${event.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${canEditEvents ? 'Edit' : 'View'} calendar event ${event.title || 'Untitled'}`}
                  onPress={() => {
                    void handleOpenEventPress(event);
                  }}
                  style={[styles.eventCard, !canEditEvents && styles.eventCardReadOnly]}
                >
                  <View style={styles.eventRowTop}>
                    <Text style={styles.eventTitle}>{event.title || 'Untitled event'}</Text>
                    <View style={[styles.eventBadge, event.isAllDay ? styles.eventBadgeAllDay : styles.eventBadgeTimed]}>
                      <Text style={[styles.eventBadgeText, event.isAllDay ? styles.eventBadgeTextAllDay : styles.eventBadgeTextTimed]}>
                        {event.isAllDay ? 'All day' : 'Timed'}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.eventMeta}>{formatEventRangeLabel(event)}</Text>
                  {!!event.description ? <Text style={styles.eventDescription}>{event.description}</Text> : null}
                  {!canEditEvents ? <Text style={styles.eventHint}>Read only in kid mode</Text> : null}
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={closeModal}
        presentationStyle="overFullScreen"
      >
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 0}
            style={styles.modalKeyboardLayer}
          >
            <Pressable style={styles.modalScrim} onPress={closeModal} />
            <View style={styles.modalSheet}>
              <View style={styles.modalHandle} />
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>{editingEventId ? 'Edit Event' : 'Add Event'}</Text>
                  <Text style={styles.modalSubtitle}>
                    {canEditEvents
                      ? 'All-day events store exclusive end dates to match web semantics.'
                      : 'Read only in kid mode. Switch to parent mode to save changes.'}
                  </Text>
                </View>
                <Pressable
                  testID="calendar-close-modal"
                  accessibilityRole="button"
                  accessibilityLabel="Close event editor"
                  onPress={closeModal}
                  style={styles.modalCloseButton}
                >
                  <Text style={styles.modalCloseText}>Close</Text>
                </Pressable>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[
                  styles.modalForm,
                  keyboardVisible ? styles.modalFormKeyboardOpen : null,
                ]}
              >
                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>Title</Text>
                  <TextInput
                    testID="calendar-input-title"
                    accessibilityLabel="Calendar event title"
                    value={form.title}
                    editable={canEditEvents && !saving}
                    onChangeText={(value) => handleChange('title', value)}
                    placeholder="Family dinner"
                    placeholderTextColor="#A39A8A"
                    style={[styles.textInput, !canEditEvents && styles.inputDisabled]}
                    onFocus={recordParentActivity}
                  />
                </View>

                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>Description</Text>
                  <TextInput
                    testID="calendar-input-description"
                    accessibilityLabel="Calendar event description"
                    value={form.description}
                    editable={canEditEvents && !saving}
                    onChangeText={(value) => handleChange('description', value)}
                    placeholder="Optional details"
                    placeholderTextColor="#A39A8A"
                    style={[styles.textInput, styles.textArea, !canEditEvents && styles.inputDisabled]}
                    multiline
                    textAlignVertical="top"
                    onFocus={recordParentActivity}
                  />
                </View>

                <Pressable
                  testID="calendar-toggle-all-day"
                  accessibilityRole="switch"
                  accessibilityState={{ checked: !!form.isAllDay, disabled: !canEditEvents || saving }}
                  disabled={!canEditEvents || saving}
                  onPress={() => handleChange('isAllDay', !form.isAllDay)}
                  style={[styles.switchRow, (!canEditEvents || saving) && styles.switchRowDisabled]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchTitle}>All-day event</Text>
                    <Text style={styles.switchMeta}>
                      {form.isAllDay ? 'Date-only event with exclusive stored end date' : 'Timed event with local timezone timestamps'}
                    </Text>
                  </View>
                  <Switch
                    value={!!form.isAllDay}
                    onValueChange={(value) => handleChange('isAllDay', value)}
                    disabled={!canEditEvents || saving}
                    trackColor={{ false: '#D4CBB9', true: '#A9DDD7' }}
                    thumbColor={form.isAllDay ? colors.accentCalendar : '#F9F6EE'}
                  />
                </Pressable>

                <View style={styles.inlineFields}>
                  <View style={[styles.fieldBlock, styles.inlineField]}>
                    <Text style={styles.fieldLabel}>Start Date</Text>
                    <TextInput
                      testID="calendar-input-start-date"
                      accessibilityLabel="Event start date"
                      value={form.startDate}
                      editable={canEditEvents && !saving}
                      onChangeText={(value) => handleChange('startDate', value)}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#A39A8A"
                      style={[styles.textInput, !canEditEvents && styles.inputDisabled]}
                      keyboardType="numbers-and-punctuation"
                      autoCapitalize="none"
                      autoCorrect={false}
                      onFocus={recordParentActivity}
                    />
                  </View>

                  <View style={[styles.fieldBlock, styles.inlineField]}>
                    <Text style={styles.fieldLabel}>{form.isAllDay ? 'End Date (inclusive)' : 'End Date'}</Text>
                    <TextInput
                      testID="calendar-input-end-date"
                      accessibilityLabel="Event end date"
                      value={form.endDate}
                      editable={canEditEvents && !saving}
                      onChangeText={(value) => handleChange('endDate', value)}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor="#A39A8A"
                      style={[styles.textInput, !canEditEvents && styles.inputDisabled]}
                      keyboardType="numbers-and-punctuation"
                      autoCapitalize="none"
                      autoCorrect={false}
                      onFocus={recordParentActivity}
                    />
                  </View>
                </View>

                {!form.isAllDay ? (
                  <View style={styles.inlineFields}>
                    <View style={[styles.fieldBlock, styles.inlineField]}>
                      <Text style={styles.fieldLabel}>Start Time</Text>
                      <TextInput
                        testID="calendar-input-start-time"
                        accessibilityLabel="Event start time"
                        value={form.startTime}
                        editable={canEditEvents && !saving}
                        onChangeText={(value) => handleChange('startTime', value)}
                        placeholder="HH:mm"
                        placeholderTextColor="#A39A8A"
                        style={[styles.textInput, !canEditEvents && styles.inputDisabled]}
                        keyboardType="numbers-and-punctuation"
                        autoCapitalize="none"
                        autoCorrect={false}
                        onFocus={recordParentActivity}
                      />
                    </View>
                    <View style={[styles.fieldBlock, styles.inlineField]}>
                      <Text style={styles.fieldLabel}>End Time</Text>
                      <TextInput
                        testID="calendar-input-end-time"
                        accessibilityLabel="Event end time"
                        value={form.endTime}
                        editable={canEditEvents && !saving}
                        onChangeText={(value) => handleChange('endTime', value)}
                        placeholder="HH:mm"
                        placeholderTextColor="#A39A8A"
                        style={[styles.textInput, !canEditEvents && styles.inputDisabled]}
                        keyboardType="numbers-and-punctuation"
                        autoCapitalize="none"
                        autoCorrect={false}
                        onFocus={recordParentActivity}
                      />
                    </View>
                  </View>
                ) : null}

                <View style={styles.modalActions}>
                  {editingEventId ? (
                    <Pressable
                      testID="calendar-delete-event"
                      accessibilityRole="button"
                      accessibilityLabel="Delete calendar event"
                      disabled={saving}
                      onPress={() => {
                        handleDelete();
                      }}
                      style={[
                        styles.secondaryDangerButton,
                        saving && styles.actionButtonDisabled,
                        !canEditEvents && styles.secondaryDangerLocked,
                      ]}
                    >
                      <Text style={[styles.secondaryDangerText, (saving || !canEditEvents) && styles.actionTextDisabled]}>
                        Delete
                      </Text>
                    </Pressable>
                  ) : (
                    <View />
                  )}

                  <View style={styles.modalActionRight}>
                    <Pressable
                      testID="calendar-cancel-save"
                      accessibilityRole="button"
                      accessibilityLabel="Cancel event editing"
                      onPress={closeModal}
                      style={styles.secondaryButton}
                    >
                      <Text style={styles.secondaryButtonText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      testID="calendar-save-event"
                      accessibilityRole="button"
                      accessibilityLabel="Save calendar event"
                      disabled={saving}
                      onPress={() => {
                        void handleSave();
                      }}
                      style={[styles.primaryButton, saving && styles.actionButtonDisabled, !canEditEvents && styles.primaryButtonLocked]}
                    >
                      <Text style={[styles.primaryButtonText, (saving || !canEditEvents) && styles.actionTextDisabled]}>
                        {saving ? 'Saving...' : canEditEvents ? (editingEventId ? 'Save' : 'Create') : 'Parent Login'}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </ScreenScaffold>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
  screenScroll: {
    flex: 1,
  },
  screenContent: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  monthHeaderCard: {
    backgroundColor: '#EAF7F5',
    borderWidth: 1,
    borderColor: '#B9DDD8',
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  eyebrow: {
    color: colors.accentCalendar,
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  monthTitle: {
    marginTop: 2,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: colors.ink,
  },
  monthSub: {
    marginTop: 4,
    color: colors.inkMuted,
    lineHeight: 19,
  },
  monthHeaderButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  navButton: {
    borderWidth: 1,
    borderColor: '#A3D3CE',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  navButtonText: {
    color: colors.accentCalendar,
    fontWeight: '700',
    fontSize: 13,
  },
  calendarCard: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    gap: 4,
    ...shadows.card,
  },
  weekdayRow: {
    flexDirection: 'row',
    gap: 0,
    paddingHorizontal: 0,
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    color: colors.inkMuted,
    fontWeight: '700',
    fontSize: 12,
  },
  gridWrap: {
    gap: 0,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#DAD0BF',
    borderWidth: 1,
    borderColor: '#DAD0BF',
  },
  weekRow: {
    flexDirection: 'row',
    gap: 0,
  },
  dayCell: {
    flex: 1,
    minHeight: 66,
    borderRadius: 0,
    borderWidth: 0,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 3,
    paddingVertical: 3,
    gap: 2,
  },
  dayCellDividerLeft: {
    borderLeftWidth: 1,
    borderLeftColor: '#DAD0BF',
  },
  dayCellDividerTop: {
    borderTopWidth: 1,
    borderTopColor: '#DAD0BF',
  },
  dayCellOutsideMonth: {
    backgroundColor: '#F7F2E8',
  },
  dayCellSelected: {
    backgroundColor: '#E9F8F6',
  },
  dayCellToday: {
    backgroundColor: '#F3FBFA',
  },
  dayCellLayered: {
    zIndex: 1,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 2,
    minHeight: 26,
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
    color: '#9D937F',
  },
  dayNumberSelected: {
    color: colors.accentCalendar,
  },
  gregorianMonthTransition: {
    fontSize: 7,
    lineHeight: 9,
    fontWeight: '700',
    color: '#7F7565',
  },
  gregorianMonthTransitionMuted: {
    color: '#A79D8D',
  },
  gregorianMonthTransitionSelected: {
    color: colors.accentCalendar,
  },
  bsMonthTransition: {
    fontSize: 7,
    fontWeight: '700',
    color: '#5B6C69',
    lineHeight: 9,
    maxWidth: '100%',
  },
  bsDayNumber: {
    fontSize: 9,
    fontWeight: '700',
    color: '#5B6C69',
    lineHeight: 11,
  },
  bsLabelMuted: {
    color: '#9BA39A',
  },
  bsLabelSelected: {
    color: colors.accentCalendar,
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
    backgroundColor: '#E0884A',
  },
  moreCount: {
    fontSize: 9,
    color: colors.inkMuted,
    fontWeight: '700',
  },
  moreCountSelected: {
    color: colors.accentCalendar,
  },
  panel: {
    backgroundColor: colors.panelElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  panelTitle: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 18,
    lineHeight: 23,
  },
  metaText: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  addButton: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#A3D3CE',
    backgroundColor: '#E7F7F5',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  addButtonLocked: {
    backgroundColor: '#EEE9DE',
    borderColor: '#D8CDBA',
  },
  addButtonText: {
    color: colors.accentCalendar,
    fontWeight: '800',
    fontSize: 13,
  },
  addButtonTextLocked: {
    color: '#7A7264',
  },
  emptyText: {
    color: colors.inkMuted,
    lineHeight: 20,
  },
  errorText: {
    color: colors.danger,
    lineHeight: 20,
    fontWeight: '600',
  },
  eventList: {
    gap: spacing.sm,
  },
  eventCard: {
    borderWidth: 1,
    borderColor: '#D8CFBE',
    borderRadius: radii.md,
    backgroundColor: '#FFFDF7',
    padding: spacing.md,
    gap: 6,
  },
  eventCardReadOnly: {
    backgroundColor: '#FBF7EF',
  },
  eventRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  eventTitle: {
    flex: 1,
    color: colors.ink,
    fontWeight: '800',
    fontSize: 15,
  },
  eventBadge: {
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
  },
  eventBadgeAllDay: {
    backgroundColor: '#E8F6F4',
    borderColor: '#B5DDD8',
  },
  eventBadgeTimed: {
    backgroundColor: '#FFF0E5',
    borderColor: '#F2C8A7',
  },
  eventBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  eventBadgeTextAllDay: {
    color: colors.accentCalendar,
  },
  eventBadgeTextTimed: {
    color: '#B45E22',
  },
  eventMeta: {
    color: colors.inkMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  eventDescription: {
    color: colors.ink,
    lineHeight: 18,
  },
  eventHint: {
    color: '#7A7264',
    fontSize: 11,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(19, 16, 12, 0.35)',
    justifyContent: 'flex-end',
  },
  modalKeyboardLayer: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalScrim: {
    flex: 1,
  },
  modalSheet: {
    maxHeight: '88%',
    backgroundColor: colors.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.sm,
  },
  modalHandle: {
    alignSelf: 'center',
    width: 46,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#D6CDBB',
    marginBottom: 4,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  modalTitle: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 21,
  },
  modalSubtitle: {
    color: colors.inkMuted,
    lineHeight: 18,
    marginTop: 4,
  },
  modalCloseButton: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  modalCloseText: {
    fontWeight: '700',
    color: colors.inkMuted,
  },
  modalForm: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  modalFormKeyboardOpen: {
    paddingBottom: spacing.xxl,
  },
  fieldBlock: {
    gap: 6,
  },
  fieldLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#D8CEBB',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: colors.ink,
    fontSize: 15,
  },
  textArea: {
    minHeight: 88,
    paddingTop: 10,
  },
  inputDisabled: {
    backgroundColor: '#F4EEE1',
    color: '#7B7263',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: '#DAD0BE',
    borderRadius: radii.md,
    backgroundColor: '#FFFDF7',
    padding: spacing.md,
  },
  switchRowDisabled: {
    backgroundColor: '#F6F1E7',
  },
  switchTitle: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 15,
  },
  switchMeta: {
    marginTop: 2,
    color: colors.inkMuted,
    lineHeight: 17,
    fontSize: 12,
  },
  inlineFields: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inlineField: {
    flex: 1,
  },
  modalActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  modalActionRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  secondaryButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#D5CCBB',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    color: colors.inkMuted,
    fontWeight: '700',
  },
  primaryButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2A766E',
    backgroundColor: colors.accentCalendar,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryButtonLocked: {
    backgroundColor: '#ECE7DD',
    borderColor: '#D8CDBA',
  },
  primaryButtonText: {
    color: '#F7FFFD',
    fontWeight: '800',
  },
  secondaryDangerButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E4B4AB',
    backgroundColor: '#FFF2F0',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryDangerLocked: {
    backgroundColor: '#EFE9DE',
    borderColor: '#D9CDBA',
  },
  secondaryDangerText: {
    color: colors.danger,
    fontWeight: '800',
  },
  actionButtonDisabled: {
    opacity: 0.55,
  },
  actionTextDisabled: {
    color: '#7E7668',
  },
  });
