import { NextRequest } from 'next/server';
import { principalKey } from '@family-organizer/data/session/principal';
import { jsonOk, requireSession } from '@/lib/server/request-session';
import { drainSession, endSession } from '@/lib/server/sessions';

export const dynamic = 'force-dynamic';

/** The session a token belongs to, so a device can tell whether the one it kept is still good. */
export async function GET(request: NextRequest) {
    const context = await requireSession(request, { allowDraining: true });
    if (!context.ok) return context.response;
    const { session } = context;
    return jsonOk({
        session: {
            id: session.id,
            principalType: session.principal.type,
            familyMemberId: session.principal.familyMemberId,
            principalKey: principalKey(session.principal),
            state: session.state,
            expiresAt: session.expiresAt,
        },
    });
}

/**
 * Signs out. With `?drain=1` the session is kept for a day for one purpose: finishing the uploads its device
 * still holds. Without it the session ends at once.
 */
export async function DELETE(request: NextRequest) {
    const context = await requireSession(request, { allowDraining: true });
    if (!context.ok) return context.response;
    const { db, session } = context;
    const drain = request.nextUrl.searchParams.get('drain') === '1';
    if (drain) await drainSession(db, session.id);
    else await endSession(db, session.id);
    return jsonOk({ ok: true, state: drain ? 'draining' : 'ended' });
}
