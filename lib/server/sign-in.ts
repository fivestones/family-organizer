import 'server-only';

import type { Principal } from '@family-organizer/data/session/principal';
import type { AppDatabase } from './db';
import { hashPinServer, verifyPinHashServer } from './pin';

export type SignInResult =
    | { ok: true; principal: Principal; needsRateLimit: boolean }
    | { ok: false; reason: 'member_not_found' | 'pin_required' | 'incorrect_pin'; needsRateLimit: boolean };

/** Whether a failed attempt on this member should count against the limiter: a parent, or anyone with a PIN. */
export async function memberNeedsRateLimit(db: AppDatabase, familyMemberId: string): Promise<boolean | null> {
    const member = await db.selectFrom('family_members').select(['role', 'has_pin']).where('id', '=', familyMemberId).executeTakeFirst();
    return member ? member.role === 'parent' || member.has_pin : null;
}

/**
 * Who a sign-in is for, once the PIN has been checked. A member with no PIN needs none, as now. A PIN stored in
 * the old unsalted form is rehashed the first time it is used.
 */
export async function verifySignIn(db: AppDatabase, familyMemberId: string, pin: string | null | undefined): Promise<SignInResult> {
    const member = await db.selectFrom('family_members').select(['id', 'role', 'pin_hash']).where('id', '=', familyMemberId).executeTakeFirst();
    if (!member) return { ok: false, reason: 'member_not_found', needsRateLimit: false };
    const needsRateLimit = member.role === 'parent' || Boolean(member.pin_hash);

    if (member.pin_hash) {
        const provided = typeof pin === 'string' ? pin.trim() : '';
        if (!provided) return { ok: false, reason: 'pin_required', needsRateLimit };
        const verification = verifyPinHashServer(provided, member.pin_hash);
        if (!verification.valid) return { ok: false, reason: 'incorrect_pin', needsRateLimit };
        if (verification.needsUpgrade) {
            await db.updateTable('family_members').set({ pin_hash: hashPinServer(provided) }).where('id', '=', member.id).execute();
        }
    }
    const principal: Principal = member.role === 'parent' ? { type: 'parent', familyMemberId: member.id } : { type: 'kid', familyMemberId: member.id };
    return { ok: true, principal, needsRateLimit };
}
