import { getDataBackend } from '../backend';
import type { QueryResult, ReadOptions } from '../query-result';
import type { Refusal } from './types';

/** Live. Changes the server refused that have not been dismissed: the signed-in person's, and for a parent everyone's. */
export function useRefusals(options?: ReadOptions): QueryResult<readonly Refusal[]> {
    return getDataBackend().sync.useRefusals(options);
}
