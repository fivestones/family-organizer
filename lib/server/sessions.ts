import 'server-only';

import { createHash, randomBytes } from 'crypto';
import type { Principal } from '@family-organizer/data/session/principal';
import type { AppDatabase } from './db';

// The app's own sessions (docs/powersync-migration.md, "Identity and sessions").
//
// A session is one principal on one device. The device holds a random token; the database holds only its hash.
// A session is active, or draining — it may finish uploading what its device still holds and nothing else — or
// ended. Draining is what a parent's session becomes when a shared device signs them out with changes unsent.

export type LiveSessionState = 'active' | 'draining';

export interface Session {
    id: string;
    principal: Principal;
    state: LiveSessionState;
    /** ISO 8601. For a draining session, when its time to finish runs out. */
    expiresAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A session lasts this long after it was last used. Instant's tokens never expired; this is long, not forever. */
export const SESSION_LIFETIME_MS = 180 * DAY_MS;
/** How long a signed-out session may go on sending what its device had not sent. */
export const DRAIN_WINDOW_MS = DAY_MS;
/** How stale `last_seen_at` may get before a request bothers to write it. */
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function toPrincipal(row: { principal_type: 'kid' | 'parent'; family_member_id: string | null }): Principal | null {
    if (row.principal_type === 'parent') return row.family_member_id ? { type: 'parent', familyMemberId: row.family_member_id } : null;
    return { type: 'kid', familyMemberId: row.family_member_id };
}

/** Starts a session and returns the token, which exists nowhere else: only its hash is stored. */
export async function createSession(db: AppDatabase, principal: Principal, now = new Date()): Promise<{ token: string; session: Session }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
    const row = await db
        .insertInto('auth_sessions')
        .values({
            token_hash: hashToken(token),
            principal_type: principal.type,
            family_member_id: principal.familyMemberId,
            created_at: now,
            last_seen_at: now,
            expires_at: expiresAt,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
    return { token, session: { id: row.id, principal, state: 'active', expiresAt: expiresAt.toISOString() } };
}

/**
 * The session a token belongs to, if it can still do anything. An expired session, and a draining one whose time
 * has run out, are found to be ended here and recorded as such.
 */
export async function findSession(db: AppDatabase, token: string | null | undefined, now = new Date()): Promise<Session | null> {
    if (!token) return null;
    const row = await db.selectFrom('auth_sessions').selectAll().where('token_hash', '=', hashToken(token)).executeTakeFirst();
    if (!row || row.state === 'ended') return null;
    const principal = toPrincipal(row);
    const deadline = row.state === 'draining' ? row.drain_until : row.expires_at;
    if (!principal || !deadline || new Date(deadline).getTime() <= now.getTime()) {
        await endSession(db, row.id, now);
        return null;
    }
    if (row.state === 'active' && now.getTime() - new Date(row.last_seen_at).getTime() > TOUCH_INTERVAL_MS) {
        const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS);
        await db.updateTable('auth_sessions').set({ last_seen_at: now, expires_at: expiresAt }).where('id', '=', row.id).where('state', '=', 'active').execute();
        return { id: row.id, principal, state: 'active', expiresAt: expiresAt.toISOString() };
    }
    return { id: row.id, principal, state: row.state, expiresAt: deadline };
}

/** Narrows an active session to finishing its uploads. A session already draining keeps the deadline it has. */
export async function drainSession(db: AppDatabase, sessionId: string, now = new Date()): Promise<void> {
    await db
        .updateTable('auth_sessions')
        .set({ state: 'draining', drain_until: new Date(now.getTime() + DRAIN_WINDOW_MS) })
        .where('id', '=', sessionId)
        .where('state', '=', 'active')
        .execute();
}

export async function endSession(db: AppDatabase, sessionId: string, now = new Date()): Promise<void> {
    await db.updateTable('auth_sessions').set({ state: 'ended', ended_at: now }).where('id', '=', sessionId).where('state', '!=', 'ended').execute();
}

/** Ends every session a family member has, on every device: what a parent does when a device is lost. */
export async function endSessionsOfMember(db: AppDatabase, familyMemberId: string, now = new Date()): Promise<void> {
    await db.updateTable('auth_sessions').set({ state: 'ended', ended_at: now }).where('family_member_id', '=', familyMemberId).where('state', '!=', 'ended').execute();
}
