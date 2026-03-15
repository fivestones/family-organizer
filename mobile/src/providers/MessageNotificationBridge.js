import React, { useEffect, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { db } from '../lib/instant-db';
import { useFamilyAuth } from './FamilyAuthProvider';
import {
  nextDigestAt,
  normalizeDigestMode,
  normalizeDigestWindowMinutes,
  shouldQueueDigest,
} from '../../../lib/message-notification-preferences';

function queueKey(memberId) {
  return `familyOrganizer.messageDigestQueue.${memberId}`;
}

async function readQueue(memberId) {
  try {
    const raw = await AsyncStorage.getItem(queueKey(memberId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(memberId, queue) {
  try {
    await AsyncStorage.setItem(queueKey(memberId), JSON.stringify(queue));
  } catch {
    // best-effort
  }
}

function summarizeDigest(queue) {
  const titles = Array.from(new Set(queue.map((item) => item.title).filter(Boolean)));
  if (queue.length === 1) {
    return queue[0].body || `New message in ${queue[0].title}`;
  }
  if (titles.length === 1) {
    return `${queue.length} new messages in ${titles[0]}`;
  }
  return `${queue.length} new messages across ${titles.length} threads`;
}

async function showLocalNotification(title, body) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      sound: 'default',
    },
    trigger: null,
  });
}

export function MessageNotificationBridge() {
  const { currentUser, isAuthenticated } = useFamilyAuth();
  const seenThreadActivityRef = useRef({});

  const membershipQuery = db.useQuery(
    isAuthenticated && currentUser
      ? {
          messageThreadMembers: {
            thread: {},
          },
        }
      : null
  );

  const threads = useMemo(() => {
    const memberships = membershipQuery.data?.messageThreadMembers || [];
    return memberships
      .map((membership) => {
        const thread = Array.isArray(membership.thread) ? membership.thread[0] : membership.thread;
        return thread ? { ...thread, membership } : null;
      })
      .filter(Boolean);
  }, [membershipQuery.data?.messageThreadMembers]);

  useEffect(() => {
    if (!currentUser?.id) return;
    const intervalId = setInterval(() => {
      void (async () => {
        const queue = await readQueue(currentUser.id);
        if (!queue.length) return;
        const now = Date.now();
        const due = queue.filter((item) => new Date(item.dueAt).getTime() <= now);
        if (!due.length) return;
        const remaining = queue.filter((item) => new Date(item.dueAt).getTime() > now);
        await writeQueue(currentUser.id, remaining);
        await showLocalNotification('Family message digest', summarizeDigest(due));
      })();
    }, 30_000);

    return () => clearInterval(intervalId);
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.id) return;

    const digestMode = normalizeDigestMode(currentUser.messageDigestMode);
    const digestWindowMinutes = normalizeDigestWindowMinutes(currentUser.messageDigestWindowMinutes);

    threads.forEach((thread) => {
      const latestMessageAt = thread.latestMessageAt || '';
      if (!latestMessageAt) return;

      const previousLatest = seenThreadActivityRef.current[thread.id];
      seenThreadActivityRef.current[thread.id] = latestMessageAt;

      if (!previousLatest) return;
      if (previousLatest === latestMessageAt) return;
      if (thread.latestMessageAuthorId === currentUser.id) return;

      const title = thread.title || 'Family message';
      const body = thread.latestMessagePreview || 'New message';
      const now = new Date();

      if (shouldQueueDigest(currentUser, now) || digestMode === 'digest') {
        void (async () => {
          const queue = await readQueue(currentUser.id);
          const dueAt = nextDigestAt(
            {
              ...currentUser,
              messageDigestMode: digestMode,
              messageDigestWindowMinutes: digestWindowMinutes,
            },
            now
          );
          queue.push({
            threadId: thread.id,
            title,
            body,
            occurredAt: latestMessageAt,
            dueAt: dueAt.toISOString(),
          });
          await writeQueue(currentUser.id, queue);
        })();
        return;
      }

      void showLocalNotification(title, body);
    });
  }, [
    currentUser,
    currentUser?.id,
    currentUser?.messageDigestMode,
    currentUser?.messageDigestWindowMinutes,
    currentUser?.messageQuietHoursEnabled,
    currentUser?.messageQuietHoursEnd,
    currentUser?.messageQuietHoursStart,
    threads,
  ]);

  return null;
}
