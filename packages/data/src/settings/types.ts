import type { CountdownSettings, SharedScheduleSettings } from '@family-organizer/shared-core';

/** The family's dashboard colour scheme. */
export type DashboardTheme = 'light' | 'dark';

export const DEFAULT_DASHBOARD_THEME: DashboardTheme = 'light';

export function isDashboardTheme(value: unknown): value is DashboardTheme {
    return value === 'light' || value === 'dark';
}

/** The family photo at each size it was resized to, by pixel width. */
export interface FamilyPhotoUrls {
    '64'?: string;
    '320'?: string;
    '1200'?: string;
}

export const DEFAULT_ENABLED_CURRENCIES: readonly string[] = ['USD'];

/** Every household-wide setting and the type of its value. */
export interface SettingValues {
    householdSchedule: SharedScheduleSettings;
    countdown: CountdownSettings;
    enabledCurrencies: string[];
    /** `null` when the family has no photo. */
    familyPhoto: FamilyPhotoUrls | null;
    dashboardTheme: DashboardTheme;
}

export type SettingKey = keyof SettingValues;
