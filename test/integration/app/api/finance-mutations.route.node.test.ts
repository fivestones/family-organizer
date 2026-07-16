import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    requireRequestFamilyMember: vi.fn(),
    executeServerFinanceMutation: vi.fn(),
}));

vi.mock('@/lib/request-family-member', () => ({
    requireRequestFamilyMember: mocks.requireRequestFamilyMember,
}));

vi.mock('@/lib/finance-mutation-server', async () => {
    class FinanceMutationError extends Error {
        constructor(
            message: string,
            public readonly status = 400
        ) {
            super(message);
        }
    }
    return { executeServerFinanceMutation: mocks.executeServerFinanceMutation, FinanceMutationError };
});

import { POST } from '@/app/api/finance/mutations/route';

describe('POST /api/finance/mutations', () => {
    beforeEach(() => {
        mocks.requireRequestFamilyMember.mockReset();
        mocks.executeServerFinanceMutation.mockReset();
    });

    it('rejects requests before parsing when family auth fails', async () => {
        mocks.requireRequestFamilyMember.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized device' });
        const request = new NextRequest('http://localhost/api/finance/mutations', { method: 'POST', body: '{invalid-json' });

        const response = await POST(request);
        expect(response.status).toBe(401);
        expect(mocks.executeServerFinanceMutation).not.toHaveBeenCalled();
    });

    it('passes the authenticated actor and returns the mutation result', async () => {
        const actor = { ok: true, instantUser: { id: 'instant-parent' }, familyMember: { id: 'member-parent', role: 'parent' } };
        mocks.requireRequestFamilyMember.mockResolvedValue(actor);
        mocks.executeServerFinanceMutation.mockResolvedValue('created-envelope');
        const body = { operation: 'create-initial', familyMemberId: 'member-parent' };

        const response = await POST(
            new NextRequest('http://localhost/api/finance/mutations', { method: 'POST', body: JSON.stringify(body) })
        );
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ result: 'created-envelope' });
        expect(mocks.executeServerFinanceMutation).toHaveBeenCalledWith(body, actor);
    });

    it('preserves typed finance error status codes', async () => {
        const { FinanceMutationError } = await import('@/lib/finance-mutation-server');
        mocks.requireRequestFamilyMember.mockResolvedValue({
            ok: true,
            instantUser: { id: 'instant-kid' },
            familyMember: { id: 'member-kid', role: 'child' },
        });
        mocks.executeServerFinanceMutation.mockRejectedValue(new FinanceMutationError('You can only change your own envelopes.', 403));

        const response = await POST(
            new NextRequest('http://localhost/api/finance/mutations', {
                method: 'POST',
                body: JSON.stringify({ operation: 'deposit', envelopeId: 'env-other', amount: 1, currency: 'USD' }),
            })
        );
        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toEqual({ error: 'You can only change your own envelopes.' });
    });
});
