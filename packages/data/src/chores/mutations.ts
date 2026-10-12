import { getDataBackend } from '../backend';
import type { ChoreCompletionInput, ChoreCompletionResult } from './types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// The app's TypeScript is loose in places and the phone's screens are JavaScript, so what a mutation is handed is
// checked here, when it is called, and not left to the types.
function checked(input: ChoreCompletionInput): ChoreCompletionInput {
    if (!input || typeof input.choreId !== 'string' || !input.choreId) throw new TypeError('A chore completion needs the chore it is for.');
    if (typeof input.memberId !== 'string' || !input.memberId) throw new TypeError('A chore completion needs the person it belongs to.');
    if (typeof input.day !== 'string' || !DAY.test(input.day)) throw new TypeError('A chore completion needs the day it is due, as YYYY-MM-DD.');
    return { choreId: input.choreId, memberId: input.memberId, day: input.day, markedBy: input.markedBy || null };
}

/**
 * Marks a chore done for someone on a day. Resolves once it is saved on this device; the server hears of it when
 * it can. Where the chore is up for grabs and someone else has already done it, nothing is written and the
 * result says who.
 */
export function completeChore(input: ChoreCompletionInput): Promise<ChoreCompletionResult> {
    return getDataBackend().chores.completeChore(checked(input));
}

/** Un-ticks a chore someone had marked done. */
export function reopenChore(input: ChoreCompletionInput): Promise<ChoreCompletionResult> {
    return getDataBackend().chores.reopenChore(checked(input));
}
