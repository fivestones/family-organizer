import { useMemo } from 'react';
import { getDataBackend } from '../backend';
import type { QueryResult, ReadOptions } from '../query-result';
import type { StoredSetting } from './backend';
import { SETTING_DEFINITIONS } from './definitions';
import type { SettingKey, SettingValues } from './types';

/** Live. One household setting, or its default when the family has never saved it. */
export function useSetting<K extends SettingKey>(key: K, options?: ReadOptions): QueryResult<SettingValues[K]> {
    const definition = SETTING_DEFINITIONS[key];
    const names = useMemo(() => [definition.name], [definition.name]);
    const stored = getDataBackend().settings.useStoredSettings(names, options);
    const data = useMemo(() => definition.decode(stored.data.get(definition.name)), [definition, stored.data]);
    return { data, isLoading: stored.isLoading, error: stored.error };
}

/** Live. Every stored setting exactly as stored, for the screen that lists them raw. */
export function useStoredSettings(options?: ReadOptions): QueryResult<readonly StoredSetting[]> {
    return getDataBackend().settings.useAllStoredSettings(options);
}
