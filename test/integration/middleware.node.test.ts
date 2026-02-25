import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

describe('middleware device auth gate', () => {
    beforeEach(() => {
        process.env.DEVICE_ACCESS_KEY = 'test-device-key';
        process.env.NODE_ENV = 'test';
    });

    it('returns 401 JSON for unauthorized API requests', async () => {
        const response = middleware(new NextRequest('http://localhost:3000/api/instant-auth-token'));
        expect(response.status).toBe(401);
        expect(await response.text()).toContain('Unauthorized Device');
    });

    it('returns hard 404 for unauthorized page requests', async () => {
        const response = middleware(new NextRequest('http://localhost:3000/'));
        expect(response.status).toBe(404);
        expect(await response.text()).toBe('Not Found');
    });

    it('activates device auth via the magic link and sets the cookie', () => {
        const response = middleware(new NextRequest('http://localhost:3000/?activate=test-device-key'));
        expect(response.status).toBe(307);
        expect(response.headers.get('location')).toMatch(/\/$/);
        expect(response.headers.get('set-cookie')).toContain('family_device_auth=true');
    });

    it('passes through when the device auth cookie is present', () => {
        const response = middleware(
            new NextRequest('http://localhost:3000/', {
                headers: { cookie: 'family_device_auth=true' },
            })
        );

        expect(response.headers.get('x-middleware-next')).toBe('1');
    });

    it('allows offline shell and manifest assets without device auth', () => {
        const manifestResponse = middleware(new NextRequest('http://localhost:3000/manifest.json'));
        const offlineResponse = middleware(new NextRequest('http://localhost:3000/offline.html'));
        const activateResponse = middleware(new NextRequest('http://localhost:3000/activate'));
        const deviceActivateApiResponse = middleware(new NextRequest('http://localhost:3000/api/device-activate'));

        expect(manifestResponse.headers.get('x-middleware-next')).toBe('1');
        expect(offlineResponse.headers.get('x-middleware-next')).toBe('1');
        expect(activateResponse.headers.get('x-middleware-next')).toBe('1');
        expect(deviceActivateApiResponse.headers.get('x-middleware-next')).toBe('1');
    });
});
