// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    clientDb: { __useServerFinanceBoundary: true },
    requestFinanceMutation: vi.fn(),
}));

vi.mock('@/lib/finance-mutation-client', () => ({ requestFinanceMutation: mocks.requestFinanceMutation }));
vi.mock('@instantdb/core', () => ({ tx: {}, id: vi.fn() }));

import { createAdditionalEnvelope, depositToSpecificEnvelope, transferFunds, withdrawFromEnvelope } from '@/lib/currency-utils';

describe('currency utility server mutation boundary', () => {
    beforeEach(() => {
        mocks.requestFinanceMutation.mockReset();
        mocks.requestFinanceMutation.mockResolvedValue(null);
    });

    it('routes browser money operations without transacting stale client balances', async () => {
        const source = { id: 'env-source', name: 'Source', balances: { USD: 10 } } as any;
        const destination = { id: 'env-destination', name: 'Destination', balances: {} } as any;

        await depositToSpecificEnvelope(mocks.clientDb as any, source.id, source.balances, 2, 'USD', 'Deposit');
        await withdrawFromEnvelope(mocks.clientDb as any, source, 1, 'USD', 'Cash');
        await transferFunds(mocks.clientDb as any, source, destination, 3, 'USD');

        expect(mocks.requestFinanceMutation.mock.calls.map(([request]) => request.operation)).toEqual(['deposit', 'withdraw', 'transfer']);
    });

    it('returns the server-created envelope id', async () => {
        mocks.requestFinanceMutation.mockResolvedValue('server-envelope-id');

        await expect(createAdditionalEnvelope(mocks.clientDb as any, 'member-1', 'Savings', false)).resolves.toBe('server-envelope-id');
        expect(mocks.requestFinanceMutation).toHaveBeenCalledWith(
            expect.objectContaining({ operation: 'create-envelope', familyMemberId: 'member-1', name: 'Savings' })
        );
    });
});
