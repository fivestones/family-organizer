'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, EyeOff, ListChecks, Play } from 'lucide-react';
import type { RoutineDaySummary } from '@/lib/routine-summary';
import { cn } from '@/lib/utils';

interface RoutineDayRowsProps {
    routines: RoutineDaySummary[];
    /** Routines can only be run for today; other dates show progress alone. */
    canRun: boolean;
    /** Whether more than one person is in view, so each step names who it is for. */
    showMembers: boolean;
    /** Tick a step for one person. Omitted when this session may not change the date in view. */
    onToggleStep?: (choreId: string, memberId: string) => void;
}

/**
 * The day list's stand-in for a routine's steps: one collapsed row per routine
 * with its progress and its own XP, opening to the steps it folds away.
 */
export default function RoutineDayRows({ routines, canRun, showMembers, onToggleStep }: RoutineDayRowsProps) {
    const [openId, setOpenId] = useState<string | null>(null);
    if (routines.length === 0) return null;

    return (
        <ul className="space-y-2" aria-label="Routines">
            {routines.map((routine) => {
                const isOpen = openId === routine.id;
                const finished = routine.total > 0 && routine.completed === routine.total;
                const percent = routine.total > 0 ? Math.round((routine.completed / routine.total) * 100) : 0;
                return (
                    <li
                        key={routine.id}
                        data-testid="routine-day-row"
                        className={cn(
                            'overflow-hidden rounded-2xl border bg-card shadow-sm transition-colors',
                            finished ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200',
                        )}
                    >
                        <div className="flex items-center gap-3 px-4 py-3">
                            <button
                                type="button"
                                aria-expanded={isOpen}
                                aria-controls={`routine-steps-${routine.id}`}
                                onClick={() => setOpenId(isOpen ? null : routine.id)}
                                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            >
                                <span
                                    className={cn(
                                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                                        finished ? 'bg-emerald-500 text-white' : 'bg-slate-900 text-white',
                                    )}
                                >
                                    {finished ? <Check className="h-5 w-5" strokeWidth={3} /> : <ListChecks className="h-5 w-5" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-baseline gap-2">
                                        <span className="truncate text-sm font-semibold">{routine.name}</span>
                                        <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                                            {routine.completed}/{routine.total}
                                        </span>
                                    </span>
                                    <span
                                        className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-200"
                                        role="progressbar"
                                        aria-valuemin={0}
                                        aria-valuemax={routine.total}
                                        aria-valuenow={routine.completed}
                                        aria-label={`${routine.name} progress`}
                                    >
                                        <span
                                            className={cn('block h-full rounded-full transition-all duration-500', finished ? 'bg-emerald-500' : 'bg-slate-900')}
                                            style={{ width: `${percent}%` }}
                                        />
                                    </span>
                                </span>
                                {routine.xpPossible > 0 && (
                                    <span
                                        className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold tabular-nums text-amber-800"
                                        title="XP from this routine's steps, already counted in the totals"
                                    >
                                        {routine.xpEarned}/{routine.xpPossible} XP
                                    </span>
                                )}
                                <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', isOpen && 'rotate-180')} />
                            </button>

                            {canRun && !finished && (
                                <Link
                                    href="/countdown"
                                    aria-label={`Run ${routine.name}`}
                                    className="flex shrink-0 items-center gap-1.5 rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-slate-700"
                                >
                                    <Play className="h-3 w-3 fill-current" /> Run
                                </Link>
                            )}
                        </div>

                        {isOpen && (
                            <div id={`routine-steps-${routine.id}`} className="border-t border-slate-200/80 bg-slate-50/60 px-4 py-3">
                                <ol className="space-y-1.5">
                                    {routine.steps.map((step, index) => {
                                        const allDone = step.members.every((member) => member.done);
                                        return (
                                            <li key={step.choreId} className="flex items-center gap-2.5 text-sm">
                                                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-slate-400">{index + 1}</span>
                                                <span className={cn('min-w-0 flex-1 truncate', allDone && 'text-muted-foreground line-through')}>
                                                    {step.title}
                                                </span>
                                                {step.hidden && (
                                                    <EyeOff className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="Only listed here" />
                                                )}
                                                <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                                                    {step.members.map((member) => (
                                                        <button
                                                            key={member.id}
                                                            type="button"
                                                            role="checkbox"
                                                            aria-checked={member.done}
                                                            aria-label={`${step.title} for ${member.name}`}
                                                            disabled={!onToggleStep}
                                                            onClick={() => onToggleStep?.(step.choreId, member.id)}
                                                            className={cn(
                                                                'flex h-7 items-center gap-1.5 rounded-full border text-xs font-medium transition-colors',
                                                                showMembers ? 'pl-1.5 pr-2.5' : 'w-7 justify-center',
                                                                member.done
                                                                    ? 'border-emerald-500 bg-emerald-500 text-white'
                                                                    : 'border-slate-300 bg-white text-slate-600',
                                                                onToggleStep
                                                                    ? member.done
                                                                        ? 'hover:bg-emerald-600'
                                                                        : 'hover:border-slate-400 hover:bg-slate-50'
                                                                    : 'cursor-default opacity-70',
                                                            )}
                                                        >
                                                            <span
                                                                className={cn(
                                                                    'flex h-4 w-4 items-center justify-center rounded-full',
                                                                    member.done ? 'bg-white/25' : 'ring-1 ring-slate-300',
                                                                )}
                                                            >
                                                                {member.done && <Check className="h-3 w-3" strokeWidth={3.5} />}
                                                            </span>
                                                            {showMembers && member.name}
                                                        </button>
                                                    ))}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ol>
                                {routine.hiddenCount > 0 && (
                                    <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <EyeOff className="h-3.5 w-3.5 shrink-0" />
                                        {routine.hiddenCount === routine.steps.length
                                            ? 'These steps are folded into this row and are not listed by themselves.'
                                            : 'Marked steps are folded into this row and are not listed by themselves.'}
                                    </p>
                                )}
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}
