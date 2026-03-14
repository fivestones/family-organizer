'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { id, tx } from '@instantdb/react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/components/AuthProvider';
import { AttachmentCollection } from '@/components/attachments/AttachmentCollection';
import { db } from '@/lib/db';
import { uploadFilesToS3 } from '@/lib/file-uploads';
import {
    buildHistoryEventTransactions,
    HISTORY_MESSAGE_EDIT_WINDOW_MS,
    HISTORY_MESSAGE_THREAD_FAMILY_ID,
} from '@/lib/history-events';

type MessageRecord = {
    id: string;
    body?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    editedAt?: string | null;
    editableUntil?: string | null;
    authorFamilyMemberId?: string | null;
    attachments?: Array<{
        id: string;
        name?: string | null;
        url?: string | null;
        type?: string | null;
        kind?: string | null;
        sizeBytes?: number | null;
        width?: number | null;
        height?: number | null;
        durationSec?: number | null;
        thumbnailUrl?: string | null;
        thumbnailWidth?: number | null;
        thumbnailHeight?: number | null;
        blurhash?: string | null;
        waveformPeaks?: number[] | null;
    }>;
    author?: Array<{ id?: string; name?: string | null }> | { id?: string; name?: string | null } | null;
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

export default function FamilyMessagesPage() {
    const { toast } = useToast();
    const { currentUser } = useAuth();
    const [messageBody, setMessageBody] = useState('');
    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editingBody, setEditingBody] = useState('');
    const [isSavingEdit, setIsSavingEdit] = useState(false);
    const bottomRef = useRef<HTMLDivElement | null>(null);

    const { data, isLoading } = db.useQuery({
        messageThreads: {
            $: {
                where: {
                    id: HISTORY_MESSAGE_THREAD_FAMILY_ID,
                },
            },
            messages: {
                attachments: {},
                author: {},
            },
        },
        familyMembers: {
            $: {
                order: {
                    order: 'asc',
                },
            },
        },
    });

    const thread = (data?.messageThreads as any[])?.[0] || null;
    const familyMembers = (data?.familyMembers as any[]) || [];
    const familyMemberNamesById = useMemo(
        () => new Map(familyMembers.map((member: any) => [member.id, member.name || 'Unknown'])),
        [familyMembers]
    );
    const messages = useMemo(
        () =>
            ([...(thread?.messages || [])] as MessageRecord[]).sort((left, right) => {
                const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : 0;
                const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : 0;
                return leftTime - rightTime;
            }),
        [thread?.messages]
    );

    useEffect(() => {
        if (isLoading || thread) return;

        const nowIso = new Date().toISOString();
        void db
            .transact([
                tx.messageThreads[HISTORY_MESSAGE_THREAD_FAMILY_ID].update({
                    createdAt: nowIso,
                    threadType: 'family',
                    title: 'Family',
                    updatedAt: nowIso,
                }),
            ])
            .catch((error: any) => {
                console.error('Failed to initialize family message thread', error);
            });
    }, [db, isLoading, thread]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ block: 'end' });
    }, [messages.length]);

    const removePendingFile = (index: number) => {
        setPendingFiles((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    };

    const handleSend = async () => {
        const trimmedBody = messageBody.trim();
        if (!currentUser?.id) {
            toast({
                title: 'Login Required',
                description: 'Choose a family member before sending a message.',
                variant: 'destructive',
            });
            return;
        }
        if (!trimmedBody && pendingFiles.length === 0) return;

        setIsSending(true);
        try {
            const nowIso = new Date().toISOString();
            const uploadedAttachments = pendingFiles.length ? await uploadFilesToS3(pendingFiles, id) : [];
            const messageId = id();
            const transactions: any[] = [];

            if (!thread) {
                transactions.push(
                    tx.messageThreads[HISTORY_MESSAGE_THREAD_FAMILY_ID].update({
                        createdAt: nowIso,
                        threadType: 'family',
                        title: 'Family',
                        updatedAt: nowIso,
                    })
                );
            } else {
                transactions.push(
                    tx.messageThreads[HISTORY_MESSAGE_THREAD_FAMILY_ID].update({
                        updatedAt: nowIso,
                    })
                );
            }

            transactions.push(
                tx.messages[messageId].update({
                    authorFamilyMemberId: currentUser.id,
                    body: trimmedBody,
                    createdAt: nowIso,
                    editableUntil: new Date(Date.now() + HISTORY_MESSAGE_EDIT_WINDOW_MS).toISOString(),
                    editedAt: null,
                    updatedAt: nowIso,
                }),
                tx.messageThreads[HISTORY_MESSAGE_THREAD_FAMILY_ID].link({ messages: messageId }),
                tx.familyMembers[currentUser.id].link({ authoredMessages: messageId })
            );

            for (const attachment of uploadedAttachments) {
                transactions.push(
                    tx.messageAttachments[attachment.id].update({
                        blurhash: attachment.blurhash || null,
                        createdAt: nowIso,
                        durationSec: attachment.durationSec ?? null,
                        height: attachment.height ?? null,
                        kind: attachment.kind || null,
                        name: attachment.name,
                        sizeBytes: attachment.sizeBytes ?? null,
                        thumbnailHeight: attachment.thumbnailHeight ?? null,
                        thumbnailUrl: attachment.thumbnailUrl || null,
                        thumbnailWidth: attachment.thumbnailWidth ?? null,
                        type: attachment.type,
                        updatedAt: nowIso,
                        url: attachment.url,
                        waveformPeaks: attachment.waveformPeaks || null,
                        width: attachment.width ?? null,
                    }),
                    tx.messages[messageId].link({ attachments: attachment.id })
                );
            }

            const historyEvent = buildHistoryEventTransactions({
                tx,
                createId: id,
                occurredAt: nowIso,
                domain: 'messages',
                actionType: 'message_posted',
                summary: `${currentUser.name} posted in Family`,
                source: 'manual',
                actorFamilyMemberId: currentUser.id,
                messageThreadId: HISTORY_MESSAGE_THREAD_FAMILY_ID,
                messageId,
                metadata: {
                    threadType: 'family',
                },
            });
            transactions.push(...historyEvent.transactions);

            await db.transact(transactions);
            setMessageBody('');
            setPendingFiles([]);
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

    const beginEdit = (message: MessageRecord) => {
        setEditingMessageId(message.id);
        setEditingBody(message.body || '');
    };

    const cancelEdit = () => {
        if (isSavingEdit) return;
        setEditingMessageId(null);
        setEditingBody('');
    };

    const handleSaveEdit = async () => {
        if (!editingMessageId || !currentUser?.id) return;
        const trimmedBody = editingBody.trim();
        if (!trimmedBody) return;

        setIsSavingEdit(true);
        try {
            const nowIso = new Date().toISOString();
            await db.transact([
                tx.messages[editingMessageId].update({
                    body: trimmedBody,
                    editedAt: nowIso,
                    updatedAt: nowIso,
                }),
            ]);
            setEditingMessageId(null);
            setEditingBody('');
        } catch (error: any) {
            toast({
                title: 'Edit failed',
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSavingEdit(false);
        }
    };

    return (
        <div className="container mx-auto flex h-full max-w-5xl flex-col p-6">
            <div className="mb-4">
                <h1 className="text-3xl font-bold">Messages</h1>
                <p className="mt-1 text-sm text-slate-500">One family-wide thread for now. These messages also appear in History.</p>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <ScrollArea className="min-h-0 flex-1">
                    <div className="space-y-4 p-4">
                        {messages.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                                No family messages yet.
                            </div>
                        ) : null}

                        {messages.map((message) => {
                            const isOwnMessage = currentUser?.id && message.authorFamilyMemberId === currentUser.id;
                            const editableUntil = message.editableUntil ? new Date(message.editableUntil).getTime() : 0;
                            const canEdit = isOwnMessage && Date.now() < editableUntil;
                            const isEditing = editingMessageId === message.id;

                            return (
                                <div key={message.id} className={`flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`max-w-[80%] rounded-3xl px-4 py-3 shadow-sm ${isOwnMessage ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-900'}`}>
                                        <div className={`mb-1 flex flex-wrap items-center gap-2 text-xs ${isOwnMessage ? 'text-sky-100' : 'text-slate-500'}`}>
                                            <span className="font-semibold">{getAuthorName(message, familyMemberNamesById)}</span>
                                            <span>{formatMessageTime(message.createdAt)}</span>
                                            {message.editedAt ? <span>edited</span> : null}
                                        </div>

                                        {isEditing ? (
                                            <div className="space-y-2">
                                                <textarea
                                                    value={editingBody}
                                                    onChange={(event) => setEditingBody(event.target.value)}
                                                    rows={4}
                                                    className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                                                />
                                                <div className="flex justify-end gap-2">
                                                    <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={isSavingEdit}>
                                                        Cancel
                                                    </Button>
                                                    <Button type="button" size="sm" onClick={handleSaveEdit} disabled={isSavingEdit}>
                                                        {isSavingEdit ? 'Saving...' : 'Save'}
                                                    </Button>
                                                </div>
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
                                                {canEdit ? (
                                                    <div className="mt-3 flex justify-end">
                                                        <button
                                                            type="button"
                                                            onClick={() => beginEdit(message)}
                                                            className={`text-xs font-semibold ${isOwnMessage ? 'text-sky-100 hover:text-white' : 'text-slate-500 hover:text-slate-700'}`}
                                                        >
                                                            Edit
                                                        </button>
                                                    </div>
                                                ) : null}
                                            </>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={bottomRef} />
                    </div>
                </ScrollArea>

                <div className="border-t border-slate-200 bg-slate-50 p-4">
                    <div className="space-y-3">
                        <textarea
                            value={messageBody}
                            onChange={(event) => setMessageBody(event.target.value)}
                            rows={4}
                            placeholder={currentUser ? 'Write a family message...' : 'Choose a family member before sending a message.'}
                            className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm shadow-sm"
                            disabled={!currentUser || isSending}
                        />

                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm">
                                <span>Add files</span>
                                <input
                                    type="file"
                                    multiple
                                    className="hidden"
                                    onChange={(event) => {
                                        const files = Array.from(event.target.files || []);
                                        setPendingFiles((prev) => [...prev, ...files]);
                                        event.target.value = '';
                                    }}
                                    disabled={!currentUser || isSending}
                                />
                            </label>

                            <Button type="button" onClick={handleSend} disabled={!currentUser || isSending || (!messageBody.trim() && pendingFiles.length === 0)}>
                                {isSending ? 'Sending...' : 'Send message'}
                            </Button>
                        </div>

                        {pendingFiles.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                                {pendingFiles.map((file, index) => (
                                    <button
                                        key={`${file.name}-${index}`}
                                        type="button"
                                        onClick={() => removePendingFile(index)}
                                        className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700"
                                    >
                                        {file.name} x
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
