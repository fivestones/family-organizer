import 'server-only';

import { createHash, randomUUID } from 'crypto';
import { sql, type Selectable } from 'kysely';
import type { CalendarItemsTable, CalendarSyncAccountsTable, CalendarSyncCalendarsTable, CalendarSyncRunsTable } from '@/db/types';
import { isIgnoredAppleCalendarDisplayName } from '@/lib/apple-caldav/calendar-filter';
import { discoverAppleCalendars, fetchCalendarCollectionMetadata, fetchCalendarEvents } from '@/lib/apple-caldav/client';
import {
    APPLE_CALDAV_PROVIDER,
    getCalendarSyncActivePollMs,
    getCalendarSyncDiscoveryRefreshMs,
    getCalendarSyncWindow,
    getDefaultRepairScanIntervalHours,
    getDefaultSyncWindowFutureDays,
    getDefaultSyncWindowPastDays,
} from '@/lib/apple-caldav/config';
import { decryptCalendarCredential, encryptCalendarCredential } from '@/lib/apple-caldav/crypto';
import { parseCalendarResource } from '@/lib/apple-caldav/ics';
import { getAppleCalendarSyncPollPlan } from '@/lib/apple-caldav/polling';
import { calendarItemIntersectsWindow } from '@/lib/apple-caldav/window';
import { buildCalendarHistoryMetadata, buildCalendarHistorySnapshot } from '@/lib/calendar-history';
import { jsonb, type AppDatabase } from './db';
import { recordHistory } from './history';

// Bringing events in from an Apple Calendar account (docs/powersync-migration.md, "The server on Postgres").
//
// A run asks the account what has changed and writes it to `calendar_items`, where every device sees it. What the
// import alone needs to know about an event — when it last saw it, the tag the account gave it — is kept beside
// the event in a table no device is sent, so that looking at an unchanged event sends nobody anything.
//
// One run at a time for an account: a run holds an advisory lock on a connection of its own for as long as it
// lasts, and the lock goes with the connection if the server stops.

type Account = Selectable<CalendarSyncAccountsTable>;
type Calendar = Selectable<CalendarSyncCalendarsTable>;
type Run = Selectable<CalendarSyncRunsTable>;
type Item = Selectable<CalendarItemsTable>;

/** The account's side of the conversation. Tests give their own. */
export interface CalDavClient {
    discover: typeof discoverAppleCalendars;
    fetchEvents: typeof fetchCalendarEvents;
    fetchMetadata: typeof fetchCalendarCollectionMetadata;
}

const REAL_CLIENT: CalDavClient = { discover: discoverAppleCalendars, fetchEvents: fetchCalendarEvents, fetchMetadata: fetchCalendarCollectionMetadata };

interface Options {
    client?: CalDavClient;
    now?: Date;
}

/** A run's log is kept for this long; a run that failed or changed an event is kept for good. */
export const SYNC_RUN_LOG_DAYS = 30;
const DAY_MS = 86_400_000;
/** The first of the two numbers an advisory lock is known by. The second is made from the account's id. */
const LOCK_CLASS = 7140;

// ---- What the screens are told ----

const accountView = (account: Account) => ({
    id: account.id,
    provider: account.provider,
    accountLabel: account.account_label,
    username: account.username,
    status: account.status,
    selectedCalendarIds: account.selected_calendar_ids,
    syncWindowPastDays: account.sync_window_past_days,
    syncWindowFutureDays: account.sync_window_future_days,
    repairScanIntervalHours: account.repair_scan_interval_hours,
    lastAttemptedSyncAt: account.last_attempted_sync_at,
    lastSuccessfulSyncAt: account.last_successful_sync_at,
    lastErrorAt: account.last_error_at,
    lastErrorCode: account.last_error_code,
    lastErrorMessage: account.last_error_message,
});

const calendarView = (calendar: Calendar) => ({
    id: calendar.id,
    remoteCalendarId: calendar.remote_calendar_id,
    displayName: calendar.display_name,
    description: calendar.description,
    color: calendar.color,
    timeZone: calendar.time_zone,
    isEnabled: calendar.is_enabled,
    lastSeenAt: calendar.last_seen_at,
    lastSuccessfulSyncAt: calendar.last_successful_sync_at,
});

const runView = (run: Run) => ({
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    durationMs: run.duration_ms === null ? null : Number(run.duration_ms),
    calendarsProcessed: run.calendars_processed,
    remoteEventsFetched: run.remote_events_fetched,
    eventsCreated: run.events_created,
    eventsUpdated: run.events_updated,
    eventsUnchanged: run.events_unchanged,
    eventsCancelled: run.events_cancelled,
    eventsMarkedDeleted: run.events_marked_deleted,
    errorCode: run.error_code,
    errorMessage: run.error_message,
});

// ---- Reading ----

const theAccount = (db: AppDatabase) => db.selectFrom('calendar_sync_accounts').selectAll().where('provider', '=', APPLE_CALDAV_PROVIDER).orderBy('created_at').executeTakeFirst();

async function calendarsOf(db: AppDatabase, accountId: string): Promise<Calendar[]> {
    const rows = await db.selectFrom('calendar_sync_calendars').selectAll().where('account_id', '=', accountId).orderBy('display_name').orderBy('remote_calendar_id').execute();
    return rows.filter((calendar) => !isIgnoredAppleCalendarDisplayName(calendar.display_name));
}

const recentRuns = (db: AppDatabase, accountId: string, limit = 10) =>
    db.selectFrom('calendar_sync_runs').selectAll().where('account_id', '=', accountId).orderBy('started_at', 'desc').limit(limit).execute();

const latest = (...instants: Array<string | null>) => instants.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;

/** What the settings screen shows: the account, its calendars, the last run, and when the next is due. */
export async function getCalendarSyncStatus(db: AppDatabase, now: Date = new Date()) {
    const serverNow = now.toISOString();
    const account = await theAccount(db);
    if (!account) return { configured: false as const, serverNow, account: null, calendars: [], lastRun: null, polling: null };
    const runs = (await recentRuns(db, account.id)).map(runView);
    const plan = getAppleCalendarSyncPollPlan({ trigger: 'cron', recentRuns: runs, now });
    return {
        configured: true as const,
        serverNow,
        account: accountView(account),
        calendars: (await calendarsOf(db, account.id)).map(calendarView),
        lastRun: runs[0] ?? null,
        polling: {
            due: plan.due,
            lastSuccessfulPollAt: latest(account.last_attempted_sync_at, account.last_successful_sync_at),
            nextPollAt: plan.nextPollAt,
            nextPollInMs: plan.nextPollInMs,
            pollIntervalMs: plan.intervalMs,
            pollReason: plan.reason,
            quietStreak: plan.quietStreak,
            failureStreak: plan.failureStreak,
        },
    };
}

// ---- The account and its calendars ----

/** A calendar's time zone arrives as a whole iCalendar description of it. Its name is what is kept. */
function zoneName(value: unknown): string | null {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return null;
    if (!/BEGIN:VTIMEZONE/i.test(text)) return text;
    return /^TZID:(.+)$/im.exec(text)?.[1]?.trim() || null;
}

interface DiscoveredCalendar {
    remoteCalendarId: string;
    remoteUrl?: string;
    displayName?: string;
    description?: string;
    color?: string;
    timeZone?: string;
    ctag?: string;
    syncToken?: string;
}

/**
 * Records what the account says its calendars are. One that is new is added, one already known keeps what the
 * import has learned about it, and one the account no longer has is switched off and kept, with its events.
 */
async function recordDiscovery(db: AppDatabase, account: Pick<Account, 'id' | 'status' | 'selected_calendar_ids'>, discovered: readonly DiscoveredCalendar[], now: Date): Promise<void> {
    await db.transaction().execute(async (trx) => {
        const known = await trx.selectFrom('calendar_sync_calendars').select(['remote_calendar_id', 'is_enabled']).where('account_id', '=', account.id).execute();
        // What was chosen, or, for an account from before choices were recorded, what is switched on.
        const chosen = new Set(account.selected_calendar_ids.length > 0 ? account.selected_calendar_ids : known.filter((calendar) => calendar.is_enabled).map((calendar) => calendar.remote_calendar_id));
        for (const calendar of discovered) {
            const enabled = chosen.has(calendar.remoteCalendarId) && account.status === 'active';
            await trx
                .insertInto('calendar_sync_calendars')
                .values({
                    id: randomUUID(),
                    account_id: account.id,
                    remote_calendar_id: calendar.remoteCalendarId,
                    remote_url: calendar.remoteUrl || null,
                    display_name: calendar.displayName || 'Apple Calendar',
                    description: calendar.description || null,
                    color: calendar.color || null,
                    time_zone: zoneName(calendar.timeZone),
                    is_enabled: enabled,
                    last_ctag: calendar.ctag || null,
                    last_sync_token: calendar.syncToken || null,
                    last_seen_at: now,
                    created_at: now,
                    updated_at: now,
                })
                .onConflict((conflict) =>
                    conflict.columns(['account_id', 'remote_calendar_id']).doUpdateSet((row) => ({
                        remote_url: row.ref('excluded.remote_url'),
                        display_name: row.ref('excluded.display_name'),
                        description: row.ref('excluded.description'),
                        color: row.ref('excluded.color'),
                        time_zone: row.ref('excluded.time_zone'),
                        is_enabled: row.ref('excluded.is_enabled'),
                        last_ctag: sql<string | null>`COALESCE(excluded.last_ctag, calendar_sync_calendars.last_ctag)`,
                        last_sync_token: sql<string | null>`COALESCE(excluded.last_sync_token, calendar_sync_calendars.last_sync_token)`,
                        last_seen_at: now,
                        updated_at: now,
                    }))
                )
                .execute();
        }
        const gone = known.map((calendar) => calendar.remote_calendar_id).filter((id) => !discovered.some((calendar) => calendar.remoteCalendarId === id));
        if (gone.length > 0) {
            await trx.updateTable('calendar_sync_calendars').set({ is_enabled: false, updated_at: now }).where('account_id', '=', account.id).where('remote_calendar_id', 'in', gone).execute();
        }
    });
}

/** Connects the family's Apple account, or connects it again with a new password. What was chosen before stays chosen. */
export async function connectCalendarAccount(db: AppDatabase, input: { username: string; appSpecificPassword: string; accountLabel?: string }, options: Options = {}) {
    const now = options.now ?? new Date();
    const discovery = await (options.client ?? REAL_CLIENT).discover({ username: input.username, password: input.appSpecificPassword });
    const encrypted = encryptCalendarCredential(input.appSpecificPassword);
    const existing = await theAccount(db);
    const accountId = existing?.id ?? randomUUID();
    const connection = {
        account_label: input.accountLabel || 'Apple Calendar',
        username: input.username,
        password_ciphertext: encrypted.ciphertext,
        password_key_version: encrypted.keyVersion,
        apple_principal_url: discovery.principalUrl || null,
        apple_calendar_home_url: discovery.calendarHomeUrl || null,
        status: 'active',
        sync_window_past_days: getDefaultSyncWindowPastDays(),
        sync_window_future_days: getDefaultSyncWindowFutureDays(),
        repair_scan_interval_hours: getDefaultRepairScanIntervalHours(),
        updated_at: now,
    };
    if (existing) await db.updateTable('calendar_sync_accounts').set(connection).where('id', '=', accountId).execute();
    else await db.insertInto('calendar_sync_accounts').values({ id: accountId, provider: APPLE_CALDAV_PROVIDER, created_at: now, ...connection }).execute();

    await recordDiscovery(db, { id: accountId, status: 'active', selected_calendar_ids: existing?.selected_calendar_ids ?? [] }, discovery.calendars as DiscoveredCalendar[], now);
    return { accountId, principalUrl: discovery.principalUrl, calendarHomeUrl: discovery.calendarHomeUrl, calendars: (await calendarsOf(db, accountId)).map(calendarView) };
}

/** Chooses which calendars are brought in, how far back and ahead to look, and whether the import runs at all. */
export async function updateCalendarSyncSettings(
    db: AppDatabase,
    input: { accountId: string; selectedCalendarIds: string[]; enabled: boolean; syncWindowPastDays?: number; syncWindowFutureDays?: number },
    now: Date = new Date()
): Promise<void> {
    const chosen = Array.from(new Set(input.selectedCalendarIds));
    await db.transaction().execute(async (trx) => {
        const account = /^[0-9a-f-]{36}$/i.test(input.accountId) ? await trx.selectFrom('calendar_sync_accounts').selectAll().where('id', '=', input.accountId).forUpdate().executeTakeFirst() : undefined;
        if (!account) throw new Error('Calendar sync account not found');
        await trx
            .updateTable('calendar_sync_accounts')
            .set({
                status: input.enabled ? 'active' : 'disabled',
                selected_calendar_ids: chosen,
                sync_window_past_days: input.syncWindowPastDays || account.sync_window_past_days || getDefaultSyncWindowPastDays(),
                sync_window_future_days: input.syncWindowFutureDays || account.sync_window_future_days || getDefaultSyncWindowFutureDays(),
                updated_at: now,
            })
            .where('id', '=', account.id)
            .execute();
        await trx
            .updateTable('calendar_sync_calendars')
            .set({ is_enabled: input.enabled && chosen.length > 0 ? sql<boolean>`remote_calendar_id = ANY(${chosen})` : false, updated_at: now })
            .where('account_id', '=', account.id)
            .execute();
    });
}

// ---- An event, as the account gives it and as the database holds it ----

/** An event as the parser hands it over: iCalendar's own vocabulary, a rule with its label, a day's event flagged. */
type ParsedEvent = ReturnType<typeof parseCalendarResource>[number];

/** The columns of an event that come from the account. Everything else on its row is the family's own. */
type Imported = Pick<
    Item,
    | 'title' | 'description' | 'location' | 'url' | 'start_date' | 'end_date' | 'starts_at' | 'ends_at' | 'time_zone' | 'status' | 'transparency'
    | 'uid' | 'sequence' | 'dtstamp' | 'last_modified' | 'rrule' | 'rdates' | 'exdates' | 'recurring_event_id' | 'recurrence_id'
    | 'organizer' | 'attendees' | 'alarms' | 'x_props' | 'source_sync_status' | 'source_calendar_name' | 'source_external_id' | 'source_remote_url'
>; // prettier-ignore

const instantOrNull = (value: unknown): string | null => {
    const time = typeof value === 'string' && value ? Date.parse(value) : Number.NaN;
    return Number.isNaN(time) ? null : new Date(time).toISOString();
};
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const listOrNull = (value: unknown): unknown[] | null => (Array.isArray(value) && value.length > 0 ? value : null);

function toImported(event: ParsedEvent, calendar: Calendar, masterId: string | null): Imported {
    const allDay = event.isAllDay === true;
    const status = String(event.status ?? '').toLowerCase();
    return {
        title: String(event.title ?? '').trim() || 'Untitled event',
        description: textOrNull(event.description),
        location: textOrNull(event.location),
        url: textOrNull(event.url),
        start_date: allDay ? event.startDate : null,
        end_date: allDay ? event.endDate : null,
        starts_at: allDay ? null : instantOrNull(event.startDate),
        ends_at: allDay ? null : instantOrNull(event.endDate),
        time_zone: zoneName(event.timeZone),
        status: status === 'tentative' || status === 'cancelled' ? status : 'confirmed',
        transparency: event.transparency === 'transparent' ? 'transparent' : 'opaque',
        uid: textOrNull(event.uid),
        sequence: Math.max(0, Math.trunc(Number(event.sequence) || 0)),
        dtstamp: instantOrNull(event.dtStamp),
        last_modified: instantOrNull(event.lastModified),
        rrule: textOrNull(event.rrule)?.replace(/^RRULE:/i, '') ?? null,
        rdates: Array.isArray(event.rdates) ? event.rdates.map(String) : [],
        exdates: Array.isArray(event.exdates) ? event.exdates.map(String) : [],
        recurring_event_id: masterId,
        recurrence_id: masterId ? String(event.recurrenceId) : null,
        organizer: event.organizer ?? null,
        attendees: listOrNull(event.attendees),
        alarms: listOrNull(event.alarms),
        x_props: event.xProps && Object.keys(event.xProps).length > 0 ? event.xProps : null,
        source_sync_status: event.sourceSyncStatus === 'cancelled' ? 'cancelled' : 'active',
        source_calendar_name: calendar.display_name,
        source_external_id: event.sourceExternalId,
        source_remote_url: textOrNull(event.sourceRemoteUrl),
    };
}

const IMPORTED_COLUMNS = [
    'title', 'description', 'location', 'url', 'start_date', 'end_date', 'starts_at', 'ends_at', 'time_zone', 'status', 'transparency',
    'uid', 'sequence', 'dtstamp', 'last_modified', 'rrule', 'rdates', 'exdates', 'recurring_event_id', 'recurrence_id',
    'organizer', 'attendees', 'alarms', 'x_props', 'source_sync_status', 'source_calendar_name', 'source_external_id', 'source_remote_url',
] as const satisfies ReadonlyArray<keyof Imported>; // prettier-ignore

/** One form for a value however its keys were ordered, so that two documents that say the same thing compare equal. */
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as object).sort().map((key) => [key, canonical((value as Record<string, unknown>)[key])]));
    return value ?? null;
}
const fingerprint = (row: Imported): string => createHash('sha256').update(JSON.stringify(IMPORTED_COLUMNS.map((column) => canonical(row[column])))).digest('hex');

/** An event row as the insert and the update send it: documents as JSON, everything else as it is. */
const forWriting = (row: Imported) => ({ ...row, organizer: jsonb(row.organizer), attendees: jsonb(row.attendees), alarms: jsonb(row.alarms), x_props: jsonb(row.x_props) });

const asParsed = (item: Item) => ({
    isAllDay: item.start_date !== null,
    startDate: item.start_date ?? item.starts_at,
    endDate: item.end_date ?? item.ends_at,
    timeZone: item.time_zone,
    rrule: item.rrule ? `RRULE:${item.rrule}` : '',
    rdates: item.rdates,
    exdates: item.exdates,
});

interface Tally {
    eventsCreated: number;
    eventsUpdated: number;
    eventsUnchanged: number;
    eventsCancelled: number;
    eventsMarkedDeleted: number;
}

interface Batch {
    account: Account;
    calendar: Calendar;
    events: readonly ParsedEvent[];
    /** Addresses the account says are gone. */
    deletedUrls: readonly string[];
    /** True when the account was asked for everything in the window, so what it did not mention is gone. */
    complete: boolean;
    /** True for a repair: an event that is gone is removed outright unless the family has tagged it. */
    removeOutright: boolean;
    window: { rangeStart: Date; rangeEnd: Date };
    now: Date;
}

/** Writes what one calendar said in one run, as one transaction, with an entry in the family's history for each change. */
async function applyCalendarBatch(db: AppDatabase, batch: Batch): Promise<Tally> {
    const { account, calendar, now } = batch;
    const tally: Tally = { eventsCreated: 0, eventsUpdated: 0, eventsUnchanged: 0, eventsCancelled: 0, eventsMarkedDeleted: 0 };
    const history = (itemId: string, action: 'created' | 'updated' | 'deleted', title: string, before: Item | null, after: Imported | null) =>
        ({
            occurredAt: now,
            domain: 'calendar' as const,
            actionType: `calendar_event_${action}`,
            summary: `${action === 'created' ? 'Imported' : action === 'updated' ? 'Updated' : 'Deleted'} event "${title}"`,
            source: 'apple_sync',
            calendarItemId: itemId,
            metadata: buildCalendarHistoryMetadata({
                title,
                before: before ? buildCalendarHistorySnapshot(asParsed(before)) : null,
                after: after ? buildCalendarHistorySnapshot({ isAllDay: after.start_date !== null, startDate: after.start_date ?? after.starts_at, endDate: after.end_date ?? after.ends_at, timeZone: after.time_zone }) : null,
                extra: { sourceCalendarId: calendar.remote_calendar_id, sourceAccountId: account.id },
            }),
        });

    await db.transaction().execute(async (trx) => {
        // Everything this calendar has brought in before, and anything already standing for an event it now names.
        const ours = await trx.selectFrom('calendar_items as item').innerJoin('calendar_item_sync_state as state', 'state.calendar_item_id', 'item.id').selectAll('item').select(['state.raw_hash', 'state.remote_etag']).where('state.calendar_id', '=', calendar.id).execute();
        const named = batch.events.map((event) => event.sourceExternalId).filter((id) => !ours.some((item) => item.source_external_id === id));
        const strays = named.length > 0 ? await trx.selectFrom('calendar_items').selectAll().where('source_external_id', 'in', named).execute() : [];
        const known = new Map<string, Item & { raw_hash?: string | null; remote_etag?: string | null }>([...strays, ...ours].map((item) => [item.source_external_id!, item]));
        const idOf = new Map<string, string>(Array.from(known).map(([externalId, item]) => [externalId, item.id]));

        // An event before its changed occurrences, which name it.
        const inOrder = [...batch.events].sort((a, b) => Number(Boolean(a.recurringEventId)) - Number(Boolean(b.recurringEventId)));
        for (const event of inOrder) {
            const masterId = event.recurringEventId ? (idOf.get(event.recurringEventId) ?? null) : null;
            // An occurrence whose event the account did not send has nothing to belong to.
            if (event.recurringEventId && !masterId) continue;
            const next = toImported(event, calendar, masterId);
            if (next.start_date === null && next.starts_at === null) continue;
            const seen = { calendar_id: calendar.id, remote_etag: textOrNull(event.sourceRemoteEtag), remote_ctag: calendar.last_ctag, raw_hash: fingerprint(next), last_seen_at: now };
            const existing = known.get(next.source_external_id!) ?? null;

            if (existing && fingerprint(existing) === seen.raw_hash) {
                tally.eventsUnchanged += 1;
            } else if (existing) {
                await trx.updateTable('calendar_items').set({ ...forWriting(next), updated_at: now }).where('id', '=', existing.id).execute();
                await recordHistory(trx, history(existing.id, 'updated', next.title, existing, next));
                tally.eventsUpdated += 1;
            } else {
                const itemId = randomUUID();
                await trx.insertInto('calendar_items').values({ id: itemId, ...forWriting(next), source_type: 'apple-caldav', source_read_only: true, created_at: instantOrNull(event.createdAt) ?? now, updated_at: now }).execute();
                await recordHistory(trx, history(itemId, 'created', next.title, null, next));
                idOf.set(next.source_external_id!, itemId);
                tally.eventsCreated += 1;
            }
            if (!(existing && fingerprint(existing) === seen.raw_hash) && (next.status === 'cancelled' || next.source_sync_status === 'cancelled')) tally.eventsCancelled += 1;
            await trx
                .insertInto('calendar_item_sync_state')
                .values({ calendar_item_id: idOf.get(next.source_external_id!)!, imported_at: now, ...seen })
                .onConflict((conflict) => conflict.column('calendar_item_id').doUpdateSet(seen))
                .execute();
        }

        // What has gone from the account. It is marked and kept, so the family's tags and history stay attached.
        const mentioned = new Set(batch.events.map((event) => event.sourceExternalId));
        const urlsMentioned = new Map<string, Set<string>>();
        for (const event of batch.events) {
            const url = textOrNull(event.sourceRemoteUrl);
            if (url) urlsMentioned.set(url, (urlsMentioned.get(url) ?? new Set()).add(event.sourceExternalId));
        }
        const deletedUrls = new Set(batch.deletedUrls);
        const gone = ours.filter((item) => {
            if (item.source_sync_status === 'deleted-remote') return false;
            if (item.source_remote_url && deletedUrls.has(item.source_remote_url)) return true;
            if (mentioned.has(item.source_external_id!)) return false;
            if (batch.complete) return calendarItemIntersectsWindow(asParsed(item), batch.window.rangeStart, batch.window.rangeEnd);
            // Asked only for changes: an event is gone if the file it came from was sent again without it.
            return Boolean(item.source_remote_url && urlsMentioned.has(item.source_remote_url));
        });
        const tagged = batch.removeOutright && gone.length > 0 ? new Set((await trx.selectFrom('calendar_item_tags').select('calendar_item_id').where('calendar_item_id', 'in', gone.map((item) => item.id)).execute()).map((row) => row.calendar_item_id)) : new Set<string>();
        for (const item of gone) {
            if (batch.removeOutright && !tagged.has(item.id)) {
                await trx.deleteFrom('calendar_items').where('id', '=', item.id).execute();
            } else {
                await trx.updateTable('calendar_items').set({ source_sync_status: 'deleted-remote', status: 'cancelled', updated_at: now }).where('id', '=', item.id).execute();
                await trx.updateTable('calendar_item_sync_state').set({ last_seen_at: now }).where('calendar_item_id', '=', item.id).execute();
            }
            await recordHistory(trx, history(item.id, 'deleted', item.title, item, null));
            tally.eventsMarkedDeleted += 1;
        }
    });
    return tally;
}

// ---- A run ----

function repairIsDue(calendar: Calendar, account: Account, trigger: string, now: Date): boolean {
    if (trigger === 'repair' || !calendar.last_successful_sync_at) return true;
    const hours = account.repair_scan_interval_hours || getDefaultRepairScanIntervalHours();
    return now.getTime() - new Date(calendar.last_successful_sync_at).getTime() >= hours * 3_600_000;
}

/** Whether to ask the account again what calendars it has, which it is otherwise asked only now and then. */
function discoveryIsDue(account: Account, calendars: readonly Calendar[], now: Date): boolean {
    if (!account.apple_calendar_home_url || calendars.length === 0) return true;
    if (calendars.some((calendar) => calendar.is_enabled && !calendar.remote_url)) return true;
    const lastSeen = Math.max(0, ...calendars.map((calendar) => (calendar.last_seen_at ? new Date(calendar.last_seen_at).getTime() : 0)));
    return lastSeen <= 0 || now.getTime() - lastSeen >= getCalendarSyncDiscoveryRefreshMs();
}

/** Asks one calendar what it holds: only what changed since last time where that can be trusted, and everything otherwise. */
async function fetchFrom(client: CalDavClient, account: Account, calendar: Calendar, password: string, window: ReturnType<typeof getCalendarSyncWindow>, everything: boolean) {
    const ask = (syncToken: string) => client.fetchEvents({ username: account.username, password, calendarUrl: calendar.remote_url!, rangeStartIso: window.rangeStartIso, rangeEndIso: window.rangeEndIso, syncToken });
    const sinceLast = !everything && Boolean(calendar.last_sync_token);
    let metadata: { ctag?: string; syncToken?: string } | null = null;
    let answer;
    try {
        answer = await ask(sinceLast ? calendar.last_sync_token! : '');
        if (sinceLast && answer.events.length === 0 && answer.deletedHrefs.length === 0) {
            // Nothing changed, it says. If the calendar's own tags say otherwise, it is asked for everything.
            metadata = await client.fetchMetadata({ username: account.username, password, calendarUrl: calendar.remote_url! });
            const moved = (metadata?.ctag && metadata.ctag !== (calendar.last_ctag ?? '')) || (metadata?.syncToken && metadata.syncToken !== (calendar.last_sync_token ?? ''));
            if (moved) answer = await ask('');
        }
    } catch (error) {
        if ((error as { code?: string })?.code !== 'invalid_sync_token') throw error;
        answer = await ask('');
    }
    return { answer, metadata };
}

/**
 * Runs the import for the family's account, unless it is switched off, not yet due, or already running.
 * A failure is recorded on the run and on the account, and thrown.
 */
export async function runCalendarSync(pool: AppDatabase, input: { accountId?: string; trigger?: string }, options: Options = {}) {
    const client = options.client ?? REAL_CLIENT;
    const clock = () => options.now ?? new Date();
    const trigger = input.trigger || 'manual';

    // One connection for the whole run: the lock belongs to it, and is let go with it.
    return pool.connection().execute(async (db) => {
        const requestedAt = clock();
        const account = input.accountId && /^[0-9a-f-]{36}$/i.test(input.accountId) ? await db.selectFrom('calendar_sync_accounts').selectAll().where('id', '=', input.accountId).executeTakeFirst() : input.accountId ? undefined : await theAccount(db);
        if (!account) throw new Error('Apple Calendar sync is not configured');
        const heartbeat = () => db.updateTable('calendar_sync_accounts').set({ last_attempted_sync_at: requestedAt, updated_at: requestedAt }).where('id', '=', account.id).execute();
        const checkedAt = requestedAt.toISOString();

        if (account.status !== 'active') {
            await heartbeat();
            return { checkedAt, skipped: true as const, reason: 'disabled' as const, pollIntervalMs: getCalendarSyncActivePollMs() };
        }
        const earlier = (await recentRuns(db, account.id)).map(runView);
        const plan = getAppleCalendarSyncPollPlan({ trigger, recentRuns: earlier, now: requestedAt });
        if (!plan.due) {
            await heartbeat();
            return { checkedAt, skipped: true as const, reason: 'not_due' as const, nextPollAt: plan.nextPollAt, nextPollInMs: plan.nextPollInMs, pollIntervalMs: plan.intervalMs, pollReason: plan.reason, quietStreak: plan.quietStreak, failureStreak: plan.failureStreak };
        }
        const lock = await sql<{ held: boolean }>`SELECT pg_try_advisory_lock(${LOCK_CLASS}, hashtext(${account.id})) AS held`.execute(db);
        if (!lock.rows[0]?.held) {
            await heartbeat();
            return { checkedAt, skipped: true as const, reason: 'already_running' as const };
        }

        const startedAt = clock();
        const runId = randomUUID();
        try {
            await db.insertInto('calendar_sync_runs').values({ id: runId, account_id: account.id, provider: APPLE_CALDAV_PROVIDER, trigger, status: 'running', started_at: startedAt }).execute();
            const finish = async (run: Partial<Record<keyof CalendarSyncRunsTable, unknown>>, onAccount: Partial<Record<keyof CalendarSyncAccountsTable, unknown>>) => {
                const finishedAt = clock();
                await db.updateTable('calendar_sync_runs').set({ ...run, finished_at: finishedAt, duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()) } as never).where('id', '=', runId).execute();
                await db.updateTable('calendar_sync_accounts').set({ ...onAccount, last_attempted_sync_at: finishedAt, updated_at: finishedAt } as never).where('id', '=', account.id).execute();
                return finishedAt;
            };

            try {
                const now = clock();
                const password = decryptCalendarCredential(account.password_ciphertext);
                const window = getCalendarSyncWindow(now, account.sync_window_past_days || getDefaultSyncWindowPastDays(), account.sync_window_future_days || getDefaultSyncWindowFutureDays());
                let calendars = await calendarsOf(db, account.id);
                let found = { principalUrl: account.apple_principal_url, calendarHomeUrl: account.apple_calendar_home_url };
                if (discoveryIsDue(account, calendars, now)) {
                    const discovery = await client.discover({ username: account.username, password, principalUrl: account.apple_principal_url ?? '', calendarHomeUrl: account.apple_calendar_home_url ?? '' });
                    found = { principalUrl: discovery.principalUrl || found.principalUrl, calendarHomeUrl: discovery.calendarHomeUrl || found.calendarHomeUrl };
                    await recordDiscovery(db, account, discovery.calendars as DiscoveredCalendar[], now);
                    calendars = await calendarsOf(db, account.id);
                }

                const total: Tally & { remoteEventsFetched: number } = { remoteEventsFetched: 0, eventsCreated: 0, eventsUpdated: 0, eventsUnchanged: 0, eventsCancelled: 0, eventsMarkedDeleted: 0 };
                const enabled = calendars.filter((calendar) => calendar.is_enabled && calendar.remote_url);
                for (const calendar of enabled) {
                    try {
                        const { answer, metadata } = await fetchFrom(client, account, calendar, password, window, repairIsDue(calendar, account, trigger, now));
                        total.remoteEventsFetched += answer.events.length;
                        const events = answer.events.flatMap((resource) =>
                            parseCalendarResource({
                                accountId: account.id,
                                calendarId: calendar.remote_calendar_id,
                                calendarName: calendar.display_name,
                                href: resource.href,
                                etag: resource.etag,
                                ics: resource.ics,
                                rangeStart: window.rangeStart,
                                rangeEnd: window.rangeEnd,
                                fallbackTimeZone: calendar.time_zone ?? undefined,
                            })
                        );
                        const tally = await applyCalendarBatch(db, { account, calendar, events, deletedUrls: answer.deletedHrefs, complete: answer.mode === 'full', removeOutright: trigger === 'repair', window, now });
                        for (const key of Object.keys(tally) as Array<keyof Tally>) total[key] += tally[key];
                        await db
                            .updateTable('calendar_sync_calendars')
                            .set({ last_successful_sync_at: now, last_sync_token: answer.nextSyncToken || metadata?.syncToken || calendar.last_sync_token, last_ctag: metadata?.ctag || calendar.last_ctag, updated_at: now })
                            .where('id', '=', calendar.id)
                            .execute();
                    } catch (error) {
                        throw Object.assign(new Error(`Failed syncing Apple calendar "${calendar.display_name}" (${calendar.remote_calendar_id}): ${(error as Error)?.message || 'Unknown error'}`), { status: (error as { status?: unknown })?.status });
                    }
                }

                const counts = { calendars_processed: enabled.length, remote_events_fetched: total.remoteEventsFetched, events_created: total.eventsCreated, events_updated: total.eventsUpdated, events_unchanged: total.eventsUnchanged, events_cancelled: total.eventsCancelled, events_marked_deleted: total.eventsMarkedDeleted };
                const finishedAt = await finish(
                    { status: 'success', ...counts },
                    { apple_principal_url: found.principalUrl, apple_calendar_home_url: found.calendarHomeUrl, last_successful_sync_at: clock(), last_error_at: null, last_error_code: null, last_error_message: null }
                );
                pruneSyncRunsOccasionally(pool, finishedAt);
                const next = getAppleCalendarSyncPollPlan({ trigger: 'cron', recentRuns: [{ status: 'success', startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), ...total }, ...earlier], now: finishedAt });
                return { skipped: false as const, runId, startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), status: 'success' as const, calendarsProcessed: enabled.length, ...total, nextPollAt: next.nextPollAt, nextPollInMs: next.nextPollInMs, pollIntervalMs: next.intervalMs, pollReason: next.reason };
            } catch (error) {
                const code = String((error as { status?: unknown })?.status || 'sync_failed');
                const message = String((error as Error)?.message || 'Sync failed');
                await finish({ status: 'failed', error_code: code, error_message: message }, { last_error_at: clock(), last_error_code: code, last_error_message: message });
                throw error;
            }
        } finally {
            await sql`SELECT pg_advisory_unlock(${LOCK_CLASS}, hashtext(${account.id}))`.execute(db);
        }
    });
}

// ---- The log ----

/** Removes the log of runs older than a month in which nothing happened. Returns how many went. */
export async function pruneSyncRuns(db: AppDatabase, now: Date = new Date()): Promise<number> {
    const result = await db
        .deleteFrom('calendar_sync_runs')
        .where('started_at', '<', new Date(now.getTime() - SYNC_RUN_LOG_DAYS * DAY_MS).toISOString())
        .where('status', '=', 'success')
        .where(sql<boolean>`COALESCE(events_created, 0) + COALESCE(events_updated, 0) + COALESCE(events_cancelled, 0) + COALESCE(events_marked_deleted, 0) = 0`)
        .executeTakeFirst();
    return Number(result.numDeletedRows ?? 0);
}

let lastPruneAt = 0;
/** Prunes at most once a day for each running server, after a run. It is never waited for. */
function pruneSyncRunsOccasionally(db: AppDatabase, now: Date): void {
    if (now.getTime() - lastPruneAt < DAY_MS) return;
    lastPruneAt = now.getTime();
    void pruneSyncRuns(db, now).catch(() => {});
}
