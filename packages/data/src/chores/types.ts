/** A calendar day, `YYYY-MM-DD`. */
export type Day = string;
/** A time of day, `HH:MM`. */
export type TimeOfDay = string;

/** Which moment of a routine marker or another chore a chore is timed against. */
export type AnchorEvent = 'started' | 'completed';

/**
 * When in the day a chore is due. Each way of saying so carries only what it needs: a chore due before a time has
 * a time, and one due after another chore names that chore.
 */
export type ChoreTiming =
    | { mode: 'anytime' }
    /** In one of the household's named windows, such as the morning. */
    | { mode: 'named_window'; windowKey: string | null }
    | { mode: 'before_time' | 'after_time'; time: TimeOfDay | null }
    | { mode: 'between_times'; startTime: TimeOfDay | null; endTime: TimeOfDay | null }
    /** Before or after a routine marker, such as dinner. `fallbackTime` stands in until the marker has happened. */
    | { mode: 'before_marker' | 'after_marker'; markerKey: string | null; event: AnchorEvent; fallbackTime: TimeOfDay | null }
    /** Before or after another chore. `choreId` is `null` once that chore has been deleted. */
    | { mode: 'before_chore' | 'after_chore'; choreId: string | null; event: AnchorEvent; fallbackTime: TimeOfDay | null };

export type RotationType = 'none' | 'daily' | 'weekly' | 'monthly';

export interface Chore {
    id: string;
    title: string;
    description: string | null;
    /** The first day it is due. */
    startDate: Day;
    /** An RFC 5545 recurrence rule. `null` means once, on `startDate`. */
    rrule: string | null;
    /** Days the rule would give that are skipped. */
    exdates: readonly Day[];
    /** A pause in progress, with what is needed to undo it. */
    pauseState: Record<string, unknown> | null;
    rotationType: RotationType;
    /** Done together: everyone assigned completes it for themselves. */
    isJoint: boolean;
    /** Whoever does it first has done it for everyone. */
    isUpForGrabs: boolean;
    /** Folded into its routine's row in the day list. */
    hideFromDayList: boolean;
    sortOrder: number;
    weight: number | null;
    rewardType: 'fixed' | 'weight' | null;
    rewardAmount: number | null;
    rewardCurrency: string | null;
    estimatedDurationSecs: number | null;
    timing: ChoreTiming;
    /** ISO 8601. */
    createdAt: string;
    /** Who it is assigned to, in the order of its rotation where it rotates. */
    assigneeIds: readonly string[];
}

/**
 * What one person did about one chore on one day it was due. It is done when `completedAt` is set, marked as not
 * done when `notDone` is, and otherwise cleared: ticked and un-ticked again.
 */
export interface ChoreCompletion {
    id: string;
    choreId: string;
    completedBy: string;
    /** Who pressed the button, when that was someone else. */
    markedBy: string | null;
    dateDue: Day;
    /** ISO 8601, or `null` when the chore is not done. */
    completedAt: string | null;
    notDone: boolean;
    allowanceAwarded: boolean;
}

/** Every chore, with what has been done about each on one day. Which of them fall due that day is `shared-core`'s to say. */
export interface ChoreDay {
    day: Day;
    chores: readonly Chore[];
    completions: readonly ChoreCompletion[];
}

export interface ChoreCompletionInput {
    choreId: string;
    /** Who the completion belongs to. */
    memberId: string;
    /** The family day the chore is due on. */
    day: Day;
    /** Who is making the change, when that is someone else: a parent ticking a kid's chore. */
    markedBy?: string | null;
}

export type ChoreCompletionResult =
    | { status: 'completed' | 'reopened'; completionId: string }
    /** It was already as asked. */
    | { status: 'unchanged' }
    /** Up for grabs, and someone else has already done it today. */
    | { status: 'claimed'; claimedBy: string };
