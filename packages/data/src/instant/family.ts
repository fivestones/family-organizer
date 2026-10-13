import { useMemo } from 'react';
import type { FamilyBackend } from '../family/backend';
import type { FamilyMember, MemberPhotoUrls } from '../family/types';
import type { QueryResult, ReadOptions } from '../query-result';
import { toError, type InstantClient } from './client';

const ROSTER_QUERY = { familyMembers: { $: { order: { order: 'asc' } } } };
const EMPTY_ROWS: readonly any[] = [];

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const numeric = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const flag = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

/**
 * A calendar day, `YYYY-MM-DD`. Instant's date type hands back whatever was stored — a day, the instant that day
 * starts in UTC, or epoch milliseconds — and the app has always read the UTC day out of it.
 * Anything that is not a date becomes `null` rather than being passed off as one.
 */
function utcDay(value: unknown): string | null {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    if (value === '') return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function photoUrls(value: unknown): MemberPhotoUrls | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as MemberPhotoUrls) : null;
}

export function toFamilyMember(row: any): FamilyMember {
    return {
        id: row.id,
        name: row.name ?? '',
        // A member with no role recorded has always been treated as a child.
        role: row.role === 'parent' ? 'parent' : 'child',
        email: text(row.email),
        color: text(row.color),
        photoUrls: photoUrls(row.photoUrls),
        sortOrder: numeric(row.order) ?? 0,
        // Instant hides the hash from everyone but a parent and the member themselves. A hash that is visible
        // means a PIN is set; one that is not could be either, so this implementation says it does not know.
        hasPin: row.pinHash ? true : null,
        defaultEnvelopeId: null,
        allowanceAmount: numeric(row.allowanceAmount),
        allowanceCurrency: text(row.allowanceCurrency),
        allowanceRrule: text(row.allowanceRrule),
        allowanceStartDate: utcDay(row.allowanceStartDate),
        allowancePayoutDelayDays: numeric(row.allowancePayoutDelayDays) ?? 0,
        allowanceConfig: row.allowanceConfig && typeof row.allowanceConfig === 'object' ? row.allowanceConfig : null,
        lastDisplayCurrency: text(row.lastDisplayCurrency),
        viewShowChoreDescriptions: flag(row.viewShowChoreDescriptions),
        viewShowTaskDetails: flag(row.viewShowTaskDetails),
        messageQuietHoursEnabled: flag(row.messageQuietHoursEnabled),
        messageQuietHoursStart: text(row.messageQuietHoursStart),
        messageQuietHoursEnd: text(row.messageQuietHoursEnd),
        messageDigestMode: text(row.messageDigestMode),
        messageDigestWindowMinutes: numeric(row.messageDigestWindowMinutes),
    };
}

export function createInstantFamilyBackend({ db }: InstantClient): FamilyBackend {
    return {
        useFamilyMembers(options?: ReadOptions): QueryResult<FamilyMember[]> {
            const { data, isLoading, error } = db.useQuery(options?.enabled === false ? null : ROSTER_QUERY);
            const rows: readonly any[] = data?.familyMembers ?? EMPTY_ROWS;
            const members = useMemo(() => rows.map(toFamilyMember), [rows]);
            return { data: members, isLoading, error: toError(error) };
        },
    };
}
