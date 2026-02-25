import { NextRequest, NextResponse } from 'next/server';
import { DEVICE_AUTH_COOKIE_NAME, hasValidDeviceAuthCookie } from '@/lib/device-auth';
import { getFamilyMemberById, hashPinServer, isInstantFamilyAuthConfigured, mintPrincipalToken } from '@/lib/instant-admin';
import {
    checkParentElevationRateLimit,
    clearParentElevationRateLimit,
    getParentElevationRateLimitKey,
    recordParentElevationFailure,
} from '@/lib/parent-elevation-rate-limit';

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

    const rateLimitKey = getParentElevationRateLimitKey({
        familyMemberId: body.familyMemberId,
        ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip'),
    });
    const rateLimitDecision = checkParentElevationRateLimit(rateLimitKey);
    if (!rateLimitDecision.allowed) {
        const retryAfterSeconds = Math.ceil(
            ('retryAfterMs' in rateLimitDecision ? rateLimitDecision.retryAfterMs : 1000) / 1000
        );
        return NextResponse.json(
            { error: 'Too many parent elevation attempts. Try again later.' },
            {
                status: 429,
                headers: {
                    'Retry-After': String(retryAfterSeconds),
                    'Cache-Control': 'no-store',
                },
            }
        );
    }

    const member = (await getFamilyMemberById(body.familyMemberId)) as any;
    if (!member) {
        recordParentElevationFailure(rateLimitKey);
        return NextResponse.json({ error: 'Family member not found' }, { status: 404 });
    }

    if (member.role !== 'parent') {
        recordParentElevationFailure(rateLimitKey);
        return NextResponse.json({ error: 'Selected member is not a parent' }, { status: 403 });
    }

    const providedPin = typeof body.pin === 'string' ? body.pin : '';
    if (member.pinHash) {
        if (!providedPin) {
            recordParentElevationFailure(rateLimitKey);
            return NextResponse.json({ error: 'PIN is required' }, { status: 400 });
        }

        if (hashPinServer(providedPin) !== member.pinHash) {
            recordParentElevationFailure(rateLimitKey);
            return NextResponse.json({ error: 'Incorrect PIN' }, { status: 403 });
        }
    }

    try {
        const token = await mintPrincipalToken('parent');
        clearParentElevationRateLimit(rateLimitKey);
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
