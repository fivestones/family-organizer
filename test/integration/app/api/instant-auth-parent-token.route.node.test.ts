import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const parentRouteMocks = vi.hoisted(() => ({
    getFamilyMemberById: vi.fn(),
    hashPinServer: vi.fn(),
    isInstantFamilyAuthConfigured: vi.fn(),
    mintPrincipalToken: vi.fn(),
}));

vi.mock('@/lib/instant-admin', () => ({
    getFamilyMemberById: parentRouteMocks.getFamilyMemberById,
    hashPinServer: parentRouteMocks.hashPinServer,
    isInstantFamilyAuthConfigured: parentRouteMocks.isInstantFamilyAuthConfigured,
    mintPrincipalToken: parentRouteMocks.mintPrincipalToken,
}));

import { POST } from '@/app/api/instant-auth-parent-token/route';

describe('POST /api/instant-auth-parent-token', () => {
    beforeEach(() => {
        parentRouteMocks.isInstantFamilyAuthConfigured.mockReturnValue(true);
        parentRouteMocks.getFamilyMemberById.mockResolvedValue(null);
        parentRouteMocks.hashPinServer.mockReturnValue('hashed-pin');
        parentRouteMocks.mintPrincipalToken.mockResolvedValue('parent-token');
    });

    function makeRequest(body: unknown, cookie = true) {
        return new NextRequest('http://localhost:3000/api/instant-auth-parent-token', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(cookie ? { cookie: 'family_device_auth=true' } : {}),
            },
            body: JSON.stringify(body),
        });
    }

    it('rejects unauthorized devices', async () => {
        const response = await POST(makeRequest({ familyMemberId: 'p1', pin: '1234' }, false));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized device' });
    });

    it('rejects missing familyMemberId', async () => {
        const response = await POST(makeRequest({ pin: '1234' }));
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: 'familyMemberId is required' });
    });

    it('rejects non-parent family members', async () => {
        parentRouteMocks.getFamilyMemberById.mockResolvedValue({ id: 'child-1', role: 'child' });

        const response = await POST(makeRequest({ familyMemberId: 'child-1', pin: '1234' }));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Selected member is not a parent' });
    });

    it('rejects incorrect parent PINs', async () => {
        parentRouteMocks.getFamilyMemberById.mockResolvedValue({
            id: 'parent-1',
            role: 'parent',
            pinHash: 'expected-hash',
        });
        parentRouteMocks.hashPinServer.mockReturnValue('different-hash');

        const response = await POST(makeRequest({ familyMemberId: 'parent-1', pin: '1234' }));
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Incorrect PIN' });
    });

    it('returns a parent principal token after successful verification', async () => {
        parentRouteMocks.getFamilyMemberById.mockResolvedValue({
            id: 'parent-1',
            role: 'parent',
            pinHash: 'expected-hash',
        });
        parentRouteMocks.hashPinServer.mockReturnValue('expected-hash');

        const response = await POST(makeRequest({ familyMemberId: 'parent-1', pin: '1234' }));

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({
            token: 'parent-token',
            principalType: 'parent',
        });
        expect(parentRouteMocks.mintPrincipalToken).toHaveBeenCalledWith('parent');
    });
});
