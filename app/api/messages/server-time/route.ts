import { NextRequest, NextResponse } from 'next/server';
import { requireMessageActor } from '@/lib/message-route';
import { serveMessaging } from '@/lib/server/message-route';
import { askedUnderSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    if (askedUnderSession(request)) return serveMessaging(request, 'Unable to tell the time', async () => ({ serverNow: new Date().toISOString() }));

    const actorResult = await requireMessageActor(request);
    if (!actorResult.ok) {
        return actorResult.response;
    }

    return NextResponse.json(
        {
            serverNow: new Date().toISOString(),
        },
        {
            headers: {
                'Cache-Control': 'no-store',
            },
        }
    );
}
