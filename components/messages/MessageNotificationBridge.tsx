'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import { db } from '@/lib/db';
import {
    nextDigestAt,
    normalizeDigestMode,
    normalizeDigestWindowMinutes,
    shouldQueueDigest,
    type MessageNotificationPreferences,
} from '@/lib/message-notification-preferences';

type DigestItem = {
    threadId: string;
    title: string;
    body: string;
    dueAt: string;
    occurredAt: string;
};

function queueKey(memberId: string) {
    return `family_organizer_message_digest_queue:${memberId}`;
}

function readQueue(memberId: string): DigestItem[] {
    try {
        const raw = window.localStorage.getItem(queueKey(memberId));
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function writeQueue(memberId: string, queue: DigestItem[]) {
    try {
        window.localStorage.setItem(queueKey(memberId), JSON.stringify(queue));
    } catch {
        // best effort
    }
}

function summarizeDigest(queue: DigestItem[]) {
    const titles = Array.from(new Set(queue.map((item) => item.title).filter(Boolean)));
    if (queue.length === 1) {
        return queue[0].body || `New message in ${queue[0].title}`;
    }
    if (titles.length === 1) {
        return `${queue.length} new messages in ${titles[0]}`;
    }
    const preview = titles.slice(0, 3).join(', ');
    return `${queue.length} new messages across ${titles.length} threads: ${preview}`;
}

function showBrowserNotification(title: string, body: string, tag: string) {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (window.Notification.permission !== 'granted') return;
    new window.Notification(title, {
        body,
        tag,
    });
}

export function MessageNotificationBridge() {
    const { currentUser } = useAuth();
    const seenThreadActivityRef = useRef<Record<string, string>>({});

    const membershipQuery = (db as any).useQuery(
        currentUser
            ? {
                  messageThreadMembers: {
                  },
              }
            : null
    ) as any;

    const threads = useMemo(() => {
        const memberships = membershipQuery?.data?.messageThreadMembers || [];
        return memberships
            .filter((membership: any) => membership?.threadId)
            .map((membership: any) => ({
                id: membership.threadId,
                latestMessageAt: membership.lastReadAt || '',
                latestMessageAuthorId: null,
                latestMessagePreview: '',
                title: 'Message thread',
                membership,
            }));
    }, [membershipQuery?.data?.messageThreadMembers]);

    const prefs = currentUser || ({} as MessageNotificationPreferences & { id?: string | null });

    useEffect(() => {
        if (!currentUser?.id) return;
        const intervalId = window.setInterval(() => {
            const queue = readQueue(currentUser.id);
            if (!queue.length) return;
            const now = Date.now();
            const due = queue.filter((item) => new Date(item.dueAt).getTime() <= now);
            if (!due.length) return;
            const remaining = queue.filter((item) => new Date(item.dueAt).getTime() > now);
            writeQueue(currentUser.id, remaining);
            showBrowserNotification('Family message digest', summarizeDigest(due), `digest:${currentUser.id}`);
        }, 30_000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [currentUser?.id]);

    useEffect(() => {
        if (!currentUser?.id) return;

        const digestMode = normalizeDigestMode(prefs.messageDigestMode);
        const digestWindowMinutes = normalizeDigestWindowMinutes(prefs.messageDigestWindowMinutes);

        for (const thread of threads) {
            const latestMessageAt = thread.latestMessageAt || '';
            if (!latestMessageAt) continue;

            const previousLatest = seenThreadActivityRef.current[thread.id];
            seenThreadActivityRef.current[thread.id] = latestMessageAt;

            if (!previousLatest) continue;
            if (previousLatest === latestMessageAt) continue;
            if (thread.latestMessageAuthorId === currentUser.id) continue;

            const body = thread.latestMessagePreview || 'New message';
            const title = thread.title || 'Family message';
            const now = new Date();

            if (shouldQueueDigest(prefs, now) || digestMode === 'digest') {
                const queue = readQueue(currentUser.id);
                const dueAt = nextDigestAt(
                    {
                        ...prefs,
                        messageDigestMode: digestMode,
                        messageDigestWindowMinutes: digestWindowMinutes,
                    },
                    now
                );
                queue.push({
                    threadId: thread.id,
                    title,
                    body,
                    dueAt: dueAt.toISOString(),
                    occurredAt: latestMessageAt,
                });
                writeQueue(currentUser.id, queue);
                continue;
            }

            showBrowserNotification(title, body, `thread:${thread.id}`);
        }
    }, [
        currentUser?.id,
        prefs.messageDigestMode,
        prefs.messageDigestWindowMinutes,
        prefs.messageQuietHoursEnabled,
        prefs.messageQuietHoursEnd,
        prefs.messageQuietHoursStart,
        threads,
    ]);

    return null;
}
