import { NextRequest, NextResponse } from 'next/server';
import { updateThreadPreferences } from '@/lib/messaging-service';
import { requireMessageActor, jsonRouteError } from '@/lib/message-route';
import type { MessageNotificationLevel } from '@/lib/messaging-types';
import { serveMessaging } from '@/lib/server/message-route';
import * as messaging from '@/lib/server/messaging';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, context: { params: Promise<{ threadId: string }> }) {
    if (askedUnderSession(request)) {
        const { threadId } = await context.params;
        return serveMessaging(request, 'Unable to update thread preferences', (db, actor, body) => messaging.updateThreadPreferences(db, actor, { ...body, threadId }));
    }

    const actorResult = await requireMessageActor(request);
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const params = await context.params;
        const body = (await request.json()) as {
            notificationLevel?: MessageNotificationLevel;
            isArchived?: boolean;
            isPinned?: boolean;
        };
        const thread = await updateThreadPreferences(actorResult.actor, {
            threadId: params.threadId,
            notificationLevel: body?.notificationLevel,
            isArchived: body?.isArchived,
            isPinned: body?.isPinned,
        });
        return NextResponse.json({ thread }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to update thread preferences');
    }
}
