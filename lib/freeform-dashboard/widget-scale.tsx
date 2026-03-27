'use client';

import React, { createContext, useContext, useMemo } from 'react';

/**
 * Widget scale context — provides a fluid scale factor that widgets use
 * to size avatars, text, spacing, and SVG elements proportionally.
 *
 * The scale factor is derived from the widget's actual dimensions relative
 * to its "reference" (default) size, optionally overridden by a user-defined
 * `contentScale` config value.
 */

interface WidgetScaleContextValue {
    /** The computed scale factor (1 = reference size). */
    scale: number;
    /** Convenience: returns `value * scale` rounded to nearest integer. */
    s: (px: number) => number;
    /** Returns a CSS value string: `calc(${px}px * var(--widget-scale))`. */
    sv: (px: number) => string;
}

const WidgetScaleContext = createContext<WidgetScaleContextValue>({
    scale: 1,
    s: (px) => px,
    sv: (px) => `${px}px`,
});

interface WidgetScaleProviderProps {
    /** Actual rendered width in px. */
    width: number;
    /** Actual rendered height in px. */
    height: number;
    /** Reference/default width from widget meta. */
    refWidth: number;
    /** Reference/default height from widget meta. */
    refHeight: number;
    /** Optional user-defined content scale multiplier (0.5–3). */
    contentScale?: number;
    children: React.ReactNode;
}

/**
 * Computes the scale factor from the widget's actual vs reference dimensions.
 *
 * Algorithm: geometric mean of width-ratio and height-ratio, biased toward
 * the smaller axis to avoid overflow. Clamped to [0.4, 3.0].
 *
 * If a `contentScale` override is provided it multiplies the auto-computed
 * factor (still clamped).
 */
function computeScale(
    width: number,
    height: number,
    refWidth: number,
    refHeight: number,
    contentScale?: number
): number {
    const wRatio = width / refWidth;
    const hRatio = height / refHeight;
    // Use the smaller ratio so content doesn't overflow
    let auto = Math.min(wRatio, hRatio);
    if (contentScale !== undefined && contentScale > 0) {
        auto *= contentScale;
    }
    return Math.max(0.4, Math.min(3.0, auto));
}

export function WidgetScaleProvider({
    width,
    height,
    refWidth,
    refHeight,
    contentScale,
    children,
}: WidgetScaleProviderProps) {
    const scale = useMemo(
        () => computeScale(width, height, refWidth, refHeight, contentScale),
        [width, height, refWidth, refHeight, contentScale]
    );

    const value = useMemo<WidgetScaleContextValue>(
        () => ({
            scale,
            s: (px: number) => Math.round(px * scale),
            sv: (px: number) => `${px * scale}px`,
        }),
        [scale]
    );

    return (
        <WidgetScaleContext.Provider value={value}>
            <div
                className="h-full w-full"
                style={{ '--widget-scale': scale } as React.CSSProperties}
            >
                {children}
            </div>
        </WidgetScaleContext.Provider>
    );
}

/**
 * Returns the current widget scale factor and helpers.
 *
 * - `scale` — raw multiplier (1 = reference size)
 * - `s(px)` — scale a pixel value, returns rounded integer
 * - `sv(px)` — scale a pixel value, returns CSS string e.g. `"14.4px"`
 */
export function useWidgetScale(): WidgetScaleContextValue {
    return useContext(WidgetScaleContext);
}
