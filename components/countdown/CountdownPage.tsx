'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { tx, id } from '@instantdb/react';
import { db } from '@/lib/db';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
    HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
    COUNTDOWN_SETTINGS_NAME,
    getFamilyDayDateUTC,
    parseSharedScheduleSettings,
    parseCountdownSettings,
    computeCountdownTimelines,
    getChoreTimingMode,
    type SharedScheduleSettings,
    type CountdownEngineOutput,
    type CountdownChoreInput,
    type CountdownSlot,
    type CountdownSlotState,
    type CountdownCollision,
    type CollisionDecision,
    type PersonCountdownTimeline,
} from '@family-organizer/shared-core';
import { useAuth } from '@/components/AuthProvider';
import { getAssignedMembersForChoreOnDate as getAssignedMembersLocal } from '@/lib/chore-utils';
import CircularTimerRing from './CircularTimerRing';
import SequenceTimeline from './SequenceTimeline';
import CollisionDecisionDialog from './CollisionDecisionDialog';
import { ChevronLeft, ChevronRight, LayoutGrid, GitBranch, Pause, Play, Timer, Users, User, AlertTriangle } from 'lucide-react';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCountdownLarge(remainingMs: number): { main: string; sub: string } {
    const totalSecs = Math.abs(Math.round(remainingMs / 1000));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const sign = remainingMs < 0 ? '+' : '';
    if (h > 0) {
        return { main: `${sign}${h}:${String(m).padStart(2, '0')}`, sub: `${String(s).padStart(2, '0')}` };
    }
    return { main: `${sign}${m}:${String(s).padStart(2, '0')}`, sub: '' };
}

function getSlotProgress(slot: CountdownSlot, nowMs: number): number {
    if (slot.state === 'completed') return 1;
    const total = slot.countdownEndMs - slot.countdownStartMs;
    if (total <= 0) return 1;
    const elapsed = nowMs - slot.countdownStartMs;
    return Math.max(0, Math.min(1, elapsed / total));
}

function getLiveState(slot: CountdownSlot, nowMs: number): CountdownSlotState {
    if (slot.state === 'completed') return 'completed';
    if (slot.state === 'waiting_decision') return 'waiting_decision';
    if (nowMs >= slot.countdownEndMs) return 'overdue_active';
    if (nowMs >= slot.countdownStartMs) return 'active';
    return 'upcoming';
}

const STATE_BG: Record<CountdownSlotState, string> = {
    upcoming: 'bg-white border-slate-200',
    active: 'bg-amber-50 border-amber-300 shadow-md shadow-amber-100',
    overdue_active: 'bg-red-50 border-red-300 shadow-md shadow-red-100',
    buffer: 'bg-slate-50 border-slate-150',
    completed: 'bg-emerald-50 border-emerald-200',
    waiting_decision: 'bg-violet-50 border-violet-200',
};

const STATE_LABEL: Record<CountdownSlotState, string> = {
    upcoming: 'Upcoming',
    active: 'In Progress',
    overdue_active: 'Overdue',
    buffer: 'Buffer',
    completed: 'Done',
    waiting_decision: 'Needs Decision',
};

// ---------------------------------------------------------------------------
// Slot Card
// ---------------------------------------------------------------------------

interface SlotCardProps {
    slot: CountdownSlot;
    nowMs: number;
    memberName: string;
    showMemberName: boolean;
    onComplete?: (choreId: string, personId: string) => void;
    isCompact: boolean;
}

function SlotCard({ slot, nowMs, memberName, showMemberName, onComplete, isCompact }: SlotCardProps) {
    const liveState = getLiveState(slot, nowMs);
    const progress = getSlotProgress(slot, nowMs);
    const remainingMs = slot.countdownEndMs - nowMs;
    const { main, sub } = formatCountdownLarge(remainingMs);
    const ringSize = isCompact ? 80 : 120;
    const strokeWidth = isCompact ? 6 : 8;

    return (
        <div
            className={cn(
                'flex flex-col items-center gap-3 rounded-2xl border p-4 transition-all duration-500',
                STATE_BG[liveState],
                liveState === 'active' && 'ring-2 ring-amber-400/40',
                liveState === 'overdue_active' && 'ring-2 ring-red-400/40',
            )}
        >
            {showMemberName && (
                <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                    {memberName}
                </div>
            )}
            <CircularTimerRing
                progress={progress}
                size={ringSize}
                strokeWidth={strokeWidth}
                state={liveState}
            >
                <div className="flex flex-col items-center">
                    <span
                        className={cn(
                            'font-mono font-bold tabular-nums leading-none',
                            isCompact ? 'text-lg' : 'text-2xl',
                            liveState === 'overdue_active' && 'text-red-600',
                            liveState === 'active' && 'text-amber-700',
                            liveState === 'completed' && 'text-emerald-600',
                            liveState === 'upcoming' && 'text-slate-600',
                        )}
                    >
                        {liveState === 'completed' ? '✓' : main}
                    </span>
                    {sub && liveState !== 'completed' && (
                        <span className="text-xs text-slate-400 tabular-nums">{sub}</span>
                    )}
                </div>
            </CircularTimerRing>
            <div className="text-center">
                <div className={cn('font-medium leading-tight', isCompact ? 'text-sm' : 'text-base')}>
                    {slot.choreTitle}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-400">
                    {STATE_LABEL[liveState]}
                    {slot.isJoint && ' · Joint'}
                    {' · '}
                    {new Date(slot.countdownStartMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    {' → '}
                    {new Date(slot.countdownEndMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </div>
            </div>
            {liveState !== 'completed' && onComplete && (
                <Button
                    size="sm"
                    variant={liveState === 'active' ? 'default' : 'outline'}
                    className={cn(
                        'w-full',
                        liveState === 'active' && 'bg-amber-600 hover:bg-amber-700',
                        liveState === 'overdue_active' && 'bg-red-600 hover:bg-red-700 text-white',
                    )}
                    onClick={() => onComplete(slot.choreId, slot.personId)}
                >
                    Mark Done
                </Button>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CountdownPageContent() {
    const { currentUser } = useAuth();

    // --- Query ---
    const { data, isLoading, error } = db.useQuery({
        familyMembers: {
            $: { order: { order: 'asc' } },
            choreAssignments: {},
        },
        chores: {
            assignees: {},
            assignments: { familyMember: {} },
            completions: { completedBy: {} },
            taskSeries: { tasks: {} },
        },
        routineMarkerStatuses: {},
        settings: {
            $: {
                where: {
                    or: [
                        { name: HOUSEHOLD_SCHEDULE_SETTINGS_NAME },
                        { name: COUNTDOWN_SETTINGS_NAME },
                    ],
                },
            },
        },
    });

    // --- Derived data ---
    const familyMembers = useMemo(() => (data?.familyMembers as any[]) || [], [data?.familyMembers]);
    const chores = useMemo(() => (data?.chores as any[]) || [], [data?.chores]);
    const routineMarkerStatuses = useMemo(() => (data?.routineMarkerStatuses as any[]) || [], [data?.routineMarkerStatuses]);
    const scheduleSettings: SharedScheduleSettings = useMemo(() => {
        const row = (data?.settings as any[])?.find((s: any) => s.name === HOUSEHOLD_SCHEDULE_SETTINGS_NAME);
        return parseSharedScheduleSettings(row?.value || null);
    }, [data?.settings]);
    const countdownSettings = useMemo(() => {
        const row = (data?.settings as any[])?.find((s: any) => s.name === COUNTDOWN_SETTINGS_NAME);
        return parseCountdownSettings(row?.value || null);
    }, [data?.settings]);

    const today = useMemo(() => getFamilyDayDateUTC(new Date(), scheduleSettings), [scheduleSettings]);
    const todayKey = today.toISOString().slice(0, 10);

    // --- State ---
    const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
    const [viewMode, setViewMode] = useState<'grid' | 'sequence'>('grid');
    const [autoComplete, setAutoComplete] = useState(countdownSettings.autoMarkCompleteOnCountdownEnd);
    const [nowMs, setNowMs] = useState(Date.now());
    const [collisionDecisions, setCollisionDecisions] = useState<Record<string, CollisionDecision>>({});
    const [activeCollision, setActiveCollision] = useState<CountdownCollision | null>(null);

    // Sync auto-complete default from settings.
    useEffect(() => {
        setAutoComplete(countdownSettings.autoMarkCompleteOnCountdownEnd);
    }, [countdownSettings.autoMarkCompleteOnCountdownEnd]);

    // Tick every second.
    useEffect(() => {
        const interval = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    // --- Countdown engine ---
    const countdownOutput: CountdownEngineOutput | null = useMemo(() => {
        if (chores.length === 0) return null;
        try {
            const choreInputs: CountdownChoreInput[] = chores
                .filter((c: any) => {
                    const mode = getChoreTimingMode(c);
                    if (mode === 'anytime') return false;
                    // Only include chores actually assigned to someone today
                    // (handles occurrence check, pause state, rotation, exdates)
                    const assigned = getAssignedMembersLocal(c, today);
                    return assigned.length > 0;
                })
                .map((c: any) => {
                    const assigned = getAssignedMembersLocal(c, today);
                    const memberCompletions: Record<string, string> = {};
                    for (const comp of c.completions || []) {
                        if (comp.completed && comp.dateDue === todayKey && comp.completedBy?.id) {
                            memberCompletions[comp.completedBy.id] = comp.dateCompleted || new Date().toISOString();
                        }
                    }
                    return {
                        id: c.id,
                        title: c.title,
                        estimatedDurationSecs: c.estimatedDurationSecs ?? null,
                        weight: c.weight ?? null,
                        sortOrder: c.sortOrder ?? null,
                        isJoint: c.isJoint ?? false,
                        assigneeIds: assigned.map((a) => a.id),
                        timingMode: c.timingMode || 'anytime',
                        timingConfig: c.timingConfig || null,
                        timeBucket: c.timeBucket || null,
                        completedAt: null,
                        memberCompletions,
                    };
                });
            if (choreInputs.length === 0) return null;
            return computeCountdownTimelines({
                chores: choreInputs,
                routineMarkerStatuses,
                allChoresRaw: chores as any,
                countdownSettings,
                scheduleSettings,
                now: new Date(nowMs),
                date: today,
                collisionDecisions: Object.keys(collisionDecisions).length > 0 ? collisionDecisions : undefined,
            });
        } catch (err) {
            console.error('Countdown engine error:', err);
            return null;
        }
    // Recompute every 30s to pick up completions, not every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chores, todayKey, routineMarkerStatuses, countdownSettings, scheduleSettings, collisionDecisions, Math.floor(nowMs / 30000)]);

    // --- People with timelines ---
    const timelinePeople = useMemo(() => {
        if (!countdownOutput?.timelines) return [];
        return Object.entries(countdownOutput.timelines)
            .filter(([, t]) => (t as PersonCountdownTimeline).slots.length > 0)
            .map(([personId, timeline]) => {
                const member = familyMembers.find((m: any) => m.id === personId);
                return {
                    personId,
                    name: member?.name || 'Unknown',
                    timeline: timeline as PersonCountdownTimeline,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [countdownOutput, familyMembers]);

    // Default to first person or current user.
    useEffect(() => {
        if (selectedPersonId && timelinePeople.some((p) => p.personId === selectedPersonId)) return;
        const currentMatch = timelinePeople.find((p) => p.personId === currentUser?.id);
        if (currentMatch) {
            setSelectedPersonId(currentMatch.personId);
        } else if (timelinePeople.length > 0) {
            setSelectedPersonId(timelinePeople[0].personId);
        }
    }, [timelinePeople, currentUser?.id, selectedPersonId]);

    // --- Active person timeline ---
    const activeTimeline = selectedPersonId
        ? (countdownOutput?.timelines?.[selectedPersonId] as PersonCountdownTimeline | undefined)
        : null;

    const visibleSlots = useMemo(() => {
        if (!activeTimeline) return [];
        // Show all non-buffer slots, sorted by start time.
        return activeTimeline.slots
            .filter((s) => s.state !== 'buffer')
            .sort((a, b) => a.countdownStartMs - b.countdownStartMs);
    }, [activeTimeline]);

    // Split into active/upcoming/completed for layout prioritization.
    const { activeSlots, upcomingSlots, completedSlots, overdueSlots } = useMemo(() => {
        const active: CountdownSlot[] = [];
        const upcoming: CountdownSlot[] = [];
        const completed: CountdownSlot[] = [];
        const overdue: CountdownSlot[] = [];
        for (const slot of visibleSlots) {
            const state = getLiveState(slot, nowMs);
            if (state === 'completed') completed.push(slot);
            else if (state === 'overdue_active') overdue.push(slot);
            else if (state === 'active') active.push(slot);
            else upcoming.push(slot);
        }
        return { activeSlots: active, upcomingSlots: upcoming, completedSlots: completed, overdueSlots: overdue };
    }, [visibleSlots, nowMs]);

    // --- Collision decision handler ---
    const handleCollisionDecision = useCallback(
        (startChoreId: string, deadlineChoreId: string, decision: CollisionDecision) => {
            const key = `${startChoreId}:${deadlineChoreId}`;
            setCollisionDecisions(prev => ({ ...prev, [key]: decision }));
        },
        [],
    );

    // Collect all unresolved collisions across people
    const unresolvedCollisions = useMemo(() => {
        if (!countdownOutput?.timelines) return [];
        const all: Array<CountdownCollision & { memberName: string }> = [];
        for (const [personId, timeline] of Object.entries(countdownOutput.timelines)) {
            const t = timeline as PersonCountdownTimeline;
            for (const c of t.collisions) {
                const member = familyMembers.find((m: any) => m.id === personId);
                all.push({ ...c, memberName: member?.name || 'Unknown' });
            }
        }
        return all;
    }, [countdownOutput, familyMembers]);

    // --- Reorder handler ---
    const handleReorder = useCallback(async (updates: Record<string, number>) => {
        try {
            const transactions = Object.entries(updates).map(([choreId, sortOrder]) =>
                tx.chores[choreId].update({ sortOrder })
            );
            await db.transact(transactions);
        } catch (err) {
            console.error('Failed to reorder chores:', err);
        }
    }, []);

    // --- Mark done handler ---
    const handleMarkDone = useCallback(async (choreId: string, personId: string) => {
        const now = new Date().toISOString();
        const dateKey = todayKey;
        try {
            const completionId = id();
            await db.transact([
                tx.choreCompletions[completionId].update({
                    completed: true,
                    dateDue: dateKey,
                    dateCompleted: now,
                }).link({ chore: choreId, completedBy: personId }),
            ]);
        } catch (err) {
            console.error('Failed to mark chore done:', err);
        }
    }, [todayKey]);

    // --- Auto-complete effect ---
    useEffect(() => {
        if (!autoComplete || !activeTimeline) return;
        for (const slot of activeTimeline.slots) {
            if (slot.state === 'completed') continue;
            const liveState = getLiveState(slot, nowMs);
            if (liveState === 'overdue_active') {
                // Auto-complete when countdown reaches zero.
                handleMarkDone(slot.choreId, slot.personId);
            }
        }
    }, [autoComplete, activeTimeline, nowMs, handleMarkDone]);

    // --- Ahead-of-schedule ---
    const aheadBySeconds = activeTimeline?.aheadBySeconds ?? 0;

    // --- Rendering ---
    const memberName = (personId: string) =>
        familyMembers.find((m: any) => m.id === personId)?.name || 'Unknown';

    const isCompact = visibleSlots.length > 4;

    if (isLoading) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <div className="text-lg text-slate-400 animate-pulse">Loading countdown...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <div className="text-lg text-red-500">Error: {error.message}</div>
            </div>
        );
    }

    if (timelinePeople.length === 0) {
        return (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4">
                <Timer className="h-16 w-16 text-slate-300" />
                <div className="text-center">
                    <h2 className="text-xl font-semibold text-slate-600">No Countdown Chores</h2>
                    <p className="mt-1 text-sm text-slate-400">
                        Chores with timing rules (before time, after marker, etc.) and estimated durations will appear here.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Countdown</h1>
                    <p className="text-sm text-slate-500">
                        {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                    </p>
                </div>
                <div className="flex items-center gap-4">
                    {/* View toggle */}
                    <div className="flex rounded-lg border border-slate-200 p-0.5">
                        <button
                            type="button"
                            onClick={() => setViewMode('grid')}
                            className={cn(
                                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                                viewMode === 'grid'
                                    ? 'bg-slate-900 text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700',
                            )}
                        >
                            <LayoutGrid className="h-3.5 w-3.5" />
                            Grid
                        </button>
                        <button
                            type="button"
                            onClick={() => setViewMode('sequence')}
                            className={cn(
                                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all',
                                viewMode === 'sequence'
                                    ? 'bg-slate-900 text-white shadow-sm'
                                    : 'text-slate-500 hover:text-slate-700',
                            )}
                        >
                            <GitBranch className="h-3.5 w-3.5" />
                            Sequence
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="auto-complete-toggle" className="text-xs text-slate-500">
                            Auto-complete
                        </Label>
                        <Switch
                            id="auto-complete-toggle"
                            checked={autoComplete}
                            onCheckedChange={setAutoComplete}
                        />
                    </div>
                </div>
            </div>

            {/* Person selector */}
            <div className="flex flex-wrap items-center gap-2">
                {timelinePeople.map((p) => {
                    const isSelected = p.personId === selectedPersonId;
                    const slotsActive = p.timeline.slots.filter(
                        (s) => getLiveState(s, nowMs) === 'active' || getLiveState(s, nowMs) === 'overdue_active'
                    ).length;
                    const slotsCompleted = p.timeline.slots.filter((s) => s.state === 'completed').length;
                    const slotsTotal = p.timeline.slots.filter((s) => s.state !== 'buffer').length;

                    return (
                        <button
                            key={p.personId}
                            type="button"
                            onClick={() => setSelectedPersonId(p.personId)}
                            className={cn(
                                'flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all',
                                isSelected
                                    ? 'border-sky-400 bg-sky-50 text-sky-800 shadow-sm'
                                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                            )}
                        >
                            <User className="h-3.5 w-3.5" />
                            {p.name}
                            <span className={cn(
                                'inline-flex items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold',
                                slotsActive > 0 ? 'bg-amber-200 text-amber-800' : 'bg-slate-100 text-slate-500',
                            )}>
                                {slotsCompleted}/{slotsTotal}
                            </span>
                        </button>
                    );
                })}
            </div>

            {/* Ahead-of-schedule banner */}
            {aheadBySeconds > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                    🎉 Ahead of schedule by {Math.floor(aheadBySeconds / 60)}m {aheadBySeconds % 60}s
                </div>
            )}

            {/* Warnings */}
            {activeTimeline?.warnings && activeTimeline.warnings.length > 0 && (
                <div className="space-y-2">
                    {activeTimeline.warnings.map((w, i) => (
                        <div
                            key={i}
                            className={cn(
                                'rounded-xl border px-4 py-2 text-sm',
                                w.severity === 'error' && 'border-red-200 bg-red-50 text-red-700',
                                w.severity === 'warning' && 'border-amber-200 bg-amber-50 text-amber-700',
                                w.severity === 'info' && 'border-blue-200 bg-blue-50 text-blue-700',
                            )}
                        >
                            {w.message}
                        </div>
                    ))}
                </div>
            )}

            {/* Collision banners */}
            {unresolvedCollisions.length > 0 && (
                <div className="space-y-2">
                    {unresolvedCollisions.map((c) => {
                        const key = `${c.startDrivenChoreId}:${c.deadlineDrivenChoreId}`;
                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => setActiveCollision(c)}
                                className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-left transition-all hover:bg-amber-100"
                            >
                                <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
                                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                                    <span>
                                        Conflict for {c.memberName}: "{c.startDrivenChoreTitle}" overlaps with
                                        "{c.deadlineDrivenChoreTitle}"
                                    </span>
                                    <span className="ml-auto text-xs text-amber-600 whitespace-nowrap">Resolve →</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Collision decision dialog */}
            <CollisionDecisionDialog
                collision={activeCollision}
                memberName={
                    activeCollision
                        ? familyMembers.find((m: any) => m.id === activeCollision.personId)?.name || 'Unknown'
                        : ''
                }
                open={activeCollision !== null}
                onDecision={handleCollisionDecision}
                onClose={() => setActiveCollision(null)}
            />

            {/* View content */}
            {viewMode === 'sequence' ? (
                <SequenceTimeline
                    output={countdownOutput!}
                    people={timelinePeople}
                    familyMembers={familyMembers.map((m: any) => ({ id: m.id, name: m.name, color: m.color }))}
                    choresRaw={chores.map((c: any) => ({ id: c.id, timingMode: c.timingMode, sortOrder: c.sortOrder, timingConfig: c.timingConfig }))}
                    nowMs={nowMs}
                    onMarkDone={handleMarkDone}
                    onReorder={handleReorder}
                />
            ) : (
                <>
                    {/* Overdue */}
                    {overdueSlots.length > 0 && (
                        <section>
                            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-red-500">
                                Overdue ({overdueSlots.length})
                            </h2>
                            <div className={cn(
                                'grid gap-4',
                                isCompact ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
                            )}>
                                {overdueSlots.map((slot) => (
                                    <SlotCard
                                        key={`${slot.choreId}-${slot.personId}`}
                                        slot={slot}
                                        nowMs={nowMs}
                                        memberName={memberName(slot.personId)}
                                        showMemberName={!selectedPersonId}
                                        onComplete={handleMarkDone}
                                        isCompact={isCompact}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Active */}
                    {activeSlots.length > 0 && (
                        <section>
                            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-amber-600">
                                In Progress ({activeSlots.length})
                            </h2>
                            <div className={cn(
                                'grid gap-4',
                                isCompact ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
                            )}>
                                {activeSlots.map((slot) => (
                                    <SlotCard
                                        key={`${slot.choreId}-${slot.personId}`}
                                        slot={slot}
                                        nowMs={nowMs}
                                        memberName={memberName(slot.personId)}
                                        showMemberName={!selectedPersonId}
                                        onComplete={handleMarkDone}
                                        isCompact={isCompact}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Upcoming */}
                    {upcomingSlots.length > 0 && (
                        <section>
                            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
                                Upcoming ({upcomingSlots.length})
                            </h2>
                            <div className={cn(
                                'grid gap-4',
                                isCompact ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
                            )}>
                                {upcomingSlots.map((slot) => (
                                    <SlotCard
                                        key={`${slot.choreId}-${slot.personId}`}
                                        slot={slot}
                                        nowMs={nowMs}
                                        memberName={memberName(slot.personId)}
                                        showMemberName={!selectedPersonId}
                                        onComplete={handleMarkDone}
                                        isCompact={isCompact}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Completed */}
                    {completedSlots.length > 0 && (
                        <section>
                            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-emerald-600">
                                Completed ({completedSlots.length})
                            </h2>
                            <div className={cn(
                                'grid gap-4',
                                isCompact ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
                            )}>
                                {completedSlots.map((slot) => (
                                    <SlotCard
                                        key={`${slot.choreId}-${slot.personId}`}
                                        slot={slot}
                                        nowMs={nowMs}
                                        memberName={memberName(slot.personId)}
                                        showMemberName={!selectedPersonId}
                                        isCompact={isCompact}
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {visibleSlots.length === 0 && selectedPersonId && (
                        <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-200 text-slate-400">
                            No timed chores for {memberName(selectedPersonId)} today
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
