'use client';

import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { Check, CloudOff, Loader2, UploadCloud } from 'lucide-react';
import { useSyncState } from '@family-organizer/data/powersync/status';
import { cn } from '@/lib/utils';

/** Whether this device is in touch with the server, and how many changes made here are still to be sent. */
export function SyncBadge({ db }: { db: AbstractPowerSyncDatabase }) {
    const { connected, hasSynced, pendingChanges } = useSyncState(db);
    const waiting = pendingChanges === 1 ? '1 change waiting' : `${pendingChanges} changes waiting`;

    const look = !connected
        ? { Icon: CloudOff, label: pendingChanges ? `Offline · ${waiting}` : 'Offline', tone: 'border-amber-200 bg-amber-50 text-amber-900' }
        : pendingChanges
          ? { Icon: UploadCloud, label: `Sending · ${waiting}`, tone: 'border-sky-200 bg-sky-50 text-sky-900' }
          : hasSynced
            ? { Icon: Check, label: 'Up to date', tone: 'border-emerald-200 bg-emerald-50 text-emerald-900' }
            : { Icon: Loader2, label: 'Getting the family’s data…', tone: 'border-slate-200 bg-slate-50 text-slate-700' };

    return (
        <span
            role="status"
            data-testid="sync-badge"
            data-pending={pendingChanges}
            data-connected={connected}
            className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', look.tone)}
        >
            <look.Icon className={cn('h-3.5 w-3.5', look.Icon === Loader2 && 'animate-spin')} aria-hidden />
            {look.label}
        </span>
    );
}
