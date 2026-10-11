import type {
  SharedScheduleSettings,
  SharedRoutineMarkerStatusLike,
  SharedTimingMode,
} from './chore-timing';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface CountdownSettings {
  /** Seconds of buffer between consecutive chores in a stack (default 30). */
  stackBufferSecs: number;
  /** Default delay in seconds after an `after_*` anchor fires (default 300). */
  afterAnchorDefaultDelaySecs: number;
  /** Per-marker overrides for the after-anchor delay, keyed by marker key. */
  perMarkerAfterDelaySecs?: Record<string, number>;
  /** Seconds one "+5 min" grant adds to the running step (default 300). */
  stepExtensionSecs: number;
  /** A step must run over by at least this long before the "still working?" prompt (default 300). */
  overrunPromptMinSecs: number;
  /** …or by this fraction of its own duration, whichever is longer (default 0.5). */
  overrunPromptFraction: number;
  /** Seconds the prompt may go unanswered before the run stops itself (default 600). */
  overrunPromptGraceSecs: number;
  /** After this many extensions on one step the prompt also offers to stop the run (default 2). */
  overrunStopOfferAfterExtensions: number;
}

export const DEFAULT_COUNTDOWN_SETTINGS: CountdownSettings = {
  stackBufferSecs: 30,
  afterAnchorDefaultDelaySecs: 300,
  stepExtensionSecs: 300,
  overrunPromptMinSecs: 300,
  overrunPromptFraction: 0.5,
  overrunPromptGraceSecs: 600,
  overrunStopOfferAfterExtensions: 2,
};

export const COUNTDOWN_SETTINGS_NAME = 'countdownSettings';

export function parseCountdownSettings(value?: string | null | unknown): CountdownSettings {
  if (!value) return { ...DEFAULT_COUNTDOWN_SETTINGS };
  let raw: unknown = value;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { return { ...DEFAULT_COUNTDOWN_SETTINGS }; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...DEFAULT_COUNTDOWN_SETTINGS };
  const obj = raw as Record<string, unknown>;
  const nonNegative = (key: keyof CountdownSettings, minimum = 0): number => {
    const parsed = obj[key] == null || obj[key] === '' ? NaN : Number(obj[key]);
    return Number.isFinite(parsed) && parsed >= minimum ? parsed : (DEFAULT_COUNTDOWN_SETTINGS[key] as number);
  };
  return {
    stackBufferSecs: nonNegative('stackBufferSecs'),
    afterAnchorDefaultDelaySecs: nonNegative('afterAnchorDefaultDelaySecs'),
    stepExtensionSecs: nonNegative('stepExtensionSecs', 1),
    overrunPromptMinSecs: nonNegative('overrunPromptMinSecs'),
    overrunPromptFraction: nonNegative('overrunPromptFraction'),
    overrunPromptGraceSecs: nonNegative('overrunPromptGraceSecs'),
    overrunStopOfferAfterExtensions: Math.floor(nonNegative('overrunStopOfferAfterExtensions', 1)),
    perMarkerAfterDelaySecs: obj.perMarkerAfterDelaySecs && typeof obj.perMarkerAfterDelaySecs === 'object' && !Array.isArray(obj.perMarkerAfterDelaySecs)
      ? Object.fromEntries(
          Object.entries(obj.perMarkerAfterDelaySecs as Record<string, unknown>)
            .filter(([, v]) => Number.isFinite(Number(v)) && Number(v) >= 0)
            .map(([k, v]) => [k, Number(v)])
        )
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Engine inputs
// ---------------------------------------------------------------------------

/**
 * Flattened chore representation the caller builds from InstantDB objects.
 * Keeps the engine decoupled from the DB schema.
 */
export interface CountdownChoreInput {
  id: string;
  title: string;
  /** Duration in seconds, or null if not set. */
  estimatedDurationSecs: number | null;
  /** XP weight — used as fallback duration (weight × 60s) when > 0. */
  weight: number | null;
  sortOrder: number | null;
  isJoint: boolean;
  /** Family member IDs assigned to this chore on the target date. */
  assigneeIds: string[];
  timingMode: string;
  timingConfig: unknown;
  /** Legacy time-bucket field (some chores store this separately). */
  timeBucket: string | null;
  /** ISO timestamp if the chore was completed today, else null. */
  completedAt: string | null;
  /** Per-member completion: memberId → ISO timestamp. */
  memberCompletions: Record<string, string>;
}

export interface CountdownEngineInput {
  chores: CountdownChoreInput[];
  routineMarkerStatuses: SharedRoutineMarkerStatusLike[];
  /** All chores as SharedChoreLike — needed for resolveChoreTimingForDate context. */
  allChoresRaw: import('./chores').SharedChoreLike[];
  countdownSettings: CountdownSettings;
  scheduleSettings: SharedScheduleSettings;
  now: Date;
  /** The family day being computed (UTC date, e.g. 2026-03-31T00:00:00Z). */
  date: Date;
}

// ---------------------------------------------------------------------------
// Engine outputs
// ---------------------------------------------------------------------------

export type CountdownSlotState =
  | 'upcoming'
  | 'active'
  | 'overdue_active'
  | 'completed';

export interface CountdownSlot {
  choreId: string;
  choreTitle: string;
  personId: string;
  /**
   * Absolute timestamp in ms when this slot's countdown starts.
   * This is the *effective* start time after the completion-driven chain
   * shift has been applied.
   */
  countdownStartMs: number;
  /**
   * Absolute timestamp in ms when this slot's countdown ends.
   * Effective end — already shifted by the chain walk if applicable.
   */
  countdownEndMs: number;
  /**
   * Static planned start time, before any completion-driven shift. Represents
   * "what time should this chore have started if everything ran exactly on
   * schedule".
   */
  targetStartMs: number;
  /**
   * Static planned end time. Subtract from countdownEndMs (plus live overdue
   * spill) to compute how far ahead/behind the overall countdown stack is.
   */
  targetEndMs: number;
  /** Duration of this slot in seconds. */
  durationSecs: number;
  state: CountdownSlotState;
  isJoint: boolean;
  /** All member IDs participating in a joint chore. */
  jointParticipantIds: string[];
  /** The effective deadline minute offset (family-day relative) this slot packs against. */
  deadlineOffset: number | null;
  /** Whether this is a deadline-driven or start-driven slot. */
  scheduleType: 'deadline' | 'start';
}

export interface CountdownWarning {
  personId: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface PersonCountdownTimeline {
  personId: string;
  slots: CountdownSlot[];
  warnings: CountdownWarning[];
}

export interface CountdownEngineOutput {
  /** Keyed by personId. */
  timelines: Record<string, PersonCountdownTimeline>;
}

// ---------------------------------------------------------------------------
// Internal intermediate types (exported for testing)
// ---------------------------------------------------------------------------

export interface ResolvedCountdownChore {
  input: CountdownChoreInput;
  /** Effective duration in seconds (from estimatedDurationSecs or weight fallback). */
  durationSecs: number;
  /** Timing mode resolved via getCanonicalTimingMode equivalent. */
  timingMode: SharedTimingMode;
  /** For deadline-driven: the family-day offset (minutes) of the deadline. */
  deadlineOffset: number | null;
  /** For start-driven: the family-day offset (minutes) of the start anchor. */
  startAnchorOffset: number | null;
  /** 'deadline' or 'start' driven scheduling. */
  scheduleType: 'deadline' | 'start';
}
