import { describe, expect, it } from 'vitest';

import { buildMemberTotalBalances, normalizeEnvelopeBalances } from '@/lib/dashboard-utils';

describe('dashboard allowance balances', () => {
    it('normalizes only the canonical balances map', () => {
        expect(normalizeEnvelopeBalances({ balances: { usd: 2, PTS: 0, eur: -1 } })).toEqual({ USD: 2, EUR: -1 });
        expect(normalizeEnvelopeBalances({ amount: 999, currency: 'USD' } as any)).toEqual({});
    });

    it('excludes archived envelopes from member totals', () => {
        expect(
            buildMemberTotalBalances({
                id: 'member-1',
                name: 'Alex',
                allowanceEnvelopes: [
                    { balances: { USD: 4 } },
                    { balances: { USD: 100 }, archivedAt: '2026-07-15T12:00:00.000Z' },
                ],
            })
        ).toEqual({ USD: 4 });
    });
});
