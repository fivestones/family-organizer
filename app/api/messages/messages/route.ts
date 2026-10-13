import { NextRequest, NextResponse } from 'next/server';
import { sendThreadMessage } from '@/lib/messaging-service';
import { requireMessageActor, jsonRouteError } from '@/lib/message-route';
import type { SendMessageRequest } from '@/lib/messaging-types';
import { serveMessaging } from '@/lib/server/message-route';
import * as messaging from '@/lib/server/messaging';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    if (askedUnderSession(request)) return serveMessaging(request, 'Unable to send message', (db, actor, body) => messaging.sendMessage(db, actor, body));

    const actorResult = await requireMessageActor(request);
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const body = (await request.json()) as SendMessageRequest;
        const message = await sendThreadMessage(actorResult.actor, body);
        return NextResponse.json({ message }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to send message');
    }
}
