import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as advanceRoute } from '@/app/api/content/queue/advance/route';
import { GET as currentRoute } from '@/app/api/content/queue/current/route';
import { GET as ratesRoute } from '@/app/api/exchange-rates/route';
import { POST as createChoreRoute } from '@/app/api/mobile/shortcuts/chore-create/route';
import { POST as issueTokenRoute } from '@/app/api/mobile/shortcuts/chore-create-token/route';
import { GET as shortcutFamilyRoute } from '@/app/api/mobile/shortcuts/family-members/route';
import { issueMobileDeviceSessionToken } from '@/lib/device-auth-server';
import { __resetParentElevationRateLimitForTests } from '@/lib/parent-elevation-rate-limit';
import { addQueueItem, advanceQueue, currentQueueItem, NoSuchCategoryError } from '@/lib/server/content-queue';
import { ExchangeRatesNotConfiguredError, refreshExchangeRates } from '@/lib/server/exchange-rates';
import { createSession } from '@/lib/server/sessions';
import { checkShortcutToken, createShortcutChore, issueShortcutToken, listShortcutFamilyMembers, SHORTCUT_CHORE_CAPABILITY, SHORTCUT_TOKEN_HEADER } from '@/lib/server/shortcuts';
import { DANA, deviceRequest, ELI, FAY, PINS, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// The server's smaller services on Postgres: exchange rates, the content queue, and iOS Shortcuts.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOON = new Date('2026-03-09T12:00:00.000Z');
const later = (hours: number) => new Date(NOON.getTime() + hours * 3_600_000);

let database: TestDatabase;
beforeEach(async () => {
    database = await createTestDatabase();
    await seedFamily(database);
    __resetParentElevationRateLimitForTests();
});
afterEach(async () => {
    delete process.env.OPEN_EXCHANGE_RATES_APP_ID;
    await database.close();
});

const rows = async <T = Record<string, any>>(text: string, params: unknown[] = []) => (await database.sql.query<T>(text, params as any[])).rows;
const onPowerSync = () => database.sql.exec(`UPDATE installation SET backend = 'powersync'`);

describe('exchange rates', () => {
    const provider = (rates: Record<string, unknown>, at: Date) => vi.fn(async () => new Response(JSON.stringify({ timestamp: Math.floor(at.getTime() / 1000), rates })));

    it('are fetched when there are none, kept, and served from what is kept for two hours', async () => {
        process.env.OPEN_EXCHANGE_RATES_APP_ID = 'a-key';
        const first = provider({ npr: 133.5, EUR: 0.92, XXX: 'not a rate', ZERO: 0 }, NOON);

        expect(await refreshExchangeRates(database.db, { fetchImpl: first as any, now: NOON })).toEqual({ base: 'USD', rates: { NPR: 133.5, EUR: 0.92 }, timestamp: NOON.getTime() / 1000, source: 'provider' });
        expect(String((first.mock.calls[0] as unknown[])[0])).toContain('app_id=a-key');
        expect(await rows(`SELECT base_currency, target_currency, rate, fetched_at FROM exchange_rates ORDER BY target_currency`)).toEqual([
            { base_currency: 'USD', target_currency: 'EUR', rate: 0.92, fetched_at: NOON.toISOString() },
            { base_currency: 'USD', target_currency: 'NPR', rate: 133.5, fetched_at: NOON.toISOString() },
        ]);

        const never = vi.fn();
        expect(await refreshExchangeRates(database.db, { fetchImpl: never as any, now: later(1.9) })).toMatchObject({ rates: { NPR: 133.5, EUR: 0.92 }, source: 'cache' });
        expect(never).not.toHaveBeenCalled();

        // Stale: fetched again, and each pair's one row is brought up to date.
        expect(await refreshExchangeRates(database.db, { fetchImpl: provider({ NPR: 134 }, later(3)) as any, now: later(3) })).toMatchObject({ rates: { NPR: 134 }, source: 'provider' });
        expect(await rows(`SELECT target_currency, rate FROM exchange_rates ORDER BY target_currency`)).toEqual([{ target_currency: 'EUR', rate: 0.92 }, { target_currency: 'NPR', rate: 134 }]);
    });

    it('say so when no provider is configured or it answers badly, and leave what is kept alone', async () => {
        await expect(refreshExchangeRates(database.db, { now: NOON })).rejects.toBeInstanceOf(ExchangeRatesNotConfiguredError);
        process.env.OPEN_EXCHANGE_RATES_APP_ID = 'a-key';
        await expect(refreshExchangeRates(database.db, { fetchImpl: (async () => new Response('no', { status: 500 })) as any, now: NOON })).rejects.toThrow('Exchange-rate provider failed (500).');
        await expect(refreshExchangeRates(database.db, { fetchImpl: provider({}, NOON) as any, now: NOON })).rejects.toThrow('no usable rates');
        expect(await rows(`SELECT 1 FROM exchange_rates`)).toEqual([]);
    });

    it('are served by the route to anyone signed in on an activated device', async () => {
        await database.sql.exec(`INSERT INTO exchange_rates (base_currency, target_currency, rate, fetched_at) VALUES ('USD', 'NPR', 133.5, now())`);
        const { token } = await createSession(database.db, { type: 'kid', familyMemberId: null });

        const response = await ratesRoute(deviceRequest('/api/exchange-rates', { sessionToken: token }));
        expect([response.status, (await response.json()).rates]).toEqual([200, { NPR: 133.5 }]);
        expect((await ratesRoute(deviceRequest('/api/exchange-rates', { sessionToken: 'no-such-session' }))).status).toBe(401);
    });
});

describe('the content queue', () => {
    const VERSE = id(300);
    beforeEach(async () => {
        await database.sql.exec(`
            INSERT INTO content_categories (id, slug, name, default_duration_ms) VALUES ('${VERSE}', 'verse', 'Verse of the week', 3600000);
            INSERT INTO content_queue_items (id, category_id, title, status, sort_order, live_at, created_at) VALUES
                ('${id(301)}', '${VERSE}', 'First', 'live', 1, '2026-03-08T12:00:00Z', '2026-03-01T00:00:00Z'),
                ('${id(302)}', '${VERSE}', 'Second', 'queued', 2, NULL, '2026-03-02T00:00:00Z'),
                ('${id(303)}', '${VERSE}', 'Third', 'queued', 3, NULL, '2026-03-03T00:00:00Z');
            UPDATE content_queue_items SET duration_ms = 60000 WHERE id = '${id(303)}';
            INSERT INTO content_attachments (id, queue_item_id, name, type, url, size_bytes) VALUES ('${id(310)}', '${id(301)}', 'card.png', 'image/png', 'content/card.png', 2048);
        `);
    });

    it('says what is showing, with its files', async () => {
        const showing = await currentQueueItem(database.db, 'verse');

        expect(showing.category).toEqual({ id: VERSE, name: 'Verse of the week', slug: 'verse' });
        expect(showing.currentItem).toMatchObject({ id: id(301), title: 'First', status: 'live', richTextContent: '', sortOrder: 1, attachments: [{ id: id(310), name: 'card.png', url: 'content/card.png', sizeBytes: 2048 }] });
        await expect(currentQueueItem(database.db, 'nothing')).rejects.toBeInstanceOf(NoSuchCategoryError);
    });

    it('puts a new item at the end', async () => {
        const added = await addQueueItem(database.db, { categorySlug: 'verse', title: 'Fourth', linkUrl: 'https://example.org/4', durationMs: 5000 }, NOON);

        expect(added).toMatchObject({ status: 'queued', sortOrder: 4 });
        expect(await rows(`SELECT title, link_url, rich_text_content, duration_ms::integer AS duration_ms, status FROM content_queue_items WHERE id = $1`, [added.id])).toEqual([
            { title: 'Fourth', link_url: 'https://example.org/4', rich_text_content: null, duration_ms: 5000, status: 'queued' },
        ]);
        await expect(addQueueItem(database.db, { categorySlug: 'nothing', title: 'Lost' })).rejects.toBeInstanceOf(NoSuchCategoryError);
    });

    it('moves on: what was showing is put away and the next is shown, for its own time or the category\'s', async () => {
        expect(await advanceQueue(database.db, 'verse', NOON)).toEqual({ advanced: true, archivedId: id(301), promotedId: id(302) });
        expect(await advanceQueue(database.db, 'verse', later(1))).toEqual({ advanced: true, archivedId: id(302), promotedId: id(303) });

        expect(await rows(`SELECT title, status, live_at, live_until, archived_at FROM content_queue_items ORDER BY sort_order`)).toEqual([
            { title: 'First', status: 'archived', live_at: '2026-03-08T12:00:00.000Z', live_until: null, archived_at: NOON.toISOString() },
            { title: 'Second', status: 'archived', live_at: NOON.toISOString(), live_until: later(1).toISOString(), archived_at: later(1).toISOString() },
            { title: 'Third', status: 'live', live_at: later(1).toISOString(), live_until: new Date(later(1).getTime() + 60_000).toISOString(), archived_at: null },
        ]);
        // Nothing waiting: the last is put away and nothing takes its place.
        expect(await advanceQueue(database.db, 'verse', later(2))).toEqual({ advanced: true, archivedId: id(303), promotedId: null });
        expect((await currentQueueItem(database.db, 'verse')).currentItem).toBeNull();
    });

    it('is served by its routes from Postgres on a deployment that is on PowerSync', async () => {
        await onPowerSync();

        const showing = await currentRoute(deviceRequest('/api/content/queue/current?category=verse'));
        expect((await showing.json()).currentItem.title).toBe('First');
        const advanced = await advanceRoute(deviceRequest('/api/content/queue/advance', { body: { categorySlug: 'verse' } }));
        expect(await advanced.json()).toEqual({ advanced: true, archivedId: id(301), promotedId: id(302) });
        expect((await currentRoute(deviceRequest('/api/content/queue/current?category=nothing'))).status).toBe(404);
        expect((await currentRoute(deviceRequest('/api/content/queue/current?category=verse', { activated: false }))).status).toBe(401);
    });
});

describe('iOS Shortcuts', () => {
    const issue = (label = 'Kitchen iPad', parent = DANA, at = NOON) => issueShortcutToken(database.db, { capability: SHORTCUT_CHORE_CAPABILITY, label, parentFamilyMemberId: parent, issuedPlatform: 'ios' }, at);

    it('issue a token that works until another is issued under its label, and only for what it was issued for', async () => {
        const first = await issue();
        expect(await checkShortcutToken(database.db, ` ${first.token} `, SHORTCUT_CHORE_CAPABILITY, later(1))).toEqual({ ok: true, parentFamilyMemberId: DANA });
        expect(await rows(`SELECT label, issued_platform, last_used_at, revoked_at, token_hash = $1 AS kept_plain FROM shortcut_tokens`, [first.token])).toEqual([
            { label: 'Kitchen iPad', issued_platform: 'ios', last_used_at: later(1).toISOString(), revoked_at: null, kept_plain: false },
        ]);

        const second = await issue('Kitchen iPad', DANA, later(2));
        const other = await issue('Watch', DANA, later(2));
        expect(await checkShortcutToken(database.db, first.token, SHORTCUT_CHORE_CAPABILITY)).toEqual({ ok: false, reason: 'revoked' });
        expect((await checkShortcutToken(database.db, second.token, SHORTCUT_CHORE_CAPABILITY)).ok).toBe(true);
        expect((await checkShortcutToken(database.db, other.token, SHORTCUT_CHORE_CAPABILITY)).ok).toBe(true);
        expect(await checkShortcutToken(database.db, second.token, 'something_else')).toEqual({ ok: false, reason: 'capability_mismatch' });
        expect(await checkShortcutToken(database.db, 'fost_made_up', SHORTCUT_CHORE_CAPABILITY)).toEqual({ ok: false, reason: 'invalid' });
        expect(await checkShortcutToken(database.db, '  ', SHORTCUT_CHORE_CAPABILITY)).toEqual({ ok: false, reason: 'missing' });
    });

    it('list the family, telling two people of one name apart', async () => {
        await database.sql.exec(`INSERT INTO family_members (id, name, role, sort_order) VALUES ('${id(4)}', 'Eli', 'parent', 3), ('${id(5)}', 'Fay', 'child', 4)`);

        expect((await listShortcutFamilyMembers(database.db)).map((member) => member.label)).toEqual(['Dana', 'Eli (child)', 'Eli (parent)', 'Fay (child • 0003)', 'Fay (child • 0005)']);
    });

    it('add a chore for one person on the family\'s day, after every other chore', async () => {
        // Two in the morning belongs to the day before, for a household whose day turns over at three.
        const created = await createShortcutChore(database.db, { title: '  Water the plants ', assigneeFamilyMemberId: ELI }, new Date('2026-03-10T02:00:00'));

        expect(created).toMatchObject({ title: 'Water the plants', assigneeFamilyMemberId: ELI, dateKey: '2026-03-09' });
        expect(await rows(`SELECT title, start_date, rrule, timing_mode, is_up_for_grabs, weight, sort_order > (SELECT max(sort_order) FROM chores WHERE id <> $1) AS last FROM chores WHERE id = $1`, [created.choreId])).toEqual([
            { title: 'Water the plants', start_date: '2026-03-09', rrule: null, timing_mode: 'anytime', is_up_for_grabs: false, weight: 0, last: true },
        ]);
        expect(await rows(`SELECT family_member_id, position FROM chore_assignees WHERE chore_id = $1`, [created.choreId])).toEqual([{ family_member_id: ELI, position: 0 }]);

        await expect(createShortcutChore(database.db, { title: ' ', assigneeFamilyMemberId: ELI })).rejects.toThrow('Title is required');
        await expect(createShortcutChore(database.db, { title: 'Sweep', assigneeFamilyMemberId: '' })).rejects.toThrow('assigneeFamilyMemberId is required');
        await expect(createShortcutChore(database.db, { title: 'Sweep', assigneeFamilyMemberId: id(999) })).rejects.toThrow('Assignee not found');
    });

    it('are served by their routes from Postgres: a parent\'s PIN on their phone issues a token, and the token adds a chore', async () => {
        await onPowerSync();
        const { token: deviceToken } = issueMobileDeviceSessionToken({ platform: 'ios', deviceName: 'Dana\'s phone' });
        const fromPhone = (url: string, body: unknown, headers: Record<string, string> = {}) =>
            new NextRequest(`http://localhost:3000${url}`, { method: 'POST', headers: { authorization: `Bearer ${deviceToken}`, ...headers }, body: JSON.stringify(body) });
        const askForToken = async (body: unknown) => {
            const response = await issueTokenRoute(fromPhone('/api/mobile/shortcuts/chore-create-token', body));
            return [response.status, await response.json()] as const;
        };

        expect((await askForToken({ familyMemberId: FAY, label: 'Mine', pin: PINS[FAY] }))[0]).toBe(403);
        expect((await askForToken({ familyMemberId: DANA, label: 'Kitchen', pin: '0000' }))[0]).toBe(403);
        expect((await askForToken({ familyMemberId: DANA, label: 'Kitchen' }))[0]).toBe(400);
        expect((await askForToken({ familyMemberId: id(999), label: 'Kitchen', pin: '0000' }))[0]).toBe(404);
        const [status, issued] = await askForToken({ familyMemberId: DANA, label: 'Kitchen', pin: PINS[DANA] });
        expect([status, issued.label, issued.parentFamilyMemberId]).toEqual([200, 'Kitchen', DANA]);
        expect(await rows(`SELECT issued_device_name, issued_platform FROM shortcut_tokens`)).toEqual([{ issued_device_name: "Dana's phone", issued_platform: 'ios' }]);

        // A shortcut has only its token: no cookie, no device token, no session.
        const withToken = { [SHORTCUT_TOKEN_HEADER]: issued.shortcutToken };
        const family = await shortcutFamilyRoute(new NextRequest('http://localhost:3000/api/mobile/shortcuts/family-members', { headers: withToken }));
        expect((await family.json()).familyMembers.map((member: { label: string }) => member.label)).toEqual(['Dana', 'Eli', 'Fay']);
        const made = await createChoreRoute(new NextRequest('http://localhost:3000/api/mobile/shortcuts/chore-create', { method: 'POST', headers: withToken, body: JSON.stringify({ title: 'Feed the cat', assigneeFamilyMemberId: FAY }) }));
        expect(made.status).toBe(200);
        expect(await rows(`SELECT c.title, a.family_member_id FROM chores c JOIN chore_assignees a ON a.chore_id = c.id WHERE c.id = $1`, [(await made.json()).choreId])).toEqual([{ title: 'Feed the cat', family_member_id: FAY }]);

        const without = await createChoreRoute(new NextRequest('http://localhost:3000/api/mobile/shortcuts/chore-create', { method: 'POST', headers: { [SHORTCUT_TOKEN_HEADER]: 'fost_made_up' }, body: '{}' }));
        expect([without.status, (await without.json()).reason]).toEqual([401, 'invalid']);
    });
});
