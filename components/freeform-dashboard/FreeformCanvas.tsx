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
            className="relative isolate h-full w-full"
            style={{ minHeight: editMode ? minHeight : undefined }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        >
            {/* Edit mode dot grid background */}
            {editMode && (
                <div
                    className="pointer-events-none absolute inset-0 opacity-30"
                    style={{
                        backgroundImage: 'radial-gradient(circle, var(--fd-ink-faint) 1px, transparent 1px)',
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
                        className="pointer-events-none absolute top-0 bottom-0 w-px opacity-70"
                        style={{ left: guide.value, backgroundColor: 'var(--fd-accent)' }}
                    />
                ) : (
                    <div
                        key={`guide-${i}`}
                        className="pointer-events-none absolute left-0 right-0 h-px opacity-70"
                        style={{ top: guide.value, backgroundColor: 'var(--fd-accent)' }}
                    />
                )
            )}
        </div>
    );
}
