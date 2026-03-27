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
    /** The computed scale factor (1 = reference size, excludes contentScale). */
    scale: number;
    /** Convenience: returns `value * scale` rounded to nearest integer. */
    s: (px: number) => number;
    /** Returns a CSS value string e.g. `"14.4px"`. */
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
 * Computes the base scale factor from the widget's actual vs reference
 * dimensions (excludes contentScale — that is applied via CSS transform
 * so all distances scale uniformly).
 *
 * Clamped to [0.4, 3.0].
 */
function computeScale(
    width: number,
    height: number,
    refWidth: number,
    refHeight: number,
): number {
    const wRatio = width / refWidth;
    const hRatio = height / refHeight;
    // Use the smaller ratio so content doesn't overflow
    const auto = Math.min(wRatio, hRatio);
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
        () => computeScale(width, height, refWidth, refHeight),
        [width, height, refWidth, refHeight]
    );

    const value = useMemo<WidgetScaleContextValue>(
        () => ({
            scale,
            s: (px: number) => Math.round(px * scale),
            sv: (px: number) => `${px * scale}px`,
        }),
        [scale]
    );

    // contentScale is applied via CSS transform so that all distances
    // (element sizes AND gaps) scale uniformly instead of only scaling
    // individual measurements while the container stays fixed.
    const cs = contentScale !== undefined && contentScale > 0 ? contentScale : 1;
    const useTransform = cs !== 1;

    return (
        <WidgetScaleContext.Provider value={value}>
            <div
                className="h-full w-full"
                style={{
                    '--widget-scale': scale,
                    ...(useTransform
                        ? {
                              overflow: 'hidden',
                          }
                        : {}),
                } as React.CSSProperties}
            >
                {useTransform ? (
                    <div
                        style={{
                            transform: `scale(${cs})`,
                            transformOrigin: 'top left',
                            width: `${100 / cs}%`,
                            height: `${100 / cs}%`,
                        }}
                    >
                        {children}
                    </div>
                ) : (
                    children
                )}
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
