import 'server-only';

import { randomUUID } from 'crypto';
import { discoverAppleCalendars, fetchCalendarEvents } from '@/lib/apple-caldav/client';
import {
    APPLE_CALDAV_PROVIDER,
    getCalendarSyncLockTtlMs,
    getCalendarSyncWindow,
    getDefaultRepairScanIntervalHours,
    getDefaultSyncWindowFutureDays,
    getDefaultSyncWindowPastDays,
} from '@/lib/apple-caldav/config';
import { decryptCalendarCredential, encryptCalendarCredential } from '@/lib/apple-caldav/crypto';
import { parseCalendarResource } from '@/lib/apple-caldav/ics';
import { buildInstantCalendarItemPayload } from '@/lib/apple-caldav/mapper';
import {
    acquireCalendarSyncLock,
    createSyncRun,
    getCalendarSyncAccount,
    listCalendarSyncAccounts,
    listCalendarSyncCalendars,
    listRecentSyncRuns,
    releaseCalendarSyncLock,
    replaceCalendarSyncCalendars,
    updateSyncRun,
    upsertCalendarSyncAccount,
    upsertImportedCalendarItems,
} from '@/lib/apple-caldav/repository';

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
        };
    }
    const calendars = await listCalendarSyncCalendars(account.id);
    const runs = await listRecentSyncRuns(account.id);
    return {
        configured: true,
        account,
        calendars,
        lastRun: runs[0] || null,
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

    if (!account) {
        throw new Error('Apple Calendar sync is not configured');
    }
    if (account.status !== 'active') {
        return { skipped: true, reason: 'disabled' };
    }

    const lockKey = `calendar-sync:apple:${account.id}`;
    const owner = randomUUID();
    const lock = await acquireCalendarSyncLock(lockKey, owner, new Date(Date.now() + getCalendarSyncLockTtlMs()).toISOString());
    if (!lock.acquired) {
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
        const calendars = ((await listCalendarSyncCalendars(account.id)) as any[]).filter((calendar: any) => calendar.isEnabled);
        const password = decryptCalendarCredential(account.passwordCiphertext);
        const nowIso = new Date().toISOString();
        const window = getCalendarSyncWindow(
            new Date(),
            account.syncWindowPastDays || getDefaultSyncWindowPastDays(),
            account.syncWindowFutureDays || getDefaultSyncWindowFutureDays()
        );

        let remoteEventsFetched = 0;
        let eventsCreated = 0;
        let eventsUpdated = 0;
        let eventsUnchanged = 0;
        let eventsCancelled = 0;
        let eventsMarkedDeleted = 0;

        for (const calendar of calendars) {
            const remoteEvents = await fetchCalendarEvents({
                username: account.username,
                password,
                calendarUrl: calendar.remoteUrl,
                rangeStartIso: window.rangeStartIso,
                rangeEndIso: window.rangeEndIso,
            });
            remoteEventsFetched += remoteEvents.length;
            const seenSourceExternalIds = new Set<string>();
            const normalizedItems = remoteEvents.flatMap((remoteEvent: any) => {
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
                ctag: calendar.lastCtag || '',
                items: normalizedItems,
                seenSourceExternalIds,
                nowIso,
            });
            eventsCreated += stats.eventsCreated;
            eventsUpdated += stats.eventsUpdated;
            eventsUnchanged += stats.eventsUnchanged;
            eventsCancelled += stats.eventsCancelled;
            eventsMarkedDeleted += stats.eventsMarkedDeleted;
        }

        await updateSyncRun(runId, {
            calendarsProcessed: calendars.length,
            durationMs: Date.now() - startedAt.getTime(),
            eventsCancelled,
            eventsCreated,
            eventsMarkedDeleted,
            eventsUnchanged,
            eventsUpdated,
            finishedAt: new Date().toISOString(),
            remoteEventsFetched,
            status: 'success',
        });
        await upsertCalendarSyncAccount({
            ...account,
            lastAttemptedSyncAt: startedAt.toISOString(),
            lastErrorAt: '',
            lastErrorCode: '',
            lastErrorMessage: '',
            lastSuccessfulSyncAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });

        return {
            skipped: false,
            runId,
            calendarsProcessed: calendars.length,
            remoteEventsFetched,
            eventsCreated,
            eventsUpdated,
            eventsUnchanged,
            eventsCancelled,
            eventsMarkedDeleted,
        };
    } catch (error: any) {
        await updateSyncRun(runId, {
            durationMs: Date.now() - startedAt.getTime(),
            errorCode: String(error?.status || 'sync_failed'),
            errorMessage: String(error?.message || 'Sync failed'),
            finishedAt: new Date().toISOString(),
            status: 'failed',
        });
        await upsertCalendarSyncAccount({
            ...account,
            lastAttemptedSyncAt: startedAt.toISOString(),
            lastErrorAt: new Date().toISOString(),
            lastErrorCode: String(error?.status || 'sync_failed'),
            lastErrorMessage: String(error?.message || 'Sync failed'),
            updatedAt: new Date().toISOString(),
        });
        throw error;
    } finally {
        await releaseCalendarSyncLock(lock.lockId);
    }
}
