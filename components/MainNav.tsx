'use client';

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const NAV_ENTRY_GAP_PX = 8;

interface NavPage {
    href: string;
    label: string;
}

/**
 * A top-level entry is either one page or a named group of pages. A group with
 * a `primary` page has a front door: tapping its label goes straight there, so
 * the everyday destination stays one tap away and the chevron holds the rest.
 */
type NavEntry = ({ kind: 'link' } & NavPage) | { kind: 'group'; label: string; primary?: NavPage; pages: NavPage[] };

const CHORES: NavPage = { href: '/chores', label: 'Chores' };
const FINANCE: NavPage = { href: '/familyMemberDetail', label: 'Finance' };

export const NAV_ENTRIES: NavEntry[] = [
    { kind: 'link', href: '/', label: 'Dashboard' },
    {
        kind: 'group',
        label: 'Chores',
        primary: CHORES,
        pages: [
            CHORES,
            { href: '/countdown', label: 'Countdown' },
            { href: '/routines', label: 'Routines' },
            { href: '/tasks', label: 'Tasks' },
            { href: '/my-tasks', label: 'My Tasks' },
            { href: '/task-series', label: 'Task Series' },
        ],
    },
    { kind: 'link', href: '/calendar', label: 'Calendar' },
    {
        kind: 'group',
        label: 'Money',
        primary: FINANCE,
        pages: [FINANCE, { href: '/allowance-distribution', label: 'Allowance Distribution' }],
    },
    { kind: 'link', href: '/messages', label: 'Messages' },
    {
        kind: 'group',
        label: 'Admin',
        pages: [
            { href: '/content', label: 'Content' },
            { href: '/history', label: 'History' },
            { href: '/files', label: 'Files' },
            { href: '/settings', label: 'Settings' },
        ],
    },
];

function slug(label: string): string {
    return label.toLowerCase().replace(/\s+/g, '-');
}

interface MainNavProps {
    className?: string;
    onNavigate?: () => void;
}

export function MainNav({ className, onNavigate }: MainNavProps) {
    const pathname = usePathname();
    const router = useRouter();
    const containerRef = useRef<HTMLDivElement>(null);
    const measureEntryRefs = useRef<Array<HTMLElement | null>>([]);
    const measureTriggerRef = useRef<HTMLButtonElement | null>(null);
    const [visibleCount, setVisibleCount] = useState<number>(NAV_ENTRIES.length);

    const isActive = (href: string) => {
        if (href === '/') return pathname === '/';
        return pathname.startsWith(href);
    };
    const isEntryActive = (entry: NavEntry) => (entry.kind === 'link' ? isActive(entry.href) : entry.pages.some((page) => isActive(page.href)));

    const go = (href: string) => {
        onNavigate?.();
        router.push(href);
    };

    const recomputeVisibleCount = () => {
        const containerWidth = containerRef.current?.clientWidth ?? 0;
        if (containerWidth <= 0) return;

        const entryWidths = NAV_ENTRIES.map((_, index) =>
            Math.ceil(measureEntryRefs.current[index]?.getBoundingClientRect().width ?? 0)
        );
        const triggerWidth = Math.ceil(measureTriggerRef.current?.getBoundingClientRect().width ?? 0);

        if (entryWidths.some((width) => width <= 0) || triggerWidth <= 0) {
            return;
        }

        const fullWidth =
            entryWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, entryWidths.length - 1) * NAV_ENTRY_GAP_PX;
        if (fullWidth <= containerWidth) {
            setVisibleCount(NAV_ENTRIES.length);
            return;
        }

        let usedWidth = 0;
        let nextVisibleCount = 0;

        for (let index = 0; index < entryWidths.length; index += 1) {
            const widthWithGap = entryWidths[index] + (nextVisibleCount > 0 ? NAV_ENTRY_GAP_PX : 0);
            const remainingCount = entryWidths.length - (index + 1);
            const reservedTriggerWidth = remainingCount > 0 ? triggerWidth + NAV_ENTRY_GAP_PX : 0;

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
        measureEntryRefs.current.forEach((node) => {
            if (node) {
                observer.observe(node);
            }
        });
        if (measureTriggerRef.current) {
            observer.observe(measureTriggerRef.current);
        }

        return () => observer.disconnect();
    }, [pathname]);

    const visibleEntries = useMemo(() => NAV_ENTRIES.slice(0, visibleCount), [visibleCount]);
    const overflowEntries = useMemo(() => NAV_ENTRIES.slice(visibleCount), [visibleCount]);

    const activeClass = 'bg-accent text-accent-foreground';

    /** One entry as it appears in the bar. `measure` renders the inert copy used to size it. */
    const renderEntry = (entry: NavEntry, index: number, measure: boolean) => {
        const id = slug(entry.label);
        const active = isEntryActive(entry);

        if (entry.kind === 'link') {
            const button = (
                <Button
                    ref={measure ? (node) => void (measureEntryRefs.current[index] = node) : undefined}
                    type={measure ? 'button' : undefined}
                    variant="ghost"
                    className={cn('h-9 shrink-0 whitespace-nowrap px-3', active && activeClass)}
                    tabIndex={measure ? -1 : undefined}
                    data-testid={measure ? `main-nav-measure-${id}` : undefined}
                >
                    {entry.label}
                </Button>
            );
            return measure ? (
                <React.Fragment key={`measure-${id}`}>{button}</React.Fragment>
            ) : (
                <Link key={entry.href} href={entry.href} onClick={onNavigate} data-testid={`main-nav-link-${id}`}>
                    {button}
                </Link>
            );
        }

        const { primary } = entry;
        const labelButton = primary ? (
            <Button variant="ghost" className="h-9 shrink-0 whitespace-nowrap rounded-r-none pl-3 pr-1.5 hover:bg-transparent" tabIndex={measure ? -1 : undefined}>
                {entry.label}
            </Button>
        ) : null;
        const chevronButton = (
            <Button
                variant="ghost"
                className={cn(
                    'h-9 shrink-0 gap-1 whitespace-nowrap hover:bg-transparent',
                    primary ? 'w-7 rounded-l-none px-0' : 'px-3'
                )}
                tabIndex={measure ? -1 : undefined}
                aria-label={measure ? undefined : primary ? `More in ${entry.label}` : undefined}
                data-testid={measure ? undefined : `main-nav-group-trigger-${id}`}
            >
                {primary ? null : entry.label}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
        );

        return (
            <div
                key={measure ? `measure-${id}` : `group-${id}`}
                ref={measure ? (node) => void (measureEntryRefs.current[index] = node) : undefined}
                className={cn('flex h-9 shrink-0 items-center rounded-md transition-colors hover:bg-accent/60', active && activeClass)}
                data-testid={measure ? `main-nav-measure-${id}` : `main-nav-group-${id}`}
            >
                {measure ? (
                    <>
                        {labelButton}
                        {chevronButton}
                    </>
                ) : (
                    <>
                        {primary && (
                            <Link href={primary.href} onClick={onNavigate} data-testid={`main-nav-link-${id}`}>
                                {labelButton}
                            </Link>
                        )}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>{chevronButton}</DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56" sideOffset={8}>
                                {entry.pages.map((page) => (
                                    <DropdownMenuItem
                                        key={page.href}
                                        className={cn(isActive(page.href) && activeClass)}
                                        onSelect={() => go(page.href)}
                                        data-testid={`main-nav-group-item-${slug(page.label)}`}
                                    >
                                        {page.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </>
                )}
            </div>
        );
    };

    return (
        <div ref={containerRef} className={cn('relative min-w-0 flex-1', className)} data-testid="main-nav-container">
            <div className="pointer-events-none absolute left-0 top-0 -z-10 flex whitespace-nowrap opacity-0" aria-hidden="true">
                <div className="flex items-center gap-2">
                    {NAV_ENTRIES.map((entry, index) => renderEntry(entry, index, true))}
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
                {visibleEntries.map((entry, index) => renderEntry(entry, index, false))}

                {overflowEntries.length > 0 ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className={cn('h-9 w-9 shrink-0', overflowEntries.some(isEntryActive) && activeClass)}
                                aria-label="Open navigation menu"
                                data-testid="main-nav-overflow-trigger"
                            >
                                <Menu className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-64" sideOffset={8}>
                            {/* Whatever does not fit keeps its grouping, so the menu is labelled rather than a flat list. */}
                            {overflowEntries.map((entry, index) => {
                                const pages = entry.kind === 'link' ? [entry] : entry.pages;
                                return (
                                    <React.Fragment key={`overflow-${slug(entry.label)}`}>
                                        {index > 0 && <DropdownMenuSeparator />}
                                        {entry.kind === 'group' && (
                                            <DropdownMenuLabel className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                {entry.label}
                                            </DropdownMenuLabel>
                                        )}
                                        {pages.map((page) => (
                                            <DropdownMenuItem
                                                key={`overflow-${page.href}`}
                                                className={cn(isActive(page.href) && activeClass)}
                                                onSelect={() => go(page.href)}
                                                data-testid={`main-nav-overflow-item-${slug(page.label)}`}
                                            >
                                                {page.label}
                                            </DropdownMenuItem>
                                        ))}
                                    </React.Fragment>
                                );
                            })}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </nav>
        </div>
    );
}
