import { describe, expect, it } from 'vitest';

describe('apple caldav sync discovery policy', () => {
    it('reuses fresh cached calendar metadata during hot polling', async () => {
        const { shouldRefreshAppleCalendarDiscovery } = await import('@/lib/apple-caldav/sync');
        const decision = shouldRefreshAppleCalendarDiscovery({
            account: {
                appleCalendarHomeUrl: 'https://caldav.icloud.com/12345/calendars/',
            },
            calendars: [{
                remoteCalendarId: 'home',
                remoteUrl: 'https://caldav.icloud.com/12345/calendars/home/',
                isEnabled: true,
                lastSeenAt: '2026-03-10T08:00:00.000Z',
            }],
            now: new Date('2026-03-10T12:00:00.000Z'),
            discoveryRefreshMs: 12 * 60 * 60 * 1000,
        });

        expect(decision).toEqual({ refresh: false, reason: 'fresh_cached_discovery' });
    });

    it('refreshes discovery when cached metadata is stale', async () => {
        const { shouldRefreshAppleCalendarDiscovery } = await import('@/lib/apple-caldav/sync');
        const decision = shouldRefreshAppleCalendarDiscovery({
            account: {
                appleCalendarHomeUrl: 'https://caldav.icloud.com/12345/calendars/',
            },
            calendars: [{
                remoteCalendarId: 'home',
                remoteUrl: 'https://caldav.icloud.com/12345/calendars/home/',
                isEnabled: true,
                lastSeenAt: '2026-03-09T00:00:00.000Z',
            }],
            now: new Date('2026-03-10T12:00:00.000Z'),
            discoveryRefreshMs: 12 * 60 * 60 * 1000,
        });

        expect(decision).toEqual({ refresh: true, reason: 'stale_cached_discovery' });
    });

    it('refreshes discovery when an enabled cached calendar is missing a usable URL', async () => {
        const { shouldRefreshAppleCalendarDiscovery } = await import('@/lib/apple-caldav/sync');
        const decision = shouldRefreshAppleCalendarDiscovery({
            account: {
                appleCalendarHomeUrl: 'https://caldav.icloud.com/12345/calendars/',
            },
            calendars: [{
                remoteCalendarId: 'home',
                remoteUrl: '',
                isEnabled: true,
                lastSeenAt: '2026-03-10T08:00:00.000Z',
            }],
            now: new Date('2026-03-10T09:00:00.000Z'),
            discoveryRefreshMs: 12 * 60 * 60 * 1000,
        });

        expect(decision).toEqual({ refresh: true, reason: 'missing_calendar_url' });
    });
});
