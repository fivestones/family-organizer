import { NextRequest, NextResponse } from 'next/server';
import { markThreadRead } from '@/lib/messaging-service';
import { requireMessageActor, jsonRouteError } from '@/lib/message-route';
import { serveMessaging } from '@/lib/server/message-route';
import * as messaging from '@/lib/server/messaging';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ threadId: string }> }) {
    if (askedUnderSession(request)) {
        const { threadId } = await context.params;
        return serveMessaging(request, 'Unable to mark thread as read', (db, actor, body) => messaging.markThreadRead(db, actor, { threadId, lastReadMessageId: body.lastReadMessageId }));
    }

    const actorResult = await requireMessageActor(request);
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const params = await context.params;
        const body = (await request.json()) as { lastReadMessageId?: string };
        const result = await markThreadRead(actorResult.actor, {
            threadId: params.threadId,
            lastReadMessageId: String(body?.lastReadMessageId || ''),
        });
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to mark thread as read');
    }
}
