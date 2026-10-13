import { NextRequest, NextResponse } from 'next/server';
import { editThreadMessage } from '@/lib/messaging-service';
import { requireMessageActor, jsonRouteError } from '@/lib/message-route';
import { serveMessaging } from '@/lib/server/message-route';
import * as messaging from '@/lib/server/messaging';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ messageId: string }> }) {
    if (askedUnderSession(request)) {
        const { messageId } = await context.params;
        return serveMessaging(request, 'Unable to edit message', (db, actor, body) => messaging.editMessage(db, actor, { messageId, body: body.body }));
    }

    const actorResult = await requireMessageActor(request);
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const params = await context.params;
        const body = (await request.json()) as { body?: string };
        const message = await editThreadMessage(actorResult.actor, {
            messageId: params.messageId,
            body: String(body?.body || ''),
        });
        return NextResponse.json({ message }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to edit message');
    }
}
