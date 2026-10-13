import { NextRequest, NextResponse } from 'next/server';
import { createMessageThread } from '@/lib/messaging-service';
import { requireMessageActor, jsonRouteError } from '@/lib/message-route';
import type { CreateThreadRequest } from '@/lib/messaging-types';
import { serveMessaging } from '@/lib/server/message-route';
import * as messaging from '@/lib/server/messaging';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    if (askedUnderSession(request)) return serveMessaging(request, 'Unable to create thread', (db, actor, body) => messaging.createThread(db, actor, body));

    const actorResult = await requireMessageActor(request);
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const body = (await request.json()) as CreateThreadRequest;
        const thread = await createMessageThread(actorResult.actor, body);
        return NextResponse.json({ thread }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to create thread');
    }
}
