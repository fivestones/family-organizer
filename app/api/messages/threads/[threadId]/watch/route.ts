import { NextRequest, NextResponse } from 'next/server';
import { joinThreadWatchMode, leaveThreadWatchMode } from '@/lib/messaging-service';
import { requireMessageActor, jsonRouteError } from '@/lib/message-route';
import { serveMessaging } from '@/lib/server/message-route';
import * as messaging from '@/lib/server/messaging';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ threadId: string }> }) {
    if (askedUnderSession(request)) {
        const { threadId } = await context.params;
        return serveMessaging(request, 'Unable to watch thread', (db, actor) => messaging.watchThread(db, actor, { threadId }));
    }

    const actorResult = await requireMessageActor(request, { requireParent: true });
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const params = await context.params;
        const thread = await joinThreadWatchMode(actorResult.actor, {
            threadId: params.threadId,
        });
        return NextResponse.json({ thread }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to watch thread');
    }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ threadId: string }> }) {
    if (askedUnderSession(request)) {
        const { threadId } = await context.params;
        return serveMessaging(request, 'Unable to leave watch mode', (db, actor) => messaging.stopWatchingThread(db, actor, { threadId }));
    }

    const actorResult = await requireMessageActor(request, { requireParent: true });
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const params = await context.params;
        const thread = await leaveThreadWatchMode(actorResult.actor, {
            threadId: params.threadId,
        });
        return NextResponse.json({ thread }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to leave watch mode');
    }
}
