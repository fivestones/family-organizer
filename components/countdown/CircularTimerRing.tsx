'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import type { CountdownSlotState } from '@family-organizer/shared-core';

interface CircularTimerRingProps {
    /** 0 → 1 progress (fraction elapsed). Clamps to [0, 1]. */
    progress: number;
    /** Ring size in px. */
    size?: number;
    /** Stroke width in px. */
    strokeWidth?: number;
    state: CountdownSlotState;
    className?: string;
    children?: React.ReactNode;
}

const STATE_TRACK_COLORS: Record<CountdownSlotState, string> = {
    upcoming: 'stroke-slate-200',
    active: 'stroke-amber-200',
    overdue_active: 'stroke-red-200',
    buffer: 'stroke-slate-100',
    completed: 'stroke-emerald-200',
    waiting_decision: 'stroke-violet-200',
};

const STATE_FILL_COLORS: Record<CountdownSlotState, string> = {
    upcoming: 'stroke-slate-400',
    active: 'stroke-amber-500',
    overdue_active: 'stroke-red-500',
    buffer: 'stroke-slate-300',
    completed: 'stroke-emerald-500',
    waiting_decision: 'stroke-violet-500',
};

export default function CircularTimerRing({
    progress,
    size = 120,
    strokeWidth = 8,
    state,
    className,
    children,
}: CircularTimerRingProps) {
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const dashOffset = circumference * (1 - clampedProgress);

    return (
        <div className={cn('relative inline-flex items-center justify-center', className)} style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                {/* Track */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    strokeWidth={strokeWidth}
                    className={STATE_TRACK_COLORS[state]}
                />
                {/* Progress */}
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                    className={cn(
                        STATE_FILL_COLORS[state],
                        'transition-[stroke-dashoffset] duration-1000 ease-linear',
                    )}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                {children}
            </div>
        </div>
    );
}
