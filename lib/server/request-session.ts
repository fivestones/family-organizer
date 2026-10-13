import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_TOKEN_HEADER } from '@family-organizer/data/session/platform';
import { getDeviceAuthContextFromNextRequest } from '@/lib/device-auth-server';
import { getDb, isPostgresConfigured, type AppDatabase } from './db';
import { findSession, type Session } from './sessions';

export { SESSION_TOKEN_HEADER };

const noStore = { 'Cache-Control': 'no-store' };

export const jsonError = (status: number, code: string, error: string, headers: Record<string, string> = {}) =>
    NextResponse.json({ error, code }, { status, headers: { ...noStore, ...headers } });

export const jsonOk = (body: unknown) => NextResponse.json(body, { headers: noStore });

/** Whether a request is made under the app's own session, which is how a client on PowerSync asks for anything. */
export const askedUnderSession = (request: NextRequest) => request.headers.has(SESSION_TOKEN_HEADER);

export type DatabaseContext = { ok: true; db: AppDatabase } | { ok: false; response: NextResponse };

/** An activated device, on a deployment that has Postgres. Every route of the new backend starts here. */
export function requireDeviceAndDatabase(request: NextRequest): DatabaseContext {
    const device = getDeviceAuthContextFromNextRequest(request);
    if (!device.authorized) return { ok: false, response: jsonError(401, 'unauthorized_device', 'Unauthorized device') };
    if (!isPostgresConfigured()) return { ok: false, response: jsonError(503, 'postgres_not_configured', 'This deployment has no Postgres database') };
    return { ok: true, db: getDb() };
}

export type SessionContext = { ok: true; db: AppDatabase; session: Session } | { ok: false; response: NextResponse };

/**
 * The session a request is made under. A draining session is turned away unless the route says it will serve one,
 * which only the routes that finish an upload do.
 */
export async function requireSession(request: NextRequest, options: { allowDraining?: boolean } = {}): Promise<SessionContext> {
    const context = requireDeviceAndDatabase(request);
    if (!context.ok) return context;
    const session = await findSession(context.db, request.headers.get(SESSION_TOKEN_HEADER));
    if (!session) return { ok: false, response: jsonError(401, 'session_ended', 'This session has ended. Sign in again.') };
    if (session.state === 'draining' && !options.allowDraining) {
        return { ok: false, response: jsonError(403, 'session_draining', 'This session can only finish sending what it has.') };
    }
    return { ok: true, db: context.db, session };
}
