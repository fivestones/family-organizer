import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { id, tx } from '@instantdb/react-native';
import { router } from 'expo-router';
import {
  calculateDailyXP,
  formatDateKeyUTC,
  getAssignedMembersForChoreOnDate,
  getCompletedChoreCompletionsForDate,
  getMemberCompletionForDate,
} from '@family-organizer/shared-core';
import { colors, radii, shadows, spacing } from '../../src/theme/tokens';
import { useAppSession } from '../../src/providers/AppProviders';
import { getApiBaseUrl } from '../../src/lib/api-client';
import { getRecursiveTaskCompletionTransactions, getTasksForDate } from '../../../lib/task-scheduler';

const DAY_RANGE = 7;
const MAX_LINKS_PER_TASK = 4;

function firstRef(value) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function memberRef(member) {
  if (!member) return null;
  if (Array.isArray(member)) return member[0] || null;
  return member;
}

function avatarUriForMember(member) {
  const fileName =
    member?.photoUrls?.['320'] ||
    member?.photoUrls?.[320] ||
    member?.photoUrls?.['64'] ||
    member?.photoUrls?.[64];

  if (!fileName) return null;
  return `${getApiBaseUrl()}/uploads/${fileName}`;
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

function formatTopStripDate(date) {
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function buildDateStrip(selectedDate) {
  const base = new Date(selectedDate);
  return Array.from({ length: DAY_RANGE }).map((_, index) => {
    const offset = index - Math.floor(DAY_RANGE / 2);
    const next = new Date(base);
    next.setDate(base.getDate() + offset);
    return next;
  });
}

function formatPossessive(name) {
  if (!name) return 'Dashboard';
  return name.endsWith('s') ? `${name}' dashboard` : `${name}'s dashboard`;
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

function getTaskParentId(task) {
  if (!task?.parentTask) return null;
  if (Array.isArray(task.parentTask)) return task.parentTask[0]?.id || null;
  return task.parentTask.id || null;
}

function hasScheduledChildren(parentId, scheduledIds, allTasks) {
  return allTasks.some((task) => getTaskParentId(task) === parentId && scheduledIds.has(task.id));
}

function buildVisibleTaskNodes(scheduledTasks, allTasks) {
  if (!scheduledTasks?.length) return [];

  const visibleMap = new Map();

  scheduledTasks.forEach((task) => {
    visibleMap.set(task.id, task);
  });

  scheduledTasks.forEach((task) => {
    let current = task;
    let depth = 0;
    let parentId = getTaskParentId(current);

    while (parentId && depth < 10) {
      if (visibleMap.has(parentId)) break;

      const parent = allTasks.find((item) => item.id === parentId);
      if (!parent) break;

      visibleMap.set(parent.id, parent);
      current = parent;
      parentId = getTaskParentId(current);
      depth += 1;
    }
  });

  return Array.from(visibleMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
}

function buildTaskLinks(task) {
  const links = [];
  const seen = new Set();
  const urlPattern = /\b((?:https?:\/\/|[a-z][a-z0-9+.-]*:\/\/)[^\s<>"')]+)/gi;

  function pushLink(label, url, kind = 'link') {
    if (!url || seen.has(url) || links.length >= MAX_LINKS_PER_TASK) return;
    seen.add(url);
    links.push({ key: `${kind}:${url}`, label, url, kind });
  }

  [task?.text, task?.notes].forEach((value) => {
    if (!value) return;
    const matches = String(value).match(urlPattern) || [];
    matches.forEach((match, index) => {
      pushLink(index === 0 ? 'Open link' : `Open link ${index + 1}`, match, 'external');
    });
  });

  (task?.attachments || []).forEach((attachment) => {
    if (!attachment?.url) return;
    const key = String(attachment.url);
    const url = /^https?:\/\//i.test(key)
      ? key
      : `${getApiBaseUrl()}/api/mobile/files/${encodeURIComponent(key)}`;
    pushLink(attachment.name || 'Open attachment', url, 'attachment');
  });

  return links;
}

async function openTaskLink(link) {
  try {
    await Linking.openURL(link.url);
  } catch (error) {
    Alert.alert('Unable to open link', error?.message || 'Please try again.');
  }
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

function SectionCard({ title, meta, children }) {
  return (
    <View style={styles.sectionCard}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
      </View>
      {children}
    </View>
  );
}

export default function DashboardTab() {
  const { db, currentUser, familyMembers, isAuthenticated, instantReady, lock } = useAppSession();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [viewedMemberId, setViewedMemberId] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
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
              },
              familyMember: {},
              scheduledActivity: {},
            },
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

      const totalBalances = envelopes.reduce((accumulator, envelope) => {
        return addBalancesInto(accumulator, envelope.balancesNormalized);
      }, {});

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
          completionsOnDate,
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
          series.startDate || null
        );

        if (!scheduledTasks.length) continue;

        cards.push({
          id: series.id,
          series,
          chore,
          allTasks,
          scheduledTasks,
          visibleNodes: buildVisibleTaskNodes(scheduledTasks, allTasks),
          incompleteCount: scheduledTasks.filter((task) => !task.isCompleted && !task.isDayBreak).length,
        });
      }
    }

    return cards.sort((left, right) => {
      const choreCompare = (left.chore?.title || '').localeCompare(right.chore?.title || '');
      if (choreCompare !== 0) return choreCompare;
      return (left.series?.name || '').localeCompare(right.series?.name || '');
    });
  }, [chores, selectedDate, viewedMember?.id]);

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

  async function handleToggleTask(taskId, currentStatus, allTasks) {
    try {
      const transactions = getRecursiveTaskCompletionTransactions(taskId, !currentStatus, allTasks, selectedDateKey);
      if (transactions.length === 0) return;
      await db.transact(transactions);
    } catch (error) {
      Alert.alert('Unable to update task', error?.message || 'Please try again.');
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

  const topStripAction = currentUser ? (
    <Pressable
      testID="dashboard-open-user-menu"
      accessibilityRole="button"
      accessibilityLabel={`Open dashboard menu for ${currentUser.name}`}
      onPress={() => setMenuVisible(true)}
      style={styles.topStripAvatarButton}
      hitSlop={10}
    >
      {avatarUriForMember(currentUser) ? (
        <Image source={{ uri: avatarUriForMember(currentUser) }} style={styles.topStripAvatarImage} />
      ) : (
        <View style={styles.topStripAvatarFallback}>
          <Text style={styles.topStripAvatarFallbackText}>{createInitials(currentUser.name)}</Text>
        </View>
      )}
    </Pressable>
  ) : null;

  return (
    <>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.root}>
          <View style={styles.topStrip}>
            <Text style={styles.topStripText} numberOfLines={1}>
              {formatTopStripDate(selectedDate)} - {viewedXp.current}/{viewedXp.possible} XP
            </Text>
            {topStripAction}
          </View>

          <View style={styles.heroBlock}>
            <View style={styles.heroRow}>
              <View style={styles.heroIdentity}>
                {avatarUriForMember(viewedMember) ? (
                  <Image source={{ uri: avatarUriForMember(viewedMember) }} style={styles.heroAvatarImage} />
                ) : (
                  <View style={styles.heroAvatarFallback}>
                    <Text style={styles.heroAvatarFallbackText}>{createInitials(viewedMember?.name)}</Text>
                  </View>
                )}
                <View style={styles.heroCopy}>
                  <Text style={styles.heroTitle}>{formatPossessive(viewedMember?.name)}</Text>
                </View>
              </View>
              <Pressable
                testID="dashboard-toggle-date-picker"
                accessibilityRole="button"
                accessibilityLabel={`Choose dashboard date. Currently ${formatLongDate(selectedDate)}`}
                onPress={() => setDatePickerVisible((previous) => !previous)}
                style={[styles.dateMiniCard, datePickerVisible && styles.dateMiniCardActive]}
              >
                <Text style={styles.dateMiniWeekday}>{formatDayLabel(selectedDate)}</Text>
                <Text style={styles.dateMiniLabel}>{formatMonthDay(selectedDate)}</Text>
              </Pressable>
            </View>

            {datePickerVisible ? (
              <View style={styles.dateChooser}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateStrip}>
                  {dateStrip.map((date) => {
                    const isSelected = formatDateKeyUTC(date) === selectedDateKey;
                    return (
                      <Pressable
                        key={date.toISOString()}
                        testID={`dashboard-date-chip-${formatDateKeyUTC(date)}`}
                        accessibilityRole="button"
                        accessibilityLabel={`View dashboard for ${formatLongDate(date)}`}
                        style={[styles.dateChip, isSelected && styles.dateChipSelected]}
                        onPress={() => {
                          setSelectedDate(date);
                          setDatePickerVisible(false);
                        }}
                      >
                        <Text style={[styles.dateChipDay, isSelected && styles.dateChipTextSelected]}>
                          {formatDayLabel(date)}
                        </Text>
                        <Text style={[styles.dateChipDate, isSelected && styles.dateChipTextSelected]}>
                          {formatMonthDay(date)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}
          </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <SectionCard
            title="Task Series"
            meta={
              taskSeriesCards.length > 0
                ? `${taskSeriesCards.length} list${taskSeriesCards.length === 1 ? '' : 's'} with items today`
                : 'No items scheduled today'
            }
          >
            {dashboardQuery.isLoading ? (
              <Text style={styles.emptyText}>Loading today’s task-series items…</Text>
            ) : taskSeriesCards.length === 0 ? (
              <Text style={styles.emptyText}>
                No Task Series items are scheduled for {viewedMember?.name || 'this member'} on {formatMonthDay(selectedDate)}.
              </Text>
            ) : (
              <View style={styles.taskSeriesList}>
                {taskSeriesCards.map((card) => {
                  const scheduledIds = new Set(card.scheduledTasks.map((item) => item.id));

                  return (
                    <View key={card.id} style={styles.taskSeriesCard}>
                      <View style={styles.taskSeriesHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.taskSeriesName}>{card.series.name || 'Untitled series'}</Text>
                          <Text style={styles.taskSeriesMeta}>
                            {card.chore?.title ? `From ${card.chore.title}` : 'Task series'}
                            {card.incompleteCount > 0 ? ` • ${card.incompleteCount} left` : ' • All caught up'}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.taskItemList}>
                        {card.visibleNodes.map((task) => {
                          const isHeader =
                            hasScheduledChildren(task.id, scheduledIds, card.allTasks) || !scheduledIds.has(task.id);
                          const links = buildTaskLinks(task);
                          const indent = (task.indentationLevel || 0) * 14;

                          return (
                            <View
                              key={`task-${card.id}-${task.id}`}
                              style={[styles.taskRow, isHeader && styles.taskRowHeader, { marginLeft: indent }]}
                            >
                              {isHeader ? (
                                <Text style={styles.taskHeaderText}>{task.text}</Text>
                              ) : (
                                <>
                                  <Pressable
                                    testID={`dashboard-task-toggle-${task.id}`}
                                    accessibilityRole="button"
                                    accessibilityLabel={`${task.isCompleted ? 'Mark task not done' : 'Mark task done'} ${task.text}`}
                                    onPress={() => {
                                      void handleToggleTask(task.id, !!task.isCompleted, card.allTasks);
                                    }}
                                    style={[styles.taskToggle, task.isCompleted && styles.taskToggleDone]}
                                  >
                                    <Text style={[styles.taskToggleText, task.isCompleted && styles.taskToggleTextDone]}>
                                      {task.isCompleted ? 'Done' : 'Mark'}
                                    </Text>
                                  </Pressable>
                                  <View style={styles.taskCopy}>
                                    <Text style={[styles.taskText, task.isCompleted && styles.taskTextDone]}>{task.text}</Text>
                                    {task.notes ? <Text style={styles.taskNotes}>{task.notes}</Text> : null}
                                    {links.length > 0 ? (
                                      <View style={styles.taskLinksRow}>
                                        {links.map((link) => (
                                          <Pressable
                                            key={link.key}
                                            accessibilityRole="button"
                                            accessibilityLabel={link.label}
                                            onPress={() => {
                                              void openTaskLink(link);
                                            }}
                                            style={styles.taskLinkChip}
                                          >
                                            <Text style={styles.taskLinkText}>{link.label}</Text>
                                          </Pressable>
                                        ))}
                                      </View>
                                    ) : null}
                                  </View>
                                </>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </SectionCard>

          <SectionCard
            title="Chores"
            meta={
              choreRows.length > 0
                ? `${incompleteChores.length} left • ${completedChores.length} finished`
                : 'No chores due for this day'
            }
          >
            {dashboardQuery.isLoading ? (
              <Text style={styles.emptyText}>Loading today’s chores…</Text>
            ) : choreRows.length === 0 ? (
              <Text style={styles.emptyText}>
                No chores are due for {viewedMember?.name || 'this member'} on {formatMonthDay(selectedDate)}.
              </Text>
            ) : (
              <View style={styles.choreList}>
                {incompleteChores.map((row) => {
                  const pendingKey = completionKey(row.chore.id, viewedMember.id, selectedDateKey);
                  const isBusy = pendingCompletionKeys.has(pendingKey);
                  const blockedByUpForGrabs =
                    !!row.chore.isUpForGrabs &&
                    !!row.upForGrabsCompletedById &&
                    row.upForGrabsCompletedById !== viewedMember.id &&
                    !row.isDone;

                  return (
                    <View key={`dashboard-chore-${row.chore.id}`} style={styles.choreCard}>
                      <View style={styles.choreHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.choreTitle}>{row.chore.title || 'Untitled chore'}</Text>
                          {row.chore.description ? <Text style={styles.choreDescription}>{row.chore.description}</Text> : null}
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

                      <View style={styles.choreTagRow}>
                        {row.chore.isUpForGrabs ? (
                          <View style={[styles.tag, styles.tagWarm]}>
                            <Text style={[styles.tagText, styles.tagWarmText]}>Up for grabs</Text>
                          </View>
                        ) : null}
                        {row.chore.isJoint ? (
                          <View style={[styles.tag, styles.tagNeutral]}>
                            <Text style={[styles.tagText, styles.tagNeutralText]}>Joint</Text>
                          </View>
                        ) : null}
                        {Number.isFinite(Number(row.chore.weight)) && row.chore.rewardType !== 'fixed' ? (
                          <View style={[styles.tag, styles.tagXp]}>
                            <Text style={[styles.tagText, styles.tagXpText]}>
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
                  );
                })}

                {completedChores.length > 0 ? (
                  <View style={styles.completedSection}>
                    <Text style={styles.completedTitle}>Finished</Text>
                    {completedChores.map((row) => {
                      const pendingKey = completionKey(row.chore.id, viewedMember.id, selectedDateKey);
                      const isBusy = pendingCompletionKeys.has(pendingKey);
                      return (
                        <View key={`dashboard-completed-${row.chore.id}`} style={[styles.choreCard, styles.choreCardDone]}>
                          <View style={styles.choreHeader}>
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.choreTitle, styles.choreTitleDone]}>{row.chore.title || 'Untitled chore'}</Text>
                              {row.chore.description ? (
                                <Text style={[styles.choreDescription, styles.choreDescriptionDone]}>{row.chore.description}</Text>
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
          </SectionCard>

          <Pressable
            testID="dashboard-open-finance"
            accessibilityRole="button"
            accessibilityLabel={`Open finance for ${viewedMember?.name || 'selected member'}`}
            onPress={openFinanceForViewedMember}
            style={styles.financeFooter}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.financeEyebrow}>Currency Totals</Text>
              <Text style={styles.financeTitle}>{viewedMember?.name || 'Selected member'}</Text>
              <Text style={styles.financeBalances}>{formatBalancesInline(viewedFinanceMember?.totalBalances || {}, unitMap)}</Text>
            </View>
            <Text style={styles.financeArrow}>Open Finance ›</Text>
          </Pressable>
        </ScrollView>
        </View>
      </SafeAreaView>

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
          <View style={styles.menuSheet}>
            <View style={styles.menuHeader}>
              <View style={styles.menuIdentity}>
                {avatarUriForMember(currentUser) ? (
                  <Image source={{ uri: avatarUriForMember(currentUser) }} style={styles.menuAvatarImage} />
                ) : (
                  <View style={styles.menuAvatarFallback}>
                    <Text style={styles.menuAvatarFallbackText}>{createInitials(currentUser?.name)}</Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuTitle}>{currentUser?.name || 'Current member'}</Text>
                  <Text style={styles.menuSubtitle}>Signed in on this shared device</Text>
                </View>
              </View>
            </View>

            <Text style={styles.menuSectionTitle}>View dashboard</Text>
            <View style={styles.menuMemberList}>
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
                    <Text style={[styles.menuMemberName, selected && styles.menuMemberNameSelected]}>{member.name}</Text>
                    <Text style={[styles.menuMemberMeta, selected && styles.menuMemberMetaSelected]}>
                      {selected ? 'Currently viewing' : member.role || 'member'}
                    </Text>
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topStrip: {
    minHeight: 32,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: '#F7EBDD',
    borderBottomWidth: 1,
    borderBottomColor: '#E2D4C0',
  },
  topStripText: {
    flex: 1,
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  topStripAvatarButton: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DDBEAE',
    backgroundColor: '#FFF4EE',
  },
  topStripAvatarImage: {
    width: '100%',
    height: '100%',
  },
  topStripAvatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2DDD2',
  },
  topStripAvatarFallbackText: {
    color: colors.accentDashboard,
    fontWeight: '800',
    fontSize: 11,
  },
  heroBlock: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heroIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroAvatarImage: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#E5CBBF',
  },
  heroAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F2DDD2',
    borderWidth: 1,
    borderColor: '#E5CBBF',
  },
  heroAvatarFallbackText: {
    color: colors.accentDashboard,
    fontWeight: '800',
    fontSize: 14,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
  },
  heroTitle: {
    color: colors.ink,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  dateChooser: {
    gap: spacing.sm,
  },
  dateStrip: {
    gap: spacing.sm,
    paddingVertical: 2,
  },
  dateMiniCard: {
    width: 88,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: '#DFC8B5',
    backgroundColor: '#FFF9F2',
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  dateMiniCardActive: {
    borderColor: colors.accentDashboard,
    backgroundColor: '#FFF3E8',
  },
  dateMiniWeekday: {
    color: colors.accentDashboard,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  dateMiniLabel: {
    color: colors.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  dateChip: {
    minWidth: 84,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#E2C7B8',
    backgroundColor: '#FFFCF8',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  dateChipSelected: {
    backgroundColor: colors.accentDashboard,
    borderColor: colors.accentDashboard,
  },
  dateChipDay: {
    color: colors.inkMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  dateChipDate: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  dateChipTextSelected: {
    color: '#FFF8F1',
  },
  sectionCard: {
    backgroundColor: colors.panelElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  sectionMeta: {
    color: colors.inkMuted,
    fontSize: 12,
    textAlign: 'right',
  },
  emptyText: {
    color: colors.inkMuted,
    lineHeight: 19,
  },
  taskSeriesList: {
    gap: spacing.sm,
  },
  taskSeriesCard: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFEFA',
    padding: spacing.md,
    gap: spacing.sm,
  },
  taskSeriesHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  taskSeriesName: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  taskSeriesMeta: {
    color: colors.inkMuted,
    marginTop: 4,
    lineHeight: 17,
  },
  taskItemList: {
    gap: spacing.xs,
  },
  taskRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  taskRowHeader: {
    paddingTop: 10,
    paddingBottom: 2,
  },
  taskHeaderText: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  taskToggle: {
    minWidth: 58,
    minHeight: 34,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#CFC2AE',
    backgroundColor: '#FFF8F0',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginTop: 1,
  },
  taskToggleDone: {
    backgroundColor: '#E8F4E9',
    borderColor: '#BFD8C0',
  },
  taskToggleText: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 12,
  },
  taskToggleTextDone: {
    color: colors.success,
  },
  taskCopy: {
    flex: 1,
    gap: 4,
  },
  taskText: {
    color: colors.ink,
    lineHeight: 19,
    fontWeight: '600',
  },
  taskTextDone: {
    color: colors.inkMuted,
    textDecorationLine: 'line-through',
  },
  taskNotes: {
    color: colors.inkMuted,
    lineHeight: 18,
    fontSize: 13,
  },
  taskLinksRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingTop: 2,
  },
  taskLinkChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#C7D9E9',
    backgroundColor: '#EFF7FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  taskLinkText: {
    color: '#2A5C87',
    fontWeight: '700',
    fontSize: 12,
  },
  choreList: {
    gap: spacing.sm,
  },
  choreCard: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#DFD2C0',
    backgroundColor: '#FFFEFA',
    padding: spacing.md,
    gap: spacing.sm,
  },
  choreCardDone: {
    backgroundColor: '#F7F2EA',
  },
  choreHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  choreTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '800',
  },
  choreTitleDone: {
    color: colors.inkMuted,
    textDecorationLine: 'line-through',
  },
  choreDescription: {
    color: colors.inkMuted,
    lineHeight: 18,
    marginTop: 4,
  },
  choreDescriptionDone: {
    color: '#8A7E70',
  },
  choreToggleButton: {
    minWidth: 74,
    minHeight: 40,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#D7B3A3',
    backgroundColor: '#FFF3EC',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  choreToggleButtonDone: {
    backgroundColor: '#E8F4E9',
    borderColor: '#BFD8C0',
  },
  choreToggleButtonLocked: {
    backgroundColor: '#F2ECE2',
    borderColor: '#D8CCBB',
  },
  choreToggleButtonText: {
    color: colors.accentDashboard,
    fontWeight: '800',
  },
  choreToggleButtonTextDone: {
    color: colors.success,
  },
  choreToggleButtonTextLocked: {
    color: colors.inkMuted,
  },
  choreTagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tag: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  tagWarm: {
    backgroundColor: '#FFF2DF',
    borderColor: '#E6C79B',
  },
  tagWarmText: {
    color: colors.warning,
  },
  tagNeutral: {
    backgroundColor: '#F2ECE0',
    borderColor: colors.line,
  },
  tagNeutralText: {
    color: colors.inkMuted,
  },
  tagXp: {
    backgroundColor: '#FBEADF',
    borderColor: '#E9C3AD',
  },
  tagXpText: {
    color: colors.accentDashboard,
  },
  helperText: {
    color: colors.inkMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  completedSection: {
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  completedTitle: {
    color: colors.inkMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  financeFooter: {
    backgroundColor: '#EDF6EC',
    borderWidth: 1,
    borderColor: '#C9DEC4',
    borderRadius: radii.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.card,
  },
  financeEyebrow: {
    color: colors.accentFinance,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '800',
  },
  financeTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '800',
    marginTop: 4,
  },
  financeBalances: {
    color: colors.accentFinance,
    fontWeight: '700',
    marginTop: 6,
    lineHeight: 18,
  },
  financeArrow: {
    color: colors.accentFinance,
    fontWeight: '800',
  },
  menuOverlay: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(29, 26, 20, 0.28)',
  },
  menuSheet: {
    marginTop: 92,
    marginHorizontal: spacing.lg,
    backgroundColor: '#FFFDF7',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  menuHeader: {
    borderBottomWidth: 1,
    borderBottomColor: '#EEE4D5',
    paddingBottom: spacing.sm,
  },
  menuIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  menuAvatarImage: {
    width: 46,
    height: 46,
    borderRadius: radii.pill,
  },
  menuAvatarFallback: {
    width: 46,
    height: 46,
    borderRadius: radii.pill,
    backgroundColor: '#F2DDD2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuAvatarFallbackText: {
    color: colors.accentDashboard,
    fontWeight: '800',
    fontSize: 16,
  },
  menuTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '800',
  },
  menuSubtitle: {
    color: colors.inkMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  menuSectionTitle: {
    color: colors.inkMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  menuMemberList: {
    gap: spacing.xs,
  },
  menuMemberRow: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: '#E5DACA',
    backgroundColor: '#FFF',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  menuMemberRowSelected: {
    borderColor: '#D8BBAA',
    backgroundColor: '#FFF5EF',
  },
  menuMemberName: {
    color: colors.ink,
    fontWeight: '700',
  },
  menuMemberNameSelected: {
    color: colors.accentDashboard,
  },
  menuMemberMeta: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  menuMemberMetaSelected: {
    color: colors.accentDashboard,
    fontWeight: '700',
  },
  menuFooter: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  menuSecondaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#fff',
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
    flex: 1,
    minHeight: 42,
    borderRadius: radii.pill,
    backgroundColor: colors.accentDashboard,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  menuPrimaryButtonText: {
    color: '#FFF9F1',
    fontWeight: '800',
  },
});
