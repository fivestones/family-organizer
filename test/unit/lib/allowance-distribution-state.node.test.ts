import { describe, expect, it } from 'vitest';

import {
    addProcessedPeriodIds,
    buildPeriodPayoutAmounts,
    calculateEditableAllowanceTotal,
    excludeProcessedPeriods,
    getAllowanceAmountWarning,
} from '@/lib/allowance-distribution-state';

describe('allowance distribution local processed-period state', () => {
    it('keeps a stable union of successfully processed period ids', () => {
        const original = new Set(['period-1']);
        const result = addProcessedPeriodIds(original, ['period-2', 'period-1', '']);

        expect(Array.from(result).sort()).toEqual(['period-1', 'period-2']);
        expect(Array.from(original)).toEqual(['period-1']);
    });

    it('suppresses committed periods while a stale live-query snapshot catches up', () => {
        const periods = [{ id: 'paid' }, { id: 'still-pending' }];

        expect(excludeProcessedPeriods(periods, new Set(['paid']))).toEqual([{ id: 'still-pending' }]);
        expect(excludeProcessedPeriods(periods, new Set())).toBe(periods);
    });

    it('derives the displayed bulk total from the period values that will actually be submitted', () => {
        const periods = [
            { id: 'pending-a', status: 'pending', calculatedAmount: 10 },
            { id: 'pending-b', status: 'pending', calculatedAmount: 7 },
            { id: 'in-progress', status: 'in-progress', calculatedAmount: 100 },
        ];

        expect(calculateEditableAllowanceTotal(periods, { 'pending-a': '12.50', 'pending-b': '-2' }, 3)).toBe(13.5);
        expect(calculateEditableAllowanceTotal(periods, { 'pending-a': '', 'pending-b': 'invalid' }, 3)).toBe(13);
    });

    it('requires confirmation for direction changes, zero-baseline overrides, and tenfold increases', () => {
        expect(getAllowanceAmountWarning(45, -45)).toMatchObject({ kind: 'direction-change' });
        expect(getAllowanceAmountWarning(0, 5)).toMatchObject({ kind: 'zero-baseline' });
        expect(getAllowanceAmountWarning(45, 450)).toMatchObject({ kind: 'tenfold-increase', multiplier: 10 });
        expect(getAllowanceAmountWarning(45, 449.99)).toBeNull();
        expect(getAllowanceAmountWarning(45, 50)).toBeNull();
        expect(getAllowanceAmountWarning(45, 45.004)).toBeNull();
        expect(getAllowanceAmountWarning(Number.NaN, 50)).toBeNull();
    });
});

describe('allowance distribution period payout amounts', () => {
    it('pays a non-monetary up-for-grabs reward alongside the allowance', () => {
        // The reward appears in the calculation as { STARS: 3 }; a deposit must follow in that unit.
        expect(buildPeriodPayoutAmounts(12.5, { STARS: 3 }, 'USD')).toEqual({
            amount: 12.5,
            additionalAmountsByCurrency: { STARS: 3 },
        });
    });

    it('adds a reward in the allowance currency to the period total', () => {
        expect(buildPeriodPayoutAmounts(12.5, { USD: 2, STARS: 3, NPR: 500 }, 'usd')).toEqual({
            amount: 14.5,
            additionalAmountsByCurrency: { STARS: 3, NPR: 500 },
        });
    });

    it('still pays the other units when the allowance itself comes to nothing', () => {
        expect(buildPeriodPayoutAmounts(0, { STARS: 5 }, 'USD')).toEqual({
            amount: 0,
            additionalAmountsByCurrency: { STARS: 5 },
        });
    });

    it('merges units that differ only in case and drops zero rewards', () => {
        expect(buildPeriodPayoutAmounts(1, { stars: 2, STARS: 1, EUR: 0 }, 'USD')).toEqual({
            amount: 1,
            additionalAmountsByCurrency: { STARS: 3 },
        });
    });

    it('handles a period with no fixed rewards', () => {
        expect(buildPeriodPayoutAmounts(7, undefined, 'USD')).toEqual({ amount: 7, additionalAmountsByCurrency: {} });
        expect(buildPeriodPayoutAmounts(7, {}, 'USD')).toEqual({ amount: 7, additionalAmountsByCurrency: {} });
    });
});
