import { NextRequest, NextResponse } from 'next/server';
import { upsertPushDevice } from '@/lib/messaging-service';
import { requireMessageActor, jsonRouteError } from '@/lib/message-route';
import { serveMessaging } from '@/lib/server/message-route';
import * as messaging from '@/lib/server/messaging';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    if (askedUnderSession(request)) return serveMessaging(request, 'Unable to register push device', async (db, actor, body) => ({ device: await messaging.registerPushDevice(db, actor, body) }));

    const actorResult = await requireMessageActor(request);
    if (!actorResult.ok) {
        return actorResult.response;
    }

    try {
        const body = (await request.json()) as { token?: string; platform?: string; isEnabled?: boolean };
        const device = await upsertPushDevice(actorResult.actor, {
            token: String(body?.token || ''),
            platform: String(body?.platform || ''),
            isEnabled: body?.isEnabled,
        });
        return NextResponse.json({ device }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        return jsonRouteError(error, 'Unable to register push device');
    }
}
