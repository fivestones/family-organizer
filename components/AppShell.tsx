'use client';

import dynamic from 'next/dynamic';
import { useSelectedLayoutSegments } from 'next/navigation';

// The app's frame on InstantDB, loaded only where it is used. A page of the app on PowerSync must not load it:
// it opens a connection to InstantDB the moment it is imported.
const InstantAppShell = dynamic(() => import('@/components/InstantAppShell'));

/**
 * Every page under app/sync/ belongs to the app on PowerSync and brings a frame of its own. Which page is being
 * shown is read from the route, not the address: on a PowerSync deployment those pages are shown at the addresses
 * of the pages they replace.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
    const segments = useSelectedLayoutSegments();
    if (segments?.[0] === 'sync') return <>{children}</>;
    return <InstantAppShell>{children}</InstantAppShell>;
}
