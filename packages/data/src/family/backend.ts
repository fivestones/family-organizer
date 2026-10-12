import type { QueryResult, ReadOptions } from '../query-result';
import type { FamilyMember } from './types';

/** What an implementation must provide for the family roster. */
export interface FamilyBackend {
    /** Live. Everyone in the family, in the family's own order. The array keeps its identity until a member changes. */
    useFamilyMembers(options?: ReadOptions): QueryResult<FamilyMember[]>;
}
