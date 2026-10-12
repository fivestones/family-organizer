import {
    COUNTDOWN_SETTINGS_NAME,
    HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
    parseCountdownSettings,
    parseSharedScheduleSettings,
} from '@family-organizer/shared-core';
import {
    DEFAULT_DASHBOARD_THEME,
    DEFAULT_ENABLED_CURRENCIES,
    isDashboardTheme,
    type FamilyPhotoUrls,
    type SettingKey,
    type SettingValues,
} from './types';

/**
 * How one setting is stored: the name it is stored under, and how its stored JSON becomes a value.
 * `decode` receives `undefined` when nothing is stored and must return the setting's default.
 */
export interface SettingDefinition<T> {
    name: string;
    decode(stored: unknown): T;
}

function decodeFamilyPhoto(stored: unknown): FamilyPhotoUrls | null {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return null;
    const urls = stored as Record<string, unknown>;
    return {
        '64': typeof urls['64'] === 'string' ? urls['64'] : undefined,
        '320': typeof urls['320'] === 'string' ? urls['320'] : undefined,
        '1200': typeof urls['1200'] === 'string' ? urls['1200'] : undefined,
    };
}

export const SETTING_DEFINITIONS: { [K in SettingKey]: SettingDefinition<SettingValues[K]> } = {
    householdSchedule: {
        name: HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
        decode: (stored) => parseSharedScheduleSettings(stored ?? null),
    },
    countdown: {
        name: COUNTDOWN_SETTINGS_NAME,
        decode: (stored) => parseCountdownSettings(stored ?? null),
    },
    enabledCurrencies: {
        name: 'enabledCurrencies',
        decode: (stored) =>
            Array.isArray(stored) ? stored.filter((code): code is string => typeof code === 'string') : [...DEFAULT_ENABLED_CURRENCIES],
    },
    familyPhoto: {
        name: 'familyPhotoUrls',
        decode: decodeFamilyPhoto,
    },
    dashboardTheme: {
        name: 'dashboard_theme',
        decode: (stored) => (isDashboardTheme(stored) ? stored : DEFAULT_DASHBOARD_THEME),
    },
};
