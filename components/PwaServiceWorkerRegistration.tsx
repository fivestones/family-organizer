'use client';

import { useEffect } from 'react';

export function PwaServiceWorkerRegistration() {
    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!('serviceWorker' in navigator)) return;

        const enableInDev = process.env.NEXT_PUBLIC_ENABLE_SW_IN_DEV === 'true';
        if (process.env.NODE_ENV !== 'production' && !enableInDev) {
            return;
        }

        let cancelled = false;

        const register = async () => {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
                if (cancelled) return;

                // Kick the browser to fetch an updated worker in the background.
                void registration.update().catch(() => {});
            } catch (error) {
                console.warn('Service worker registration failed', error);
            }
        };

        void register();

        return () => {
            cancelled = true;
        };
    }, []);

    return null;
}
