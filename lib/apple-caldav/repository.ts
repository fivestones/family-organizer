import 'server-only';

import { id } from '@instantdb/admin';
import { getInstantAdminDb } from '@/lib/instant-admin';

const INSTANT_TRANSACTION_BATCH_SIZE = 50;

function asArray<T>(value: T[] | undefined | null) {
    return Array.isArray(value) ? value : [];
}

function timestampMs(value: string | undefined | null) {
    const parsed = new Date(value || '').getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
}

function compareCalendarSyncCalendarRows(left: any, right: any) {
    const enabledDiff = Number(Boolean(right?.isEnabled)) - Number(Boolean(left?.isEnabled));
    if (enabledDiff !== 0) return enabledDiff;

    const remoteUrlDiff = Number(Boolean(right?.remoteUrl)) - Number(Boolean(left?.remoteUrl));
    if (remoteUrlDiff !== 0) return remoteUrlDiff;

    const lastSuccessfulDiff = timestampMs(right?.lastSuccessfulSyncAt) - timestampMs(left?.lastSuccessfulSyncAt);
    if (lastSuccessfulDiff !== 0) return lastSuccessfulDiff;

    const updatedDiff = timestampMs(right?.updatedAt) - timestampMs(left?.updatedAt);
    if (updatedDiff !== 0) return updatedDiff;

    const createdDiff = timestampMs(right?.createdAt) - timestampMs(left?.createdAt);
    if (createdDiff !== 0) return createdDiff;

    return String(left?.id || '').localeCompare(String(right?.id || ''));
}

export function dedupeCalendarSyncCalendarRows(rows: any[]) {
    const grouped = new Map<string, any[]>();
    for (const row of rows) {
        const key = String(row?.remoteCalendarId || '').trim();
        if (!key) continue;
        const list = grouped.get(key) || [];
        list.push(row);
        grouped.set(key, list);
    }

    return Array.from(grouped.values())
        .map((group) => [...group].sort(compareCalendarSyncCalendarRows)[0])
        .sort((left, right) => String(left?.displayName || '').localeCompare(String(right?.displayName || '')));
}

export function chunkForInstantTransact<T>(items: T[], batchSize = INSTANT_TRANSACTION_BATCH_SIZE) {
    const size = Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : INSTANT_TRANSACTION_BATCH_SIZE;
    const batches: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        batches.push(items.slice(index, index + size));
    }
    return batches;
}

async function transactInBatches(db: any, txs: any[]) {
    for (const batch of chunkForInstantTransact(txs)) {
        await db.transact(batch);
    }
}

export async function listCalendarSyncAccounts() {
    const db = getInstantAdminDb();
    const result = await db.query({ calendarSyncAccounts: {} });
    return asArray(result.calendarSyncAccounts);
}

export async function getCalendarSyncAccount(accountId: string) {
    const accounts = (await listCalendarSyncAccounts()) as any[];
    return accounts.find((account: any) => account.id === accountId) || null;
}

export async function listCalendarSyncCalendars(accountId: string) {
    const db = getInstantAdminDb();
    const result = await db.query({
        calendarSyncCalendars: {
            $: {
                where: { accountId },
            },
        },
    });
    return dedupeCalendarSyncCalendarRows(asArray(result.calendarSyncCalendars));
}

export async function upsertCalendarSyncAccount(input: any) {
    const db = getInstantAdminDb();
    const existing = input.id
        ? { id: input.id }
        : (await listCalendarSyncAccounts()).find((account: any) => account.provider === input.provider);
    const accountId = existing?.id || id();
    await db.transact([db.tx.calendarSyncAccounts[accountId].update(input)]);
    return accountId;
}

export async function replaceCalendarSyncCalendars(accountId: string, calendars: any[]) {
    const db = getInstantAdminDb();
    const rawExistingResult = await db.query({
        calendarSyncCalendars: {
            $: {
                where: { accountId },
            },
        },
    });
    const rawExisting = asArray(rawExistingResult.calendarSyncCalendars) as any[];
    const groupedExisting = new Map<string, any[]>();
    for (const item of rawExisting) {
        const key = String(item?.remoteCalendarId || '').trim();
        const list = groupedExisting.get(key) || [];
        list.push(item);
        groupedExisting.set(key, list);
    }

    const existingByRemoteId = new Map<string, any>();
    const duplicateIdsToDelete: string[] = [];
    for (const [remoteCalendarId, group] of Array.from(groupedExisting.entries())) {
        const ranked = [...group].sort(compareCalendarSyncCalendarRows);
        existingByRemoteId.set(remoteCalendarId, ranked[0]);
        duplicateIdsToDelete.push(...ranked.slice(1).map((item: any) => item.id));
    }
    const txs = calendars.map((calendar) => {
        const current = existingByRemoteId.get(calendar.remoteCalendarId);
        return db.tx.calendarSyncCalendars[current?.id || id()].update({
            accountId,
            ...calendar,
        });
    });
    txs.push(...duplicateIdsToDelete.map((rowId) => db.tx.calendarSyncCalendars[rowId].delete()));
    if (txs.length > 0) {
        await transactInBatches(db, txs);
    }
}

export async function createSyncRun(input: any) {
    const db = getInstantAdminDb();
    const runId = id();
    await db.transact([db.tx.calendarSyncRuns[runId].update(input)]);
    return runId;
}

export async function updateSyncRun(runId: string, patch: any) {
    const db = getInstantAdminDb();
    await db.transact([db.tx.calendarSyncRuns[runId].update(patch)]);
}

export async function listRecentSyncRuns(accountId: string, limit = 20) {
    const db = getInstantAdminDb();
    const result = await db.query({
        calendarSyncRuns: {
            $: {
                where: { accountId },
                order: { startedAt: 'desc' },
                limit,
            },
        },
    });
    return asArray(result.calendarSyncRuns);
}

export async function acquireCalendarSyncLock(lockKey: string, owner: string, expiresAtIso: string) {
    const db = getInstantAdminDb();
    const result = await db.query({
        calendarSyncLocks: {
            $: {
                where: { key: lockKey },
            },
        },
    });
    const existing = (asArray(result.calendarSyncLocks) as any[])[0] || null;
    if (existing && new Date(existing.expiresAt).getTime() > Date.now()) {
        return { acquired: false, lockId: existing.id };
    }
    const lockId = existing?.id || id();
    await db.transact([db.tx.calendarSyncLocks[lockId].update({ key: lockKey, owner, expiresAt: expiresAtIso, createdAt: existing?.createdAt || new Date().toISOString() })]);
    return { acquired: true, lockId };
}

export async function releaseCalendarSyncLock(lockId: string) {
    const db = getInstantAdminDb();
    await db.transact([db.tx.calendarSyncLocks[lockId].delete()]);
}

export async function listImportedCalendarItems(accountId: string, calendarId: string) {
    const db = getInstantAdminDb();
    const result = await db.query({
        calendarItems: {
            $: {
                where: {
                    sourceAccountKey: accountId,
                    sourceCalendarId: calendarId,
                },
            },
        },
    });
    return asArray(result.calendarItems);
}

function parseDateValue(value: string) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(`${value}T00:00:00.000Z`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

export function calendarItemIntersectsWindow(item: any, rangeStart: Date, rangeEnd: Date) {
    const start = parseDateValue(item.startDate);
    const end = parseDateValue(item.endDate);
    if (!start || !end) return false;
    return start < rangeEnd && end > rangeStart;
}

export async function upsertImportedCalendarItems(input: {
    accountId: string;
    calendarId: string;
    calendarName: string;
    ctag?: string;
    items: any[];
    seenSourceExternalIds: Set<string>;
    nowIso: string;
    rangeStart: Date;
    rangeEnd: Date;
    markMissingAsDeleted?: boolean;
    hardDeleteMissingRows?: boolean;
}) {
    const db = getInstantAdminDb();
    const existing = (await listImportedCalendarItems(input.accountId, input.calendarId)) as any[];
    const existingBySourceId = new Map(existing.map((item: any) => [item.sourceExternalId, item]));

    let eventsCreated = 0;
    let eventsUpdated = 0;
    let eventsUnchanged = 0;
    let eventsCancelled = 0;
    let eventsMarkedDeleted = 0;

    const txs = [];
    for (const item of input.items) {
        const existingItem = existingBySourceId.get(item.sourceExternalId);
        if (existingItem?.sourceRawHash === item.sourceRawHash) {
            eventsUnchanged += 1;
            txs.push(db.tx.calendarItems[existingItem.id].update({
                sourceLastSeenAt: input.nowIso,
                sourceRemoteEtag: item.sourceRemoteEtag,
                sourceRemoteCtag: input.ctag || item.sourceRemoteCtag || '',
                sourceCalendarName: input.calendarName,
                sourceSyncStatus: item.sourceSyncStatus,
                status: item.status,
            }));
            continue;
        }
        txs.push(db.tx.calendarItems[existingItem?.id || id()].update({
            ...item,
            sourceRemoteCtag: input.ctag || item.sourceRemoteCtag || '',
            sourceCalendarName: input.calendarName,
        }));
        if (item.status === 'cancelled' || item.sourceSyncStatus === 'cancelled') {
            eventsCancelled += 1;
        }
        if (existingItem) eventsUpdated += 1;
        else eventsCreated += 1;
    }

    if (input.markMissingAsDeleted !== false) {
        for (const existingItem of existing) {
            if (input.seenSourceExternalIds.has(existingItem.sourceExternalId)) continue;
            if (existingItem.sourceSyncStatus === 'deleted-remote') continue;
            if (!calendarItemIntersectsWindow(existingItem, input.rangeStart, input.rangeEnd)) continue;
            if (input.hardDeleteMissingRows === true) {
                txs.push(db.tx.calendarItems[existingItem.id].delete());
            } else {
                txs.push(db.tx.calendarItems[existingItem.id].update({
                    sourceSyncStatus: 'deleted-remote',
                    status: 'cancelled',
                    sourceLastSeenAt: input.nowIso,
                }));
            }
            eventsMarkedDeleted += 1;
        }
    }

    if (txs.length > 0) {
        await transactInBatches(db, txs);
    }

    return {
        eventsCreated,
        eventsUpdated,
        eventsUnchanged,
        eventsCancelled,
        eventsMarkedDeleted,
    };
}

export async function markImportedCalendarItemsDeletedByRemoteUrls(input: {
    accountId: string;
    calendarId: string;
    remoteUrls: string[];
    nowIso: string;
}) {
    if (input.remoteUrls.length === 0) {
        return { eventsMarkedDeleted: 0 };
    }

    const db = getInstantAdminDb();
    const existing = (await listImportedCalendarItems(input.accountId, input.calendarId)) as any[];
    const remoteUrlSet = new Set(input.remoteUrls);
    const targets = existing.filter((item: any) =>
        item.sourceRemoteUrl &&
        remoteUrlSet.has(item.sourceRemoteUrl) &&
        item.sourceSyncStatus !== 'deleted-remote'
    );

    if (targets.length === 0) {
        return { eventsMarkedDeleted: 0 };
    }

    await transactInBatches(
        db,
        targets.map((item: any) => db.tx.calendarItems[item.id].update({
            sourceSyncStatus: 'deleted-remote',
            status: 'cancelled',
            sourceLastSeenAt: input.nowIso,
        }))
    );

    return { eventsMarkedDeleted: targets.length };
}
