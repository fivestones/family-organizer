// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    dbUseQuery: vi.fn(),
    authLogin: vi.fn(),
    ensureKidPrincipal: vi.fn(),
    elevateParentPrincipal: vi.fn(),
    toast: vi.fn(),
    hashPinClient: vi.fn(),
    hashPinServer: vi.fn(),
    instantPrincipalState: {
        canUseCachedParentPrincipal: false,
        isParentSessionSharedDevice: true,
    },
}));

vi.mock('@/lib/db', () => ({
    db: {
        useQuery: mocks.dbUseQuery,
    },
}));

vi.mock('@/components/AuthProvider', () => ({
    useAuth: () => ({
        login: mocks.authLogin,
    }),
}));

vi.mock('@/components/InstantFamilySessionProvider', () => ({
    useInstantPrincipal: () => ({
        ensureKidPrincipal: mocks.ensureKidPrincipal,
        elevateParentPrincipal: mocks.elevateParentPrincipal,
        canUseCachedParentPrincipal: mocks.instantPrincipalState.canUseCachedParentPrincipal,
        isParentSessionSharedDevice: mocks.instantPrincipalState.isParentSessionSharedDevice,
    }),
}));

vi.mock('@/components/ui/use-toast', () => ({
    useToast: () => ({
        toast: mocks.toast,
    }),
}));

vi.mock('@/lib/pin-client', () => ({
    hashPinClient: mocks.hashPinClient,
}));

vi.mock('@/app/actions', () => ({
    hashPin: mocks.hashPinServer,
}));

vi.mock('@/components/ui/dialog', () => ({
    Dialog: ({ open, children }: any) => (open ? <div data-testid="dialog-root">{children}</div> : null),
    DialogContent: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    DialogHeader: ({ children }: any) => <div>{children}</div>,
    DialogTitle: ({ children }: any) => <h2>{children}</h2>,
    DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

vi.mock('@/components/ui/checkbox', () => ({
    Checkbox: ({ id, checked, onCheckedChange }: any) => (
        <input
            id={id}
            type="checkbox"
            checked={Boolean(checked)}
            onChange={(e) => onCheckedChange?.(e.target.checked)}
        />
    ),
}));

import { LoginModal } from '@/components/auth/LoginModal';

type FamilyMember = {
    id: string;
    name: string;
    role: 'parent' | 'child';
    pinHash?: string | null;
    photoUrls?: Record<string, string>;
};

function renderLoginModal(options?: {
    members?: FamilyMember[];
    canUseCachedParentPrincipal?: boolean;
    isParentSessionSharedDevice?: boolean;
    isLoading?: boolean;
}) {
    const members = options?.members ?? [];
    const canUseCachedParentPrincipal = options?.canUseCachedParentPrincipal ?? false;
    const isParentSessionSharedDevice = options?.isParentSessionSharedDevice ?? true;
    const isLoading = options?.isLoading ?? false;

    mocks.dbUseQuery.mockReturnValue({
        data: { familyMembers: members },
        isLoading,
    });
    mocks.instantPrincipalState.canUseCachedParentPrincipal = canUseCachedParentPrincipal;
    mocks.instantPrincipalState.isParentSessionSharedDevice = isParentSessionSharedDevice;

    const onClose = vi.fn();
    render(<LoginModal isOpen onClose={onClose} />);
    return { onClose };
}

function setNavigatorOnline(value: boolean) {
    Object.defineProperty(window.navigator, 'onLine', {
        configurable: true,
        value,
    });
}

describe('LoginModal', () => {
    beforeEach(() => {
        mocks.dbUseQuery.mockReset();
        mocks.authLogin.mockReset();
        mocks.ensureKidPrincipal.mockReset();
        mocks.elevateParentPrincipal.mockReset();
        mocks.toast.mockReset();
        mocks.hashPinClient.mockReset();
        mocks.hashPinServer.mockReset();

        mocks.ensureKidPrincipal.mockResolvedValue(undefined);
        mocks.elevateParentPrincipal.mockResolvedValue(undefined);
        mocks.hashPinClient.mockResolvedValue('hashed-0000');
        mocks.hashPinServer.mockResolvedValue('server-hashed-0000');
        mocks.instantPrincipalState.canUseCachedParentPrincipal = false;
        mocks.instantPrincipalState.isParentSessionSharedDevice = true;

        setNavigatorOnline(true);
        document.body.style.pointerEvents = '';
    });

    it('renders family member selection and shows parent-specific controls after selecting a parent', async () => {
        renderLoginModal({
            members: [
                { id: 'c1', name: 'Ava', role: 'child', pinHash: 'h1' },
                { id: 'p1', name: 'Pat', role: 'parent', pinHash: 'h2' },
            ],
        });
        const user = userEvent.setup();

        expect(screen.getByText('Who are you?')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /pat/i }));

        expect(screen.getByText(/welcome, pat/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/this is a shared device/i)).toBeInTheDocument();
        expect(screen.getByPlaceholderText('PIN')).toBeInTheDocument();
    });

    it('logs in a child after client-side PIN verification and closes the modal', async () => {
        mocks.hashPinClient.mockResolvedValue('child-hash');
        const { onClose } = renderLoginModal({
            members: [{ id: 'c1', name: 'Ava', role: 'child', pinHash: 'child-hash' }],
        });
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: /ava/i }));
        await user.type(screen.getByPlaceholderText('PIN'), '1234');
        await user.click(screen.getByRole('button', { name: /^log in$/i }));

        expect(mocks.ensureKidPrincipal).toHaveBeenCalledWith({ clearParentSession: true });
        expect(mocks.hashPinClient).toHaveBeenCalledWith('1234');
        expect(mocks.authLogin).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'c1', name: 'Ava', role: 'child' }),
            false
        );
        expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/welcome back, ava/i) }));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('falls back to server PIN hashing for child login when local hashing is unavailable', async () => {
        mocks.hashPinClient.mockRejectedValue(new Error('webcrypto unavailable'));
        mocks.hashPinServer.mockResolvedValue('child-hash');

        const { onClose } = renderLoginModal({
            members: [{ id: 'c1', name: 'Ava', role: 'child', pinHash: 'child-hash' }],
        });
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: /ava/i }));
        await user.type(screen.getByPlaceholderText('PIN'), '5678');
        await user.click(screen.getByRole('button', { name: /^log in$/i }));

        expect(mocks.hashPinClient).toHaveBeenCalledWith('5678');
        expect(mocks.hashPinServer).toHaveBeenCalledWith('5678');
        expect(mocks.authLogin).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('shows an offline error instead of attempting parent elevation when a fresh parent PIN check is required', async () => {
        setNavigatorOnline(false);

        renderLoginModal({
            members: [{ id: 'p1', name: 'Pat', role: 'parent', pinHash: 'parent-hash' }],
            canUseCachedParentPrincipal: false,
        });
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: /pat/i }));
        await user.type(screen.getByPlaceholderText('PIN'), '9999');
        await user.click(screen.getByRole('button', { name: /^log in$/i }));

        expect(mocks.elevateParentPrincipal).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledWith(
            expect.objectContaining({
                title: 'Internet required for parent mode',
                variant: 'destructive',
            })
        );
    });

    it('allows parent login without PIN when cached parent principal can be reused', async () => {
        const { onClose } = renderLoginModal({
            members: [{ id: 'p1', name: 'Pat', role: 'parent', pinHash: 'parent-hash' }],
            canUseCachedParentPrincipal: true,
        });
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: /pat/i }));
        expect(screen.getByPlaceholderText('PIN (optional)')).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /^log in$/i }));

        expect(mocks.elevateParentPrincipal).toHaveBeenCalledWith({
            familyMemberId: 'p1',
            pin: '',
            sharedDevice: true,
        });
        expect(mocks.authLogin).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'p1', name: 'Pat', role: 'parent' }),
            false
        );
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
