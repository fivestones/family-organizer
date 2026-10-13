import { NextRequest } from 'next/server';
import { isParent } from '@family-organizer/data/session/principal';
import { hashPinServer } from '@/lib/server/pin';
import { jsonError, jsonOk, requireSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PIN_LENGTH = 32;

/**
 * Sets a family member's PIN, or with `pin: null` removes it. A parent does this, for anyone.
 *
 * A PIN never reaches a device and no device can write one: only its hash is kept, here, and what devices are
 * sent is whether there is one.
 */
export async function PUT(request: NextRequest) {
    const context = await requireSession(request);
    if (!context.ok) return context.response;
    const { db, session } = context;
    if (!isParent(session.principal)) return jsonError(403, 'parent_required', 'Parent access required');

    const body = (await request.json().catch(() => null)) as { familyMemberId?: unknown; pin?: unknown } | null;
    if (!body || typeof body.familyMemberId !== 'string' || !MEMBER_ID.test(body.familyMemberId)) return jsonError(400, 'invalid_member', 'familyMemberId is not valid');
    const pin = body.pin == null ? null : typeof body.pin === 'string' ? body.pin.trim() : '';
    if (pin !== null && (pin.length === 0 || pin.length > MAX_PIN_LENGTH)) return jsonError(400, 'invalid_pin', 'A PIN is between 1 and 32 characters');

    const installation = await db.selectFrom('installation').select('writes_frozen').executeTakeFirstOrThrow();
    if (installation.writes_frozen) return jsonError(503, 'writes_frozen', 'Changes are paused for a moment. Try again shortly.', { 'Retry-After': '30' });

    const changed = await db
        .updateTable('family_members')
        .set({ pin_hash: pin === null ? null : hashPinServer(pin) })
        .where('id', '=', body.familyMemberId.toLowerCase())
        .returning('id')
        .executeTakeFirst();
    if (!changed) return jsonError(404, 'member_not_found', 'Family member not found');
    return jsonOk({ ok: true, hasPin: pin !== null });
}
