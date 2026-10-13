import { NextRequest, NextResponse } from 'next/server';
import { acknowledgeMessage } from '@/lib/messaging-service';
import { requireMessageActor, jsonRouteError } from '@/lib/message-route';
import { serveMessaging } from '@/lib/server/message-route';
import * as messaging from '@/lib/server/messaging';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ messageId: string }> }) {
    if (askedUnderSession(request)) {
        const { messageId } = await context.params;
        return serveMessaging(request, 'Unable to acknowledge message', (db, actor, body) => messaging.acknowledgeMessage(db, actor, { messageId, kind: body.kind }));
    }

    const actorResult = await requireMessageActor(request);
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const params = await context.params;
        const body = (await request.json()) as { kind?: 'seen' | 'acknowledged' };
        const result = await acknowledgeMessage(actorResult.actor, {
            messageId: params.messageId,
            kind: body?.kind || 'seen',
        });
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to acknowledge message');
    }
}
