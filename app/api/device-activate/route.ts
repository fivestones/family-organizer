import { NextRequest, NextResponse } from 'next/server';
import { DEVICE_AUTH_COOKIE_NAME, sha256hex, getDeviceAuthCookieOptions } from '@/lib/device-auth';

export const dynamic = 'force-dynamic';

type ActivateBody = {
    key?: string;
};

export async function POST(request: NextRequest) {
    const secretKey = process.env.DEVICE_ACCESS_KEY;
    if (!secretKey) {
        return NextResponse.json({ error: 'Device activation is not configured' }, { status: 503 });
    }

    let body: ActivateBody = {};
    try {
        body = (await request.json()) as ActivateBody;
    } catch {
        return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const providedKey = typeof body.key === 'string' ? body.key.trim() : '';
    if (!providedKey) {
        return NextResponse.json({ error: 'Activation key is required' }, { status: 400 });
    }

    if (providedKey !== secretKey) {
        return NextResponse.json({ error: 'Invalid activation key' }, { status: 403 });
    }

    const expectedToken = await sha256hex(secretKey);
    // Prefer the Host header so the real public hostname is used even behind a reverse proxy
    const hostname = request.headers.get('host') ?? request.nextUrl.hostname;
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(DEVICE_AUTH_COOKIE_NAME, expectedToken, getDeviceAuthCookieOptions(hostname));
    return response;
}
