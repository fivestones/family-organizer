import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from '@/app/api/auth/sessions/route';
import { DELETE, GET } from '@/app/api/auth/sessions/current/route';
import { __resetParentElevationRateLimitForTests } from '@/lib/parent-elevation-rate-limit';
import { setDbForTests } from '@/lib/server/db';
import { DANA, deviceRequest, ELI, FAY, PINS, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

let database: TestDatabase;
beforeEach(async () => {
    __resetParentElevationRateLimitForTests();
    database = await createTestDatabase();
    await seedFamily(database);
});
afterEach(() => database.close());

const signIn = (body: unknown, init: { activated?: boolean } = {}) => POST(deviceRequest('/api/auth/sessions', { body, ...init }));
const current = (sessionToken: string) => GET(deviceRequest('/api/auth/sessions/current', { sessionToken }));
const signOut = (sessionToken: string, query = '') => DELETE(deviceRequest(`/api/auth/sessions/current${query}`, { method: 'DELETE', sessionToken }));

describe('POST /api/auth/sessions', () => {
    it('turns away a device that has not been activated', async () => {
        const response = await signIn({}, { activated: false });
        expect(response.status).toBe(401);
        expect((await response.json()).code).toBe('unauthorized_device');
    });

    it('says so when the deployment has no Postgres', async () => {
        setDbForTests(null);
        delete process.env.DATABASE_URL;
        const response = await signIn({});
        expect(response.status).toBe(503);
        expect((await response.json()).code).toBe('postgres_not_configured');
    });

    it('gives any activated device the shared kid session', async () => {
        const response = await signIn({});
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(body.session).toMatchObject({ principalType: 'kid', familyMemberId: null, principalKey: 'kid-shared', state: 'active' });
        expect(typeof body.token).toBe('string');
    });

    it('signs in a kid with no PIN without asking for one', async () => {
        const body = await (await signIn({ familyMemberId: ELI })).json();
        expect(body.session).toMatchObject({ principalType: 'kid', familyMemberId: ELI, principalKey: `kid-${ELI}` });
    });

    it('signs in a parent with the right PIN, as a parent', async () => {
        const body = await (await signIn({ familyMemberId: DANA, pin: PINS[DANA] })).json();
        expect(body.session).toMatchObject({ principalType: 'parent', familyMemberId: DANA, principalKey: `parent-${DANA}` });
    });

    it('asks for a PIN where there is one, and refuses the wrong one', async () => {
        const missing = await signIn({ familyMemberId: FAY });
        expect([missing.status, (await missing.json()).code]).toEqual([400, 'pin_required']);
        const wrong = await signIn({ familyMemberId: FAY, pin: '0000' });
        expect([wrong.status, (await wrong.json()).code]).toEqual([403, 'incorrect_pin']);
        expect((await database.sql.query(`SELECT 1 FROM auth_sessions`)).rows).toEqual([]);
    });

    it('slows down repeated wrong PINs for the same member', async () => {
        const statuses: number[] = [];
        for (let attempt = 0; attempt < 6; attempt += 1) statuses.push((await signIn({ familyMemberId: DANA, pin: '0000' })).status);
        expect(statuses.slice(0, 3)).toEqual([403, 403, 403]);
        expect(statuses).toContain(429);
        // The right PIN is held back too while the limit is on: the limit is the point.
        const blocked = await signIn({ familyMemberId: DANA, pin: PINS[DANA] });
        expect(blocked.status).toBe(429);
        expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0);
    });

    it('does not say whether a member exists to a malformed request', async () => {
        const unknown = await signIn({ familyMemberId: '00000000-0000-4000-8000-000000000099' });
        expect([unknown.status, (await unknown.json()).code]).toEqual([404, 'member_not_found']);
        const malformed = await signIn({ familyMemberId: "'; DROP TABLE family_members; --" });
        expect([malformed.status, (await malformed.json()).code]).toEqual([400, 'invalid_member']);
    });

    it('rehashes a PIN kept in the old unsalted form the first time it is used', async () => {
        const { createHash } = await import('node:crypto');
        await database.sql.query(`UPDATE family_members SET pin_hash = $1 WHERE id = $2`, [createHash('sha256').update('1357').digest('hex'), FAY]);

        expect((await signIn({ familyMemberId: FAY, pin: '1357' })).status).toBe(200);
        const stored = (await database.sql.query<{ pin_hash: string }>(`SELECT pin_hash FROM family_members WHERE id = $1`, [FAY])).rows[0].pin_hash;
        expect(stored.startsWith('scrypt$v1$')).toBe(true);
        expect((await signIn({ familyMemberId: FAY, pin: '1357' })).status).toBe(200);
    });
});

describe('the current session', () => {
    it('is what the token says it is', async () => {
        const { token } = await (await signIn({ familyMemberId: ELI })).json();
        const body = await (await current(token)).json();
        expect(body.session).toMatchObject({ principalType: 'kid', familyMemberId: ELI, state: 'active' });
    });

    it('is refused without a token, with a made-up one, and after signing out', async () => {
        expect((await GET(deviceRequest('/api/auth/sessions/current'))).status).toBe(401);
        expect((await current('made-up')).status).toBe(401);
        const { token } = await (await signIn({ familyMemberId: ELI })).json();
        expect((await signOut(token)).status).toBe(200);
        const gone = await current(token);
        expect([gone.status, (await gone.json()).code]).toEqual([401, 'session_ended']);
    });

    it('can be signed out to drain: still there, and marked as only finishing', async () => {
        const { token } = await (await signIn({ familyMemberId: DANA, pin: PINS[DANA] })).json();
        expect(await (await signOut(token, '?drain=1')).json()).toEqual({ ok: true, state: 'draining' });
        expect((await (await current(token)).json()).session.state).toBe('draining');
        // Signing out again, plainly, ends it.
        await signOut(token);
        expect((await current(token)).status).toBe(401);
    });
});
