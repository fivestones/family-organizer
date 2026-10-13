import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST as runRoute } from '@/app/api/calendar-sync/apple/run/route';
import { GET as statusRoute } from '@/app/api/calendar-sync/apple/status/route';
import { connectCalendarAccount, getCalendarSyncStatus, pruneSyncRuns, runCalendarSync, updateCalendarSyncSettings, type CalDavClient } from '@/lib/server/calendar-sync';
import { createSession } from '@/lib/server/sessions';
import { DANA, deviceRequest, ELI, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// The calendar import on Postgres, run against a pretend Apple account that hands over real iCalendar text.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOON = new Date('2026-03-09T12:00:00.000Z');
const later = (minutes: number) => new Date(NOON.getTime() + minutes * 60_000);
const HOME = 'https://caldav.example/1/calendars/home/';

const event = (uid: string, lines: string[]) => ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260301T000000Z', ...lines, 'END:VEVENT'].join('\r\n');
const file = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events, 'END:VCALENDAR'].join('\r\n');
const resource = (name: string, etag: string, ...events: string[]) => ({ href: `${HOME}${name}.ics`, etag, ics: file(...events) });

const dentist = (summary = 'Dentist') => resource('dentist', 'e1', event('dentist', ['DTSTART:20260310T150000Z', 'DTEND:20260310T160000Z', `SUMMARY:${summary}`, 'LOCATION:Main Street']));
const fair = () => resource('fair', 'e1', event('fair', ['DTSTART;VALUE=DATE:20260312', 'DTEND;VALUE=DATE:20260314', 'SUMMARY:School fair']));
const piano = () =>
    resource(
        'piano',
        'e1',
        event('piano', ['DTSTART:20260311T170000Z', 'DTEND:20260311T173000Z', 'RRULE:FREQ=WEEKLY;COUNT=6', 'SUMMARY:Piano']),
        event('piano', ['RECURRENCE-ID:20260318T170000Z', 'DTSTART:20260318T180000Z', 'DTEND:20260318T183000Z', 'SUMMARY:Piano (late)'])
    );

/** A pretend account: what it says its calendars are, and what the next question about events is answered with. */
function pretendAccount() {
    const asked: Array<{ syncToken?: string }> = [];
    const account = {
        asked,
        calendars: [
            { remoteCalendarId: 'home', remoteUrl: HOME, displayName: 'Home', color: '#ff0000', description: '', timeZone: 'BEGIN:VCALENDAR\r\nBEGIN:VTIMEZONE\r\nTZID:America/Chicago\r\nEND:VTIMEZONE\r\nEND:VCALENDAR', ctag: 'c1', syncToken: 't1' },
            { remoteCalendarId: 'work', remoteUrl: 'https://caldav.example/1/calendars/work/', displayName: 'Work', color: '', description: '', timeZone: '', ctag: 'w1', syncToken: 'u1' },
        ],
        answer: { mode: 'full' as 'full' | 'incremental', events: [] as Array<{ href: string; etag: string; ics: string }>, deletedHrefs: [] as string[], nextSyncToken: 't2' },
        metadata: { ctag: 'c1', syncToken: 't1' },
        fails: null as Error | null,
    };
    const client: CalDavClient = {
        discover: (async () => ({ principalUrl: 'https://caldav.example/1/principal/', calendarHomeUrl: 'https://caldav.example/1/calendars/', calendars: account.calendars })) as any,
        fetchEvents: (async (input: { syncToken?: string }) => {
            asked.push({ syncToken: input.syncToken });
            if (account.fails) throw account.fails;
            return account.answer;
        }) as any,
        fetchMetadata: (async () => account.metadata) as any,
    };
    return { account, client };
}

let database: TestDatabase;
let apple: ReturnType<typeof pretendAccount>;
let accountId: string;

beforeEach(async () => {
    process.env.CALDAV_CREDENTIAL_ENCRYPTION_KEY = 'a-test-key-for-calendar-passwords';
    database = await createTestDatabase();
    await seedFamily(database);
    apple = pretendAccount();
    ({ accountId } = await connectCalendarAccount(database.db, { username: 'dana@example.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop' }, { client: apple.client, now: NOON }));
    await updateCalendarSyncSettings(database.db, { accountId, selectedCalendarIds: ['home'], enabled: true }, NOON);
});
afterEach(async () => {
    delete process.env.CALENDAR_SYNC_CRON_SECRET;
    await database.close();
});

const rows = async <T = Record<string, any>>(text: string, params: unknown[] = []) => (await database.sql.query<T>(text, params as any[])).rows;
const run = (trigger: string, at: Date) => runCalendarSync(database.db, { trigger }, { client: apple.client, now: at });
const items = () => rows(`SELECT title, start_date, end_date, starts_at, ends_at, status, source_sync_status AS sync FROM calendar_items ORDER BY COALESCE(starts_at, start_date::timestamptz), title`);
const historyOf = () => rows(`SELECT action_type AS action, summary, source, actor_id AS actor FROM history_events ORDER BY summary`);

describe('connecting an account', () => {
    it('keeps the password encrypted, records the calendars it has by name and zone, and switches none on until one is chosen', async () => {
        await database.sql.exec(`DELETE FROM calendar_sync_accounts`);
        const connected = await connectCalendarAccount(database.db, { username: 'dana@example.com', appSpecificPassword: 'abcd-efgh-ijkl-mnop', accountLabel: 'Family iCloud' }, { client: apple.client, now: NOON });

        expect(await rows(`SELECT account_label, username, status, password_ciphertext LIKE '%abcd-efgh%' AS kept_plain, apple_calendar_home_url FROM calendar_sync_accounts`)).toEqual([
            { account_label: 'Family iCloud', username: 'dana@example.com', status: 'active', kept_plain: false, apple_calendar_home_url: 'https://caldav.example/1/calendars/' },
        ]);
        expect(await rows(`SELECT remote_calendar_id, display_name, time_zone, is_enabled, last_ctag, last_sync_token FROM calendar_sync_calendars ORDER BY 1`)).toEqual([
            { remote_calendar_id: 'home', display_name: 'Home', time_zone: 'America/Chicago', is_enabled: false, last_ctag: 'c1', last_sync_token: 't1' },
            { remote_calendar_id: 'work', display_name: 'Work', time_zone: null, is_enabled: false, last_ctag: 'w1', last_sync_token: 'u1' },
        ]);
        expect(connected.calendars.map((calendar) => calendar.displayName)).toEqual(['Home', 'Work']);
    });

    it('keeps what was chosen when the account is connected again, and what is shown never includes the password', async () => {
        await connectCalendarAccount(database.db, { username: 'dana@example.com', appSpecificPassword: 'new-pass-word-here' }, { client: apple.client, now: later(5) });

        const status = await getCalendarSyncStatus(database.db, later(5));
        expect(status.calendars.map((calendar) => [calendar.remoteCalendarId, calendar.isEnabled])).toEqual([['home', true], ['work', false]]);
        expect(status.account).toMatchObject({ id: accountId, username: 'dana@example.com', status: 'active', selectedCalendarIds: ['home'] });
        expect(JSON.stringify(status)).not.toMatch(/ciphertext|new-pass/);
        expect(await rows(`SELECT count(*)::integer AS n FROM calendar_sync_accounts`)).toEqual([{ n: 1 }]);
    });

    it('switches every calendar off when the import is switched off, and on again as chosen', async () => {
        await updateCalendarSyncSettings(database.db, { accountId, selectedCalendarIds: ['home', 'work'], enabled: false, syncWindowPastDays: 30 }, later(1));
        expect(await rows(`SELECT status, selected_calendar_ids, sync_window_past_days FROM calendar_sync_accounts`)).toEqual([{ status: 'disabled', selected_calendar_ids: ['home', 'work'], sync_window_past_days: 30 }]);
        expect(await rows(`SELECT bool_or(is_enabled) AS any_on FROM calendar_sync_calendars`)).toEqual([{ any_on: false }]);

        await updateCalendarSyncSettings(database.db, { accountId, selectedCalendarIds: ['work'], enabled: true }, later(2));
        expect(await rows(`SELECT remote_calendar_id, is_enabled FROM calendar_sync_calendars ORDER BY 1`)).toEqual([{ remote_calendar_id: 'home', is_enabled: false }, { remote_calendar_id: 'work', is_enabled: true }]);
        await expect(updateCalendarSyncSettings(database.db, { accountId: id(999), selectedCalendarIds: [], enabled: true })).rejects.toThrow('Calendar sync account not found');
    });
});

describe('a run', () => {
    it('brings in a timed event, a day\'s event and a repeating one with its changed occurrence, each as the calendar holds it', async () => {
        apple.account.answer.events = [dentist(), fair(), piano()];
        const result = await run('manual', later(10));

        expect(result).toMatchObject({ skipped: false, status: 'success', calendarsProcessed: 1, remoteEventsFetched: 3, eventsCreated: 4, eventsUpdated: 0, eventsUnchanged: 0, eventsMarkedDeleted: 0 });
        expect(await items()).toEqual([
            { title: 'Dentist', start_date: null, end_date: null, starts_at: '2026-03-10T15:00:00.000Z', ends_at: '2026-03-10T16:00:00.000Z', status: 'confirmed', sync: 'active' },
            { title: 'Piano', start_date: null, end_date: null, starts_at: '2026-03-11T17:00:00.000Z', ends_at: '2026-03-11T17:30:00.000Z', status: 'confirmed', sync: 'active' },
            { title: 'School fair', start_date: '2026-03-12', end_date: '2026-03-14', starts_at: null, ends_at: null, status: 'confirmed', sync: 'active' },
            { title: 'Piano (late)', start_date: null, end_date: null, starts_at: '2026-03-18T18:00:00.000Z', ends_at: '2026-03-18T18:30:00.000Z', status: 'confirmed', sync: 'active' },
        ]);
        // The rule without its label, and the changed occurrence held to its event.
        expect(await rows(`SELECT o.recurrence_id, m.title AS of, m.rrule, o.rrule AS own_rule FROM calendar_items o JOIN calendar_items m ON m.id = o.recurring_event_id`)).toEqual([
            { recurrence_id: '2026-03-18T17:00:00Z', of: 'Piano', rrule: 'FREQ=WEEKLY;COUNT=6', own_rule: null },
        ]);
        expect(await rows(`SELECT location, source_type, source_read_only, source_calendar_name, source_remote_url, transparency, time_zone FROM calendar_items WHERE title = 'Dentist'`)).toEqual([
            { location: 'Main Street', source_type: 'apple-caldav', source_read_only: true, source_calendar_name: 'Home', source_remote_url: `${HOME}dentist.ics`, transparency: 'opaque', time_zone: 'UTC' },
        ]);
        expect(await rows(`SELECT count(*)::integer AS n, bool_and(s.remote_etag = 'e1' AND s.raw_hash IS NOT NULL AND s.last_seen_at = $1) AS seen FROM calendar_item_sync_state s`, [later(10).toISOString()])).toEqual([{ n: 4, seen: true }]);
        expect(await historyOf()).toEqual([
            { action: 'calendar_event_created', summary: 'Imported event "Dentist"', source: 'apple_sync', actor: null },
            { action: 'calendar_event_created', summary: 'Imported event "Piano (late)"', source: 'apple_sync', actor: null },
            { action: 'calendar_event_created', summary: 'Imported event "Piano"', source: 'apple_sync', actor: null },
            { action: 'calendar_event_created', summary: 'Imported event "School fair"', source: 'apple_sync', actor: null },
        ]);
        expect(await rows(`SELECT trigger, status, events_created, remote_events_fetched, finished_at IS NOT NULL AS finished FROM calendar_sync_runs`)).toEqual([{ trigger: 'manual', status: 'success', events_created: 4, remote_events_fetched: 3, finished: true }]);
        expect(await rows(`SELECT last_successful_sync_at, last_error_message FROM calendar_sync_accounts`)).toEqual([{ last_successful_sync_at: later(10).toISOString(), last_error_message: null }]);
        expect(await rows(`SELECT last_sync_token, last_successful_sync_at FROM calendar_sync_calendars WHERE remote_calendar_id = 'home'`)).toEqual([{ last_sync_token: 't2', last_successful_sync_at: later(10).toISOString() }]);
    });

    it('writes nothing to an event that has not changed, however it came to be there', async () => {
        apple.account.answer.events = [dentist(), fair(), piano()];
        await run('manual', later(10));
        // As if these rows had come from the import of an InstantDB export, which fingerprints an event differently.
        await database.sql.exec(`UPDATE calendar_item_sync_state SET raw_hash = 'as-instant-wrote-it'; DELETE FROM history_events`);

        const again = await run('repair', later(20));

        expect(again).toMatchObject({ eventsCreated: 0, eventsUpdated: 0, eventsUnchanged: 4, eventsMarkedDeleted: 0 });
        expect(await rows(`SELECT count(*)::integer AS n FROM calendar_items WHERE updated_at <> $1`, [later(10).toISOString()])).toEqual([{ n: 0 }]);
        expect(await historyOf()).toEqual([]);
        expect(await rows(`SELECT count(*)::integer AS n FROM calendar_item_sync_state WHERE raw_hash <> 'as-instant-wrote-it' AND last_seen_at = $1`, [later(20).toISOString()])).toEqual([{ n: 4 }]);
    });

    it('asks only for what changed once it has a place to ask from, and applies a change and a removal', async () => {
        apple.account.answer.events = [dentist(), fair(), piano()];
        await run('manual', later(10));
        await database.sql.exec(`DELETE FROM history_events`);

        apple.account.answer = { mode: 'incremental', events: [dentist('Dentist (moved)')], deletedHrefs: [`${HOME}fair.ics`], nextSyncToken: 't3' };
        const result = await run('manual', later(20));

        expect(apple.account.asked.map((question) => question.syncToken)).toEqual(['', 't2']);
        expect(result).toMatchObject({ eventsCreated: 0, eventsUpdated: 1, eventsUnchanged: 0, eventsMarkedDeleted: 1 });
        expect((await items()).map((item) => [item.title, item.status, item.sync])).toEqual([
            ['Dentist (moved)', 'confirmed', 'active'],
            ['Piano', 'confirmed', 'active'],
            ['School fair', 'cancelled', 'deleted-remote'],
            ['Piano (late)', 'confirmed', 'active'],
        ]);
        expect(await historyOf()).toEqual([
            { action: 'calendar_event_deleted', summary: 'Deleted event "School fair"', source: 'apple_sync', actor: null },
            { action: 'calendar_event_updated', summary: 'Updated event "Dentist (moved)"', source: 'apple_sync', actor: null },
        ]);
        expect(await rows(`SELECT metadata->'calendarHistory'->'before'->>'startDate' AS was, metadata->>'sourceCalendarId' AS calendar FROM history_events WHERE action_type = 'calendar_event_deleted'`)).toEqual([{ was: '2026-03-12', calendar: 'home' }]);
    });

    it('asks for everything when the account says nothing changed and its own tags say otherwise', async () => {
        apple.account.answer.events = [dentist()];
        await run('manual', later(10));

        apple.account.answer = { mode: 'incremental', events: [], deletedHrefs: [], nextSyncToken: 't2' };
        apple.account.metadata = { ctag: 'c2', syncToken: 't9' };
        await run('manual', later(20));

        expect(apple.account.asked.map((question) => question.syncToken)).toEqual(['', 't2', '']);
        expect(await rows(`SELECT last_ctag, last_sync_token FROM calendar_sync_calendars WHERE remote_calendar_id = 'home'`)).toEqual([{ last_ctag: 'c2', last_sync_token: 't2' }]);
    });

    it('takes an event the account no longer has as gone: marked and kept, or on a repair removed unless the family tagged it', async () => {
        apple.account.answer.events = [dentist(), fair(), piano()];
        await run('manual', later(10));
        await database.sql.exec(`
            INSERT INTO calendar_tags (id, name) VALUES ('${id(500)}', 'Health');
            INSERT INTO calendar_item_tags (calendar_item_id, tag_id) SELECT id, '${id(500)}' FROM calendar_items WHERE title = 'Dentist';
        `);

        apple.account.answer = { mode: 'full', events: [piano()], deletedHrefs: [], nextSyncToken: 't3' };
        const repaired = await run('repair', later(20));

        expect(repaired).toMatchObject({ eventsUnchanged: 2, eventsMarkedDeleted: 2 });
        expect((await items()).map((item) => [item.title, item.sync])).toEqual([['Dentist', 'deleted-remote'], ['Piano', 'active'], ['Piano (late)', 'active']]);
        // Already marked as gone, it is not marked again.
        expect(await run('repair', later(30))).toMatchObject({ eventsMarkedDeleted: 0 });
    });

    it('does not run when the import is switched off or not yet due, and says which', async () => {
        apple.account.answer.events = [dentist()];
        await run('manual', later(10));

        expect(await run('cron', later(10.1))).toMatchObject({ skipped: true, reason: 'not_due' });
        await updateCalendarSyncSettings(database.db, { accountId, selectedCalendarIds: ['home'], enabled: false }, later(11));
        expect(await run('manual', later(12))).toMatchObject({ skipped: true, reason: 'disabled' });

        expect(apple.account.asked).toHaveLength(1);
        expect(await rows(`SELECT count(*)::integer AS n FROM calendar_sync_runs`)).toEqual([{ n: 1 }]);
        expect(await rows(`SELECT last_attempted_sync_at FROM calendar_sync_accounts`)).toEqual([{ last_attempted_sync_at: later(12).toISOString() }]);
    });

    it('records a failure on the run and the account, keeps what it had, and runs again afterwards', async () => {
        apple.account.answer.events = [dentist()];
        await run('manual', later(10));
        apple.account.fails = Object.assign(new Error('The account is not answering'), { status: 503 });

        await expect(run('repair', later(20))).rejects.toThrow('Failed syncing Apple calendar "Home" (home): The account is not answering');

        expect(await rows(`SELECT status, error_code, error_message FROM calendar_sync_runs ORDER BY started_at DESC LIMIT 1`)).toEqual([{ status: 'failed', error_code: '503', error_message: 'Failed syncing Apple calendar "Home" (home): The account is not answering' }]);
        expect(await rows(`SELECT last_error_code, last_successful_sync_at FROM calendar_sync_accounts`)).toEqual([{ last_error_code: '503', last_successful_sync_at: later(10).toISOString() }]);
        expect((await items()).map((item) => item.title)).toEqual(['Dentist']);

        apple.account.fails = null;
        expect(await run('manual', later(30))).toMatchObject({ skipped: false, status: 'success' });
        expect(await rows(`SELECT last_error_code FROM calendar_sync_accounts`)).toEqual([{ last_error_code: null }]);
    });
});

describe('the log of runs', () => {
    it('keeps a month, and for good any run that failed or changed an event', async () => {
        const at = (daysAgo: number) => new Date(NOON.getTime() - daysAgo * 86_400_000).toISOString();
        await database.sql.query(
            `INSERT INTO calendar_sync_runs (id, account_id, provider, trigger, status, started_at, events_created, events_updated) VALUES
                ($1, $7, 'apple-caldav', 'cron', 'success', $8, 0, 0), ($2, $7, 'apple-caldav', 'cron', 'success', $9, 0, 0),
                ($3, $7, 'apple-caldav', 'cron', 'success', $8, 0, 2), ($4, $7, 'apple-caldav', 'cron', 'failed', $8, NULL, NULL),
                ($5, $7, 'apple-caldav', 'cron', 'success', $8, NULL, NULL), ($6, $7, 'apple-caldav', 'cron', 'success', $9, 1, 0)`,
            [id(701), id(702), id(703), id(704), id(705), id(706), accountId, at(31), at(29)]
        );

        expect(await pruneSyncRuns(database.db, NOON)).toBe(2);
        expect((await rows(`SELECT id FROM calendar_sync_runs ORDER BY id`)).map((row) => row.id)).toEqual([id(702), id(703), id(704), id(706)]);
    });
});

describe('the routes, on a deployment that is on PowerSync', () => {
    beforeEach(() => database.sql.exec(`UPDATE installation SET backend = 'powersync'`));

    it('are a parent\'s and the scheduled job\'s, and nobody else\'s', async () => {
        process.env.CALENDAR_SYNC_CRON_SECRET = 'the-job-knows-this';
        const parent = (await createSession(database.db, { type: 'parent', familyMemberId: DANA })).token;
        const kid = (await createSession(database.db, { type: 'kid', familyMemberId: ELI })).token;

        const asParent = await statusRoute(deviceRequest('/api/calendar-sync/apple/status', { sessionToken: parent }));
        expect([asParent.status, (await asParent.json()).account.username]).toEqual([200, 'dana@example.com']);
        expect((await statusRoute(deviceRequest('/api/calendar-sync/apple/status', { sessionToken: kid }))).status).toBe(403);
        expect((await statusRoute(deviceRequest('/api/calendar-sync/apple/status'))).status).toBe(401);

        // The job has no cookie, no device and no session: only its secret. Switched off, the import tells it so.
        await updateCalendarSyncSettings(database.db, { accountId, selectedCalendarIds: [], enabled: false });
        const { NextRequest } = await import('next/server');
        const fromJob = await runRoute(new NextRequest('http://localhost:3000/api/calendar-sync/apple/run', { method: 'POST', headers: { authorization: 'Bearer the-job-knows-this' }, body: '{}' }));
        expect([fromJob.status, (await fromJob.json()).reason]).toEqual([200, 'disabled']);
        const wrong = await runRoute(new NextRequest('http://localhost:3000/api/calendar-sync/apple/run', { method: 'POST', headers: { authorization: 'Bearer a-guess' }, body: '{}' }));
        expect(wrong.status).toBe(401);
    });
});
