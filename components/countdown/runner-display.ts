import type { CountdownRunLike, RunnerState, RunnerStep } from '@family-organizer/shared-core';
import type { RadialTimerState } from './RadialTimer';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Ring digits. A negative value is a step counting up past zero. */
export function formatCountdown(remainingMs: number): { main: string; sub: string; sign: string } {
    const totalSecs = Math.abs(Math.round(remainingMs / 1000));
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    const sign = remainingMs <= -500 ? '+' : '';
    if (h > 0) {
        return { main: `${h}:${String(m).padStart(2, '0')}`, sub: String(s).padStart(2, '0'), sign };
    }
    return { main: `${m}:${String(s).padStart(2, '0')}`, sub: '', sign };
}

/** A span of time in words: `45s`, `12m`, `3h 50m`. */
export function formatSpan(seconds: number): string {
    const abs = Math.abs(Math.round(seconds));
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    const s = abs % 60;
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    if (m === 0) return `${s}s`;
    // Past ten minutes the seconds are noise.
    if (s === 0 || m >= 10) return `${m}m`;
    return `${m}m ${s}s`;
}

export function formatClockTime(timestampMs: number): string {
    return new Date(timestampMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function getInitials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------------
// What a panel shows
// ---------------------------------------------------------------------------

export type RunnerPanelMode =
    /** A timed live step with time left. */
    | 'running'
    /** A timed live step counting up past zero. */
    | 'overrun'
    /** The pause before the next step's timer begins. */
    | 'celebrating'
    /** A live step with no timer: it waits for a tap. */
    | 'untimed'
    /** No run, and the next step's scheduled slot has begun. */
    | 'due'
    /** No run, with a step that could be started now. */
    | 'ready'
    /** No run, and everything left is still gated. */
    | 'waiting'
    /** Nothing left to do today. */
    | 'done';

export interface RunnerPanelView {
    mode: RunnerPanelMode;
    /** The step the panel is about: the live one, or the one Start would begin. */
    step: RunnerStep | null;
    ring: { startMs: number; endMs: number; state: RadialTimerState; progress: number } | null;
    /** Milliseconds for the ring digits; negative counts up. */
    readoutMs: number | null;
    /** Small caps label above the digits. */
    readoutLabel: string | null;
}

/**
 * Decide what one person's panel is showing. A live step runs on the runner
 * clock; with no run, the planner's slot for the next step comes back as a
 * reminder once its scheduled time arrives.
 */
export function describeRunnerPanel(state: RunnerState, nowMs: number): RunnerPanelView {
    const { liveStep, clock, nextStep } = state;

    if (state.phase === 'running' && liveStep && clock) {
        if (clock.state === 'untimed' || clock.endMs == null) {
            return { mode: 'untimed', step: liveStep, ring: null, readoutMs: null, readoutLabel: null };
        }
        if (clock.state === 'starting') {
            return {
                mode: 'celebrating',
                step: liveStep,
                ring: { startMs: clock.startMs, endMs: clock.endMs, state: 'celebrating', progress: 1 },
                readoutMs: clock.startMs - nowMs,
                readoutLabel: 'Up next',
            };
        }
        const overrun = clock.state === 'overrun';
        return {
            mode: overrun ? 'overrun' : 'running',
            step: liveStep,
            ring: { startMs: clock.startMs, endMs: clock.endMs, state: overrun ? 'overdue' : 'active', progress: clock.progress },
            readoutMs: clock.remainingMs,
            readoutLabel: overrun ? 'Over time' : null,
        };
    }

    if (nextStep) {
        const { plannedStartMs, plannedEndMs } = nextStep;
        if (plannedStartMs != null && plannedEndMs != null && plannedEndMs > plannedStartMs && nowMs >= plannedStartMs) {
            const late = nowMs >= plannedEndMs;
            return {
                mode: 'due',
                step: nextStep,
                ring: {
                    startMs: plannedStartMs,
                    endMs: plannedEndMs,
                    state: late ? 'overdue' : 'active',
                    progress: Math.max(0, Math.min(1, (nowMs - plannedStartMs) / (plannedEndMs - plannedStartMs))),
                },
                readoutMs: plannedEndMs - nowMs,
                readoutLabel: late ? 'Past due' : 'Due in',
            };
        }
        return { mode: 'ready', step: nextStep, ring: null, readoutMs: null, readoutLabel: null };
    }

    return {
        mode: state.lockedSteps.length > 0 && !state.allDone ? 'waiting' : 'done',
        step: null,
        ring: null,
        readoutMs: null,
        readoutLabel: null,
    };
}

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------

export interface RunnerPace {
    tone: 'ahead' | 'behind' | 'even';
    label: string;
}

/** Ahead/behind against the planner's schedule, for a run in progress. */
export function describePace(state: RunnerState): RunnerPace | null {
    const { aheadSecs } = state.standing;
    if (state.phase !== 'running' || aheadSecs == null) return null;
    if (Math.abs(aheadSecs) < 30) return { tone: 'even', label: 'On schedule' };
    return aheadSecs > 0
        ? { tone: 'ahead', label: `${formatSpan(aheadSecs)} ahead` }
        : { tone: 'behind', label: `${formatSpan(aheadSecs)} behind` };
}

export interface RunnerForecast {
    tone: 'miss' | 'clear';
    label: string;
}

/**
 * The overlap that used to be a modal decision, as a sentence: either the
 * first hard deadline this pace misses, or how much room the tightest one has.
 */
export function describeForecast(state: RunnerState): RunnerForecast | null {
    const { firstMiss, tightest } = state.standing;
    const running = state.phase === 'running';
    if (firstMiss) {
        const lateBy = formatSpan(firstMiss.marginSecs ?? 0);
        return {
            tone: 'miss',
            label: running
                ? `Keep going and you will miss ${firstMiss.title} by ${lateBy}`
                : `Even starting now, ${firstMiss.title} runs ${lateBy} late`,
        };
    }
    // "Room to spare" assumes the pace continues, which is only true of a run in progress.
    if (!running || !tightest || tightest.deadlineMs == null) return null;
    return {
        tone: 'clear',
        label: `${formatSpan(tightest.marginSecs ?? 0)} to spare before ${tightest.title} at ${formatClockTime(tightest.deadlineMs)}`,
    };
}

/** When a gated step opens, in words. */
export function describeGate(step: RunnerStep): string {
    if (step.earliestStartMs != null) {
        return step.waitingOnTitle
            ? `After ${step.waitingOnTitle}, or at ${formatClockTime(step.earliestStartMs)}`
            : `Unlocks at ${formatClockTime(step.earliestStartMs)}`;
    }
    return step.waitingOnTitle ? `After ${step.waitingOnTitle}` : 'Not available yet';
}

/** The planner's slot for a step that is not running yet. */
export function describeSchedule(step: RunnerStep, nowMs: number): string | null {
    if (step.plannedStartMs == null || step.plannedEndMs == null) {
        return step.deadlineMs != null ? `Due by ${formatClockTime(step.deadlineMs)}` : null;
    }
    const due = step.deadlineMs != null ? ` · due ${formatClockTime(step.deadlineMs)}` : '';
    return nowMs < step.plannedStartMs
        ? `Start by ${formatClockTime(step.plannedStartMs)}${due}`
        : `Was due to start at ${formatClockTime(step.plannedStartMs)}${due}`;
}

const STOP_NOTES: Record<string, string> = {
    timeout: 'The last run stopped by itself because nobody answered.',
    day_boundary: 'The last run was still going when the day ended.',
};

/** Why the previous run ended, when that is worth telling the person. */
export function describeLastStop(run: CountdownRunLike | null | undefined): string | null {
    if (!run || run.status !== 'stopped') return null;
    return STOP_NOTES[run.stoppedReason || ''] ?? null;
}
