// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pathnameState: {
        pathname: '/',
    },
}));

vi.mock('next/navigation', () => ({
    usePathname: () => mocks.pathnameState.pathname,
}));

vi.mock('next/link', () => ({
    default: ({ href, onClick, children }: any) => (
        <a
            href={href}
            onClick={(e) => {
                e.preventDefault();
                onClick?.(e);
            }}
        >
            {children}
        </a>
    ),
}));

import { MainNav } from '@/components/MainNav';

function classTokens(element: HTMLElement) {
    return element.className.split(/\s+/).filter(Boolean);
}

describe('MainNav', () => {
    beforeEach(() => {
        mocks.pathnameState.pathname = '/';
    });

    it('marks the root chores link active only on exact root path', () => {
        const { rerender } = render(<MainNav />);

        expect(classTokens(screen.getByRole('button', { name: /chores/i }))).toContain('bg-accent');

        mocks.pathnameState.pathname = '/calendar';
        rerender(<MainNav />);

        expect(classTokens(screen.getByRole('button', { name: /chores/i }))).not.toContain('bg-accent');
        expect(classTokens(screen.getByRole('button', { name: /calendar/i }))).toContain('bg-accent');
    });

    it('uses prefix matching for nested section routes', () => {
        mocks.pathnameState.pathname = '/task-series/new';
        render(<MainNav />);

        expect(classTokens(screen.getByRole('button', { name: /task series/i }))).toContain('bg-accent');
    });

    it('calls onNavigate when a nav link is clicked', () => {
        const onNavigate = vi.fn();
        render(<MainNav onNavigate={onNavigate} />);

        fireEvent.click(screen.getByRole('link', { name: /calendar/i }));
        expect(onNavigate).toHaveBeenCalledTimes(1);
    });
});
