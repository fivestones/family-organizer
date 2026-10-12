import type { QueryResult, ReadOptions } from '../query-result';
import type { ChoreCompletionInput, ChoreCompletionResult, ChoreDay, Day } from './types';

/** What an implementation must provide for chores. */
export interface ChoresBackend {
    /** Live. Every chore with its assignees, and the completions recorded for the one day. */
    useChoreDay(day: Day, options?: ReadOptions): QueryResult<ChoreDay>;
    /** Marks a chore done for someone on a day, with its history entry. */
    completeChore(input: ChoreCompletionInput): Promise<ChoreCompletionResult>;
    /** Un-ticks a chore that was marked done, with its history entry. */
    reopenChore(input: ChoreCompletionInput): Promise<ChoreCompletionResult>;
}
