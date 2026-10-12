import { useSyncExternalStore } from 'react';
import type { InstantClient } from '@family-organizer/data';

type Row = { id: string } & Record<string, unknown>;
type Chunk = { namespace: string; id: string; op: 'update' | 'delete'; values?: Record<string, unknown> };

/**
 * An in-memory stand-in for an InstantDB client, for testing the data layer's Instant implementation.
 * It understands what that implementation uses: whole-namespace queries, `where` by equality or `or`,
 * and `update` / `delete` transactions, with `update` creating the row when it does not exist.
 */
export function createFakeInstant(initial: Record<string, Row[]> = {}) {
    let state: Record<string, Row[]> = Object.fromEntries(Object.entries(initial).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
    let version = 0;
    let nextId = 1;
    const listeners = new Set<() => void>();
    const queries: unknown[] = [];
    const oneOffQueries: unknown[] = [];
    const transactions: Chunk[][] = [];
    const resultCache = new Map<string, { version: number; data: Record<string, Row[]> }>();

    const matches = (row: Row, where: any): boolean => {
        if (!where) return true;
        if (Array.isArray(where.or)) return where.or.some((clause: any) => matches(row, clause));
        return Object.entries(where).every(([field, expected]) => row[field] === expected);
    };

    const run = (query: any): Record<string, Row[]> => {
        const key = JSON.stringify(query);
        const cached = resultCache.get(key);
        if (cached && cached.version === version) return cached.data;
        const data: Record<string, Row[]> = {};
        for (const [namespace, shape] of Object.entries<any>(query)) {
            data[namespace] = (state[namespace] ?? []).filter((row) => matches(row, shape?.$?.where));
        }
        resultCache.set(key, { version, data });
        return data;
    };

    const tx = new Proxy(
        {},
        {
            get: (_target, namespace: string) =>
                new Proxy(
                    {},
                    {
                        get: (_inner, id: string) => ({
                            update: (values: Record<string, unknown>): Chunk => ({ namespace, id, op: 'update', values }),
                            delete: (): Chunk => ({ namespace, id, op: 'delete' }),
                        }),
                    }
                ),
        }
    );

    const client: InstantClient = {
        db: {
            useQuery(query: unknown) {
                queries.push(query);
                const snapshot = useSyncExternalStore(
                    (listener) => {
                        listeners.add(listener);
                        return () => listeners.delete(listener);
                    },
                    () => version
                );
                void snapshot;
                if (query === null) return { data: undefined, isLoading: true, error: undefined };
                return { data: run(query), isLoading: false, error: undefined };
            },
            async queryOnce(query: unknown) {
                oneOffQueries.push(query);
                return { data: run(query) };
            },
            async transact(chunks: unknown) {
                const list = (Array.isArray(chunks) ? chunks : [chunks]) as Chunk[];
                transactions.push(list);
                const next = { ...state };
                for (const chunk of list) {
                    const rows = [...(next[chunk.namespace] ?? [])];
                    const index = rows.findIndex((row) => row.id === chunk.id);
                    if (chunk.op === 'delete') {
                        if (index >= 0) rows.splice(index, 1);
                    } else if (index >= 0) {
                        rows[index] = { ...rows[index], ...chunk.values };
                    } else {
                        rows.push({ id: chunk.id, ...chunk.values });
                    }
                    next[chunk.namespace] = rows;
                }
                state = next;
                version += 1;
                listeners.forEach((listener) => listener());
                return {};
            },
        },
        tx,
        id: () => `generated-${nextId++}`,
    };

    return {
        client,
        /** Every live query the implementation subscribed to, once per render. */
        queries,
        /** Every one-off query the implementation sent — each is a round trip to the server. */
        oneOffQueries,
        /** Every transaction the implementation sent, in order. */
        transactions,
        rows: (namespace: string) => state[namespace] ?? [],
    };
}
