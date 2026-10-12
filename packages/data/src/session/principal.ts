/**
 * Who a session acts as. A parent is always a particular family member. A kid session either belongs to one member
 * or is the shared one, which any activated device may hold and which can read the family's data but owns nothing.
 */
export type Principal = { type: 'parent'; familyMemberId: string } | { type: 'kid'; familyMemberId: string | null };

/**
 * One name per principal, safe to use in a file name. A device keeps one local database for each, and the server
 * records it against every upload.
 */
export function principalKey(principal: Principal): string {
    if (principal.type === 'parent') return `parent-${principal.familyMemberId}`;
    return principal.familyMemberId ? `kid-${principal.familyMemberId}` : 'kid-shared';
}

export function isParent(principal: Principal): principal is Extract<Principal, { type: 'parent' }> {
    return principal.type === 'parent';
}
