import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { tx } from '@instantdb/react-native';
import { ScreenScaffold } from '../../src/components/ScreenScaffold';
import { AttachmentPreviewModal } from '../../src/components/AttachmentPreviewModal';
import { useAppSession } from '../../src/providers/AppProviders';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { radii, shadows, spacing, withAlpha } from '../../src/theme/tokens';
import { db } from '../../src/lib/instant-db';
import {
  acknowledgeMobileMessage,
  bootstrapMobileMessages,
  createMobileMessageThread,
  editMobileMessage,
  getMobileMessageServerTime,
  joinMobileThreadWatch,
  leaveMobileThreadWatch,
  markMobileThreadRead,
  removeMobileMessage,
  sendMobileMessage,
  toggleMobileReaction,
  updateMobileThreadPreferences,
} from '../../src/lib/api-client';
import { createMessageServerTimeAnchor, getMessageServerNowMs, getMonotonicNowMs } from '../../../lib/message-server-time';
import {
  captureCameraImage,
  captureCameraVideo,
  pickAttachmentDocuments,
  pickLibraryMedia,
  uploadPendingAttachments,
} from '../../src/lib/attachments';

function formatMessageTime(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getAuthorName(message, familyMemberNamesById) {
  const author = Array.isArray(message.author) ? message.author[0] : message.author;
  if (author?.name) return author.name;
  if (message.authorFamilyMemberId) return familyMemberNamesById.get(message.authorFamilyMemberId) || 'Unknown';
  return 'Unknown';
}

function getReplyTo(replyTo) {
  if (!replyTo) return null;
  return Array.isArray(replyTo) ? replyTo[0] || null : replyTo;
}

function getReplyPreviewText(message) {
  if (message?.deletedAt) {
    return message.removedReason || 'Original message removed';
  }
  const body = String(message?.body || '').trim();
  if (body) return body;
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  if (attachments.length === 1) {
    return `Attachment: ${attachments[0]?.name || 'Attachment'}`;
  }
  if (attachments.length > 1) {
    return `${attachments.length} attachments`;
  }
  return 'Message';
}

function getDraftKey(threadId) {
  return threadId ? `familyOrganizer.messageDraft.${threadId}` : '';
}

export default function MessagesTab() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { currentUser, isAuthenticated, instantReady } = useAppSession();
  const [selectedThreadId, setSelectedThreadId] = useState(null);
  const [threadSearch, setThreadSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [composerBody, setComposerBody] = useState('');
  const [composerImportance, setComposerImportance] = useState('normal');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [replyToMessageId, setReplyToMessageId] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingBody, setEditingBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isOverseeMode, setIsOverseeMode] = useState(false);
  const [showNotificationPrefs, setShowNotificationPrefs] = useState(false);
  const [creationMode, setCreationMode] = useState(null);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState([]);
  const [newThreadTitle, setNewThreadTitle] = useState('');
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [optimisticThreadsById, setOptimisticThreadsById] = useState({});
  const [relativeNowMs, setRelativeNowMs] = useState(() => getMonotonicNowMs());
  const [serverNowAnchor, setServerNowAnchor] = useState(null);

  const membershipsQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          messageThreadMembers: {
          },
        }
      : null
  );

  const threadsQuery = db.useQuery(
    isAuthenticated && instantReady && currentUser?.role === 'parent' && isOverseeMode
      ? {
          messageThreads: {
            $: {
              order: {
                latestMessageAt: 'desc',
              },
            },
          },
        }
      : null
  );

  const visibleThreadsQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          messageThreads: {
          },
        }
      : null
  );

  const messagesQuery = db.useQuery(
    isAuthenticated && instantReady && selectedThreadId
      ? {
          messages: {
            $: {
              where: {
                threadId: selectedThreadId,
              },
              order: {
                createdAt: 'asc',
              },
            },
            attachments: {},
            author: {},
            replyTo: {
              author: {},
              attachments: {},
            },
          },
        }
      : null
  );

  const familyMembersQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          familyMembers: {
            $: {
              order: {
                order: 'asc',
              },
            },
          },
        }
      : null
  );

  const familyMembers = useMemo(() => familyMembersQuery.data?.familyMembers || [], [familyMembersQuery.data?.familyMembers]);
  const familyMemberNamesById = useMemo(() => new Map(familyMembers.map((member) => [member.id, member.name || 'Unknown'])), [familyMembers]);
  const membershipRows = useMemo(() => membershipsQuery.data?.messageThreadMembers || [], [membershipsQuery.data?.messageThreadMembers]);
  const overseenThreads = useMemo(() => threadsQuery.data?.messageThreads || [], [threadsQuery.data?.messageThreads]);
  const visibleThreads = useMemo(() => visibleThreadsQuery.data?.messageThreads || [], [visibleThreadsQuery.data?.messageThreads]);

  const threads = useMemo(() => {
    const map = new Map();
    const membershipMap = new Map();

    membershipRows.forEach((membership) => {
      if (!membership?.threadId) return;
      membershipMap.set(membership.threadId, membership);
    });

    visibleThreads.forEach((thread) => {
      map.set(thread.id, {
        ...thread,
        membership: membershipMap.get(thread.id) || map.get(thread.id)?.membership || null,
      });
    });

    if (currentUser?.role === 'parent' && isOverseeMode) {
      overseenThreads.forEach((thread) => {
        map.set(thread.id, {
          ...thread,
          membership: membershipMap.get(thread.id) || null,
        });
      });
    }

    Object.values(optimisticThreadsById).forEach((thread) => {
      if (!thread?.id) return;
      map.set(thread.id, {
        ...thread,
        membership: membershipMap.get(thread.id) || thread.membership || null,
      });
    });

    return Array.from(map.values())
      .filter((thread) => {
        if (thread.membership?.isArchived) return false;
        if (currentUser?.role === 'parent' && !isOverseeMode && !thread.membership && !optimisticThreadsById[thread.id]) {
          return false;
        }
        const query = threadSearch.trim().toLowerCase();
        if (!query) return true;
        const haystack = [
          thread.title || '',
          thread.latestMessagePreview || '',
          ...(thread.members || []).map((membership) => {
            const member = Array.isArray(membership.familyMember) ? membership.familyMember[0] : membership.familyMember;
            return member?.name || '';
          }),
        ]
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
      .sort((left, right) => {
        const leftPinned = left.membership?.isPinned ? 1 : 0;
        const rightPinned = right.membership?.isPinned ? 1 : 0;
        if (leftPinned !== rightPinned) return rightPinned - leftPinned;
        const leftTime = left.latestMessageAt ? new Date(left.latestMessageAt).getTime() : 0;
        const rightTime = right.latestMessageAt ? new Date(right.latestMessageAt).getTime() : 0;
        return rightTime - leftTime;
      });
  }, [currentUser?.role, isOverseeMode, membershipRows, optimisticThreadsById, overseenThreads, threadSearch, visibleThreads]);

  const selectedThread = useMemo(() => threads.find((thread) => thread.id === selectedThreadId) || null, [selectedThreadId, threads]);
  const selectedMembership = selectedThread?.membership || null;
  const messages = useMemo(() => {
    const rows = messagesQuery.data?.messages || [];
    const query = messageSearch.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((message) => `${message.body || ''} ${getAuthorName(message, familyMemberNamesById)}`.toLowerCase().includes(query));
  }, [familyMemberNamesById, messageSearch, messagesQuery.data?.messages]);
  const availableParticipants = useMemo(() => familyMembers.filter((member) => member.id !== currentUser?.id), [currentUser?.id, familyMembers]);
  const replyTarget = useMemo(() => messages.find((message) => message.id === replyToMessageId) || null, [messages, replyToMessageId]);
  const threadRoom = useMemo(() => db.room('messageThreads', selectedThreadId || '_idle'), [selectedThreadId]);
  const threadPresence = db.rooms.usePresence(threadRoom, {
    initialPresence: {
      activeThread: Boolean(selectedThreadId),
      avatarUrl: currentUser?.photoUrls?.['64'] || currentUser?.photoUrls?.['320'] || '',
      composer: false,
      familyMemberId: currentUser?.id || '_idle',
      name: currentUser?.name || 'Guest',
    },
    keys: ['activeThread', 'composer', 'familyMemberId', 'name'],
  });
  db.rooms.useSyncPresence(
    threadRoom,
    {
      activeThread: Boolean(selectedThreadId),
      avatarUrl: currentUser?.photoUrls?.['64'] || currentUser?.photoUrls?.['320'] || '',
      familyMemberId: currentUser?.id || '_idle',
      name: currentUser?.name || 'Guest',
    },
    [currentUser?.id, currentUser?.name, currentUser?.photoUrls?.['64'], selectedThreadId]
  );
  const typingIndicator = db.rooms.useTypingIndicator(threadRoom, 'composer', {
    timeout: 1500,
    stopOnEnter: false,
  });
  const typingPeers = useMemo(
    () => (typingIndicator.active || []).filter((peer) => peer?.familyMemberId && peer.familyMemberId !== currentUser?.id),
    [currentUser?.id, typingIndicator.active]
  );
  const presentPeers = useMemo(
    () => Object.values(threadPresence.peers || {}).filter((peer) => peer?.familyMemberId && peer.familyMemberId !== currentUser?.id),
    [currentUser?.id, threadPresence.peers]
  );
  const referenceNowMs = useMemo(() => getMessageServerNowMs(serverNowAnchor, relativeNowMs), [relativeNowMs, serverNowAnchor]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void bootstrapMobileMessages().catch((error) => {
      console.error('Unable to bootstrap mobile messages', error);
    });
  }, [isAuthenticated]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      setRelativeNowMs(getMonotonicNowMs());
    }, 15_000);

    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!currentUser?.id) {
      setServerNowAnchor(null);
      return;
    }

    let cancelled = false;

    async function syncServerNow() {
      try {
        const response = await getMobileMessageServerTime();
        const nextAnchor = createMessageServerTimeAnchor(response?.serverNow);
        if (!cancelled && nextAnchor) {
          setServerNowAnchor(nextAnchor);
        }
      } catch (error) {
        console.error('Unable to sync mobile message server time', error);
      }
    }

    void syncServerNow();
    const intervalId = setInterval(() => {
      void syncServerNow();
    }, 5 * 60 * 1000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [selectedThreadId, threads]);

  useEffect(() => {
    const draftKey = getDraftKey(selectedThreadId);
    if (!draftKey) {
      setComposerBody('');
      return;
    }
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    void AsyncStorage.getItem(draftKey).then((value) => {
      setComposerBody(value || '');
    });
    setPendingFiles([]);
    setReplyToMessageId(null);
    setEditingMessageId(null);
    setEditingBody('');
    setComposerImportance('normal');
  }, [selectedThreadId]);

  useEffect(() => {
    const draftKey = getDraftKey(selectedThreadId);
    if (!draftKey) return;
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    if (!composerBody.trim()) {
      void AsyncStorage.removeItem(draftKey);
      return;
    }
    void AsyncStorage.setItem(draftKey, composerBody);
  }, [composerBody, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !messages.length || !selectedMembership) return;
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage?.id) return;
    void markMobileThreadRead(selectedThreadId, lastMessage.id).catch((error) => {
      console.error('Unable to mark mobile thread as read', error);
    });
  }, [messages, selectedMembership, selectedThreadId]);

  async function handleCreateThread() {
    if (!creationMode) return;
    try {
      const payload = {
        threadType: creationMode,
        participantIds: creationMode === 'direct' ? selectedParticipantIds.slice(0, 1) : selectedParticipantIds,
        title: creationMode === 'group' ? newThreadTitle : undefined,
      };
      const result = await createMobileMessageThread(payload);
      const threadId = result?.thread?.id;
      if (threadId) {
        setOptimisticThreadsById((current) => ({
          ...current,
          [threadId]: result.thread,
        }));
        setSelectedThreadId(threadId);
      }
      setCreationMode(null);
      setSelectedParticipantIds([]);
      setNewThreadTitle('');
    } catch (error) {
      Alert.alert('Unable to create thread', error?.message || 'Please try again.');
    }
  }

  async function handleSendMessage() {
    if (!selectedThreadId) return;
    if (!composerBody.trim() && pendingFiles.length === 0) return;

    setIsSending(true);
    try {
      const attachments = pendingFiles.length ? await uploadPendingAttachments(pendingFiles, () => `${Date.now()}-${Math.random()}`) : [];
      await sendMobileMessage({
        threadId: selectedThreadId,
        body: composerBody,
        attachments,
        replyToMessageId,
        importance: composerImportance,
        clientNonce: `${currentUser?.id || 'member'}:${Date.now()}`,
      });
      setComposerBody('');
      setPendingFiles([]);
      setReplyToMessageId(null);
      setComposerImportance('normal');
      typingIndicator.setActive(false);
    } catch (error) {
      Alert.alert('Unable to send message', error?.message || 'Please try again.');
    } finally {
      setIsSending(false);
    }
  }

  async function saveNotificationPrefs(patch) {
    if (!currentUser?.id) return;
    try {
      await db.transact([tx.familyMembers[currentUser.id].update(patch)]);
    } catch (error) {
      Alert.alert('Unable to save notification preferences', error?.message || 'Please try again.');
    }
  }

  const statusChips = [
    { label: currentUser?.role === 'parent' ? 'Parent mode' : 'Kid mode', tone: currentUser?.role === 'parent' ? 'accent' : 'neutral' },
    { label: isOverseeMode ? 'Oversee' : 'Inbox', tone: isOverseeMode ? 'accent' : 'neutral' },
  ];

  return (
    <ScreenScaffold
      title={selectedThread ? selectedThread.title || 'Messages' : 'Messages'}
      subtitle={selectedThread ? 'Family inbox with direct messages, group threads, and parent oversight.' : 'Family inbox with direct messages and group threads.'}
      accent={colors.accentDashboard}
      statusChips={statusChips}
      headerMode="compact"
      headerAction={
        <View style={styles.headerActions}>
          <Pressable style={styles.headerChip} onPress={() => setShowNotificationPrefs(true)}>
            <Text style={styles.headerChipText}>Notify</Text>
          </Pressable>
          {currentUser?.role === 'parent' ? (
            <Pressable style={[styles.headerChip, isOverseeMode && styles.headerChipActive]} onPress={() => setIsOverseeMode((value) => !value)}>
              <Text style={[styles.headerChipText, isOverseeMode && styles.headerChipTextActive]}>{isOverseeMode ? 'Oversee' : 'Inbox'}</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.headerChip} onPress={() => setCreationMode('direct')}>
            <Text style={styles.headerChipText}>New</Text>
          </Pressable>
        </View>
      }
    >
      {!selectedThread ? (
        <View style={styles.listPane}>
          <TextInput
            value={threadSearch}
            onChangeText={setThreadSearch}
            placeholder="Search threads"
            placeholderTextColor={withAlpha(colors.inkMuted, 0.7)}
            style={styles.searchInput}
          />

          {creationMode ? (
            <View style={styles.composeCard}>
              <Text style={styles.composeTitle}>{creationMode === 'direct' ? 'Start a direct message' : 'Create a group thread'}</Text>
              {creationMode === 'group' ? (
                <TextInput
                  value={newThreadTitle}
                  onChangeText={setNewThreadTitle}
                  placeholder="Group title"
                  placeholderTextColor={withAlpha(colors.inkMuted, 0.7)}
                  style={styles.searchInput}
                />
              ) : null}
              <ScrollView style={styles.memberPicker} contentContainerStyle={styles.memberPickerContent}>
                {availableParticipants.map((member) => {
                  const checked = selectedParticipantIds.includes(member.id);
                  return (
                    <Pressable
                      key={member.id}
                      style={[styles.memberRow, checked && styles.memberRowActive]}
                      onPress={() => {
                        if (creationMode === 'direct') {
                          setSelectedParticipantIds([member.id]);
                          return;
                        }
                        setSelectedParticipantIds((current) =>
                          current.includes(member.id)
                            ? current.filter((entry) => entry !== member.id)
                            : [...current, member.id]
                        );
                      }}
                    >
                      <Text style={[styles.memberRowText, checked && styles.memberRowTextActive]}>{member.name}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.actionRow}>
                <Pressable style={styles.ghostButton} onPress={() => {
                  setCreationMode(null);
                  setSelectedParticipantIds([]);
                  setNewThreadTitle('');
                }}>
                  <Text style={styles.ghostButtonText}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.primaryButton} onPress={handleCreateThread}>
                  <Text style={styles.primaryButtonText}>Create</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.quickRow}>
                  <Pressable style={styles.quickButton} onPress={() => setSelectedThreadId('00000000-0000-4000-8000-000000000001')}>
                    <Text style={styles.quickButtonText}>Family</Text>
                  </Pressable>
                  {currentUser?.role === 'parent' ? (
                    <Pressable style={styles.quickButton} onPress={() => setSelectedThreadId('00000000-0000-4000-8000-000000000002')}>
                  <Text style={styles.quickButtonText}>Parents</Text>
                </Pressable>
              ) : null}
              <Pressable style={styles.quickButton} onPress={() => setCreationMode('group')}>
                <Text style={styles.quickButtonText}>Group</Text>
              </Pressable>
            </View>
          )}

          <ScrollView contentContainerStyle={styles.threadList}>
            {threads.map((thread) => {
              const unread =
                thread.latestMessageAt &&
                (!thread.membership?.lastReadAt || new Date(thread.latestMessageAt).getTime() > new Date(thread.membership.lastReadAt).getTime());
              return (
                <Pressable key={thread.id} style={styles.threadCard} onPress={() => setSelectedThreadId(thread.id)}>
                  <View style={styles.threadHeader}>
                    <Text style={styles.threadTitle} numberOfLines={1}>{thread.title || 'Untitled thread'}</Text>
                    {unread ? <View style={styles.unreadDot} /> : null}
                  </View>
                  <Text style={styles.threadPreview} numberOfLines={2}>
                    {thread.latestMessagePreview || (thread.threadType === 'parents_only' ? 'Parents only' : 'No messages yet')}
                  </Text>
                  <Text style={styles.threadMeta}>{formatMessageTime(thread.latestMessageAt)}</Text>
                </Pressable>
              );
            })}

            {!threads.length && membershipsQuery.isLoading ? (
              <View style={styles.centerCard}>
                <ActivityIndicator size="small" color={colors.accentDashboard} />
                <Text style={styles.centerText}>Loading threads…</Text>
              </View>
            ) : null}
          </ScrollView>
        </View>
      ) : (
        <View style={styles.threadPane}>
          <View style={styles.topBar}>
            <Pressable style={styles.ghostButton} onPress={() => setSelectedThreadId(null)}>
              <Text style={styles.ghostButtonText}>Back</Text>
            </Pressable>
            <View style={styles.topBarActions}>
              {currentUser?.role === 'parent' && isOverseeMode && !selectedMembership ? (
                <Pressable style={styles.quickButton} onPress={async () => {
                  try {
                    await joinMobileThreadWatch(selectedThread.id);
                  } catch (error) {
                    Alert.alert('Unable to join thread', error?.message || 'Please try again.');
                  }
                }}>
                  <Text style={styles.quickButtonText}>Join</Text>
                </Pressable>
              ) : null}
              {selectedMembership?.memberRole === 'watcher' ? (
                <Pressable style={styles.quickButton} onPress={async () => {
                  try {
                    await leaveMobileThreadWatch(selectedThread.id);
                    setSelectedThreadId(null);
                  } catch (error) {
                    Alert.alert('Unable to leave watch mode', error?.message || 'Please try again.');
                  }
                }}>
                  <Text style={styles.quickButtonText}>Leave</Text>
                </Pressable>
              ) : null}
              {selectedMembership ? (
                <Pressable style={styles.quickButton} onPress={async () => {
                  try {
                    await updateMobileThreadPreferences(selectedThread.id, {
                      isPinned: !selectedMembership.isPinned,
                    });
                  } catch (error) {
                    Alert.alert('Unable to update thread', error?.message || 'Please try again.');
                  }
                }}>
                  <Text style={styles.quickButtonText}>{selectedMembership.isPinned ? 'Unpin' : 'Pin'}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          {presentPeers.length > 0 ? (
            <Text style={styles.presenceText}>Online now: {presentPeers.map((peer) => peer.name || 'Unknown').join(', ')}</Text>
          ) : null}
          {typingPeers.length > 0 ? (
            <Text style={styles.typingText}>
              {typingPeers.length === 1
                ? `${typingPeers[0].name} is typing...`
                : `${typingPeers[0].name} and ${typingPeers.length - 1} others are typing...`}
            </Text>
          ) : null}

          <TextInput
            value={messageSearch}
            onChangeText={setMessageSearch}
            placeholder="Search this thread"
            placeholderTextColor={withAlpha(colors.inkMuted, 0.7)}
            style={styles.searchInput}
          />

          <ScrollView style={styles.messagesPane} contentContainerStyle={styles.messagesContent}>
            {messages.map((message) => {
              const isOwnMessage = currentUser?.id === message.authorFamilyMemberId;
              const editableUntilMs = message.editableUntil ? new Date(message.editableUntil).getTime() : 0;
              const canEdit = isOwnMessage && editableUntilMs > referenceNowMs && !message.deletedAt;
              const canDelete = (isOwnMessage && editableUntilMs > referenceNowMs) || currentUser?.role === 'parent';
              const isEditing = editingMessageId === message.id;
              const replyTo = getReplyTo(message.replyTo);
              return (
                <View key={message.id} style={[styles.messageBubble, isOwnMessage ? styles.messageBubbleOwn : styles.messageBubbleOther]}>
                  <View style={styles.messageMetaRow}>
                    <Text style={[styles.messageMetaText, isOwnMessage && styles.messageMetaTextOwn]}>{getAuthorName(message, familyMemberNamesById)}</Text>
                    <Text style={[styles.messageMetaText, isOwnMessage && styles.messageMetaTextOwn]}>{formatMessageTime(message.createdAt)}</Text>
                  </View>

                  {replyTo ? (
                    <View style={[styles.replyCard, isOwnMessage && styles.replyCardOwn]}>
                      <Text style={[styles.replyLabel, isOwnMessage && styles.replyLabelOwn]}>
                        Reply to {getAuthorName(replyTo, familyMemberNamesById)}
                      </Text>
                      <Text style={[styles.replyText, isOwnMessage && styles.replyTextOwn]} numberOfLines={2}>
                        {getReplyPreviewText(replyTo)}
                      </Text>
                    </View>
                  ) : null}

                  {isEditing ? (
                    <View style={styles.editWrap}>
                      <TextInput
                        value={editingBody}
                        onChangeText={setEditingBody}
                        multiline
                        style={styles.messageInput}
                      />
                      <View style={styles.actionRow}>
                        <Pressable style={styles.ghostButton} onPress={() => {
                          setEditingMessageId(null);
                          setEditingBody('');
                        }}>
                          <Text style={styles.ghostButtonText}>Cancel</Text>
                        </Pressable>
                        <Pressable style={styles.primaryButton} onPress={async () => {
                          try {
                            await editMobileMessage(message.id, { body: editingBody });
                            setEditingMessageId(null);
                            setEditingBody('');
                          } catch (error) {
                            Alert.alert('Unable to edit message', error?.message || 'Please try again.');
                          }
                        }}>
                          <Text style={styles.primaryButtonText}>Save</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : message.deletedAt ? (
                    <Text style={[styles.messageBody, styles.messageDeleted]}>{message.removedReason || 'Message removed'}</Text>
                  ) : (
                    <>
                      {message.body ? <Text style={[styles.messageBody, isOwnMessage && styles.messageBodyOwn]}>{message.body}</Text> : null}
                      {(message.attachments || []).map((attachment) => (
                        <Pressable key={attachment.id} style={styles.attachmentPill} onPress={() => setAttachmentPreview(attachment)}>
                          <Text style={styles.attachmentPillText}>{attachment.name}</Text>
                        </Pressable>
                      ))}
                    </>
                  )}

                  <View style={styles.reactionsRow}>
                    {['👍', '❤️', '😂'].map((emoji) => (
                      <Pressable
                        key={`${message.id}-${emoji}`}
                        style={styles.reactionButton}
                        onPress={() => {
                          void toggleMobileReaction(message.id, emoji).catch((error) => {
                            Alert.alert('Unable to react', error?.message || 'Please try again.');
                          });
                        }}
                      >
                        <Text style={styles.reactionButtonText}>
                          {emoji} {(message.reactions || []).filter((reaction) => reaction.emoji === emoji).length || ''}
                        </Text>
                      </Pressable>
                    ))}
                    <View style={styles.reactionsSpacer} />
                    <Pressable style={styles.inlineAction} onPress={() => setReplyToMessageId(message.id)}>
                      <Text style={styles.inlineActionText}>Reply</Text>
                    </Pressable>
                    {canEdit ? (
                      <Pressable style={styles.inlineAction} onPress={() => {
                        setEditingMessageId(message.id);
                        setEditingBody(message.body || '');
                      }}>
                        <Text style={styles.inlineActionText}>Edit</Text>
                      </Pressable>
                    ) : null}
                    {canDelete ? (
                      <Pressable style={styles.inlineAction} onPress={() => {
                        void removeMobileMessage(message.id).catch((error) => {
                          Alert.alert('Unable to remove message', error?.message || 'Please try again.');
                        });
                      }}>
                        <Text style={styles.inlineActionText}>Remove</Text>
                      </Pressable>
                    ) : null}
                    {message.importance === 'needs_ack' ? (
                      <Pressable style={styles.inlineAction} onPress={() => {
                        void acknowledgeMobileMessage(message.id, 'acknowledged').catch((error) => {
                          Alert.alert('Unable to acknowledge', error?.message || 'Please try again.');
                        });
                      }}>
                        <Text style={styles.inlineActionText}>
                          {message.acknowledgements?.length ? `${message.acknowledgements.length} ack` : 'Acknowledge'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </ScrollView>

          {replyTarget ? (
            <View style={styles.replyBanner}>
              <View style={styles.replyBannerContent}>
                <Text style={styles.replyBannerLabel}>Replying to {getAuthorName(replyTarget, familyMemberNamesById)}</Text>
                <Text style={styles.replyBannerText} numberOfLines={2}>{getReplyPreviewText(replyTarget)}</Text>
              </View>
              <Pressable onPress={() => setReplyToMessageId(null)}>
                <Text style={styles.inlineActionText}>Clear</Text>
              </Pressable>
            </View>
          ) : null}

          {selectedMembership || !(currentUser?.role === 'parent' && isOverseeMode) ? (
            <View style={styles.composerCard}>
              {currentUser?.role === 'parent' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.importanceRow}>
                  {['normal', 'urgent', 'announcement', 'needs_ack'].map((importance) => (
                    <Pressable
                      key={importance}
                      style={[styles.quickButton, composerImportance === importance && styles.quickButtonActive]}
                      onPress={() => setComposerImportance(importance)}
                    >
                      <Text style={[styles.quickButtonText, composerImportance === importance && styles.quickButtonTextActive]}>{importance}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
              <TextInput
                value={composerBody}
                onChangeText={(value) => {
                  setComposerBody(value);
                  typingIndicator.setActive(Boolean(value));
                }}
                placeholder="Write a message"
                placeholderTextColor={withAlpha(colors.inkMuted, 0.7)}
                multiline
                onBlur={() => typingIndicator.setActive(false)}
                style={styles.composerInput}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pendingFilesRow}>
                {pendingFiles.map((file, index) => (
                  <Pressable key={`${file.name}-${index}`} style={styles.attachmentPill} onPress={() => setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}>
                    <Text style={styles.attachmentPillText}>{file.name} x</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.actionRow}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickersRow}>
                  <Pressable style={styles.quickButton} onPress={async () => {
                    try {
                      const files = await pickAttachmentDocuments();
                      setPendingFiles((current) => [...current, ...files]);
                    } catch (error) {
                      Alert.alert('Unable to add files', error?.message || 'Please try again.');
                    }
                  }}>
                    <Text style={styles.quickButtonText}>Docs</Text>
                  </Pressable>
                  <Pressable style={styles.quickButton} onPress={async () => {
                    try {
                      const files = await pickLibraryMedia();
                      setPendingFiles((current) => [...current, ...files]);
                    } catch (error) {
                      Alert.alert('Unable to open library', error?.message || 'Please try again.');
                    }
                  }}>
                    <Text style={styles.quickButtonText}>Library</Text>
                  </Pressable>
                  <Pressable style={styles.quickButton} onPress={async () => {
                    try {
                      const files = await captureCameraImage();
                      setPendingFiles((current) => [...current, ...files]);
                    } catch (error) {
                      Alert.alert('Unable to take photo', error?.message || 'Please try again.');
                    }
                  }}>
                    <Text style={styles.quickButtonText}>Photo</Text>
                  </Pressable>
                  <Pressable style={styles.quickButton} onPress={async () => {
                    try {
                      const files = await captureCameraVideo();
                      setPendingFiles((current) => [...current, ...files]);
                    } catch (error) {
                      Alert.alert('Unable to record video', error?.message || 'Please try again.');
                    }
                  }}>
                    <Text style={styles.quickButtonText}>Video</Text>
                  </Pressable>
                </ScrollView>
                <Pressable style={[styles.primaryButton, isSending && styles.primaryButtonDisabled]} onPress={handleSendMessage}>
                  <Text style={styles.primaryButtonText}>{isSending ? 'Sending...' : 'Send'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.noticeCard}>
              <Text style={styles.noticeText}>Join this thread to reply from oversee mode.</Text>
            </View>
          )}
        </View>
      )}

      <AttachmentPreviewModal attachment={attachmentPreview} visible={!!attachmentPreview} onClose={() => setAttachmentPreview(null)} />
      <Modal visible={showNotificationPrefs} transparent animationType="fade" onRequestClose={() => setShowNotificationPrefs(false)}>
        <View style={styles.modalOverlay}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setShowNotificationPrefs(false)} />
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Notification preferences</Text>
            <View style={styles.modalRow}>
              <Text style={styles.modalLabel}>Quiet hours</Text>
              <Switch
                value={Boolean(currentUser?.messageQuietHoursEnabled)}
                onValueChange={(value) => {
                  void saveNotificationPrefs({ messageQuietHoursEnabled: value });
                }}
              />
            </View>
            <View style={styles.modalSplitRow}>
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>Start</Text>
                <TextInput
                  value={currentUser?.messageQuietHoursStart || '22:00'}
                  onChangeText={(value) => {
                    void saveNotificationPrefs({ messageQuietHoursStart: value });
                  }}
                  placeholder="22:00"
                  placeholderTextColor={withAlpha(colors.inkMuted, 0.7)}
                  style={styles.modalInput}
                />
              </View>
              <View style={styles.modalField}>
                <Text style={styles.modalFieldLabel}>End</Text>
                <TextInput
                  value={currentUser?.messageQuietHoursEnd || '07:00'}
                  onChangeText={(value) => {
                    void saveNotificationPrefs({ messageQuietHoursEnd: value });
                  }}
                  placeholder="07:00"
                  placeholderTextColor={withAlpha(colors.inkMuted, 0.7)}
                  style={styles.modalInput}
                />
              </View>
            </View>
            <Text style={styles.modalFieldLabel}>Delivery</Text>
            <View style={styles.quickRow}>
              {['immediate', 'digest'].map((mode) => (
                <Pressable
                  key={mode}
                  style={[styles.quickButton, (currentUser?.messageDigestMode || 'immediate') === mode && styles.quickButtonActive]}
                  onPress={() => {
                    void saveNotificationPrefs({ messageDigestMode: mode });
                  }}
                >
                  <Text style={[styles.quickButtonText, (currentUser?.messageDigestMode || 'immediate') === mode && styles.quickButtonTextActive]}>{mode}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.modalFieldLabel}>Digest every (minutes)</Text>
            <TextInput
              value={String(currentUser?.messageDigestWindowMinutes ?? 30)}
              keyboardType="number-pad"
              onChangeText={(value) => {
                void saveNotificationPrefs({ messageDigestWindowMinutes: Number(value || 30) });
              }}
              placeholder="30"
              placeholderTextColor={withAlpha(colors.inkMuted, 0.7)}
              style={styles.modalInput}
            />
            <Pressable style={[styles.primaryButton, { alignSelf: 'flex-end' }]} onPress={() => setShowNotificationPrefs(false)}>
              <Text style={styles.primaryButtonText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScreenScaffold>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    listPane: {
      flex: 1,
      gap: spacing.md,
    },
    searchInput: {
      minHeight: 46,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      color: colors.ink,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    quickRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    quickButton: {
      minHeight: 36,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickButtonText: {
      color: colors.ink,
      fontWeight: '700',
    },
    quickButtonActive: {
      borderColor: withAlpha(colors.accentDashboard, 0.24),
      backgroundColor: withAlpha(colors.accentDashboard, 0.12),
    },
    quickButtonTextActive: {
      color: colors.accentDashboard,
    },
    threadList: {
      gap: spacing.sm,
      paddingBottom: spacing.xxl,
    },
    threadCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      padding: spacing.md,
      gap: spacing.xs,
      ...shadows.card,
    },
    threadHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    threadTitle: {
      flex: 1,
      color: colors.ink,
      fontWeight: '800',
      fontSize: 16,
    },
    threadPreview: {
      color: colors.inkMuted,
      lineHeight: 18,
      fontSize: 13,
    },
    threadMeta: {
      color: colors.inkMuted,
      fontSize: 12,
    },
    unreadDot: {
      width: 10,
      height: 10,
      borderRadius: 999,
      backgroundColor: colors.accentDashboard,
    },
    centerCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      padding: spacing.lg,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    centerText: {
      color: colors.inkMuted,
    },
    composeCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      padding: spacing.md,
      gap: spacing.sm,
    },
    composeTitle: {
      color: colors.ink,
      fontWeight: '800',
      fontSize: 15,
    },
    memberPicker: {
      maxHeight: 180,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
    },
    memberPickerContent: {
      padding: spacing.sm,
      gap: spacing.xs,
    },
    memberRow: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    memberRowActive: {
      borderColor: colors.accentDashboard,
      backgroundColor: withAlpha(colors.accentDashboard, 0.12),
    },
    memberRowText: {
      color: colors.ink,
    },
    memberRowTextActive: {
      color: colors.accentDashboard,
      fontWeight: '700',
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    primaryButton: {
      minHeight: 40,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      backgroundColor: colors.accentDashboard,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonDisabled: {
      opacity: 0.6,
    },
    primaryButtonText: {
      color: colors.onAccent,
      fontWeight: '800',
    },
    ghostButton: {
      minHeight: 38,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ghostButtonText: {
      color: colors.ink,
      fontWeight: '700',
    },
    threadPane: {
      flex: 1,
      gap: spacing.md,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    topBarActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    messagesPane: {
      flex: 1,
    },
    messagesContent: {
      gap: spacing.sm,
      paddingBottom: spacing.lg,
    },
    messageBubble: {
      borderRadius: radii.md,
      borderWidth: 1,
      padding: spacing.md,
      gap: spacing.sm,
      maxWidth: '92%',
    },
    messageBubbleOwn: {
      alignSelf: 'flex-end',
      borderColor: withAlpha(colors.accentDashboard, 0.25),
      backgroundColor: colors.accentDashboard,
    },
    messageBubbleOther: {
      alignSelf: 'flex-start',
      borderColor: colors.line,
      backgroundColor: colors.panel,
    },
    messageMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    messageMetaText: {
      color: colors.inkMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    messageMetaTextOwn: {
      color: withAlpha(colors.onAccent, 0.82),
    },
    messageBody: {
      color: colors.ink,
      lineHeight: 20,
      fontSize: 14,
    },
    messageBodyOwn: {
      color: colors.onAccent,
    },
    messageDeleted: {
      fontStyle: 'italic',
      color: colors.inkMuted,
    },
    replyCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      padding: spacing.sm,
    },
    replyCardOwn: {
      borderColor: withAlpha(colors.onAccent, 0.22),
      backgroundColor: withAlpha(colors.onAccent, 0.12),
    },
    replyText: {
      color: colors.inkMuted,
      fontSize: 12,
      lineHeight: 16,
    },
    replyLabel: {
      color: colors.accentDashboard,
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginBottom: 4,
    },
    replyLabelOwn: {
      color: withAlpha(colors.onAccent, 0.78),
    },
    replyTextOwn: {
      color: withAlpha(colors.onAccent, 0.84),
    },
    reactionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    reactionButton: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    reactionButtonText: {
      color: colors.ink,
      fontSize: 12,
      fontWeight: '700',
    },
    reactionsSpacer: {
      flex: 1,
    },
    inlineAction: {
      paddingHorizontal: 6,
      paddingVertical: 4,
    },
    inlineActionText: {
      color: colors.inkMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    replyBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.md,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    replyBannerContent: {
      flex: 1,
      gap: 2,
    },
    replyBannerLabel: {
      color: colors.accentDashboard,
      fontWeight: '800',
      fontSize: 12,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
    },
    replyBannerText: {
      color: colors.inkMuted,
      fontWeight: '600',
      flex: 1,
      lineHeight: 18,
    },
    composerCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      padding: spacing.md,
      gap: spacing.sm,
      ...shadows.card,
    },
    composerInput: {
      minHeight: 96,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      color: colors.ink,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      textAlignVertical: 'top',
    },
    pendingFilesRow: {
      gap: spacing.xs,
    },
    attachmentPill: {
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    attachmentPillText: {
      color: colors.ink,
      fontSize: 12,
      fontWeight: '700',
    },
    pickersRow: {
      gap: spacing.xs,
      flexGrow: 1,
    },
    importanceRow: {
      gap: spacing.xs,
    },
    noticeCard: {
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: withAlpha(colors.warning, 0.24),
      backgroundColor: withAlpha(colors.warning, 0.1),
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    noticeText: {
      color: colors.warning,
      fontWeight: '700',
    },
    presenceText: {
      color: colors.success,
      fontSize: 12,
      fontWeight: '700',
    },
    typingText: {
      color: colors.accentDashboard,
      fontSize: 13,
      fontWeight: '700',
    },
    headerActions: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    headerChip: {
      minHeight: 34,
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerChipActive: {
      borderColor: withAlpha(colors.accentDashboard, 0.24),
      backgroundColor: withAlpha(colors.accentDashboard, 0.12),
    },
    headerChipText: {
      color: colors.ink,
      fontWeight: '700',
      fontSize: 12,
    },
    headerChipTextActive: {
      color: colors.accentDashboard,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: 'rgba(10, 16, 24, 0.64)',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    modalCard: {
      borderRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panel,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    modalTitle: {
      color: colors.ink,
      fontSize: 18,
      fontWeight: '800',
    },
    modalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    modalLabel: {
      color: colors.ink,
      fontWeight: '700',
      fontSize: 14,
    },
    modalSplitRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    modalField: {
      flex: 1,
      gap: spacing.xs,
    },
    modalFieldLabel: {
      color: colors.inkMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    modalInput: {
      minHeight: 42,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      color: colors.ink,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    editWrap: {
      gap: spacing.sm,
    },
    messageInput: {
      minHeight: 88,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.panelElevated,
      color: colors.ink,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      textAlignVertical: 'top',
    },
  });
