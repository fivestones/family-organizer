import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getCachedMemberToken: vi.fn(),
}));

vi.mock('@/lib/instant-principal-storage', () => ({
    getCachedMemberToken: mocks.getCachedMemberToken,
}));

import { requestFinanceMutation } from '@/lib/finance-mutation-client';

describe('finance mutation client', () => {
    beforeEach(() => {
        mocks.getCachedMemberToken.mockReset();
        mocks.getCachedMemberToken.mockReturnValue('member-token');
        vi.unstubAllGlobals();
    });

    it('posts the mutation with the active Instant token', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ result: 'new-envelope' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        await expect(requestFinanceMutation<string>({ operation: 'create-initial', familyMemberId: 'member-1' })).resolves.toBe('new-envelope');
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/finance/mutations',
            expect.objectContaining({
                method: 'POST',
                credentials: 'same-origin',
                headers: expect.objectContaining({ 'x-instant-auth-token': 'member-token' }),
                body: JSON.stringify({ operation: 'create-initial', familyMemberId: 'member-1' }),
            })
        );
    });

    it('requires a token and surfaces server errors', async () => {
        mocks.getCachedMemberToken.mockReturnValue(null);
        await expect(requestFinanceMutation({ operation: 'deposit', envelopeId: 'env-1', amount: 1, currency: 'USD' })).rejects.toThrow(
            'Family member auth is required'
        );

        mocks.getCachedMemberToken.mockReturnValue('member-token');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Insufficient USD funds.' }), { status: 409 })));
        await expect(requestFinanceMutation({ operation: 'withdraw', envelopeId: 'env-1', amount: 10, currency: 'USD' })).rejects.toThrow(
            'Insufficient USD funds.'
        );
    });
});
