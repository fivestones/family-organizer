'use client';

import React, { useEffect } from 'react';
import { useActiveDashboardTheme } from '@/lib/freeform-dashboard/DashboardThemeContext';
import { DASHBOARD_THEMES } from '@/lib/freeform-dashboard/dashboard-theme';

/** Resolve the canvas hex color for a given theme id */
function getCanvasColor(themeId: string): string {
    const def = DASHBOARD_THEMES.find((t) => t.id === themeId);
    // previewColors[0] is the canvas color
    return def?.previewColors[0] ?? '#f1f3f8';
}

/** Resolve the panel hex color for a given theme id */
function getPanelColor(themeId: string): string {
    const def = DASHBOARD_THEMES.find((t) => t.id === themeId);
    // previewColors[1] is the panel color
    return def?.previewColors[1] ?? '#ffffff';
}

/**
 * Wraps the header and applies dashboard theme CSS variables
 * when the freeform dashboard is active.
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
 * Also patches <html> and <body> backgrounds while the dashboard is mounted
 * so that no white bleeds through OS-level window rounded corners or
 * overscroll bounce areas.
 */
export function ThemedMain({ children }: { children: React.ReactNode }) {
    const { activeTheme } = useActiveDashboardTheme();
    const themeClass = activeTheme ? `fd-${activeTheme}` : '';

    // Sync <html> and <body> background + lock body to viewport so the
    // dashboard never scrolls and no white bleeds through window corners.
    useEffect(() => {
        if (!activeTheme) return;

        const html = document.documentElement;
        const body = document.body;

        // Snapshot previous values for clean teardown
        const prev = {
            htmlBg: html.style.backgroundColor,
            bodyBg: body.style.backgroundColor,
            bodyHeight: body.style.height,
            bodyOverflow: body.style.overflow,
        };

        // Use the panel color (header bg) for html so OS window rounded
        // corners show the header color, not white
        const panelColor = getPanelColor(activeTheme);
        html.style.backgroundColor = panelColor;

        const canvasColor = getCanvasColor(activeTheme);
        body.style.backgroundColor = canvasColor;

        // Lock body to exact viewport height — prevents the 1-2px scroll
        // caused by min-h-screen + borders/padding accumulating beyond 100vh
        body.style.height = '100dvh';
        body.style.overflow = 'hidden';

        return () => {
            html.style.backgroundColor = prev.htmlBg;
            body.style.backgroundColor = prev.bodyBg;
            body.style.height = prev.bodyHeight;
            body.style.overflow = prev.bodyOverflow;
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
