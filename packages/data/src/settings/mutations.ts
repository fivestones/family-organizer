import { getDataBackend } from '../backend';
import { SETTING_DEFINITIONS } from './definitions';
import type { SettingKey, SettingValues } from './types';

/** Saves a household setting, replacing whatever was stored. */
export function saveSetting<K extends SettingKey>(key: K, value: SettingValues[K]): Promise<void> {
    return getDataBackend().settings.saveStoredSetting(SETTING_DEFINITIONS[key].name, value);
}

/** Returns a household setting to its default by removing what was stored. */
export function clearSetting(key: SettingKey): Promise<void> {
    return getDataBackend().settings.deleteStoredSetting(SETTING_DEFINITIONS[key].name);
}
