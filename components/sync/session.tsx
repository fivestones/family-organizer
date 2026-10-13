'use client';

import { createContext, useContext, useMemo } from 'react';
import type { SessionManager, SessionSnapshot } from '@family-organizer/data/session/manager';
import { useFamilyMember, type FamilyMember, type Principal } from '@/lib/data';

// Who is signed in on this device, for every screen of the app on PowerSync. The frame provides it; a screen
// reads it. Everything below the frame is mounted afresh when the person changes, so what a screen reads here
// does not change under it.

export interface Session {
    manager: SessionManager;
    principal: Principal;
    /** A parent who has stepped in on a device that rests on someone else. */
    steppedIn: boolean;
    snapshot: SessionSnapshot;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ manager, snapshot, children }: { manager: SessionManager; snapshot: SessionSnapshot; children: React.ReactNode }) {
    const principal = snapshot.device!.principal;
    const value = useMemo(() => ({ manager, principal, steppedIn: snapshot.steppedIn, snapshot }), [manager, principal, snapshot]);
    return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
    const session = useContext(SessionContext);
    if (!session) throw new Error('useSession is for screens inside the app on PowerSync.');
    return session;
}

/** Whether a parent is signed in. Most of what only a parent may do is refused by the rules as well; this decides what is shown. */
export const useIsParent = (): boolean => useSession().principal.type === 'parent';

/** The family member who is signed in, or `null` for the shared sign-in, which is nobody in particular. */
export function useCurrentMember(): FamilyMember | null {
    const { principal } = useSession();
    return useFamilyMember(principal.familyMemberId).data;
}
