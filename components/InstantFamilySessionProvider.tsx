'use client';

import React, { ReactNode, useEffect, useState } from 'react';
import { db } from '@/lib/db';

type BootstrapStatus = 'checking' | 'signing-in' | 'ready' | 'degraded';

export function InstantFamilySessionProvider({ children }: { children: ReactNode }) {
    const { isLoading, user, error } = db.useAuth();
    const [status, setStatus] = useState<BootstrapStatus>('checking');

    useEffect(() => {
        if (isLoading) {
            return;
        }

        if (user) {
            setStatus('ready');
            return;
        }

        let cancelled = false;

        const signIn = async () => {
            setStatus('signing-in');

            try {
                const response = await fetch('/api/instant-auth-token', {
                    method: 'GET',
                    cache: 'no-store',
                    credentials: 'same-origin',
                });

                if (!response.ok) {
                    let payload: any = null;
                    try {
                        payload = await response.json();
                    } catch {}

                    if (response.status === 503 && payload?.code === 'family_token_auth_not_configured') {
                        console.warn('Instant family-token auth not configured yet; continuing without Instant auth token.');
                        if (!cancelled) {
                            setStatus('degraded');
                        }
                        return;
                    }

                    throw new Error(payload?.error || `Token endpoint failed with ${response.status}`);
                }

                const payload = await response.json();
                if (!payload?.token || typeof payload.token !== 'string') {
                    throw new Error('Token endpoint returned an invalid response');
                }

                await db.auth.signInWithToken(payload.token);
                if (!cancelled) {
                    setStatus('ready');
                }
            } catch (tokenError) {
                console.error('Failed to bootstrap Instant family session', tokenError);
                if (!cancelled) {
                    setStatus('degraded');
                }
            }
        };

        void signIn();

        return () => {
            cancelled = true;
        };
    }, [isLoading, user]);

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

    return <>{children}</>;
}
