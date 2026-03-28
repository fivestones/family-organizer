'use client';

import React, { useEffect } from 'react';
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
 *
 * Also patches the <body> background while the dashboard is mounted so that
 * no white bleeds through anywhere (e.g. around rounded corners or overscroll).
 */
export function ThemedMain({ children }: { children: React.ReactNode }) {
    const { activeTheme } = useActiveDashboardTheme();
    const themeClass = activeTheme ? `fd-${activeTheme}` : '';

    // Sync the <body> background to the canvas color so no white shows
    // through rounded corners, overscroll bounce, etc.
    useEffect(() => {
        if (!activeTheme) return;

        const body = document.body;
        const prev = body.style.backgroundColor;

        // Read the resolved --fd-canvas value from a temporary element
        const probe = document.createElement('div');
        probe.className = `fd-${activeTheme}`;
        probe.style.display = 'none';
        body.appendChild(probe);
        const canvasColor = getComputedStyle(probe).getPropertyValue('--fd-canvas').trim();
        body.removeChild(probe);

        if (canvasColor) {
            body.style.backgroundColor = canvasColor;
        }

        return () => {
            body.style.backgroundColor = prev;
        };
    }, [activeTheme]);

    return (
        <main
            className={`flex-1 min-h-0 relative overflow-hidden ${themeClass}`}
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
