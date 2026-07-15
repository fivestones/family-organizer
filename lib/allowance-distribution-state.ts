export function addProcessedPeriodIds(current: ReadonlySet<string>, periodIds: readonly string[]): ReadonlySet<string> {
    const next = new Set(current);
    for (const periodId of periodIds) {
        if (periodId) next.add(periodId);
    }
    return next;
}

export function excludeProcessedPeriods<T extends { id: string }>(periods: T[], processedPeriodIds: ReadonlySet<string>): T[] {
    if (processedPeriodIds.size === 0) return periods;
    return periods.filter((period) => !processedPeriodIds.has(period.id));
}
