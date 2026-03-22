import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { id, tx } from '@instantdb/react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import {
  HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
  calculateDailyXP,
  formatDateKeyUTC,
  getFamilyDayDateUTC,
  getAssignedMembersForChoreOnDate,
  getCompletedChoreCompletionsForDate,
  getMemberCompletionForDate,
  parseSharedScheduleSettings,
  sortChoresForDisplay,
} from '@family-organizer/shared-core';
import { AvatarPhotoImage } from '../../src/components/AvatarPhotoImage';
import { radii, shadows, spacing, withAlpha } from '../../src/theme/tokens';
import { useAppSession } from '../../src/providers/AppProviders';
import { useAppTheme } from '../../src/theme/ThemeProvider';

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

function formatWeekdayDate(date) {
  const weekday = date.toLocaleDateString(undefined, { weekday: 'long' });
  const monthDay = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${weekday}, ${monthDay}`;
}

function formatPossessive(name) {
  if (!name) return 'Chores';
  return name.endsWith('s') ? `${name}' chores` : `${name}'s chores`;
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

export default function ChoresTab() {
  const { colors, themeName } = useAppTheme();
  const isDark = themeName === 'dark';
  const styles = useMemo(() => createStyles(colors, isDark), [colors, isDark]);
  const {
    db,
    currentUser,
    familyMembers,
    isAuthenticated,
    instantReady,
    principalType,
  } = useAppSession();
  const currentUserIdRef = useRef('');
  const [selectedDate, setSelectedDate] = useState(() => getFamilyDayDateUTC(new Date()));
  const [viewedMemberId, setViewedMemberId] = useState('');
  const [memberDropdownVisible, setMemberDropdownVisible] = useState(false);
  const [dateDropdownVisible, setDateDropdownVisible] = useState(false);
  const [viewSettingsVisible, setViewSettingsVisible] = useState(false);
  const [pendingCompletionKeys, setPendingCompletionKeys] = useState(() => new Set());
  const [isMarkingVisibleDone, setIsMarkingVisibleDone] = useState(false);

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
      if (previous && familyMembers.some((member) => member.id === previous)) {
        return previous;
      }
      return currentUser.id;
    });
  }, [currentUser?.id, familyMembers]);

  const selectedDateKey = useMemo(() => formatDateKeyUTC(selectedDate), [selectedDate]);

  const dateStrip = useMemo(() => {
    return Array.from({ length: 7 }).map((_, index) => {
      const offset = index - 3;
      const d = new Date(selectedDate.getTime() + offset * 86400000);
      return d;
    });
  }, [selectedDate]);

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

  const chores = useMemo(() => choresQuery.data?.chores || [], [choresQuery.data?.chores]);
  const routineMarkerStatuses = useMemo(
    () => choresQuery.data?.routineMarkerStatuses || [],
    [choresQuery.data?.routineMarkerStatuses]
  );
  const scheduleSettings = useMemo(
    () => parseSharedScheduleSettings(choresQuery.data?.settings?.[0]?.value || null),
    [choresQuery.data?.settings]
  );

  const familyMemberNameById = useMemo(
    () =>
      familyMembers.reduce((acc, member) => {
        acc[member.id] = member.name;
        return acc;
      }, {}),
    [familyMembers]
  );

  const viewedMember = useMemo(
    () => familyMembers.find((member) => member.id === viewedMemberId) || currentUser || familyMembers[0] || null,
    [currentUser, familyMembers, viewedMemberId]
  );

  const dailyXpByMember = useMemo(() => calculateDailyXP(chores, familyMembers, selectedDate), [chores, familyMembers, selectedDate]);
  const viewedXp = dailyXpByMember[viewedMember?.id] || { current: 0, possible: 0 };

  const visibleChores = useMemo(() => {
    const visibleRows = chores
      .map((chore) => {
        if (!viewedMember?.id) return null;

        const assignedMembers = getAssignedMembersForChoreOnDate(chore, selectedDate);
        if (assignedMembers.length === 0) return null;
        if (!assignedMembers.some((member) => member.id === viewedMember.id)) return null;

        const completionsOnDate = getCompletedChoreCompletionsForDate(chore, selectedDate);
        const firstCompletedByOther = completionsOnDate.find((completion) => completionMemberId(completion));
        const completedById = completionMemberId(firstCompletedByOther);
        const toggleMembers = assignedMembers.filter((member) => member.id === viewedMember.id);

        return {
          chore,
          assignedMembers,
          toggleMembers: toggleMembers.length > 0 ? toggleMembers : assignedMembers,
          completionsOnDate,
          upForGrabsCompletedById: completedById,
        };
      })
      .filter(Boolean);

    const sortedRows = sortChoresForDisplay(
      visibleRows.map((row) => row.chore),
      {
        date: selectedDate,
        routineMarkerStatuses,
        chores,
        scheduleSettings,
      }
    );

    const timingById = new Map(sortedRows.map((entry) => [entry.chore.id, entry.timing]));

    return visibleRows
      .slice()
      .sort((left, right) => {
        const leftIndex = sortedRows.findIndex((entry) => entry.chore.id === left.chore.id);
        const rightIndex = sortedRows.findIndex((entry) => entry.chore.id === right.chore.id);
        return leftIndex - rightIndex;
      })
      .map((row) => ({
        ...row,
        timing: timingById.get(row.chore.id) || null,
      }));
  }, [chores, routineMarkerStatuses, scheduleSettings, selectedDate, viewedMember?.id]);

  const viewedMemberName = viewedMember?.name || 'Family member';
  const headerTitle = formatPossessive(viewedMemberName);
  const remainingChoreCount = useMemo(() => {
    if (!viewedMember?.id) return 0;

    return visibleChores.reduce((count, row) => {
      const completion = getMemberCompletionForDate(row.chore, viewedMember.id, selectedDate);
      const blockedByUpForGrabs =
        !!row.chore?.isUpForGrabs &&
        !!row.upForGrabsCompletedById &&
        row.upForGrabsCompletedById !== viewedMember.id &&
        !completion?.completed;

      return completion?.completed || blockedByUpForGrabs ? count : count + 1;
    }, 0);
  }, [selectedDate, viewedMember?.id, visibleChores]);
  const completedChoreCount = Math.max(0, visibleChores.length - remainingChoreCount);
  const summaryLine = useMemo(() => {
    if (!viewedMember?.id) return `Choose a family member to view chores for ${formatMonthDay(selectedDate)}.`;
    if (visibleChores.length === 0) return `No chores due for ${formatMonthDay(selectedDate)}.`;
    return `${remainingChoreCount} left · ${completedChoreCount} done · ${visibleChores.length} scheduled`;
  }, [completedChoreCount, remainingChoreCount, selectedDate, viewedMember?.id, visibleChores.length]);

  const todayDateKey = formatDateKeyUTC(getFamilyDayDateUTC(new Date(), scheduleSettings));

  const defaultViewSetting = true;
  const showChoreDescriptions = currentUser?.viewShowChoreDescriptions ?? defaultViewSetting;
  const showTaskDetails = currentUser?.viewShowTaskDetails ?? defaultViewSetting;

  async function toggleViewSetting(setting, value) {
    if (!currentUser?.id) {
      Alert.alert('Login required', 'Choose a family member before changing view options.');
      return;
    }

    try {
      await db.transact([tx.familyMembers[currentUser.id].update({ [setting]: value })]);
    } catch (error) {
      Alert.alert('Unable to save view setting', error?.message || 'Please try again.');
    }
  }

  async function handleToggleCompletion(chore, familyMemberId) {
    if (!currentUser?.id) {
      Alert.alert('Login required', 'Choose a family member before marking chores complete.');
      return;
    }

    const pendingKey = completionKey(chore.id, familyMemberId, selectedDateKey);
    setPendingCompletionKeys((prev) => new Set(prev).add(pendingKey));

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
      setPendingCompletionKeys((prev) => {
        const next = new Set(prev);
        next.delete(pendingKey);
        return next;
      });
    }
  }

  function getMarkVisibleDoneTargets() {
    const targets = [];

    for (const item of visibleChores) {
      const { chore, toggleMembers, upForGrabsCompletedById } = item;
      let claimedUpForGrabs = Boolean(chore.isUpForGrabs && upForGrabsCompletedById);

      for (const member of toggleMembers) {
        const completion = getMemberCompletionForDate(chore, member.id, selectedDate);
        const pendingKey = completionKey(chore.id, member.id, selectedDateKey);
        const isBusy = pendingCompletionKeys.has(pendingKey);
        const isDone = !!completion?.completed;
        const blockedByUpForGrabs = Boolean(chore.isUpForGrabs && claimedUpForGrabs && !isDone);

        if (isDone || isBusy || blockedByUpForGrabs) continue;

        targets.push({ chore, memberId: member.id });
        if (chore.isUpForGrabs) {
          claimedUpForGrabs = true;
          break;
        }
      }
    }

    return targets;
  }

  function handleMarkVisibleDonePress() {
    if (isMarkingVisibleDone) return;

    const targets = getMarkVisibleDoneTargets();
    if (targets.length === 0) {
      Alert.alert('Nothing to mark', 'All visible chores are already done or currently updating.');
      return;
    }

    Alert.alert(
      'Mark visible chores done?',
      `This will mark ${targets.length} visible chore${targets.length === 1 ? '' : 's'} complete for ${formatMonthDay(selectedDate)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Mark Done',
          onPress: () => {
            void (async () => {
              setIsMarkingVisibleDone(true);
              try {
                for (const target of targets) {
                  await handleToggleCompletion(target.chore, target.memberId);
                }
              } finally {
                setIsMarkingVisibleDone(false);
              }
            })();
          },
        },
      ]
    );
  }

  function openTaskSeriesOverview() {
    const memberId = viewedMember?.id;
    if (!memberId) {
      Alert.alert('Login required', 'Choose a family member before opening task series.');
      return;
    }

    router.push({
      pathname: '/task-series/my',
      params: { memberId },
    });
  }

  function openTaskSeriesManager() {
    router.push('/more/task-series');
  }

  return (
    <>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.root}>
          <View style={styles.topBar}>
            <Pressable
              testID="chores-member-switcher"
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
                <Ionicons name="sparkles" size={14} color={colors.warning} />
                <Text style={styles.statValue}>
                  {viewedXp.current}/{viewedXp.possible}
                </Text>
                <Text style={styles.statLabel}>XP</Text>
              </View>

              <View style={styles.statPill}>
                <Ionicons name="checkmark-circle-outline" size={14} color={colors.accentChores} />
                <Text style={styles.statValue}>{remainingChoreCount}</Text>
                <Text style={styles.statLabel}>Left</Text>
              </View>
            </View>

            <Pressable
              testID="chores-view-settings-button"
              accessibilityRole="button"
              accessibilityLabel="Open chores view settings"
              onPress={() => setViewSettingsVisible(true)}
              style={styles.headerUtilityButton}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.accentChores} />
            </Pressable>

            <Pressable
              testID="chores-date-picker"
              accessibilityRole="button"
              accessibilityLabel={`Selected date: ${formatWeekdayDate(selectedDate)}. Tap to change.`}
              onPress={() => setDateDropdownVisible(true)}
              style={styles.topBarRight}
            >
              <Text style={styles.topBarDate}>{formatWeekdayDate(selectedDate)}</Text>
              <Ionicons name="chevron-down" size={14} color={colors.canvasTextMuted} />
            </Pressable>
          </View>

          <View style={styles.summarySection}>
            <Text style={styles.summaryText}>{summaryLine}</Text>
          </View>

          <View style={styles.contentShell}>
            <View style={styles.contentGlow} />
            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              <View style={styles.panel}>
                <View style={styles.panelHeaderRow}>
                  <Text style={styles.panelTitle}>Task Series</Text>
                  <Text style={styles.metaText}>{viewedMemberName}</Text>
                </View>
                <Text style={styles.metaText}>
                  Open the native task-series view for responses, review threads, pull-forward, and the full mobile task detail flow.
                </Text>
                <View style={[styles.panelHeaderActions, { marginTop: spacing.sm }]}>
                  <Pressable
                    testID="chores-open-task-series-button"
                    accessibilityRole="button"
                    accessibilityLabel="Open task series"
                    onPress={openTaskSeriesOverview}
                    style={styles.markAllButton}
                  >
                    <Text style={styles.markAllButtonText}>Open Task Series</Text>
                  </Pressable>
                  {principalType === 'parent' ? (
                    <Pressable
                      testID="chores-open-task-series-manager-button"
                      accessibilityRole="button"
                      accessibilityLabel="Open task series manager"
                      onPress={openTaskSeriesManager}
                      style={styles.markAllButton}
                    >
                      <Text style={styles.markAllButtonText}>Manager</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>

              <View style={styles.panel}>
                <View style={styles.panelHeaderRow}>
                  <Text style={styles.panelTitle}>Due Chores</Text>
                  <View style={styles.panelHeaderActions}>
                    <Text style={styles.metaText}>
                      {choresQuery.isLoading ? 'Loading…' : `${visibleChores.length} scheduled • ${chores.length} total chores`}
                    </Text>
                    <Pressable
                      testID="chores-mark-visible-done-button"
                      accessibilityRole="button"
                      accessibilityLabel="Mark all visible chores done"
                      onPress={handleMarkVisibleDonePress}
                      disabled={isMarkingVisibleDone || visibleChores.length === 0}
                      style={[
                        styles.markAllButton,
                        (isMarkingVisibleDone || visibleChores.length === 0) && styles.markAllButtonDisabled,
                      ]}
                    >
                      <Text style={styles.markAllButtonText}>
                        {isMarkingVisibleDone ? 'Working…' : 'Mark Visible Done'}
                      </Text>
                    </Pressable>
                  </View>
                </View>

                {choresQuery.error ? (
                  <Text style={styles.errorText}>{choresQuery.error.message || 'Failed to load chores'}</Text>
                ) : visibleChores.length === 0 ? (
                  <Text style={styles.emptyText}>No chores are due for this date.</Text>
                ) : (
                  <View style={styles.cards}>
                    {visibleChores.map(({ chore, toggleMembers, completionsOnDate, upForGrabsCompletedById, timing }, index) => {
                      const previousTiming = index > 0 ? visibleChores[index - 1]?.timing : null;
                      const showSectionHeader = !previousTiming || previousTiming?.sectionKey !== timing?.sectionKey;
                      const upForGrabsCompletedByName =
                        upForGrabsCompletedById ? familyMemberNameById[upForGrabsCompletedById] || 'another member' : null;

                      return (
                        <React.Fragment key={chore.id}>
                          {showSectionHeader ? (
                            <View style={[styles.sectionChip, timing?.isActiveNow && styles.sectionChipActive]}>
                              <Text style={[styles.sectionChipText, timing?.isActiveNow && styles.sectionChipTextActive]}>
                                {timing?.sectionLabel || 'Anytime'}
                                {timing?.isActiveNow ? ' • Now' : ''}
                              </Text>
                            </View>
                          ) : null}
                          <View style={styles.choreCard}>
                            <View style={styles.choreHeaderRow}>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.choreTitle}>{chore.title || 'Untitled chore'}</Text>
                                {!!chore.description && showChoreDescriptions ? (
                                  <Text style={styles.choreDescription}>{chore.description}</Text>
                                ) : null}
                              </View>
                              <View style={styles.tagRow}>
                                {timing?.label ? (
                                  <View style={[styles.tag, styles.tagSky]}>
                                    <Text style={[styles.tagText, styles.tagSkyText]}>{timing.label}</Text>
                                  </View>
                                ) : null}
                                {chore.isUpForGrabs ? (
                                  <View style={[styles.tag, styles.tagWarm]}>
                                    <Text style={[styles.tagText, styles.tagWarmText]}>Up for grabs</Text>
                                  </View>
                                ) : null}
                                {chore.rewardType !== 'fixed' && Number.isFinite(Number(chore.weight)) ? (
                                  <View style={[styles.tag, styles.tagXp]}>
                                    <Text style={[styles.tagText, styles.tagXpText]}>
                                      XP {Number(chore.weight) > 0 ? '+' : ''}
                                      {Number(chore.weight || 0)}
                                    </Text>
                                  </View>
                                ) : null}
                                {chore.rewardType === 'fixed' ? (
                                  <View style={[styles.tag, styles.tagNeutral]}>
                                    <Text style={[styles.tagText, styles.tagNeutralText]}>Fixed reward</Text>
                                  </View>
                                ) : null}
                                {chore.isJoint ? (
                                  <View style={[styles.tag, styles.tagNeutral]}>
                                    <Text style={[styles.tagText, styles.tagNeutralText]}>Joint</Text>
                                  </View>
                                ) : null}
                              </View>
                            </View>

                            {chore.isUpForGrabs && upForGrabsCompletedByName ? (
                              <Text style={styles.helperText}>Completed today by {upForGrabsCompletedByName}</Text>
                            ) : null}

                            <View style={styles.toggleList}>
                              {toggleMembers.map((member) => {
                                const completion = getMemberCompletionForDate(chore, member.id, selectedDate);
                                const isDone = !!completion?.completed;
                                const isBusy = pendingCompletionKeys.has(completionKey(chore.id, member.id, selectedDateKey));
                                const blockedByUpForGrabs =
                                  !!chore.isUpForGrabs &&
                                  !!upForGrabsCompletedById &&
                                  upForGrabsCompletedById !== member.id &&
                                  !isDone;

                                return (
                                  <View key={`${chore.id}:${member.id}`} style={styles.toggleRow}>
                                    <View style={{ flex: 1 }}>
                                      <Text style={styles.toggleMetaSolo}>
                                        {blockedByUpForGrabs
                                          ? 'Already claimed'
                                          : isDone
                                          ? `Done • ${
                                              completion?.dateCompleted
                                                ? new Date(completion.dateCompleted).toLocaleTimeString([], {
                                                    hour: 'numeric',
                                                    minute: '2-digit',
                                                  })
                                                : 'today'
                                            }`
                                          : 'Not done yet'}
                                      </Text>
                                    </View>
                                    <Pressable
                                      testID={`chore-toggle-${chore.id}-${member.id}`}
                                      accessibilityRole="button"
                                      accessibilityLabel={`${
                                        isDone ? 'Mark not done' : 'Mark done'
                                      } for ${viewedMemberName} on ${chore.title || 'chore'}`}
                                      disabled={isBusy || blockedByUpForGrabs}
                                      onPress={() => handleToggleCompletion(chore, member.id)}
                                      style={[
                                        styles.toggleButton,
                                        isDone && styles.toggleButtonDone,
                                        blockedByUpForGrabs && styles.toggleButtonDisabled,
                                        isBusy && styles.toggleButtonBusy,
                                      ]}
                                    >
                                      <Text
                                        style={[
                                          styles.toggleButtonText,
                                          isDone && styles.toggleButtonTextDone,
                                          blockedByUpForGrabs && styles.toggleButtonTextDisabled,
                                        ]}
                                      >
                                        {isBusy ? '…' : isDone ? 'Done' : 'Mark'}
                                      </Text>
                                    </Pressable>
                                  </View>
                                );
                              })}
                            </View>

                            {completionsOnDate.length > 0 ? (
                              <Text style={styles.completionSummary}>
                                {completionsOnDate.length} completion{completionsOnDate.length === 1 ? '' : 's'} recorded today
                              </Text>
                            ) : null}
                          </View>
                        </React.Fragment>
                      );
                    })}
                  </View>
                )}
              </View>
            </ScrollView>
          </View>
        </View>
      </SafeAreaView>

      <Modal visible={memberDropdownVisible} transparent animationType="fade" onRequestClose={() => setMemberDropdownVisible(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setMemberDropdownVisible(false)}>
          <View style={styles.dropdownSheet}>
            <Text style={styles.dropdownHeading}>View someone&apos;s chores</Text>
            {familyMembers.map((member) => {
              const selected = member.id === viewedMember?.id;
              return (
                <Pressable
                  key={`chores-member-pick-${member.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`View ${member.name}'s chores`}
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
                  {selected ? <Ionicons name="checkmark-circle" size={18} color={colors.accentChores} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>

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
                    testID={`chores-date-chip-${dateKey}`}
                    accessibilityRole="button"
                    accessibilityLabel={`View chores for ${formatLongDate(date)}`}
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

      <Modal visible={viewSettingsVisible} transparent animationType="fade" onRequestClose={() => setViewSettingsVisible(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setViewSettingsVisible(false)}>
          <View style={styles.dropdownSheet}>
            <Text style={styles.dropdownHeading}>Chores view settings</Text>
            <Text style={styles.dropdownMetaText}>{currentUser ? 'Saved per signed-in member' : 'Login required'}</Text>
            <View style={styles.viewOptionList}>
              <Pressable
                testID="chores-view-toggle-descriptions"
                accessibilityRole="switch"
                accessibilityState={{ checked: !!showChoreDescriptions, disabled: !currentUser }}
                accessibilityLabel="Toggle chore descriptions"
                disabled={!currentUser}
                onPress={() => toggleViewSetting('viewShowChoreDescriptions', !showChoreDescriptions)}
                style={[
                  styles.viewOptionRow,
                  showChoreDescriptions && styles.viewOptionRowActive,
                  !currentUser && styles.viewOptionRowDisabled,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.viewOptionTitle}>Chore descriptions</Text>
                  <Text style={styles.viewOptionMeta}>
                    {showChoreDescriptions ? 'Showing notes under chore titles' : 'Hide descriptions for a cleaner list'}
                  </Text>
                </View>
                <View style={[styles.togglePill, showChoreDescriptions && styles.togglePillOn]}>
                  <View style={[styles.toggleKnob, showChoreDescriptions && styles.toggleKnobOn]} />
                </View>
              </Pressable>

              <Pressable
                testID="chores-view-toggle-task-details"
                accessibilityRole="switch"
                accessibilityState={{ checked: !!showTaskDetails, disabled: !currentUser }}
                accessibilityLabel="Toggle task details"
                disabled={!currentUser}
                onPress={() => toggleViewSetting('viewShowTaskDetails', !showTaskDetails)}
                style={[
                  styles.viewOptionRow,
                  showTaskDetails && styles.viewOptionRowActive,
                  !currentUser && styles.viewOptionRowDisabled,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.viewOptionTitle}>Task details</Text>
                  <Text style={styles.viewOptionMeta}>Stored now so the next checklist pass can expand inline detail cleanly.</Text>
                </View>
                <View style={[styles.togglePill, showTaskDetails && styles.togglePillOn]}>
                  <View style={[styles.toggleKnob, showTaskDetails && styles.toggleKnobOn]} />
                </View>
              </Pressable>
            </View>
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
  headerUtilityButton: {
    width: 34,
    height: 34,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(colors.accentChores, 0.22),
    backgroundColor: withAlpha(colors.accentChores, 0.1),
  },
  topBarRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.canvasText, 0.06),
    maxWidth: 170,
  },
  topBarDate: {
    color: colors.canvasTextMuted,
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
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
  topStrip: {
    minHeight: 32,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.canvas,
    borderBottomWidth: 1,
    borderBottomColor: colors.canvasLine,
  },
  topStripText: {
    flex: 1,
    color: colors.canvasTextMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
  },
  topStripActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statusIcon: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.canvasText, 0.08),
    borderColor: colors.canvasLine,
  },
  statusIconParent: {
    backgroundColor: withAlpha(colors.accentMore, 0.14),
    borderColor: withAlpha(colors.accentMore, 0.28),
  },
  statusIconKid: {
    backgroundColor: withAlpha(colors.accentChores, 0.14),
    borderColor: withAlpha(colors.accentChores, 0.28),
  },
  statusIconNeutral: {
    backgroundColor: withAlpha(colors.locked, 0.18),
    borderColor: withAlpha(colors.locked, 0.28),
  },
  topStripSwitchButton: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: isDark ? colors.canvasText : withAlpha(colors.accentChores, 0.24),
    backgroundColor: isDark ? colors.canvasText : colors.panelElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBlock: {
    backgroundColor: colors.canvas,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
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
  heroAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.accentChores, 0.18),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentChores, 0.22),
  },
  heroAvatarFallbackText: {
    color: colors.accentChores,
    fontWeight: '800',
    fontSize: 14,
  },
  heroCopy: {
    flex: 1,
    minWidth: 0,
  },
  heroEyebrow: {
    color: colors.canvasTextMuted,
    fontSize: 12,
    lineHeight: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontWeight: '800',
  },
  heroTitle: {
    color: colors.canvasText,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '800',
  },
  heroSub: {
    color: colors.canvasTextMuted,
    marginTop: 2,
    fontSize: 13,
    lineHeight: 18,
  },
  heroMetaXp: {
    color: colors.canvasText,
    fontWeight: '700',
    marginTop: 5,
    fontSize: 12,
    lineHeight: 16,
  },
  contentShell: {
    flex: 1,
    marginTop: -8,
    backgroundColor: colors.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    overflow: 'hidden',
    borderTopWidth: isDark ? 1 : 0,
    borderTopColor: isDark ? colors.line : 'transparent',
  },
  contentGlow: {
    position: 'absolute',
    left: 24,
    right: 24,
    top: 0,
    height: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    backgroundColor: isDark ? withAlpha(colors.accentChores, 0.08) : withAlpha(colors.panel, 0.45),
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scrollContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
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
    borderColor: isDark ? colors.canvasLine : colors.line,
    backgroundColor: withAlpha(colors.canvasText, isDark ? 0.08 : 0),
    ...(isDark ? {} : { backgroundColor: colors.panel }),
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  dateMiniCardActive: {
    borderColor: withAlpha(colors.accentChores, 0.3),
    backgroundColor: withAlpha(colors.accentChores, 0.1),
  },
  dateMiniWeekday: {
    color: colors.accentChores,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  dateMiniLabel: {
    color: isDark ? colors.canvasText : colors.ink,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '800',
  },
  panel: {
    backgroundColor: isDark ? colors.panel : colors.panelElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.sm,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  panelHeaderActions: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  panelTitle: { color: colors.ink, fontWeight: '800', fontSize: 15 },
  xpGrid: { gap: spacing.sm },
  xpCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: isDark ? colors.surfaceMuted : colors.panelElevated,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  xpCardSelected: {
    borderColor: withAlpha(colors.accentChores, 0.26),
    backgroundColor: withAlpha(colors.accentChores, 0.08),
  },
  xpCardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  xpName: { color: colors.ink, fontWeight: '700' },
  xpValue: { color: colors.accentChores, fontWeight: '800', fontSize: 12 },
  xpTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: withAlpha(colors.locked, 0.18),
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: withAlpha(colors.locked, 0.26),
  },
  xpFill: {
    height: '100%',
    backgroundColor: colors.accentChores,
  },
  xpHint: { color: colors.inkMuted, fontSize: 11 },
  chipScroll: { gap: spacing.sm, paddingVertical: 2 },
  dateChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: colors.panel,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 82,
  },
  dateChipSelected: {
    backgroundColor: isDark ? colors.canvasText : colors.accentChores,
    borderColor: isDark ? colors.canvasText : colors.accentChores,
  },
  dateChipDay: { color: colors.inkMuted, fontSize: 11, fontWeight: '700' },
  dateChipDate: { color: colors.ink, marginTop: 2, fontWeight: '700' },
  dateChipTextSelected: { color: isDark ? colors.canvasStrong : colors.onAccent },
  memberChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.pill,
    backgroundColor: isDark ? colors.surfaceMuted : colors.panelElevated,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  memberChipSelected: {
    backgroundColor: isDark ? colors.canvasText : withAlpha(colors.accentChores, 0.1),
    borderColor: isDark ? colors.canvasText : withAlpha(colors.accentChores, 0.24),
  },
  memberChipText: { color: colors.ink, fontWeight: '600' },
  memberChipTextSelected: { color: isDark ? colors.canvasStrong : colors.accentChores },
  viewOptionList: { gap: spacing.sm },
  viewOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: isDark ? colors.surfaceMuted : colors.panelElevated,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  viewOptionRowActive: {
    borderColor: withAlpha(colors.accentChores, 0.24),
    backgroundColor: withAlpha(colors.accentChores, 0.08),
  },
  viewOptionRowDisabled: {
    opacity: 0.6,
  },
  viewOptionTitle: { color: colors.ink, fontWeight: '700' },
  viewOptionMeta: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  togglePill: {
    width: 44,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: withAlpha(colors.locked, 0.28),
    backgroundColor: withAlpha(colors.locked, 0.18),
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  togglePillOn: {
    borderColor: withAlpha(colors.accentChores, 0.24),
    backgroundColor: withAlpha(colors.accentChores, 0.1),
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: isDark ? colors.panel : colors.panelElevated,
    borderWidth: 1,
    borderColor: withAlpha(colors.locked, 0.28),
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
    borderColor: withAlpha(colors.accentChores, 0.26),
    backgroundColor: colors.panelElevated,
  },
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
  dropdownMetaText: {
    color: colors.inkMuted,
    fontSize: 12,
    marginBottom: spacing.sm,
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
    backgroundColor: withAlpha(colors.accentChores, 0.08),
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
    color: colors.accentChores,
  },
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
    backgroundColor: isDark ? colors.canvasText : colors.accentChores,
    borderColor: isDark ? colors.canvasText : colors.accentChores,
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
    backgroundColor: colors.accentChores,
  },
  metaText: { color: colors.inkMuted, fontSize: 12 },
  markAllButton: {
    borderWidth: 1,
    borderColor: isDark ? colors.canvasText : withAlpha(colors.accentChores, 0.24),
    borderRadius: radii.pill,
    backgroundColor: isDark ? colors.canvasText : withAlpha(colors.accentChores, 0.1),
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  markAllButtonDisabled: {
    opacity: 0.55,
  },
  markAllButtonText: {
    color: isDark ? colors.canvasStrong : colors.accentChores,
    fontWeight: '800',
    fontSize: 11,
  },
  emptyText: { color: colors.inkMuted },
  errorText: { color: colors.danger, fontWeight: '600' },
  cards: { gap: spacing.md },
  routinePanel: {
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: isDark ? colors.surfaceMuted : colors.panelElevated,
    padding: spacing.md,
    gap: spacing.sm,
  },
  routinePanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  routinePanelTitle: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 14,
  },
  routinePanelMeta: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  routineGrid: {
    gap: spacing.sm,
  },
  routineCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: isDark ? colors.panel : colors.surfaceMuted,
    padding: spacing.sm,
    gap: 4,
  },
  routineCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  routineCardTitle: {
    color: colors.ink,
    fontWeight: '700',
  },
  routineCardMeta: {
    color: colors.inkMuted,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  routineCardDetail: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  routineCardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  routineActionButton: {
    borderWidth: 1,
    borderColor: withAlpha(colors.accentChores, 0.24),
    borderRadius: radii.pill,
    backgroundColor: withAlpha(colors.accentChores, 0.08),
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  routineActionButtonDisabled: {
    opacity: 0.5,
  },
  routineActionButtonText: {
    color: colors.accentChores,
    fontWeight: '700',
    fontSize: 11,
  },
  routineGhostButton: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: isDark ? colors.surfaceMuted : colors.panel,
  },
  routineGhostButtonText: {
    color: colors.inkMuted,
    fontWeight: '700',
    fontSize: 11,
  },
  sectionChip: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    backgroundColor: isDark ? colors.surfaceMuted : colors.panelElevated,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: spacing.xs,
  },
  sectionChipActive: {
    backgroundColor: withAlpha(colors.success, 0.14),
  },
  sectionChipText: {
    color: colors.inkMuted,
    fontWeight: '800',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionChipTextActive: {
    color: colors.success,
  },
  choreCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: isDark ? colors.surfaceMuted : colors.panel,
    padding: spacing.md,
    gap: spacing.sm,
  },
  choreHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  choreTitle: { color: colors.ink, fontWeight: '800', fontSize: 16 },
  choreDescription: { color: colors.inkMuted, marginTop: 4, lineHeight: 18 },
  tagRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  tag: {
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
  },
  tagText: { fontSize: 11, fontWeight: '700' },
  tagWarm: { backgroundColor: withAlpha(colors.warning, 0.12), borderColor: withAlpha(colors.warning, 0.24) },
  tagWarmText: { color: colors.warning },
  tagSky: { backgroundColor: withAlpha(colors.accentChores, 0.1), borderColor: withAlpha(colors.accentChores, 0.22) },
  tagSkyText: { color: colors.accentChores },
  tagXp: { backgroundColor: withAlpha(colors.accentCalendar, 0.1), borderColor: withAlpha(colors.accentCalendar, 0.24) },
  tagXpText: { color: colors.accentCalendar },
  tagNeutral: { backgroundColor: isDark ? colors.panel : colors.panelElevated, borderColor: colors.line },
  tagNeutralText: { color: colors.inkMuted },
  helperText: { color: colors.inkMuted, fontSize: 12 },
  toggleList: { gap: spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: isDark ? colors.surfaceMuted : colors.panelElevated,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  toggleName: { color: colors.ink, fontWeight: '700' },
  toggleMeta: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  toggleMetaSolo: { color: colors.inkMuted, fontSize: 12 },
  toggleButton: {
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: isDark ? colors.canvasText : withAlpha(colors.accentChores, 0.24),
    backgroundColor: isDark ? colors.canvasText : withAlpha(colors.accentChores, 0.08),
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  toggleButtonDone: {
    borderColor: withAlpha(colors.success, 0.26),
    backgroundColor: withAlpha(colors.success, 0.12),
  },
  toggleButtonDisabled: {
    opacity: 0.55,
    backgroundColor: withAlpha(colors.locked, 0.16),
    borderColor: withAlpha(colors.locked, 0.28),
  },
  toggleButtonBusy: { opacity: 0.7 },
  toggleButtonText: { color: isDark ? colors.canvasStrong : colors.accentChores, fontWeight: '800', fontSize: 12 },
  toggleButtonTextDone: { color: colors.success },
  toggleButtonTextDisabled: { color: colors.inkMuted },
  completionSummary: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  });
