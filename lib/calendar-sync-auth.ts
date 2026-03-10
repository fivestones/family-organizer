import 'server-only';

import type { NextRequest } from 'next/server';
import { getDeviceAuthContextFromNextRequest } from '@/lib/device-auth-server';
import { getCalendarSyncCronSecret } from '@/lib/apple-caldav/config';
import { getInstantAdminDb, getParentPrincipalAuthEmail } from '@/lib/instant-admin';
import { CALENDAR_SYNC_PARENT_TOKEN_HEADER } from '@/lib/calendar-sync-constants';

export function isCalendarSyncCronAuthorized(request: NextRequest) {
    const secret = getCalendarSyncCronSecret();
    if (!secret) return false;
    const bearer = request.headers.get('authorization') || '';
    const headerSecret = request.headers.get('x-calendar-sync-secret') || '';
    return bearer === `Bearer ${secret}` || headerSecret === secret;
}

async function requestHasVerifiedParentPrincipalCookie(request: NextRequest) {
    try {
        const user = await getInstantAdminDb().auth.getUserFromRequest(request);
        return user?.email === getParentPrincipalAuthEmail();
    } catch {
        return false;
    }
}

async function requestHasVerifiedParentPrincipalHeader(request: NextRequest) {
    const token = request.headers.get(CALENDAR_SYNC_PARENT_TOKEN_HEADER) || '';
    if (!token) return false;
    try {
        const user = await getInstantAdminDb().auth.verifyToken(token as any);
        return user?.email === getParentPrincipalAuthEmail();
    } catch {
        return false;
    }
}

export async function requireCalendarSyncRouteAuth(request: NextRequest) {
    if (isCalendarSyncCronAuthorized(request)) {
        return { authorized: true, kind: 'cron' as const };
    }

    if (await requestHasVerifiedParentPrincipalCookie(request)) {
        return { authorized: true, kind: 'parent-cookie' as const };
    }

    const deviceAuth = getDeviceAuthContextFromNextRequest(request);
    if (!deviceAuth.authorized) {
        const reason = 'reason' in deviceAuth ? deviceAuth.reason : 'unknown';
        return { authorized: false, reason };
    }

    if (await requestHasVerifiedParentPrincipalHeader(request)) {
        return { authorized: true, kind: 'parent-device' as const };
    }

    return { authorized: false, reason: 'parent_required' as const };
}
