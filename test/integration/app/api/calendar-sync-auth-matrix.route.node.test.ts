import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

type CalendarSyncRouteCase = {
    label: string;
    method: 'GET' | 'POST';
    path: string;
    loadHandler: () => Promise<(request: NextRequest) => Promise<Response>>;
};

const routeCases: CalendarSyncRouteCase[] = [
    {
        label: 'calendar discovery',
        method: 'GET',
        path: '/api/calendar-sync/apple/calendars',
        loadHandler: async () => (await import('@/app/api/calendar-sync/apple/calendars/route')).GET,
    },
    {
        label: 'account connection',
        method: 'POST',
        path: '/api/calendar-sync/apple/connect',
        loadHandler: async () => (await import('@/app/api/calendar-sync/apple/connect/route')).POST,
    },
    {
        label: 'manual sync',
        method: 'POST',
        path: '/api/calendar-sync/apple/run',
        loadHandler: async () => (await import('@/app/api/calendar-sync/apple/run/route')).POST,
    },
    {
        label: 'sync settings',
        method: 'POST',
        path: '/api/calendar-sync/apple/settings',
        loadHandler: async () => (await import('@/app/api/calendar-sync/apple/settings/route')).POST,
    },
    {
        label: 'sync status',
        method: 'GET',
        path: '/api/calendar-sync/apple/status',
        loadHandler: async () => (await import('@/app/api/calendar-sync/apple/status/route')).GET,
    },
];

describe('calendar-sync route authorization matrix', () => {
    beforeEach(() => {
        process.env.DEVICE_ACCESS_KEY = 'test-device-key';
        delete process.env.CALENDAR_SYNC_CRON_SECRET;
    });

    for (const routeCase of routeCases) {
        it(`${routeCase.label} rejects a request with no route credentials`, async () => {
            const handler = await routeCase.loadHandler();
            const response = await handler(
                new NextRequest(`http://localhost:3000${routeCase.path}`, {
                    method: routeCase.method,
                })
            );

            expect(response.status).toBe(401);
            expect(await response.json()).toMatchObject({
                error: 'Device activation required',
                reason: 'missing',
            });
        });
    }
});
