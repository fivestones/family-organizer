import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import type { Principal } from '@family-organizer/data';
import { DELETE as signOutEverywhere } from '@/app/api/auth/members/[memberId]/sessions/route';
import { PUT as setPin } from '@/app/api/auth/pin/route';
import { POST as signIn } from '@/app/api/auth/sessions/route';
import { POST as sendMessage } from '@/app/api/messages/messages/route';
import { SELF_AUTHENTICATING_API_PREFIXES } from '@/lib/device-auth';
import { issueMobileDeviceSessionToken } from '@/lib/device-auth-server';
import { __resetParentElevationRateLimitForTests } from '@/lib/parent-elevation-rate-limit';
import { SESSION_TOKEN_HEADER } from '@/lib/server/request-session';
import { createSession, findSession } from '@/lib/server/sessions';
import { middleware } from '@/middleware';
import { DANA, deviceRequest, ELI, FAY, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// Who may set a PIN and end someone's sessions, and how a phone, which has no cookie, reaches the routes it needs.

let database: TestDatabase;
beforeEach(async () => {
    database = await createTestDatabase();
    await seedFamily(database);
    __resetParentElevationRateLimitForTests();
});
afterEach(() => database.close());

const token = async (principal: Principal) => (await createSession(database.db, principal)).token;
const asParent = () => token({ type: 'parent', familyMemberId: DANA });
const hasPin = async (memberId: string) => (await database.sql.query<{ has_pin: boolean }>(`SELECT has_pin FROM family_members WHERE id = $1`, [memberId])).rows[0].has_pin;
const putPin = (sessionToken: string, body: unknown) => setPin(deviceRequest('/api/auth/pin', { method: 'PUT', sessionToken, body }));
const signInAs = async (familyMemberId: string, pin?: string) => (await signIn(deviceRequest('/api/auth/sessions', { body: { familyMemberId, pin } }))).status;

describe('a PIN', () => {
    it('is set and removed by a parent, for anyone, and asked for from then on', async () => {
        const parent = await asParent();
        expect(await signInAs(ELI)).toBe(200);

        const set = await putPin(parent, { familyMemberId: ELI, pin: ' 4321 ' });
        expect([set.status, await set.json()]).toEqual([200, { ok: true, hasPin: true }]);
        expect(await hasPin(ELI)).toBe(true);
        expect([await signInAs(ELI), await signInAs(ELI, '0000'), await signInAs(ELI, '4321')]).toEqual([400, 403, 200]);

        expect(await (await putPin(parent, { familyMemberId: ELI, pin: null })).json()).toEqual({ ok: true, hasPin: false });
        expect(await hasPin(ELI)).toBe(false);
        expect(await signInAs(ELI)).toBe(200);
    });

    it('is nobody else\'s to set, and is not set to nothing or for no one', async () => {
        const parent = await asParent();
        expect((await putPin(await token({ type: 'kid', familyMemberId: ELI }), { familyMemberId: ELI, pin: '4321' })).status).toBe(403);
        expect((await putPin(await token({ type: 'kid', familyMemberId: null }), { familyMemberId: ELI, pin: '4321' })).status).toBe(403);
        expect((await putPin('no-such-session', { familyMemberId: ELI, pin: '4321' })).status).toBe(401);
        expect((await putPin(parent, { familyMemberId: ELI, pin: '   ' })).status).toBe(400);
        expect((await putPin(parent, { familyMemberId: ELI, pin: 4321 })).status).toBe(400);
        expect((await putPin(parent, { familyMemberId: 'eli', pin: '4321' })).status).toBe(400);
        expect((await putPin(parent, { familyMemberId: '00000000-0000-4000-8000-000000000999', pin: '4321' })).status).toBe(404);
        expect(await hasPin(ELI)).toBe(false);

        await database.sql.exec(`UPDATE installation SET writes_frozen = true`);
        expect((await putPin(parent, { familyMemberId: ELI, pin: '4321' })).status).toBe(503);
    });
});

describe('signing someone out of every device', () => {
    const everywhere = (sessionToken: string, memberId: string) =>
        signOutEverywhere(deviceRequest(`/api/auth/members/${memberId}/sessions`, { method: 'DELETE', sessionToken }), { params: Promise.resolve({ memberId }) });

    it('ends each of their sessions and nobody else\'s, when a parent asks', async () => {
        const [parent, onTablet, onPhone, elis] = [await asParent(), await token({ type: 'kid', familyMemberId: FAY }), await token({ type: 'kid', familyMemberId: FAY }), await token({ type: 'kid', familyMemberId: ELI })];

        expect((await everywhere(elis, FAY)).status).toBe(403);
        expect(await findSession(database.db, onTablet)).not.toBeNull();

        expect((await everywhere(parent, FAY)).status).toBe(200);
        expect([await findSession(database.db, onTablet), await findSession(database.db, onPhone)]).toEqual([null, null]);
        expect(await findSession(database.db, elis)).not.toBeNull();
        expect(await findSession(database.db, parent)).not.toBeNull();
    });
});

describe('a phone, which has no cookie', () => {
    const fromPhone = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
        const { token: deviceToken } = issueMobileDeviceSessionToken({ platform: 'ios' });
        return new NextRequest(`http://localhost:3000${url}`, { ...init, headers: { authorization: `Bearer ${deviceToken}`, ...init.headers } });
    };

    it('is let through to the routes that check the device themselves, and to no others', async () => {
        process.env.DEVICE_ACCESS_KEY = 'test-device-key';
        for (const url of ['/api/auth/sessions', '/api/sync/token', '/api/sync/upload', '/api/client-config', '/api/finance/mutations', '/api/messages/messages', '/api/calendar-sync/apple/status']) {
            expect((await middleware(new NextRequest(`http://localhost:3000${url}`))).headers.get('x-middleware-next'), url).toBe('1');
        }
        for (const url of ['/api/family-members', '/api/exchange-rates', '/api/content/queue/current', '/api/client-configuration']) {
            expect((await middleware(new NextRequest(`http://localhost:3000${url}`))).status, url).toBe(401);
        }
    });

    it('signs in and sends a message with its device token, and is turned away without one', async () => {
        const parentToken = await asParent();
        const { ensureStandingThreads } = await import('@/lib/server/messaging');
        const { familyThreadId } = await ensureStandingThreads(database.db);

        const signedIn = await signIn(fromPhone('/api/auth/sessions', { method: 'POST', body: JSON.stringify({ familyMemberId: ELI }) }));
        expect(signedIn.status).toBe(200);
        const { token: sessionToken } = await signedIn.json();

        const body = JSON.stringify({ threadId: familyThreadId, body: 'From my phone' });
        expect((await sendMessage(fromPhone('/api/messages/messages', { method: 'POST', headers: { [SESSION_TOKEN_HEADER]: sessionToken }, body }))).status).toBe(200);
        // No cookie and no device token: a session alone is not enough.
        const bare = new NextRequest('http://localhost:3000/api/messages/messages', { method: 'POST', headers: { [SESSION_TOKEN_HEADER]: parentToken }, body });
        expect((await sendMessage(bare)).status).toBe(401);
        expect((await database.sql.query(`SELECT body FROM messages`)).rows).toEqual([{ body: 'From my phone' }]);
    });

    it('can only be let through to a route that checks the device', () => {
        const checks = /requireSession|requireDeviceAndDatabase|serveMessaging|requireMessageActor|requireRequestFamilyMember|getDeviceAuthContextFromNextRequest|requireCalendarSyncRouteAuth/;
        const routesUnder = (directory: string): string[] =>
            readdirSync(directory).flatMap((entry) => {
                const full = path.join(directory, entry);
                return statSync(full).isDirectory() ? routesUnder(full) : entry === 'route.ts' ? [full] : [];
            });
        const unchecked = SELF_AUTHENTICATING_API_PREFIXES.flatMap((prefix) => routesUnder(path.join(process.cwd(), 'app', prefix)))
            .filter((file) => !checks.test(readFileSync(file, 'utf8')))
            .map((file) => path.relative(process.cwd(), file));

        expect(unchecked).toEqual([]);
    });
});
