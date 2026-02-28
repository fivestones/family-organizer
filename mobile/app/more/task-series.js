import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAppSession } from '../../src/providers/AppProviders';
import { radii, spacing, withAlpha } from '../../src/theme/tokens';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { ParentAccessNotice, SubscreenScaffold } from '../../src/components/SubscreenScaffold';
import { clearPendingParentAction } from '../../src/lib/session-prefs';
import { useParentActionGate } from '../../src/hooks/useParentActionGate';

const STATUS_FILTERS = ['all', 'draft', 'pending', 'in_progress', 'archived'];

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function firstRef(value) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function formatDateLabel(value) {
  if (!value) return 'No date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No date';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function prettyStatus(status) {
  if (status === 'in_progress') return 'In Progress';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function statusToneStyle(colors, status) {
  switch (status) {
    case 'draft':
      return { bg: colors.panel, text: colors.inkMuted, border: colors.line };
    case 'pending':
      return { bg: withAlpha(colors.warning, 0.12), text: colors.warning, border: withAlpha(colors.warning, 0.26) };
    case 'archived':
      return { bg: withAlpha(colors.locked, 0.18), text: colors.inkMuted, border: withAlpha(colors.locked, 0.34) };
    default:
      return { bg: withAlpha(colors.success, 0.12), text: colors.success, border: withAlpha(colors.success, 0.26) };
  }
}

export default function TaskSeriesScreen() {
  const searchParams = useLocalSearchParams();
  const { requireParentAction } = useParentActionGate();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    db,
    isAuthenticated,
    instantReady,
    principalType,
    isOnline,
    connectionStatus,
    currentUser,
  } = useAppSession();
  const [statusFilter, setStatusFilter] = useState('all');

  useEffect(() => {
    if (firstParam(searchParams.resumeParentAction) !== '1') return;
    if (principalType !== 'parent') return;
    void clearPendingParentAction();
  }, [principalType, searchParams.resumeParentAction]);

  const taskSeriesQuery = db.useQuery(
    isAuthenticated && instantReady && principalType === 'parent'
      ? {
          taskSeries: {
            tasks: {},
            familyMember: {},
            scheduledActivity: {},
          },
        }
      : null
  );

  const enrichedSeries = useMemo(() => {
    const today = new Date();
    const seriesList = [...(taskSeriesQuery.data?.taskSeries || [])].sort((a, b) => {
      const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
      const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
      return bTime - aTime;
    });
    const baseMap = new Map();
    const statusCache = new Map();

    for (const series of seriesList) {
      const tasks = series.tasks || [];
      const nonDayBreakTasks = tasks.filter((task) => !task.isDayBreak);
      const completedTasks = nonDayBreakTasks.filter((task) => task.isCompleted).length;
      const assignee = firstRef(series.familyMember);
      const scheduledActivity = firstRef(series.scheduledActivity);
      const effectiveStartDate = series.startDate || scheduledActivity?.startDate || null;
      const lastScheduledDate = series.targetEndDate || scheduledActivity?.endDate || null;

      baseMap.set(series.id, {
        series,
        assignee,
        scheduledActivity,
        totalTasks: nonDayBreakTasks.length,
        completedTasks,
        effectiveStartDate,
        lastScheduledDate,
        dependsOnSeriesId: series.dependsOnSeriesId || null,
      });
    }

    function computeStatus(seriesId) {
      if (statusCache.has(seriesId)) return statusCache.get(seriesId);

      const info = baseMap.get(seriesId);
      if (!info) {
        statusCache.set(seriesId, 'draft');
        return 'draft';
      }

      const allCompleted = info.totalTasks > 0 && info.completedTasks === info.totalTasks;
      const hasAssignee = Boolean(info.assignee?.id);
      const hasScheduledActivity = Boolean(info.scheduledActivity?.id);

      let status = 'draft';

      if (!hasAssignee || !hasScheduledActivity) {
        status = 'draft';
      } else if (info.dependsOnSeriesId) {
        status = computeStatus(info.dependsOnSeriesId) === 'archived' ? 'in_progress' : 'pending';
      } else if (info.effectiveStartDate && new Date(info.effectiveStartDate) > today) {
        status = 'pending';
      } else if (allCompleted) {
        status =
          !info.lastScheduledDate || new Date(info.lastScheduledDate) <= today ? 'archived' : 'in_progress';
      } else {
        status = 'in_progress';
      }

      statusCache.set(seriesId, status);
      return status;
    }

    return seriesList
      .map((series) => {
        const info = baseMap.get(series.id);
        const status = computeStatus(series.id);
        const progress = info.totalTasks > 0 ? info.completedTasks / info.totalTasks : 0;

        return {
          id: series.id,
          name: series.name || 'Untitled series',
          description: series.description || '',
          assigneeName: info.assignee?.name || 'Unassigned',
          scheduledActivityName: info.scheduledActivity?.title || 'No linked chore',
          updatedAt: series.updatedAt,
          targetEndDate: series.targetEndDate,
          totalTasks: info.totalTasks,
          completedTasks: info.completedTasks,
          progress,
          status,
        };
      })
      .filter((item) => (statusFilter === 'all' ? true : item.status === statusFilter));
  }, [statusFilter, taskSeriesQuery.data?.taskSeries]);

  async function handoffToParent() {
    await requireParentAction({
      actionId: 'more:open:taskSeries',
      actionLabel: 'Task Series Manager',
      payload: { href: '/more/task-series' },
      returnPath: '/more/task-series',
    });
  }

  if (principalType !== 'parent') {
    return (
      <SubscreenScaffold
        title="Task Series"
        subtitle="Manager access is parent-gated because it controls long-running homeschool/task plans."
        accent={colors.accentMore}
        statusChips={[
          { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
          { label: principalType === 'parent' ? 'Parent mode' : 'Kid mode', tone: 'neutral' },
        ]}
      >
        <ParentAccessNotice
          body="Log in as a parent to review task series status, assignees, and completion progress."
          onContinue={handoffToParent}
        />
      </SubscreenScaffold>
    );
  }

  return (
    <SubscreenScaffold
      title="Task Series"
      subtitle="Phase 3 now includes a native manager view for series status, assignees, and checklist progress."
      accent={colors.accentMore}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        {
          label: connectionStatus === 'authenticated' ? 'Instant connected' : connectionStatus || 'Connecting',
          tone: connectionStatus === 'authenticated' ? 'success' : 'neutral',
        },
        { label: currentUser?.name ? `Viewing as ${currentUser.name}` : 'Parent mode', tone: 'accent' },
      ]}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.filterPanel}>
          <Text style={styles.panelTitle}>Status Filter</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {STATUS_FILTERS.map((status) => {
              const selected = statusFilter === status;
              return (
                <Pressable
                  key={status}
                  accessibilityRole="button"
                  accessibilityLabel={`Filter task series by ${prettyStatus(status)}`}
                  style={[styles.filterChip, selected && styles.filterChipSelected]}
                  onPress={() => setStatusFilter(status)}
                >
                  <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                    {prettyStatus(status)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryEyebrow}>Series Overview</Text>
          <Text style={styles.summaryTitle}>{enrichedSeries.length} visible series</Text>
          <Text style={styles.summaryBody}>
            Draft and pending series stay visible so parents can spot missing assignees, future start dates, and fully completed archives at a glance.
          </Text>
        </View>

        {taskSeriesQuery.isLoading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Loading task series…</Text>
          </View>
        ) : taskSeriesQuery.error ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Could not load task series</Text>
            <Text style={styles.emptyBody}>{taskSeriesQuery.error.message}</Text>
          </View>
        ) : enrichedSeries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No task series match this filter</Text>
            <Text style={styles.emptyBody}>Create or edit a series on the web editor, then it will show up here with mobile status and progress.</Text>
          </View>
        ) : (
          enrichedSeries.map((series) => {
            const tone = statusToneStyle(colors, series.status);
            return (
              <View key={series.id} style={styles.seriesCard}>
                <View style={styles.seriesHeader}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.seriesName}>{series.name}</Text>
                    <Text style={styles.seriesMeta}>
                      {series.assigneeName} • {series.scheduledActivityName}
                    </Text>
                  </View>
                  <View style={[styles.statusPill, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                    <Text style={[styles.statusText, { color: tone.text }]}>{prettyStatus(series.status)}</Text>
                  </View>
                </View>

                {series.description ? <Text style={styles.seriesDescription}>{series.description}</Text> : null}

                <View style={styles.progressRow}>
                  <Text style={styles.progressLabel}>
                    {series.completedTasks}/{series.totalTasks} tasks complete
                  </Text>
                  <Text style={styles.progressPercent}>{Math.round(series.progress * 100)}%</Text>
                </View>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.max(6, series.progress * 100)}%` }]} />
                </View>

                <View style={styles.footerRow}>
                  <Text style={styles.footerMeta}>Updated {formatDateLabel(series.updatedAt)}</Text>
                  <Text style={styles.footerMeta}>Target {formatDateLabel(series.targetEndDate)}</Text>
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
  filterPanel: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  panelTitle: {
    color: colors.ink,
    fontWeight: '700',
  },
  filterRow: {
    gap: spacing.sm,
  },
  filterChip: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterChipSelected: {
    backgroundColor: withAlpha(colors.accentMore, 0.12),
    borderColor: withAlpha(colors.accentMore, 0.24),
  },
  filterChipText: {
    color: colors.inkMuted,
    fontWeight: '700',
    fontSize: 12,
  },
  filterChipTextSelected: {
    color: colors.accentMore,
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
  seriesCard: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  seriesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  seriesName: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  seriesMeta: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  seriesDescription: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  statusText: {
    fontWeight: '700',
    fontSize: 11,
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  progressLabel: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 12,
  },
  progressPercent: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  progressTrack: {
    height: 10,
    backgroundColor: withAlpha(colors.accentMore, 0.12),
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    minWidth: 0,
    backgroundColor: colors.accentMore,
    borderRadius: radii.pill,
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  footerMeta: {
    color: colors.inkMuted,
    fontSize: 11,
  },
  });
