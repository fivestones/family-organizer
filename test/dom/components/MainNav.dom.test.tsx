// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pathname: '/calendar',
    push: vi.fn(),
    resizeObservers: [] as Array<{ callback: ResizeObserverCallback }>,
}));

vi.mock('next/navigation', () => ({
    usePathname: () => mocks.pathname,
    useRouter: () => ({
        push: mocks.push,
    }),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
    DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
    DropdownMenuItem: ({ children, onSelect, ...props }: any) => (
        <button
            type="button"
            onClick={() => onSelect?.()}
            {...props}
        >
            {children}
        </button>
    ),
    DropdownMenuLabel: ({ children }: any) => <div data-testid="main-nav-overflow-label">{children}</div>,
    DropdownMenuSeparator: () => <hr />,
}));

import { MainNav } from '@/components/MainNav';

describe('MainNav', () => {
    const originalResizeObserver = global.ResizeObserver;
    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    // Six entries, 606px in all with the gaps between them.
    const widthByTestId: Record<string, number> = {
        'main-nav-measure-dashboard': 96,
        'main-nav-measure-chores': 104,
        'main-nav-measure-calendar': 92,
        'main-nav-measure-money': 92,
        'main-nav-measure-messages': 98,
        'main-nav-measure-admin': 84,
        'main-nav-measure-trigger': 36,
    };

    const triggerResizeObservers = () => {
        mocks.resizeObservers.forEach(({ callback }) => {
            callback([], {} as ResizeObserver);
        });
    };

    beforeEach(() => {
        mocks.pathname = '/calendar';
        mocks.push.mockReset();
        mocks.resizeObservers = [];

        class MockResizeObserver {
            callback: ResizeObserverCallback;

            constructor(callback: ResizeObserverCallback) {
                this.callback = callback;
                mocks.resizeObservers.push({ callback });
            }

            observe() {}

            disconnect() {}

            unobserve() {}
        }

        global.ResizeObserver = MockResizeObserver as typeof ResizeObserver;
        HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
            const testId = this.getAttribute('data-testid') || '';
            const width = widthByTestId[testId] ?? 0;
            return {
                width,
                height: 36,
                top: 0,
                left: 0,
                right: width,
                bottom: 36,
                x: 0,
                y: 0,
                toJSON: () => ({}),
            } as DOMRect;
        };
    });

    afterEach(() => {
        global.ResizeObserver = originalResizeObserver;
        HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    });

    const renderAtWidth = (width: number, props: React.ComponentProps<typeof MainNav> = {}) => {
        render(<MainNav {...props} />);
        Object.defineProperty(screen.getByTestId('main-nav-container'), 'clientWidth', { configurable: true, value: width });
        act(() => {
            triggerResizeObservers();
        });
    };

    it('shows six entries instead of fourteen links when there is room', () => {
        renderAtWidth(1600);

        expect(screen.getByTestId('main-nav-link-dashboard')).toHaveAttribute('href', '/');
        expect(screen.getByTestId('main-nav-link-calendar')).toHaveAttribute('href', '/calendar');
        expect(screen.getByTestId('main-nav-link-messages')).toHaveAttribute('href', '/messages');
        for (const group of ['chores', 'money', 'admin']) {
            expect(screen.getByTestId(`main-nav-group-${group}`)).toBeInTheDocument();
        }
        expect(screen.queryByTestId('main-nav-overflow-trigger')).toBeNull();
    });

    it('keeps a group’s everyday page one tap away and puts the rest behind its chevron', () => {
        renderAtWidth(1600);

        // The label is the front door.
        expect(screen.getByTestId('main-nav-link-chores')).toHaveAttribute('href', '/chores');
        expect(screen.getByTestId('main-nav-link-money')).toHaveAttribute('href', '/familyMemberDetail');
        // Admin has no everyday page, so its label only opens the group.
        expect(screen.queryByTestId('main-nav-link-admin')).toBeNull();
        expect(screen.getByTestId('main-nav-group-trigger-admin')).toHaveTextContent('Admin');

        for (const page of ['chores', 'countdown', 'routines', 'tasks', 'my-tasks', 'task-series']) {
            expect(screen.getByTestId(`main-nav-group-item-${page}`)).toBeInTheDocument();
        }
        for (const page of ['finance', 'allowance-distribution', 'content', 'history', 'files', 'settings']) {
            expect(screen.getByTestId(`main-nav-group-item-${page}`)).toBeInTheDocument();
        }

        fireEvent.click(screen.getByTestId('main-nav-group-item-task-series'));
        expect(mocks.push).toHaveBeenCalledWith('/task-series');
    });

    it('marks the group that holds the current page', () => {
        mocks.pathname = '/countdown';
        renderAtWidth(1600);

        expect(screen.getByTestId('main-nav-group-chores').className).toContain('bg-accent text-accent-foreground');
        expect(screen.getByTestId('main-nav-group-item-countdown').className).toContain('bg-accent');
        expect(screen.getByTestId('main-nav-group-item-tasks').className).not.toContain('bg-accent');
        expect(screen.getByTestId('main-nav-group-money').className).not.toContain('bg-accent text-accent-foreground');
    });

    it('does not mistake Task Series for Tasks', () => {
        mocks.pathname = '/task-series';
        renderAtWidth(1600);

        expect(screen.getByTestId('main-nav-group-item-task-series').className).toContain('bg-accent');
        expect(screen.getByTestId('main-nav-group-item-tasks').className).not.toContain('bg-accent');
    });

    it('keeps the leftmost entries and moves the rest into a labelled menu', () => {
        renderAtWidth(360);

        // Dashboard, Chores and Calendar fit beside the menu button; Money does not.
        expect(screen.getByTestId('main-nav-link-dashboard')).toBeInTheDocument();
        expect(screen.getByTestId('main-nav-group-chores')).toBeInTheDocument();
        expect(screen.getByTestId('main-nav-link-calendar')).toBeInTheDocument();
        expect(screen.queryByTestId('main-nav-group-money')).toBeNull();
        expect(screen.queryByTestId('main-nav-link-messages')).toBeNull();
        expect(screen.getByTestId('main-nav-overflow-trigger')).toBeInTheDocument();

        // The overflow keeps its grouping instead of becoming a flat list.
        expect(screen.getAllByTestId('main-nav-overflow-label').map((label) => label.textContent)).toEqual(['Money', 'Admin']);
        for (const page of ['finance', 'allowance-distribution', 'messages', 'content', 'history', 'files', 'settings']) {
            expect(screen.getByTestId(`main-nav-overflow-item-${page}`)).toBeInTheDocument();
        }

        fireEvent.click(screen.getByTestId('main-nav-overflow-item-settings'));
        expect(mocks.push).toHaveBeenCalledWith('/settings');
    });

    it('tells its host when a page is chosen from a menu', () => {
        const onNavigate = vi.fn();
        renderAtWidth(360, { onNavigate });

        fireEvent.click(screen.getByTestId('main-nav-group-item-countdown'));
        fireEvent.click(screen.getByTestId('main-nav-overflow-item-messages'));

        expect(onNavigate).toHaveBeenCalledTimes(2);
        expect(mocks.push.mock.calls.map(([href]) => href)).toEqual(['/countdown', '/messages']);
    });
});
