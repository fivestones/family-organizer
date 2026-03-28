'use client';

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const NAV_LINK_GAP_PX = 8;
const NAV_LINKS = [
    { href: '/', label: 'Dashboard' },
    { href: '/chores', label: 'Chores' },
    { href: '/tasks', label: 'Tasks' },
    { href: '/task-series', label: 'Task Series' },
    { href: '/calendar', label: 'Calendar' },
    { href: '/messages', label: 'Messages' },
    { href: '/familyMemberDetail', label: 'Finance' },
    { href: '/allowance-distribution', label: 'Allowance Distribution' },
    { href: '/content', label: 'Content' },
    { href: '/history', label: 'History' },
    { href: '/settings', label: 'Settings' },
] as const;

interface MainNavProps {
    className?: string;
    onNavigate?: () => void;
}

export function MainNav({ className, onNavigate }: MainNavProps) {
    const pathname = usePathname();
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);
    const measureLinkRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const measureTriggerRef = useRef<HTMLButtonElement | null>(null);
    const [visibleCount, setVisibleCount] = useState<number>(NAV_LINKS.length);

    const isActive = (href: string) => {
        if (href === '/') return pathname === '/';
        return pathname.startsWith(href);
    };

    const recomputeVisibleCount = () => {
        const containerWidth = containerRef.current?.clientWidth ?? 0;
        if (containerWidth <= 0) return;

        const linkWidths = NAV_LINKS.map((_, index) =>
            Math.ceil(measureLinkRefs.current[index]?.getBoundingClientRect().width ?? 0)
        );
        const triggerWidth = Math.ceil(measureTriggerRef.current?.getBoundingClientRect().width ?? 0);

        if (linkWidths.some((width) => width <= 0) || triggerWidth <= 0) {
            return;
        }

        const fullWidth =
            linkWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, linkWidths.length - 1) * NAV_LINK_GAP_PX;
        if (fullWidth <= containerWidth) {
            setVisibleCount(NAV_LINKS.length);
            return;
        }

        let usedWidth = 0;
        let nextVisibleCount = 0;

        for (let index = 0; index < linkWidths.length; index += 1) {
            const widthWithGap = linkWidths[index] + (nextVisibleCount > 0 ? NAV_LINK_GAP_PX : 0);
            const remainingCount = linkWidths.length - (index + 1);
            const reservedTriggerWidth =
                remainingCount > 0 ? triggerWidth + (nextVisibleCount + 1 > 0 ? NAV_LINK_GAP_PX : 0) : 0;

            if (usedWidth + widthWithGap + reservedTriggerWidth > containerWidth) {
                break;
            }

            usedWidth += widthWithGap;
            nextVisibleCount += 1;
        }

        setVisibleCount(nextVisibleCount);
    };

    useLayoutEffect(() => {
        recomputeVisibleCount();

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(() => {
            recomputeVisibleCount();
        });

        if (containerRef.current) {
            observer.observe(containerRef.current);
        }
        measureLinkRefs.current.forEach((node) => {
            if (node) {
                observer.observe(node);
            }
        });
        if (measureTriggerRef.current) {
            observer.observe(measureTriggerRef.current);
        }

        return () => observer.disconnect();
    }, [pathname]);

    const visibleLinks = useMemo(() => NAV_LINKS.slice(0, visibleCount), [visibleCount]);
    const overflowLinks = useMemo(() => NAV_LINKS.slice(visibleCount), [visibleCount]);

    return (
        <div ref={containerRef} className={cn('relative min-w-0 flex-1', className)} data-testid="main-nav-container">
            <div className="pointer-events-none absolute left-0 top-0 -z-10 flex whitespace-nowrap opacity-0" aria-hidden="true">
                <div className="flex items-center gap-2">
                    {NAV_LINKS.map(({ href, label }, index) => (
                        <Button
                            key={`measure-${href}`}
                            ref={(node) => {
                                measureLinkRefs.current[index] = node;
                            }}
                            type="button"
                            variant="ghost"
                            className={cn(
                                'h-9 shrink-0 whitespace-nowrap px-3',
                                isActive(href) && 'bg-accent text-accent-foreground'
                            )}
                            tabIndex={-1}
                            data-testid={`main-nav-measure-${label.toLowerCase().replace(/\s+/g, '-')}`}
                        >
                            {label}
                        </Button>
                    ))}
                    <Button
                        ref={measureTriggerRef}
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 shrink-0"
                        tabIndex={-1}
                        data-testid="main-nav-measure-trigger"
                    >
                        <Menu className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <nav className="flex min-w-0 items-center gap-2">
                {visibleLinks.map(({ href, label }) => (
                    <Link key={href} href={href} onClick={onNavigate} data-testid={`main-nav-link-${label.toLowerCase().replace(/\s+/g, '-')}`}>
                        <Button
                            variant="ghost"
                            className={cn(
                                'h-9 shrink-0 whitespace-nowrap px-3',
                                isActive(href) && 'bg-accent text-accent-foreground'
                            )}
                        >
                            {label}
                        </Button>
                    </Link>
                ))}

                {overflowLinks.length > 0 ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 shrink-0"
                                aria-label="Open navigation menu"
                                data-testid="main-nav-overflow-trigger"
                            >
                                <Menu className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-64" sideOffset={8}>
                            {overflowLinks.map(({ href, label }) => (
                                <DropdownMenuItem
                                    key={`overflow-${href}`}
                                    className={cn(isActive(href) && 'bg-accent text-accent-foreground')}
                                    onSelect={() => {
                                        onNavigate?.();
                                        router.push(href);
                                    }}
                                    data-testid={`main-nav-overflow-item-${label.toLowerCase().replace(/\s+/g, '-')}`}
                                >
                                    {label}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </nav>
        </div>
    );
}
