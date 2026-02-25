'use client';

import React, { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/lib/db';

type BootstrapStatus = 'checking' | 'signing-in' | 'ready' | 'degraded';
export type InstantPrincipalType = 'kid' | 'parent' | 'unknown';

type ElevateParentParams = {
    familyMemberId: string;
    pin: string;
};

type InstantPrincipalContextValue = {
    principalType: InstantPrincipalType;
    isSwitchingPrincipal: boolean;
    canUseCachedParentPrincipal: boolean;
    ensureKidPrincipal: (opts?: { clearParentSession?: boolean }) => Promise<void>;
    elevateParentPrincipal: (params: ElevateParentParams) => Promise<void>;
};

const InstantPrincipalContext = createContext<InstantPrincipalContextValue | undefined>(undefined);

const KID_TOKEN_CACHE_KEY = 'family_organizer_instant_kid_token';
const PARENT_TOKEN_CACHE_KEY = 'family_organizer_instant_parent_token';
const PARENT_UNLOCKED_KEY = 'family_organizer_parent_principal_unlocked';
const PREFERRED_PRINCIPAL_KEY = 'family_organizer_preferred_principal';

function isBrowser() {
    return typeof window !== 'undefined';
}

function getCachedToken(principalType: 'kid' | 'parent') {
    if (!isBrowser()) return null;
    return localStorage.getItem(principalType === 'kid' ? KID_TOKEN_CACHE_KEY : PARENT_TOKEN_CACHE_KEY);
}

function setCachedToken(principalType: 'kid' | 'parent', token: string) {
    if (!isBrowser()) return;
    localStorage.setItem(principalType === 'kid' ? KID_TOKEN_CACHE_KEY : PARENT_TOKEN_CACHE_KEY, token);
}

function clearCachedToken(principalType: 'kid' | 'parent') {
    if (!isBrowser()) return;
    localStorage.removeItem(principalType === 'kid' ? KID_TOKEN_CACHE_KEY : PARENT_TOKEN_CACHE_KEY);
}

function getParentUnlocked() {
    if (!isBrowser()) return false;
    return localStorage.getItem(PARENT_UNLOCKED_KEY) === 'true';
}

function setParentUnlocked(value: boolean) {
    if (!isBrowser()) return;
    if (value) {
        localStorage.setItem(PARENT_UNLOCKED_KEY, 'true');
    } else {
        localStorage.removeItem(PARENT_UNLOCKED_KEY);
    }
}

function getPreferredPrincipal(): InstantPrincipalType {
    if (!isBrowser()) return 'unknown';
    const stored = localStorage.getItem(PREFERRED_PRINCIPAL_KEY);
    if (stored === 'kid' || stored === 'parent') return stored;
    return 'unknown';
}

function setPreferredPrincipal(principalType: 'kid' | 'parent') {
    if (!isBrowser()) return;
    localStorage.setItem(PREFERRED_PRINCIPAL_KEY, principalType);
}

async function fetchPrincipalToken(url: string, init?: RequestInit) {
    const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        ...init,
    });

    let payload: any = null;
    try {
        payload = await response.json();
    } catch {}

    if (!response.ok) {
        const error = new Error(payload?.error || `Token endpoint failed with ${response.status}`);
        (error as any).status = response.status;
        (error as any).code = payload?.code;
        throw error;
    }

    if (!payload?.token || typeof payload.token !== 'string') {
        throw new Error('Token endpoint returned an invalid response');
    }

    return payload.token as string;
}

export function InstantFamilySessionProvider({ children }: { children: ReactNode }) {
    const { isLoading, user, error } = db.useAuth();
    const [status, setStatus] = useState<BootstrapStatus>('checking');
    const [principalType, setPrincipalType] = useState<InstantPrincipalType>('unknown');
    const [isSwitchingPrincipal, setIsSwitchingPrincipal] = useState(false);
    const [parentUnlocked, setParentUnlockedState] = useState(false);
    const bootstrapStartedRef = useRef(false);

    const signInWithToken = async (principal: 'kid' | 'parent', token: string, opts?: { cacheToken?: boolean; unlockParent?: boolean }) => {
        await db.auth.signInWithToken(token);
        if (opts?.cacheToken !== false) {
            setCachedToken(principal, token);
        }
        if (principal === 'parent') {
            const unlockParent = opts?.unlockParent !== false;
            setParentUnlocked(unlockParent);
            setParentUnlockedState(unlockParent);
        }
        setPreferredPrincipal(principal);
        setPrincipalType(principal);
    };

    const signInKidPrincipal = async (opts?: { clearParentSession?: boolean; preferCached?: boolean }) => {
        if (!opts?.clearParentSession && user && principalType === 'kid') {
            return;
        }

        setIsSwitchingPrincipal(true);
        try {
            if (opts?.clearParentSession) {
                clearCachedToken('parent');
                setParentUnlocked(false);
                setParentUnlockedState(false);
            }

            const cachedKidToken = opts?.preferCached === false ? null : getCachedToken('kid');
            if (cachedKidToken) {
                try {
                    await signInWithToken('kid', cachedKidToken);
                    return;
                } catch (error) {
                    console.warn('Cached kid Instant token failed; fetching a fresh token.', error);
                    clearCachedToken('kid');
                }
            }

            const token = await fetchPrincipalToken('/api/instant-auth-token');
            await signInWithToken('kid', token);
        } finally {
            setIsSwitchingPrincipal(false);
        }
    };

    const elevateParentPrincipal = async ({ familyMemberId, pin }: ElevateParentParams) => {
        if (user && principalType === 'parent' && getParentUnlocked()) {
            return;
        }

        setIsSwitchingPrincipal(true);
        try {
            const cachedParentToken = getCachedToken('parent');
            if (cachedParentToken && getParentUnlocked()) {
                try {
                    await signInWithToken('parent', cachedParentToken, { unlockParent: true });
                    return;
                } catch (error) {
                    console.warn('Cached parent Instant token failed; falling back to server verification.', error);
                    clearCachedToken('parent');
                    setParentUnlocked(false);
                    setParentUnlockedState(false);
                }
            }

            const token = await fetchPrincipalToken('/api/instant-auth-parent-token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ familyMemberId, pin }),
            });

            await signInWithToken('parent', token, { unlockParent: true });
        } finally {
            setIsSwitchingPrincipal(false);
        }
    };

    useEffect(() => {
        if (!isBrowser()) return;
        setParentUnlockedState(getParentUnlocked());
    }, []);

    useEffect(() => {
        if (isLoading) {
            return;
        }

        if (user) {
            if (principalType === 'unknown') {
                const preferred = getPreferredPrincipal();
                setPrincipalType(preferred === 'unknown' ? 'kid' : preferred);
            }
            setStatus('ready');
            return;
        }

        if (bootstrapStartedRef.current) {
            // If auth disappeared after initial load, fall back to kid mode.
            void signInKidPrincipal({ preferCached: true }).catch((tokenError) => {
                console.error('Failed to restore kid Instant session', tokenError);
                setStatus('degraded');
            });
            return;
        }

        bootstrapStartedRef.current = true;
        let cancelled = false;

        const bootstrap = async () => {
            setStatus('signing-in');

            try {
                const preferred = getPreferredPrincipal();
                const canReuseParent = preferred === 'parent' && getParentUnlocked() && !!getCachedToken('parent');

                if (canReuseParent) {
                    const parentToken = getCachedToken('parent');
                    if (parentToken) {
                        try {
                            await signInWithToken('parent', parentToken, { unlockParent: true });
                            if (!cancelled) setStatus('ready');
                            return;
                        } catch (error) {
                            console.warn('Cached parent session restore failed; using kid principal.', error);
                            clearCachedToken('parent');
                            setParentUnlocked(false);
                            setParentUnlockedState(false);
                        }
                    }
                }

                await signInKidPrincipal({ preferCached: true });
                if (!cancelled) {
                    setStatus('ready');
                }
            } catch (tokenError) {
                console.error('Failed to bootstrap Instant session', tokenError);
                if (!cancelled) {
                    setStatus('degraded');
                }
            }
        };

        void bootstrap();

        return () => {
            cancelled = true;
        };
    }, [isLoading, user, principalType]);

    const contextValue = useMemo<InstantPrincipalContextValue>(
        () => ({
            principalType,
            isSwitchingPrincipal,
            canUseCachedParentPrincipal: parentUnlocked && !!getCachedToken('parent'),
            ensureKidPrincipal: signInKidPrincipal,
            elevateParentPrincipal,
        }),
        [principalType, isSwitchingPrincipal, parentUnlocked, signInKidPrincipal, elevateParentPrincipal]
    );

    if (isLoading || status === 'checking' || status === 'signing-in') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background text-foreground">
                <div className="text-sm opacity-80">Connecting to family data...</div>
            </div>
        );
    }

    if (error) {
        console.error('Instant auth state error', error);
    }

    return <InstantPrincipalContext.Provider value={contextValue}>{children}</InstantPrincipalContext.Provider>;
}

export function useInstantPrincipal() {
    const context = useContext(InstantPrincipalContext);
    if (!context) {
        throw new Error('useInstantPrincipal must be used within InstantFamilySessionProvider');
    }
    return context;
}
