'use client';

import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/lib/db';
import {
    DEFAULT_PARENT_SHARED_DEVICE,
    getCachedToken,
    getParentSharedDeviceIdleTimeoutMs,
    getParentSharedDeviceMode,
    getParentUnlocked,
    getPreferredPrincipal,
    isBrowser,
} from '@/lib/instant-principal-storage';
import type { ElevateParentParams, InstantPrincipalType } from '@/lib/instant-principal-types';
import { useParentSharedDeviceTimeout } from '@/components/auth/useParentSharedDeviceTimeout';
import { useInstantPrincipalSwitching } from '@/components/auth/useInstantPrincipalSwitching';

type BootstrapStatus = 'checking' | 'signing-in' | 'ready' | 'degraded';

type InstantPrincipalContextValue = {
    principalType: InstantPrincipalType;
    isSwitchingPrincipal: boolean;
    canUseCachedParentPrincipal: boolean;
    isParentSessionSharedDevice: boolean;
    parentSharedDeviceIdleTimeoutMs: number;
    ensureKidPrincipal: (opts?: { clearParentSession?: boolean }) => Promise<void>;
    elevateParentPrincipal: (params: ElevateParentParams) => Promise<void>;
};

const InstantPrincipalContext = createContext<InstantPrincipalContextValue | undefined>(undefined);

export function InstantFamilySessionProvider({ children }: { children: ReactNode }) {
    const { isLoading, user, error } = db.useAuth();
    const [status, setStatus] = useState<BootstrapStatus>('checking');
    const [principalType, setPrincipalType] = useState<InstantPrincipalType>('unknown');
    const [isSwitchingPrincipal, setIsSwitchingPrincipal] = useState(false);
    const [parentUnlocked, setParentUnlockedState] = useState(false);
    const [isParentSessionSharedDevice, setIsParentSessionSharedDevice] = useState(DEFAULT_PARENT_SHARED_DEVICE);
    const bootstrapStartedRef = useRef(false);
    const parentSharedDeviceIdleTimeoutMs = getParentSharedDeviceIdleTimeoutMs();

    const { clearParentSessionState, ensureKidPrincipal, elevateParentPrincipal, signInWithToken } = useInstantPrincipalSwitching({
        user,
        principalType,
        setPrincipalType,
        setIsSwitchingPrincipal,
        setParentUnlockedState,
        setIsParentSessionSharedDeviceState: setIsParentSessionSharedDevice,
    });

    useEffect(() => {
        if (!isBrowser()) return;
        setParentUnlockedState(getParentUnlocked());
        setIsParentSessionSharedDevice(getParentSharedDeviceMode());
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
            void ensureKidPrincipal({ preferCached: true }).catch((tokenError) => {
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
                        } catch (restoreError) {
                            console.warn('Cached parent session restore failed; using kid principal.', restoreError);
                            clearParentSessionState();
                            setIsParentSessionSharedDevice(getParentSharedDeviceMode());
                        }
                    }
                }

                await ensureKidPrincipal({ preferCached: true });
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
    }, [clearParentSessionState, ensureKidPrincipal, isLoading, principalType, signInWithToken, user]);

    const expireParentSharedDeviceMode = useCallback(() => {
        console.log('Parent mode expired on shared device due to inactivity.');
        void ensureKidPrincipal({ clearParentSession: true }).catch((timeoutError) => {
            console.error('Failed to expire parent shared-device mode', timeoutError);
        });
    }, [ensureKidPrincipal]);

    useParentSharedDeviceTimeout({
        principalType,
        parentUnlocked,
        isParentSessionSharedDevice,
        parentSharedDeviceIdleTimeoutMs,
        expireParentMode: expireParentSharedDeviceMode,
    });

    const contextValue = useMemo<InstantPrincipalContextValue>(
        () => ({
            principalType,
            isSwitchingPrincipal,
            canUseCachedParentPrincipal: parentUnlocked && !!getCachedToken('parent'),
            isParentSessionSharedDevice,
            parentSharedDeviceIdleTimeoutMs,
            ensureKidPrincipal,
            elevateParentPrincipal,
        }),
        [
            principalType,
            isSwitchingPrincipal,
            parentUnlocked,
            isParentSessionSharedDevice,
            parentSharedDeviceIdleTimeoutMs,
            ensureKidPrincipal,
            elevateParentPrincipal,
        ]
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
