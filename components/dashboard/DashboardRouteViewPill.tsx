'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { ArrowRightLeft } from 'lucide-react';
import { useDashboardViewMode } from '@/lib/dashboard-view-mode';

export default function DashboardRouteViewPill() {
    const pathname = usePathname();
    const [viewMode, setViewMode] = useDashboardViewMode();

    const isDashboardRoute = pathname === '/';
    const label = useMemo(
        () => (viewMode === 'family' ? 'Personal View' : 'Family View'),
        [viewMode]
    );

    if (!isDashboardRoute) {
        return null;
    }

    return (
        <button
            type="button"
            onClick={() => setViewMode(viewMode === 'family' ? 'personal' : 'family')}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
        >
            <ArrowRightLeft className="h-3.5 w-3.5 text-slate-500" />
            <span>{label}</span>
        </button>
    );
}
