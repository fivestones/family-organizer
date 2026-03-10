import 'server-only';

import { randomUUID } from 'crypto';
import { discoverAppleCalendars, fetchCalendarEvents } from '@/lib/apple-caldav/client';
import {
    APPLE_CALDAV_PROVIDER,
    getCalendarSyncActivePollMs,
    getCalendarSyncLockTtlMs,
    getCalendarSyncWindow,
    getDefaultRepairScanIntervalHours,
    getDefaultSyncWindowFutureDays,
    getDefaultSyncWindowPastDays,
} from '@/lib/apple-caldav/config';
import { decryptCalendarCredential, encryptCalendarCredential } from '@/lib/apple-caldav/crypto';
import { parseCalendarResource } from '@/lib/apple-caldav/ics';
import { buildInstantCalendarItemPayload } from '@/lib/apple-caldav/mapper';
import { getAppleCalendarSyncPollPlan } from '@/lib/apple-caldav/polling';
import {
    acquireCalendarSyncLock,
    createSyncRun,
    getCalendarSyncAccount,
    listCalendarSyncAccounts,
    listCalendarSyncCalendars,
    listRecentSyncRuns,
    markImportedCalendarItemsDeletedByRemoteUrls,
    releaseCalendarSyncLock,
    replaceCalendarSyncCalendars,
    updateSyncRun,
    upsertCalendarSyncAccount,
    upsertImportedCalendarItems,
} from '@/lib/apple-caldav/repository';

function shouldForceRepair(calendar: any, account: any, trigger: string | undefined, now: Date) {
    if (trigger === 'repair') return true;
    const intervalHours = account.repairScanIntervalHours || getDefaultRepairScanIntervalHours();
    if (!calendar.lastSuccessfulSyncAt) return true;
    const lastSuccessfulMs = new Date(calendar.lastSuccessfulSyncAt).getTime();
    if (Number.isNaN(lastSuccessfulMs)) return true;
    return now.getTime() - lastSuccessfulMs >= intervalHours * 60 * 60 * 1000;
}

function mergeDiscoveredCalendars(account: any, existingCalendars: any[], discoveredCalendars: any[], nowIso: string) {
    const existingByRemoteId = new Map(existingCalendars.map((calendar: any) => [calendar.remoteCalendarId, calendar]));
    const selectedIds = new Set(
        Array.isArray(account.selectedCalendarIds) && account.selectedCalendarIds.length > 0
            ? account.selectedCalendarIds
            : existingCalendars.filter((calendar: any) => calendar.isEnabled).map((calendar: any) => calendar.remoteCalendarId)
    );

    const merged = discoveredCalendars.map((calendar: any) => {
        const existing = existingByRemoteId.get(calendar.remoteCalendarId);
        return {
            ...existing,
            ...calendar,
            accountId: account.id,
            createdAt: existing?.createdAt || nowIso,
            isEnabled: selectedIds.has(calendar.remoteCalendarId) && account.status === 'active',
            lastCtag: existing?.lastCtag || '',
            lastSeenAt: nowIso,
            lastSuccessfulSyncAt: existing?.lastSuccessfulSyncAt || '',
            lastSyncToken: calendar.syncToken || existing?.lastSyncToken || '',
            observedCtag: calendar.ctag || '',
            updatedAt: nowIso,
        };
    });

    for (const existing of existingCalendars) {
        if (merged.some((calendar: any) => calendar.remoteCalendarId === existing.remoteCalendarId)) continue;
        merged.push({
            ...existing,
            isEnabled: false,
            updatedAt: nowIso,
        });
    }

    return merged;
}

function persistableCalendarRows(calendars: any[]) {
    return calendars.map(({ observedCtag, ...calendar }) => calendar);
}

async function recordAppleCalendarPollHeartbeat(account: any, atIso: string) {
    await upsertCalendarSyncAccount({
        ...account,
        lastAttemptedSyncAt: atIso,
        updatedAt: atIso,
    });
}

export async function connectAppleCalendarAccount(input: { username: string; appSpecificPassword: string; accountLabel?: string }) {
    const discovery = await discoverAppleCalendars({
        username: input.username,
        password: input.appSpecificPassword,
    });
    const encrypted = encryptCalendarCredential(input.appSpecificPassword);
    const nowIso = new Date().toISOString();
    const accountId = await upsertCalendarSyncAccount({
        accountLabel: input.accountLabel || 'Apple Calendar',
        appleCalendarHomeUrl: discovery.calendarHomeUrl,
        applePrincipalUrl: discovery.principalUrl,
        createdAt: nowIso,
        passwordCiphertext: encrypted.ciphertext,
        passwordKeyVersion: encrypted.keyVersion,
        provider: APPLE_CALDAV_PROVIDER,
        repairScanIntervalHours: getDefaultRepairScanIntervalHours(),
        selectedCalendarIds: discovery.calendars.map((calendar: any) => calendar.remoteCalendarId),
        status: 'active',
        syncWindowFutureDays: getDefaultSyncWindowFutureDays(),
        syncWindowPastDays: getDefaultSyncWindowPastDays(),
        updatedAt: nowIso,
        username: input.username,
    });
    await replaceCalendarSyncCalendars(accountId, discovery.calendars.map((calendar: any) => ({
        ...calendar,
        createdAt: nowIso,
        isEnabled: true,
        updatedAt: nowIso,
    })));
    return {
        accountId,
        discovery,
    };
}

export async function getAppleCalendarSyncStatus() {
    const accounts = (await listCalendarSyncAccounts()) as any[];
    const account = accounts.find((entry: any) => entry.provider === APPLE_CALDAV_PROVIDER) || null;
    if (!account) {
        return {
            configured: false,
            account: null,
            calendars: [],
            lastRun: null,
            polling: null,
        };
    }
    const calendars = await listCalendarSyncCalendars(account.id);
    const runs = await listRecentSyncRuns(account.id, 10);
    const pollPlan = getAppleCalendarSyncPollPlan({
        trigger: 'cron',
        recentRuns: runs,
        now: new Date(),
    });
    return {
        configured: true,
        account,
        calendars,
        lastRun: runs[0] || null,
        polling: {
            due: pollPlan.due,
            lastSuccessfulPollAt: account.lastAttemptedSyncAt || '',
            nextPollAt: pollPlan.nextPollAt,
            nextPollInMs: pollPlan.nextPollInMs,
            pollIntervalMs: pollPlan.intervalMs,
            pollReason: pollPlan.reason,
            quietStreak: pollPlan.quietStreak,
            failureStreak: pollPlan.failureStreak,
        },
    };
}

export async function updateAppleCalendarSyncSettings(input: {
    accountId: string;
    selectedCalendarIds: string[];
    enabled: boolean;
    syncWindowPastDays?: number;
    syncWindowFutureDays?: number;
}) {
    const account = await getCalendarSyncAccount(input.accountId) as any;
    if (!account) {
        throw new Error('Calendar sync account not found');
    }

    const allCalendars = (await listCalendarSyncCalendars(input.accountId)) as any[];
    const selected = new Set(input.selectedCalendarIds || []);
    const nowIso = new Date().toISOString();

    await upsertCalendarSyncAccount({
        ...account,
        status: input.enabled ? 'active' : 'disabled',
        selectedCalendarIds: Array.from(selected),
        syncWindowPastDays: input.syncWindowPastDays || account.syncWindowPastDays || getDefaultSyncWindowPastDays(),
        syncWindowFutureDays: input.syncWindowFutureDays || account.syncWindowFutureDays || getDefaultSyncWindowFutureDays(),
        updatedAt: nowIso,
    });

    await replaceCalendarSyncCalendars(
        input.accountId,
        allCalendars.map((calendar: any) => ({
            ...calendar,
            isEnabled: selected.has(calendar.remoteCalendarId) && input.enabled,
            updatedAt: nowIso,
        }))
    );
}

export async function runAppleCalendarSync(input: { accountId?: string; trigger?: string }) {
    const status = await getAppleCalendarSyncStatus();
    const account = (input.accountId
        ? await getCalendarSyncAccount(input.accountId)
        : status.account) as any;
    const requestAtIso = new Date().toISOString();

    if (!account) {
        throw new Error('Apple Calendar sync is not configured');
    }
    if (account.status !== 'active') {
        await recordAppleCalendarPollHeartbeat(account, requestAtIso);
        return {
            skipped: true,
            reason: 'disabled',
            pollIntervalMs: getCalendarSyncActivePollMs(),
        };
    }

    const recentRuns = await listRecentSyncRuns(account.id, 10);
    const preRunPollPlan = getAppleCalendarSyncPollPlan({
        trigger: input.trigger,
        recentRuns,
        now: new Date(),
    });
    if (!preRunPollPlan.due) {
        await recordAppleCalendarPollHeartbeat(account, requestAtIso);
        return {
            skipped: true,
            reason: 'not_due',
            nextPollAt: preRunPollPlan.nextPollAt,
            nextPollInMs: preRunPollPlan.nextPollInMs,
            pollIntervalMs: preRunPollPlan.intervalMs,
            pollReason: preRunPollPlan.reason,
            quietStreak: preRunPollPlan.quietStreak,
            failureStreak: preRunPollPlan.failureStreak,
        };
    }

    const lockKey = `calendar-sync:apple:${account.id}`;
    const owner = randomUUID();
    const lock = await acquireCalendarSyncLock(lockKey, owner, new Date(Date.now() + getCalendarSyncLockTtlMs()).toISOString());
    if (!lock.acquired) {
        await recordAppleCalendarPollHeartbeat(account, requestAtIso);
        return { skipped: true, reason: 'already_running' };
    }

    const startedAt = new Date();
    const runId = await createSyncRun({
        accountId: account.id,
        provider: APPLE_CALDAV_PROVIDER,
        status: 'running',
        trigger: input.trigger || 'manual',
        startedAt: startedAt.toISOString(),
    });

    try {
        const password = decryptCalendarCredential(account.passwordCiphertext);
        const now = new Date();
        const nowIso = now.toISOString();
        const window = getCalendarSyncWindow(
            now,
            account.syncWindowPastDays || getDefaultSyncWindowPastDays(),
            account.syncWindowFutureDays || getDefaultSyncWindowFutureDays()
        );
        const existingCalendars = (await listCalendarSyncCalendars(account.id)) as any[];
        const discovery = await discoverAppleCalendars({
            username: account.username,
            password,
        });
        const calendars = mergeDiscoveredCalendars(account, existingCalendars, discovery.calendars, nowIso);
        await replaceCalendarSyncCalendars(account.id, persistableCalendarRows(calendars));

        let remoteEventsFetched = 0;
        let eventsCreated = 0;
        let eventsUpdated = 0;
        let eventsUnchanged = 0;
        let eventsCancelled = 0;
        let eventsMarkedDeleted = 0;

        for (const calendar of calendars.filter((entry: any) => entry.isEnabled && entry.remoteUrl)) {
            const forceRepair = shouldForceRepair(calendar, account, input.trigger, now);
            const ctagUnchanged =
                Boolean(calendar.lastCtag) &&
                Boolean(calendar.observedCtag) &&
                calendar.lastCtag === calendar.observedCtag;

            if (!forceRepair && ctagUnchanged) {
                continue;
            }

            let remoteEventsResult;
            const shouldUseIncremental = !forceRepair && Boolean(calendar.lastSyncToken);
            try {
                remoteEventsResult = await fetchCalendarEvents({
                    username: account.username,
                    password,
                    calendarUrl: calendar.remoteUrl,
                    rangeStartIso: window.rangeStartIso,
                    rangeEndIso: window.rangeEndIso,
                    syncToken: shouldUseIncremental ? calendar.lastSyncToken : '',
                });
            } catch (error: any) {
                if (error?.code !== 'invalid_sync_token') {
                    throw error;
                }
                remoteEventsResult = await fetchCalendarEvents({
                    username: account.username,
                    password,
                    calendarUrl: calendar.remoteUrl,
                    rangeStartIso: window.rangeStartIso,
                    rangeEndIso: window.rangeEndIso,
                });
            }

            remoteEventsFetched += remoteEventsResult.events.length;
            const seenSourceExternalIds = new Set<string>();
            const normalizedItems = remoteEventsResult.events.flatMap((remoteEvent: any) => {
                const parsed = parseCalendarResource({
                    accountId: account.id,
                    calendarId: calendar.remoteCalendarId,
                    calendarName: calendar.displayName,
                    href: remoteEvent.href,
                    etag: remoteEvent.etag,
                    ctag: calendar.lastCtag || '',
                    ics: remoteEvent.ics,
                    rangeStart: window.rangeStart,
                    rangeEnd: window.rangeEnd,
                    fallbackTimeZone: calendar.timeZone,
                });
                return parsed.map((entry: any) => {
                    const payload = buildInstantCalendarItemPayload(entry, nowIso);
                    seenSourceExternalIds.add(payload.sourceExternalId);
                    return payload;
                });
            });

            const stats = await upsertImportedCalendarItems({
                accountId: account.id,
                calendarId: calendar.remoteCalendarId,
                calendarName: calendar.displayName,
                ctag: calendar.observedCtag || calendar.lastCtag || '',
                items: normalizedItems,
                seenSourceExternalIds,
                nowIso,
                rangeStart: window.rangeStart,
                rangeEnd: window.rangeEnd,
                markMissingAsDeleted: remoteEventsResult.mode === 'full',
            });
            eventsCreated += stats.eventsCreated;
            eventsUpdated += stats.eventsUpdated;
            eventsUnchanged += stats.eventsUnchanged;
            eventsCancelled += stats.eventsCancelled;
            eventsMarkedDeleted += stats.eventsMarkedDeleted;

            if (remoteEventsResult.deletedHrefs.length > 0) {
                const deletedStats = await markImportedCalendarItemsDeletedByRemoteUrls({
                    accountId: account.id,
                    calendarId: calendar.remoteCalendarId,
                    remoteUrls: remoteEventsResult.deletedHrefs,
                    nowIso,
                });
                eventsMarkedDeleted += deletedStats.eventsMarkedDeleted;
            }

            calendar.lastCtag = calendar.observedCtag || calendar.lastCtag || '';
            calendar.lastSeenAt = nowIso;
            calendar.lastSuccessfulSyncAt = nowIso;
            calendar.lastSyncToken = remoteEventsResult.nextSyncToken || calendar.syncToken || calendar.lastSyncToken || '';
            calendar.updatedAt = nowIso;
        }

        await replaceCalendarSyncCalendars(account.id, persistableCalendarRows(calendars));

        const finishedAtIso = new Date().toISOString();
        await updateSyncRun(runId, {
            calendarsProcessed: calendars.filter((entry: any) => entry.isEnabled).length,
            durationMs: Date.now() - startedAt.getTime(),
            eventsCancelled,
            eventsCreated,
            eventsMarkedDeleted,
            eventsUnchanged,
            eventsUpdated,
            finishedAt: finishedAtIso,
            remoteEventsFetched,
            status: 'success',
        });
        await upsertCalendarSyncAccount({
            ...account,
            appleCalendarHomeUrl: discovery.calendarHomeUrl,
            applePrincipalUrl: discovery.principalUrl,
            lastAttemptedSyncAt: startedAt.toISOString(),
            lastErrorAt: '',
            lastErrorCode: '',
            lastErrorMessage: '',
            lastSuccessfulSyncAt: finishedAtIso,
            updatedAt: finishedAtIso,
        });

        const nextPollPlan = getAppleCalendarSyncPollPlan({
            trigger: 'cron',
            recentRuns: [{
                status: 'success',
                startedAt: startedAt.toISOString(),
                finishedAt: finishedAtIso,
                eventsCreated,
                eventsUpdated,
                eventsCancelled,
                eventsMarkedDeleted,
            }, ...recentRuns],
            now: new Date(finishedAtIso),
        });

        return {
            skipped: false,
            runId,
            calendarsProcessed: calendars.filter((entry: any) => entry.isEnabled).length,
            remoteEventsFetched,
            eventsCreated,
            eventsUpdated,
            eventsUnchanged,
            eventsCancelled,
            eventsMarkedDeleted,
            nextPollAt: nextPollPlan.nextPollAt,
            nextPollInMs: nextPollPlan.nextPollInMs,
            pollIntervalMs: nextPollPlan.intervalMs,
            pollReason: nextPollPlan.reason,
        };
    } catch (error: any) {
        const finishedAtIso = new Date().toISOString();
        await updateSyncRun(runId, {
            durationMs: Date.now() - startedAt.getTime(),
            errorCode: String(error?.status || 'sync_failed'),
            errorMessage: String(error?.message || 'Sync failed'),
            finishedAt: finishedAtIso,
            status: 'failed',
        });
        await upsertCalendarSyncAccount({
            ...account,
            appleCalendarHomeUrl: account.appleCalendarHomeUrl || '',
            applePrincipalUrl: account.applePrincipalUrl || '',
            lastAttemptedSyncAt: startedAt.toISOString(),
            lastErrorAt: finishedAtIso,
            lastErrorCode: String(error?.status || 'sync_failed'),
            lastErrorMessage: String(error?.message || 'Sync failed'),
            updatedAt: finishedAtIso,
        });
        throw error;
    } finally {
        await releaseCalendarSyncLock(lock.lockId);
    }
}
