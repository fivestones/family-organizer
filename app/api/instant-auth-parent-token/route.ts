import { NextRequest, NextResponse } from 'next/server';
import { DEVICE_AUTH_COOKIE_NAME, hasValidDeviceAuthCookie } from '@/lib/device-auth';
import { getFamilyMemberById, hashPinServer, isInstantFamilyAuthConfigured, mintPrincipalToken } from '@/lib/instant-admin';

export const dynamic = 'force-dynamic';

type ParentElevationBody = {
    familyMemberId?: string;
    pin?: string;
};

export async function POST(request: NextRequest) {
    const cookieValue = request.cookies.get(DEVICE_AUTH_COOKIE_NAME)?.value;
    if (!hasValidDeviceAuthCookie(cookieValue)) {
        return NextResponse.json({ error: 'Unauthorized device' }, { status: 401 });
    }

    if (!isInstantFamilyAuthConfigured()) {
        return NextResponse.json({ error: 'Instant auth is not configured' }, { status: 503 });
    }

    let body: ParentElevationBody = {};
    try {
        body = (await request.json()) as ParentElevationBody;
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    if (!body.familyMemberId || typeof body.familyMemberId !== 'string') {
        return NextResponse.json({ error: 'familyMemberId is required' }, { status: 400 });
    }

    const member = (await getFamilyMemberById(body.familyMemberId)) as any;
    if (!member) {
        return NextResponse.json({ error: 'Family member not found' }, { status: 404 });
    }

    if (member.role !== 'parent') {
        return NextResponse.json({ error: 'Selected member is not a parent' }, { status: 403 });
    }

    const providedPin = typeof body.pin === 'string' ? body.pin : '';
    if (member.pinHash) {
        if (!providedPin) {
            return NextResponse.json({ error: 'PIN is required' }, { status: 400 });
        }

        if (hashPinServer(providedPin) !== member.pinHash) {
            return NextResponse.json({ error: 'Incorrect PIN' }, { status: 403 });
        }
    }

    try {
        const token = await mintPrincipalToken('parent');
        return NextResponse.json(
            {
                token,
                principalType: 'parent',
            },
            { headers: { 'Cache-Control': 'no-store' } }
        );
    } catch (error) {
        console.error('Failed to mint parent Instant auth token', error);
        return NextResponse.json({ error: 'Failed to create parent auth token' }, { status: 500 });
    }
}
