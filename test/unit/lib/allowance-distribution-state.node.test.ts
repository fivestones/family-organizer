import { describe, expect, it } from 'vitest';

import { addProcessedPeriodIds, calculateEditableAllowanceTotal, excludeProcessedPeriods } from '@/lib/allowance-distribution-state';

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
});
