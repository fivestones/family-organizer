import { NextRequest } from 'next/server';
import { isParent } from '@family-organizer/data/session/principal';
import { jsonError, jsonOk, requireSession } from '@/lib/server/request-session';
import { endSessionsOfMember } from '@/lib/server/sessions';

export const dynamic = 'force-dynamic';

const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Signs a family member out of every device, at once: what a parent does when a device is lost. Changes that
 * person had not yet sent stay on the devices that hold them, and go up when they next sign in there.
 */
export async function DELETE(request: NextRequest, context: { params: Promise<{ memberId: string }> }) {
    const asked = await requireSession(request);
    if (!asked.ok) return asked.response;
    if (!isParent(asked.session.principal)) return jsonError(403, 'parent_required', 'Parent access required');
    const { memberId } = await context.params;
    if (!MEMBER_ID.test(memberId)) return jsonError(404, 'member_not_found', 'Family member not found');

    await endSessionsOfMember(asked.db, memberId.toLowerCase());
    return jsonOk({ ok: true });
}
