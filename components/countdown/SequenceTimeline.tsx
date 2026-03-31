'use client';

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import type {
    CountdownEngineOutput,
    CountdownSlot,
    CountdownSlotState,
    PersonCountdownTimeline,
} from '@family-organizer/shared-core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PersonInfo {
    personId: string;
    name: string;
    timeline: PersonCountdownTimeline;
}

interface SequenceTimelineProps {
    output: CountdownEngineOutput;
    people: PersonInfo[];
    nowMs: number;
    onMarkDone?: (choreId: string, personId: string) => void;
    className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getLiveState(slot: CountdownSlot, nowMs: number): CountdownSlotState {
    if (slot.state === 'completed') return 'completed';
    if (slot.state === 'waiting_decision') return 'waiting_decision';
    if (nowMs >= slot.countdownEndMs) return 'overdue_active';
    if (nowMs >= slot.countdownStartMs) return 'active';
    return 'upcoming';
}

function formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(secs: number): string {
    if (secs >= 3600) {
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        return m > 0 ? `${h}h ${m}m` : `${h}h`;
    }
    if (secs >= 60) {
        const m = Math.floor(secs / 60);
        const s = secs % 60;
        return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
    return `${secs}s`;
}

// State-based styling
const NODE_BG: Record<CountdownSlotState, string> = {
    upcoming: 'bg-slate-100 border-slate-300',
    active: 'bg-amber-100 border-amber-400',
    overdue_active: 'bg-red-100 border-red-400',
    buffer: 'bg-slate-50 border-slate-200',
    completed: 'bg-emerald-100 border-emerald-300',
    waiting_decision: 'bg-violet-100 border-violet-300',
};

const NODE_DOT: Record<CountdownSlotState, string> = {
    upcoming: 'bg-slate-400',
    active: 'bg-amber-500',
    overdue_active: 'bg-red-500',
    buffer: 'bg-slate-300',
    completed: 'bg-emerald-500',
    waiting_decision: 'bg-violet-500',
};

const RAIL_COLOR: Record<CountdownSlotState, string> = {
    upcoming: 'bg-slate-200',
    active: 'bg-amber-300',
    overdue_active: 'bg-red-300',
    buffer: 'bg-slate-150',
    completed: 'bg-emerald-300',
    waiting_decision: 'bg-violet-200',
};

const STATE_ICON: Record<CountdownSlotState, string> = {
    upcoming: '○',
    active: '●',
    overdue_active: '⚠',
    buffer: '·',
    completed: '✓',
    waiting_decision: '⏸',
};

// ---------------------------------------------------------------------------
// Time axis helpers
// ---------------------------------------------------------------------------

interface TimeWindow {
    startMs: number;
    endMs: number;
    durationMs: number;
}

function computeTimeWindow(people: PersonInfo[], nowMs: number): TimeWindow | null {
    let earliest = Infinity;
    let latest = -Infinity;
    for (const p of people) {
        for (const slot of p.timeline.slots) {
            if (slot.state === 'buffer') continue;
            earliest = Math.min(earliest, slot.countdownStartMs);
            latest = Math.max(latest, slot.countdownEndMs);
        }
    }
    if (!Number.isFinite(earliest)) return null;

    // Add 10% padding on each side, and include "now" in the window.
    const padding = Math.max((latest - earliest) * 0.05, 5 * 60 * 1000);
    const startMs = Math.min(earliest - padding, nowMs - padding);
    const endMs = Math.max(latest + padding, nowMs + padding);
    return { startMs, endMs, durationMs: endMs - startMs };
}

function msToPercent(ms: number, window: TimeWindow): number {
    return ((ms - window.startMs) / window.durationMs) * 100;
}

// ---------------------------------------------------------------------------
// Time markers for the axis
// ---------------------------------------------------------------------------

function getTimeMarkers(window: TimeWindow): Array<{ ms: number; label: string }> {
    const markers: Array<{ ms: number; label: string }> = [];
    // Round to nearest 15-minute increment.
    const interval = 15 * 60 * 1000;
    const first = Math.ceil(window.startMs / interval) * interval;
    for (let t = first; t <= window.endMs; t += interval) {
        markers.push({ ms: t, label: formatTime(t) });
    }
    return markers;
}

// ---------------------------------------------------------------------------
// Joint chore grouping
// ---------------------------------------------------------------------------

interface JointLink {
    choreId: string;
    choreTitle: string;
    personIds: string[];
    topPercent: number;
    bottomPercent: number;
}

function findJointLinks(people: PersonInfo[], window: TimeWindow): JointLink[] {
    // Group slots by choreId where isJoint is true.
    const jointMap = new Map<string, Array<{ personId: string; slot: CountdownSlot }>>();
    for (const p of people) {
        for (const slot of p.timeline.slots) {
            if (!slot.isJoint) continue;
            const list = jointMap.get(slot.choreId) || [];
            list.push({ personId: p.personId, slot });
            jointMap.set(slot.choreId, list);
        }
    }

    const links: JointLink[] = [];
    for (const [choreId, entries] of jointMap.entries()) {
        if (entries.length < 2) continue;
        // Use the midpoint of the slot for vertical positioning.
        const midpoints = entries.map((e) => {
            const mid = (e.slot.countdownStartMs + e.slot.countdownEndMs) / 2;
            return msToPercent(mid, window);
        });
        links.push({
            choreId,
            choreTitle: entries[0].slot.choreTitle,
            personIds: entries.map((e) => e.personId),
            topPercent: Math.min(...midpoints),
            bottomPercent: Math.max(...midpoints),
        });
    }
    return links;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function TimelineNode({
    slot,
    window,
    nowMs,
    onMarkDone,
}: {
    slot: CountdownSlot;
    window: TimeWindow;
    nowMs: number;
    onMarkDone?: (choreId: string, personId: string) => void;
}) {
    const state = getLiveState(slot, nowMs);
    const topPercent = msToPercent(slot.countdownStartMs, window);
    const heightPercent = msToPercent(slot.countdownEndMs, window) - topPercent;

    return (
        <div
            className="absolute left-0 right-0 group"
            style={{ top: `${topPercent}%`, height: `${Math.max(heightPercent, 2)}%` }}
        >
            <div
                className={cn(
                    'relative mx-1 h-full rounded-lg border px-2 py-1 overflow-hidden transition-all',
                    NODE_BG[state],
                    state === 'active' && 'ring-2 ring-amber-400/30',
                    state === 'overdue_active' && 'ring-2 ring-red-400/30',
                )}
            >
                {/* Git-log dot on the left rail */}
                <div className={cn(
                    'absolute -left-[5px] top-1/2 -translate-y-1/2 h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm z-10',
                    NODE_DOT[state],
                )} />

                <div className="flex flex-col justify-center h-full min-h-0">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] opacity-60">{STATE_ICON[state]}</span>
                        <span className="text-xs font-medium truncate leading-tight">{slot.choreTitle}</span>
                    </div>
                    <div className="text-[9px] text-slate-500 leading-tight mt-0.5">
                        {formatTime(slot.countdownStartMs)} → {formatTime(slot.countdownEndMs)}
                        <span className="ml-1 opacity-70">({formatDuration(slot.durationSecs)})</span>
                    </div>
                </div>

                {/* Clickable done action on hover */}
                {state !== 'completed' && onMarkDone && (
                    <button
                        type="button"
                        onClick={() => onMarkDone(slot.choreId, slot.personId)}
                        className="absolute inset-y-0 right-0 w-8 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-l from-white/80 to-transparent"
                        title="Mark done"
                    >
                        <span className="text-emerald-600 text-xs font-bold">✓</span>
                    </button>
                )}
            </div>
        </div>
    );
}

function SwimLane({
    person,
    window,
    nowMs,
    onMarkDone,
    laneIndex,
}: {
    person: PersonInfo;
    window: TimeWindow;
    nowMs: number;
    onMarkDone?: (choreId: string, personId: string) => void;
    laneIndex: number;
}) {
    const slots = person.timeline.slots.filter((s) => s.state !== 'buffer');
    const aheadBy = person.timeline.aheadBySeconds;

    return (
        <div className="flex flex-col min-w-[140px] flex-1 max-w-[260px]">
            {/* Lane header */}
            <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-2 py-2 text-center">
                <div className="text-xs font-semibold text-slate-700 truncate">{person.name}</div>
                <div className="text-[10px] text-slate-400">
                    {slots.filter((s) => s.state === 'completed').length}/{slots.length} done
                    {aheadBy > 0 && (
                        <span className="ml-1 text-emerald-600">+{Math.floor(aheadBy / 60)}m ahead</span>
                    )}
                </div>
            </div>

            {/* Lane body — relative positioning context */}
            <div className="relative flex-1">
                {/* Vertical rail line (git-log style) */}
                <div className="absolute left-[3px] top-0 bottom-0 w-px bg-slate-200" />

                {/* Nodes */}
                {slots.map((slot) => (
                    <TimelineNode
                        key={`${slot.choreId}-${slot.personId}`}
                        slot={slot}
                        window={window}
                        nowMs={nowMs}
                        onMarkDone={onMarkDone}
                    />
                ))}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function SequenceTimeline({
    output,
    people,
    nowMs,
    onMarkDone,
    className,
}: SequenceTimelineProps) {
    const window = useMemo(() => computeTimeWindow(people, nowMs), [people, nowMs]);
    const timeMarkers = useMemo(() => (window ? getTimeMarkers(window) : []), [window]);
    const jointLinks = useMemo(() => (window ? findJointLinks(people, window) : []), [people, window]);

    // Map personId → lane index for joint link rendering.
    const laneIndexMap = useMemo(() => {
        const map = new Map<string, number>();
        people.forEach((p, i) => map.set(p.personId, i));
        return map;
    }, [people]);

    if (!window || people.length === 0) {
        return (
            <div className="flex h-40 items-center justify-center text-sm text-slate-400">
                No timeline data to display
            </div>
        );
    }

    // Calculate a reasonable height. Each minute ≈ 3px, minimum 400px.
    const minuteSpan = window.durationMs / 60000;
    const timelineHeight = Math.max(400, Math.min(2000, minuteSpan * 3));

    return (
        <div className={cn('rounded-2xl border border-slate-200 bg-white overflow-hidden', className)}>
            <div className="overflow-x-auto">
                <div className="flex min-w-fit" style={{ height: timelineHeight }}>
                    {/* Time axis */}
                    <div className="relative w-16 flex-shrink-0 border-r border-slate-200 bg-slate-50/50">
                        <div className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 px-2 py-2 text-center">
                            <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Time</div>
                        </div>
                        <div className="relative flex-1 h-full">
                            {timeMarkers.map(({ ms, label }) => {
                                const top = msToPercent(ms, window);
                                return (
                                    <div
                                        key={ms}
                                        className="absolute right-0 pr-2 -translate-y-1/2 text-[9px] text-slate-400 whitespace-nowrap"
                                        style={{ top: `${top}%` }}
                                    >
                                        {label}
                                    </div>
                                );
                            })}
                            {/* Now indicator */}
                            <div
                                className="absolute left-0 right-0 flex items-center z-10"
                                style={{ top: `${msToPercent(nowMs, window)}%` }}
                            >
                                <div className="flex-1 h-px bg-red-400" />
                                <div className="w-1.5 h-1.5 rounded-full bg-red-500 -mr-[3px]" />
                            </div>
                        </div>
                    </div>

                    {/* Swim lanes */}
                    {people.map((person, i) => (
                        <React.Fragment key={person.personId}>
                            {i > 0 && <div className="w-px bg-slate-100 flex-shrink-0" />}
                            <SwimLane
                                person={person}
                                window={window}
                                nowMs={nowMs}
                                onMarkDone={onMarkDone}
                                laneIndex={i}
                            />
                        </React.Fragment>
                    ))}

                    {/* Joint chore connectors overlay */}
                    {jointLinks.length > 0 && (
                        <svg
                            className="absolute left-16 top-0 pointer-events-none"
                            style={{
                                width: `calc(100% - 4rem)`,
                                height: timelineHeight,
                            }}
                        >
                            {jointLinks.map((link) => {
                                const sortedLanes = link.personIds
                                    .map((pid) => laneIndexMap.get(pid) ?? -1)
                                    .filter((i) => i >= 0)
                                    .sort((a, b) => a - b);
                                if (sortedLanes.length < 2) return null;

                                const laneWidth = 100 / people.length;
                                const y = (link.topPercent + link.bottomPercent) / 2;
                                const x1 = (sortedLanes[0] + 0.5) * laneWidth;
                                const x2 = (sortedLanes[sortedLanes.length - 1] + 0.5) * laneWidth;

                                return (
                                    <line
                                        key={link.choreId}
                                        x1={`${x1}%`}
                                        y1={`${y}%`}
                                        x2={`${x2}%`}
                                        y2={`${y}%`}
                                        stroke="rgb(167, 139, 250)"
                                        strokeWidth={2}
                                        strokeDasharray="4 3"
                                        opacity={0.5}
                                    />
                                );
                            })}
                        </svg>
                    )}

                    {/* Now line across all lanes */}
                    <div
                        className="absolute left-16 right-0 h-px bg-red-400/50 pointer-events-none z-10"
                        style={{ top: `${msToPercent(nowMs, window)}%` }}
                    />
                </div>
            </div>
        </div>
    );
}
