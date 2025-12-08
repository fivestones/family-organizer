// components/MainNav.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// +++ Added className and onNavigate props for mobile menu reuse +++
interface MainNavProps {
    className?: string;
    onNavigate?: () => void;
}

export function MainNav({ className, onNavigate }: MainNavProps) {
    const pathname = usePathname();

    const links = [
        { href: '/', label: 'Chores' },
        { href: '/calendar', label: 'Calendar' },
        { href: '/task-series', label: 'Task Series' },
        { href: '/familyMemberDetail', label: 'Manage Allowance and Finances' },
        { href: '/allowance-distribution', label: 'Allowance Distribution' },
        { href: '/settings', label: 'Settings' },
    ];

    const isActive = (href: string) => {
        // Exact match for root
        if (href === '/') return pathname === '/';
        // Prefix match for other sections (e.g. /task-series/new matches /task-series)
        return pathname.startsWith(href);
    };

    return (
        <nav className={cn('flex items-center gap-2', className)}>
            {links.map(({ href, label }) => (
                <Link key={href} href={href} onClick={onNavigate}>
                    <Button
                        variant="ghost"
                        className={cn(
                            // If active, force the "accent" background (same as hover state)
                            isActive(href) && 'bg-accent text-accent-foreground',
                            // +++ Add w-full for mobile vertical layout +++
                            'w-full justify-start'
                        )}
                    >
                        {label}
                    </Button>
                </Link>
            ))}
        </nav>
    );
}
