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

export function calculateEditableAllowanceTotal(
    periods: Array<{ id: string; status?: string; calculatedAmount: number }>,
    editablePeriodAmounts: Readonly<Record<string, string>>,
    fixedRewardsInPrimaryCurrency: number
): number {
    const editablePeriodTotal = periods
        .filter((period) => period.status === 'pending')
        .reduce((sum, period) => {
            const rawValue = editablePeriodAmounts[period.id];
            const amount = rawValue == null || rawValue.trim() === '' ? period.calculatedAmount : Number(rawValue);
            return sum + (Number.isFinite(amount) ? amount : 0);
        }, 0);

    return editablePeriodTotal + fixedRewardsInPrimaryCurrency;
}
