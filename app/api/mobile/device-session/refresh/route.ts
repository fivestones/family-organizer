import { NextRequest, NextResponse } from 'next/server';
import { extractBearerTokenFromAuthorizationHeader, refreshMobileDeviceSessionToken } from '@/lib/device-auth-server';

export const dynamic = 'force-dynamic';

function noStoreJson(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
    const bearer = extractBearerTokenFromAuthorizationHeader(request.headers.get('authorization'));
    const result = refreshMobileDeviceSessionToken(bearer);

    if (!result.ok) {
        return noStoreJson({ error: 'Unauthorized device' }, 401);
    }
    if (!('token' in result)) {
        return noStoreJson({ error: 'Unauthorized device' }, 401);
    }

    return noStoreJson({
        deviceSessionToken: result.token,
        expiresAt: result.expiresAt,
        sessionId: result.sessionId,
    });
}
