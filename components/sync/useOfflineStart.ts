'use client';

import { useEffect, useState } from 'react';

/**
 * Makes the page able to start with no network. Once the service worker is in charge of the page, it is asked to
 * keep the page itself, the scripts and styles the page has loaded, and the PowerSync worker's files. Returns true
 * when that has been done.
 */
export function useOfflineStart(): boolean {
    const [kept, setKept] = useState(false);

    useEffect(() => {
        if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return undefined;
        let stopped = false;

        const keep = async () => {
            const worker = navigator.serviceWorker.controller;
            if (!worker || stopped) return;
            const loaded = performance
                .getEntriesByType('resource')
                .map((entry) => new URL(entry.name, window.location.origin))
                .filter((url) => url.origin === window.location.origin && url.pathname.startsWith('/_next/static/'))
                .map((url) => url.pathname);
            const databaseFiles: string[] = await fetch('/@powersync/files.json', { cache: 'no-store' }).then(
                (response) => (response.ok ? response.json() : []),
                () => []
            );
            if (stopped) return;
            worker.postMessage({ type: 'keep', urls: Array.from(new Set([window.location.pathname, ...loaded, ...databaseFiles])) });
        };
        const heard = (event: MessageEvent) => {
            if (event.data?.type === 'kept' && !stopped) setKept(true);
        };

        navigator.serviceWorker.addEventListener('message', heard);
        // The worker takes charge of the page a moment after it is first installed.
        navigator.serviceWorker.addEventListener('controllerchange', keep);
        void navigator.serviceWorker.ready.then(keep);
        return () => {
            stopped = true;
            navigator.serviceWorker.removeEventListener('message', heard);
            navigator.serviceWorker.removeEventListener('controllerchange', keep);
        };
    }, []);

    return kept;
}
