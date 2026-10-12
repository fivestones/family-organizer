'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

// The app's frame on InstantDB, loaded only where it is used. The page that runs on PowerSync must not load it:
// it opens a connection to InstantDB the moment it is imported.
const InstantAppShell = dynamic(() => import('@/components/InstantAppShell'));

/** The one page that runs on PowerSync so far brings a frame of its own. Every other page is on InstantDB. */
export const isPowerSyncPath = (pathname: string | null) => pathname === '/sync' || Boolean(pathname?.startsWith('/sync/'));

export function AppShell({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    if (isPowerSyncPath(pathname)) return <>{children}</>;
    return <InstantAppShell>{children}</InstantAppShell>;
}
