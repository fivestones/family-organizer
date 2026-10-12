import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSession, drainSession, DRAIN_WINDOW_MS, endSession, endSessionsOfMember, findSession, SESSION_LIFETIME_MS } from '@/lib/server/sessions';
import { DANA, ELI, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

let database: TestDatabase;
beforeEach(async () => {
    database = await createTestDatabase();
    await seedFamily(database);
});
afterEach(() => database.close());

const at = (iso: string) => new Date(iso);
const START = at('2026-03-01T12:00:00.000Z');
const after = (ms: number) => new Date(START.getTime() + ms);
const HOUR = 60 * 60 * 1000;

describe('a session', () => {
    it('is found by its token, and by nothing that is stored', async () => {
        const { token, session } = await createSession(database.db, { type: 'parent', familyMemberId: DANA }, START);

        expect(await findSession(database.db, token, START)).toEqual({
            id: session.id,
            principal: { type: 'parent', familyMemberId: DANA },
            state: 'active',
            expiresAt: after(SESSION_LIFETIME_MS).toISOString(),
        });
        const stored = (await database.sql.query<{ token_hash: string }>(`SELECT token_hash FROM auth_sessions`)).rows[0];
        expect(stored.token_hash).not.toContain(token);
        expect(await findSession(database.db, stored.token_hash, START)).toBeNull();
        expect(await findSession(database.db, 'not-a-token', START)).toBeNull();
        expect(await findSession(database.db, null, START)).toBeNull();
    });

    it('can be the shared kid session, which belongs to no member', async () => {
        const { token } = await createSession(database.db, { type: 'kid', familyMemberId: null }, START);
        expect((await findSession(database.db, token, START))?.principal).toEqual({ type: 'kid', familyMemberId: null });
    });

    it('lasts as long as it is used, and no longer', async () => {
        const { token } = await createSession(database.db, { type: 'kid', familyMemberId: ELI }, START);

        // Used a month in: its life is counted from then.
        const used = await findSession(database.db, token, after(30 * 24 * HOUR));
        expect(used?.expiresAt).toBe(after(30 * 24 * HOUR + SESSION_LIFETIME_MS).toISOString());
        // Left alone past that: gone, and recorded as ended.
        expect(await findSession(database.db, token, after(30 * 24 * HOUR + SESSION_LIFETIME_MS + 1))).toBeNull();
        expect((await database.sql.query<{ state: string }>(`SELECT state FROM auth_sessions`)).rows).toEqual([{ state: 'ended' }]);
        // An ended session does not come back by being used.
        expect(await findSession(database.db, token, after(31 * 24 * HOUR))).toBeNull();
    });

    it('ends when it is ended', async () => {
        const { token, session } = await createSession(database.db, { type: 'kid', familyMemberId: ELI }, START);
        await endSession(database.db, session.id, after(HOUR));
        expect(await findSession(database.db, token, after(HOUR))).toBeNull();
    });
});

describe('a draining session', () => {
    it('is still found, as draining, until its day is up', async () => {
        const { token, session } = await createSession(database.db, { type: 'parent', familyMemberId: DANA }, START);
        await drainSession(database.db, session.id, after(HOUR));

        const draining = await findSession(database.db, token, after(2 * HOUR));
        expect(draining).toMatchObject({ state: 'draining', expiresAt: after(HOUR + DRAIN_WINDOW_MS).toISOString() });
        expect(await findSession(database.db, token, after(HOUR + DRAIN_WINDOW_MS))).toBeNull();
    });

    it('is not given longer by being used or by being drained again', async () => {
        const { token, session } = await createSession(database.db, { type: 'parent', familyMemberId: DANA }, START);
        await drainSession(database.db, session.id, after(HOUR));
        await findSession(database.db, token, after(20 * HOUR));
        await drainSession(database.db, session.id, after(20 * HOUR));

        expect((await findSession(database.db, token, after(21 * HOUR)))?.expiresAt).toBe(after(HOUR + DRAIN_WINDOW_MS).toISOString());
    });

    it('cannot be made active again', async () => {
        const { token, session } = await createSession(database.db, { type: 'parent', familyMemberId: DANA }, START);
        await drainSession(database.db, session.id, START);
        await endSession(database.db, session.id, after(HOUR));
        await drainSession(database.db, session.id, after(2 * HOUR));

        expect(await findSession(database.db, token, after(2 * HOUR))).toBeNull();
    });
});

describe('a member\'s sessions', () => {
    it('all end at once, on every device, and nobody else\'s do', async () => {
        const phone = await createSession(database.db, { type: 'parent', familyMemberId: DANA }, START);
        const tablet = await createSession(database.db, { type: 'parent', familyMemberId: DANA }, START);
        const kid = await createSession(database.db, { type: 'kid', familyMemberId: ELI }, START);

        await endSessionsOfMember(database.db, DANA, after(HOUR));

        expect(await findSession(database.db, phone.token, after(HOUR))).toBeNull();
        expect(await findSession(database.db, tablet.token, after(HOUR))).toBeNull();
        expect(await findSession(database.db, kid.token, after(HOUR))).not.toBeNull();
    });

    it('go with the member', async () => {
        const { token } = await createSession(database.db, { type: 'kid', familyMemberId: ELI }, START);
        await database.sql.query(`DELETE FROM family_members WHERE id = $1`, [ELI]);
        expect(await findSession(database.db, token, START)).toBeNull();
    });
});
