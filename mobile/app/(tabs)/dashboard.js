import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
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
import { usePhotoUri } from '../../src/hooks/usePhotoUri';
import { getPhotoKey } from '../../src/lib/photo-urls';
import { findUnreadMembershipsForMember } from '../../src/lib/message-memberships';
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

function buildDashboardCalendarWhere(date) {
  const baseYear = date.getFullYear();
  const baseMonth = date.getMonth() + 1;
  const nextMonthDate = new Date(baseYear, date.getMonth() + 1, 1);
  const nextYear = nextMonthDate.getFullYear();
  const nextMonth = nextMonthDate.getMonth() + 1;
  const conditions = [{ year: baseYear, month: baseMonth }];
  if (nextYear !== baseYear || nextMonth !== baseMonth) {
    conditions.push({ year: nextYear, month: nextMonth });
  }
  return conditions;
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
  const [taskSeriesQueryEnabled, setTaskSeriesQueryEnabled] = useState(false);
  const currentUserIdRef = useRef('');
  const dashboardCalendarWhere = useMemo(() => buildDashboardCalendarWhere(selectedDate), [selectedDate]);

  useEffect(() => {
    if (!isAuthenticated || !instantReady) {
      setTaskSeriesQueryEnabled(false);
      return undefined;
    }

    const timer = setTimeout(() => {
      setTaskSeriesQueryEnabled(true);
    }, 0);

    return () => clearTimeout(timer);
  }, [isAuthenticated, instantReady]);

  const householdQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          familyMembers: {
            $: { order: { order: 'asc' } },
            allowanceEnvelopes: {},
          },
          unitDefinitions: {},
        }
      : null
  );

  const choresQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          chores: {
            assignees: {},
            assignments: {
              familyMember: {},
            },
            completions: {
              completedBy: {},
              markedBy: {},
            },
          },
        }
      : null
  );

  const taskSeriesQuery = db.useQuery(
    isAuthenticated && instantReady && taskSeriesQueryEnabled
      ? {
          chores: {
            assignees: {},
            assignments: {
              familyMember: {},
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
        }
      : null
  );

  const calendarSummaryQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          calendarItems: {
            pertainsTo: {},
            $: {
              where:
                dashboardCalendarWhere.length <= 1
                  ? dashboardCalendarWhere[0] || {}
                  : { or: dashboardCalendarWhere },
            },
          },
        }
      : null
  );

  const messageSummaryQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          messageThreadMembers: {},
          messageThreads: {},
        }
      : null
  );

  const taskSeriesByChoreId = useMemo(
    () =>
      new Map(
        (taskSeriesQuery.data?.chores || []).map((chore) => [chore.id, chore.taskSeries || []])
      ),
    [taskSeriesQuery.data?.chores]
  );
  const members = useMemo(() => householdQuery.data?.familyMembers || familyMembers || [], [householdQuery.data?.familyMembers, familyMembers]);
  const unitDefinitions = useMemo(() => householdQuery.data?.unitDefinitions || [], [householdQuery.data?.unitDefinitions]);
  const chores = useMemo(
    () =>
      (choresQuery.data?.chores || []).map((chore) => ({
        ...chore,
        taskSeries: taskSeriesByChoreId.get(chore.id) || [],
      })),
    [choresQuery.data?.chores, taskSeriesByChoreId]
  );
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

  const bgPhotoKey = getPhotoKey(viewedMember?.photoUrls, '1200');
  const bgPhotoUri = usePhotoUri(bgPhotoKey);

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

        if (!assignedMembers.some((member) => member.id === viewedMember.id)) return null;

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
    const items = calendarSummaryQuery.data?.calendarItems || [];
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
  }, [calendarSummaryQuery.data?.calendarItems, viewedMember?.id, selectedDate]);

  const unreadThreads = useMemo(() => {
    if (!viewedMember?.id || !messageSummaryQuery.data?.messageThreads) return [];
    const threads = messageSummaryQuery.data.messageThreads;
    const unreadMemberships = findUnreadMembershipsForMember(
      messageSummaryQuery.data?.messageThreadMembers || [],
      viewedMember.id
    );
    if (unreadMemberships.length === 0) return [];
    const membershipsByThreadId = new Map(unreadMemberships.map((membership) => [membership.threadId, membership]));
    const result = [];

    for (const thread of threads) {
      if (!thread.latestMessageAt) continue;
      const membership = membershipsByThreadId.get(thread.id);
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
  }, [messageSummaryQuery.data?.messageThreadMembers, messageSummaryQuery.data?.messageThreads, viewedMember?.id]);
  const choresLoading = choresQuery.isLoading && choreRows.length === 0;
  const taskSeriesLoading = taskSeriesQueryEnabled && taskSeriesQuery.isLoading && taskSeriesCards.length === 0;

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

  // ── Adaptive layout engine ──
  const { width: screenWidth } = useWindowDimensions();
  const [gridH, setGridH] = useState(0);

  // Approximate row heights for content estimation
  const CHORE_ROW_H = 50;
  const TASK_ROW_H = 68;
  const TASK_PARENT_ROW_H = 38;
  const TASK_SERIES_HDR_H = 38;
  const MSG_ROW_H = 56;
  const CAL_ROW_H = 56;
  const Q_HEADER_H = 42;
  const Q_EMPTY_H = 44;
  const Q_SECTION_LABEL_H = 30;
  const Q_GAP = 10; // gap between cards

  // Estimated content heights for each section
  const choresEstH = useMemo(() => {
    if (choreRows.length === 0) return Q_HEADER_H + Q_EMPTY_H;
    let h = Q_HEADER_H + incompleteChores.length * CHORE_ROW_H;
    if (completedChores.length > 0) h += Q_SECTION_LABEL_H + completedChores.length * CHORE_ROW_H;
    return h;
  }, [choreRows.length, incompleteChores.length, completedChores.length]);

  const tasksEstH = useMemo(() => {
    if (taskSeriesCards.length === 0) return Q_HEADER_H + Q_EMPTY_H;
    let h = Q_HEADER_H;
    for (const card of taskSeriesCards) {
      h += TASK_SERIES_HDR_H;
      const parentIds = new Set();
      for (const t of card.scheduledTasks) {
        const p = firstRef(t.parentTask);
        if (p && !parentIds.has(p.id)) { parentIds.add(p.id); h += TASK_PARENT_ROW_H; }
        h += TASK_ROW_H;
      }
    }
    return h;
  }, [taskSeriesCards]);

  const msgsEstH = useMemo(() => {
    if (unreadThreads.length === 0) return Q_HEADER_H + Q_EMPTY_H;
    return Q_HEADER_H + unreadThreads.length * MSG_ROW_H;
  }, [unreadThreads.length]);

  const calEstH = useMemo(() => {
    if (calendarEvents.length === 0) return Q_HEADER_H + Q_EMPTY_H;
    return Q_HEADER_H + calendarEvents.length * CAL_ROW_H;
  }, [calendarEvents.length]);

  // Minimum bottom heights: header + min(2, count) items
  const msgsMinH = Q_HEADER_H + (unreadThreads.length === 0 ? Q_EMPTY_H : Math.min(2, unreadThreads.length) * MSG_ROW_H);
  const calMinH = Q_HEADER_H + (calendarEvents.length === 0 ? Q_EMPTY_H : Math.min(2, calendarEvents.length) * CAL_ROW_H);

  // Layout mode decision + vertical sizing
  const layoutCalc = useMemo(() => {
    if (!gridH) return { mode: 'row', topH: 0, leftBottomH: 0, rightBottomH: 0 };

    // Row-based: top row = max(chores, tasks), bottom row = remainder (shared)
    const rowTopH = Math.max(choresEstH, tasksEstH);
    const rowBottomH = Math.max(gridH - rowTopH - Q_GAP, Math.max(msgsMinH, calMinH));
    const rowTopClamped = gridH - rowBottomH - Q_GAP;
    const rowMsgsVisible = Math.floor(Math.max(0, rowBottomH - Q_HEADER_H) / MSG_ROW_H);
    const rowCalVisible = Math.floor(Math.max(0, rowBottomH - Q_HEADER_H) / CAL_ROW_H);
    const rowChoresVisible = Math.floor(Math.max(0, rowTopClamped - Q_HEADER_H) / CHORE_ROW_H);
    const rowTasksVisible = Math.floor(Math.max(0, rowTopClamped - Q_HEADER_H) / TASK_ROW_H);

    // Column-based: each column independent
    const colLeftBottomH = Math.max(msgsMinH, gridH - choresEstH - Q_GAP);
    const colRightBottomH = Math.max(calMinH, gridH - tasksEstH - Q_GAP);
    const colLeftTopH = gridH - colLeftBottomH - Q_GAP;
    const colRightTopH = gridH - colRightBottomH - Q_GAP;
    const colChoresVisible = Math.floor(Math.max(0, colLeftTopH - Q_HEADER_H) / CHORE_ROW_H);
    const colTasksVisible = Math.floor(Math.max(0, colRightTopH - Q_HEADER_H) / TASK_ROW_H);
    const colMsgsVisible = Math.floor(Math.max(0, colLeftBottomH - Q_HEADER_H) / MSG_ROW_H);
    const colCalVisible = Math.floor(Math.max(0, colRightBottomH - Q_HEADER_H) / CAL_ROW_H);

    // Score: chores+tasks weighted higher (priority)
    const P = 3; // priority weight for chores/tasks
    const rowScore = P * (rowChoresVisible + rowTasksVisible) + rowMsgsVisible + rowCalVisible;
    const colScore = P * (colChoresVisible + colTasksVisible) + colMsgsVisible + colCalVisible;

    // Prefer row-based on tie (cleaner look)
    if (colScore > rowScore) {
      // Column-based — but prefer matching bottom heights when possible
      let leftBotH = colLeftBottomH;
      let rightBotH = colRightBottomH;
      const shorter = Math.min(leftBotH, rightBotH);
      const longer = Math.max(leftBotH, rightBotH);
      // Match heights if the shorter side's content fits in the shorter height
      const shorterIsLeft = leftBotH <= rightBotH;
      const shorterContent = shorterIsLeft ? msgsEstH : calEstH;
      if (shorterContent <= shorter) {
        // Shorter side has room — can we also fit longer side's content in shorter?
        const longerContent = shorterIsLeft ? calEstH : msgsEstH;
        if (longerContent <= shorter) {
          // Both fit in shorter — match to shorter
          leftBotH = shorter;
          rightBotH = shorter;
        }
        // Otherwise keep different heights to show more content
      }
      return {
        mode: 'column',
        leftTopH: gridH - leftBotH - Q_GAP,
        rightTopH: gridH - rightBotH - Q_GAP,
        leftBottomH: leftBotH,
        rightBottomH: rightBotH,
      };
    }

    // Row-based
    const topH = Math.min(rowTopH, rowTopClamped);
    const bottomH = gridH - topH - Q_GAP;
    return {
      mode: 'row',
      topH,
      bottomH,
      leftTopH: topH,
      rightTopH: topH,
      leftBottomH: bottomH,
      rightBottomH: bottomH,
    };
  }, [gridH, choresEstH, tasksEstH, msgsEstH, calEstH, msgsMinH, calMinH]);

  // Horizontal split calculation — find optimal split based on text widths
  // Approximate: 8px per char at 14px font, plus ~80px for padding/icons/chips
  const CHAR_PX = 8;
  const CARD_PAD = 80;
  const GRID_PAD = 20; // total horizontal padding around grid
  const MIN_COL_FRAC = 0.3;

  function calcSplitFrac(leftChars, rightChars, availW) {
    const leftDesired = leftChars * CHAR_PX + CARD_PAD;
    const rightDesired = rightChars * CHAR_PX + CARD_PAD;
    if (leftDesired + rightDesired <= availW) {
      // Both fit — only shift from 0.5 if one side actually needs it
      // Give each side at least what it needs, keep rest centered
      const leftMin = leftDesired / availW;
      const rightMin = rightDesired / availW;
      // Clamp to [leftMin, 1-rightMin], biased toward 0.5
      return Math.max(leftMin, Math.min(1 - rightMin, 0.5));
    }
    // Both truncated — stay 50/50
    if (leftDesired > availW * 0.5 && rightDesired > availW * 0.5) return 0.5;
    // Only one side truncated — give it more room, but never truncate the other side
    if (leftDesired > availW * 0.5) {
      // Left is truncated, right has room — shift split right
      // Cap so right keeps at least rightDesired
      const maxSplit = 1 - rightDesired / availW;
      return Math.max(MIN_COL_FRAC, Math.min(1 - MIN_COL_FRAC, maxSplit));
    }
    // Right is truncated, left has room — shift split left
    // Floor so left keeps at least leftDesired
    const minSplit = leftDesired / availW;
    return Math.max(MIN_COL_FRAC, Math.min(1 - MIN_COL_FRAC, minSplit));
  }

  const availW = screenWidth - GRID_PAD;

  const topSplitFrac = useMemo(() => {
    const maxChoreLen = choreRows.reduce((m, r) => Math.max(m, (r.chore.title || '').length), 0);
    const maxTaskLen = taskSeriesCards.reduce((m, c) =>
      c.scheduledTasks.reduce((m2, t) => Math.max(m2, (t.text || '').length), m), 0);
    return calcSplitFrac(maxChoreLen, maxTaskLen, availW);
  }, [choreRows, taskSeriesCards, availW]);

  const bottomSplitFrac = useMemo(() => {
    if (layoutCalc.mode === 'column' && layoutCalc.leftBottomH !== layoutCalc.rightBottomH) {
      // Column mode with different heights — use same split as top
      return topSplitFrac;
    }
    // Row mode or matched bottom heights — calculate independently
    const maxMsgLen = unreadThreads.reduce((m, t) => Math.max(m, (t.displayName || '').length), 0);
    const maxCalLen = calendarEvents.reduce((m, e) => Math.max(m, (e.title || '').length), 0);
    return calcSplitFrac(maxMsgLen, maxCalLen, availW);
  }, [unreadThreads, calendarEvents, availW, layoutCalc.mode, layoutCalc.leftBottomH, layoutCalc.rightBottomH, topSplitFrac]);

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
          {/* Background face image — low opacity, zoomed, faded edges */}
          {bgPhotoUri ? (
            <View style={styles.bgFaceWrap} pointerEvents="none">
              <Image
                source={{ uri: bgPhotoUri }}
                style={styles.bgFaceImage}
                resizeMode="cover"
              />
              {/* Top edge fade: gradient-like strips from opaque to transparent */}
              <View style={[styles.bgFadeStrip, styles.bgFadeTop1]} />
              <View style={[styles.bgFadeStrip, styles.bgFadeTop2]} />
              <View style={[styles.bgFadeStrip, styles.bgFadeTop3]} />
              <View style={[styles.bgFadeStrip, styles.bgFadeTop4]} />
              {/* Left edge fade */}
              <View style={[styles.bgFadeStrip, styles.bgFadeLeft1]} />
              <View style={[styles.bgFadeStrip, styles.bgFadeLeft2]} />
              <View style={[styles.bgFadeStrip, styles.bgFadeLeft3]} />
              <View style={[styles.bgFadeStrip, styles.bgFadeLeft4]} />
            </View>
          ) : null}

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

          {/* Adaptive 2×2 grid — absolute positioning for independent splits */}
          <View style={styles.quadrantGrid} onLayout={(e) => setGridH(e.nativeEvent.layout.height)}>
            {gridH > 0 ? (
              <>
                {/* Top-left: Chores */}
                <View style={[styles.quadrantCard, {
                  position: 'absolute', top: 0, left: 0,
                  width: availW * topSplitFrac - Q_GAP / 2,
                  height: layoutCalc.leftTopH || gridH * 0.6,
                }]}>
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
                  <ScrollView style={styles.quadrantScroll} showsVerticalScrollIndicator={false}>
                    {choresLoading ? (
                      <Text style={styles.qEmptyText}>Loading...</Text>
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

                {/* Top-right: Tasks */}
                <View style={[styles.quadrantCard, {
                  position: 'absolute', top: 0,
                  left: availW * topSplitFrac + Q_GAP / 2,
                  width: availW * (1 - topSplitFrac) - Q_GAP / 2,
                  height: layoutCalc.rightTopH || gridH * 0.6,
                }]}>
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
                  <ScrollView style={styles.quadrantScroll} showsVerticalScrollIndicator={false}>
                    {taskSeriesLoading ? (
                      <Text style={styles.qEmptyText}>Loading...</Text>
                    ) : taskSeriesCards.length === 0 ? (
                      <Text style={styles.qEmptyText}>No tasks today</Text>
                    ) : (
                      taskSeriesCards.map((card, cardIndex) => {
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

                {/* Bottom-left: Messages */}
                <View style={[styles.quadrantCard, {
                  position: 'absolute',
                  top: (layoutCalc.leftTopH || gridH * 0.6) + Q_GAP,
                  left: 0,
                  width: availW * bottomSplitFrac - Q_GAP / 2,
                  height: layoutCalc.leftBottomH || gridH * 0.4 - Q_GAP,
                }]}>
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
                  <ScrollView style={styles.quadrantScroll} showsVerticalScrollIndicator={false}>
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

                {/* Bottom-right: Calendar */}
                <View style={[styles.quadrantCard, {
                  position: 'absolute',
                  top: (layoutCalc.rightTopH || gridH * 0.6) + Q_GAP,
                  left: availW * bottomSplitFrac + Q_GAP / 2,
                  width: availW * (1 - bottomSplitFrac) - Q_GAP / 2,
                  height: layoutCalc.rightBottomH || gridH * 0.4 - Q_GAP,
                }]}>
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
                  <ScrollView style={styles.quadrantScroll} showsVerticalScrollIndicator={false}>
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
              </>
            ) : null}
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

    // ── Background face image ──
    // Anchored bottom-right, overflowing off screen edges so the face
    // is cropped at the right edge and bottom. Fades on top + left (interior edges).
    bgFaceWrap: {
      position: 'absolute',
      bottom: -80,
      right: -60,
      width: '90%',
      height: '80%',
      opacity: isDark ? 0.18 : 0.15,
    },
    bgFaceImage: {
      width: '100%',
      height: '100%',
    },
    bgFadeStrip: {
      position: 'absolute',
      backgroundColor: colors.canvasStrong,
    },
    // Top fade (interior top edge): strips from top, decreasing opacity
    bgFadeTop1: { top: 0, left: 0, right: 0, height: 60, opacity: 1 },
    bgFadeTop2: { top: 60, left: 0, right: 0, height: 50, opacity: 0.7 },
    bgFadeTop3: { top: 110, left: 0, right: 0, height: 50, opacity: 0.4 },
    bgFadeTop4: { top: 160, left: 0, right: 0, height: 60, opacity: 0.15 },
    // Left fade (interior left edge): strips from left, decreasing opacity
    bgFadeLeft1: { top: 0, left: 0, bottom: 0, width: 60, opacity: 1 },
    bgFadeLeft2: { top: 0, left: 60, bottom: 0, width: 50, opacity: 0.7 },
    bgFadeLeft3: { top: 0, left: 110, bottom: 0, width: 50, opacity: 0.4 },
    bgFadeLeft4: { top: 0, left: 160, bottom: 0, width: 60, opacity: 0.15 },

    // ── Compact top bar ──
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: 'transparent',
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
      backgroundColor: 'transparent',
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
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },
    quadrantCard: {
      backgroundColor: withAlpha(colors.panel, isDark ? 0.85 : 0.92),
      borderRadius: radii.lg,
      borderWidth: isDark ? 1 : 0,
      borderColor: isDark ? colors.line : 'transparent',
      overflow: 'hidden',
      ...(isDark ? {} : shadows.card),
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
    quadrantScroll: {
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
