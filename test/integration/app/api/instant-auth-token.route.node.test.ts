import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const tokenRouteMocks = vi.hoisted(() => ({
    getFamilyMemberById: vi.fn(),
    isInstantFamilyAuthConfigured: vi.fn(),
    mintFamilyMemberToken: vi.fn(),
    verifyFamilyMemberCredentials: vi.fn(),
}));
const rateLimitMocks = vi.hoisted(() => ({
    check: vi.fn(),
    clear: vi.fn(),
    getKey: vi.fn(),
    recordFailure: vi.fn(),
}));

vi.mock('@/lib/instant-admin', () => ({
    getFamilyMemberById: tokenRouteMocks.getFamilyMemberById,
    isInstantFamilyAuthConfigured: tokenRouteMocks.isInstantFamilyAuthConfigured,
    mintFamilyMemberToken: tokenRouteMocks.mintFamilyMemberToken,
    verifyFamilyMemberCredentials: tokenRouteMocks.verifyFamilyMemberCredentials,
}));

vi.mock('@/lib/parent-elevation-rate-limit', () => ({
    checkParentElevationRateLimit: rateLimitMocks.check,
    clearParentElevationRateLimit: rateLimitMocks.clear,
    getParentElevationRateLimitKey: rateLimitMocks.getKey,
    recordParentElevationFailure: rateLimitMocks.recordFailure,
}));

import { POST } from '@/app/api/instant-auth-token/route';

describe('POST /api/instant-auth-token', () => {
    beforeEach(() => {
        process.env.DEVICE_ACCESS_KEY = 'test-device-key';
        tokenRouteMocks.isInstantFamilyAuthConfigured.mockReturnValue(true);
        tokenRouteMocks.getFamilyMemberById.mockResolvedValue({
            id: 'child-1',
            name: 'Ava',
            role: 'child',
        });
        tokenRouteMocks.verifyFamilyMemberCredentials.mockResolvedValue(undefined);
        tokenRouteMocks.mintFamilyMemberToken.mockResolvedValue({
            token: 'member-token',
            principalType: 'kid',
            member: {
                id: 'child-1',
                role: 'child',
            },
        });
        rateLimitMocks.check.mockReset().mockReturnValue({ allowed: true });
        rateLimitMocks.clear.mockReset();
        rateLimitMocks.getKey.mockReset().mockReturnValue('parent-rate-key');
        rateLimitMocks.recordFailure.mockReset();
    });

    it('rejects requests without a valid device cookie', async () => {
        const response = await POST(
            new NextRequest('http://localhost:3000/api/instant-auth-token', {
                method: 'POST',
                body: JSON.stringify({ familyMemberId: 'child-1', pin: '' }),
            })
        );
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized device', reason: 'missing' });
    });

    it('returns 503 when instant admin auth is not configured', async () => {
        tokenRouteMocks.isInstantFamilyAuthConfigured.mockReturnValue(false);
        const response = await POST(
            new NextRequest('http://localhost:3000/api/instant-auth-token', {
                method: 'POST',
                headers: { cookie: 'activation_token=dbf8307f327810a7080ea7a691ee058251dbc4b4eb030adce9d1a880cb07fcd6' },
                body: JSON.stringify({ familyMemberId: 'child-1', pin: '' }),
            })
        );

        expect(response.status).toBe(503);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({
            error: 'Instant family auth is not configured',
            code: 'family_token_auth_not_configured',
        });
    });

    it('mints and returns a family-member auth token for authorized devices', async () => {
        const response = await POST(
            new NextRequest('http://localhost:3000/api/instant-auth-token', {
                method: 'POST',
                headers: { cookie: 'activation_token=dbf8307f327810a7080ea7a691ee058251dbc4b4eb030adce9d1a880cb07fcd6' },
                body: JSON.stringify({ familyMemberId: 'child-1', pin: '1234' }),
            })
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({
            token: 'member-token',
            principalType: 'kid',
            familyMemberId: 'child-1',
            familyMemberRole: 'child',
        });
        expect(tokenRouteMocks.verifyFamilyMemberCredentials).toHaveBeenCalledWith('child-1', '1234');
        expect(tokenRouteMocks.mintFamilyMemberToken).toHaveBeenCalledWith('child-1');
    });

    it('accepts a mobile bearer device session token', async () => {
        const { issueMobileDeviceSessionToken } = await import('@/lib/device-auth-server');
        const session = issueMobileDeviceSessionToken({ platform: 'ios', deviceName: 'Test iPhone' });

        const response = await POST(
            new NextRequest('http://localhost:3000/api/instant-auth-token', {
                method: 'POST',
                headers: { authorization: `Bearer ${session.token}` },
                body: JSON.stringify({ familyMemberId: 'child-1', pin: '' }),
            })
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            token: 'member-token',
            principalType: 'kid',
            familyMemberId: 'child-1',
            familyMemberRole: 'child',
        });
    });

    it('does not count a missing parent PIN as a brute-force failure', async () => {
        tokenRouteMocks.getFamilyMemberById.mockResolvedValue({ id: 'parent-1', name: 'Pat', role: 'parent' });
        tokenRouteMocks.verifyFamilyMemberCredentials.mockRejectedValue(new Error('PIN is required'));

        const response = await POST(
            new NextRequest('http://localhost:3000/api/instant-auth-token', {
                method: 'POST',
                headers: { cookie: 'activation_token=dbf8307f327810a7080ea7a691ee058251dbc4b4eb030adce9d1a880cb07fcd6' },
                body: JSON.stringify({ familyMemberId: 'parent-1', pin: '' }),
            })
        );

        expect(response.status).toBe(400);
        expect(rateLimitMocks.recordFailure).not.toHaveBeenCalled();
    });

    it('counts an incorrect parent PIN as a brute-force failure', async () => {
        tokenRouteMocks.getFamilyMemberById.mockResolvedValue({ id: 'parent-1', name: 'Pat', role: 'parent' });
        tokenRouteMocks.verifyFamilyMemberCredentials.mockRejectedValue(new Error('Incorrect PIN'));

        const response = await POST(
            new NextRequest('http://localhost:3000/api/instant-auth-token', {
                method: 'POST',
                headers: { cookie: 'activation_token=dbf8307f327810a7080ea7a691ee058251dbc4b4eb030adce9d1a880cb07fcd6' },
                body: JSON.stringify({ familyMemberId: 'parent-1', pin: '0000' }),
            })
        );

        expect(response.status).toBe(403);
        expect(rateLimitMocks.recordFailure).toHaveBeenCalledWith('parent-rate-key');
    });
});
