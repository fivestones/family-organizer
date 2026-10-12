'use client';

import dynamic from 'next/dynamic';

// The PowerSync client runs SQLite in the browser and has nothing to do on the server, so it is loaded there only.
const PowerSyncApp = dynamic(() => import('./PowerSyncApp'), { ssr: false });

export function SyncPreview() {
    return <PowerSyncApp />;
}
