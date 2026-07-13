// @vitest-environment jsdom

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { advanceTimeByAsync, freezeTime } from '@/test/utils/fake-clock';

const dbMocks = vi.hoisted(() => ({
    useAuth: vi.fn(),
    signInWithToken: vi.fn(),
    signOut: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    db: {
        useAuth: dbMocks.useAuth,
        auth: {
            signInWithToken: dbMocks.signInWithToken,
            signOut: dbMocks.signOut,
        },
    },
}));

import { InstantFamilySessionProvider, useInstantPrincipal } from '@/components/InstantFamilySessionProvider';

function Probe() {
    const { principalType, isSwitchingPrincipal, ensureKidPrincipal, signInFamilyMember } = useInstantPrincipal();
    return (
        <div data-testid="principal-probe">
            <div data-testid="principal">{principalType}</div>
            <div data-testid="switching">{isSwitchingPrincipal ? 'switching' : 'idle'}</div>
            <button type="button" onClick={() => void ensureKidPrincipal()}>
                Ensure Kid Principal
            </button>
            <button
                type="button"
                onClick={() => void signInFamilyMember({ familyMemberId: 'parent-1', pin: '1234' })}
            >
                Switch Member
            </button>
        </div>
    );
}

describe('InstantFamilySessionProvider', () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_PARENT_SHARED_DEVICE_IDLE_TIMEOUT_MS = '15';
        dbMocks.signInWithToken.mockResolvedValue({ user: { id: 'kid-principal' } });
        dbMocks.signOut.mockResolvedValue(undefined);
        dbMocks.useAuth.mockReturnValue({
            isLoading: false,
            user: { id: 'kid-principal', refresh_token: 'refresh', isGuest: false, type: 'kid' },
            error: undefined,
        });
    });

    it('does not re-fetch or re-sign-in when already in kid principal mode', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        render(
            <InstantFamilySessionProvider>
                <Probe />
            </InstantFamilySessionProvider>
        );

        await waitFor(() => {
            expect(screen.getByTestId('principal')).toHaveTextContent('kid');
        });

        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /ensure kid principal/i }));

        expect(fetchMock).not.toHaveBeenCalled();
        expect(dbMocks.signInWithToken).not.toHaveBeenCalled();
    });

    it('keeps children mounted while an interactive principal switch is in flight', async () => {
        let resolveFetch: ((value: unknown) => void) | undefined;
        vi.stubGlobal(
            'fetch',
            vi.fn().mockImplementation(
                () =>
                    new Promise((resolve) => {
                        resolveFetch = resolve;
                    })
            )
        );

        render(
            <InstantFamilySessionProvider>
                <Probe />
            </InstantFamilySessionProvider>
        );

        await waitFor(() => expect(screen.getByTestId('principal')).toHaveTextContent('kid'));
        const user = userEvent.setup();
        await user.click(screen.getByRole('button', { name: /switch member/i }));

        await waitFor(() => expect(screen.getByTestId('switching')).toHaveTextContent('switching'));
        expect(screen.getByTestId('principal-probe')).toBeInTheDocument();
        expect(screen.queryByText('Connecting to family data...')).not.toBeInTheDocument();

        await act(async () => {
            resolveFetch?.({
                ok: true,
                json: async () => ({
                    token: 'parent-token',
                    principalType: 'parent',
                    familyMemberId: 'parent-1',
                }),
            });
        });
        await waitFor(() => expect(screen.getByTestId('switching')).toHaveTextContent('idle'));
    });

    it('expires shared-device parent mode after inactivity and falls back to kid principal', async () => {
        freezeTime(new Date('2026-02-25T12:00:00Z'));
        localStorage.setItem('family_organizer_preferred_principal', 'parent');
        localStorage.setItem('family_organizer_parent_principal_unlocked', 'true');
        localStorage.setItem('family_organizer_parent_shared_device', 'true');
        localStorage.setItem('family_organizer_parent_last_activity_at', String(Date.now()));

        dbMocks.useAuth.mockReturnValue({
            isLoading: false,
            user: { id: 'parent-principal', refresh_token: 'refresh', isGuest: false, type: 'parent' },
            error: undefined,
        });

        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ token: 'kid-token-from-server' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        render(
            <InstantFamilySessionProvider>
                <Probe />
            </InstantFamilySessionProvider>
        );

        await act(async () => {
            await advanceTimeByAsync(0);
        });
        expect(screen.getByTestId('principal')).toHaveTextContent('parent');

        await act(async () => {
            await advanceTimeByAsync(20);
            await advanceTimeByAsync(0);
        });

        expect(fetchMock).not.toHaveBeenCalled();
        expect(dbMocks.signOut).toHaveBeenCalledTimes(1);
        expect(screen.getByTestId('principal')).toHaveTextContent('unknown');
    });
});
