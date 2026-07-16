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

export type AllowanceAmountWarning = {
    kind: 'direction-change' | 'zero-baseline' | 'tenfold-increase';
    calculatedAmount: number;
    editedAmount: number;
    multiplier: number | null;
};

export function getAllowanceAmountWarning(calculatedAmount: number, editedAmount: number): AllowanceAmountWarning | null {
    if (!Number.isFinite(calculatedAmount) || !Number.isFinite(editedAmount)) return null;
    if (Math.abs(calculatedAmount - editedAmount) < 0.005) return null;

    if (calculatedAmount !== 0 && editedAmount !== 0 && Math.sign(calculatedAmount) !== Math.sign(editedAmount)) {
        return { kind: 'direction-change', calculatedAmount, editedAmount, multiplier: null };
    }

    const calculatedMagnitude = Math.abs(calculatedAmount);
    const editedMagnitude = Math.abs(editedAmount);
    if (calculatedMagnitude === 0 && editedMagnitude > 0) {
        return { kind: 'zero-baseline', calculatedAmount, editedAmount, multiplier: null };
    }

    const multiplier = editedMagnitude / calculatedMagnitude;
    if (multiplier >= 10) {
        return { kind: 'tenfold-increase', calculatedAmount, editedAmount, multiplier };
    }

    return null;
}
