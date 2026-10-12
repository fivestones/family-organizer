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

export function createInstantSettingsBackend({ db, tx, id }: InstantClient): SettingsBackend {
    // Instant addresses a row by id, and a setting by name. The id of each named row is remembered as it is read,
    // so a save does not need a round trip — which also keeps saving possible offline, as it is today.
    const rowIdByName = new Map<string, string>();
    const remember = (rows: readonly SettingRow[]) => {
        for (const row of rows) {
            if (row.name && !rowIdByName.has(row.name)) rowIdByName.set(row.name, row.id);
        }
    };

    async function findRowId(name: string): Promise<string | undefined> {
        const known = rowIdByName.get(name);
        if (known) return known;
        const { data } = await db.queryOnce({ settings: { $: { where: { name } } } });
        const rows: SettingRow[] = data?.settings ?? [];
        remember(rows);
        return rows[0]?.id;
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
            const rows: readonly SettingRow[] = data?.settings ?? EMPTY_ROWS;
            const stored = useMemo(() => {
                remember(rows);
                const values = new Map<string, unknown>();
                // The first row of a name wins, as it does for every reader today.
                for (const row of rows) {
                    if (!row.name || values.has(row.name)) continue;
                    const value = parseStoredValue(row.value);
                    if (value !== undefined) values.set(row.name, value);
                }
                return values;
            }, [rows]);
            return { data: stored, isLoading, error: toError(error) };
        },

        useAllStoredSettings(options?: ReadOptions): QueryResult<readonly StoredSetting[]> {
            const { data, isLoading, error } = db.useQuery(options?.enabled === false ? null : ALL_SETTINGS_QUERY);
            const rows: readonly SettingRow[] = data?.settings ?? EMPTY_ROWS;
            const stored = useMemo(() => {
                remember(rows);
                return rows.map((row) => ({ name: row.name ?? '', value: parseStoredValue(row.value) }));
            }, [rows]);
            return { data: stored, isLoading, error: toError(error) };
        },

        async saveStoredSetting(name: string, value: unknown): Promise<void> {
            const existingId = await findRowId(name);
            const rowId = existingId ?? id();
            await db.transact([tx.settings[rowId].update({ name, value: serializeValue(value) })]);
            rowIdByName.set(name, rowId);
        },

        async deleteStoredSetting(name: string): Promise<void> {
            const existingId = await findRowId(name);
            if (!existingId) return;
            await db.transact([tx.settings[existingId].delete()]);
            rowIdByName.delete(name);
        },
    };
}

const ALL_SETTINGS_QUERY = { settings: {} };
