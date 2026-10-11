// @vitest-environment jsdom

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PeriodBreakdown from '@/components/allowance/PeriodBreakdown';
import type { UnitDefinition } from '@/lib/currency-utils';

const UNITS = [
    { id: 'usd', code: 'USD', symbol: '$', isMonetary: true },
    { id: 'stars', code: 'STARS', symbol: '⭐', isMonetary: false },
] as unknown as UnitDefinition[];

function makePeriod(overrides: Record<string, unknown> = {}) {
    return {
        totalWeight: 10,
        completedWeight: 7.5,
        percentage: 75,
        calculatedAmount: 7.5,
        fixedRewardsEarned: {},
        upForGrabsContributionPercentage: 0,
        ...overrides,
    };
}

function rows() {
    return within(screen.getByTestId('period-breakdown'))
        .getAllByRole('term')
        .map((term) => {
            const row = term.parentElement!;
            return [term.textContent, within(row).getByRole('definition').textContent];
        });
}

describe('PeriodBreakdown', () => {
    it('shows a plain period as its chore share and what it pays', () => {
        render(<PeriodBreakdown period={makePeriod()} currency="USD" unitDefinitions={UNITS} />);

        expect(rows()).toEqual([
            ['Chore share7.5 of 10 weight done · 75.0%', '$7.50'],
            ['This period pays', '$7.50'],
        ]);
    });

    it('separates fixed up-for-grabs rewards from the chore share and adds them up', () => {
        render(
            <PeriodBreakdown
                period={makePeriod({ fixedRewardsEarned: { USD: 2, STARS: 3 }, upForGrabsContributionPercentage: 10 })}
                currency="USD"
                unitDefinitions={UNITS}
            />,
        );

        expect(rows()).toEqual([
            ['Chore share7.5 of 10 weight done · 75.0%10.0% of that came from up-for-grabs chores', '$7.50'],
            ['Fixed rewardsUp-for-grabs chores, paid in full', '$2.00, 3 ⭐'],
            // The reward in the allowance currency joins the total; the stars are paid beside it.
            ['This period pays', '$9.50, 3 ⭐'],
        ]);
    });

    it('totals the edited amount and says what it was edited from', () => {
        render(
            <PeriodBreakdown period={makePeriod({ fixedRewardsEarned: { USD: 2 } })} currency="USD" unitDefinitions={UNITS} editedAmount={5} />,
        );

        const [choreShare, , total] = rows();
        expect(choreShare).toEqual(['Chore share7.5 of 10 weight done · 75.0%Edited from $7.50', '$5.00']);
        expect(total).toEqual(['This period pays', '$7.00']);
    });

    it('ignores an edit that matches the calculation, and zero-value rewards', () => {
        render(
            <PeriodBreakdown period={makePeriod({ fixedRewardsEarned: { STARS: 0 } })} currency="USD" unitDefinitions={UNITS} editedAmount={7.5} />,
        );

        expect(rows()).toEqual([
            ['Chore share7.5 of 10 weight done · 75.0%', '$7.50'],
            ['This period pays', '$7.50'],
        ]);
    });

    it('words a period that is still running as a running figure', () => {
        render(<PeriodBreakdown period={makePeriod()} currency="USD" unitDefinitions={UNITS} isInProgress />);
        expect(rows().at(-1)).toEqual(['Would pay so far', '$7.50']);
    });
});
