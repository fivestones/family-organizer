import { useEffect, useRef, useState } from 'react';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import type { QueryResult, ReadOptions } from '../query-result';
import type { Reader } from './sql';

/** Whether a database has completed a first sync, now or in an earlier session. */
function useHasSynced(db: AbstractPowerSyncDatabase): boolean {
    const [hasSynced, setHasSynced] = useState(() => Boolean(db.currentStatus?.hasSynced));
    useEffect(() => {
        setHasSynced(Boolean(db.currentStatus?.hasSynced));
        return db.registerListener({ statusChanged: (status) => setHasSynced(Boolean(status.hasSynced)) });
    }, [db]);
    return hasSynced;
}

/**
 * A live read. `read` runs every query it needs inside one read transaction, so what it returns is the database
 * at one moment, and it runs again whenever one of `tables` changes, whether from a write here or from sync.
 * `shape` turns what was read into what the screen is given, and is only called when what was read has changed,
 * so the result keeps its identity until then.
 *
 * It reports loading until this person's database has synced once: a new device shows that it is loading, not an
 * empty family.
 */
export function useLiveRead<Raw, Result>(
    db: AbstractPowerSyncDatabase,
    tables: readonly string[],
    read: (reader: Reader) => Promise<Raw>,
    shape: (raw: Raw) => Result,
    empty: Result,
    dependencies: readonly unknown[],
    options?: ReadOptions
): QueryResult<Result> {
    const enabled = options?.enabled !== false;
    const hasSynced = useHasSynced(db);
    const [state, setState] = useState<{ data: Result; error: Error | undefined; settled: boolean }>({ data: empty, error: undefined, settled: false });
    // `read` and `shape` are new functions on every render; the latest are used without restarting the watch.
    const latest = useRef({ read, shape });
    latest.current = { read, shape };

    useEffect(() => {
        if (!enabled) {
            setState({ data: empty, error: undefined, settled: false });
            return undefined;
        }
        let stopped = false;
        let running = false;
        let stale = false;
        let lastRead: string | null = null;

        const refresh = async () => {
            if (running) {
                stale = true;
                return;
            }
            running = true;
            try {
                do {
                    stale = false;
                    const raw = await db.readTransaction((transaction) => latest.current.read(transaction));
                    if (stopped) return;
                    const signature = JSON.stringify(raw);
                    if (signature !== lastRead) {
                        lastRead = signature;
                        setState({ data: latest.current.shape(raw), error: undefined, settled: true });
                    } else {
                        setState((previous) => (previous.settled && !previous.error ? previous : { ...previous, error: undefined, settled: true }));
                    }
                } while (stale && !stopped);
            } catch (error) {
                if (!stopped) setState((previous) => ({ ...previous, error: error instanceof Error ? error : new Error(String(error)), settled: true }));
            } finally {
                running = false;
            }
        };

        void refresh();
        const stopWatching = db.onChangeWithCallback({ onChange: () => void refresh() }, { tables: [...tables], throttleMs: 30 });
        return () => {
            stopped = true;
            stopWatching();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [db, enabled, ...dependencies]);

    return { data: state.data, isLoading: !enabled || !state.settled || !hasSynced, error: state.error };
}
