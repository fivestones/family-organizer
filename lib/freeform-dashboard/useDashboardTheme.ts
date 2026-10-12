import { useCallback } from 'react';
import { saveSetting, useSetting } from '@/lib/data';
import type { DashboardTheme } from './dashboard-theme';

export function useDashboardTheme() {
    const { data: theme, isLoading } = useSetting('dashboardTheme');

    /** Resolves once the theme is saved on this device; rejects if it could not be. */
    const setTheme = useCallback((newTheme: DashboardTheme) => saveSetting('dashboardTheme', newTheme), []);

    return { theme, setTheme, isLoading };
}
