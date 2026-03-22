import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { id, tx } from '@instantdb/react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
  SHARED_ROUTINE_MARKER_PRESETS,
  formatDateKeyUTC,
  getFamilyDayDateUTC,
  parseSharedScheduleSettings,
} from '@family-organizer/shared-core';
import { ParentAccessNotice, SubscreenScaffold } from '../../src/components/SubscreenScaffold';
import { useAppSession } from '../../src/providers/AppProviders';
import { useParentActionGate } from '../../src/hooks/useParentActionGate';
import { clearPendingParentAction } from '../../src/lib/session-prefs';
import { radii, spacing, withAlpha } from '../../src/theme/tokens';
import { useAppTheme } from '../../src/theme/ThemeProvider';

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function formatDayLabel(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

function formatMonthDay(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatLongDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function RoutineMarkersScreen() {
  const searchParams = useLocalSearchParams();
  const { requireParentAction } = useParentActionGate();
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const {
    db,
    currentUser,
    principalType,
    isAuthenticated,
    instantReady,
    isOnline,
    connectionStatus,
  } = useAppSession();
  const [selectedDate, setSelectedDate] = useState(() => getFamilyDayDateUTC(new Date()));

  useEffect(() => {
    if (firstParam(searchParams.resumeParentAction) !== '1') return;
    if (principalType !== 'parent') return;
    void clearPendingParentAction();
  }, [principalType, searchParams.resumeParentAction]);

  async function handoffToParent() {
    await requireParentAction({
      actionId: 'more:open:routineMarkers',
      actionLabel: 'Routine Markers',
      payload: { href: '/more/routine-markers' },
      returnPath: '/more/routine-markers',
    });
  }

  const selectedDateKey = useMemo(() => formatDateKeyUTC(selectedDate), [selectedDate]);
  const dateStrip = useMemo(() => {
    return Array.from({ length: 7 }).map((_, index) => {
      const offset = index - 3;
      return new Date(selectedDate.getTime() + offset * 86400000);
    });
  }, [selectedDate]);

  const routineQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          routineMarkerStatuses: {},
          settings: {
            $: {
              where: {
                name: HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
              },
            },
          },
        }
      : null
  );

  const routineMarkerStatuses = useMemo(
    () => routineQuery.data?.routineMarkerStatuses || [],
    [routineQuery.data?.routineMarkerStatuses]
  );
  const scheduleSettings = useMemo(
    () => parseSharedScheduleSettings(routineQuery.data?.settings?.[0]?.value || null),
    [routineQuery.data?.settings]
  );
  const routineMarkers = scheduleSettings?.routineMarkers || SHARED_ROUTINE_MARKER_PRESETS;
  const todayDateKey = formatDateKeyUTC(getFamilyDayDateUTC(new Date(), scheduleSettings));
  const canEditRoutineMarkers = selectedDateKey === todayDateKey;

  const routineMarkerStatusByKey = useMemo(() => {
    const next = new Map();
    for (const status of routineMarkerStatuses) {
      if (String(status?.date || '') !== selectedDateKey) continue;
      if (status?.markerKey) {
        next.set(status.markerKey, status);
      }
    }
    return next;
  }, [routineMarkerStatuses, selectedDateKey]);

  async function markRoutineMarkerHappened(markerKey) {
    if (!canEditRoutineMarkers) return;

    const recordKey = `${selectedDateKey}:${markerKey}`;
    const existing = (routineMarkerStatuses || []).find((status) => String(status?.key || '') === recordKey);
    const timestamp = new Date().toISOString();

    try {
      if (existing?.id) {
        await db.transact([
          tx.routineMarkerStatuses[existing.id].update({
            startedAt: timestamp,
            completedAt: timestamp,
            startedById: currentUser?.id || null,
            completedById: currentUser?.id || null,
          }),
        ]);
      } else {
        const statusId = id();
        await db.transact([
          tx.routineMarkerStatuses[statusId].update({
            key: recordKey,
            markerKey,
            date: selectedDateKey,
            startedAt: timestamp,
            completedAt: timestamp,
            startedById: currentUser?.id || null,
            completedById: currentUser?.id || null,
          }),
        ]);
      }
    } catch (error) {
      Alert.alert('Unable to update marker', error?.message || 'Please try again.');
    }
  }

  async function clearRoutineMarkerStatus(markerKey) {
    if (!canEditRoutineMarkers) return;

    const recordKey = `${selectedDateKey}:${markerKey}`;
    const existing = (routineMarkerStatuses || []).find((status) => String(status?.key || '') === recordKey);
    if (!existing?.id) return;

    try {
      await db.transact([
        tx.routineMarkerStatuses[existing.id].update({
          startedAt: null,
          completedAt: null,
          startedById: null,
          completedById: null,
        }),
      ]);
    } catch (error) {
      Alert.alert('Unable to reset marker', error?.message || 'Please try again.');
    }
  }

  if (principalType !== 'parent') {
    return (
      <SubscreenScaffold
        title="Routine Markers"
        subtitle="Routine markers are parent-managed because they affect the household-wide schedule rather than one person’s chores."
        accent={colors.accentMore}
        statusChips={[
          { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
          { label: principalType === 'parent' ? 'Parent mode' : 'Kid mode', tone: 'neutral' },
        ]}
      >
        <ParentAccessNotice
          body="Log in as a parent to review or update household routine markers."
          onContinue={handoffToParent}
        />
      </SubscreenScaffold>
    );
  }

  return (
    <SubscreenScaffold
      title="Routine Markers"
      subtitle="Household-wide markers like wake-up and lights-out live here now instead of inside the chores list."
      accent={colors.accentMore}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        {
          label: connectionStatus === 'authenticated' ? 'Instant connected' : connectionStatus || 'Connecting',
          tone: connectionStatus === 'authenticated' ? 'success' : 'neutral',
        },
        { label: canEditRoutineMarkers ? 'Today is editable' : 'History view', tone: canEditRoutineMarkers ? 'accent' : 'neutral' },
      ]}
      action={
        <View style={styles.dateBadge}>
          <Text style={styles.dateBadgeText}>{formatMonthDay(selectedDate)}</Text>
        </View>
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEyebrow}>Household schedule</Text>
          <Text style={styles.summaryTitle}>{canEditRoutineMarkers ? 'Mark today as it happens' : 'Review a different day'}</Text>
          <Text style={styles.summaryBody}>
            {canEditRoutineMarkers
              ? 'Use this page to capture routine milestones without crowding the chores tab.'
              : 'Past and future dates stay read-only so the live routine log remains trustworthy.'}
          </Text>
        </View>

        <View style={styles.dateCard}>
          <Text style={styles.sectionTitle}>Choose a date</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
            {dateStrip.map((date) => {
              const dateKey = formatDateKeyUTC(date);
              const isSelected = dateKey === selectedDateKey;
              const isToday = dateKey === todayDateKey;
              return (
                <Pressable
                  key={date.toISOString()}
                  testID={`routine-markers-date-chip-${dateKey}`}
                  accessibilityRole="button"
                  accessibilityLabel={`View routine markers for ${formatLongDate(date)}`}
                  style={[styles.dateChip, isSelected && styles.dateChipSelected]}
                  onPress={() => setSelectedDate(date)}
                >
                  <Text style={[styles.dateChipDay, isSelected && styles.dateChipTextSelected]}>{formatDayLabel(date)}</Text>
                  <Text style={[styles.dateChipDate, isSelected && styles.dateChipTextSelected]}>{formatMonthDay(date)}</Text>
                  {!isSelected && isToday ? <View style={styles.dateChipTodayDot} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        {routineQuery.error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Couldn&apos;t load routine markers</Text>
            <Text style={styles.emptyBody}>{routineQuery.error.message || 'Please try again.'}</Text>
          </View>
        ) : routineMarkers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No routine markers configured</Text>
            <Text style={styles.emptyBody}>Add routine markers in the shared household schedule settings to manage them here.</Text>
          </View>
        ) : (
          routineMarkers.map((marker) => {
            const status = routineMarkerStatusByKey.get(marker.key);
            const completedLabel = status?.completedAt
              ? new Date(status.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
              : status?.startedAt
              ? new Date(status.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
              : 'Not marked';

            return (
              <View key={marker.key} style={styles.markerCard}>
                <View style={styles.markerHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.markerTitle}>{marker.label}</Text>
                    <Text style={styles.markerMeta}>{marker.defaultTime || '--:--'}</Text>
                  </View>
                  <View style={[styles.statusBadge, status?.completedAt ? styles.statusBadgeDone : styles.statusBadgePending]}>
                    <Text style={[styles.statusBadgeText, status?.completedAt ? styles.statusBadgeTextDone : styles.statusBadgeTextPending]}>
                      {status?.completedAt ? 'Done' : 'Open'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.markerDetail}>Happened: {completedLabel}</Text>
                {!canEditRoutineMarkers ? (
                  <Text style={styles.readOnlyHint}>Only today&apos;s routine markers can be edited from mobile.</Text>
                ) : null}

                <View style={styles.markerActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Mark ${marker.label} happened`}
                    onPress={() => {
                      void markRoutineMarkerHappened(marker.key);
                    }}
                    disabled={!canEditRoutineMarkers}
                    style={[styles.primaryButton, !canEditRoutineMarkers && styles.buttonDisabled]}
                  >
                    <Text style={styles.primaryButtonText}>Mark happened</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Reset ${marker.label}`}
                    onPress={() => {
                      void clearRoutineMarkerStatus(marker.key);
                    }}
                    disabled={!canEditRoutineMarkers}
                    style={[styles.secondaryButton, !canEditRoutineMarkers && styles.buttonDisabled]}
                  >
                    <Text style={styles.secondaryButtonText}>Reset</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SubscreenScaffold>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    content: {
      gap: spacing.md,
      paddingBottom: spacing.lg,
    },
    dateBadge: {
      minHeight: 38,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      backgroundColor: withAlpha(colors.accentMore, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accentMore, 0.24),
      alignItems: 'center',
      justifyContent: 'center',
    },
    dateBadgeText: {
      color: colors.accentMore,
      fontWeight: '700',
    },
    summaryCard: {
      backgroundColor: withAlpha(colors.accentMore, 0.1),
      borderWidth: 1,
      borderColor: withAlpha(colors.accentMore, 0.22),
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    summaryEyebrow: {
      color: colors.accentMore,
      textTransform: 'uppercase',
      fontWeight: '800',
      fontSize: 12,
      letterSpacing: 0.8,
    },
    summaryTitle: {
      color: colors.ink,
      fontSize: 24,
      fontWeight: '800',
    },
    summaryBody: {
      color: colors.inkMuted,
      lineHeight: 18,
    },
    dateCard: {
      backgroundColor: colors.panelElevated,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    sectionTitle: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 15,
    },
    dateStrip: {
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    dateChip: {
      minWidth: 76,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 18,
      backgroundColor: withAlpha(colors.canvasText, 0.06),
      borderWidth: 1,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    dateChipSelected: {
      backgroundColor: colors.accentMore,
      borderColor: colors.accentMore,
    },
    dateChipDay: {
      color: colors.inkMuted,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      fontWeight: '800',
    },
    dateChipDate: {
      color: colors.ink,
      fontSize: 14,
      fontWeight: '800',
      marginTop: 2,
    },
    dateChipTextSelected: {
      color: colors.onAccent,
    },
    dateChipTodayDot: {
      position: 'absolute',
      bottom: 6,
      width: 5,
      height: 5,
      borderRadius: radii.pill,
      backgroundColor: colors.accentMore,
    },
    markerCard: {
      backgroundColor: colors.panelElevated,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radii.md,
      padding: spacing.md,
      gap: spacing.sm,
    },
    markerHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    markerTitle: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 16,
    },
    markerMeta: {
      color: colors.inkMuted,
      fontSize: 12,
      marginTop: 2,
      textTransform: 'uppercase',
    },
    statusBadge: {
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
    },
    statusBadgeDone: {
      backgroundColor: withAlpha(colors.success, 0.12),
      borderColor: withAlpha(colors.success, 0.24),
    },
    statusBadgePending: {
      backgroundColor: withAlpha(colors.warning, 0.12),
      borderColor: withAlpha(colors.warning, 0.24),
    },
    statusBadgeText: {
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.7,
    },
    statusBadgeTextDone: {
      color: colors.success,
    },
    statusBadgeTextPending: {
      color: colors.warning,
    },
    markerDetail: {
      color: colors.inkMuted,
      fontSize: 13,
    },
    readOnlyHint: {
      color: colors.inkMuted,
      fontSize: 12,
    },
    markerActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    primaryButton: {
      minHeight: 38,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      backgroundColor: withAlpha(colors.accentMore, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accentMore, 0.24),
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: {
      color: colors.accentMore,
      fontWeight: '700',
    },
    secondaryButton: {
      minHeight: 38,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonText: {
      color: colors.inkMuted,
      fontWeight: '700',
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    emptyCard: {
      backgroundColor: colors.panelElevated,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radii.md,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    emptyTitle: {
      color: colors.ink,
      fontSize: 18,
      fontWeight: '800',
    },
    emptyBody: {
      color: colors.inkMuted,
      lineHeight: 18,
    },
  });
