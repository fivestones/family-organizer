// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PendingAllowancePolicyNotice } from '@/components/allowance/PendingAllowancePolicyNotice';

describe('PendingAllowancePolicyNotice', () => {
    it('explains recalculation before payout and immutability after payout', () => {
        render(<PendingAllowancePolicyNotice />);

        const notice = screen.getByRole('note');
        expect(notice).toHaveTextContent('Pending periods use the current chore schedule');
        expect(notice).toHaveTextContent(/weights, rotations, assignments, or excluded dates can recalculate/i);
        expect(notice).toHaveTextContent(/once distributed, its ledger entries are fixed/i);
    });
});
