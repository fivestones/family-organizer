// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { advanceTimeByAsync, freezeTime } from '@/test/utils/fake-clock';

const mocks = vi.hoisted(() => ({
    dbUseQuery: vi.fn(),
    ensureKidPrincipal: vi.fn(),
    instantPrincipalState: {
        principalType: 'kid' as 'kid' | 'parent' | 'unknown',
    },
}));

vi.mock('@/lib/db', () => ({
    db: {
        useQuery: mocks.dbUseQuery,
    },
}));

vi.mock('@/components/InstantFamilySessionProvider', () => ({
    useInstantPrincipal: () => ({
        ensureKidPrincipal: mocks.ensureKidPrincipal,
        principalType: mocks.instantPrincipalState.principalType,
    }),
}));

import { AuthProvider, useAuth } from '@/components/AuthProvider';

function Probe() {
    const auth = useAuth();

    return (
        <div>
            <div data-testid="is-authenticated">{String(auth.isAuthenticated)}</div>
            <div data-testid="is-loading">{String(auth.isLoading)}</div>
            <div data-testid="current-user">{auth.currentUser?.id ?? 'none'}</div>
            <button
                type="button"
                onClick={() =>
                    auth.login(
                        {
                            id: 'child-1',
                            name: 'Ava',
                            role: 'child',
                        },
                        false
                    )
                }
            >
                Login Child
            </button>
            <button
                type="button"
                onClick={() =>
                    auth.login(
                        {
                            id: 'parent-1',
                            name: 'Pat',
                            role: 'parent',
                        },
                        false
                    )
                }
            >
                Login Parent
            </button>
            <button
                type="button"
                onClick={() =>
                    auth.login(
                        {
                            id: 'child-1',
                            name: 'Ava',
                            role: 'child',
                        },
                        true
                    )
                }
            >
                Login Child Remember
            </button>
            <button type="button" onClick={() => auth.logout()}>
                Logout
            </button>
        </div>
    );
}

function renderAuthProvider() {
    return render(
        <AuthProvider>
            <Probe />
        </AuthProvider>
    );
}

describe('AuthProvider', () => {
    beforeEach(() => {
        freezeTime(new Date('2026-02-26T12:00:00Z'));
        mocks.dbUseQuery.mockReset();
        mocks.ensureKidPrincipal.mockReset();
        mocks.instantPrincipalState.principalType = 'kid';
        mocks.ensureKidPrincipal.mockResolvedValue(undefined);
        mocks.dbUseQuery.mockReturnValue({
            data: {
                familyMembers: [
                    { id: 'parent-1', name: 'Pat', role: 'parent' },
                    { id: 'child-1', name: 'Ava', role: 'child' },
                ],
            },
            isLoading: false,
        });
    });

    it('logs in, persists the selected user, and logout restores kid principal', async () => {
        renderAuthProvider();

        fireEvent.click(screen.getByRole('button', { name: /^login child$/i }));
        expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
        expect(screen.getByTestId('current-user')).toHaveTextContent('child-1');
        expect(window.localStorage.getItem('family_organizer_user_id')).toBe('child-1');
        expect(window.localStorage.getItem('family_organizer_remember_me')).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: /logout/i }));

        expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');
        expect(window.localStorage.getItem('family_organizer_user_id')).toBeNull();
        expect(window.localStorage.getItem('family_organizer_remember_me')).toBeNull();
        expect(mocks.ensureKidPrincipal).toHaveBeenCalledWith({ clearParentSession: true });
    });

    it('auto-logs out after idle timeout when remember-me is disabled', async () => {
        renderAuthProvider();

        fireEvent.click(screen.getByRole('button', { name: /^login child$/i }));
        expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');

        await act(async () => {
            await advanceTimeByAsync(60 * 60 * 1000 + 1);
            await advanceTimeByAsync(0);
        });

        expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');
        expect(mocks.ensureKidPrincipal).toHaveBeenCalledWith({ clearParentSession: true });
    });

    it('does not auto-logout when remember-me is enabled', async () => {
        renderAuthProvider();

        fireEvent.click(screen.getByRole('button', { name: /login child remember/i }));
        expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
        expect(window.localStorage.getItem('family_organizer_remember_me')).toBe('true');

        await act(async () => {
            await advanceTimeByAsync(60 * 60 * 1000 + 1);
            await advanceTimeByAsync(0);
        });

        expect(screen.getByTestId('is-authenticated')).toHaveTextContent('true');
    });

    it('clears a selected parent user when the active Instant principal drops to kid', async () => {
        const view = renderAuthProvider();

        mocks.instantPrincipalState.principalType = 'parent';
        view.rerender(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );

        fireEvent.click(screen.getByRole('button', { name: /login parent/i }));
        expect(screen.getByTestId('current-user')).toHaveTextContent('parent-1');
        expect(window.localStorage.getItem('family_organizer_user_id')).toBe('parent-1');

        mocks.instantPrincipalState.principalType = 'kid';
        view.rerender(
            <AuthProvider>
                <Probe />
            </AuthProvider>
        );

        expect(screen.getByTestId('is-authenticated')).toHaveTextContent('false');
        expect(screen.getByTestId('current-user')).toHaveTextContent('none');
        expect(window.localStorage.getItem('family_organizer_user_id')).toBeNull();
    });
});
