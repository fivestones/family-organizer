import { NextRequest, NextResponse } from 'next/server';
import { getDeviceAuthContextFromNextRequest } from '@/lib/device-auth-server';
import { isInstantFamilyAuthConfigured, mintPrincipalToken } from '@/lib/instant-admin';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    const deviceAuth = getDeviceAuthContextFromNextRequest(request);
    if (!deviceAuth.authorized) {
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
