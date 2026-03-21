import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { id, tx } from '@instantdb/react-native';
import { router } from 'expo-router';
import {
  calculateDailyXP,
  formatDateKeyUTC,
  getAssignedMembersForChoreOnDate,
  getCompletedChoreCompletionsForDate,
  getMemberCompletionForDate,
  localDateToUTC,
} from '@family-organizer/shared-core';
import { AvatarPhotoImage } from '../../src/components/AvatarPhotoImage';
import { radii, shadows, spacing, withAlpha } from '../../src/theme/tokens';
import { useAppSession } from '../../src/providers/AppProviders';
import { getTasksForDate } from '../../../lib/task-scheduler';
import { getBucketedTasks, getLatestTaskUpdate, getTaskWorkflowState, isTaskDone } from '../../../lib/task-progress';
import { useAppTheme } from '../../src/theme/ThemeProvider';

const DAY_RANGE = 7;

function firstRef(value) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function memberRef(member) {
  if (!member) return null;
  if (Array.isArray(member)) return member[0] || null;
  return member;
}

function completionMemberId(completion) {
  const completedBy = memberRef(completion?.completedBy);
  return completedBy?.id || null;
}

function completionKey(choreId, memberId, dateKey) {
  return `${choreId}:${memberId}:${dateKey}`;
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

function formatPossessiveLabel(name, noun) {
  if (!name) return noun === 'day' ? 'Today' : noun;
  return name.endsWith('s') ? `${name}' ${noun}` : `${name}'s ${noun}`;
}

function buildDateStrip(selectedDate) {
  return Array.from({ length: DAY_RANGE }).map((_, index) => {
    const offset = index - Math.floor(DAY_RANGE / 2);
    return new Date(selectedDate.getTime() + offset * 86400000);
  });
}

function normalizeBalances(envelope) {
  if (envelope?.balances && typeof envelope.balances === 'object' && !Array.isArray(envelope.balances)) {
    return Object.fromEntries(
      Object.entries(envelope.balances)
        .map(([code, amount]) => [String(code).toUpperCase(), Number(amount) || 0])
        .filter(([, amount]) => amount !== 0)
    );
  }

  if (envelope?.currency && envelope?.amount != null) {
    return { [String(envelope.currency).toUpperCase()]: Number(envelope.amount) || 0 };
  }

  return {};
}

function addBalancesInto(target, source) {
  for (const [code, amount] of Object.entries(source || {})) {
    target[code] = (target[code] || 0) + (Number(amount) || 0);
  }
  return target;
}

function buildUnitMap(unitDefinitions) {
  return new Map((unitDefinitions || []).map((definition) => [String(definition.code || '').toUpperCase(), definition]));
}

function formatAmount(code, amount, unitMap) {
  const upper = String(code || '').toUpperCase();
  const unit = unitMap.get(upper);

  if (unit) {
    const symbol = unit.symbol || upper;
    const isMonetary = !!unit.isMonetary;
    const decimals = unit.decimalPlaces ?? (isMonetary ? 2 : 0);
    const placement = unit.symbolPlacement ?? (isMonetary ? 'before' : 'after');
    const spacingValue = unit.symbolSpacing ?? placement === 'after';
    const formatted = Number(amount || 0).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });

    if (placement === 'before') {
      return spacingValue ? `${symbol} ${formatted}` : `${symbol}${formatted}`;
    }
    return spacingValue ? `${formatted} ${symbol}` : `${formatted}${symbol}`;
  }

  try {
    if (upper.length === 3) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: upper }).format(Number(amount || 0));
    }
  } catch {
    // Fall through to generic formatting.
  }

  return `${Number(amount || 0).toLocaleString()} ${upper}`.trim();
}

function formatBalancesInline(balances, unitMap) {
  const entries = Object.entries(balances || {}).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return 'Empty';
  return entries.map(([code, amount]) => formatAmount(code, amount, unitMap)).join(' · ');
}

function createInitials(name) {
  const words = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() || '')
    .join('');
}

function formatTaskStateLabel(state) {
  switch (state) {
    case 'in_progress':
      return 'In progress';
    case 'needs_review':
      return 'Needs review';
    case 'blocked':
      return 'Blocked';
    case 'skipped':
      return 'Skipped';
    case 'done':
      return 'Done';
    default:
      return 'Not started';
  }
}

function FeedSection({
  title,
  meta,
  actionLabel = null,
  onActionPress = null,
  first = false,
  children,
  styles,
}) {
  return (
    <View style={[styles.feedSection, !first && styles.feedSectionBorder]}>
      <View style={styles.feedSectionHeader}>
        <View style={styles.feedSectionCopy}>
          <Text style={styles.feedSectionTitle}>{title}</Text>
          {meta ? <Text style={styles.feedSectionMeta}>{meta}</Text> : null}
        </View>
        {actionLabel && onActionPress ? (
          <Pressable accessibilityRole="button" onPress={onActionPress} style={styles.feedSectionAction}>
            <Text style={styles.feedSectionActionText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function MetricPill({ icon, label, value, colors, styles }) {
  return (
    <View style={styles.metricPill}>
      <View style={styles.metricIconWrap}>
        <Ionicons name={icon} size={14} color={colors.canvasText} />
      </View>
      <View>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>{value}</Text>
      </View>
    </View>
  );
}

export default function DashboardTab() {
  const { colors, themeName } = useAppTheme();
  const isDark = themeName === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { db, currentUser, familyMembers, isAuthenticated, instantReady, lock } = useAppSession();
  const [selectedDate, setSelectedDate] = useState(() => localDateToUTC(new Date()));
  const [viewedMemberId, setViewedMemberId] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [pendingCompletionKeys, setPendingCompletionKeys] = useState(() => new Set());
  const currentUserIdRef = useRef('');

  const dashboardQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          familyMembers: {
            $: { order: { order: 'asc' } },
            allowanceEnvelopes: {},
          },
          unitDefinitions: {},
          chores: {
            assignees: {},
            assignments: {
              familyMember: {},
            },
            completions: {
              completedBy: {},
              markedBy: {},
            },
            taskSeries: {
              tasks: {
                parentTask: {},
                attachments: {},
                updates: {
                  attachments: {},
                  actor: {},
                },
              },
              familyMember: {},
              scheduledActivity: {},
            },
          },
          calendarItems: {
            pertainsTo: {},
          },
          messageThreads: {
            members: {},
          },
        }
      : null
  );

  const members = useMemo(() => dashboardQuery.data?.familyMembers || familyMembers || [], [dashboardQuery.data?.familyMembers, familyMembers]);
  const unitDefinitions = useMemo(() => dashboardQuery.data?.unitDefinitions || [], [dashboardQuery.data?.unitDefinitions]);
  const chores = useMemo(() => dashboardQuery.data?.chores || [], [dashboardQuery.data?.chores]);
  const unitMap = useMemo(() => buildUnitMap(unitDefinitions), [unitDefinitions]);
  const selectedDateKey = useMemo(() => formatDateKeyUTC(selectedDate), [selectedDate]);
  const dateStrip = useMemo(() => buildDateStrip(selectedDate), [selectedDate]);
  const todayDateKey = useMemo(() => formatDateKeyUTC(localDateToUTC(new Date())), []);

  useEffect(() => {
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
      if (previous && members.some((member) => member.id === previous)) {
        return previous;
      }
      return currentUser.id;
    });
  }, [currentUser?.id, members]);

  const viewedMember = useMemo(
    () => members.find((member) => member.id === viewedMemberId) || currentUser || members[0] || null,
    [currentUser, members, viewedMemberId]
  );

  const membersWithBalances = useMemo(() => {
    return members.map((member) => {
      const envelopes = (member.allowanceEnvelopes || []).map((envelope) => ({
        ...envelope,
        balancesNormalized: normalizeBalances(envelope),
      }));

      const totalBalances = envelopes.reduce((accumulator, envelope) => addBalancesInto(accumulator, envelope.balancesNormalized), {});

      return {
        ...member,
        envelopes,
        totalBalances,
      };
    });
  }, [members]);

  const viewedFinanceMember = useMemo(
    () => membersWithBalances.find((member) => member.id === viewedMember?.id) || null,
    [membersWithBalances, viewedMember?.id]
  );

  const dailyXpByMember = useMemo(() => calculateDailyXP(chores, members, selectedDate), [chores, members, selectedDate]);
  const viewedXp = dailyXpByMember[viewedMember?.id] || { current: 0, possible: 0 };

  const familyMemberNameById = useMemo(
    () =>
      members.reduce((accumulator, member) => {
        accumulator[member.id] = member.name;
        return accumulator;
      }, {}),
    [members]
  );

  const choreRows = useMemo(() => {
    if (!viewedMember?.id) return [];

    return chores
      .map((chore) => {
        const assignedMembers = getAssignedMembersForChoreOnDate(chore, selectedDate);
        if (assignedMembers.length === 0) return null;

        const choreAssigneeIds = new Set((chore.assignees || []).map((assignee) => assignee?.id).filter(Boolean));
        const assignedMemberIds = new Set(assignedMembers.map((assignee) => assignee.id));
        const matchesViewedMember = assignedMemberIds.has(viewedMember.id) || choreAssigneeIds.has(viewedMember.id);
        if (!matchesViewedMember) return null;

        const completionsOnDate = getCompletedChoreCompletionsForDate(chore, selectedDate);
        const firstCompletedByOther = completionsOnDate.find((completion) => completionMemberId(completion));
        const upForGrabsCompletedById = completionMemberId(firstCompletedByOther);
        const viewedCompletion = getMemberCompletionForDate(chore, viewedMember.id, selectedDate);

        return {
          chore,
          viewedCompletion,
          isDone: !!viewedCompletion?.completed,
          upForGrabsCompletedById,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.isDone !== right.isDone) {
          return left.isDone ? 1 : -1;
        }
        return (left.chore?.title || '').localeCompare(right.chore?.title || '');
      });
  }, [chores, selectedDate, viewedMember?.id]);

  const incompleteChores = useMemo(() => choreRows.filter((row) => !row.isDone), [choreRows]);
  const completedChores = useMemo(() => choreRows.filter((row) => row.isDone), [choreRows]);

  const taskSeriesCards = useMemo(() => {
    if (!viewedMember?.id) return [];

    const cards = [];

    for (const chore of chores) {
      const assignedMembers = getAssignedMembersForChoreOnDate(chore, selectedDate);
      if (!assignedMembers.some((member) => member.id === viewedMember.id)) {
        continue;
      }

      for (const series of chore.taskSeries || []) {
        const owner = firstRef(series.familyMember);
        if (owner?.id && owner.id !== viewedMember.id) continue;

        const allTasks = (series.tasks || []).slice().sort((left, right) => (left.order || 0) - (right.order || 0));
        const scheduledTasks = getTasksForDate(
          allTasks,
          chore.rrule || null,
          chore.startDate,
          selectedDate,
          series.startDate || null,
          chore.exdates || null
        ).filter((task) => !task.isDayBreak);
        const bucketedCounts = {
          blocked: getBucketedTasks(allTasks, 'blocked').length,
          skipped: getBucketedTasks(allTasks, 'skipped').length,
          needs_review: getBucketedTasks(allTasks, 'needs_review').length,
          done: getBucketedTasks(allTasks, 'done').length,
        };
        const hasBucketedTasks = Object.values(bucketedCounts).some((count) => count > 0);

        if (!scheduledTasks.length && !hasBucketedTasks) continue;

        cards.push({
          id: series.id,
          series,
          chore,
          allTasks,
          scheduledTasks,
          incompleteCount: scheduledTasks.filter((task) => !isTaskDone(task)).length,
          bucketedCounts,
        });
      }
    }

    return cards.sort((left, right) => {
      const choreCompare = (left.chore?.title || '').localeCompare(right.chore?.title || '');
      if (choreCompare !== 0) return choreCompare;
      return (left.series?.name || '').localeCompare(right.series?.name || '');
    });
  }, [chores, selectedDate, viewedMember?.id]);

  const calendarEvents = useMemo(() => {
    if (!viewedMember?.id) return [];
    const items = dashboardQuery.data?.calendarItems || [];
    const today = selectedDate;

    return items
      .map((item) => {
        const memberIds = (item.pertainsTo || []).map((member) => member.id).filter(Boolean);
        const isFamilyWide = memberIds.length === 0;
        const pertainsToMember = isFamilyWide || memberIds.includes(viewedMember.id);
        if (!pertainsToMember) return null;

        const startsAt = item.isAllDay
          ? localDateToUTC(new Date(`${item.startDate}T00:00:00`))
          : new Date(item.startDate);
        const endsAt = item.isAllDay
          ? localDateToUTC(new Date(`${item.endDate}T00:00:00`))
          : new Date(item.endDate);

        if (endsAt.getTime() < today.getTime()) return null;

        let timeLabel;
        if (item.isAllDay) {
          timeLabel = `${startsAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · All day`;
        } else {
          timeLabel = startsAt.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
        }

        return {
          id: item.id,
          title: item.title,
          timeLabel,
          startsAt,
          isFamilyWide,
        };
      })
      .filter(Boolean)
      .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime())
      .slice(0, 6);
  }, [dashboardQuery.data?.calendarItems, viewedMember?.id, selectedDate]);

  const unreadThreads = useMemo(() => {
    if (!viewedMember?.id || !dashboardQuery.data?.messageThreads) return [];
    const threads = dashboardQuery.data.messageThreads;
    const result = [];

    for (const thread of threads) {
      if (!thread.latestMessageAt) continue;
      const membership = (thread.members || []).find((member) => member.familyMemberId === viewedMember.id);
      if (!membership || membership.isArchived) continue;

      const lastRead = membership.lastReadAt || '';
      if (thread.latestMessageAt > lastRead) {
        let displayName = thread.title || 'Thread';
        if (thread.threadType === 'family') displayName = 'Family';
        else if (thread.threadType === 'parents_only') displayName = 'Parents';

        result.push({
          id: thread.id,
          displayName,
          previewText: thread.latestMessagePreview || 'No messages yet',
          latestMessageAt: thread.latestMessageAt,
        });
      }
    }

    return result.sort((left, right) => right.latestMessageAt.localeCompare(left.latestMessageAt));
  }, [dashboardQuery.data?.messageThreads, viewedMember?.id]);

  const activeTaskCount = useMemo(
    () => taskSeriesCards.reduce((sum, card) => sum + card.incompleteCount, 0),
    [taskSeriesCards]
  );
  const scheduledTaskCount = useMemo(
    () => taskSeriesCards.reduce((sum, card) => sum + card.scheduledTasks.length, 0),
    [taskSeriesCards]
  );

  const heroSummary = useMemo(() => {
    const pieces = [];
    if (taskSeriesCards.length > 0) {
      pieces.push(`${taskSeriesCards.length} task list${taskSeriesCards.length === 1 ? '' : 's'}`);
    }
    if (incompleteChores.length > 0) {
      pieces.push(`${incompleteChores.length} chore${incompleteChores.length === 1 ? '' : 's'} left`);
    }
    if (unreadThreads.length > 0) {
      pieces.push(`${unreadThreads.length} unread thread${unreadThreads.length === 1 ? '' : 's'}`);
    }
    if (pieces.length === 0) {
      return `A calmer view of ${viewedMember?.name || 'today'} with the essentials spread across the full screen.`;
    }
    return pieces.join(' • ');
  }, [incompleteChores.length, taskSeriesCards.length, unreadThreads.length, viewedMember?.name]);

  async function handleToggleCompletion(chore, familyMemberId) {
    if (!currentUser?.id) {
      Alert.alert('Login required', 'Choose a family member before marking chores complete.');
      return;
    }

    const pendingKey = completionKey(chore.id, familyMemberId, selectedDateKey);
    setPendingCompletionKeys((previous) => new Set(previous).add(pendingKey));

    try {
      const existingCompletion = getMemberCompletionForDate(chore, familyMemberId, selectedDate);
      const completionsOnDate = getCompletedChoreCompletionsForDate(chore, selectedDate);

      if (chore.isUpForGrabs) {
        const completedByOther = completionsOnDate.find((completion) => {
          const completerId = completionMemberId(completion);
          return completerId && completerId !== familyMemberId;
        });

        if (completedByOther && !existingCompletion) {
          const completerName = familyMemberNameById[completionMemberId(completedByOther)] || 'another member';
          Alert.alert('Already completed', `${chore.title || 'This chore'} was already completed by ${completerName}.`);
          return;
        }
      }

      if (existingCompletion) {
        const willComplete = !existingCompletion.completed;
        await db.transact([
          tx.choreCompletions[existingCompletion.id].update({
            completed: willComplete,
            dateCompleted: willComplete ? new Date().toISOString() : null,
          }),
        ]);
        return;
      }

      const completionId = id();
      const transactions = [
        tx.choreCompletions[completionId].update({
          dateDue: selectedDateKey,
          dateCompleted: new Date().toISOString(),
          completed: true,
          allowanceAwarded: false,
        }),
        tx.chores[chore.id].link({ completions: completionId }),
        tx.familyMembers[familyMemberId].link({ completedChores: completionId }),
      ];

      if (currentUser?.id) {
        transactions.push(tx.familyMembers[currentUser.id].link({ markedCompletions: completionId }));
      }

      await db.transact(transactions);
    } catch (error) {
      Alert.alert('Unable to update chore', error?.message || 'Please try again.');
    } finally {
      setPendingCompletionKeys((previous) => {
        const next = new Set(previous);
        next.delete(pendingKey);
        return next;
      });
    }
  }

  async function handleLockAndSwitchUser() {
    try {
      setMenuVisible(false);
      await lock();
      router.replace('/lock?intent=switch-user');
    } catch (error) {
      Alert.alert('Unable to switch user', error?.message || 'Please try again.');
    }
  }

  function openFinanceForViewedMember() {
    if (!viewedMember?.id) return;
    router.push({
      pathname: '/finance',
      params: { memberId: viewedMember.id },
    });
  }

  function openTaskSeriesOverview() {
    if (!viewedMember?.id) return;
    router.push({
      pathname: '/task-series/my',
      params: { memberId: viewedMember.id },
    });
  }

  const menuButton = currentUser ? (
    <Pressable
      testID="dashboard-open-user-menu"
      accessibilityRole="button"
      accessibilityLabel={`Open dashboard menu for ${currentUser.name}`}
      onPress={() => setMenuVisible(true)}
      style={styles.heroMenuButton}
      hitSlop={10}
    >
      <AvatarPhotoImage
        photoUrls={currentUser.photoUrls}
        preferredSize="320"
        style={styles.heroMenuAvatar}
        fallback={
          <View style={styles.heroMenuFallback}>
            <Text style={styles.heroMenuFallbackText}>{createInitials(currentUser.name)}</Text>
          </View>
        }
      />
    </Pressable>
  ) : null;

  return (
    <>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.root}>
          <View style={styles.heroSection}>
            <View style={[styles.heroGlowOrb, styles.heroGlowOrbLeft, { backgroundColor: withAlpha(colors.accentDashboard, 0.22) }]} />
            <View style={[styles.heroGlowOrb, styles.heroGlowOrbBottom, { backgroundColor: withAlpha(colors.canvasText, 0.06) }]} />
            {isDark ? (
              <View style={[styles.heroGlowOrb, styles.heroGlowOrbTopRight, { backgroundColor: withAlpha(colors.accentMore, 0.18) }]} />
            ) : null}
            {viewedMember?.photoUrls ? (
              <AvatarPhotoImage
                photoUrls={viewedMember.photoUrls}
                preferredSize="1200"
                resizeMode="cover"
                style={styles.heroFaceBackdrop}
              />
            ) : null}
            <View style={styles.heroScrim} />

            <View style={styles.heroTopRow}>
              <View style={styles.heroViewerChip}>
                <AvatarPhotoImage
                  photoUrls={viewedMember?.photoUrls}
                  preferredSize="320"
                  style={styles.heroViewerAvatar}
                  fallback={
                    <View style={styles.heroViewerFallback}>
                      <Text style={styles.heroViewerFallbackText}>{createInitials(viewedMember?.name)}</Text>
                    </View>
                  }
                />
                <View style={styles.heroViewerCopy}>
                  <Text style={styles.heroViewerLabel}>Viewing</Text>
                  <Text style={styles.heroViewerName}>{viewedMember?.name || 'Family member'}</Text>
                </View>
              </View>
              {menuButton}
            </View>

            <View style={styles.heroTitleBlock}>
              <Text style={styles.heroDate}>{formatLongDate(selectedDate)}</Text>
              <Text style={styles.heroTitle}>{formatPossessiveLabel(viewedMember?.name, 'day')}</Text>
              <Text style={styles.heroSubtitle}>{heroSummary}</Text>
            </View>

            <View style={styles.metricRow}>
              <MetricPill icon="sparkles" label="XP" value={`${viewedXp.current}/${viewedXp.possible}`} colors={colors} styles={styles} />
              <MetricPill icon="list" label="Tasks" value={`${activeTaskCount}`} colors={colors} styles={styles} />
              <MetricPill icon="chatbubble-ellipses" label="Unread" value={`${unreadThreads.length}`} colors={colors} styles={styles} />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateRailContent}>
              {dateStrip.map((date) => {
                const dateKey = formatDateKeyUTC(date);
                const isSelected = dateKey === selectedDateKey;
                const isToday = dateKey === todayDateKey;
                return (
                  <Pressable
                    key={date.toISOString()}
                    testID={`dashboard-date-chip-${dateKey}`}
                    accessibilityRole="button"
                    accessibilityLabel={`View dashboard for ${formatLongDate(date)}`}
                    style={[styles.dateRailPill, isSelected && styles.dateRailPillSelected]}
                    onPress={() => setSelectedDate(date)}
                  >
                    <Text style={[styles.dateRailDay, isSelected && styles.dateRailTextSelected]}>
                      {formatDayLabel(date)}
                    </Text>
                    <Text style={[styles.dateRailDate, isSelected && styles.dateRailTextSelected]}>
                      {formatMonthDay(date)}
                    </Text>
                    {!isSelected && isToday ? <View style={styles.dateTodayDot} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <View style={styles.contentSheet}>
              <FeedSection
                first
                title="Task Series"
                meta={
                  taskSeriesCards.length > 0
                    ? `${scheduledTaskCount} scheduled • ${activeTaskCount} active`
                    : 'No task-series items scheduled for this day'
                }
                actionLabel={viewedMember?.id ? 'Open full view' : null}
                onActionPress={openTaskSeriesOverview}
                styles={styles}
              >
                {dashboardQuery.isLoading ? (
                  <Text style={styles.emptyText}>Loading today’s task-series items…</Text>
                ) : taskSeriesCards.length === 0 ? (
                  <Text style={styles.emptyText}>
                    No Task Series items are scheduled for {viewedMember?.name || 'this member'} on {formatMonthDay(selectedDate)}.
                  </Text>
                ) : (
                  <View style={styles.seriesBandList}>
                    {taskSeriesCards.map((card, index) => {
                      const previewTasks = card.scheduledTasks.slice(0, 3);
                      const remainingTaskCount = Math.max(0, card.scheduledTasks.length - previewTasks.length);
                      return (
                        <View key={card.id} style={[styles.seriesBand, index > 0 && styles.seriesBandBorder]}>
                          <View style={styles.seriesHeaderRow}>
                            <View style={styles.seriesCopy}>
                              <Text style={styles.seriesTitle}>{card.series.name || 'Untitled series'}</Text>
                              <Text style={styles.seriesMeta}>
                                {card.chore?.title ? `From ${card.chore.title}` : 'Task series'}
                              </Text>
                            </View>
                            <Text style={styles.seriesCountText}>{card.incompleteCount} active</Text>
                          </View>

                          <View style={styles.seriesSnapshotRow}>
                            <Text style={styles.seriesSnapshotText}>Blocked {card.bucketedCounts.blocked}</Text>
                            <Text style={styles.seriesSnapshotText}>Review {card.bucketedCounts.needs_review}</Text>
                            <Text style={styles.seriesSnapshotText}>Done {card.bucketedCounts.done}</Text>
                          </View>

                          {previewTasks.length > 0 ? (
                            <View style={styles.seriesPreviewList}>
                              {previewTasks.map((task, index) => {
                                const workflowState = getTaskWorkflowState(task);
                                const latestUpdate = getLatestTaskUpdate(task);
                                const latestNote = String(latestUpdate?.note || '').trim();
                                const latestAttachmentCount =
                                  (Array.isArray(latestUpdate?.attachments) ? latestUpdate.attachments.length : 0) ||
                                  (Array.isArray(task.attachments) ? task.attachments.length : 0);
                                const toneColor =
                                  workflowState === 'done'
                                    ? colors.success
                                    : workflowState === 'needs_review'
                                    ? colors.accentDashboard
                                    : workflowState === 'blocked'
                                    ? colors.warning
                                    : workflowState === 'skipped'
                                    ? colors.inkMuted
                                    : colors.accentCalendar;

                                return (
                                  <View key={task.id || `${card.id}-${index}`} style={[styles.previewRow, index > 0 && styles.previewRowBorder]}>
                                    <View style={styles.previewCopy}>
                                      <View style={styles.previewTitleRow}>
                                        <Text style={styles.previewTitle}>{task.title || 'Untitled task'}</Text>
                                        <View
                                          style={[
                                            styles.previewStateChip,
                                            {
                                              backgroundColor: withAlpha(toneColor, workflowState === 'done' ? 0.16 : 0.12),
                                              borderColor: withAlpha(toneColor, 0.3),
                                            },
                                          ]}
                                        >
                                          <Text style={[styles.previewStateText, { color: toneColor }]}>
                                            {formatTaskStateLabel(workflowState)}
                                          </Text>
                                        </View>
                                      </View>
                                      {latestNote ? (
                                        <Text style={styles.previewNote} numberOfLines={2}>
                                          {latestNote}
                                        </Text>
                                      ) : latestAttachmentCount > 0 ? (
                                        <Text style={styles.previewNote}>
                                          {latestAttachmentCount} attachment{latestAttachmentCount === 1 ? '' : 's'}
                                        </Text>
                                      ) : null}
                                    </View>
                                  </View>
                                );
                              })}
                            </View>
                          ) : (
                            <Text style={styles.emptyInlineText}>No actionable tasks in the schedule right now.</Text>
                          )}

                          {remainingTaskCount > 0 ? (
                            <Text style={styles.remainingText}>
                              {remainingTaskCount} more scheduled item{remainingTaskCount === 1 ? '' : 's'} in the checklist.
                            </Text>
                          ) : null}

                          <View style={styles.seriesActionRow}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Open checklist for ${card.series.name || 'task series'}`}
                              onPress={() =>
                                router.push({
                                  pathname: '/task-series/series',
                                  params: {
                                    seriesId: card.series.id,
                                    choreId: card.chore?.id || '',
                                    date: selectedDateKey,
                                    memberId: viewedMember?.id || '',
                                  },
                                })
                              }
                              style={[styles.seriesActionButton, styles.seriesActionButtonPrimary]}
                            >
                              <Text style={[styles.seriesActionText, styles.seriesActionTextPrimary]}>Open checklist</Text>
                            </Pressable>
                            {currentUser?.role === 'parent' ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={`Open review queue for ${card.series.name || 'task series'}`}
                                onPress={() =>
                                  router.push({
                                    pathname: '/more/task-series/review',
                                    params: { seriesId: card.series.id },
                                  })
                                }
                                style={[styles.seriesActionButton, styles.seriesActionButtonSecondary]}
                              >
                                <Text style={[styles.seriesActionText, styles.seriesActionTextSecondary]}>Review queue</Text>
                              </Pressable>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </FeedSection>

              <FeedSection
                title="Chores"
                meta={
                  choreRows.length > 0
                    ? `${incompleteChores.length} left • ${completedChores.length} finished`
                    : 'No chores due for this day'
                }
                actionLabel="Open chores"
                onActionPress={() => router.push('/chores')}
                styles={styles}
              >
                {dashboardQuery.isLoading ? (
                  <Text style={styles.emptyText}>Loading today’s chores…</Text>
                ) : choreRows.length === 0 ? (
                  <Text style={styles.emptyText}>
                    No chores are due for {viewedMember?.name || 'this member'} on {formatMonthDay(selectedDate)}.
                  </Text>
                ) : (
                  <View style={styles.flatList}>
                    {incompleteChores.map((row, index) => {
                      const pendingKey = completionKey(row.chore.id, viewedMember.id, selectedDateKey);
                      const isBusy = pendingCompletionKeys.has(pendingKey);
                      const blockedByUpForGrabs =
                        !!row.chore.isUpForGrabs &&
                        !!row.upForGrabsCompletedById &&
                        row.upForGrabsCompletedById !== viewedMember.id &&
                        !row.isDone;

                      return (
                        <View key={`dashboard-chore-${row.chore.id}`} style={[styles.flatRow, index > 0 && styles.flatRowBorder]}>
                          <View style={styles.flatRowMain}>
                            <View style={styles.flatRowTop}>
                              <View style={styles.flatRowCopy}>
                                <Text style={styles.flatRowTitle}>{row.chore.title || 'Untitled chore'}</Text>
                                {row.chore.description ? <Text style={styles.flatRowBody}>{row.chore.description}</Text> : null}
                              </View>
                              <Pressable
                                testID={`dashboard-chore-toggle-${row.chore.id}`}
                                accessibilityRole="button"
                                accessibilityLabel={`${row.isDone ? 'Mark not done' : 'Mark done'} ${row.chore.title || 'chore'}`}
                                disabled={isBusy || blockedByUpForGrabs}
                                onPress={() => {
                                  void handleToggleCompletion(row.chore, viewedMember.id);
                                }}
                                style={[
                                  styles.choreToggleButton,
                                  row.isDone && styles.choreToggleButtonDone,
                                  (isBusy || blockedByUpForGrabs) && styles.choreToggleButtonLocked,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.choreToggleButtonText,
                                    row.isDone && styles.choreToggleButtonTextDone,
                                    (isBusy || blockedByUpForGrabs) && styles.choreToggleButtonTextLocked,
                                  ]}
                                >
                                  {isBusy ? '…' : blockedByUpForGrabs ? 'Claimed' : row.isDone ? 'Done' : 'Mark'}
                                </Text>
                              </Pressable>
                            </View>

                            <View style={styles.inlineTagRow}>
                              {row.chore.isUpForGrabs ? (
                                <View style={[styles.inlineTag, styles.inlineTagWarm]}>
                                  <Text style={[styles.inlineTagText, styles.inlineTagWarmText]}>Up for grabs</Text>
                                </View>
                              ) : null}
                              {row.chore.isJoint ? (
                                <View style={[styles.inlineTag, styles.inlineTagNeutral]}>
                                  <Text style={[styles.inlineTagText, styles.inlineTagNeutralText]}>Joint</Text>
                                </View>
                              ) : null}
                              {Number.isFinite(Number(row.chore.weight)) && row.chore.rewardType !== 'fixed' ? (
                                <View style={[styles.inlineTag, styles.inlineTagAccent]}>
                                  <Text style={[styles.inlineTagText, styles.inlineTagAccentText]}>
                                    XP {Number(row.chore.weight) > 0 ? '+' : ''}
                                    {Number(row.chore.weight || 0)}
                                  </Text>
                                </View>
                              ) : null}
                            </View>

                            {blockedByUpForGrabs ? (
                              <Text style={styles.helperText}>
                                Claimed by {familyMemberNameById[row.upForGrabsCompletedById] || 'another member'}.
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}

                    {completedChores.length > 0 ? (
                      <View style={styles.completedGroup}>
                        <Text style={styles.completedLabel}>Finished</Text>
                        {completedChores.map((row, index) => {
                          const pendingKey = completionKey(row.chore.id, viewedMember.id, selectedDateKey);
                          const isBusy = pendingCompletionKeys.has(pendingKey);
                          return (
                            <View key={`dashboard-completed-${row.chore.id}`} style={[styles.flatRow, index > 0 && styles.flatRowBorder]}>
                              <View style={styles.flatRowTop}>
                                <View style={styles.flatRowCopy}>
                                  <Text style={[styles.flatRowTitle, styles.flatRowTitleDone]}>{row.chore.title || 'Untitled chore'}</Text>
                                  {row.chore.description ? (
                                    <Text style={[styles.flatRowBody, styles.flatRowBodyDone]}>{row.chore.description}</Text>
                                  ) : null}
                                </View>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Mark ${row.chore.title || 'chore'} not done`}
                                  disabled={isBusy}
                                  onPress={() => {
                                    void handleToggleCompletion(row.chore, viewedMember.id);
                                  }}
                                  style={[styles.choreToggleButton, styles.choreToggleButtonDone]}
                                >
                                  <Text style={[styles.choreToggleButtonText, styles.choreToggleButtonTextDone]}>
                                    {isBusy ? '…' : 'Done'}
                                  </Text>
                                </Pressable>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                )}
              </FeedSection>

              <FeedSection
                title="Calendar"
                meta={
                  calendarEvents.length > 0
                    ? `${calendarEvents.length} upcoming event${calendarEvents.length === 1 ? '' : 's'}`
                    : 'No upcoming events'
                }
                actionLabel="Open calendar"
                onActionPress={() => router.push('/calendar')}
                styles={styles}
              >
                {calendarEvents.length === 0 ? (
                  <Text style={styles.emptyText}>No calendar events for {viewedMember?.name || 'this member'}.</Text>
                ) : (
                  <View style={styles.flatList}>
                    {calendarEvents.map((event, index) => (
                      <Pressable
                        key={`calendar-${event.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Open calendar for ${event.title}`}
                        onPress={() => router.push('/calendar')}
                        style={[styles.flatRow, index > 0 && styles.flatRowBorder]}
                      >
                        <View style={styles.rowIconWrap}>
                          <Ionicons name="calendar-outline" size={18} color={colors.accentCalendar} />
                        </View>
                        <View style={styles.flatRowCopy}>
                          <Text style={styles.flatRowTitle}>{event.title}</Text>
                          <Text style={styles.flatRowBody}>{event.timeLabel}</Text>
                        </View>
                        {event.isFamilyWide ? (
                          <View style={[styles.inlineTag, styles.inlineTagNeutral]}>
                            <Text style={[styles.inlineTagText, styles.inlineTagNeutralText]}>Family</Text>
                          </View>
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                )}
              </FeedSection>

              <FeedSection
                title="Unread Messages"
                meta={
                  unreadThreads.length > 0
                    ? `${unreadThreads.length} thread${unreadThreads.length === 1 ? '' : 's'} waiting`
                    : 'Nothing unread right now'
                }
                actionLabel="Open inbox"
                onActionPress={() => router.push('/messages')}
                styles={styles}
              >
                {unreadThreads.length === 0 ? (
                  <Text style={styles.emptyText}>You’re caught up for {viewedMember?.name || 'this member'}.</Text>
                ) : (
                  <View style={styles.flatList}>
                    {unreadThreads.map((thread, index) => (
                      <Pressable
                        key={`thread-${thread.id}`}
                        accessibilityRole="button"
                        accessibilityLabel={`Open message thread ${thread.displayName}`}
                        onPress={() =>
                          router.push({
                            pathname: '/messages',
                            params: { threadId: thread.id },
                          })
                        }
                        style={[styles.flatRow, index > 0 && styles.flatRowBorder]}
                      >
                        <View style={styles.rowIconWrap}>
                          <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.accentDashboard} />
                        </View>
                        <View style={styles.flatRowCopy}>
                          <Text style={styles.flatRowTitle}>{thread.displayName}</Text>
                          <Text style={styles.flatRowBody} numberOfLines={1}>
                            {thread.previewText}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
                      </Pressable>
                    ))}
                  </View>
                )}
              </FeedSection>

              <FeedSection title="Finance" meta="Balances for the selected dashboard member" styles={styles}>
                <Pressable
                  testID="dashboard-open-finance"
                  accessibilityRole="button"
                  accessibilityLabel={`Open finance for ${viewedMember?.name || 'selected member'}`}
                  onPress={openFinanceForViewedMember}
                  style={styles.financeBand}
                >
                  <View style={styles.financeCopy}>
                    <Text style={styles.financeEyebrow}>Currency totals</Text>
                    <Text style={styles.financeTitle}>{viewedMember?.name || 'Selected member'}</Text>
                    <Text style={styles.financeBalances}>{formatBalancesInline(viewedFinanceMember?.totalBalances || {}, unitMap)}</Text>
                  </View>
                  <View style={styles.financeArrowWrap}>
                    <Ionicons name="arrow-forward" size={18} color={isDark ? colors.canvasStrong : colors.canvasText} />
                  </View>
                </Pressable>
              </FeedSection>
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
          <View style={styles.menuSheet}>
            <View style={styles.menuHeader}>
              <View style={styles.menuIdentity}>
                <AvatarPhotoImage
                  photoUrls={currentUser?.photoUrls}
                  preferredSize="320"
                  style={styles.menuAvatar}
                  fallback={
                    <View style={styles.menuAvatarFallback}>
                      <Text style={styles.menuAvatarFallbackText}>{createInitials(currentUser?.name)}</Text>
                    </View>
                  }
                />
                <View style={styles.menuIdentityCopy}>
                  <Text style={styles.menuTitle}>{currentUser?.name || 'Current member'}</Text>
                  <Text style={styles.menuSubtitle}>Choose whose dashboard you want to view on this device.</Text>
                </View>
              </View>
            </View>

            <View style={styles.menuList}>
              {members.map((member) => {
                const selected = member.id === viewedMember?.id;
                return (
                  <Pressable
                    key={`dashboard-menu-${member.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${member.name}'s dashboard`}
                    onPress={() => {
                      setViewedMemberId(member.id);
                      setMenuVisible(false);
                    }}
                    style={[styles.menuMemberRow, selected && styles.menuMemberRowSelected]}
                  >
                    <View style={styles.menuMemberRowCopy}>
                      <Text style={[styles.menuMemberName, selected && styles.menuMemberNameSelected]}>{member.name}</Text>
                      <Text style={[styles.menuMemberMeta, selected && styles.menuMemberMetaSelected]}>
                        {selected ? 'Currently viewing' : member.role || 'member'}
                      </Text>
                    </View>
                    {selected ? <Ionicons name="checkmark-circle" size={20} color={colors.accentDashboard} /> : null}
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.menuFooter}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Lock app and switch login"
                onPress={() => {
                  void handleLockAndSwitchUser();
                }}
                style={styles.menuSecondaryButton}
              >
                <Text style={styles.menuSecondaryButtonText}>Lock and switch login</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close dashboard menu"
                onPress={() => setMenuVisible(false)}
                style={styles.menuPrimaryButton}
              >
                <Text style={styles.menuPrimaryButtonText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const createStyles = (colors, isDark) => {
  const styles = StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.canvasStrong,
    },
    root: {
      flex: 1,
      backgroundColor: colors.canvasStrong,
    },
    heroSection: {
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: colors.canvas,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      gap: spacing.sm,
    },
    heroGlowOrb: {
      position: 'absolute',
      borderRadius: radii.pill,
    },
    heroGlowOrbLeft: {
      width: 190,
      height: 190,
      left: -38,
      top: -24,
    },
    heroGlowOrbBottom: {
      width: 210,
      height: 210,
      left: 94,
      bottom: -138,
    },
    heroGlowOrbTopRight: {
      width: 180,
      height: 180,
      right: -44,
      top: 44,
    },
    heroFaceBackdrop: {
      position: 'absolute',
      width: 430,
      height: 560,
      right: -160,
      top: -108,
      opacity: isDark ? 0.12 : 0.18,
    },
    heroScrim: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: withAlpha(colors.canvasStrong, isDark ? 0.3 : 0.18),
    },
    heroTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      zIndex: 1,
    },
    heroViewerChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radii.pill,
      backgroundColor: withAlpha(colors.canvasText, 0.08),
      borderWidth: 1,
      borderColor: colors.canvasLine,
      maxWidth: '74%',
    },
    heroViewerAvatar: {
      width: 36,
      height: 36,
      borderRadius: radii.pill,
    },
    heroViewerFallback: {
      width: 36,
      height: 36,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.canvasText, 0.16),
    },
    heroViewerFallbackText: {
      color: colors.canvasText,
      fontWeight: '800',
      fontSize: 13,
    },
    heroViewerCopy: {
      flex: 1,
      minWidth: 0,
    },
    heroViewerLabel: {
      color: colors.canvasTextMuted,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      fontWeight: '800',
    },
    heroViewerName: {
      color: colors.canvasText,
      fontSize: 15,
      fontWeight: '800',
      marginTop: 2,
    },
    heroMenuButton: {
      width: 46,
      height: 46,
      borderRadius: radii.pill,
      overflow: 'hidden',
      backgroundColor: withAlpha(colors.canvasText, 0.08),
      borderWidth: 1,
      borderColor: colors.canvasLine,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroMenuAvatar: {
      width: '100%',
      height: '100%',
    },
    heroMenuFallback: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.canvasText, 0.16),
    },
    heroMenuFallbackText: {
      color: colors.canvasText,
      fontWeight: '800',
      fontSize: 14,
    },
    heroTitleBlock: {
      gap: spacing.xs,
      zIndex: 1,
      paddingTop: spacing.xs,
    },
    heroDate: {
      color: colors.canvasTextMuted,
      fontSize: 13,
      fontWeight: '700',
    },
    heroTitle: {
      color: colors.canvasText,
      fontSize: 34,
      lineHeight: 38,
      fontWeight: '800',
      maxWidth: '76%',
    },
    heroSubtitle: {
      color: colors.canvasTextMuted,
      fontSize: 14,
      lineHeight: 20,
      maxWidth: '84%',
    },
    metricRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      zIndex: 1,
    },
    metricPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radii.pill,
      backgroundColor: withAlpha(colors.canvasText, 0.08),
      borderWidth: 1,
      borderColor: colors.canvasLine,
    },
    metricIconWrap: {
      width: 24,
      height: 24,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.canvasText, 0.08),
    },
    metricLabel: {
      color: colors.canvasTextMuted,
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      fontWeight: '800',
    },
    metricValue: {
      color: colors.canvasText,
      fontSize: 15,
      fontWeight: '800',
      marginTop: 1,
    },
    dateRailContent: {
      gap: spacing.sm,
      paddingTop: 2,
      paddingBottom: 2,
      zIndex: 1,
    },
    dateRailPill: {
      minWidth: 86,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 22,
      backgroundColor: withAlpha(colors.canvasText, 0.07),
      borderWidth: 1,
      borderColor: colors.canvasLine,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    dateRailPillSelected: {
      backgroundColor: isDark ? colors.canvasText : colors.panel,
      borderColor: isDark ? colors.canvasText : withAlpha(colors.panel, 0.95),
      ...(isDark ? shadows.float : shadows.card),
    },
    dateRailDay: {
      color: colors.canvasTextMuted,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      fontWeight: '800',
    },
    dateRailDate: {
      color: colors.canvasText,
      fontSize: 14,
      fontWeight: '800',
      marginTop: 2,
    },
    dateRailTextSelected: {
      color: isDark ? colors.canvasStrong : colors.ink,
    },
    dateTodayDot: {
      position: 'absolute',
      bottom: 8,
      width: 6,
      height: 6,
      borderRadius: radii.pill,
      backgroundColor: colors.accentDashboard,
    },
    scroll: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    scrollContent: {
      padding: spacing.md,
      paddingBottom: spacing.xxl,
    },
    contentSheet: {
      backgroundColor: isDark ? colors.panel : colors.panel,
      borderRadius: 30,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      marginTop: -26,
      borderWidth: isDark ? 1 : 0,
      borderColor: isDark ? colors.line : 'transparent',
      ...(isDark ? {} : shadows.card),
    },
    feedSection: {
      gap: spacing.md,
      paddingVertical: spacing.md,
    },
    feedSectionBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    feedSectionHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    feedSectionCopy: {
      flex: 1,
      gap: 4,
    },
    feedSectionTitle: {
      color: colors.ink,
      fontSize: 21,
      fontWeight: '800',
    },
    feedSectionMeta: {
      color: colors.inkMuted,
      lineHeight: 18,
    },
    feedSectionAction: {
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: radii.pill,
      backgroundColor: isDark ? colors.canvasText : colors.panelElevated,
      borderWidth: 1,
      borderColor: isDark ? colors.canvasText : colors.line,
    },
    feedSectionActionText: {
      color: isDark ? colors.canvasStrong : colors.ink,
      fontWeight: '700',
      fontSize: 12,
    },
    emptyText: {
      color: colors.inkMuted,
      lineHeight: 20,
    },
    emptyInlineText: {
      color: colors.inkMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    seriesBandList: {
      gap: 0,
    },
    seriesBand: {
      paddingVertical: spacing.md,
      gap: spacing.sm,
    },
    seriesBandBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    seriesHeaderRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    seriesCopy: {
      flex: 1,
      gap: 4,
    },
    seriesTitle: {
      color: colors.ink,
      fontSize: 18,
      fontWeight: '800',
    },
    seriesMeta: {
      color: colors.inkMuted,
      lineHeight: 18,
    },
    seriesCountText: {
      color: colors.inkMuted,
      fontSize: 12,
      fontWeight: '800',
    },
    seriesSnapshotRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    seriesSnapshotText: {
      color: colors.inkMuted,
      fontSize: 12,
    },
    seriesPreviewList: {
      marginLeft: 10,
      gap: 0,
    },
    previewRow: {
      paddingLeft: spacing.md,
      paddingRight: 0,
      paddingVertical: 10,
      borderLeftWidth: 2,
      borderLeftColor: withAlpha(colors.line, isDark ? 0.9 : 1),
    },
    previewRowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    previewCopy: {
      gap: 6,
    },
    previewTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    previewTitle: {
      color: colors.ink,
      fontSize: 15,
      fontWeight: '700',
      flex: 1,
      minWidth: 0,
    },
    previewStateChip: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: radii.pill,
      borderWidth: 1,
    },
    previewStateText: {
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: 0.45,
      fontWeight: '800',
    },
    previewNote: {
      color: colors.inkMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    remainingText: {
      color: colors.inkMuted,
      fontSize: 12,
      marginLeft: 10,
    },
    seriesActionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginLeft: 10,
      paddingTop: 2,
    },
    seriesActionButton: {
      borderRadius: radii.pill,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderWidth: 1,
    },
    seriesActionButtonPrimary: {
      backgroundColor: isDark ? colors.canvasText : colors.accentDashboard,
      borderColor: isDark ? colors.canvasText : colors.accentDashboard,
    },
    seriesActionButtonSecondary: {
      backgroundColor: colors.panel,
      borderColor: colors.line,
    },
    seriesActionText: {
      fontSize: 12,
      fontWeight: '800',
    },
    seriesActionTextPrimary: {
      color: isDark ? colors.canvasStrong : colors.onAccent,
    },
    seriesActionTextSecondary: {
      color: colors.ink,
    },
    flatList: {
      gap: 0,
    },
    flatRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingVertical: 14,
    },
    flatRowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    flatRowMain: {
      flex: 1,
      gap: spacing.sm,
    },
    flatRowTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    flatRowCopy: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    flatRowTitle: {
      color: colors.ink,
      fontSize: 16,
      fontWeight: '800',
    },
    flatRowTitleDone: {
      color: colors.inkMuted,
      textDecorationLine: 'line-through',
    },
    flatRowBody: {
      color: colors.inkMuted,
      lineHeight: 18,
    },
    flatRowBodyDone: {
      textDecorationLine: 'line-through',
    },
    rowIconWrap: {
      width: 30,
      paddingTop: 2,
      alignItems: 'center',
    },
    choreToggleButton: {
      minWidth: 76,
      minHeight: 40,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: isDark ? colors.canvasText : withAlpha(colors.accentDashboard, 0.26),
      backgroundColor: isDark ? colors.canvasText : withAlpha(colors.accentDashboard, 0.08),
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 14,
    },
    choreToggleButtonDone: {
      backgroundColor: withAlpha(colors.success, 0.12),
      borderColor: withAlpha(colors.success, 0.28),
    },
    choreToggleButtonLocked: {
      backgroundColor: withAlpha(colors.locked, 0.18),
      borderColor: withAlpha(colors.locked, 0.34),
    },
    choreToggleButtonText: {
      color: isDark ? colors.canvasStrong : colors.accentDashboard,
      fontWeight: '800',
    },
    choreToggleButtonTextDone: {
      color: colors.success,
    },
    choreToggleButtonTextLocked: {
      color: colors.inkMuted,
    },
    inlineTagRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    inlineTag: {
      borderRadius: radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderWidth: 1,
    },
    inlineTagText: {
      fontSize: 11,
      fontWeight: '700',
    },
    inlineTagWarm: {
      backgroundColor: withAlpha(colors.warning, 0.12),
      borderColor: withAlpha(colors.warning, 0.26),
    },
    inlineTagWarmText: {
      color: colors.warning,
    },
    inlineTagNeutral: {
      backgroundColor: colors.panelElevated,
      borderColor: colors.line,
    },
    inlineTagNeutralText: {
      color: colors.inkMuted,
    },
    inlineTagAccent: {
      backgroundColor: withAlpha(colors.accentDashboard, 0.1),
      borderColor: withAlpha(colors.accentDashboard, 0.24),
    },
    inlineTagAccentText: {
      color: colors.accentDashboard,
    },
    helperText: {
      color: colors.inkMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    completedGroup: {
      marginTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: colors.line,
      paddingTop: spacing.sm,
      gap: 0,
    },
    completedLabel: {
      color: colors.inkMuted,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      marginBottom: spacing.xs,
    },
    financeBand: {
      backgroundColor: colors.canvas,
      borderRadius: 24,
      padding: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      overflow: 'hidden',
    },
    financeCopy: {
      flex: 1,
      gap: 4,
    },
    financeEyebrow: {
      color: colors.canvasTextMuted,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.7,
      fontWeight: '800',
    },
    financeTitle: {
      color: colors.canvasText,
      fontSize: 24,
      fontWeight: '800',
    },
    financeBalances: {
      color: colors.canvasTextMuted,
      lineHeight: 20,
      marginTop: 2,
    },
    financeArrowWrap: {
      width: 42,
      height: 42,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? colors.canvasText : withAlpha(colors.canvasText, 0.09),
      borderWidth: 1,
      borderColor: isDark ? colors.canvasText : colors.canvasLine,
    },
    menuOverlay: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    menuBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: withAlpha(colors.canvasStrong, 0.48),
    },
    menuSheet: {
      backgroundColor: colors.panel,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
      ...shadows.float,
    },
    menuHeader: {
      gap: spacing.sm,
    },
    menuIdentity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    menuAvatar: {
      width: 52,
      height: 52,
      borderRadius: radii.pill,
    },
    menuAvatarFallback: {
      width: 52,
      height: 52,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
    },
    menuAvatarFallbackText: {
      color: colors.accentDashboard,
      fontWeight: '800',
      fontSize: 16,
    },
    menuIdentityCopy: {
      flex: 1,
      gap: 3,
    },
    menuTitle: {
      color: colors.ink,
      fontSize: 22,
      fontWeight: '800',
    },
    menuSubtitle: {
      color: colors.inkMuted,
      lineHeight: 19,
    },
    menuList: {
      gap: spacing.sm,
    },
    menuMemberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      borderRadius: radii.md,
      backgroundColor: colors.panelElevated,
      borderWidth: 1,
      borderColor: colors.line,
    },
    menuMemberRowSelected: {
      borderColor: withAlpha(colors.accentDashboard, 0.34),
      backgroundColor: withAlpha(colors.accentDashboard, 0.08),
    },
    menuMemberRowCopy: {
      flex: 1,
      gap: 3,
    },
    menuMemberName: {
      color: colors.ink,
      fontSize: 16,
      fontWeight: '800',
    },
    menuMemberNameSelected: {
      color: colors.accentDashboard,
    },
    menuMemberMeta: {
      color: colors.inkMuted,
      fontSize: 13,
    },
    menuMemberMetaSelected: {
      color: colors.accentDashboard,
    },
    menuFooter: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    menuSecondaryButton: {
      flex: 1,
      minHeight: 48,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
    },
    menuSecondaryButtonText: {
      color: colors.ink,
      fontWeight: '700',
      textAlign: 'center',
    },
    menuPrimaryButton: {
      minWidth: 110,
      minHeight: 48,
      borderRadius: radii.pill,
      backgroundColor: isDark ? colors.canvasText : colors.accentDashboard,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    menuPrimaryButtonText: {
      color: isDark ? colors.canvasStrong : colors.onAccent,
      fontWeight: '800',
    },
  });

  return styles;
};
