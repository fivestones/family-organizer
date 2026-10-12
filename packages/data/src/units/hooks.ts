import { getDataBackend } from '../backend';
import type { QueryResult, ReadOptions } from '../query-result';
import type { UnitDefinition } from './types';

/** Live. Every currency and point unit the family has defined, ordered by code. */
export function useUnitDefinitions(options?: ReadOptions): QueryResult<UnitDefinition[]> {
    return getDataBackend().units.useUnitDefinitions(options);
}
