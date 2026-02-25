import { NextRequest, NextResponse } from 'next/server';
import { DEVICE_AUTH_COOKIE_NAME, hasValidDeviceAuthCookie } from '@/lib/device-auth';
import { isInstantFamilyAuthConfigured, mintPrincipalToken } from '@/lib/instant-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const cookieValue = request.cookies.get(DEVICE_AUTH_COOKIE_NAME)?.value;
    if (!hasValidDeviceAuthCookie(cookieValue)) {
        return NextResponse.json({ error: 'Unauthorized device' }, { status: 401 });
    }

    if (!isInstantFamilyAuthConfigured()) {
        return NextResponse.json(
            {
                error: 'Instant family auth is not configured',
                code: 'family_token_auth_not_configured',
            },
            { status: 503, headers: { 'Cache-Control': 'no-store' } }
        );
    }

    try {
        const token = await mintPrincipalToken('kid');

        return NextResponse.json(
            {
                token,
                principalType: 'kid',
            },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        console.error('Failed to mint Instant auth token', error);
        return NextResponse.json(
            { error: 'Failed to create Instant auth token' },
            { status: 500, headers: { 'Cache-Control': 'no-store' } }
        );
    }
}
