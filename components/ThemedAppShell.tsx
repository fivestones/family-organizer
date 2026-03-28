'use client';

import React from 'react';
import { useActiveDashboardTheme } from '@/lib/freeform-dashboard/DashboardThemeContext';

/**
 * Wraps the header + main content and applies dashboard theme CSS variables
 * to the header when the freeform dashboard is active.
 *
 * The dark dashboard theme tints the navbar to match, while non-dashboard
 * pages keep the default light appearance.
 */
export function ThemedHeader({ children }: { children: React.ReactNode }) {
    const { activeTheme } = useActiveDashboardTheme();
    const themeClass = activeTheme ? `fd-${activeTheme}` : '';

    return (
        <header
            className={`sticky top-0 z-40 flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-6 transition-colors duration-200 ${activeTheme ? themeClass : 'bg-card'}`}
            style={
                activeTheme
                    ? {
                          backgroundColor: 'var(--fd-panel)',
                          borderColor: 'var(--fd-line)',
                          color: 'var(--fd-ink)',
                      }
                    : undefined
            }
            data-dashboard-theme={activeTheme ?? undefined}
        >
            {children}
        </header>
    );
}

/**
 * Wraps <main> and applies the canvas background color when the dashboard
 * theme is active, so no white gap appears below the widgets.
 */
export function ThemedMain({ children }: { children: React.ReactNode }) {
    const { activeTheme } = useActiveDashboardTheme();
    const themeClass = activeTheme ? `fd-${activeTheme}` : '';

    return (
        <main
            className={`flex-1 min-h-0 relative ${themeClass}`}
            style={
                activeTheme
                    ? { backgroundColor: 'var(--fd-canvas)' }
                    : undefined
            }
        >
            {children}
        </main>
    );
}
