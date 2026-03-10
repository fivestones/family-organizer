import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getAppleCalendarSyncStatus = vi.fn();

vi.mock('@/lib/apple-caldav/sync', () => ({
    getAppleCalendarSyncStatus,
}));

describe('GET /api/calendar-sync/apple/status', () => {
    beforeEach(() => {
        process.env.DEVICE_ACCESS_KEY = 'test-device-key';
        getAppleCalendarSyncStatus.mockReset();
    });

    it('returns 401 for unauthenticated requests', async () => {
        const { GET } = await import('@/app/api/calendar-sync/apple/status/route');
        const response = await GET(new NextRequest('http://localhost:3000/api/calendar-sync/apple/status'));

        expect(response.status).toBe(401);
    });

    it('returns current sync status for authenticated devices', async () => {
        getAppleCalendarSyncStatus.mockResolvedValue({
            configured: true,
            account: { id: 'acct_1', username: 'parent@example.com' },
            calendars: [],
            lastRun: null,
        });
        const { GET } = await import('@/app/api/calendar-sync/apple/status/route');
        const response = await GET(
            new NextRequest('http://localhost:3000/api/calendar-sync/apple/status', {
                headers: { cookie: 'family_device_auth=true' },
            })
        );

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.configured).toBe(true);
        expect(body.account.username).toBe('parent@example.com');
    });
});
