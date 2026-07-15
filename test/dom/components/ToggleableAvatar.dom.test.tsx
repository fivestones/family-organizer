// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/components/ui/use-toast', () => ({
    useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/components/ui/toggle', async () => {
    const React = await import('react');
    return {
        Toggle: React.forwardRef<HTMLButtonElement, any>(function MockToggle(
            { pressed, onPressedChange, children, ...props },
            ref
        ) {
            return (
                <button
                    ref={ref}
                    type="button"
                    aria-pressed={Boolean(pressed)}
                    onClick={() => onPressedChange?.(!pressed)}
                    {...props}
                >
                    {children}
                </button>
            );
        }),
    };
});

vi.mock('@/components/ui/avatar', () => ({
    Avatar: ({ children }: any) => <span>{children}</span>,
    AvatarImage: ({ alt }: any) => <span>{alt}</span>,
    AvatarFallback: ({ children }: any) => <span>{children}</span>,
}));

vi.mock('@/lib/photo-urls', () => ({ getPhotoUrl: () => null }));

import ToggleableAvatar from '@/components/ui/ToggleableAvatar';

describe('ToggleableAvatar read-only state', () => {
    it('preserves completion visuals but blocks a historical mutation with context', async () => {
        const onToggle = vi.fn();
        const user = userEvent.setup();

        render(
            <ToggleableAvatar
                name="Alex"
                isComplete
                isReadOnly
                readOnlyReason="Only a parent can change chore completion on a past date."
                onToggle={onToggle}
            />
        );

        const button = screen.getByRole('button');
        expect(button).toHaveAttribute('aria-pressed', 'true');
        expect(button).toHaveAttribute('aria-disabled', 'true');
        expect(button).not.toBeDisabled();

        await user.click(button);

        expect(onToggle).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledWith({
            title: 'Past chore is read-only',
            description: 'Only a parent can change chore completion on a past date.',
        });
    });
});
