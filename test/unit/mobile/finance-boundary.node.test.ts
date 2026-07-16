import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    getActiveMemberPrincipalToken: vi.fn(),
    getDeviceSessionToken: vi.fn(),
    getParentPrincipalToken: vi.fn(),
    getServerUrl: vi.fn(),
}));

vi.mock('@/mobile/src/lib/device-session-store', () => ({
    getActiveMemberPrincipalToken: mocks.getActiveMemberPrincipalToken,
    getDeviceSessionToken: mocks.getDeviceSessionToken,
    getParentPrincipalToken: mocks.getParentPrincipalToken,
}));

vi.mock('@/mobile/src/lib/server-url', () => ({
    getServerUrl: mocks.getServerUrl,
}));

import { runFinanceMutation } from '@/mobile/src/lib/api-client';

describe('mobile finance mutation boundary', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.getServerUrl.mockReturnValue('https://family.example');
        mocks.getDeviceSessionToken.mockResolvedValue('device-token');
        mocks.getActiveMemberPrincipalToken.mockResolvedValue('member-token');
        mocks.getParentPrincipalToken.mockResolvedValue(null);
    });

    it('sends native finance changes through the authenticated server route', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(JSON.stringify({ result: 'envelope-id' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })
        );
        const request = { operation: 'transfer', sourceEnvelopeId: 'a', destinationEnvelopeId: 'b', amount: 2, currency: 'USD' };

        await expect(runFinanceMutation(request)).resolves.toBe('envelope-id');
        expect(fetchMock).toHaveBeenCalledWith('https://family.example/api/finance/mutations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer device-token',
                'X-Instant-Auth-Token': 'member-token',
            },
            body: JSON.stringify(request),
        });
    });

    it('keeps the native screen off direct Instant finance writes', () => {
        const source = readFileSync(new URL('../../../mobile/app/(tabs)/finance.js', import.meta.url), 'utf8');

        expect(source).toContain("import { runFinanceMutation } from '../../src/lib/api-client';");
        expect(source).not.toContain('db.transact(');
        expect(source).not.toContain('tx.allowanceEnvelopes');
        expect(source).toContain("return kind === 'add-envelope' || kind === 'transfer';");
        expect(source).toContain("return kind === 'deposit' || kind === 'withdraw' || kind === 'delete-envelope';");
    });
});
