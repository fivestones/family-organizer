import { NextRequest, NextResponse } from 'next/server';
import { removeThreadMessage } from '@/lib/messaging-service';
import { requireMessageActor, jsonRouteError } from '@/lib/message-route';
import { serveMessaging } from '@/lib/server/message-route';
import * as messaging from '@/lib/server/messaging';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ messageId: string }> }) {
    if (askedUnderSession(request)) {
        const { messageId } = await context.params;
        return serveMessaging(request, 'Unable to remove message', (db, actor, body) => messaging.removeMessage(db, actor, { messageId, reason: body.reason }));
    }

    const actorResult = await requireMessageActor(request);
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const params = await context.params;
        const body = (await request.json().catch(() => ({}))) as { reason?: string };
        const message = await removeThreadMessage(actorResult.actor, {
            messageId: params.messageId,
            reason: body.reason || null,
        });
        return NextResponse.json({ message }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to remove message');
    }
}
