import { NextRequest } from 'next/server';
import { principalKey, type Principal } from '@family-organizer/data/session/principal';
import { checkParentElevationRateLimit, clearParentElevationRateLimit, getParentElevationRateLimitKey, recordParentElevationFailure } from '@/lib/parent-elevation-rate-limit';
import { jsonError, jsonOk, requireDeviceAndDatabase } from '@/lib/server/request-session';
import { createSession, type Session } from '@/lib/server/sessions';
import { memberNeedsRateLimit, verifySignIn } from '@/lib/server/sign-in';

export const dynamic = 'force-dynamic';

const sessionBody = (session: Session) => ({
    id: session.id,
    principalType: session.principal.type,
    familyMemberId: session.principal.familyMemberId,
    principalKey: principalKey(session.principal),
    state: session.state,
    expiresAt: session.expiresAt,
});

/**
 * Signs someone in on this device. With no family member it starts the shared kid session, which any activated
 * device may have. With one, that member's session, after their PIN if they have one.
 */
export async function POST(request: NextRequest) {
    const context = requireDeviceAndDatabase(request);
    if (!context.ok) return context.response;
    const { db } = context;

    let body: { familyMemberId?: unknown; pin?: unknown } = {};
    try {
        const parsed = await request.json();
        if (parsed && typeof parsed === 'object') body = parsed;
    } catch {
        return jsonError(400, 'invalid_body', 'Invalid request body');
    }

    let principal: Principal = { type: 'kid', familyMemberId: null };
    if (body.familyMemberId != null) {
        if (typeof body.familyMemberId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.familyMemberId)) return jsonError(400, 'invalid_member', 'familyMemberId is not valid');
        const familyMemberId = body.familyMemberId;
        const limited = await memberNeedsRateLimit(db, familyMemberId);
        if (limited === null) return jsonError(404, 'member_not_found', 'Family member not found');
        const rateLimitKey = limited ? getParentElevationRateLimitKey({ familyMemberId, ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') }) : null;
        if (rateLimitKey) {
            const decision = checkParentElevationRateLimit(rateLimitKey);
            if (!decision.allowed) {
                const retryAfterSeconds = Math.ceil(('retryAfterMs' in decision ? decision.retryAfterMs : 1000) / 1000);
                return jsonError(429, 'too_many_attempts', 'Too many sign-in attempts. Try again later.', { 'Retry-After': String(retryAfterSeconds) });
            }
        }

        const result = await verifySignIn(db, familyMemberId, typeof body.pin === 'string' ? body.pin : null);
        if (!result.ok) {
            if (result.reason === 'incorrect_pin' && rateLimitKey) recordParentElevationFailure(rateLimitKey);
            if (result.reason === 'member_not_found') return jsonError(404, 'member_not_found', 'Family member not found');
            if (result.reason === 'pin_required') return jsonError(400, 'pin_required', 'PIN is required');
            return jsonError(403, 'incorrect_pin', 'Incorrect PIN');
        }
        if (rateLimitKey) clearParentElevationRateLimit(rateLimitKey);
        principal = result.principal;
    }

    const { token, session } = await createSession(db, principal);
    return jsonOk({ token, session: sessionBody(session) });
}
