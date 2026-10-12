import { useMemo } from 'react';
import { getDataBackend } from '../backend';
import type { QueryResult, ReadOptions } from '../query-result';
import type { FamilyMember } from './types';

/** Live. Everyone in the family, in the family's own order. */
export function useFamilyMembers(options?: ReadOptions): QueryResult<FamilyMember[]> {
    return getDataBackend().family.useFamilyMembers(options);
}

/** Live. One member of the family, or `null` when there is no such member or no id was given. */
export function useFamilyMember(memberId: string | null | undefined, options?: ReadOptions): QueryResult<FamilyMember | null> {
    const roster = useFamilyMembers(options);
    const member = useMemo(() => (memberId ? roster.data.find((entry) => entry.id === memberId) ?? null : null), [roster.data, memberId]);
    return { data: member, isLoading: roster.isLoading, error: roster.error };
}
