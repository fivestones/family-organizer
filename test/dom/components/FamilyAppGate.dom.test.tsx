// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    authState: {
        isAuthenticated: false,
        isLoading: false,
        sessionError: null as string | null,
    },
}));

vi.mock('next/navigation', () => ({
    usePathname: () => '/',
}));

vi.mock('@/components/AuthProvider', () => ({
    useAuth: () => mocks.authState,
}));

vi.mock('@/components/auth/LoginModal', () => ({
    LoginModal: () => <div data-testid="login-modal" />,
}));

import { FamilyAppGate } from '@/components/auth/FamilyAppGate';

describe('FamilyAppGate', () => {
    beforeEach(() => {
        mocks.authState.isAuthenticated = false;
        mocks.authState.isLoading = false;
        mocks.authState.sessionError = null;
    });

    it('shows the normal member-selection prompt without a session error', () => {
        render(<FamilyAppGate><div>Protected content</div></FamilyAppGate>);

        expect(screen.getByRole('heading', { name: /choose a family member to continue/i })).toBeInTheDocument();
        expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
    });

    it('shows the provider explanation when the signed-in profile is unavailable', () => {
        mocks.authState.sessionError =
            'The family profile for this signed-in session is no longer available. Choose another family member to continue.';

        render(<FamilyAppGate><div>Protected content</div></FamilyAppGate>);

        expect(screen.getByRole('heading', { name: /family profile unavailable/i })).toBeInTheDocument();
        expect(screen.getByText(/signed-in session is no longer available/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /open login/i })).toBeInTheDocument();
    });
});
