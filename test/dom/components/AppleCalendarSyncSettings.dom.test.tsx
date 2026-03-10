// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppleCalendarSyncSettings from '@/components/AppleCalendarSyncSettings';

const toastSpy = vi.fn();

vi.mock('@/components/ui/use-toast', () => ({
    useToast: () => ({
        toast: toastSpy,
    }),
}));

describe('AppleCalendarSyncSettings', () => {
    beforeEach(() => {
        toastSpy.mockReset();
        vi.stubGlobal(
            'fetch',
            vi.fn()
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            configured: true,
                            account: { id: 'acct_1', username: 'parent@example.com', lastSuccessfulSyncAt: '2026-03-10T12:00:00.000Z' },
                            calendars: [{ id: 'cal_1', remoteCalendarId: 'home', displayName: 'Home', isEnabled: true }],
                            lastRun: null,
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } }
                    )
                )
                .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
                .mockResolvedValueOnce(
                    new Response(
                        JSON.stringify({
                            configured: true,
                            account: { id: 'acct_1', username: 'parent@example.com', lastSuccessfulSyncAt: '2026-03-10T12:05:00.000Z' },
                            calendars: [{ id: 'cal_1', remoteCalendarId: 'home', displayName: 'Home', isEnabled: true }],
                            lastRun: null,
                        }),
                        { status: 200, headers: { 'Content-Type': 'application/json' } }
                    )
                )
        );
    });

    it('loads status and can trigger a manual sync', async () => {
        const user = userEvent.setup();
        render(<AppleCalendarSyncSettings />);

        await screen.findByText(/Connected as parent@example.com/i);
        await user.click(screen.getByRole('button', { name: /sync now/i }));

        await waitFor(() => {
            expect(global.fetch).toHaveBeenCalledWith(
                '/api/calendar-sync/apple/run',
                expect.objectContaining({ method: 'POST' })
            );
        });
    });
});
