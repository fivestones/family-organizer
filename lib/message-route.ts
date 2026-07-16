import 'server-only';

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { requireRequestFamilyMember } from '@/lib/request-family-member';
import { toMessageErrorResponse } from '@/lib/message-errors';

export async function requireMessageActor(request: NextRequest, options?: { requireParent?: boolean }) {
    const session = await requireRequestFamilyMember(request, options);
    if (!session.ok) {
        const failure = session as Extract<typeof session, { ok: false }>;
        return {
            ok: false as const,
            response: NextResponse.json(
                {
                    error: failure.error,
                    ...(failure.reason ? { reason: failure.reason } : {}),
                },
                { status: failure.status }
            ),
        };
    }

    return {
        ok: true as const,
        actor: session.familyMember,
    };
}

export function jsonRouteError(error: unknown, fallback = 'Request failed') {
    const { message, status } = toMessageErrorResponse(error, fallback);
    if (status === 500) {
        console.error(`[messages] ${fallback}`, error);
    }
    return NextResponse.json({ error: message }, { status });
}
