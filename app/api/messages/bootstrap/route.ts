import { NextRequest, NextResponse } from 'next/server';
import { ensureMessagingBootstrap } from '@/lib/messaging-service';
import { requireMessageActor, jsonRouteError } from '@/lib/message-route';
import { serveMessaging } from '@/lib/server/message-route';
import * as messaging from '@/lib/server/messaging';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    if (askedUnderSession(request)) return serveMessaging(request, 'Unable to bootstrap messages', (db) => messaging.ensureStandingThreads(db));

    const actorResult = await requireMessageActor(request);
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const result = await ensureMessagingBootstrap();
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to bootstrap messages');
    }
}
