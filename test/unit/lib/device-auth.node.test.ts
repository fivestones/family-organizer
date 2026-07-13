import { afterEach, describe, expect, it } from 'vitest';
import { DEVICE_AUTH_COOKIE_NAME, sha256hex, getParentDomain, getDeviceAuthCookieOptions } from '@/lib/device-auth';

describe('device auth helpers', () => {
    afterEach(() => {
        delete process.env.DEVICE_AUTH_COOKIE_DOMAIN;
    });

    it('exports stable cookie name', () => {
        expect(DEVICE_AUTH_COOKIE_NAME).toBe('activation_token');
    });

    it('sha256hex returns the correct hash', async () => {
        // SHA-256('test-device-key') = dbf8307f327810a7080ea7a691ee058251dbc4b4eb030adce9d1a880cb07fcd6
        const hash = await sha256hex('test-device-key');
        expect(hash).toBe('dbf8307f327810a7080ea7a691ee058251dbc4b4eb030adce9d1a880cb07fcd6');
        expect(hash).toHaveLength(64);
    });

    describe('getParentDomain', () => {
        it('returns the dot-prefixed parent domain for subdomain deployments', () => {
            expect(getParentDomain('fam.domain.com')).toBe('.domain.com');
            expect(getParentDomain('app.example.co')).toBe('.example.co');
            expect(getParentDomain('sub.app.domain.com')).toBe('.domain.com');
        });

        it('returns undefined for root-domain deployments', () => {
            expect(getParentDomain('family-organizer.com')).toBeUndefined();
            expect(getParentDomain('example.com')).toBeUndefined();
        });

        it('returns undefined for localhost', () => {
            expect(getParentDomain('localhost')).toBeUndefined();
            expect(getParentDomain('localhost:3000')).toBeUndefined();
            expect(getParentDomain('app.localhost:3000')).toBeUndefined();
        });

        it('returns undefined for IPv4 and IPv6 hosts', () => {
            expect(getParentDomain('192.168.1.20')).toBeUndefined();
            expect(getParentDomain('192.168.1.20:3000')).toBeUndefined();
            expect(getParentDomain('[2001:db8::1]:3000')).toBeUndefined();
            expect(getParentDomain('2001:db8::1')).toBeUndefined();
        });

        it('does not mistake a common multi-part public suffix for a parent domain', () => {
            expect(getParentDomain('family.example.co.uk')).toBe('.example.co.uk');
            expect(getParentDomain('example.co.uk')).toBeUndefined();
        });
    });

    describe('getDeviceAuthCookieOptions', () => {
        it('includes domain when on a subdomain', () => {
            const opts = getDeviceAuthCookieOptions('fam.domain.com');
            expect(opts.domain).toBe('.domain.com');
            expect(opts.sameSite).toBe('lax');
            expect(opts.httpOnly).toBe(true);
        });

        it('omits domain when on a root domain or localhost', () => {
            const opts = getDeviceAuthCookieOptions('family-organizer.com');
            expect(opts).not.toHaveProperty('domain');

            const optsLocal = getDeviceAuthCookieOptions('localhost:3000');
            expect(optsLocal).not.toHaveProperty('domain');
        });

        it('prefers an explicit cookie domain for sibling-subdomain SSO', () => {
            process.env.DEVICE_AUTH_COOKIE_DOMAIN = 'family.example.co.uk';
            const opts = getDeviceAuthCookieOptions('192.168.1.20:3000');
            expect(opts.domain).toBe('.family.example.co.uk');
        });
    });
});
