'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { id, tx } from '@instantdb/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, MessageSquarePlus, Search, Shield, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/ui/use-toast';
import { AttachmentCollection } from '@/components/attachments/AttachmentCollection';
import { useAuth } from '@/components/AuthProvider';
import { db } from '@/lib/db';
import { uploadFilesToS3 } from '@/lib/file-uploads';
import { acknowledge, bootstrapMessages, createThread, editMessage, joinThreadWatch, leaveThreadWatch, markRead, removeMessage, sendMessage, toggleReaction, updateThreadPreferences } from '@/lib/message-client';
import { cn } from '@/lib/utils';
import type { MessageNotificationLevel } from '@/lib/messaging-types';

type MembershipRow = {
    id: string;
    familyMemberId?: string | null;
    memberRole?: string | null;
    notificationLevel?: MessageNotificationLevel | null;
    isArchived?: boolean | null;
    isPinned?: boolean | null;
    lastReadAt?: string | null;
    threadId?: string | null;
    thread?: any;
};

type ThreadRecord = {
    id: string;
    title?: string | null;
    threadType?: string | null;
    visibility?: string | null;
    latestMessageAt?: string | null;
    latestMessagePreview?: string | null;
    latestMessageAuthorId?: string | null;
    members?: Array<any>;
    membership?: MembershipRow | null;
};

type MessageRecord = {
    id: string;
    body?: string | null;
    deletedAt?: string | null;
    removedReason?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    editedAt?: string | null;
    editableUntil?: string | null;
    importance?: string | null;
    authorFamilyMemberId?: string | null;
    attachments?: Array<any>;
    author?: Array<{ id?: string; name?: string | null }> | { id?: string; name?: string | null } | null;
    reactions?: Array<{ id: string; emoji?: string | null; familyMember?: Array<{ id?: string; name?: string | null }> | { id?: string; name?: string | null } | null }>;
    acknowledgements?: Array<{ id: string; kind?: string | null; familyMember?: Array<{ id?: string; name?: string | null }> | { id?: string; name?: string | null } | null }>;
    replyTo?: Array<MessageRecord> | MessageRecord | null;
};

function formatMessageTime(value?: string | null) {
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

function getNestedMemberName(member: any) {
    if (Array.isArray(member) && member[0]?.name) return member[0].name || 'Unknown';
    if (member && !Array.isArray(member) && member.name) return member.name || 'Unknown';
    return 'Unknown';
}

function getAuthorName(message: MessageRecord, familyMemberNamesById: Map<string, string>) {
    if (Array.isArray(message.author) && message.author[0]?.name) {
        return message.author[0].name || 'Unknown';
    }
    if (message.author && !Array.isArray(message.author) && message.author.name) {
        return message.author.name || 'Unknown';
    }
    if (message.authorFamilyMemberId) {
        return familyMemberNamesById.get(message.authorFamilyMemberId) || 'Unknown';
    }
    return 'Unknown';
}

function getReplyToMessage(replyTo: MessageRecord['replyTo']) {
    if (!replyTo) return null;
    if (Array.isArray(replyTo)) return replyTo[0] || null;
    return replyTo || null;
}

function isThreadUnread(thread: ThreadRecord) {
    const latest = thread.latestMessageAt ? new Date(thread.latestMessageAt).getTime() : 0;
    const readAt = thread.membership?.lastReadAt ? new Date(thread.membership.lastReadAt).getTime() : 0;
    return latest > readAt;
}

function threadSubtitle(thread: ThreadRecord, familyMemberNamesById: Map<string, string>, currentUserId: string) {
    if (thread.threadType === 'direct' && Array.isArray(thread.members) && thread.members.length > 0) {
        const peers = (thread.members || [])
            .map((membership: any) => membership?.familyMember?.[0] || membership?.familyMember || null)
            .filter(Boolean)
            .filter((member: any) => member.id !== currentUserId)
            .map((member: any) => member.name || familyMemberNamesById.get(member.id) || 'Unknown');
        if (peers.length > 0 && peers.some((name) => name !== 'Unknown')) {
            return peers.join(', ');
        }
        return thread.latestMessagePreview || 'Direct message';
    }

    return thread.latestMessagePreview || (thread.threadType === 'parents_only' ? 'Parents only' : 'No messages yet');
}

function sortThreads(threads: ThreadRecord[]) {
    return threads.slice().sort((left, right) => {
        const leftPinned = left.membership?.isPinned ? 1 : 0;
        const rightPinned = right.membership?.isPinned ? 1 : 0;
        if (leftPinned !== rightPinned) return rightPinned - leftPinned;
        const leftTime = left.latestMessageAt ? new Date(left.latestMessageAt).getTime() : 0;
        const rightTime = right.latestMessageAt ? new Date(right.latestMessageAt).getTime() : 0;
        return rightTime - leftTime;
    });
}

function DraftKey(threadId: string | null) {
    return threadId ? `family-organizer.message-draft:${threadId}` : '';
}

export default function FamilyMessagesPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { toast } = useToast();
    const { currentUser } = useAuth();
    const [threadSearch, setThreadSearch] = useState('');
    const [messageSearch, setMessageSearch] = useState('');
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
    const [composerBody, setComposerBody] = useState('');
    const [composerImportance, setComposerImportance] = useState<'normal' | 'urgent' | 'announcement' | 'needs_ack'>('normal');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [replyToMessageId, setReplyToMessageId] = useState<string | null>(null);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editingBody, setEditingBody] = useState('');
    const [isOverseeMode, setIsOverseeMode] = useState(false);
    const [creationMode, setCreationMode] = useState<'direct' | 'group' | null>(null);
    const [newThreadTitle, setNewThreadTitle] = useState('');
    const [selectedParticipantIds, setSelectedParticipantIds] = useState<string[]>([]);
    const [isCreatingThread, setIsCreatingThread] = useState(false);
    const [browserNotificationPermission, setBrowserNotificationPermission] = useState<string>('default');
    const initialThreadId = searchParams.get('threadId');
    const searchParamString = searchParams.toString();
    const [showNotificationPrefs, setShowNotificationPrefs] = useState(false);
    const [optimisticThreadsById, setOptimisticThreadsById] = useState<Record<string, ThreadRecord>>({});

    const membershipQuery = (db as any).useQuery(
        currentUser
            ? {
                  messageThreadMembers: {
                  },
              }
            : (null as any)
    ) as any;

    const overseenThreadsQuery = (db as any).useQuery(
        currentUser?.role === 'parent' && isOverseeMode
            ? {
                  messageThreads: {
                      $: {
                          order: {
                              latestMessageAt: 'desc',
                          },
                      },
                  },
              }
            : (null as any)
    ) as any;

    const visibleThreadsQuery = (db as any).useQuery(
        currentUser
            ? {
                  messageThreads: {
                  },
              }
            : (null as any)
    ) as any;

    const messagesQuery = (db as any).useQuery(
        currentUser && selectedThreadId
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
                  },
              }
            : (null as any)
    ) as any;

    const familyMembersQuery = (db as any).useQuery(
        currentUser
            ? {
                  familyMembers: {
                      $: {
                          order: {
                              order: 'asc',
                          },
                      },
                  },
              }
            : (null as any)
    ) as any;

    const familyMembers = useMemo(() => (familyMembersQuery?.data?.familyMembers as any[]) || [], [familyMembersQuery?.data?.familyMembers]);
    const familyMemberNamesById = useMemo(
        () => new Map(familyMembers.map((member: any) => [member.id, member.name || 'Unknown'])),
        [familyMembers]
    );

    const threads = useMemo(() => {
        const memberships = ((membershipQuery?.data?.messageThreadMembers as unknown) as MembershipRow[]) || [];
        const membershipMap = new Map<string, MembershipRow>();
        const threadsById = new Map<string, ThreadRecord>();

        for (const membership of memberships) {
            if (!membership?.threadId) continue;
            membershipMap.set(membership.threadId, membership);
        }

        const visibleThreads = (visibleThreadsQuery?.data?.messageThreads as ThreadRecord[]) || [];
        for (const thread of visibleThreads) {
            if (!thread?.id) continue;
            threadsById.set(thread.id, {
                ...thread,
                membership: membershipMap.get(thread.id) || threadsById.get(thread.id)?.membership || null,
            });
        }

        if (currentUser?.role === 'parent' && isOverseeMode) {
            const overseenThreads = (overseenThreadsQuery?.data?.messageThreads as ThreadRecord[]) || [];
            for (const thread of overseenThreads) {
                threadsById.set(thread.id, {
                    ...thread,
                    membership: membershipMap.get(thread.id) || null,
                });
            }
        }

        for (const thread of Object.values(optimisticThreadsById)) {
            if (!thread?.id) continue;
            threadsById.set(thread.id, {
                ...thread,
                membership: membershipMap.get(thread.id) || thread.membership || null,
            });
        }

        return sortThreads(Array.from(threadsById.values())).filter((thread) => {
            if (thread.membership?.isArchived) return false;
            if (currentUser?.role === 'parent' && !isOverseeMode && !thread.membership && !optimisticThreadsById[thread.id]) {
                return false;
            }
            const query = threadSearch.trim().toLowerCase();
            if (!query) return true;
            const haystack = [
                thread.title || '',
                thread.latestMessagePreview || '',
                ...(thread.members || []).map((membership: any) => membership?.familyMember?.[0]?.name || membership?.familyMember?.name || ''),
            ]
                .join(' ')
                .toLowerCase();
            return haystack.includes(query);
        });
    }, [
        currentUser?.role,
        isOverseeMode,
        membershipQuery?.data?.messageThreadMembers,
        optimisticThreadsById,
        overseenThreadsQuery?.data?.messageThreads,
        threadSearch,
        visibleThreadsQuery?.data?.messageThreads,
    ]);

    const selectedThread = useMemo(
        () => threads.find((thread) => thread.id === selectedThreadId) || null,
        [selectedThreadId, threads]
    );

    const messages = useMemo(() => {
        const rows = ((messagesQuery?.data?.messages as MessageRecord[]) || []).filter((message) => {
            const query = messageSearch.trim().toLowerCase();
            if (!query) return true;
            return `${message.body || ''} ${getAuthorName(message, familyMemberNamesById)}`.toLowerCase().includes(query);
        });
        return rows;
    }, [familyMemberNamesById, messageSearch, messagesQuery?.data?.messages]);

    const selectedThreadMembership = selectedThread?.membership || null;
    const canComposeInThread = Boolean(
        currentUser &&
            selectedThread &&
            (selectedThreadMembership || !(currentUser.role === 'parent' && isOverseeMode))
    );
    const threadRoom = useMemo(
        () => (db as any).room('messageThreads', selectedThreadId || '_idle'),
        [selectedThreadId]
    );
    const threadPresence = (db as any).rooms.usePresence(threadRoom, {
        initialPresence: {
            activeThread: Boolean(selectedThreadId),
            avatarUrl: currentUser?.photoUrls?.['64'] || currentUser?.photoUrls?.['320'] || '',
            composer: false,
            familyMemberId: currentUser?.id || '_idle',
            name: currentUser?.name || 'Guest',
        },
        keys: ['activeThread', 'composer', 'familyMemberId', 'name'],
    }) as any;
    (db as any).rooms.useSyncPresence(
        threadRoom,
        {
            activeThread: Boolean(selectedThreadId),
            avatarUrl: currentUser?.photoUrls?.['64'] || currentUser?.photoUrls?.['320'] || '',
            familyMemberId: currentUser?.id || '_idle',
            name: currentUser?.name || 'Guest',
        },
        [currentUser?.id, currentUser?.name, currentUser?.photoUrls?.['64'], selectedThreadId]
    );
    const typingIndicator = (db as any).rooms.useTypingIndicator(threadRoom, 'composer', {
        timeout: 1500,
        stopOnEnter: false,
    }) as any;
    const typingPeers = useMemo(
        () =>
            (typingIndicator?.active || []).filter((peer: any) => peer?.familyMemberId && peer.familyMemberId !== currentUser?.id),
        [currentUser?.id, typingIndicator?.active]
    );
    const presentPeers = useMemo(
        () =>
            Object.values(threadPresence?.peers || {}).filter(
                (peer: any) => peer?.familyMemberId && peer.familyMemberId !== currentUser?.id
            ),
        [currentUser?.id, threadPresence?.peers]
    );
    const replyTarget = useMemo(
        () => messages.find((message) => message.id === replyToMessageId) || null,
        [messages, replyToMessageId]
    );
    const activeMessagesError = selectedThreadId ? messagesQuery?.error : null;

    useEffect(() => {
        void bootstrapMessages().catch((error) => {
            console.error('Unable to bootstrap messages', error);
        });
    }, []);

    useEffect(() => {
        if (membershipQuery?.error) {
            console.error('[messages] membershipQuery error', membershipQuery.error);
        }
    }, [membershipQuery?.error]);

    useEffect(() => {
        if (visibleThreadsQuery?.error) {
            console.error('[messages] visibleThreadsQuery error', visibleThreadsQuery.error);
        }
    }, [visibleThreadsQuery?.error]);

    useEffect(() => {
        if (messagesQuery?.error) {
            console.error('[messages] messagesQuery error', messagesQuery.error, { selectedThreadId });
        }
    }, [messagesQuery?.error, selectedThreadId]);

    useEffect(() => {
        if (typeof window === 'undefined' || !('Notification' in window)) return;
        setBrowserNotificationPermission(window.Notification.permission);
    }, []);

    useEffect(() => {
        if (initialThreadId && threads.some((thread) => thread.id === initialThreadId)) {
            setSelectedThreadId(initialThreadId);
            return;
        }

        if (!selectedThreadId && threads.length > 0) {
            setSelectedThreadId(threads[0].id);
        }
    }, [initialThreadId, selectedThreadId, threads]);

    useEffect(() => {
        if (!selectedThreadId) return;
        const params = new URLSearchParams(searchParamString);
        params.set('threadId', selectedThreadId);
        router.replace(`/messages?${params.toString()}`, { scroll: false });
    }, [router, searchParamString, selectedThreadId]);

    useEffect(() => {
        const draftKey = DraftKey(selectedThreadId);
        if (!draftKey) {
            setComposerBody('');
            return;
        }
        const stored = window.localStorage.getItem(draftKey);
        setComposerBody(stored || '');
        setPendingFiles([]);
        setReplyToMessageId(null);
        setEditingMessageId(null);
        setEditingBody('');
        setComposerImportance('normal');
    }, [selectedThreadId]);

    useEffect(() => {
        const draftKey = DraftKey(selectedThreadId);
        if (!draftKey) return;
        if (!composerBody.trim()) {
            window.localStorage.removeItem(draftKey);
            return;
        }
        window.localStorage.setItem(draftKey, composerBody);
    }, [composerBody, selectedThreadId]);

    useEffect(() => {
        if (!selectedThreadId || messages.length === 0 || !selectedThreadMembership) return;
        const latestMessage = messages[messages.length - 1];
        if (!latestMessage?.id) return;
        void markRead({
            threadId: selectedThreadId,
            lastReadMessageId: latestMessage.id,
        }).catch((error) => {
            console.error('Unable to mark thread as read', error);
        });
    }, [messages, selectedThreadId, selectedThreadMembership]);

    const availableParticipants = useMemo(
        () => familyMembers.filter((member: any) => member.id !== currentUser?.id),
        [currentUser?.id, familyMembers]
    );

    const sendCurrentMessage = async () => {
        if (!currentUser || !selectedThreadId) return;
        if (!canComposeInThread) return;
        if (!composerBody.trim() && pendingFiles.length === 0) return;

        setIsSending(true);
        try {
            const attachments = pendingFiles.length ? await uploadFilesToS3(pendingFiles, id) : [];
            const result = await sendMessage({
                threadId: selectedThreadId,
                body: composerBody,
                attachments,
                replyToMessageId,
                importance: composerImportance,
                clientNonce: `${currentUser.id}:${Date.now()}`,
            });
            console.info('[messages] sendMessage result', result);
            setComposerBody('');
            setPendingFiles([]);
            setReplyToMessageId(null);
            setComposerImportance('normal');
            typingIndicator?.setActive?.(false);
            window.localStorage.removeItem(DraftKey(selectedThreadId));
        } catch (error: any) {
            toast({
                title: 'Message failed',
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSending(false);
        }
    };

    const saveNotificationPrefs = async (patch: Record<string, any>) => {
        if (!currentUser?.id) return;
        try {
            await db.transact([tx.familyMembers[currentUser.id].update(patch)]);
        } catch (error: any) {
            toast({
                title: 'Unable to save notification preferences',
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        }
    };

    const handleCreateThread = async () => {
        if (!currentUser || !creationMode) return;
        setIsCreatingThread(true);
        try {
            const participantIds = creationMode === 'direct' ? selectedParticipantIds.slice(0, 1) : selectedParticipantIds;
            const result = await createThread({
                threadType: creationMode,
                participantIds,
                title: creationMode === 'group' ? newThreadTitle : undefined,
            });
            console.info('[messages] createThread result', result);
            const threadId = result?.thread?.id;
            if (threadId) {
                setOptimisticThreadsById((current) => ({
                    ...current,
                    [threadId]: result.thread,
                }));
                setSelectedThreadId(threadId);
            }
            setCreationMode(null);
            setNewThreadTitle('');
            setSelectedParticipantIds([]);
        } catch (error: any) {
            toast({
                title: 'Unable to create thread',
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsCreatingThread(false);
        }
    };

    const openCanonicalThread = async (threadType: 'family' | 'parents_only') => {
        try {
            const result = await createThread({
                threadType,
            });
            console.info('[messages] openCanonicalThread result', result);
            const threadId = result?.thread?.id;
            if (threadId) {
                setOptimisticThreadsById((current) => ({
                    ...current,
                    [threadId]: result.thread,
                }));
                setSelectedThreadId(threadId);
            }
        } catch (error: any) {
            toast({
                title: `Unable to open ${threadType === 'family' ? 'family' : 'parents'} thread`,
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        }
    };

    const activeMessagesLoading = selectedThreadId ? messagesQuery.isLoading : false;

    useEffect(() => {
        console.info('[messages] state snapshot', {
            currentUserId: currentUser?.id || null,
            membershipCount: ((membershipQuery?.data?.messageThreadMembers as any[]) || []).length,
            visibleThreadCount: ((visibleThreadsQuery?.data?.messageThreads as any[]) || []).length,
            overseenThreadCount: ((overseenThreadsQuery?.data?.messageThreads as any[]) || []).length,
            renderedThreadCount: threads.length,
            selectedThreadId,
            messageCount: ((messagesQuery?.data?.messages as any[]) || []).length,
            activeMessagesLoading,
        });
    }, [
        activeMessagesLoading,
        currentUser?.id,
        membershipQuery?.data?.messageThreadMembers,
        messagesQuery?.data?.messages,
        overseenThreadsQuery?.data?.messageThreads,
        selectedThreadId,
        threads.length,
        visibleThreadsQuery?.data?.messageThreads,
    ]);

    return (
        <div className="h-full bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.12),_transparent_35%),linear-gradient(180deg,_#f8fbff_0%,_#eef5fb_100%)]">
            <div className="mx-auto flex h-full max-w-[1440px] gap-6 p-6">
                <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden rounded-[32px] border border-slate-200/80 bg-white/90 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur">
                    <div className="border-b border-slate-200 p-5">
                        <div className="space-y-4">
                            <div>
                                <h1 className="text-2xl font-bold text-slate-950">Messages</h1>
                                <p className="mt-1 text-sm text-slate-500">Family, DMs, groups, and oversight in one inbox.</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                {typeof window !== 'undefined' && 'Notification' in window && browserNotificationPermission !== 'granted' ? (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={async () => {
                                            const result = await window.Notification.requestPermission();
                                            setBrowserNotificationPermission(result);
                                        }}
                                    >
                                        Alerts
                                    </Button>
                                ) : null}
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowNotificationPrefs((value) => !value)}
                                >
                                    Notify
                                </Button>
                                {currentUser?.role === 'parent' ? (
                                    <Button
                                        type="button"
                                        variant={isOverseeMode ? 'default' : 'outline'}
                                        size="sm"
                                        onClick={() => setIsOverseeMode((value) => !value)}
                                    >
                                        <Shield className="mr-2 h-4 w-4" />
                                        {isOverseeMode ? 'Oversee' : 'Inbox'}
                                    </Button>
                                ) : null}
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    onClick={() => setCreationMode('direct')}
                                    aria-label="Start a conversation"
                                >
                                    <MessageSquarePlus className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                        <div className="mt-4 flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
                            <Search className="h-4 w-4 text-slate-400" />
                            <Input
                                value={threadSearch}
                                onChange={(event) => setThreadSearch(event.target.value)}
                                placeholder="Search threads, names, or previews"
                                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                            />
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => void openCanonicalThread('family')}>
                                Family
                            </Button>
                            {currentUser?.role === 'parent' ? (
                                <Button type="button" variant="outline" size="sm" onClick={() => void openCanonicalThread('parents_only')}>
                                    Parents
                                </Button>
                            ) : null}
                            <Button type="button" variant="outline" size="sm" onClick={() => setCreationMode('group')}>
                                <Users className="mr-2 h-4 w-4" />
                                Group
                            </Button>
                        </div>
                        {showNotificationPrefs && currentUser ? (
                            <div className="mt-4 rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Notification preferences</div>
                                <div className="mt-3 grid gap-3">
                                    <label className="flex items-center justify-between gap-3 text-sm text-slate-700">
                                        <span>Quiet hours</span>
                                        <input
                                            type="checkbox"
                                            checked={Boolean(currentUser.messageQuietHoursEnabled)}
                                            onChange={(event) => {
                                                void saveNotificationPrefs({
                                                    messageQuietHoursEnabled: event.target.checked,
                                                });
                                            }}
                                        />
                                    </label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <label className="text-xs text-slate-500">
                                            Start
                                            <input
                                                type="time"
                                                value={currentUser.messageQuietHoursStart || '22:00'}
                                                onChange={(event) => {
                                                    void saveNotificationPrefs({
                                                        messageQuietHoursStart: event.target.value,
                                                    });
                                                }}
                                                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                                            />
                                        </label>
                                        <label className="text-xs text-slate-500">
                                            End
                                            <input
                                                type="time"
                                                value={currentUser.messageQuietHoursEnd || '07:00'}
                                                onChange={(event) => {
                                                    void saveNotificationPrefs({
                                                        messageQuietHoursEnd: event.target.value,
                                                    });
                                                }}
                                                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                                            />
                                        </label>
                                    </div>
                                    <label className="text-xs text-slate-500">
                                        Delivery
                                        <select
                                            value={currentUser.messageDigestMode || 'immediate'}
                                            onChange={(event) => {
                                                void saveNotificationPrefs({
                                                    messageDigestMode: event.target.value,
                                                });
                                            }}
                                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                                        >
                                            <option value="immediate">Immediate</option>
                                            <option value="digest">Digest</option>
                                        </select>
                                    </label>
                                    <label className="text-xs text-slate-500">
                                        Digest every (minutes)
                                        <input
                                            type="number"
                                            min={5}
                                            max={240}
                                            value={currentUser.messageDigestWindowMinutes ?? 30}
                                            onChange={(event) => {
                                                void saveNotificationPrefs({
                                                    messageDigestWindowMinutes: Number(event.target.value || 30),
                                                });
                                            }}
                                            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                                        />
                                    </label>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    {creationMode ? (
                        <div className="border-b border-slate-200 bg-slate-50/70 p-4">
                            <div className="space-y-3">
                                <div className="text-sm font-semibold text-slate-900">
                                    {creationMode === 'direct' ? 'Start a direct message' : 'Create a group thread'}
                                </div>
                                {creationMode === 'group' ? (
                                    <Input
                                        value={newThreadTitle}
                                        onChange={(event) => setNewThreadTitle(event.target.value)}
                                        placeholder="Group title"
                                    />
                                ) : null}
                                <div className="max-h-40 space-y-2 overflow-auto rounded-2xl border border-slate-200 bg-white p-3">
                                    {availableParticipants.map((member: any) => {
                                        const checked = selectedParticipantIds.includes(member.id);
                                        return (
                                            <label key={member.id} className="flex items-center gap-3 text-sm text-slate-700">
                                                <input
                                                    type={creationMode === 'direct' ? 'radio' : 'checkbox'}
                                                    name="message-thread-member"
                                                    checked={checked}
                                                    onChange={() => {
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
                                                />
                                                <span>{member.name}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                                <div className="flex gap-2">
                                    <Button type="button" variant="ghost" size="sm" onClick={() => {
                                        setCreationMode(null);
                                        setNewThreadTitle('');
                                        setSelectedParticipantIds([]);
                                    }}>
                                        Cancel
                                    </Button>
                                    <Button type="button" size="sm" onClick={handleCreateThread} disabled={isCreatingThread || selectedParticipantIds.length === 0}>
                                        {isCreatingThread ? 'Creating...' : 'Create'}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    <ScrollArea className="min-h-0 flex-1">
                        <div className="space-y-2 p-3">
                            {threads.map((thread) => (
                                <button
                                    key={thread.id}
                                    type="button"
                                    onClick={() => setSelectedThreadId(thread.id)}
                                    className={cn(
                                        'w-full rounded-[24px] border px-4 py-3 text-left transition-all',
                                        selectedThreadId === thread.id
                                            ? 'border-sky-300 bg-sky-50 shadow-sm'
                                            : 'border-transparent bg-white hover:border-slate-200 hover:bg-slate-50'
                                    )}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-semibold text-slate-900">{thread.title || 'Untitled thread'}</div>
                                            <div className="mt-1 truncate text-xs text-slate-500">
                                                {threadSubtitle(thread, familyMemberNamesById, currentUser?.id || '')}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-1">
                                            {thread.membership?.isPinned ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Pinned</span> : null}
                                            {isThreadUnread(thread) ? <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-white">Unread</span> : null}
                                        </div>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                                        <span>{thread.threadType === 'parents_only' ? 'Parents only' : thread.threadType}</span>
                                        <span>{formatMessageTime(thread.latestMessageAt)}</span>
                                    </div>
                                </button>
                            ))}

                            {!threads.length ? (
                                <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                                    No visible threads yet.
                                </div>
                            ) : null}
                        </div>
                    </ScrollArea>
                </aside>

                <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[36px] border border-slate-200/80 bg-white shadow-[0_32px_80px_rgba(15,23,42,0.10)]">
                    {selectedThread ? (
                        <>
                            <div className="border-b border-slate-200 px-6 py-5">
                                <div className="flex flex-wrap items-start justify-between gap-4">
                                    <div>
                                        <div className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-700">{selectedThread.threadType}</div>
                                        <h2 className="mt-1 text-3xl font-bold text-slate-950">{selectedThread.title || 'Untitled thread'}</h2>
                                        {selectedThread.members?.length ? (
                                            <p className="mt-2 max-w-3xl text-sm text-slate-500">
                                                {(selectedThread.members || [])
                                                    .map((membership: any) => membership?.familyMember?.[0]?.name || membership?.familyMember?.name || '')
                                                    .filter(Boolean)
                                                    .join(', ')}
                                            </p>
                                        ) : null}
                                        {presentPeers.length > 0 ? (
                                            <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-emerald-700">
                                                Online now: {presentPeers.map((peer: any) => peer.name || 'Unknown').join(', ')}
                                            </p>
                                        ) : null}
                                        {typingPeers.length > 0 ? (
                                            <p className="mt-2 text-sm text-sky-700">
                                                {typingPeers.length === 1
                                                    ? `${typingPeers[0].name} is typing...`
                                                    : `${typingPeers[0].name} and ${typingPeers.length - 1} others are typing...`}
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {currentUser?.role === 'parent' && isOverseeMode && !selectedThreadMembership ? (
                                            <Button type="button" variant="outline" onClick={async () => {
                                                try {
                                                    await joinThreadWatch(selectedThread.id);
                                                    toast({ title: 'Thread joined', description: 'You are now watching this thread.' });
                                                } catch (error: any) {
                                                    toast({ title: 'Unable to join thread', description: error?.message || 'Please try again.', variant: 'destructive' });
                                                }
                                            }}>
                                                Join Thread
                                            </Button>
                                        ) : null}
                                        {selectedThreadMembership?.memberRole === 'watcher' ? (
                                            <Button type="button" variant="outline" onClick={async () => {
                                                try {
                                                    await leaveThreadWatch(selectedThread.id);
                                                    toast({ title: 'Left thread', description: 'Watcher mode has been removed.' });
                                                } catch (error: any) {
                                                    toast({ title: 'Unable to leave watch mode', description: error?.message || 'Please try again.', variant: 'destructive' });
                                                }
                                            }}>
                                                Leave Watch
                                            </Button>
                                        ) : null}
                                        {selectedThreadMembership ? (
                                            <>
                                                <Button type="button" variant="outline" onClick={() => {
                                                    void updateThreadPreferences({
                                                        threadId: selectedThread.id,
                                                        isPinned: !selectedThreadMembership.isPinned,
                                                    }).catch((error) => {
                                                        toast({ title: 'Unable to update thread', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
                                                    });
                                                }}>
                                                    {selectedThreadMembership.isPinned ? 'Unpin' : 'Pin'}
                                                </Button>
                                                <Button type="button" variant="outline" onClick={() => {
                                                    void updateThreadPreferences({
                                                        threadId: selectedThread.id,
                                                        isArchived: true,
                                                    }).catch((error) => {
                                                        toast({ title: 'Unable to archive thread', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
                                                    });
                                                }}>
                                                    Archive
                                                </Button>
                                            </>
                                        ) : null}
                                    </div>
                                </div>

                                {selectedThreadMembership ? (
                                    <div className="mt-4 flex flex-wrap items-center gap-3">
                                        <label className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">Notifications</label>
                                        <select
                                            value={selectedThreadMembership.notificationLevel || 'all'}
                                            onChange={(event) => {
                                                void updateThreadPreferences({
                                                    threadId: selectedThread.id,
                                                    notificationLevel: event.target.value as MessageNotificationLevel,
                                                }).catch((error) => {
                                                    toast({ title: 'Unable to update notifications', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
                                                });
                                            }}
                                            className="rounded-full border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
                                        >
                                            <option value="all">All</option>
                                            <option value="mentions">Mentions</option>
                                            <option value="watch">Watch</option>
                                            <option value="mute">Mute</option>
                                        </select>
                                        <div className="ml-auto flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
                                            <Search className="h-4 w-4 text-slate-400" />
                                            <input
                                                value={messageSearch}
                                                onChange={(event) => setMessageSearch(event.target.value)}
                                                placeholder="Search in this thread"
                                                className="bg-transparent text-sm outline-none"
                                            />
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <ScrollArea className="min-h-0 flex-1 bg-[linear-gradient(180deg,_rgba(240,249,255,0.45)_0%,_rgba(255,255,255,1)_28%)]">
                                <div className="space-y-4 px-6 py-6">
                                    {activeMessagesError ? (
                                        <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                                            Could not load this thread&apos;s messages: {activeMessagesError.message || 'Unknown query error'}
                                        </div>
                                    ) : null}
                                    {activeMessagesLoading ? (
                                        <div className="flex items-center gap-3 rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                            Loading conversation...
                                        </div>
                                    ) : null}

                                    {messages.map((message) => {
                                        const isOwnMessage = currentUser?.id && message.authorFamilyMemberId === currentUser.id;
                                        const editableUntil = message.editableUntil ? new Date(message.editableUntil).getTime() : 0;
                                        const canEdit = isOwnMessage && Date.now() < editableUntil && !message.deletedAt;
                                        const canDelete = (isOwnMessage && Date.now() < editableUntil) || currentUser?.role === 'parent';
                                        const isEditing = editingMessageId === message.id;
                                        const replyTo = getReplyToMessage(message.replyTo);
                                        return (
                                            <div key={message.id} className={cn('flex', isOwnMessage ? 'justify-end' : 'justify-start')}>
                                                <div
                                                    className={cn(
                                                        'max-w-[78%] rounded-[28px] border px-4 py-3 shadow-sm',
                                                        isOwnMessage
                                                            ? 'border-sky-500 bg-sky-600 text-white'
                                                            : 'border-slate-200 bg-white text-slate-900'
                                                    )}
                                                >
                                                    <div className={cn('mb-1 flex flex-wrap items-center gap-2 text-xs', isOwnMessage ? 'text-sky-100' : 'text-slate-500')}>
                                                        <span className="font-semibold">{getAuthorName(message, familyMemberNamesById)}</span>
                                                        <span>{formatMessageTime(message.createdAt)}</span>
                                                        {message.editedAt ? <span>edited</span> : null}
                                                        {message.importance === 'urgent' ? <span className="rounded-full bg-rose-100 px-2 py-0.5 font-semibold text-rose-700">urgent</span> : null}
                                                        {message.importance === 'announcement' ? <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-700">announcement</span> : null}
                                                    </div>

                                                    {replyTo ? (
                                                        <button
                                                            type="button"
                                                            onClick={() => setReplyToMessageId(replyTo.id || null)}
                                                            className={cn(
                                                                'mb-3 block w-full rounded-2xl border px-3 py-2 text-left text-xs',
                                                                isOwnMessage ? 'border-white/20 bg-white/10 text-sky-50' : 'border-slate-200 bg-slate-50 text-slate-600'
                                                            )}
                                                        >
                                                            Replying to {getAuthorName(replyTo, familyMemberNamesById)}: {(replyTo.body || '').slice(0, 80)}
                                                        </button>
                                                    ) : null}

                                                    {isEditing ? (
                                                        <div className="space-y-2">
                                                            <textarea
                                                                value={editingBody}
                                                                onChange={(event) => setEditingBody(event.target.value)}
                                                                rows={4}
                                                                className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                                            />
                                                            <div className="flex justify-end gap-2">
                                                                <Button type="button" variant="outline" size="sm" onClick={() => {
                                                                    setEditingMessageId(null);
                                                                    setEditingBody('');
                                                                }}>
                                                                    Cancel
                                                                </Button>
                                                                <Button
                                                                    type="button"
                                                                    size="sm"
                                                                    onClick={async () => {
                                                                        try {
                                                                            await editMessage({
                                                                                messageId: message.id,
                                                                                body: editingBody,
                                                                            });
                                                                            setEditingMessageId(null);
                                                                            setEditingBody('');
                                                                        } catch (error: any) {
                                                                            toast({ title: 'Unable to edit message', description: error?.message || 'Please try again.', variant: 'destructive' });
                                                                        }
                                                                    }}
                                                                >
                                                                    Save
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    ) : message.deletedAt ? (
                                                        <div className={cn('rounded-2xl px-3 py-2 text-sm italic', isOwnMessage ? 'bg-white/10 text-sky-100' : 'bg-slate-50 text-slate-500')}>
                                                            {message.removedReason || 'Message removed'}
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {message.body ? <div className="whitespace-pre-wrap text-sm leading-6">{message.body}</div> : null}
                                                            {message.attachments?.length ? (
                                                                <AttachmentCollection
                                                                    attachments={message.attachments}
                                                                    className="mt-3"
                                                                    variant={isOwnMessage ? 'bubble-own' : 'bubble-other'}
                                                                />
                                                            ) : null}
                                                        </>
                                                    )}

                                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                                        {['👍', '❤️', '😂', '🔥'].map((emoji) => {
                                                            const count = (message.reactions || []).filter((reaction) => reaction.emoji === emoji).length;
                                                            const isActive = (message.reactions || []).some((reaction) => {
                                                                const member = Array.isArray(reaction.familyMember) ? reaction.familyMember[0] : reaction.familyMember;
                                                                return reaction.emoji === emoji && member?.id === currentUser?.id;
                                                            });
                                                            return (
                                                                <button
                                                                    key={`${message.id}-${emoji}`}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        void toggleReaction({ messageId: message.id, emoji }).catch((error) => {
                                                                            toast({ title: 'Unable to react', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
                                                                        });
                                                                    }}
                                                                    className={cn(
                                                                        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                                                                        isOwnMessage
                                                                            ? isActive
                                                                                ? 'border-white/30 bg-white/20 text-white'
                                                                                : 'border-white/20 bg-white/10 text-sky-50'
                                                                            : isActive
                                                                            ? 'border-sky-300 bg-sky-50 text-sky-700'
                                                                            : 'border-slate-200 bg-slate-50 text-slate-600'
                                                                    )}
                                                                >
                                                                    {emoji} {count > 0 ? count : ''}
                                                                </button>
                                                            );
                                                        })}

                                                        {message.importance === 'needs_ack' ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    void acknowledge({ messageId: message.id, kind: 'acknowledged' }).catch((error) => {
                                                                        toast({ title: 'Unable to acknowledge message', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
                                                                    });
                                                                }}
                                                                className={cn(
                                                                    'rounded-full border px-2.5 py-1 text-xs font-medium',
                                                                    isOwnMessage ? 'border-white/20 bg-white/10 text-sky-50' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                                                )}
                                                            >
                                                                {message.acknowledgements?.length ? `${message.acknowledgements.length} acknowledged` : 'Acknowledge'}
                                                            </button>
                                                        ) : null}

                                                        <div className="ml-auto flex flex-wrap gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => setReplyToMessageId(message.id)}
                                                                className={cn('text-xs font-semibold', isOwnMessage ? 'text-sky-100 hover:text-white' : 'text-slate-500 hover:text-slate-700')}
                                                            >
                                                                Reply
                                                            </button>
                                                            {canEdit ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setEditingMessageId(message.id);
                                                                        setEditingBody(message.body || '');
                                                                    }}
                                                                    className={cn('text-xs font-semibold', isOwnMessage ? 'text-sky-100 hover:text-white' : 'text-slate-500 hover:text-slate-700')}
                                                                >
                                                                    Edit
                                                                </button>
                                                            ) : null}
                                                            {canDelete ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        void removeMessage(message.id).catch((error) => {
                                                                            toast({ title: 'Unable to remove message', description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive' });
                                                                        });
                                                                    }}
                                                                    className={cn('text-xs font-semibold', isOwnMessage ? 'text-sky-100 hover:text-white' : 'text-slate-500 hover:text-slate-700')}
                                                                >
                                                                    Remove
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {!activeMessagesLoading && messages.length === 0 ? (
                                        <div className="rounded-[28px] border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                                            No messages in this thread yet.
                                        </div>
                                    ) : null}
                                </div>
                            </ScrollArea>

                            <div className="border-t border-slate-200 bg-slate-50/80 p-5">
                                {!canComposeInThread ? (
                                    <div className="rounded-3xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                                        Join this thread to reply or add a watch membership from oversee mode.
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {replyTarget ? (
                                            <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                                                <div>
                                                    Replying to <span className="font-semibold text-slate-900">{getAuthorName(replyTarget, familyMemberNamesById)}</span>
                                                </div>
                                                <button type="button" className="font-semibold text-slate-500" onClick={() => setReplyToMessageId(null)}>
                                                    Clear
                                                </button>
                                            </div>
                                        ) : null}

                                        <textarea
                                            value={composerBody}
                                            onChange={(event) => setComposerBody(event.target.value)}
                                            onBlur={() => typingIndicator?.inputProps?.onBlur?.()}
                                            onKeyDown={(event) => typingIndicator?.inputProps?.onKeyDown?.(event)}
                                            rows={4}
                                            placeholder="Write a message..."
                                            className="w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-sky-400"
                                        />

                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                            {currentUser?.role === 'parent' ? (
                                                <select
                                                    value={composerImportance}
                                                    onChange={(event) => setComposerImportance(event.target.value as any)}
                                                    className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm"
                                                >
                                                    <option value="normal">Normal</option>
                                                    <option value="urgent">Urgent</option>
                                                    <option value="announcement">Announcement</option>
                                                    <option value="needs_ack">Needs Ack</option>
                                                </select>
                                            ) : null}
                                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">
                                                <span>Add files</span>
                                                <input
                                                    type="file"
                                                    multiple
                                                    className="hidden"
                                                    onChange={(event) => {
                                                        const files = Array.from(event.target.files || []);
                                                        setPendingFiles((current) => [...current, ...files]);
                                                        event.target.value = '';
                                                    }}
                                                    disabled={isSending}
                                                />
                                            </label>
                                            <Button type="button" onClick={sendCurrentMessage} disabled={isSending || (!composerBody.trim() && pendingFiles.length === 0)}>
                                                {isSending ? 'Sending...' : 'Send message'}
                                            </Button>
                                        </div>

                                        {pendingFiles.length > 0 ? (
                                            <div className="flex flex-wrap gap-2">
                                                {pendingFiles.map((file, index) => (
                                                    <button
                                                        key={`${file.name}-${index}`}
                                                        type="button"
                                                        onClick={() => setPendingFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))}
                                                        className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                                                    >
                                                        {file.name} x
                                                    </button>
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </div>
                        </>
                    ) : (
                        <div className="flex h-full items-center justify-center px-8 text-center text-slate-500">
                            Select a thread to start messaging.
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}
