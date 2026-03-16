import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { id, tx } from '@instantdb/react-native';
import { router } from 'expo-router';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import {
  calculateDailyXP,
  formatDateKeyUTC,
  getAssignedMembersForChoreOnDate,
  getCompletedChoreCompletionsForDate,
  getMemberCompletionForDate,
  localDateToUTC,
} from '@family-organizer/shared-core';
import { AvatarPhotoImage } from '../../src/components/AvatarPhotoImage';
import { AttachmentPreviewModal } from '../../src/components/AttachmentPreviewModal';
import { radii, shadows, spacing, withAlpha } from '../../src/theme/tokens';
import { useAppSession } from '../../src/providers/AppProviders';
import { getPresignedFileUrl } from '../../src/lib/api-client';
import {
  captureCameraImage,
  captureCameraVideo,
  createRecordedAudioAttachment,
  pickAttachmentDocuments,
  pickLibraryMedia,
  uploadPendingAttachments,
} from '../../src/lib/attachments';
import { getTasksForDate } from '../../../lib/task-scheduler';
import { buildTaskProgressUpdateTransactions } from '../../../lib/task-progress-mutations';
import {
  getBucketedTasks,
  getLatestTaskProgressEntry,
  getTaskActorName,
  getTaskLastActiveState,
  getTaskProgressPlaceholder,
  getTaskStatusLabel,
  getTaskWorkflowState,
  isTaskDone,
  sortTaskProgressEntries,
} from '../../../lib/task-progress';
import { useAppTheme } from '../../src/theme/ThemeProvider';

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
  return Array.from({ length: DAY_RANGE }).map((_, index) => {
    const offset = index - Math.floor(DAY_RANGE / 2);
    return new Date(selectedDate.getTime() + offset * 86400000);
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

  function pushLink(label, url, kind = 'link', extra = {}) {
    if (!url || seen.has(url) || links.length >= MAX_LINKS_PER_TASK) return;
    seen.add(url);
    links.push({ key: `${kind}:${url}`, label, url, kind, ...extra });
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
    const isFullUrl = /^https?:\/\//i.test(key);
    pushLink(attachment.name || 'Open attachment', isFullUrl ? key : key, 'attachment', {
      attachment,
    });
    if (!isFullUrl) {
      // Mark with the S3 key so openTaskLink can resolve it via presigned URL
      const link = links[links.length - 1];
      if (link) link.s3Key = key;
    }
  });

  return links;
}

async function openTaskLink(link) {
  try {
    let resolvedUrl = link.url;
    if (link.s3Key) {
      resolvedUrl = await getPresignedFileUrl(link.s3Key);
    }
    await Linking.openURL(resolvedUrl);
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

function SectionCard({ title, meta, children, styles }) {
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
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { db, currentUser, familyMembers, isAuthenticated, instantReady, lock } = useAppSession();
  const [selectedDate, setSelectedDate] = useState(() => localDateToUTC(new Date()));
  const [viewedMemberId, setViewedMemberId] = useState('');
  const [menuVisible, setMenuVisible] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [pendingCompletionKeys, setPendingCompletionKeys] = useState(() => new Set());
  const [taskComposer, setTaskComposer] = useState(null);
  const [restoreRequest, setRestoreRequest] = useState(null);
  const [taskMutationPending, setTaskMutationPending] = useState(false);
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const currentUserIdRef = useRef('');
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const audioRecorderState = useAudioRecorderState(audioRecorder, 200);

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
                progressEntries: {
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
          series.startDate || null,
          chore.exdates || null
        );
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
          visibleNodes: buildVisibleTaskNodes(scheduledTasks, allTasks),
          incompleteCount: scheduledTasks.filter((task) => !isTaskDone(task) && !task.isDayBreak).length,
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

  // ---------- Calendar Events ----------
  const calendarEvents = useMemo(() => {
    if (!viewedMember?.id) return [];
    const items = dashboardQuery.data?.calendarItems || [];
    const today = selectedDate;

    return items
      .map((item) => {
        const memberIds = (item.pertainsTo || []).map((m) => m.id).filter(Boolean);
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
          timeLabel = startsAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · All day';
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
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
      .slice(0, 10);
  }, [dashboardQuery.data?.calendarItems, viewedMember?.id, selectedDate]);

  // ---------- Unread Messages ----------
  const unreadThreads = useMemo(() => {
    if (!viewedMember?.id || !dashboardQuery.data?.messageThreads) return [];
    const threads = dashboardQuery.data.messageThreads;
    const result = [];

    for (const thread of threads) {
      if (!thread.latestMessageAt) continue;
      const membership = (thread.members || []).find(
        (m) => m.familyMemberId === viewedMember.id
      );
      if (!membership) continue;
      if (membership.isArchived) continue;

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

    return result.sort((a, b) => b.latestMessageAt.localeCompare(a.latestMessageAt));
  }, [dashboardQuery.data?.messageThreads, viewedMember?.id]);

  function appendComposerFiles(files) {
    if (!files?.length) return;
    setTaskComposer((previous) => {
      if (!previous) return previous;
      return {
        ...previous,
        files: [...previous.files, ...files],
      };
    });
  }

  async function handleOpenTaskLink(link) {
    if (link.kind === 'attachment' && link.attachment) {
      setPreviewAttachment(link.attachment);
      return;
    }
    await openTaskLink(link);
  }

  function openTaskComposer(task, allTasks, chore) {
    setTaskComposer({
      taskId: task.id,
      task,
      allTasks,
      chore,
      nextState: getTaskWorkflowState(task),
      note: '',
      files: [],
    });
  }

  function closeTaskComposer() {
    if (taskMutationPending) return;
    if (audioRecorderState.isRecording) {
      void stopComposerAudioRecording();
    }
    setTaskComposer(null);
  }

  function getComposerStateOptions(task) {
    const currentState = getTaskWorkflowState(task);
    if (currentState === 'not_started') {
      return ['not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done'];
    }
    if (currentState === 'in_progress') {
      return ['in_progress', 'not_started', 'blocked', 'skipped', 'needs_review', 'done'];
    }
    return [currentState];
  }

  async function pickComposerFiles() {
    try {
      const files = await pickAttachmentDocuments();
      appendComposerFiles(files);
    } catch (error) {
      Alert.alert('Unable to add files', error?.message || 'Please try again.');
    }
  }

  async function pickComposerMedia() {
    try {
      const files = await pickLibraryMedia();
      appendComposerFiles(files);
    } catch (error) {
      Alert.alert('Unable to open library', error?.message || 'Please try again.');
    }
  }

  async function captureComposerPhoto() {
    try {
      const files = await captureCameraImage();
      appendComposerFiles(files);
    } catch (error) {
      Alert.alert('Unable to take photo', error?.message || 'Please try again.');
    }
  }

  async function captureComposerVideo() {
    try {
      const files = await captureCameraVideo();
      appendComposerFiles(files);
    } catch (error) {
      Alert.alert('Unable to record video', error?.message || 'Please try again.');
    }
  }

  async function startComposerAudioRecording() {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone required', 'Allow microphone access to record audio attachments.');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (error) {
      Alert.alert('Unable to record audio', error?.message || 'Please try again.');
    }
  }

  async function stopComposerAudioRecording() {
    if (!audioRecorderState.isRecording) return;

    try {
      await audioRecorder.stop();
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      const recordedFile = createRecordedAudioAttachment({
        uri: audioRecorder.uri || audioRecorderState.uri,
        durationMillis: audioRecorderState.durationMillis,
      });
      if (recordedFile?.uri) {
        appendComposerFiles([recordedFile]);
      }
    } catch (error) {
      Alert.alert('Unable to stop recording', error?.message || 'Please try again.');
    }
  }

  async function applyTaskWorkflowUpdate(context, payload) {
    if (!currentUser?.id) {
      Alert.alert('Login required', 'Choose a family member before updating task status.');
      return;
    }

    setTaskMutationPending(true);
    try {
      const attachments = payload.files?.length ? await uploadPendingAttachments(payload.files, id) : [];
      const transactions = buildTaskProgressUpdateTransactions({
        tx,
        createId: id,
        taskId: context.taskId,
        allTasks: context.allTasks,
        nextState: payload.nextState,
        selectedDateKey,
        note: payload.note,
        actorFamilyMemberId: currentUser.id,
        restoreTiming: payload.restoreTiming || null,
        schedule: {
          startDate: context.chore.startDate,
          rrule: context.chore.rrule || null,
          exdates: context.chore.exdates || null,
        },
        referenceDate: selectedDate,
        attachments,
      });

      if (!transactions.length) return;
      await db.transact(transactions);
    } catch (error) {
      Alert.alert('Unable to update task', error?.message || 'Please try again.');
      throw error;
    } finally {
      setTaskMutationPending(false);
    }
  }

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

  async function handleToggleTask(task, allTasks, chore) {
    const currentStatus = isTaskDone(task);
    const nextState = currentStatus ? getTaskLastActiveState(task) : 'done';

    await applyTaskWorkflowUpdate(
      {
        taskId: task.id,
        task,
        allTasks,
        chore,
      },
      {
        nextState,
      }
    );
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
      <AvatarPhotoImage
        photoUrls={currentUser.photoUrls}
        preferredSize="320"
        style={styles.topStripAvatarImage}
        fallback={
          <View style={styles.topStripAvatarFallback}>
            <Text style={styles.topStripAvatarFallbackText}>{createInitials(currentUser.name)}</Text>
          </View>
        }
      />
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
                <AvatarPhotoImage
                  photoUrls={viewedMember?.photoUrls}
                  preferredSize="320"
                  style={styles.heroAvatarImage}
                  fallback={
                    <View style={styles.heroAvatarFallback}>
                      <Text style={styles.heroAvatarFallbackText}>{createInitials(viewedMember?.name)}</Text>
                    </View>
                  }
                />
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
            styles={styles}
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
                  const bucketedByState = {
                    blocked: getBucketedTasks(card.allTasks, 'blocked'),
                    needs_review: getBucketedTasks(card.allTasks, 'needs_review'),
                    skipped: getBucketedTasks(card.allTasks, 'skipped'),
                    done: getBucketedTasks(card.allTasks, 'done'),
                  };

                  return (
                    <View key={card.id} style={styles.taskSeriesCard}>
                      <View style={styles.taskSeriesHeader}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.taskSeriesName}>{card.series.name || 'Untitled series'}</Text>
                          <Text style={styles.taskSeriesMeta}>
                            {card.chore?.title ? `From ${card.chore.title}` : 'Task series'}
                            {card.incompleteCount > 0 ? ` • ${card.incompleteCount} active` : ' • No active tasks'}
                          </Text>
                        </View>
                      </View>

                      {card.visibleNodes.length > 0 ? (
                        <View style={styles.taskItemList}>
                          {card.visibleNodes.map((task) => {
                            const isHeader =
                              hasScheduledChildren(task.id, scheduledIds, card.allTasks) || !scheduledIds.has(task.id);
                            const links = buildTaskLinks(task);
                            const indent = (task.indentationLevel || 0) * 14;
                            const currentState = getTaskWorkflowState(task);
                            const latestEntry = getLatestTaskProgressEntry(task);

                            return (
                              <View
                                key={`task-${card.id}-${task.id}`}
                                style={[
                                  styles.taskRow,
                                  isHeader && styles.taskRowHeader,
                                  { marginLeft: indent },
                                ]}
                              >
                                {isHeader ? (
                                  <View style={styles.taskCopy}>
                                    <Text selectable style={styles.taskHeaderText}>{task.text}</Text>
                                    {task.notes ? <Text selectable style={styles.taskNotes}>{task.notes}</Text> : null}
                                    {links.length > 0 ? (
                                      <View style={styles.taskLinksRow}>
                                        {links.map((link) => (
                                          <Pressable
                                            key={link.key}
                                            accessibilityRole="button"
                                            accessibilityLabel={link.label}
                                            onPress={() => {
                                              void handleOpenTaskLink(link);
                                            }}
                                            style={styles.taskLinkChip}
                                          >
                                            <Text style={styles.taskLinkText}>{link.label}</Text>
                                          </Pressable>
                                        ))}
                                      </View>
                                    ) : null}
                                  </View>
                                ) : (
                                  <View style={styles.taskMobileCard}>
                                    <View style={styles.taskCopy}>
                                      <View style={styles.taskTitleRow}>
                                        <Text selectable style={styles.taskText}>
                                          {task.text}
                                        </Text>
                                        <View style={styles.taskStatusBadge}>
                                          <Text style={styles.taskStatusBadgeText}>{getTaskStatusLabel(currentState)}</Text>
                                        </View>
                                      </View>
                                      {task.notes ? <Text selectable style={styles.taskNotes}>{task.notes}</Text> : null}
                                      {links.length > 0 ? (
                                        <View style={styles.taskLinksRow}>
                                          {links.map((link) => (
                                            <Pressable
                                              key={link.key}
                                              accessibilityRole="button"
                                              accessibilityLabel={link.label}
                                              onPress={() => {
                                                void handleOpenTaskLink(link);
                                              }}
                                              style={styles.taskLinkChip}
                                            >
                                              <Text style={styles.taskLinkText}>{link.label}</Text>
                                            </Pressable>
                                          ))}
                                        </View>
                                      ) : null}
                                      {latestEntry?.note ? <Text style={styles.taskProgressSnippet}>{latestEntry.note}</Text> : null}
                                    </View>
                                    <View style={styles.taskActionRow}>
                                      {currentState === 'not_started' ? (
                                        <Pressable
                                          accessibilityRole="button"
                                          accessibilityLabel={`Start ${task.text}`}
                                          onPress={() => {
                                            void applyTaskWorkflowUpdate(
                                              { taskId: task.id, task, allTasks: card.allTasks, chore: card.chore },
                                              { nextState: 'in_progress' }
                                            );
                                          }}
                                          style={[styles.taskActionChip, styles.taskActionChipSecondary]}
                                        >
                                          <Text style={[styles.taskActionChipText, styles.taskActionChipTextSecondary]}>Start</Text>
                                        </Pressable>
                                      ) : null}
                                      <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Update ${task.text}`}
                                        onPress={() => openTaskComposer(task, card.allTasks, card.chore)}
                                        style={[styles.taskActionChip, styles.taskActionChipSecondary]}
                                      >
                                        <Text style={[styles.taskActionChipText, styles.taskActionChipTextSecondary]}>Update</Text>
                                      </Pressable>
                                      <Pressable
                                        testID={`dashboard-task-toggle-${task.id}`}
                                        accessibilityRole="button"
                                        accessibilityLabel={`Mark task done ${task.text}`}
                                        onPress={() => {
                                          void handleToggleTask(task, card.allTasks, card.chore);
                                        }}
                                        style={[styles.taskActionChip, styles.taskActionChipPrimary]}
                                      >
                                        <Text style={[styles.taskActionChipText, styles.taskActionChipTextPrimary]}>Done</Text>
                                      </Pressable>
                                    </View>
                                  </View>
                                )}
                              </View>
                            );
                          })}
                        </View>
                      ) : (
                        <Text style={styles.emptyInlineText}>No active tasks right now. Check the bins below.</Text>
                      )}

                      {['blocked', 'needs_review', 'skipped', 'done'].map((stateKey) => {
                        const tasksForState = bucketedByState[stateKey] || [];
                        if (!tasksForState.length) return null;

                        return (
                          <View key={`${card.id}-${stateKey}`} style={styles.taskBucketSection}>
                            <View style={styles.taskBucketHeader}>
                              <Text style={styles.taskBucketTitle}>{getTaskStatusLabel(stateKey)}</Text>
                              <Text style={styles.taskBucketCount}>
                                {tasksForState.length} item{tasksForState.length === 1 ? '' : 's'}
                              </Text>
                            </View>
                            {tasksForState.map((task) => {
                              const latestEntry = getLatestTaskProgressEntry(task);
                              const actorName = getTaskActorName(latestEntry, familyMemberNameById);
                              return (
                                <View key={`${stateKey}-${task.id}`} style={styles.taskBucketCard}>
                                  <Text style={styles.taskBucketTaskTitle}>{task.text}</Text>
                                  {latestEntry?.note ? <Text style={styles.taskBucketTaskNote}>{latestEntry.note}</Text> : null}
                                  <View style={styles.taskBucketMetaRow}>
                                    {actorName ? <Text style={styles.taskBucketMeta}>Latest by {actorName}</Text> : null}
                                    {latestEntry?.createdAt ? (
                                      <Text style={styles.taskBucketMeta}>{new Date(latestEntry.createdAt).toLocaleString()}</Text>
                                    ) : null}
                                  </View>
                                  {latestEntry?.attachments?.length ? (
                                    <View style={styles.taskLinksRow}>
                                      {latestEntry.attachments.map((attachment) => (
                                        <Pressable
                                          key={attachment.id}
                                          accessibilityRole="button"
                                          accessibilityLabel={attachment.name || 'Open attachment'}
                                          onPress={() => setPreviewAttachment(attachment)}
                                          style={styles.taskLinkChip}
                                        >
                                          <Text style={styles.taskLinkText}>{attachment.name || 'Attachment'}</Text>
                                        </Pressable>
                                      ))}
                                    </View>
                                  ) : null}
                                  <View style={styles.taskActionRow}>
                                    <Pressable
                                      accessibilityRole="button"
                                      accessibilityLabel={`Update ${task.text}`}
                                      onPress={() => openTaskComposer(task, card.allTasks, card.chore)}
                                      style={[styles.taskActionChip, styles.taskActionChipSecondary]}
                                    >
                                      <Text style={[styles.taskActionChipText, styles.taskActionChipTextSecondary]}>Update</Text>
                                    </Pressable>
                                    {stateKey === 'done' ? (
                                      <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Undo ${task.text}`}
                                        onPress={() => {
                                          void handleToggleTask(task, card.allTasks, card.chore);
                                        }}
                                        style={[styles.taskActionChip, styles.taskActionChipSecondary]}
                                      >
                                        <Text style={[styles.taskActionChipText, styles.taskActionChipTextSecondary]}>Undo</Text>
                                      </Pressable>
                                    ) : (
                                      <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Restore ${task.text}`}
                                        onPress={() => setRestoreRequest({
                                          taskId: task.id,
                                          task,
                                          allTasks: card.allTasks,
                                          chore: card.chore,
                                          nextState: getTaskLastActiveState(task),
                                        })}
                                        style={[styles.taskActionChip, styles.taskActionChipSecondary]}
                                      >
                                        <Text style={[styles.taskActionChipText, styles.taskActionChipTextSecondary]}>Restore</Text>
                                      </Pressable>
                                    )}
                                    {stateKey === 'needs_review' && currentUser?.role === 'parent' ? (
                                      <Pressable
                                        accessibilityRole="button"
                                        accessibilityLabel={`Approve ${task.text}`}
                                        onPress={() => {
                                          void handleToggleTask({ ...task, workflowState: 'needs_review' }, card.allTasks, card.chore);
                                        }}
                                        style={[styles.taskActionChip, styles.taskActionChipPrimary]}
                                      >
                                        <Text style={[styles.taskActionChipText, styles.taskActionChipTextPrimary]}>Approve</Text>
                                      </Pressable>
                                    ) : null}
                                  </View>
                                </View>
                              );
                            })}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            )}
          </SectionCard>

          <SectionCard
            title="Chores"
            styles={styles}
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

          {/* ===== CALENDAR EVENTS ===== */}
          <SectionCard
            title="Calendar"
            styles={styles}
            meta={calendarEvents.length > 0
              ? `${calendarEvents.length} upcoming event${calendarEvents.length === 1 ? '' : 's'}`
              : 'No upcoming events'
            }
          >
            {calendarEvents.length === 0 ? (
              <Text style={styles.emptyText}>
                No calendar events for {viewedMember?.name || 'this member'}.
              </Text>
            ) : (
              <View style={styles.choreList}>
                {calendarEvents.map((event) => (
                  <View key={`cal-${event.id}`} style={styles.choreCard}>
                    <View style={styles.choreHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.choreTitle}>{event.title}</Text>
                        <Text style={styles.choreDescription}>{event.timeLabel}</Text>
                      </View>
                      {event.isFamilyWide ? (
                        <View style={[styles.tag, styles.tagNeutral]}>
                          <Text style={[styles.tagText, styles.tagNeutralText]}>Family</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ))}
              </View>
            )}
          </SectionCard>

          {/* ===== UNREAD MESSAGES ===== */}
          {unreadThreads.length > 0 ? (
            <SectionCard
              title="Unread Messages"
              styles={styles}
              meta={`${unreadThreads.length} thread${unreadThreads.length === 1 ? '' : 's'}`}
            >
              <View style={styles.choreList}>
                {unreadThreads.map((thread) => (
                  <View key={`msg-${thread.id}`} style={styles.choreCard}>
                    <View style={styles.choreHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.choreTitle}>{thread.displayName}</Text>
                        <Text style={styles.choreDescription} numberOfLines={1}>{thread.previewText}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </SectionCard>
          ) : null}

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

      <Modal visible={!!taskComposer} transparent animationType="slide" onRequestClose={closeTaskComposer}>
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={closeTaskComposer} />
          <View style={styles.sheetCard}>
            <Text style={styles.sheetTitle}>Task update</Text>
            {taskComposer ? (
              <>
                <Text style={styles.sheetTaskTitle}>{taskComposer.task.text}</Text>
                {taskComposer.task.notes ? <Text style={styles.sheetTaskBody}>{taskComposer.task.notes}</Text> : null}

                <Text style={styles.sheetLabel}>State</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetStateRow}>
                  {getComposerStateOptions(taskComposer.task).map((state) => {
                    const selected = taskComposer.nextState === state;
                    return (
                      <Pressable
                        key={state}
                        accessibilityRole="button"
                        accessibilityLabel={`Set task state to ${getTaskStatusLabel(state)}`}
                        onPress={() => setTaskComposer((previous) => previous ? { ...previous, nextState: state } : previous)}
                        style={[styles.sheetStateChip, selected && styles.sheetStateChipSelected]}
                      >
                        <Text style={[styles.sheetStateChipText, selected && styles.sheetStateChipTextSelected]}>
                          {getTaskStatusLabel(state)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <Text style={styles.sheetLabel}>Notes</Text>
                <TextInput
                  multiline
                  value={taskComposer.note}
                  onChangeText={(note) => setTaskComposer((previous) => previous ? { ...previous, note } : previous)}
                  placeholder={getTaskProgressPlaceholder(taskComposer.nextState)}
                  placeholderTextColor={withAlpha(colors.ink, 0.35)}
                  style={styles.sheetTextArea}
                />

                <View style={styles.sheetEvidenceHeader}>
                  <Text style={styles.sheetLabel}>Evidence</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sheetMediaActionRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Add evidence files" onPress={() => { void pickComposerFiles(); }} style={styles.sheetMediaActionChip}>
                    <Text style={styles.sheetMediaActionText}>Files</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Choose photos or videos from library" onPress={() => { void pickComposerMedia(); }} style={styles.sheetMediaActionChip}>
                    <Text style={styles.sheetMediaActionText}>Library</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Take a photo" onPress={() => { void captureComposerPhoto(); }} style={styles.sheetMediaActionChip}>
                    <Text style={styles.sheetMediaActionText}>Photo</Text>
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Record a video" onPress={() => { void captureComposerVideo(); }} style={styles.sheetMediaActionChip}>
                    <Text style={styles.sheetMediaActionText}>Video</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={audioRecorderState.isRecording ? 'Stop audio recording' : 'Record audio'}
                    onPress={() => {
                      if (audioRecorderState.isRecording) {
                        void stopComposerAudioRecording();
                      } else {
                        void startComposerAudioRecording();
                      }
                    }}
                    style={[styles.sheetMediaActionChip, audioRecorderState.isRecording && styles.sheetMediaActionChipActive]}
                  >
                    <Text style={[styles.sheetMediaActionText, audioRecorderState.isRecording && styles.sheetMediaActionTextActive]}>
                      {audioRecorderState.isRecording ? `Stop ${Math.round((audioRecorderState.durationMillis || 0) / 1000)}s` : 'Audio'}
                    </Text>
                  </Pressable>
                </ScrollView>
                {taskComposer.files.length > 0 ? (
                  <View style={styles.sheetFileList}>
                    {taskComposer.files.map((file, index) => (
                      <View key={`${file.name}-${index}`} style={styles.sheetFileRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.sheetFileName} numberOfLines={1}>{file.name}</Text>
                          <Text style={styles.sheetFileMeta}>
                            {file.kind || 'file'}
                            {Number.isFinite(Number(file.durationSec)) ? ` • ${Math.round(Number(file.durationSec))}s` : ''}
                          </Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Remove ${file.name}`}
                          onPress={() => setTaskComposer((previous) => previous ? { ...previous, files: previous.files.filter((_, currentIndex) => currentIndex !== index) } : previous)}
                        >
                          <Text style={styles.sheetRemoveLink}>Remove</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.sheetHelperText}>Attach photos, documents, audio, or video for this update.</Text>
                )}

                <Text style={styles.sheetLabel}>History</Text>
                <ScrollView style={styles.sheetHistoryList}>
                  {sortTaskProgressEntries(taskComposer.task.progressEntries).length === 0 ? (
                    <Text style={styles.sheetHelperText}>No updates yet.</Text>
                  ) : (
                    sortTaskProgressEntries(taskComposer.task.progressEntries).map((entry) => (
                      <View key={entry.id} style={styles.sheetHistoryCard}>
                        <Text style={styles.sheetHistoryMeta}>
                          {entry.fromState && entry.toState && entry.fromState !== entry.toState
                            ? `${getTaskStatusLabel(entry.fromState)} -> ${getTaskStatusLabel(entry.toState)}`
                            : getTaskStatusLabel(entry.toState || getTaskWorkflowState(taskComposer.task))}
                        </Text>
                        {getTaskActorName(entry, familyMemberNameById) ? <Text style={styles.sheetHistoryMeta}>by {getTaskActorName(entry, familyMemberNameById)}</Text> : null}
                        {entry.createdAt ? <Text style={styles.sheetHistoryMeta}>{new Date(entry.createdAt).toLocaleString()}</Text> : null}
                        {entry.note ? <Text style={styles.sheetHistoryBody}>{entry.note}</Text> : null}
                        {entry.attachments?.length ? (
                          <View style={styles.taskLinksRow}>
                            {entry.attachments.map((attachment) => (
                              <Pressable
                                key={attachment.id}
                                accessibilityRole="button"
                                accessibilityLabel={attachment.name || 'Open attachment'}
                                onPress={() => setPreviewAttachment(attachment)}
                                style={styles.taskLinkChip}
                              >
                                <Text style={styles.taskLinkText}>{attachment.name || 'Attachment'}</Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : null}
                      </View>
                    ))
                  )}
                </ScrollView>

                <View style={styles.sheetActionRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Cancel task update" onPress={closeTaskComposer} style={[styles.sheetButton, styles.sheetButtonSecondary]}>
                    <Text style={[styles.sheetButtonText, styles.sheetButtonTextSecondary]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Save task update"
                    disabled={taskMutationPending || audioRecorderState.isRecording}
                    onPress={() => {
                      applyTaskWorkflowUpdate(taskComposer, {
                        nextState: taskComposer.nextState,
                        note: taskComposer.note,
                        files: taskComposer.files,
                      }).then(() => {
                        setTaskComposer(null);
                      }).catch(() => {});
                    }}
                    style={[styles.sheetButton, styles.sheetButtonPrimary, (taskMutationPending || audioRecorderState.isRecording) && styles.sheetButtonDisabled]}
                  >
                    <Text style={[styles.sheetButtonText, styles.sheetButtonTextPrimary]}>
                      {audioRecorderState.isRecording ? 'Stop recording first' : taskMutationPending ? 'Saving…' : 'Save update'}
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal visible={!!restoreRequest} transparent animationType="fade" onRequestClose={() => setRestoreRequest(null)}>
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetBackdrop} onPress={() => setRestoreRequest(null)} />
          <View style={styles.sheetCardCompact}>
            <Text style={styles.sheetTitle}>Restore task</Text>
            <Text style={styles.sheetHelperText}>Bring this task back now, or wait until the next scheduled chore day.</Text>
            <View style={styles.sheetActionColumn}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Restore task now"
                disabled={taskMutationPending}
                onPress={() => {
                  if (!restoreRequest) return;
                  applyTaskWorkflowUpdate(restoreRequest, {
                    nextState: restoreRequest.nextState,
                    restoreTiming: 'now',
                  }).then(() => setRestoreRequest(null)).catch(() => {});
                }}
                style={[styles.sheetButton, styles.sheetButtonPrimary, taskMutationPending && styles.sheetButtonDisabled]}
              >
                <Text style={[styles.sheetButtonText, styles.sheetButtonTextPrimary]}>Return now</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Restore task on next scheduled day"
                disabled={taskMutationPending}
                onPress={() => {
                  if (!restoreRequest) return;
                  applyTaskWorkflowUpdate(restoreRequest, {
                    nextState: restoreRequest.nextState,
                    restoreTiming: 'next_scheduled',
                  }).then(() => setRestoreRequest(null)).catch(() => {});
                }}
                style={[styles.sheetButton, styles.sheetButtonSecondary]}
              >
                <Text style={[styles.sheetButtonText, styles.sheetButtonTextSecondary]}>Return next scheduled day</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.menuOverlay}>
          <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
          <View style={styles.menuSheet}>
            <View style={styles.menuHeader}>
              <View style={styles.menuIdentity}>
                <AvatarPhotoImage
                  photoUrls={currentUser?.photoUrls}
                  preferredSize="320"
                  style={styles.menuAvatarImage}
                  fallback={
                    <View style={styles.menuAvatarFallback}>
                      <Text style={styles.menuAvatarFallbackText}>{createInitials(currentUser?.name)}</Text>
                    </View>
                  }
                />
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

      <AttachmentPreviewModal
        attachment={previewAttachment}
        visible={!!previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />
    </>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
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
    backgroundColor: withAlpha(colors.accentDashboard, 0.1),
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(colors.accentDashboard, 0.18),
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
    borderColor: withAlpha(colors.accentDashboard, 0.24),
    backgroundColor: colors.panelElevated,
  },
  topStripAvatarImage: {
    width: '100%',
    height: '100%',
  },
  topStripAvatarFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.accentDashboard, 0.18),
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
    borderColor: withAlpha(colors.accentDashboard, 0.22),
  },
  heroAvatarFallback: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(colors.accentDashboard, 0.18),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentDashboard, 0.22),
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
    borderColor: colors.line,
    backgroundColor: colors.panel,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  dateMiniCardActive: {
    borderColor: withAlpha(colors.accentDashboard, 0.3),
    backgroundColor: withAlpha(colors.accentDashboard, 0.1),
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
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
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
    color: colors.onAccent,
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
    borderColor: colors.line,
    backgroundColor: colors.panel,
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
  emptyInlineText: {
    color: colors.inkMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  taskRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    paddingVertical: 6,
  },
  taskRowDone: {
    backgroundColor: withAlpha(colors.success, 0.08),
    borderRadius: radii.sm,
    paddingHorizontal: spacing.xs,
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
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginTop: 1,
  },
  taskToggleDone: {
    backgroundColor: withAlpha(colors.success, 0.12),
    borderColor: withAlpha(colors.success, 0.26),
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
  taskMobileCard: {
    flex: 1,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  taskTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  taskStatusBadge: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: withAlpha(colors.accentCalendar, 0.22),
    backgroundColor: withAlpha(colors.accentCalendar, 0.1),
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  taskStatusBadgeText: {
    color: colors.accentCalendar,
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  taskProgressSnippet: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 17,
    paddingTop: 2,
  },
  taskActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  taskActionChip: {
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  taskActionChipPrimary: {
    backgroundColor: colors.accentCalendar,
    borderColor: colors.accentCalendar,
  },
  taskActionChipSecondary: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
  },
  taskActionChipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  taskActionChipTextPrimary: {
    color: colors.panel,
  },
  taskActionChipTextSecondary: {
    color: colors.ink,
  },
  taskCopyDone: {
    opacity: 0.82,
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
  taskNotesDone: {
    textDecorationLine: 'line-through',
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
    borderColor: withAlpha(colors.accentCalendar, 0.26),
    backgroundColor: withAlpha(colors.accentCalendar, 0.1),
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  taskLinkText: {
    color: colors.accentCalendar,
    fontWeight: '700',
    fontSize: 12,
  },
  taskBucketSection: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  taskBucketHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  taskBucketTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '800',
  },
  taskBucketCount: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  taskBucketCard: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  taskBucketTaskTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '700',
  },
  taskBucketTaskNote: {
    color: colors.inkMuted,
    fontSize: 13,
    lineHeight: 18,
  },
  taskBucketMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  taskBucketMeta: {
    color: colors.inkMuted,
    fontSize: 11,
  },
  choreList: {
    gap: spacing.sm,
  },
  choreCard: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
    padding: spacing.md,
    gap: spacing.sm,
  },
  choreCardDone: {
    backgroundColor: withAlpha(colors.locked, 0.12),
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
    color: colors.inkMuted,
  },
  choreToggleButton: {
    minWidth: 74,
    minHeight: 40,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: withAlpha(colors.accentDashboard, 0.26),
    backgroundColor: withAlpha(colors.accentDashboard, 0.08),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  choreToggleButtonDone: {
    backgroundColor: withAlpha(colors.success, 0.12),
    borderColor: withAlpha(colors.success, 0.26),
  },
  choreToggleButtonLocked: {
    backgroundColor: withAlpha(colors.locked, 0.18),
    borderColor: withAlpha(colors.locked, 0.34),
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
    backgroundColor: withAlpha(colors.warning, 0.12),
    borderColor: withAlpha(colors.warning, 0.26),
  },
  tagWarmText: {
    color: colors.warning,
  },
  tagNeutral: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
  },
  tagNeutralText: {
    color: colors.inkMuted,
  },
  tagXp: {
    backgroundColor: withAlpha(colors.accentDashboard, 0.1),
    borderColor: withAlpha(colors.accentDashboard, 0.24),
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
    backgroundColor: withAlpha(colors.accentFinance, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentFinance, 0.22),
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
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha(colors.ink, 0.34),
  },
  sheetCard: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.sm,
    maxHeight: '86%',
  },
  sheetCardCompact: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.xl,
    backgroundColor: colors.panel,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  sheetTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  sheetTaskTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  sheetTaskBody: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  sheetLabel: {
    color: colors.inkMuted,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 4,
  },
  sheetStateRow: {
    gap: spacing.xs,
    paddingVertical: 4,
  },
  sheetStateChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sheetStateChipSelected: {
    borderColor: colors.accentCalendar,
    backgroundColor: withAlpha(colors.accentCalendar, 0.12),
  },
  sheetStateChipText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  sheetStateChipTextSelected: {
    color: colors.accentCalendar,
  },
  sheetTextArea: {
    minHeight: 120,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  sheetEvidenceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetLink: {
    color: colors.accentCalendar,
    fontWeight: '700',
  },
  sheetMediaActionRow: {
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  sheetMediaActionChip: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  sheetMediaActionChipActive: {
    borderColor: colors.warning,
    backgroundColor: withAlpha(colors.warning, 0.12),
  },
  sheetMediaActionText: {
    color: colors.ink,
    fontWeight: '700',
  },
  sheetMediaActionTextActive: {
    color: colors.warning,
  },
  sheetFileList: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  sheetFileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sheetFileName: {
    color: colors.ink,
    flex: 1,
  },
  sheetFileMeta: {
    color: colors.inkMuted,
    fontSize: 11,
    marginTop: 2,
  },
  sheetRemoveLink: {
    color: colors.warning,
    fontWeight: '700',
  },
  sheetHelperText: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  sheetHistoryList: {
    maxHeight: 180,
  },
  sheetHistoryCard: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    padding: spacing.sm,
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  sheetHistoryMeta: {
    color: colors.inkMuted,
    fontSize: 11,
  },
  sheetHistoryBody: {
    color: colors.ink,
    lineHeight: 18,
  },
  sheetActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  sheetActionColumn: {
    gap: spacing.sm,
  },
  sheetButton: {
    borderRadius: radii.pill,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  sheetButtonPrimary: {
    backgroundColor: colors.accentCalendar,
    borderColor: colors.accentCalendar,
  },
  sheetButtonSecondary: {
    backgroundColor: colors.panelElevated,
    borderColor: colors.line,
  },
  sheetButtonDisabled: {
    opacity: 0.6,
  },
  sheetButtonText: {
    fontWeight: '800',
  },
  sheetButtonTextPrimary: {
    color: colors.panel,
  },
  sheetButtonTextSecondary: {
    color: colors.ink,
  },
  menuOverlay: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withAlpha(colors.ink, 0.28),
  },
  menuSheet: {
    marginTop: 92,
    marginHorizontal: spacing.lg,
    backgroundColor: colors.panel,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  menuHeader: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
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
    backgroundColor: withAlpha(colors.accentDashboard, 0.18),
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
    borderColor: colors.line,
    backgroundColor: colors.panelElevated,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  menuMemberRowSelected: {
    borderColor: withAlpha(colors.accentDashboard, 0.26),
    backgroundColor: withAlpha(colors.accentDashboard, 0.08),
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
    flex: 1,
    minHeight: 42,
    borderRadius: radii.pill,
    backgroundColor: colors.accentDashboard,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  menuPrimaryButtonText: {
    color: colors.onAccent,
    fontWeight: '800',
  },
  });
