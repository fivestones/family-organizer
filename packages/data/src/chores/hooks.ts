import { getDataBackend } from '../backend';
import type { QueryResult, ReadOptions } from '../query-result';
import type { ChoreDay, Day } from './types';

/** Live. Every chore with its assignees, and what has been done about each on the given day. */
export function useChoreDay(day: Day, options?: ReadOptions): QueryResult<ChoreDay> {
    return getDataBackend().chores.useChoreDay(day, options);
}
