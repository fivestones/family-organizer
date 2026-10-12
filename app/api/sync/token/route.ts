import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireSession } from '@/lib/server/request-session';
import { isSyncTokenConfigured, signSyncToken } from '@/lib/server/sync-token';

export const dynamic = 'force-dynamic';

/**
 * Exchanges a session for a token the PowerSync service accepts. A draining session may have one: sending what
 * its device still holds needs the sync connection, and a draining session can do nothing else with it.
 */
export async function GET(request: NextRequest) {
    const context = await requireSession(request, { allowDraining: true });
    if (!context.ok) return context.response;
    if (!isSyncTokenConfigured()) return jsonError(503, 'sync_not_configured', 'This deployment has no key to sign sync tokens with');
    return jsonOk(signSyncToken(context.session.principal));
}
