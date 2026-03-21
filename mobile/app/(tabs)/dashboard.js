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
import {
  getBucketedTasks,
  getLatestTaskUpdate,
  getTaskWorkflowState,
  isTaskDone,
  getTopLevelTaskUpdates,
  getTaskUpdateTime,
  isTaskUpdateReply,
  taskUpdateHasMeaningfulFeedbackContent,
} from '../../../lib/task-progress';
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


export default function DashboardTab() {
  const { colors, themeName } = useAppTheme();
  const isDark = themeName === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const { db, currentUser, familyMembers, isAuthenticated, instantReady } = useAppSession();
  const [selectedDate, setSelectedDate] = useState(() => localDateToUTC(new Date()));
  const [viewedMemberId, setViewedMemberId] = useState('');
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

  // Count tasks with new parent feedback that the kid hasn't responded to yet.
  // A task counts if: it has a feedback reply (isTaskUpdateReply + meaningful content),
  // AND there is no subsequent top-level (non-reply) update by the kid after that feedback.
  const newFeedbackCount = useMemo(() => {
    let count = 0;
    for (const card of taskSeriesCards) {
      for (const task of card.allTasks) {
        const updates = task.updates || [];
        // Get all non-draft top-level updates (kid submissions)
        const topLevel = getTopLevelTaskUpdates({ updates });
        // Get all feedback replies
        const feedbackReplies = updates.filter(
          (u) => !u.isDraft && isTaskUpdateReply(u) && taskUpdateHasMeaningfulFeedbackContent(u)
        );
        if (feedbackReplies.length === 0) continue;

        // Find the latest feedback time
        const latestFeedbackTime = Math.max(...feedbackReplies.map((r) => getTaskUpdateTime(r)));
        // Check if any top-level update came after the latest feedback
        const hasSubsequentUpdate = topLevel.some(
          (u) => getTaskUpdateTime(u) > latestFeedbackTime
        );
        if (!hasSubsequentUpdate) {
          count++;
        }
      }
    }
    return count;
  }, [taskSeriesCards]);

  // Track which task series have tasks with new feedback (for navigation)
  const feedbackSeriesId = useMemo(() => {
    for (const card of taskSeriesCards) {
      for (const task of card.allTasks) {
        const updates = task.updates || [];
        const feedbackReplies = updates.filter(
          (u) => !u.isDraft && isTaskUpdateReply(u) && taskUpdateHasMeaningfulFeedbackContent(u)
        );
        if (feedbackReplies.length === 0) continue;
        const latestFeedbackTime = Math.max(...feedbackReplies.map((r) => getTaskUpdateTime(r)));
        const topLevel = getTopLevelTaskUpdates({ updates });
        const hasSubsequentUpdate = topLevel.some((u) => getTaskUpdateTime(u) > latestFeedbackTime);
        if (!hasSubsequentUpdate) {
          return { seriesId: card.series.id, choreId: card.chore?.id || '' };
        }
      }
    }
    return null;
  }, [taskSeriesCards]);

  const [memberDropdownVisible, setMemberDropdownVisible] = useState(false);
  const [dateDropdownVisible, setDateDropdownVisible] = useState(false);

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

  function handleStatPress(stat) {
    if (stat === 'chores') {
      router.push('/chores');
    } else if (stat === 'messages') {
      router.push('/messages');
    } else if (stat === 'tasks') {
      openTaskSeriesOverview();
    } else if (stat === 'feedback' && feedbackSeriesId) {
      router.push({
        pathname: '/task-series/series',
        params: {
          seriesId: feedbackSeriesId.seriesId,
          choreId: feedbackSeriesId.choreId,
          date: selectedDateKey,
          memberId: viewedMember?.id || '',
        },
      });
    } else if (stat === 'xp') {
      router.push('/chores');
    }
  }

  function formatWeekdayDate(date) {
    const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
    const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${weekday}, ${monthDay}`;
  }

  // Build single-line summary text with dots
  const summaryLine = useMemo(() => {
    const pieces = [];
    pieces.push(`${incompleteChores.length} chore${incompleteChores.length === 1 ? '' : 's'} left`);
    pieces.push(`${unreadThreads.length} message${unreadThreads.length === 1 ? '' : 's'} unread`);
    if (activeTaskCount > 0) {
      pieces.push(`${activeTaskCount} task${activeTaskCount === 1 ? '' : 's'} to do`);
    }
    if (newFeedbackCount > 0) {
      pieces.push(`${newFeedbackCount} response${newFeedbackCount === 1 ? '' : 's'} with new feedback`);
    }
    return pieces.join(' · ');
  }, [incompleteChores.length, unreadThreads.length, activeTaskCount, newFeedbackCount]);

  return (
    <>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.root}>
          {/* Top row: [avatar] [Name's Day] [badges] --- [date] */}
          <View style={styles.topBar}>
            <Pressable
              testID="dashboard-member-switcher"
              accessibilityRole="button"
              accessibilityLabel={`Viewing ${viewedMember?.name || 'family member'}. Tap to switch.`}
              onPress={() => setMemberDropdownVisible(true)}
              style={styles.topBarMemberTouchable}
            >
              <AvatarPhotoImage
                photoUrls={viewedMember?.photoUrls}
                preferredSize="320"
                style={styles.topBarAvatar}
                fallback={
                  <View style={styles.topBarAvatarFallback}>
                    <Text style={styles.topBarAvatarFallbackText}>{createInitials(viewedMember?.name)}</Text>
                  </View>
                }
              />
              <Text style={styles.topBarTitle} numberOfLines={1}>
                {formatPossessiveLabel(viewedMember?.name, 'Day')}
              </Text>
            </Pressable>

            {/* Badge pills */}
            <View style={styles.statsRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`XP: ${viewedXp.current} of ${viewedXp.possible}`}
                onPress={() => handleStatPress('xp')}
                style={styles.statPill}
              >
                <Ionicons name="sparkles" size={14} color={colors.warning} />
                <Text style={styles.statValue}>{viewedXp.current}/{viewedXp.possible}</Text>
                <Text style={styles.statLabel}>XP</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${incompleteChores.length} chores left`}
                onPress={() => handleStatPress('chores')}
                style={styles.statPill}
              >
                <Ionicons name="checkmark-circle-outline" size={14} color={colors.accentChores} />
                <Text style={styles.statValue}>{incompleteChores.length}</Text>
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${unreadThreads.length} unread messages`}
                onPress={() => handleStatPress('messages')}
                style={styles.statPill}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={14} color={colors.accentDashboard} />
                <Text style={styles.statValue}>{unreadThreads.length}</Text>
              </Pressable>

              {activeTaskCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${activeTaskCount} tasks to do`}
                  onPress={() => handleStatPress('tasks')}
                  style={styles.statPill}
                >
                  <Ionicons name="list-outline" size={14} color={colors.accentCalendar} />
                  <Text style={styles.statValue}>{activeTaskCount}</Text>
                </Pressable>
              ) : null}

              {newFeedbackCount > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${newFeedbackCount} responses with new feedback`}
                  onPress={() => handleStatPress('feedback')}
                  style={styles.statPill}
                >
                  <Ionicons name="chatbox-outline" size={14} color={colors.accentMore} />
                  <Text style={styles.statValue}>{newFeedbackCount}</Text>
                </Pressable>
              ) : null}
            </View>

            {/* Mini finance chip */}
            <Pressable
              testID="dashboard-open-finance"
              accessibilityRole="button"
              accessibilityLabel={`Open finance for ${viewedMember?.name || 'selected member'}`}
              onPress={openFinanceForViewedMember}
              style={styles.financeChip}
            >
              <Text style={styles.financeChipText} numberOfLines={1}>
                {formatBalancesInline(viewedFinanceMember?.totalBalances || {}, unitMap)}
              </Text>
            </Pressable>

            <Pressable
              testID="dashboard-date-picker"
              accessibilityRole="button"
              accessibilityLabel={`Selected date: ${formatWeekdayDate(selectedDate)}. Tap to change.`}
              onPress={() => setDateDropdownVisible(true)}
              style={styles.topBarRight}
            >
              <Text style={styles.topBarDate}>{formatWeekdayDate(selectedDate)}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.canvasTextMuted} />
            </Pressable>
          </View>

          {/* Summary text line */}
          <View style={styles.summarySection}>
            <Text style={styles.summaryText}>{summaryLine}</Text>
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

            </View>
          </ScrollView>
        </View>
      </SafeAreaView>

      {/* Member switcher dropdown */}
      <Modal visible={memberDropdownVisible} transparent animationType="fade" onRequestClose={() => setMemberDropdownVisible(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setMemberDropdownVisible(false)}>
          <View style={styles.dropdownSheet}>
            <Text style={styles.dropdownHeading}>View someone's day</Text>
            {members.map((member) => {
              const selected = member.id === viewedMember?.id;
              return (
                <Pressable
                  key={`member-pick-${member.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${member.name}'s dashboard`}
                  onPress={() => {
                    setViewedMemberId(member.id);
                    setMemberDropdownVisible(false);
                  }}
                  style={[styles.dropdownMemberRow, selected && styles.dropdownMemberRowSelected]}
                >
                  <AvatarPhotoImage
                    photoUrls={member.photoUrls}
                    preferredSize="64"
                    style={styles.dropdownMemberAvatar}
                    fallback={
                      <View style={styles.dropdownMemberAvatarFallback}>
                        <Text style={styles.dropdownMemberAvatarFallbackText}>{createInitials(member.name)}</Text>
                      </View>
                    }
                  />
                  <Text style={[styles.dropdownMemberName, selected && styles.dropdownMemberNameSelected]}>
                    {member.name}
                  </Text>
                  {selected ? <Ionicons name="checkmark-circle" size={18} color={colors.accentDashboard} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>

      {/* Date picker dropdown (carousel) */}
      <Modal visible={dateDropdownVisible} transparent animationType="fade" onRequestClose={() => setDateDropdownVisible(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setDateDropdownVisible(false)}>
          <View style={[styles.dropdownSheet, styles.dropdownSheetDate]}>
            <Text style={styles.dropdownHeading}>Choose a date</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateCarouselContent}>
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
                    style={[styles.dateCarouselPill, isSelected && styles.dateCarouselPillSelected]}
                    onPress={() => {
                      setSelectedDate(date);
                      setDateDropdownVisible(false);
                    }}
                  >
                    <Text style={[styles.dateCarouselDay, isSelected && styles.dateCarouselTextSelected]}>
                      {formatDayLabel(date)}
                    </Text>
                    <Text style={[styles.dateCarouselDate, isSelected && styles.dateCarouselTextSelected]}>
                      {formatMonthDay(date)}
                    </Text>
                    {!isSelected && isToday ? <View style={styles.dateCarouselTodayDot} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
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

    // ── Compact top bar ──
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
    },
    financeChip: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.pill,
      backgroundColor: withAlpha(colors.accentFinance, 0.12),
      borderWidth: 1,
      borderColor: withAlpha(colors.accentFinance, 0.2),
      maxWidth: 160,
    },
    financeChipText: {
      color: colors.canvasText,
      fontSize: 13,
      fontWeight: '700',
    },
    topBarRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radii.pill,
      backgroundColor: withAlpha(colors.canvasText, 0.06),
    },
    topBarDate: {
      color: colors.canvasTextMuted,
      fontSize: 13,
      fontWeight: '700',
    },

    // ── Summary line ──
    summarySection: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      backgroundColor: colors.canvas,
    },
    summaryText: {
      color: colors.canvasTextMuted,
      fontSize: 13,
      lineHeight: 18,
    },

    // ── Badge pills (on top row between name and date) ──
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

    // ── Dropdown overlays ──
    dropdownOverlay: {
      flex: 1,
      backgroundColor: withAlpha(colors.canvasStrong, 0.48),
      justifyContent: 'flex-start',
      paddingTop: 100,
      paddingHorizontal: spacing.lg,
    },
    dropdownSheet: {
      backgroundColor: colors.panel,
      borderRadius: 20,
      padding: spacing.md,
      gap: spacing.xs,
      ...shadows.float,
    },
    dropdownSheetDate: {
      paddingBottom: spacing.md,
    },
    dropdownHeading: {
      color: colors.inkMuted,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: spacing.xs,
    },
    dropdownMemberRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: 10,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.md,
    },
    dropdownMemberRowSelected: {
      backgroundColor: withAlpha(colors.accentDashboard, 0.08),
    },
    dropdownMemberAvatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
    },
    dropdownMemberAvatarFallback: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.canvasText, 0.1),
    },
    dropdownMemberAvatarFallbackText: {
      color: colors.canvasText,
      fontWeight: '800',
      fontSize: 12,
    },
    dropdownMemberName: {
      flex: 1,
      color: colors.ink,
      fontSize: 15,
      fontWeight: '700',
    },
    dropdownMemberNameSelected: {
      color: colors.accentDashboard,
    },

    // ── Date carousel in dropdown ──
    dateCarouselContent: {
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    dateCarouselPill: {
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
    dateCarouselPillSelected: {
      backgroundColor: isDark ? colors.canvasText : colors.accentDashboard,
      borderColor: isDark ? colors.canvasText : colors.accentDashboard,
    },
    dateCarouselDay: {
      color: colors.inkMuted,
      fontSize: 11,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      fontWeight: '800',
    },
    dateCarouselDate: {
      color: colors.ink,
      fontSize: 14,
      fontWeight: '800',
      marginTop: 2,
    },
    dateCarouselTextSelected: {
      color: isDark ? colors.canvasStrong : colors.onAccent,
    },
    dateCarouselTodayDot: {
      position: 'absolute',
      bottom: 6,
      width: 5,
      height: 5,
      borderRadius: radii.pill,
      backgroundColor: colors.accentDashboard,
    },

    // ── Content below ──
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
  });

  return styles;
};
