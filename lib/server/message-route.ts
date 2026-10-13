import 'server-only';

import type { NextRequest } from 'next/server';
import { toMessageErrorResponse } from '@/lib/message-errors';
import type { AppDatabase } from './db';
import { messagingActor, type MessagingActor } from './messaging';
import { jsonError, jsonOk, requireSession } from './request-session';

/**
 * Serves a message route to a request made under the app's own session: finds who is asking, runs what they
 * asked, and turns a refusal into its answer. Nothing is changed while the server is not taking writes.
 */
export async function serveMessaging(request: NextRequest, fallback: string, run: (db: AppDatabase, actor: MessagingActor, body: any) => Promise<unknown>) {
    const context = await requireSession(request);
    if (!context.ok) return context.response;
    const reading = request.method === 'GET';
    try {
        if (!reading) {
            const installation = await context.db.selectFrom('installation').select('writes_frozen').executeTakeFirstOrThrow();
            if (installation.writes_frozen) return jsonError(503, 'writes_frozen', 'Changes are paused for a moment. Try again shortly.', { 'Retry-After': '30' });
        }
        const actor = await messagingActor(context.db, context.session.principal);
        const body = reading ? {} : ((await request.json().catch(() => null)) ?? {});
        return jsonOk(await run(context.db, actor, body));
    } catch (error) {
        const { message, status } = toMessageErrorResponse(error, fallback);
        if (status === 500) console.error(`[messages] ${fallback}`, error);
        return jsonError(status, status === 500 ? 'message_failed' : 'message_refused', message);
    }
}
