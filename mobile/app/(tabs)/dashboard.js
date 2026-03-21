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

  // Dynamic quadrant sizing — top cards size to content, bottom cards fill remaining
  const [leftColH, setLeftColH] = useState(0);
  const [rightColH, setRightColH] = useState(0);
  const [choresScrollH, setChoresScrollH] = useState(0);
  const [tasksScrollH, setTasksScrollH] = useState(0);

  const Q_HEADER = 42;
  const Q_BOTTOM_MIN = 140;
  const Q_GAP = 8;

  const leftTopH = useMemo(() => {
    if (!leftColH || !choresScrollH) return undefined;
    return Math.min(Q_HEADER + choresScrollH, leftColH - Q_BOTTOM_MIN - Q_GAP);
  }, [leftColH, choresScrollH]);

  const rightTopH = useMemo(() => {
    if (!rightColH || !tasksScrollH) return undefined;
    return Math.min(Q_HEADER + tasksScrollH, rightColH - Q_BOTTOM_MIN - Q_GAP);
  }, [rightColH, tasksScrollH]);

  // Dynamic column width — give more room to whichever side has truncated titles
  const columnFlex = useMemo(() => {
    const maxChoreLen = choreRows.reduce((m, r) => Math.max(m, (r.chore.title || '').length), 0);
    const maxTaskLen = taskSeriesCards.reduce((m, c) =>
      c.scheduledTasks.reduce((m2, t) => Math.max(m2, (t.text || '').length), m), 0);
    const THRESHOLD = 30;
    const tasksTrunc = maxTaskLen > THRESHOLD && taskSeriesCards.length > 0;
    const choresTrunc = maxChoreLen > THRESHOLD && choreRows.length > 0;
    if (tasksTrunc && !choresTrunc) return { left: 2, right: 3 };
    if (choresTrunc && !tasksTrunc) return { left: 3, right: 2 };
    return { left: 1, right: 1 };
  }, [choreRows, taskSeriesCards]);

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

          {/* 2×2 Quadrant grid */}
          <View style={styles.quadrantGrid}>
            {/* Left column: Chores (top) + Messages (bottom) */}
            <View
              style={[styles.quadrantColumn, { flex: columnFlex.left }]}
              onLayout={(e) => setLeftColH(e.nativeEvent.layout.height)}
            >
              {/* Top-left: Chores */}
              <View style={[styles.quadrantCard, leftTopH != null && { height: leftTopH, flex: 0 }]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/chores')}
                  style={styles.quadrantHeader}
                >
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.accentChores} />
                  <Text style={styles.quadrantTitle}>Chores</Text>
                  <Text style={styles.quadrantMeta}>
                    {incompleteChores.length} left{completedChores.length > 0 ? ` · ${completedChores.length} done` : ''}
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={colors.inkMuted} style={styles.quadrantChevron} />
                </Pressable>
                <ScrollView
                  style={styles.quadrantTopScroll}
                  showsVerticalScrollIndicator={false}
                  onContentSizeChange={(_, h) => setChoresScrollH(h)}
                >
                  {dashboardQuery.isLoading ? (
                    <Text style={styles.qEmptyText}>Loading…</Text>
                  ) : incompleteChores.length === 0 && completedChores.length === 0 ? (
                    <Text style={styles.qEmptyText}>No chores today</Text>
                  ) : (
                    <>
                      {incompleteChores.map((row, index) => {
                        const pKey = completionKey(row.chore.id, viewedMember.id, selectedDateKey);
                        const isBusy = pendingCompletionKeys.has(pKey);
                        const blockedByUpForGrabs =
                          !!row.chore.isUpForGrabs &&
                          !!row.upForGrabsCompletedById &&
                          row.upForGrabsCompletedById !== viewedMember.id &&
                          !row.isDone;

                        return (
                          <View key={`q-chore-${row.chore.id}`} style={[styles.qRow, index > 0 && styles.qRowBorder]}>
                            <Pressable
                              testID={`q-chore-toggle-${row.chore.id}`}
                              accessibilityRole="button"
                              accessibilityLabel={`${row.isDone ? 'Undo' : 'Complete'} ${row.chore.title}`}
                              disabled={isBusy || blockedByUpForGrabs}
                              onPress={() => { void handleToggleCompletion(row.chore, viewedMember.id); }}
                              style={[styles.qCheck, row.isDone && styles.qCheckDone, (isBusy || blockedByUpForGrabs) && styles.qCheckLocked]}
                            >
                              <Ionicons
                                name={row.isDone ? 'checkmark-circle' : 'ellipse-outline'}
                                size={20}
                                color={isBusy ? colors.inkMuted : blockedByUpForGrabs ? colors.inkMuted : row.isDone ? colors.success : colors.accentChores}
                              />
                            </Pressable>
                            <View style={styles.qRowCopy}>
                              <Text style={[styles.qRowTitle, row.isDone && styles.qRowTitleDone]} numberOfLines={1}>
                                {row.chore.title || 'Untitled'}
                              </Text>
                              {row.chore.isUpForGrabs ? (
                                <Text style={styles.qRowMeta}>Up for grabs</Text>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                      {completedChores.length > 0 ? (
                        <>
                          <Text style={styles.qSectionLabel}>Finished</Text>
                          {completedChores.map((row, index) => {
                            const pKey = completionKey(row.chore.id, viewedMember.id, selectedDateKey);
                            const isBusy = pendingCompletionKeys.has(pKey);
                            return (
                              <View key={`q-done-${row.chore.id}`} style={[styles.qRow, index > 0 && styles.qRowBorder]}>
                                <Pressable
                                  accessibilityRole="button"
                                  accessibilityLabel={`Undo ${row.chore.title}`}
                                  disabled={isBusy}
                                  onPress={() => { void handleToggleCompletion(row.chore, viewedMember.id); }}
                                  style={[styles.qCheck, styles.qCheckDone]}
                                >
                                  <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                                </Pressable>
                                <Text style={[styles.qRowTitle, styles.qRowTitleDone]} numberOfLines={1}>
                                  {row.chore.title || 'Untitled'}
                                </Text>
                              </View>
                            );
                          })}
                        </>
                      ) : null}
                    </>
                  )}
                </ScrollView>
              </View>

              {/* Bottom-left: Messages */}
              <View style={[styles.quadrantCard, styles.quadrantCardBottom]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/messages')}
                  style={styles.quadrantHeader}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.accentDashboard} />
                  <Text style={styles.quadrantTitle}>Messages</Text>
                  {unreadThreads.length > 0 ? (
                    <Text style={styles.quadrantMeta}>{unreadThreads.length} unread</Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={14} color={colors.inkMuted} style={styles.quadrantChevron} />
                </Pressable>
                <ScrollView style={styles.quadrantBottomScroll} showsVerticalScrollIndicator={false}>
                  {unreadThreads.length === 0 ? (
                    <Text style={styles.qEmptyText}>All caught up</Text>
                  ) : (
                    unreadThreads.map((thread, index) => (
                      <Pressable
                        key={`q-thread-${thread.id}`}
                        accessibilityRole="button"
                        onPress={() => router.push({ pathname: '/messages', params: { threadId: thread.id } })}
                        style={[styles.qRow, index > 0 && styles.qRowBorder]}
                      >
                        <View style={styles.qRowCopy}>
                          <Text style={styles.qRowTitle} numberOfLines={1}>{thread.displayName}</Text>
                          <Text style={styles.qRowMeta} numberOfLines={1}>{thread.previewText}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={colors.inkMuted} />
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </View>
            </View>

            {/* Right column: Tasks (top) + Calendar (bottom) */}
            <View
              style={[styles.quadrantColumn, { flex: columnFlex.right }]}
              onLayout={(e) => setRightColH(e.nativeEvent.layout.height)}
            >
              {/* Top-right: Tasks */}
              <View style={[styles.quadrantCard, rightTopH != null && { height: rightTopH, flex: 0 }]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={openTaskSeriesOverview}
                  style={styles.quadrantHeader}
                >
                  <Ionicons name="list-outline" size={16} color={colors.accentCalendar} />
                  <Text style={styles.quadrantTitle}>Tasks</Text>
                  {activeTaskCount > 0 ? (
                    <Text style={styles.quadrantMeta}>{activeTaskCount} active</Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={14} color={colors.inkMuted} style={styles.quadrantChevron} />
                </Pressable>
                <ScrollView
                  style={styles.quadrantTopScroll}
                  showsVerticalScrollIndicator={false}
                  onContentSizeChange={(_, h) => setTasksScrollH(h)}
                >
                  {dashboardQuery.isLoading ? (
                    <Text style={styles.qEmptyText}>Loading…</Text>
                  ) : taskSeriesCards.length === 0 ? (
                    <Text style={styles.qEmptyText}>No tasks today</Text>
                  ) : (
                    taskSeriesCards.map((card, cardIndex) => {
                      // Build flat task rows with parent/subtask grouping
                      const taskRows = [];
                      const parentIdsSeen = new Set();

                      for (const task of card.scheduledTasks) {
                        const parentTask = firstRef(task.parentTask);
                        if (parentTask && !parentIdsSeen.has(parentTask.id)) {
                          parentIdsSeen.add(parentTask.id);
                          taskRows.push({ type: 'parent', task: parentTask, isSubtask: false });
                        }
                        taskRows.push({ type: 'task', task, isSubtask: !!parentTask });
                      }

                      return (
                        <View key={`q-series-${card.id}`}>
                          {/* Series name header */}
                          <View style={[styles.qSeriesHeader, cardIndex > 0 && styles.qRowBorder]}>
                            <Text style={styles.qSeriesName} numberOfLines={1}>{card.series.name || 'Untitled series'}</Text>
                            <Text style={styles.qSeriesCount}>{card.incompleteCount} left</Text>
                          </View>
                          {taskRows.length === 0 ? (
                            <Text style={styles.qEmptyInline}>No scheduled tasks</Text>
                          ) : (
                            taskRows.map((row, rowIndex) => {
                              if (row.type === 'parent') {
                                return (
                                  <View key={`parent-${row.task.id}`} style={[styles.qRow, rowIndex > 0 && styles.qRowBorder]}>
                                    <Ionicons name="folder-outline" size={14} color={colors.inkMuted} />
                                    <Text style={styles.qParentTitle} numberOfLines={1}>{row.task.text || 'Group'}</Text>
                                  </View>
                                );
                              }

                              const workflowState = getTaskWorkflowState(row.task);
                              const latestUpdate = getLatestTaskUpdate(row.task);
                              const note = String(latestUpdate?.note || '').trim();
                              const toneColor =
                                workflowState === 'done' ? colors.success
                                : workflowState === 'needs_review' ? colors.accentDashboard
                                : workflowState === 'blocked' ? colors.warning
                                : workflowState === 'skipped' ? colors.inkMuted
                                : colors.accentCalendar;

                              return (
                                <Pressable
                                  key={row.task.id || `task-${card.id}-${rowIndex}`}
                                  accessibilityRole="button"
                                  onPress={() => router.push({
                                    pathname: '/task-series/series',
                                    params: { seriesId: card.series.id, choreId: card.chore?.id || '', date: selectedDateKey, memberId: viewedMember?.id || '' },
                                  })}
                                  style={[styles.qRow, rowIndex > 0 && styles.qRowBorder, row.isSubtask && styles.qSubtaskIndent]}
                                >
                                  <View style={styles.qRowCopy}>
                                    <View style={styles.qTaskTitleRow}>
                                      <Text style={[styles.qRowTitle, styles.qTaskTitleFlex]} numberOfLines={1}>{row.task.text || 'Untitled'}</Text>
                                      <View style={[styles.qStateChip, { backgroundColor: withAlpha(toneColor, 0.12), borderColor: withAlpha(toneColor, 0.3) }]}>
                                        <Text style={[styles.qStateText, { color: toneColor }]}>{formatTaskStateLabel(workflowState)}</Text>
                                      </View>
                                    </View>
                                    {note ? <Text style={styles.qRowMeta} numberOfLines={2}>{note}</Text> : null}
                                  </View>
                                </Pressable>
                              );
                            })
                          )}
                        </View>
                      );
                    })
                  )}
                </ScrollView>
              </View>

              {/* Bottom-right: Calendar */}
              <View style={[styles.quadrantCard, styles.quadrantCardBottom]}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/calendar')}
                  style={styles.quadrantHeader}
                >
                  <Ionicons name="calendar-outline" size={16} color={colors.accentCalendar} />
                  <Text style={styles.quadrantTitle}>Calendar</Text>
                  {calendarEvents.length > 0 ? (
                    <Text style={styles.quadrantMeta}>{calendarEvents.length} event{calendarEvents.length === 1 ? '' : 's'}</Text>
                  ) : null}
                  <Ionicons name="chevron-forward" size={14} color={colors.inkMuted} style={styles.quadrantChevron} />
                </Pressable>
                <ScrollView style={styles.quadrantBottomScroll} showsVerticalScrollIndicator={false}>
                  {calendarEvents.length === 0 ? (
                    <Text style={styles.qEmptyText}>No events coming up</Text>
                  ) : (
                    calendarEvents.map((event, index) => (
                      <Pressable
                        key={`q-cal-${event.id}`}
                        accessibilityRole="button"
                        onPress={() => router.push('/calendar')}
                        style={[styles.qRow, index > 0 && styles.qRowBorder]}
                      >
                        <View style={styles.qRowCopy}>
                          <Text style={styles.qRowTitle} numberOfLines={1}>{event.title}</Text>
                          <Text style={styles.qRowMeta}>{event.timeLabel}{event.isFamilyWide ? ' · Family' : ''}</Text>
                        </View>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              </View>
            </View>
          </View>
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

    // ── 2×2 Quadrant grid ──
    quadrantGrid: {
      flex: 1,
      flexDirection: 'row',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    quadrantColumn: {
      flex: 1,
      gap: spacing.sm,
    },
    quadrantCard: {
      flex: 1,
      backgroundColor: isDark ? colors.panel : colors.panel,
      borderRadius: radii.lg,
      borderWidth: isDark ? 1 : 0,
      borderColor: isDark ? colors.line : 'transparent',
      overflow: 'hidden',
      ...(isDark ? {} : shadows.card),
    },
    quadrantCardBottom: {
      flex: 1,
      minHeight: 140,
    },
    quadrantHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    quadrantTitle: {
      color: colors.ink,
      fontSize: 15,
      fontWeight: '800',
    },
    quadrantMeta: {
      color: colors.inkMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    quadrantChevron: {
      marginLeft: 'auto',
    },
    quadrantTopScroll: {
      flex: 1,
      paddingHorizontal: spacing.md,
    },
    quadrantBottomScroll: {
      flex: 1,
      paddingHorizontal: spacing.md,
    },

    // ── Quadrant row items ──
    qRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: 10,
    },
    qRowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    qRowCopy: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    qRowTitle: {
      color: colors.ink,
      fontSize: 14,
      fontWeight: '700',
    },
    qRowTitleDone: {
      color: colors.inkMuted,
      textDecorationLine: 'line-through',
    },
    qRowMeta: {
      color: colors.inkMuted,
      fontSize: 12,
      lineHeight: 16,
    },
    qEmptyText: {
      color: colors.inkMuted,
      fontSize: 13,
      paddingVertical: spacing.md,
      textAlign: 'center',
    },
    qEmptyInline: {
      color: colors.inkMuted,
      fontSize: 12,
      paddingVertical: 6,
      paddingHorizontal: spacing.sm,
    },
    qSectionLabel: {
      color: colors.inkMuted,
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: spacing.sm,
      marginBottom: 2,
    },

    // ── Chore check circles ──
    qCheck: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    qCheckDone: {},
    qCheckLocked: {
      opacity: 0.5,
    },

    // ── Task series in quadrant ──
    qSeriesHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 8,
      gap: spacing.xs,
    },
    qSeriesName: {
      color: colors.ink,
      fontSize: 13,
      fontWeight: '800',
      flex: 1,
    },
    qSeriesCount: {
      color: colors.inkMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    qParentTitle: {
      color: colors.inkMuted,
      fontSize: 13,
      fontWeight: '700',
      fontStyle: 'italic',
      flex: 1,
    },
    qSubtaskIndent: {
      paddingLeft: 20,
    },
    qTaskTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    qTaskTitleFlex: {
      flex: 1,
      minWidth: 0,
    },
    qStateChip: {
      flexShrink: 0,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radii.pill,
      borderWidth: 1,
    },
    qStateText: {
      fontSize: 9,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      fontWeight: '800',
    },
  });

  return styles;
};
