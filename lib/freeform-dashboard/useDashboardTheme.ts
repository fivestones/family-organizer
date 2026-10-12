import { useCallback } from 'react';
import { saveSetting, useSetting } from '@/lib/data';
import type { DashboardTheme } from './dashboard-theme';

export function useDashboardTheme() {
    const { data: theme, isLoading } = useSetting('dashboardTheme');

    const setTheme = useCallback((newTheme: DashboardTheme) => {
        void saveSetting('dashboardTheme', newTheme);
    }, []);

    return { theme, setTheme, isLoading };
}
