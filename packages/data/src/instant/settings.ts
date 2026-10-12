import { useMemo } from 'react';
import type { QueryResult, ReadOptions } from '../query-result';
import type { SettingsBackend, StoredSetting } from '../settings/backend';
import { toError, type InstantClient } from './client';

interface SettingRow {
    id: string;
    name?: string;
    value?: string;
}

/**
 * Instant stores a setting's value as a string: JSON for most, and for the dashboard theme the bare word.
 * Reading accepts both. Writing keeps a string value bare, so builds that still read Instant directly see what they expect.
 */
function parseStoredValue(raw: string | undefined): unknown {
    if (raw == null || raw === '') return undefined;
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

function serializeValue(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

const EMPTY_ROWS: readonly SettingRow[] = [];
const ALL_SETTINGS_QUERY = { settings: {} };

export function createInstantSettingsBackend({ db, tx, id }: InstantClient): SettingsBackend {
    // Instant addresses a row by id and the app addresses a setting by name, so the id behind each name has to be
    // known before it can be written. What live reads report is kept here: a string is the row's id, `null` means
    // a read has shown there is no row, and a missing entry means nothing has been read yet.
    const rowIdByName = new Map<string, string | null>();
    // Names with a write on its way. A live result that lags behind our own write must not undo what we know.
    const writesInFlight = new Map<string, number>();
    // Writes to one name run one after another, so two saves of an unset setting cannot each create a row.
    const lastWriteByName = new Map<string, Promise<unknown>>();

    /** Records what a settled live read shows for the names it covered. The newest read always wins. */
    function reconcile(names: readonly string[], rows: readonly SettingRow[]): void {
        for (const name of names) {
            if (writesInFlight.get(name)) continue;
            rowIdByName.set(name, rows.find((row) => row.name === name)?.id ?? null);
        }
    }

    async function resolveRowId(name: string): Promise<string | null> {
        const known = rowIdByName.get(name);
        if (known !== undefined) return known;
        try {
            const { data } = await db.queryOnce({ settings: { $: { where: { name } } } });
            const rows: SettingRow[] = data?.settings ?? [];
            return rows[0]?.id ?? null;
        } catch {
            // Instant refuses a one-off query while offline. With no read to go on, treat the setting as unset,
            // which is what the settings panels did when they had not loaded a row.
            return null;
        }
    }

    function inSequence<T>(name: string, write: () => Promise<T>): Promise<T> {
        const previous = lastWriteByName.get(name) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(async () => {
            writesInFlight.set(name, (writesInFlight.get(name) ?? 0) + 1);
            try {
                return await write();
            } finally {
                const remaining = (writesInFlight.get(name) ?? 1) - 1;
                if (remaining > 0) writesInFlight.set(name, remaining);
                else writesInFlight.delete(name);
            }
        });
        lastWriteByName.set(name, next);
        return next;
    }

    return {
        useStoredSettings(names: readonly string[], options?: ReadOptions): QueryResult<ReadonlyMap<string, unknown>> {
            const key = names.join('\n');
            const query = useMemo(
                () => ({
                    settings: { $: { where: names.length === 1 ? { name: names[0] } : { or: names.map((name) => ({ name })) } } },
                }),
                // eslint-disable-next-line react-hooks/exhaustive-deps
                [key]
            );
            const { data, isLoading, error } = db.useQuery(options?.enabled === false ? null : query);
            const settled = Boolean(data) && !isLoading && !error;
            const rows: readonly SettingRow[] = data?.settings ?? EMPTY_ROWS;
            const stored = useMemo(() => {
                if (settled) reconcile(names, rows);
                const values = new Map<string, unknown>();
                // The first row of a name wins, as it does for every reader today.
                for (const row of rows) {
                    if (!row.name || values.has(row.name)) continue;
                    const value = parseStoredValue(row.value);
                    if (value !== undefined) values.set(row.name, value);
                }
                return values;
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [rows, settled, key]);
            return { data: stored, isLoading, error: toError(error) };
        },

        useAllStoredSettings(options?: ReadOptions): QueryResult<readonly StoredSetting[]> {
            const { data, isLoading, error } = db.useQuery(options?.enabled === false ? null : ALL_SETTINGS_QUERY);
            const settled = Boolean(data) && !isLoading && !error;
            const rows: readonly SettingRow[] = data?.settings ?? EMPTY_ROWS;
            const stored = useMemo(() => {
                // This read covers every setting, so it can speak for each name it shows, and for each name
                // already tracked that it no longer shows.
                if (settled) {
                    const names = new Set(Array.from(rowIdByName.keys()));
                    for (const row of rows) if (row.name) names.add(row.name);
                    reconcile(Array.from(names), rows);
                }
                return rows.map((row) => ({ name: row.name ?? '', value: parseStoredValue(row.value) }));
                // eslint-disable-next-line react-hooks/exhaustive-deps
            }, [rows, settled]);
            return { data: stored, isLoading, error: toError(error) };
        },

        saveStoredSetting(name: string, value: unknown): Promise<void> {
            return inSequence(name, async () => {
                const rowId = (await resolveRowId(name)) ?? id();
                // Known before the write lands, so a save queued behind this one reuses the row.
                rowIdByName.set(name, rowId);
                await db.transact([tx.settings[rowId].update({ name, value: serializeValue(value) })]);
            });
        },

        deleteStoredSetting(name: string): Promise<void> {
            return inSequence(name, async () => {
                const rowId = await resolveRowId(name);
                if (!rowId) return;
                rowIdByName.set(name, null);
                await db.transact([tx.settings[rowId].delete()]);
            });
        },
    };
}
