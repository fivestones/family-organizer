'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlarmClockPlus,
    Check,
    ChevronRight,
    Hand,
    Hourglass,
    Lock,
    Minus,
    PartyPopper,
    Play,
    Square,
    TrendingDown,
    TrendingUp,
    TriangleAlert,
} from 'lucide-react';
import type { CountdownSettings } from '@family-organizer/shared-core';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getPhotoUrl } from '@/lib/photo-urls';
import { cn } from '@/lib/utils';
import RadialTimer, { getTimerBackdrop } from './RadialTimer';
import {
    describeForecast,
    describeGate,
    describeLastStop,
    describePace,
    describeRunnerPanel,
    describeSchedule,
    formatCountdown,
    formatSpan,
    getInitials,
    type RunnerPanelMode,
    type RunnerPanelView,
} from './runner-display';
import type { CountdownRunnerActions, MemberRunner } from './useCountdownRunner';

// ---------------------------------------------------------------------------
// Backdrop
// ---------------------------------------------------------------------------

/** Screens without a ring get a deeper, calmer field so white text always reads. */
const CALM_BACKDROPS: Record<Exclude<RunnerPanelMode, 'running' | 'overrun' | 'celebrating' | 'due'>, string> = {
    untimed: 'radial-gradient(circle at 50% 30%, hsl(199, 72%, 44%), hsl(226, 64%, 22%))',
    ready: 'radial-gradient(circle at 50% 30%, hsl(228, 66%, 46%), hsl(248, 60%, 20%))',
    waiting: 'radial-gradient(circle at 50% 30%, hsl(232, 30%, 36%), hsl(240, 34%, 14%))',
    done: 'radial-gradient(circle at 50% 30%, hsl(152, 62%, 38%), hsl(172, 64%, 16%))',
};

function getPanelBackdrop(view: RunnerPanelView): string {
    if (view.ring) return getTimerBackdrop(view.ring.state, view.ring.progress);
    return CALM_BACKDROPS[view.mode as keyof typeof CALM_BACKDROPS] ?? CALM_BACKDROPS.ready;
}

// ---------------------------------------------------------------------------
// Ring digits that always fit
// ---------------------------------------------------------------------------

/**
 * Size the ring's digits from its measured width. Within one step the scale
 * only ever shrinks, so the numbers never jump back up as they tick.
 */
function useFittedDigits(ringWidthPx: number, digits: { sign: string; main: string; sub: string }, resetKey: string) {
    const minScaleRef = useRef(1);
    const resetKeyRef = useRef(resetKey);
    const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);

    if (resetKeyRef.current !== resetKey) {
        resetKeyRef.current = resetKey;
        minScaleRef.current = 1;
    }

    const idealMainPx = ringWidthPx * 0.26;
    const safeWidth = ringWidthPx * 0.75;

    const scale = useMemo(() => {
        if (idealMainPx <= 0 || safeWidth <= 0) return 1;
        if (!canvasCtxRef.current) canvasCtxRef.current = document.createElement('canvas').getContext('2d');
        const ctx = canvasCtxRef.current;
        if (!ctx) return minScaleRef.current;

        const fontFamily = 'system-ui, -apple-system, sans-serif';
        ctx.font = `bold ${idealMainPx}px ${fontFamily}`;
        let totalWidth = ctx.measureText(digits.sign + digits.main).width;
        if (digits.sub) {
            ctx.font = `bold ${idealMainPx * 0.45}px ${fontFamily}`;
            totalWidth += ctx.measureText(digits.sub).width + idealMainPx * 0.05;
        }

        minScaleRef.current = Math.min(minScaleRef.current, totalWidth > safeWidth ? safeWidth / totalWidth : 1);
        return minScaleRef.current;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [digits.main, digits.sub, digits.sign, idealMainPx, safeWidth, resetKey]);

    const measured = ringWidthPx > 0;
    const mainPx = idealMainPx * scale;
    return {
        measured,
        mainPx,
        // Until the ring has been measured, fall back to viewport-relative sizes.
        main: measured ? { fontSize: `${mainPx}px` } : { fontSize: 'min(16vmin, 150px)' },
        sub: measured ? { fontSize: `${mainPx * 0.45}px` } : { fontSize: 'min(7vmin, 68px)' },
        sign: measured ? { fontSize: `${mainPx * 0.35}px` } : { fontSize: 'min(5.5vmin, 52px)' },
        scaled: (ratio: number, minPx: number, fallback: string) =>
            measured ? { fontSize: `${Math.max(minPx, ringWidthPx * ratio)}px` } : { fontSize: fallback },
    };
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** One dot per step in queue order: finished, live, or still to do. */
function ProgressDots({ state }: { state: MemberRunner['state'] }) {
    const { queue, totalCount, completedCount, liveStep } = state;
    if (totalCount <= 0) return null;
    if (totalCount > 12) {
        return (
            <span className="text-xs font-medium text-white/70">
                {completedCount} of {totalCount} done
            </span>
        );
    }
    return (
        <div className="flex items-center gap-1.5" role="img" aria-label={`${completedCount} of ${totalCount} done`}>
            {queue.map((step) => (
                <span
                    key={step.choreId}
                    className={cn(
                        'rounded-full transition-all duration-300',
                        step.completedAtMs != null
                            ? 'h-2 w-2 bg-white/90'
                            : step.choreId === liveStep?.choreId
                              ? 'h-2.5 w-2.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)]'
                              : 'h-2 w-2 bg-white/30',
                    )}
                />
            ))}
        </div>
    );
}

function MemberAvatar({
    runner,
    className,
    style,
    initialsStyle,
}: {
    runner: MemberRunner;
    className?: string;
    style?: React.CSSProperties;
    initialsStyle?: React.CSSProperties;
}) {
    const photoUrl = getPhotoUrl(runner.member.photoUrls, '320');
    return (
        <Avatar className={cn('ring-2 ring-white/25', className)} style={style}>
            {photoUrl && <AvatarImage src={photoUrl} alt={runner.member.name} />}
            <AvatarFallback className="bg-white/20 text-sm font-semibold text-white" style={initialsStyle}>
                {getInitials(runner.member.name)}
            </AvatarFallback>
        </Avatar>
    );
}

const PILL = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold backdrop-blur-sm';

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

interface RunnerPanelProps {
    runner: MemberRunner;
    nowMs: number;
    settings: CountdownSettings;
    actions: CountdownRunnerActions;
    /** `solo` fills the page; `tile` is one of several people side by side. */
    layout: 'solo' | 'tile';
}

export default function RunnerPanel({ runner, nowMs, settings, actions, layout }: RunnerPanelProps) {
    const { member, state, run, canControl } = runner;
    const view = describeRunnerPanel(state, nowMs);
    const { mode, step } = view;
    const isSolo = layout === 'solo';
    const isLive = state.phase === 'running';

    const pace = describePace(state);
    const forecast = describeForecast(state);
    const lastStopNote = isLive ? null : describeLastStop(run);
    const upNext = isLive ? state.nextStep : null;
    const extensionLabel = `+${formatSpan(settings.stepExtensionSecs)}`;

    // --- Ring measurement ---
    const ringRef = useRef<HTMLDivElement>(null);
    const [ringWidthPx, setRingWidthPx] = useState(0);
    const hasRing = view.ring != null;
    useEffect(() => {
        const element = ringRef.current;
        if (!element) return;
        setRingWidthPx(element.offsetWidth);
        const observer = new ResizeObserver(([entry]) => setRingWidthPx(entry.contentRect.width));
        observer.observe(element);
        return () => observer.disconnect();
    }, [hasRing]);

    const digits = formatCountdown(view.readoutMs ?? 0);
    const fitted = useFittedDigits(ringWidthPx, digits, `${step?.choreId ?? ''}:${mode}`);
    const digitTone =
        mode === 'overrun' || (mode === 'due' && view.ring?.state === 'overdue')
            ? 'text-red-50'
            : mode === 'celebrating'
              ? 'text-emerald-50'
              : 'text-white';

    // --- The overrun prompt ---
    const prompt = isLive ? state.overrun : null;
    const promptOpen = !!prompt && prompt.prompt !== 'none';
    const stopsInMs = prompt?.promptSinceMs != null ? prompt.promptSinceMs + settings.overrunPromptGraceSecs * 1000 - nowMs : 0;

    return (
        <section
            aria-label={`${member.name}'s countdown`}
            data-testid={`countdown-panel-${member.id}`}
            data-mode={mode}
            className={cn(
                'relative isolate flex flex-col items-center overflow-hidden text-white',
                // Solo, the panel runs edge to edge beneath the page's bar of people.
                isSolo ? 'flex-1 pt-16' : 'rounded-[2rem] shadow-2xl shadow-slate-950/40 ring-1 ring-white/10',
            )}
        >
            <div
                aria-hidden
                className="absolute inset-0 -z-10 transition-[background] duration-1000 ease-in-out"
                style={{ background: getPanelBackdrop(view) }}
            />

            {!isSolo && (
                <header className="flex w-full items-center gap-3 px-5 pt-5">
                    <MemberAvatar runner={runner} className="h-9 w-9" initialsStyle={{ fontSize: '12px' }} />
                    <span className="min-w-0 flex-1 truncate text-base font-semibold">{member.name}</span>
                    <span className="text-xs font-medium text-white/60">
                        {state.completedCount}/{state.totalCount}
                    </span>
                </header>
            )}

            {/* ---- Stage ---- */}
            <div className={cn('flex w-full flex-1 flex-col items-center justify-center px-4', isSolo ? 'py-2' : 'py-4')}>
                {view.ring && step ? (
                    <div ref={ringRef} className="relative">
                        <RadialTimer
                            startMs={view.ring.startMs}
                            endMs={view.ring.endMs}
                            progress={view.ring.progress}
                            state={view.ring.state}
                            choreKey={`${step.choreId}:${member.id}:${mode}`}
                            size={isSolo ? 'min(88vw, 58vh)' : 'min(78vw, 42vh)'}
                        >
                            <div className="flex flex-col items-center gap-2">
                                {view.readoutLabel && (
                                    <div
                                        className="font-semibold uppercase tracking-[0.18em] text-white/70"
                                        style={fitted.scaled(0.026, 11, 'min(2.4vmin, 14px)')}
                                    >
                                        {view.readoutLabel}
                                    </div>
                                )}

                                {mode === 'celebrating' ? (
                                    <Check
                                        className="text-emerald-50 drop-shadow-lg"
                                        strokeWidth={2.5}
                                        style={
                                            fitted.measured
                                                ? { width: `${fitted.mainPx * 0.8}px`, height: `${fitted.mainPx * 0.8}px` }
                                                : { width: 'min(13vmin, 120px)', height: 'min(13vmin, 120px)' }
                                        }
                                    />
                                ) : (
                                    <div
                                        className={cn('flex items-baseline gap-0.5 font-bold leading-none', digitTone)}
                                        role="timer"
                                        aria-label={`${digits.sign}${digits.main}${digits.sub ? `:${digits.sub}` : ''}`}
                                    >
                                        {digits.sign && (
                                            <span className="tabular-nums opacity-80" style={fitted.sign}>
                                                {digits.sign}
                                            </span>
                                        )}
                                        <span
                                            className="tabular-nums"
                                            style={{ ...fitted.main, textShadow: '0 10px 30px rgba(0,0,0,0.18)' }}
                                        >
                                            {digits.main}
                                        </span>
                                        {digits.sub && (
                                            <span className="ml-1 tabular-nums opacity-50" style={fitted.sub}>
                                                {digits.sub}
                                            </span>
                                        )}
                                    </div>
                                )}

                                <div className="mt-2 max-w-[78%] text-center">
                                    <div
                                        className="font-semibold leading-snug text-white/90"
                                        style={fitted.scaled(0.046, 16, 'min(4vmin, 28px)')}
                                    >
                                        {step.title}
                                    </div>
                                    {runner.stepDescription && mode !== 'celebrating' && (
                                        <div
                                            className="mt-1.5 line-clamp-2 leading-snug text-white/60"
                                            style={fitted.scaled(0.028, 13, 'min(2.8vmin, 18px)')}
                                        >
                                            {runner.stepDescription}
                                        </div>
                                    )}
                                </div>

                                {isSolo && (
                                    <MemberAvatar
                                        runner={runner}
                                        className="mt-2"
                                        style={
                                            fitted.measured
                                                ? {
                                                      width: `${Math.max(36, ringWidthPx * 0.08)}px`,
                                                      height: `${Math.max(36, ringWidthPx * 0.08)}px`,
                                                  }
                                                : { width: 'min(8vmin, 56px)', height: 'min(8vmin, 56px)' }
                                        }
                                        initialsStyle={fitted.scaled(0.028, 12, 'min(3vmin, 18px)')}
                                    />
                                )}
                            </div>
                        </RadialTimer>
                    </div>
                ) : (
                    <CalmStage runner={runner} view={view} nowMs={nowMs} isSolo={isSolo} />
                )}
            </div>

            {/* ---- Readouts and actions ---- */}
            <div className={cn('flex w-full max-w-lg flex-col items-center gap-4 px-5', isSolo ? 'pb-8' : 'pb-6')}>
                <ProgressDots state={state} />

                {(pace || forecast) && (
                    <div className="flex flex-col items-center gap-2">
                        {pace && (
                            <span
                                className={cn(
                                    PILL,
                                    pace.tone === 'ahead' && 'bg-emerald-950/35 text-emerald-50',
                                    pace.tone === 'behind' && 'bg-red-950/40 text-red-50',
                                    pace.tone === 'even' && 'bg-white/15 text-white/80',
                                )}
                            >
                                {pace.tone === 'ahead' && <TrendingUp className="h-3.5 w-3.5" />}
                                {pace.tone === 'behind' && <TrendingDown className="h-3.5 w-3.5" />}
                                {pace.tone === 'even' && <Minus className="h-3.5 w-3.5" />}
                                {pace.label}
                            </span>
                        )}
                        {forecast && (
                            <p
                                className={cn(
                                    'flex items-start gap-1.5 text-center text-xs leading-relaxed',
                                    forecast.tone === 'miss' ? 'font-semibold text-amber-100' : 'text-white/65',
                                )}
                            >
                                {forecast.tone === 'miss' && <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                                <span>{forecast.label}</span>
                            </p>
                        )}
                    </div>
                )}

                {upNext && (
                    <div className="flex max-w-full items-center gap-1.5 text-xs text-white/60">
                        <span>Next:</span>
                        <span className="truncate font-medium text-white/85">{upNext.title}</span>
                        <ChevronRight className="h-3 w-3 shrink-0" />
                    </div>
                )}

                {lastStopNote && <p className="text-center text-xs text-white/60">{lastStopNote}</p>}

                {canControl ? (
                    <div className="flex w-full max-w-xs flex-col gap-2">
                        {(mode === 'ready' || mode === 'due') && (
                            <Button
                                size="lg"
                                onClick={() => actions.start(member.id)}
                                className="w-full rounded-2xl bg-white py-6 text-base font-bold text-slate-900 shadow-xl shadow-slate-950/20 transition-all hover:bg-white/90"
                            >
                                <Play className="mr-2 h-5 w-5 fill-current" />
                                Start
                            </Button>
                        )}

                        {isLive && step && (
                            <>
                                <Button
                                    size="lg"
                                    onClick={() => actions.markDone(member.id)}
                                    disabled={mode === 'celebrating'}
                                    className={cn(
                                        'w-full rounded-2xl py-6 text-base font-bold shadow-xl transition-all disabled:opacity-100',
                                        mode === 'celebrating'
                                            ? 'bg-emerald-500 text-white shadow-emerald-950/30'
                                            : mode === 'overrun'
                                              ? 'bg-white text-red-600 shadow-red-950/30 hover:bg-white/90'
                                              : 'bg-white text-slate-900 shadow-slate-950/20 hover:bg-white/90',
                                    )}
                                >
                                    <Check className="mr-2 h-5 w-5" strokeWidth={3} />
                                    {mode === 'celebrating' ? 'Nice work!' : 'Done'}
                                </Button>
                                <div className="flex gap-2">
                                    {step.durationSecs != null && mode !== 'celebrating' && (
                                        <Button
                                            variant="ghost"
                                            onClick={() => actions.extend(member.id)}
                                            aria-label={`Add ${formatSpan(settings.stepExtensionSecs)} to this step`}
                                            className="flex-1 rounded-2xl bg-white/15 py-5 text-sm font-semibold text-white backdrop-blur-sm hover:bg-white/25 hover:text-white"
                                        >
                                            <AlarmClockPlus className="mr-2 h-4 w-4" />
                                            {extensionLabel}
                                        </Button>
                                    )}
                                    <Button
                                        variant="ghost"
                                        onClick={() => actions.stop(member.id)}
                                        className="flex-1 rounded-2xl py-5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white"
                                    >
                                        <Square className="mr-2 h-4 w-4" />
                                        Stop
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    mode !== 'done' && (
                        <p className="max-w-xs text-center text-xs text-white/55">
                            Only {member.name} or a parent can {isLive ? 'control' : 'start'} this countdown.
                        </p>
                    )
                )}

                {state.lockedSteps.length > 0 && mode !== 'waiting' && (
                    <LaterList steps={state.lockedSteps} />
                )}
            </div>

            {/* ---- "Are you still there?" ---- */}
            {promptOpen && step && (
                <div
                    role="alertdialog"
                    aria-modal="false"
                    aria-labelledby={`still-working-${member.id}`}
                    className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/60 p-6 backdrop-blur-sm"
                >
                    <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center text-slate-900 shadow-2xl">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                            <Hand className="h-6 w-6" />
                        </div>
                        <h3 id={`still-working-${member.id}`} className="mt-4 text-xl font-bold tracking-tight">
                            {prompt!.prompt === 'still_working_or_stop'
                                ? 'Still working on this, or should I stop the run?'
                                : `Still working on ${step.title}?`}
                        </h3>
                        <p className="mt-2 text-sm text-slate-500">
                            {stopsInMs > 0
                                ? `This run stops by itself in ${formatSpan(Math.ceil(stopsInMs / 1000))}.`
                                : 'This run is about to stop by itself.'}
                        </p>
                        {canControl ? (
                            <div className="mt-6 flex flex-col gap-2">
                                <Button
                                    size="lg"
                                    onClick={() => actions.extend(member.id)}
                                    className="w-full rounded-2xl bg-slate-900 py-6 text-base font-bold text-white hover:bg-slate-800"
                                >
                                    {prompt!.prompt === 'still_working_or_stop'
                                        ? `Keep going (${extensionLabel})`
                                        : `Yes, ${formatSpan(settings.stepExtensionSecs)} more`}
                                </Button>
                                {prompt!.prompt === 'still_working_or_stop' && (
                                    <Button
                                        size="lg"
                                        variant="outline"
                                        onClick={() => actions.stop(member.id)}
                                        className="w-full rounded-2xl py-6 text-base font-semibold"
                                    >
                                        Stop the run
                                    </Button>
                                )}
                            </div>
                        ) : (
                            <p className="mt-5 text-sm font-medium text-slate-600">Waiting for {member.name} to answer.</p>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}

// ---------------------------------------------------------------------------
// Stages without a ring
// ---------------------------------------------------------------------------

function CalmStage({ runner, view, nowMs, isSolo }: { runner: MemberRunner; view: RunnerPanelView; nowMs: number; isSolo: boolean }) {
    const { state, member } = runner;
    const { mode, step } = view;

    const icon =
        mode === 'done' ? (
            <PartyPopper className="h-1/2 w-1/2" />
        ) : mode === 'waiting' ? (
            <Hourglass className="h-1/2 w-1/2" />
        ) : mode === 'untimed' ? (
            <Hand className="h-1/2 w-1/2" />
        ) : (
            <Play className="h-1/2 w-1/2 translate-x-[6%] fill-current" />
        );

    const eyebrow =
        mode === 'done' ? 'All done' : mode === 'waiting' ? 'Nothing open right now' : mode === 'untimed' ? 'No timer' : 'Up next';

    const title =
        mode === 'done'
            ? state.totalCount > 0
                ? 'Everything is finished'
                : 'Nothing on the plate today'
            : mode === 'waiting'
              ? 'The rest unlocks later'
              : step?.title ?? '';

    const detail =
        mode === 'done'
            ? state.totalCount > 0
                ? `${state.completedCount} of ${state.totalCount} done today.`
                : null
            : mode === 'untimed'
              ? runner.stepDescription || 'Tap Done when you are finished.'
              : mode === 'ready'
                ? runner.stepDescription
                : null;

    // What Start is committing to: how long the step takes and when the plan wanted it.
    const facts =
        mode === 'ready' && step
            ? [
                  step.durationSecs != null ? `Takes ${formatSpan(step.durationSecs)}` : 'No timer',
                  describeSchedule(step, nowMs),
              ].filter((fact): fact is string => !!fact)
            : [];

    return (
        <div className={cn('flex w-full max-w-xl flex-col items-center text-center', isSolo ? 'gap-5 py-10' : 'gap-4 py-6')}>
            <div
                className={cn(
                    'flex items-center justify-center rounded-full bg-white/15 text-white shadow-inner shadow-white/10 ring-1 ring-white/20 backdrop-blur-sm',
                    isSolo ? 'h-28 w-28' : 'h-20 w-20',
                )}
            >
                {icon}
            </div>
            <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-white/65">{eyebrow}</div>
                <h2 className={cn('font-bold leading-tight tracking-tight', isSolo ? 'text-4xl sm:text-5xl' : 'text-2xl')}>{title}</h2>
                {detail && (
                    <p className={cn('mx-auto line-clamp-3 max-w-md leading-relaxed text-white/70', isSolo ? 'text-base' : 'text-sm')}>
                        {detail}
                    </p>
                )}
            </div>
            {facts.length > 0 && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                    {facts.map((fact) => (
                        <span key={fact} className={cn(PILL, 'bg-white/15 font-medium text-white/85')}>
                            {fact}
                        </span>
                    ))}
                </div>
            )}
            {mode === 'waiting' && <LaterList steps={state.lockedSteps} emphasised />}
            {isSolo && mode !== 'waiting' && <MemberAvatar runner={runner} className="h-12 w-12" />}
            <span className="sr-only">{member.name}</span>
        </div>
    );
}

function LaterList({ steps, emphasised = false }: { steps: MemberRunner['state']['lockedSteps']; emphasised?: boolean }) {
    const shown = steps.slice(0, emphasised ? 5 : 3);
    const hidden = steps.length - shown.length;
    return (
        <div className={cn('w-full max-w-sm', emphasised ? 'mt-1' : 'mt-1 border-t border-white/15 pt-4')}>
            {!emphasised && (
                <div className="mb-2 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Later</div>
            )}
            <ul className="space-y-1.5">
                {shown.map((step) => (
                    <li
                        key={step.choreId}
                        className="flex items-center gap-3 rounded-2xl bg-white/10 px-4 py-2.5 text-left backdrop-blur-sm"
                    >
                        <Lock className="h-4 w-4 shrink-0 text-white/60" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/90">{step.title}</span>
                        <span className="shrink-0 text-xs text-white/60">{describeGate(step)}</span>
                    </li>
                ))}
            </ul>
            {hidden > 0 && <div className="mt-2 text-center text-xs text-white/50">and {hidden} more</div>}
        </div>
    );
}
