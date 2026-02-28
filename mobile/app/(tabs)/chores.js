import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { id, tx } from '@instantdb/react-native';
import { router } from 'expo-router';
import {
  calculateDailyXP,
  formatDateKeyUTC,
  getAssignedMembersForChoreOnDate,
  getCompletedChoreCompletionsForDate,
  getMemberCompletionForDate,
} from '@family-organizer/shared-core';
import { ScreenScaffold, PlaceholderCard } from '../../src/components/ScreenScaffold';
import { radii, spacing } from '../../src/theme/tokens';
import { useAppSession } from '../../src/providers/AppProviders';
import { useAppTheme } from '../../src/theme/ThemeProvider';

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDayLabel(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short' });
}

function formatMonthDay(date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    db,
    currentUser,
    familyMembers,
    isAuthenticated,
    instantReady,
    isOnline,
    connectionStatus,
    principalType,
    lock,
  } = useAppSession();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [selectedMemberId, setSelectedMemberId] = useState('all');
  const [pendingCompletionKeys, setPendingCompletionKeys] = useState(() => new Set());
  const [isMarkingVisibleDone, setIsMarkingVisibleDone] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    setSelectedMemberId((prev) => (prev === 'all' ? currentUser.id : prev));
  }, [currentUser]);

  const selectedDateKey = useMemo(() => formatDateKeyUTC(selectedDate), [selectedDate]);

  const dateStrip = useMemo(() => {
    const base = new Date(selectedDate);
    return Array.from({ length: 7 }).map((_, index) => {
      const offset = index - 3;
      const next = new Date(base);
      next.setDate(base.getDate() + offset);
      return next;
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
        }
      : null
  );

  const chores = choresQuery.data?.chores || [];

  const familyMemberNameById = useMemo(
    () =>
      familyMembers.reduce((acc, member) => {
        acc[member.id] = member.name;
        return acc;
      }, {}),
    [familyMembers]
  );

  const dailyXpByMember = useMemo(() => calculateDailyXP(chores, familyMembers, selectedDate), [chores, familyMembers, selectedDate]);

  const dailyXpRows = useMemo(
    () =>
      familyMembers.map((member) => {
        const stats = dailyXpByMember[member.id] || { current: 0, possible: 0 };
        const possibleForBar = stats.possible > 0 ? stats.possible : Math.max(stats.current, 0);
        const progressRatio = possibleForBar > 0 ? Math.min(1, Math.max(0, stats.current / possibleForBar)) : 0;
        return {
          member,
          ...stats,
          progressRatio,
        };
      }),
    [dailyXpByMember, familyMembers]
  );

  const visibleChores = useMemo(() => {
    return chores
      .map((chore) => {
        const assignedMembers = getAssignedMembersForChoreOnDate(chore, selectedDate);
        if (assignedMembers.length === 0) return null;

        const choreAssigneeIds = new Set((chore.assignees || []).map((assignee) => assignee?.id).filter(Boolean));
        const assignedMemberIds = new Set(assignedMembers.map((assignee) => assignee.id));

        const matchesFilter =
          selectedMemberId === 'all' || assignedMemberIds.has(selectedMemberId) || choreAssigneeIds.has(selectedMemberId);

        if (!matchesFilter) return null;

        const completionsOnDate = getCompletedChoreCompletionsForDate(chore, selectedDate);
        const firstCompletedByOther = completionsOnDate.find((completion) => completionMemberId(completion));
        const completedById = completionMemberId(firstCompletedByOther);

        const toggleMembers =
          selectedMemberId === 'all'
            ? assignedMembers
            : assignedMembers.filter((member) => member.id === selectedMemberId);

        return {
          chore,
          assignedMembers,
          toggleMembers: toggleMembers.length > 0 ? toggleMembers : assignedMembers,
          completionsOnDate,
          upForGrabsCompletedById: completedById,
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.chore?.title || '').localeCompare(b.chore?.title || ''));
  }, [chores, selectedDate, selectedMemberId]);

  const selectedMemberName =
    selectedMemberId === 'all'
      ? 'All'
      : familyMembers.find((member) => member.id === selectedMemberId)?.name || 'Unknown';

  const selectedXpSummary =
    selectedMemberId === 'all'
      ? dailyXpRows.reduce(
          (acc, row) => ({ current: acc.current + row.current, possible: acc.possible + row.possible }),
          { current: 0, possible: 0 }
        )
      : dailyXpByMember[selectedMemberId] || { current: 0, possible: 0 };

  const defaultViewSetting = selectedMemberId !== 'all';
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

  async function handleSwitchUserPress() {
    try {
      await lock();
      router.replace('/lock?intent=switch-user');
    } catch (error) {
      Alert.alert('Unable to switch user', error?.message || 'Please try again.');
    }
  }

  return (
    <ScreenScaffold
      title="Chores"
      subtitle="Phase 2 is now rendering real due-date chore cards with completion toggles and up-for-grabs guardrails. Task checklist embedding and completion prompts are next."
      accent={colors.accentChores}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        {
          label:
            connectionStatus === 'authenticated'
              ? 'Instant connected'
              : connectionStatus || 'Connecting',
          tone: connectionStatus === 'authenticated' ? 'success' : 'neutral',
        },
        {
          label: principalType === 'parent' ? 'Parent mode' : 'Kid mode',
          tone: principalType === 'parent' ? 'accent' : 'neutral',
        },
      ]}
    >
      <View style={styles.heroCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroEyebrow}>Current member</Text>
          <Text style={styles.heroName}>{currentUser?.name || 'Not selected'}</Text>
          <Text style={styles.heroSub}>
            Viewing {selectedMemberName} on {formatMonthDay(selectedDate)}
          </Text>
          <Text style={styles.heroMetaXp}>
            XP today: {selectedXpSummary.current}
            {selectedXpSummary.possible > 0 ? ` / ${selectedXpSummary.possible}` : ''}
          </Text>
        </View>
        <Pressable
          testID="chores-switch-user-button"
          accessibilityRole="button"
          accessibilityLabel="Switch user"
          style={styles.switchButton}
          hitSlop={10}
          onPress={() => {
            void handleSwitchUserPress();
          }}
        >
          <Text style={styles.switchButtonText}>Switch User</Text>
        </Pressable>
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Date</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
          {dateStrip.map((date) => {
            const isSelected = formatDateKey(date) === formatDateKey(selectedDate);
            return (
              <Pressable
                key={date.toISOString()}
                testID={`chores-date-chip-${formatDateKey(date)}`}
                accessibilityRole="button"
                accessibilityLabel={`Select date ${formatMonthDay(date)}`}
                style={[styles.dateChip, isSelected && styles.dateChipSelected]}
                onPress={() => setSelectedDate(date)}
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

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Family Filter</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll}>
          <Pressable
            testID="chores-member-filter-all"
            accessibilityRole="button"
            accessibilityLabel="Filter chores for all family members"
            style={[styles.memberChip, selectedMemberId === 'all' && styles.memberChipSelected]}
            onPress={() => setSelectedMemberId('all')}
          >
            <Text style={[styles.memberChipText, selectedMemberId === 'all' && styles.memberChipTextSelected]}>
              All
            </Text>
          </Pressable>
          {familyMembers.map((member) => {
            const selected = selectedMemberId === member.id;
            return (
              <Pressable
                key={member.id}
                testID={`chores-member-filter-${member.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Filter chores for ${member.name}`}
                style={[styles.memberChip, selected && styles.memberChipSelected]}
                onPress={() => setSelectedMemberId(member.id)}
              >
                <Text style={[styles.memberChipText, selected && styles.memberChipTextSelected]}>
                  {member.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeaderRow}>
          <Text style={styles.panelTitle}>View Options</Text>
          <Text style={styles.metaText}>{currentUser ? 'Saved per member' : 'Login required'}</Text>
        </View>
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
              <Text style={styles.viewOptionMeta}>
                Stored now; checklist detail rendering will use this in the next Phase 2 slice.
              </Text>
            </View>
            <View style={[styles.togglePill, showTaskDetails && styles.togglePillOn]}>
              <View style={[styles.toggleKnob, showTaskDetails && styles.toggleKnobOn]} />
            </View>
          </Pressable>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeaderRow}>
          <Text style={styles.panelTitle}>Daily XP</Text>
          <Text style={styles.metaText}>{formatMonthDay(selectedDate)}</Text>
        </View>
        <View style={styles.xpGrid}>
          {dailyXpRows.map((row) => {
            const isSelected = selectedMemberId === 'all' ? currentUser?.id === row.member.id : selectedMemberId === row.member.id;
            return (
              <View key={`xp-${row.member.id}`} style={[styles.xpCard, isSelected && styles.xpCardSelected]}>
                <View style={styles.xpCardHeader}>
                  <Text style={styles.xpName}>{row.member.name}</Text>
                  <Text style={styles.xpValue}>
                    {row.current}
                    {row.possible > 0 ? ` / ${row.possible}` : ''}
                  </Text>
                </View>
                <View style={styles.xpTrack}>
                  <View style={[styles.xpFill, { width: `${Math.round(row.progressRatio * 100)}%` }]} />
                </View>
                <Text style={styles.xpHint}>
                  {row.possible > 0
                    ? `${Math.round(row.progressRatio * 100)}% of possible XP`
                    : row.current === 0
                    ? 'No weighted chores due'
                    : 'Completed XP only'}
                </Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeaderRow}>
          <Text style={styles.panelTitle}>Due Chores</Text>
          <View style={styles.panelHeaderActions}>
            <Text style={styles.metaText}>
              {choresQuery.isLoading ? 'Loading…' : `${visibleChores.length} due • ${chores.length} total chores`}
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
              <Text style={styles.markAllButtonText}>{isMarkingVisibleDone ? 'Working…' : 'Mark Visible Done'}</Text>
            </Pressable>
          </View>
        </View>

        {choresQuery.error ? (
          <Text style={styles.errorText}>{choresQuery.error.message || 'Failed to load chores'}</Text>
        ) : visibleChores.length === 0 ? (
          <Text style={styles.emptyText}>No chores are due for this date/filter.</Text>
        ) : (
          <View style={styles.cards}>
            {visibleChores.map(({ chore, toggleMembers, completionsOnDate, upForGrabsCompletedById }) => {
              const upForGrabsCompletedByName =
                upForGrabsCompletedById ? familyMemberNameById[upForGrabsCompletedById] || 'another member' : null;

              return (
                <View key={chore.id} style={styles.choreCard}>
                  <View style={styles.choreHeaderRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.choreTitle}>{chore.title || 'Untitled chore'}</Text>
                      {!!chore.description && showChoreDescriptions ? (
                        <Text style={styles.choreDescription}>{chore.description}</Text>
                      ) : null}
                    </View>
                    <View style={styles.tagRow}>
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
                            <Text style={styles.toggleName}>{member.name || familyMemberNameById[member.id] || 'Member'}</Text>
                            <Text style={styles.toggleMeta}>
                              {blockedByUpForGrabs
                                ? 'Already claimed'
                                : isDone
                                ? `Done • ${completion?.dateCompleted ? new Date(completion.dateCompleted).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'today'}`
                                : 'Not done yet'}
                            </Text>
                          </View>
                          <Pressable
                            testID={`chore-toggle-${chore.id}-${member.id}`}
                            accessibilityRole="button"
                            accessibilityLabel={`${isDone ? 'Mark not done' : 'Mark done'} for ${member.name || 'member'} on ${chore.title || 'chore'}`}
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
              );
            })}
          </View>
        )}
      </View>

      <PlaceholderCard
        title="Next up for this screen"
        body="Task series checklist embedding, guardrail prompt for 'mark all done & complete', and XP totals are the next Phase 2 pieces to move from web parity into this native flow."
      />
    </ScreenScaffold>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
  heroCard: {
    backgroundColor: colors.panelElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  heroEyebrow: {
    color: colors.inkMuted,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  heroName: { color: colors.ink, fontWeight: '800', fontSize: 18, marginTop: 2 },
  heroSub: { color: colors.inkMuted, marginTop: 4 },
  heroMetaXp: { color: colors.accentChores, fontWeight: '700', marginTop: 6, fontSize: 12 },
  switchButton: {
    backgroundColor: '#FFF2EA',
    borderColor: '#E7C4B6',
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  switchButtonText: { color: colors.accentChores, fontWeight: '700' },
  panel: {
    backgroundColor: colors.panelElevated,
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
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  xpCardSelected: {
    borderColor: '#E4BCAE',
    backgroundColor: '#FFF8F0',
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
    backgroundColor: '#EFE8DE',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E3D7C9',
  },
  xpFill: {
    height: '100%',
    backgroundColor: '#D98B66',
  },
  xpHint: { color: colors.inkMuted, fontSize: 11 },
  chipScroll: { gap: spacing.sm, paddingVertical: 2 },
  dateChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: '#FFFCF5',
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 82,
  },
  dateChipSelected: {
    backgroundColor: colors.accentChores,
    borderColor: colors.accentChores,
  },
  dateChipDay: { color: colors.inkMuted, fontSize: 11, fontWeight: '700' },
  dateChipDate: { color: colors.ink, marginTop: 2, fontWeight: '700' },
  dateChipTextSelected: { color: '#fff' },
  memberChip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.pill,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  memberChipSelected: {
    backgroundColor: '#F6ECE8',
    borderColor: '#E1BDAF',
  },
  memberChipText: { color: colors.ink, fontWeight: '600' },
  memberChipTextSelected: { color: colors.accentChores },
  viewOptionList: { gap: spacing.sm },
  viewOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    backgroundColor: '#fff',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  viewOptionRowActive: {
    borderColor: '#D7C2B4',
    backgroundColor: '#FFF8F0',
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
    borderColor: '#D8CBBE',
    backgroundColor: '#F2EDE7',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  togglePillOn: {
    borderColor: '#E1BDAF',
    backgroundColor: '#F6ECE8',
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D2C7BB',
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
    borderColor: '#D4A795',
    backgroundColor: '#FFF5EE',
  },
  metaText: { color: colors.inkMuted, fontSize: 12 },
  markAllButton: {
    borderWidth: 1,
    borderColor: '#E7C4B6',
    borderRadius: radii.pill,
    backgroundColor: '#FFF2EA',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  markAllButtonDisabled: {
    opacity: 0.55,
  },
  markAllButtonText: {
    color: colors.accentChores,
    fontWeight: '800',
    fontSize: 11,
  },
  emptyText: { color: colors.inkMuted },
  errorText: { color: colors.danger, fontWeight: '600' },
  cards: { gap: spacing.md },
  choreCard: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    backgroundColor: '#FFFDF9',
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
  tagWarm: { backgroundColor: '#FFF2E6', borderColor: '#E8C7A8' },
  tagWarmText: { color: '#9A5E2B' },
  tagXp: { backgroundColor: '#EEF6FF', borderColor: '#C8DBF0' },
  tagXpText: { color: '#365B86' },
  tagNeutral: { backgroundColor: '#EEF2F8', borderColor: '#CBD6E5' },
  tagNeutralText: { color: '#4D617C' },
  helperText: { color: colors.inkMuted, fontSize: 12 },
  toggleList: { gap: spacing.sm },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: '#EEE5D9',
    borderRadius: radii.sm,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  toggleName: { color: colors.ink, fontWeight: '700' },
  toggleMeta: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  toggleButton: {
    minWidth: 62,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#D7C3B6',
    backgroundColor: '#FFF4EB',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  toggleButtonDone: {
    borderColor: '#B7DDBF',
    backgroundColor: '#EAF8EE',
  },
  toggleButtonDisabled: {
    opacity: 0.55,
    backgroundColor: '#F5F3EF',
    borderColor: '#DED8CF',
  },
  toggleButtonBusy: { opacity: 0.7 },
  toggleButtonText: { color: colors.accentChores, fontWeight: '800', fontSize: 12 },
  toggleButtonTextDone: { color: colors.success },
  toggleButtonTextDisabled: { color: colors.inkMuted },
  completionSummary: { color: colors.inkMuted, fontSize: 12, marginTop: 2 },
  });
