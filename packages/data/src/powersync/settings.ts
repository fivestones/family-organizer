import { toServerForm } from '../policy';
import type { QueryResult, ReadOptions } from '../query-result';
import type { SettingsBackend, StoredSetting } from '../settings/backend';
import type { Device } from './device';
import { useLiveRead } from './live';
import { ensureDelete, ensureInsert, ensureUpdate, mutate } from './mutate';
import { all, first, fromJson, run, sqlFor } from './sql';

// A setting is one row: its name is the row's id, and its value a JSON document.

type SettingRow = { id: string; value: string | null };

const EMPTY_VALUES: ReadonlyMap<string, unknown> = new Map();
const EMPTY_SETTINGS: readonly StoredSetting[] = [];

export function createPowerSyncSettingsBackend(device: Device): SettingsBackend {
    return {
        useStoredSettings(names: readonly string[], options?: ReadOptions): QueryResult<ReadonlyMap<string, unknown>> {
            return useLiveRead(
                device.db,
                ['settings'],
                (reader) => (names.length ? all<SettingRow>(reader, sqlFor.selectFrom('settings').select(['id', 'value']).where('id', 'in', [...names])) : Promise.resolve([])),
                (rows) => {
                    const values = new Map<string, unknown>();
                    for (const row of rows) {
                        const value = fromJson(row.value);
                        if (value !== null) values.set(row.id, value);
                    }
                    return values as ReadonlyMap<string, unknown>;
                },
                EMPTY_VALUES,
                [names.join('\n')],
                options
            );
        },

        useAllStoredSettings(options?: ReadOptions): QueryResult<readonly StoredSetting[]> {
            return useLiveRead(
                device.db,
                ['settings'],
                (reader) => all<SettingRow>(reader, sqlFor.selectFrom('settings').select(['id', 'value']).orderBy('id')),
                (rows): readonly StoredSetting[] => rows.map((row) => ({ name: row.id, value: fromJson(row.value) ?? undefined })),
                EMPTY_SETTINGS,
                [],
                options
            );
        },

        saveStoredSetting(name: string, value: unknown): Promise<void> {
            return mutate(device, 'saveSetting', async (writer) => {
                const text = JSON.stringify(value);
                const current = await first<SettingRow>(writer, sqlFor.selectFrom('settings').select(['id', 'value']).where('id', '=', name));
                if (!current) {
                    ensureInsert(device, 'settings', { name, value });
                    await run(writer, sqlFor.insertInto('settings').values({ id: name, value: text }));
                } else if (ensureUpdate(device, 'settings', toServerForm('settings', current), { value }).length) {
                    await run(writer, sqlFor.updateTable('settings').set({ value: text }).where('id', '=', name));
                }
            });
        },

        deleteStoredSetting(name: string): Promise<void> {
            return mutate(device, 'clearSetting', async (writer) => {
                const current = await first<SettingRow>(writer, sqlFor.selectFrom('settings').select(['id', 'value']).where('id', '=', name));
                if (!current) return;
                ensureDelete(device, 'settings', toServerForm('settings', current));
                await run(writer, sqlFor.deleteFrom('settings').where('id', '=', name));
            });
        },
    };
}
