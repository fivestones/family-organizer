'use client';

import React, { useMemo } from 'react';
import type { DashboardWidgetRecord, SnapGuide } from '@/lib/freeform-dashboard/types';

interface FreeformCanvasProps {
    widgets: DashboardWidgetRecord[];
    editMode: boolean;
    guides: SnapGuide[];
    children: React.ReactNode;
    onPointerMove?: (e: React.PointerEvent) => void;
    onPointerUp?: (e: React.PointerEvent) => void;
}

export default function FreeformCanvas({
    widgets,
    editMode,
    guides,
    children,
    onPointerMove,
    onPointerUp,
}: FreeformCanvasProps) {
    const minHeight = useMemo(() => {
        if (widgets.length === 0) return 600;
        return Math.max(600, ...widgets.map((w) => w.y + w.h)) + 24;
    }, [widgets]);

    return (
        <div
            className="relative isolate w-full"
            style={{ minHeight }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        >
            {/* Edit mode dot grid background */}
            {editMode && (
                <div
                    className="pointer-events-none absolute inset-0 opacity-30"
                    style={{
                        backgroundImage: 'radial-gradient(circle, rgb(148 163 184) 1px, transparent 1px)',
                        backgroundSize: '24px 24px',
                    }}
                />
            )}

            {children}

            {/* Snap guide lines */}
            {guides.map((guide, i) =>
                guide.direction === 'vertical' ? (
                    <div
                        key={`guide-${i}`}
                        className="pointer-events-none absolute top-0 bottom-0 w-px bg-blue-400 opacity-70"
                        style={{ left: guide.value }}
                    />
                ) : (
                    <div
                        key={`guide-${i}`}
                        className="pointer-events-none absolute left-0 right-0 h-px bg-blue-400 opacity-70"
                        style={{ top: guide.value }}
                    />
                )
            )}
        </div>
    );
}
