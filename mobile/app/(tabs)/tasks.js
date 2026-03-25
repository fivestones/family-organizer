import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tx } from '@instantdb/react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { AvatarPhotoImage } from '../../src/components/AvatarPhotoImage';
import { radii, shadows, spacing, withAlpha } from '../../src/theme/tokens';
import { useAppSession } from '../../src/providers/AppProviders';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { openTaskSeriesChecklist, openTaskHistory, openTaskSeriesDiscussion } from '../../src/features/task-series/navigation';
import {
  getTaskWorkflowState,
  getTaskStatusLabel,
  isActionableTask,
  isTaskDone,
} from '../../../lib/task-progress';
import {
  areTodayTasksFinished,
  buildPullForwardTransactions,
  buildUndoPullForwardTransactions,
  canPullForward,
  computeLiveProjectedEndDate,
  computePlannedEndDate,
  computeScheduleDrift,
  countCompletedTaskDayBlocks,
  countTaskDayBlocks,
  getNextPullableDate,
} from '../../../lib/task-series-schedule';
import { getTasksForDate } from '../../../lib/task-scheduler';

function firstRef(value) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function createInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('');
}

function formatPossessive(name) {
  if (!name) return 'Tasks';
  return name.endsWith('s') ? `${name}' tasks` : `${name}'s tasks`;
}

function toDateKey(value) {
  if (!value) return new Date().toISOString().slice(0, 10);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function formatTaskDateLabel(value) {
  if (!value) return '';
  const parsed = new Date(`${toDateKey(value)}T00:00:00Z`);
  return parsed.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function buildMemberOverviewItems(seriesList, memberId) {
  const today = new Date();
  const todayKey = toDateKey(today);

  return seriesList
    .filter((series) => {
      const owner = firstRef(series.familyMember);
      return owner?.id === memberId;
    })
    .map((series) => {
      const tasks = (series.tasks || []).slice().sort((left, right) => (left.order || 0) - (right.order || 0));
      const activity = firstRef(series.scheduledActivity);
      const actionableTasks = tasks.filter((task) => isActionableTask(task, tasks));
      const totalTasks = actionableTasks.length;
      const completedTasks = actionableTasks.filter((task) => isTaskDone(task)).length;
      const totalBlocks = countTaskDayBlocks(tasks);
      const completedBlocks = countCompletedTaskDayBlocks(tasks);
      const pullForwardCount = Number(series.pullForwardCount || 0);
      const schedule =
        activity?.startDate || activity?.rrule
          ? {
              startDate: toDateKey(activity?.startDate || todayKey),
              rruleString: activity?.rrule || null,
              seriesStartDate: series.startDate ? toDateKey(series.startDate) : null,
              exdates: Array.isArray(activity?.exdates) ? activity.exdates : [],
            }
          : null;
      const todayTasks = schedule
        ? getTasksForDate(
            tasks,
            schedule.rruleString,
            schedule.startDate,
            today,
            schedule.seriesStartDate,
            schedule.exdates,
            pullForwardCount
          )
        : [];
      const canPull = canPullForward(series.workAheadAllowed, tasks, pullForwardCount);
      const nextPullDate = schedule && canPull ? getNextPullableDate(schedule, tasks, pullForwardCount) : null;
      const plannedEnd = series.plannedEndDate
        ? toDateKey(series.plannedEndDate)
        : schedule
        ? computePlannedEndDate(schedule, totalBlocks)
        : null;
      const liveEnd = schedule
        ? computeLiveProjectedEndDate(schedule, totalBlocks, completedBlocks, pullForwardCount)
        : null;
      const drift = schedule ? computeScheduleDrift(plannedEnd, liveEnd, schedule) : { status: 'on_target', days: 0, label: 'On target' };
      const effectiveStartDate = series.startDate ? new Date(series.startDate) : activity?.startDate ? new Date(activity.startDate) : null;
      const allDone = totalTasks > 0 && completedTasks === totalTasks;
      const isFuture = effectiveStartDate && effectiveStartDate > today;
      const hasDependency = !!series.dependsOnSeriesId;
      let status = 'active_now';
      if (allDone) status = 'finished';
      else if (isFuture || hasDependency) status = 'future';

      const todayTasksFinished = areTodayTasksFinished(todayTasks);

      return {
        series,
        totalTasks,
        completedTasks,
        totalBlocks,
        completedBlocks,
        pullForwardCount,
        drift,
        todayTasks,
        todayTasksFinished,
        canPull,
        nextPullDate,
        status,
      };
    })
    .sort((left, right) => {
      const statusOrder = { active_now: 0, future: 1, finished: 2 };
      const diff = (statusOrder[left.status] || 0) - (statusOrder[right.status] || 0);
      if (diff !== 0) return diff;
      return (right.completedTasks / Math.max(right.totalTasks, 1)) - (left.completedTasks / Math.max(left.totalTasks, 1));
    });
}

function StatusPill({ colors, label, tone = 'neutral' }) {
  const toneStyles =
    tone === 'success'
      ? { bg: withAlpha(colors.success, 0.12), border: withAlpha(colors.success, 0.26), text: colors.success }
      : tone === 'warning'
      ? { bg: withAlpha(colors.warning, 0.12), border: withAlpha(colors.warning, 0.26), text: colors.warning }
      : tone === 'danger'
      ? { bg: withAlpha(colors.danger, 0.12), border: withAlpha(colors.danger, 0.26), text: colors.danger }
      : tone === 'accent'
      ? { bg: withAlpha(colors.accentTasks, 0.12), border: withAlpha(colors.accentTasks, 0.26), text: colors.accentTasks }
      : { bg: colors.panel, border: colors.line, text: colors.inkMuted };

  return (
    <View style={{ borderRadius: radii.pill, borderWidth: 1, borderColor: toneStyles.border, backgroundColor: toneStyles.bg, paddingHorizontal: spacing.sm, paddingVertical: 4 }}>
      <Text style={{ color: toneStyles.text, fontSize: 11, fontWeight: '800' }}>{label}</Text>
    </View>
  );
}

export default function TasksTab() {
  const { colors, themeName } = useAppTheme();
  const isDark = themeName === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const {
    db,
    currentUser,
    familyMembers,
    isAuthenticated,
    instantReady,
  } = useAppSession();

  const params = useLocalSearchParams();
  const scrollToSeriesId = firstParam(params.scrollToSeriesId) || '';
  const scrollToTaskId = firstParam(params.scrollToTaskId) || '';
  const requestedMemberId = firstParam(params.memberId) || '';

  const currentUserIdRef = useRef('');
  const [viewedMemberId, setViewedMemberId] = useState('');
  const [memberDropdownVisible, setMemberDropdownVisible] = useState(false);
  const [filter, setFilter] = useState('active_now');
  const [undoState, setUndoState] = useState(null);
  const [highlightedSeriesId, setHighlightedSeriesId] = useState('');
  const scrollViewRef = useRef(null);
  const seriesLayoutsRef = useRef({});

  // Handle member selection from current user or params
  useEffect(() => {
    if (requestedMemberId) {
      setViewedMemberId(requestedMemberId);
      return;
    }
    if (!currentUser?.id) {
      currentUserIdRef.current = '';
      setViewedMemberId('');
      return;
    }
    if (currentUserIdRef.current !== currentUser.id) {
      currentUserIdRef.current = currentUser.id;
      setViewedMemberId(currentUser.id);
      return;
    }
    setViewedMemberId((previous) => {
      if (previous && familyMembers.some((member) => member.id === previous)) {
        return previous;
      }
      return currentUser.id;
    });
  }, [currentUser?.id, familyMembers, requestedMemberId]);

  const query = db.useQuery(
    isAuthenticated && instantReady
      ? {
          taskSeries: {
            tasks: {
              parentTask: {},
              attachments: {},
              responseFields: {},
              updates: {
                actor: {},
                affectedPerson: {},
                attachments: {},
                responseFieldValues: { field: {} },
                gradeType: {},
                replyTo: {},
                replies: {
                  actor: {},
                  affectedPerson: {},
                  attachments: {},
                  gradeType: {},
                },
              },
            },
            familyMember: {},
            scheduledActivity: {},
          },
          familyMembers: {},
        }
      : null
  );

  const allMembers = useMemo(
    () => query.data?.familyMembers || familyMembers || [],
    [query.data?.familyMembers, familyMembers]
  );
  const viewedMember = useMemo(
    () => allMembers.find((m) => m.id === viewedMemberId) || null,
    [allMembers, viewedMemberId]
  );
  const viewedMemberName = viewedMember?.name || currentUser?.name || 'Member';
  const headerTitle = formatPossessive(viewedMemberName);

  const todayKey = toDateKey(new Date());
  const overviewItems = useMemo(
    () => buildMemberOverviewItems(query.data?.taskSeries || [], viewedMemberId),
    [query.data?.taskSeries, viewedMemberId]
  );
  const filteredItems = useMemo(
    () => filter === 'all' ? overviewItems : overviewItems.filter((item) => item.status === filter),
    [overviewItems, filter]
  );

  // Stats
  const activeSeriesCount = overviewItems.filter((item) => item.status === 'active_now').length;
  const activeTotalTasks = overviewItems
    .filter((item) => item.status === 'active_now')
    .reduce((sum, item) => sum + item.todayTasks.length, 0);

  // Handle scroll-to-series deep link
  useEffect(() => {
    if (!scrollToSeriesId || filteredItems.length === 0) return;

    // Make sure the target series is visible in current filter
    const targetInFiltered = filteredItems.some((item) => item.series.id === scrollToSeriesId);
    if (!targetInFiltered) {
      // Switch to 'all' filter to show the target
      setFilter('all');
    }

    setHighlightedSeriesId(scrollToSeriesId);
    const timer = setTimeout(() => setHighlightedSeriesId(''), 2500);

    // Scroll to the series card after layout
    const scrollTimer = setTimeout(() => {
      const yOffset = seriesLayoutsRef.current[scrollToSeriesId];
      if (yOffset != null && scrollViewRef.current) {
        scrollViewRef.current.scrollTo({ y: yOffset - 80, animated: true });
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      clearTimeout(scrollTimer);
    };
  }, [scrollToSeriesId, filteredItems.length]);

  async function handlePullForward(item) {
    if (!item.nextPullDate) return;
    const result = buildPullForwardTransactions({
      tx,
      seriesId: item.series.id,
      currentPullForwardCount: item.pullForwardCount,
      actorFamilyMemberId: currentUser?.id || null,
      choreId: firstRef(item.series.scheduledActivity)?.id || null,
      originalScheduledDate: item.nextPullDate,
    });

    await db.transact(result.transactions);
    setUndoState({
      seriesId: item.series.id,
      historyEventId: result.historyEventId,
      pullForwardCount: item.pullForwardCount + 1,
    });
  }

  async function handleUndo() {
    if (!undoState) return;
    const txs = buildUndoPullForwardTransactions({
      tx,
      seriesId: undoState.seriesId,
      currentPullForwardCount: undoState.pullForwardCount,
      historyEventId: undoState.historyEventId,
    });
    await db.transact(txs);
    setUndoState(null);
  }

  const handleSeriesLayout = useCallback((seriesId, event) => {
    seriesLayoutsRef.current[seriesId] = event.nativeEvent.layout.y;
  }, []);

  return (
    <>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.root}>
          {/* Header */}
          <View style={styles.topBar}>
            <Pressable
              testID="tasks-member-switcher"
              accessibilityRole="button"
              accessibilityLabel={`Viewing ${viewedMemberName}. Tap to choose a family member.`}
              onPress={() => setMemberDropdownVisible(true)}
              style={styles.topBarMemberTouchable}
            >
              <AvatarPhotoImage
                photoUrls={viewedMember?.photoUrls}
                preferredSize="320"
                style={styles.topBarAvatar}
                fallback={
                  <View style={styles.topBarAvatarFallback}>
                    <Text style={styles.topBarAvatarFallbackText}>{createInitials(viewedMemberName)}</Text>
                  </View>
                }
              />
              <Text style={styles.topBarTitle} numberOfLines={1}>
                {headerTitle}
              </Text>
            </Pressable>

            <View style={styles.statsRow}>
              <View style={styles.statPill}>
                <Ionicons name="list" size={14} color={colors.accentTasks} />
                <Text style={styles.statValue}>{activeSeriesCount}</Text>
                <Text style={styles.statLabel}>Series</Text>
              </View>

              {activeTotalTasks > 0 ? (
                <View style={styles.statPill}>
                  <Ionicons name="checkbox-outline" size={14} color={colors.accentTasks} />
                  <Text style={styles.statValue}>{activeTotalTasks}</Text>
                  <Text style={styles.statLabel}>Today</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* Filter chips */}
          <View style={styles.filterStrip}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {[
                ['active_now', 'Active'],
                ['future', 'Future'],
                ['finished', 'Finished'],
                ['all', 'All'],
              ].map(([key, label]) => {
                const active = filter === key;
                return (
                  <Pressable key={key} onPress={() => setFilter(key)} style={[styles.chip, active && styles.chipActive]}>
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Content */}
          <View style={styles.contentShell}>
            <View style={styles.contentGlow} />
            <ScrollView
              ref={scrollViewRef}
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {undoState ? (
                <View style={styles.card}>
                  <Text style={styles.cardBody}>Tasks pulled forward.</Text>
                  <Pressable testID="tasks-tab-undo-pull" onPress={() => void handleUndo()} style={[styles.actionButton, styles.actionButtonPrimary]}>
                    <Text style={[styles.actionButtonText, styles.actionButtonTextPrimary]}>Undo</Text>
                  </Pressable>
                </View>
              ) : null}

              {query.isLoading ? (
                <View style={styles.card}>
                  <Text style={styles.cardBody}>Loading task series...</Text>
                </View>
              ) : filteredItems.length === 0 ? (
                <View style={styles.card}>
                  <Text style={styles.cardBody}>No task series match this filter.</Text>
                </View>
              ) : (
                filteredItems.map((item) => {
                  const isHighlighted = highlightedSeriesId === item.series.id;
                  return (
                    <View
                      key={item.series.id}
                      onLayout={(e) => handleSeriesLayout(item.series.id, e)}
                      style={[styles.card, isHighlighted && styles.cardHighlighted]}
                    >
                      <View style={styles.between}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.seriesTitle}>{item.series.name || 'Untitled series'}</Text>
                          <Text style={styles.cardBody}>
                            {firstRef(item.series.scheduledActivity)?.title || 'Task series'}
                            {item.nextPullDate ? ` \u2022 Next ${formatTaskDateLabel(item.nextPullDate)}` : ''}
                          </Text>
                        </View>
                        <StatusPill
                          colors={colors}
                          label={item.drift.label}
                          tone={item.drift.status === 'behind' ? 'warning' : item.drift.status === 'ahead' ? 'accent' : 'success'}
                        />
                      </View>

                      <View style={styles.between}>
                        <Text style={styles.tinyLabel}>Tasks {item.completedTasks}/{item.totalTasks}</Text>
                        <Text style={styles.tinyLabel}>Days {item.completedBlocks}/{item.totalBlocks}</Text>
                      </View>
                      <View style={styles.progressTrack}>
                        <View style={[styles.progressFill, { width: `${Math.max(8, item.totalTasks ? (item.completedTasks / item.totalTasks) * 100 : 8)}%` }]} />
                      </View>

                      {item.todayTasks.length ? (
                        <View style={{ gap: spacing.sm }}>
                          <Text style={styles.eyebrow}>Current Tasks</Text>
                          {item.todayTasks.map((task) => (
                            <Pressable
                              key={task.id}
                              onPress={() =>
                                router.push({
                                  pathname: '/task-series/task',
                                  params: {
                                    taskId: task.id,
                                    seriesId: item.series.id,
                                    choreId: firstRef(item.series.scheduledActivity)?.id || '',
                                    date: toDateKey(new Date()),
                                  },
                                })
                              }
                              style={[styles.taskRow, scrollToTaskId === task.id && styles.taskRowHighlighted]}
                            >
                              <View style={styles.between}>
                                <Text style={styles.taskTitle} numberOfLines={2}>{task.text}</Text>
                                <Text style={styles.taskMeta}>{getTaskStatusLabel(getTaskWorkflowState(task))}</Text>
                              </View>
                            </Pressable>
                          ))}
                        </View>
                      ) : null}

                      <View style={styles.taskActionRow}>
                        <Pressable
                          testID={`tasks-tab-open-checklist-${item.series.id}`}
                          onPress={() =>
                            openTaskSeriesChecklist({
                              seriesId: item.series.id,
                              choreId: firstRef(item.series.scheduledActivity)?.id || '',
                              date: todayKey,
                              memberId: viewedMemberId,
                            })
                          }
                          style={styles.actionButton}
                        >
                          <Text style={styles.actionButtonText}>Open Checklist</Text>
                        </Pressable>
                        <Pressable
                          testID={`tasks-tab-open-history-${item.series.id}`}
                          onPress={() => openTaskHistory({ seriesId: item.series.id, title: item.series.name || 'Task Series History' })}
                          style={styles.actionButton}
                        >
                          <Text style={styles.actionButtonText}>History</Text>
                        </Pressable>
                        <Pressable
                          testID={`tasks-tab-open-discussion-${item.series.id}`}
                          onPress={() => void openTaskSeriesDiscussion({ seriesId: item.series.id, seriesName: item.series.name })}
                          style={styles.actionButton}
                        >
                          <Text style={styles.actionButtonText}>Discussion</Text>
                        </Pressable>
                        {item.todayTasksFinished && item.canPull && item.nextPullDate ? (
                          <Pressable onPress={() => void handlePullForward(item)} style={[styles.actionButton, styles.actionButtonPrimary]}>
                            <Text style={[styles.actionButtonText, styles.actionButtonTextPrimary]}>Pull Forward</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>

      {/* Member switcher modal */}
      <Modal visible={memberDropdownVisible} transparent animationType="fade" onRequestClose={() => setMemberDropdownVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMemberDropdownVisible(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Choose a family member</Text>
            {allMembers.map((member) => {
              const isSelected = member.id === viewedMemberId;
              return (
                <Pressable
                  key={member.id}
                  accessibilityRole="button"
                  onPress={() => {
                    setViewedMemberId(member.id);
                    setMemberDropdownVisible(false);
                  }}
                  style={[styles.modalRow, isSelected && styles.modalRowSelected]}
                >
                  <AvatarPhotoImage
                    photoUrls={member.photoUrls}
                    preferredSize="64"
                    style={styles.modalAvatar}
                    fallback={
                      <View style={styles.modalAvatarFallback}>
                        <Text style={styles.modalAvatarFallbackText}>{createInitials(member.name)}</Text>
                      </View>
                    }
                  />
                  <Text style={[styles.modalRowText, isSelected && styles.modalRowTextSelected]}>{member.name}</Text>
                  {isSelected ? <Ionicons name="checkmark-circle" size={20} color={colors.accentTasks} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const createStyles = (colors, isDark) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.canvasStrong,
    },
    root: {
      flex: 1,
      backgroundColor: colors.canvasStrong,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.canvas,
      gap: spacing.sm,
    },
    topBarMemberTouchable: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minWidth: 0,
    },
    topBarAvatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
    },
    topBarAvatarFallback: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.canvasText, 0.12),
    },
    topBarAvatarFallbackText: {
      color: colors.canvasText,
      fontWeight: '800',
      fontSize: 14,
    },
    topBarTitle: {
      color: colors.canvasText,
      fontSize: 20,
      fontWeight: '800',
      flexShrink: 1,
      maxWidth: 180,
    },
    statsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: spacing.xs,
      flex: 1,
    },
    statPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: radii.pill,
      backgroundColor: withAlpha(colors.canvasText, 0.08),
      borderWidth: 1,
      borderColor: withAlpha(colors.canvasText, 0.06),
    },
    statValue: {
      color: colors.canvasText,
      fontSize: 14,
      fontWeight: '800',
    },
    statLabel: {
      color: colors.canvasTextMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    filterStrip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.canvas,
      borderBottomWidth: 1,
      borderBottomColor: colors.canvasLine,
    },
    chipRow: {
      gap: spacing.sm,
    },
    chip: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.canvasLine,
      backgroundColor: withAlpha(colors.canvasText, 0.06),
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipActive: {
      borderColor: withAlpha(colors.accentTasks, 0.5),
      backgroundColor: withAlpha(colors.accentTasks, 0.18),
    },
    chipText: {
      color: colors.canvasTextMuted,
      fontWeight: '800',
      fontSize: 12,
    },
    chipTextActive: {
      color: colors.canvasText,
    },
    contentShell: {
      flex: 1,
      backgroundColor: colors.bg,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      overflow: 'hidden',
    },
    contentGlow: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 48,
      backgroundColor: colors.bg,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      ...shadows.card,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      padding: spacing.md,
      gap: spacing.md,
      paddingBottom: spacing.xxl,
    },
    card: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      padding: spacing.md,
      gap: spacing.sm,
      ...shadows.card,
    },
    cardHighlighted: {
      borderColor: withAlpha(colors.accentTasks, 0.5),
      backgroundColor: withAlpha(colors.accentTasks, 0.06),
    },
    seriesTitle: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 16,
    },
    cardBody: {
      color: colors.inkMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    between: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    tinyLabel: {
      color: colors.inkMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    eyebrow: {
      color: colors.inkMuted,
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    progressTrack: {
      height: 8,
      borderRadius: radii.pill,
      backgroundColor: withAlpha(colors.ink, 0.08),
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: radii.pill,
      backgroundColor: colors.accentTasks,
    },
    taskRow: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      padding: spacing.md,
      gap: spacing.sm,
    },
    taskRowHighlighted: {
      borderColor: withAlpha(colors.accentTasks, 0.5),
      backgroundColor: withAlpha(colors.accentTasks, 0.06),
    },
    taskTitle: {
      color: colors.ink,
      fontSize: 15,
      fontWeight: '800',
      flex: 1,
    },
    taskMeta: {
      color: colors.inkMuted,
      fontSize: 12,
      lineHeight: 16,
    },
    taskActionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    actionButton: {
      minHeight: 40,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: withAlpha(colors.accentTasks, 0.22),
      backgroundColor: colors.panel,
    },
    actionButtonPrimary: {
      backgroundColor: colors.accentTasks,
      borderColor: colors.accentTasks,
    },
    actionButtonText: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 13,
    },
    actionButtonTextPrimary: {
      color: colors.onAccent,
    },

    // Member switcher modal
    modalBackdrop: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: withAlpha(colors.canvasStrong, 0.48),
    },
    modalSheet: {
      width: '85%',
      maxWidth: 360,
      backgroundColor: colors.panel,
      borderRadius: radii.lg,
      padding: spacing.lg,
      gap: spacing.sm,
      ...shadows.float,
    },
    modalTitle: {
      color: colors.ink,
      fontSize: 18,
      fontWeight: '800',
      marginBottom: spacing.sm,
    },
    modalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.md,
    },
    modalRowSelected: {
      backgroundColor: withAlpha(colors.accentTasks, 0.08),
    },
    modalAvatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
    },
    modalAvatarFallback: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.accentTasks, 0.14),
    },
    modalAvatarFallbackText: {
      color: colors.accentTasks,
      fontWeight: '800',
      fontSize: 12,
    },
    modalRowText: {
      flex: 1,
      color: colors.ink,
      fontSize: 15,
      fontWeight: '600',
    },
    modalRowTextSelected: {
      fontWeight: '800',
      color: colors.accentTasks,
    },
  });
