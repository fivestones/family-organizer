export type ArchivableAllowanceEnvelope = {
    archivedAt?: string | null;
};

export const activeAllowanceEnvelopesQuery = {
    $: { where: { archivedAt: { $isNull: true } } },
} as const;

export function isActiveAllowanceEnvelope(envelope: object | null | undefined): boolean {
    return Boolean(envelope && !(envelope as ArchivableAllowanceEnvelope).archivedAt);
}

export function filterActiveAllowanceEnvelopes<T extends object>(envelopes: readonly T[] | null | undefined): T[] {
    return (envelopes || []).filter(isActiveAllowanceEnvelope) as T[];
}
