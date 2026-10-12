import { createPublicKey, createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET as getConfig } from '@/app/api/client-config/route';
import { GET } from '@/app/api/sync/token/route';
import { setDbForTests } from '@/lib/server/db';
import { createSession, drainSession, endSession } from '@/lib/server/sessions';
import { SYNC_TOKEN_LIFETIME_SECONDS } from '@/lib/server/sync-token';
import { DANA, deviceRequest, ELI, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

let database: TestDatabase;
beforeEach(async () => {
    process.env.POWERSYNC_JWT_PRIVATE_KEY = Buffer.from(privatePem).toString('base64');
    process.env.POWERSYNC_JWT_KID = 'test-key-1';
    delete process.env.POWERSYNC_URL;
    database = await createTestDatabase();
    await seedFamily(database);
});
afterEach(() => database.close());

const fetchToken = (sessionToken: string | null) => GET(deviceRequest('/api/sync/token', { sessionToken }));
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('GET /api/sync/token', () => {
    it('signs a token the service can check with the public half of the key, saying who it is for', async () => {
        const { token: sessionToken } = await createSession(database.db, { type: 'parent', familyMemberId: DANA });
        const before = Math.floor(Date.now() / 1000);

        const response = await fetchToken(sessionToken);
        const { token, expiresAt } = await response.json();
        const [header, payload, signature] = token.split('.');

        expect(response.status).toBe(200);
        expect(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(createPublicKey(privateKey), Buffer.from(signature, 'base64url'))).toBe(true);
        expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT', kid: 'test-key-1' });
        const claims = decode(payload);
        expect(claims).toMatchObject({ sub: `parent-${DANA}`, aud: 'family-organizer', type: 'parent', family_member_id: DANA });
        expect(claims.exp - claims.iat).toBe(SYNC_TOKEN_LIFETIME_SECONDS);
        expect(claims.iat).toBeGreaterThanOrEqual(before);
        expect(new Date(expiresAt).getTime()).toBe(claims.exp * 1000);
    });

    it('names no family member for the shared kid session, so no stream that asks for one matches', async () => {
        const { token: sessionToken } = await createSession(database.db, { type: 'kid', familyMemberId: null });
        const claims = decode((await (await fetchToken(sessionToken)).json()).token.split('.')[1]);
        expect(claims).toMatchObject({ sub: 'kid-shared', type: 'kid', family_member_id: null });
    });

    it('is given to a draining session, which needs it to finish, and not to an ended one or to nobody', async () => {
        const { token: sessionToken, session } = await createSession(database.db, { type: 'kid', familyMemberId: ELI });
        await drainSession(database.db, session.id);
        expect((await fetchToken(sessionToken)).status).toBe(200);
        await endSession(database.db, session.id);
        expect((await fetchToken(sessionToken)).status).toBe(401);
        expect((await fetchToken(null)).status).toBe(401);
    });

    it('says so when the deployment has no key', async () => {
        delete process.env.POWERSYNC_JWT_PRIVATE_KEY;
        const { token: sessionToken } = await createSession(database.db, { type: 'kid', familyMemberId: ELI });
        const response = await fetchToken(sessionToken);
        expect([response.status, (await response.json()).code]).toEqual([503, 'sync_not_configured']);
    });
});

describe('GET /api/client-config', () => {
    const config = (init: { activated?: boolean } = {}) => getConfig(deviceRequest('/api/client-config', init));

    it('tells a deployment with no Postgres that it is on InstantDB, and nothing more', async () => {
        setDbForTests(null);
        delete process.env.DATABASE_URL;
        expect(await (await config()).json()).toEqual({ backend: 'instant' });
    });

    it('tells a deployment with Postgres what its installation row says', async () => {
        const fresh = await (await config()).json();
        expect(fresh).toMatchObject({ backend: 'instant', dataGeneration: 1, writesFrozen: false, minClientBuild: 0, powersyncUrl: '/powersync' });
        expect(fresh.installationId).toMatch(/^[0-9a-f-]{36}$/);

        await database.sql.query(`UPDATE installation SET backend = 'powersync', data_generation = 2, writes_frozen = true`);
        expect(await (await config()).json()).toMatchObject({ backend: 'powersync', dataGeneration: 2, writesFrozen: true, installationId: fresh.installationId });
    });

    it('is for activated devices only', async () => {
        expect((await config({ activated: false })).status).toBe(401);
    });
});
