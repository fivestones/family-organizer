import { useEffect, useState } from 'react';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { AppSchema } from './schema';

/** What a person needs to know about sync: whether this device is in touch, and whether anything of theirs is still to send. */
export interface SyncState {
    /** In touch with the sync service right now. */
    connected: boolean;
    /** Has had the family's data at least once. */
    hasSynced: boolean;
    /** Changes made here that the server has not yet answered for: one for each mutation. */
    pendingChanges: number;
}

async function countPending(db: AbstractPowerSyncDatabase): Promise<number> {
    const rows = await db.getAll<{ changes: number }>('SELECT count(DISTINCT tx_id) AS changes FROM ps_crud');
    return rows[0]?.changes ?? 0;
}

/** Live. The sync state of one person's database. */
export function useSyncState(db: AbstractPowerSyncDatabase): SyncState {
    const [state, setState] = useState<SyncState>(() => ({ connected: Boolean(db.currentStatus?.connected), hasSynced: Boolean(db.currentStatus?.hasSynced), pendingChanges: 0 }));

    useEffect(() => {
        let stopped = false;
        const update = (patch: Partial<SyncState>) => {
            if (!stopped) setState((previous) => ({ ...previous, ...patch }));
        };
        const recount = () => void countPending(db).then((pendingChanges) => update({ pendingChanges }), () => undefined);

        update({ connected: Boolean(db.currentStatus?.connected), hasSynced: Boolean(db.currentStatus?.hasSynced) });
        recount();
        const stopStatus = db.registerListener({
            statusChanged: (status) => {
                update({ connected: Boolean(status.connected), hasSynced: Boolean(status.hasSynced) });
                recount();
            },
        });
        // A mutation here changes one of the app's tables, and an upload landing changes the status above, so
        // between them the count is taken again whenever it could have changed.
        const stopQueue = db.onChangeWithCallback({ onChange: recount }, { tables: AppSchema.tables.map((table) => table.name), throttleMs: 50 });
        return () => {
            stopped = true;
            stopStatus();
            stopQueue();
        };
    }, [db]);

    return state;
}
