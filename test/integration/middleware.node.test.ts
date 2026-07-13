import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

// SHA-256('test-device-key')
const EXPECTED_TOKEN = 'dbf8307f327810a7080ea7a691ee058251dbc4b4eb030adce9d1a880cb07fcd6';
const VALID_COOKIE = `activation_token=${EXPECTED_TOKEN}`;

describe('middleware device auth gate', () => {
    beforeEach(() => {
        process.env.DEVICE_ACCESS_KEY = 'test-device-key';
        (process.env as any).NODE_ENV = 'test';
        delete process.env.DEVICE_AUTH_COOKIE_DOMAIN;
    });

    it('returns 401 JSON for unauthorized API requests', async () => {
        const response = await middleware(new NextRequest('http://localhost:3000/api/instant-auth-token'));
        expect(response.status).toBe(401);
        expect(await response.text()).toContain('Unauthorized Device');
    });

    it('returns hard 404 for unauthorized page requests', async () => {
        const response = await middleware(new NextRequest('http://localhost:3000/'));
        expect(response.status).toBe(404);
        expect(await response.text()).toBe('Not Found');
    });

    it('activates device auth via the magic link and sets the cookie', async () => {
        const response = await middleware(new NextRequest('http://localhost:3000/?activate=test-device-key'));
        expect(response.status).toBe(307);
        expect(response.headers.get('location')).toMatch(/\/$/);
        expect(response.headers.get('set-cookie')).toContain(VALID_COOKIE);
    });

    it('passes through when the device auth cookie is present', async () => {
        const response = await middleware(
            new NextRequest('http://localhost:3000/', {
                headers: { cookie: VALID_COOKIE },
            })
        );

        expect(response.headers.get('x-middleware-next')).toBe('1');
    });

    it('allows offline shell and manifest assets without device auth', async () => {
        const [manifestResponse, offlineResponse, activateResponse, deviceActivateApiResponse, mobileApiResponse, calendarSyncRunResponse] =
            await Promise.all([
                middleware(new NextRequest('http://localhost:3000/manifest.json')),
                middleware(new NextRequest('http://localhost:3000/offline.html')),
                middleware(new NextRequest('http://localhost:3000/activate')),
                middleware(new NextRequest('http://localhost:3000/api/device-activate')),
                middleware(new NextRequest('http://localhost:3000/api/mobile/device-activate')),
                middleware(new NextRequest('http://localhost:3000/api/calendar-sync/apple/run')),
            ]);

        expect(manifestResponse.headers.get('x-middleware-next')).toBe('1');
        expect(offlineResponse.headers.get('x-middleware-next')).toBe('1');
        expect(activateResponse.headers.get('x-middleware-next')).toBe('1');
        expect(deviceActivateApiResponse.headers.get('x-middleware-next')).toBe('1');
        expect(mobileApiResponse.headers.get('x-middleware-next')).toBe('1');
        expect(calendarSyncRunResponse.headers.get('x-middleware-next')).toBe('1');
    });

    it('blocks legacy upload and delete-image routes without device auth', async () => {
        const [uploadApiResponse, deleteImageApiResponse] = await Promise.all([
            middleware(new NextRequest('http://localhost:3000/api/upload')),
            middleware(new NextRequest('http://localhost:3000/api/delete-image')),
        ]);

        expect(uploadApiResponse.status).toBe(401);
        expect(await uploadApiResponse.text()).toContain('Unauthorized Device');
        expect(deleteImageApiResponse.status).toBe(401);
        expect(await deleteImageApiResponse.text()).toContain('Unauthorized Device');
    });

    it('sets a parent-domain cookie when deployed on a subdomain', async () => {
        const response = await middleware(
            new NextRequest('http://fam.domain.com/?activate=test-device-key', {
                headers: { host: 'fam.domain.com' },
            })
        );
        expect(response.status).toBe(307);
        const setCookie = response.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain(VALID_COOKIE);
        expect(setCookie).toContain('Domain=.domain.com');
    });

    it('does not set a domain attribute when deployed at a root domain', async () => {
        const response = await middleware(
            new NextRequest('http://family-organizer.com/?activate=test-device-key', {
                headers: { host: 'family-organizer.com' },
            })
        );
        expect(response.status).toBe(307);
        const setCookie = response.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain(VALID_COOKIE);
        expect(setCookie).not.toContain('Domain=');
    });

    it('does not set a domain attribute for LAN IP hosts', async () => {
        const response = await middleware(
            new NextRequest('http://192.168.1.20:3000/?activate=test-device-key', {
                headers: { host: '192.168.1.20:3000' },
            })
        );
        expect(response.status).toBe(307);
        const setCookie = response.headers.get('set-cookie') ?? '';
        expect(setCookie).toContain(VALID_COOKIE);
        expect(setCookie).not.toContain('Domain=');
    });
});
