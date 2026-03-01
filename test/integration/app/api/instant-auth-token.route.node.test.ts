import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const tokenRouteMocks = vi.hoisted(() => ({
    isInstantFamilyAuthConfigured: vi.fn(),
    mintPrincipalToken: vi.fn(),
}));

vi.mock('@/lib/instant-admin', () => ({
    isInstantFamilyAuthConfigured: tokenRouteMocks.isInstantFamilyAuthConfigured,
    mintPrincipalToken: tokenRouteMocks.mintPrincipalToken,
}));

import { GET } from '@/app/api/instant-auth-token/route';

describe('GET /api/instant-auth-token', () => {
    beforeEach(() => {
        process.env.DEVICE_ACCESS_KEY = 'test-device-key';
        tokenRouteMocks.isInstantFamilyAuthConfigured.mockReturnValue(true);
        tokenRouteMocks.mintPrincipalToken.mockResolvedValue('kid-token');
    });

    it('rejects requests without a valid device cookie', async () => {
        const response = await GET(new NextRequest('http://localhost:3000/api/instant-auth-token'));
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized device' });
    });

    it('returns 503 when instant admin auth is not configured', async () => {
        tokenRouteMocks.isInstantFamilyAuthConfigured.mockReturnValue(false);

        const response = await GET(
            new NextRequest('http://localhost:3000/api/instant-auth-token', {
                headers: { cookie: 'family_device_auth=true' },
            })
        );

        expect(response.status).toBe(503);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({
            error: 'Instant family auth is not configured',
            code: 'family_token_auth_not_configured',
        });
    });

    it('mints and returns a kid principal token for authorized devices', async () => {
        const response = await GET(
            new NextRequest('http://localhost:3000/api/instant-auth-token', {
                headers: { cookie: 'family_device_auth=true' },
            })
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({
            token: 'kid-token',
            principalType: 'kid',
        });
        expect(tokenRouteMocks.mintPrincipalToken).toHaveBeenCalledWith('kid');
    });

    it('accepts a mobile bearer device session token', async () => {
        const { issueMobileDeviceSessionToken } = await import('@/lib/device-auth-server');
        const session = issueMobileDeviceSessionToken({ platform: 'ios', deviceName: 'Test iPhone' });

        const response = await GET(
            new NextRequest('http://localhost:3000/api/instant-auth-token', {
                headers: { authorization: `Bearer ${session.token}` },
            })
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            token: 'kid-token',
            principalType: 'kid',
        });
    });
});
