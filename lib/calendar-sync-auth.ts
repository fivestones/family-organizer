import 'server-only';

import type { NextRequest } from 'next/server';
import { getDeviceAuthContextFromNextRequest } from '@/lib/device-auth-server';
import { getCalendarSyncCronSecret } from '@/lib/apple-caldav/config';

export function isCalendarSyncCronAuthorized(request: NextRequest) {
    const secret = getCalendarSyncCronSecret();
    if (!secret) return false;
    const bearer = request.headers.get('authorization') || '';
    const headerSecret = request.headers.get('x-calendar-sync-secret') || '';
    return bearer === `Bearer ${secret}` || headerSecret === secret;
}

export function requireCalendarSyncRouteAuth(request: NextRequest) {
    if (isCalendarSyncCronAuthorized(request)) {
        return { authorized: true, kind: 'cron' as const };
    }
    const deviceAuth = getDeviceAuthContextFromNextRequest(request);
    if (!deviceAuth.authorized) {
        const reason = 'reason' in deviceAuth ? deviceAuth.reason : 'unknown';
        return { authorized: false, reason };
    }
    return { authorized: true, kind: 'device' as const };
}
