import React from 'react';
import { buildPeriodPayoutAmounts } from '@/lib/allowance-distribution-state';
import { formatBalances, type UnitDefinition } from '@/lib/currency-utils';

interface PeriodBreakdownProps {
    period: {
        totalWeight: number;
        completedWeight: number;
        percentage: number;
        calculatedAmount: number;
        fixedRewardsEarned?: Record<string, number> | null;
        upForGrabsContributionPercentage: number;
    };
    /** The member's allowance currency. */
    currency: string;
    unitDefinitions: UnitDefinition[];
    /** The chore share as typed into the period's amount box, when it has been edited. */
    editedAmount?: number | null;
    /** The period is still running, so the figures are what it would pay so far. */
    isInProgress?: boolean;
}

function formatWeight(value: number): string {
    return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * What one allowance period is made of, as a sum that reads top to bottom:
 * the share earned from weighted chores, the fixed rewards from up-for-grabs
 * chores, and what the two come to.
 */
export default function PeriodBreakdown({ period, currency, unitDefinitions, editedAmount, isInProgress = false }: PeriodBreakdownProps) {
    const format = (balances: Record<string, number>) => formatBalances(balances, unitDefinitions);
    const hasEdit = editedAmount != null && Number.isFinite(editedAmount) && Math.abs(editedAmount - period.calculatedAmount) >= 0.005;
    const choreShare = hasEdit ? editedAmount! : period.calculatedAmount;

    const fixedRewards = Object.fromEntries(Object.entries(period.fixedRewardsEarned || {}).filter(([, amount]) => amount !== 0));
    const hasFixedRewards = Object.keys(fixedRewards).length > 0;
    const { amount, additionalAmountsByCurrency } = buildPeriodPayoutAmounts(choreShare, fixedRewards, currency);

    const row = 'flex items-baseline justify-between gap-4';
    const note = 'block text-xs font-normal text-muted-foreground';
    const figure = 'shrink-0 text-right font-mono tabular-nums';

    return (
        <dl className="mt-2 space-y-2 text-sm" data-testid="period-breakdown">
            <div className={row}>
                <dt>
                    <span className="font-medium">Chore share</span>
                    <span className={note}>
                        {formatWeight(period.completedWeight)} of {formatWeight(period.totalWeight)} weight done ·{' '}
                        {period.percentage.toFixed(1)}%
                    </span>
                    {period.upForGrabsContributionPercentage > 0 && (
                        <span className={note}>
                            {period.upForGrabsContributionPercentage.toFixed(1)}% of that came from up-for-grabs chores
                        </span>
                    )}
                    {hasEdit && <span className={note}>Edited from {format({ [currency]: period.calculatedAmount })}</span>}
                </dt>
                <dd className={figure}>{format({ [currency]: choreShare })}</dd>
            </div>

            {hasFixedRewards && (
                <div className={row}>
                    <dt>
                        <span className="font-medium">Fixed rewards</span>
                        <span className={note}>Up-for-grabs chores, paid in full</span>
                    </dt>
                    <dd className={figure}>{format(fixedRewards)}</dd>
                </div>
            )}

            <div className={`${row} border-t pt-2 font-semibold`}>
                <dt>{isInProgress ? 'Would pay so far' : 'This period pays'}</dt>
                <dd className={figure}>{format({ [currency]: amount, ...additionalAmountsByCurrency })}</dd>
            </div>
        </dl>
    );
}
