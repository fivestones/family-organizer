'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { db } from '@/lib/db';
import { localDateToUTC } from '@family-organizer/shared-core';
import { type DashboardFamilyMember } from '@/lib/dashboard-utils';
import { resolveDashboardConfig, getEnabledWidgetsInOrder, type DashboardConfig } from '@/lib/dashboard-config';
import { getAllWidgets, getDefaultWidgetOrder, getDefaultDisabledWidgets } from './widgets/registry';
import DashboardHeader from './DashboardHeader';
import WidgetGrid from './WidgetGrid';

const SELECTED_MEMBER_KEY = 'dashboard-selected-member';

interface PersonalDashboardProps {
    onSwitchToFamily: () => void;
}

export default function PersonalDashboard({ onSwitchToFamily }: PersonalDashboardProps) {
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

    useEffect(() => {
        try {
            const saved = localStorage.getItem(SELECTED_MEMBER_KEY);
            if (saved) setSelectedMemberId(saved);
        } catch { /* ignore */ }
    }, []);

    const { data, isLoading, error } = db.useQuery({
        familyMembers: {
            $: { order: { order: 'asc' } },
            dashboardConfig: {},
        },
    });

    const familyMembers = useMemo(
        () => ((data?.familyMembers || []) as unknown as (DashboardFamilyMember & { dashboardConfig?: any })[]).filter((m) => !!m?.id),
        [data?.familyMembers]
    );

    const activeMemberId = selectedMemberId || familyMembers[0]?.id || null;
    const activeMember = familyMembers.find((m) => m.id === activeMemberId) || null;

    const selectMember = (id: string) => {
        setSelectedMemberId(id);
        try { localStorage.setItem(SELECTED_MEMBER_KEY, id); } catch { /* ignore */ }
    };

    const todayUtc = useMemo(() => localDateToUTC(new Date()), []);
    const todayLabel = todayUtc.toLocaleDateString(undefined, {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    });

    // Resolve widget config for active member
    const enabledWidgetIds = useMemo(() => {
        const allWidgetIds = getAllWidgets().map((w) => w.meta.id);
        const storedConfig = activeMember
            ? ((activeMember as any).dashboardConfig?.[0] || null) as Partial<DashboardConfig> | null
            : null;

        const resolved = resolveDashboardConfig(
            storedConfig,
            allWidgetIds,
            getDefaultWidgetOrder(),
            getDefaultDisabledWidgets()
        );

        return getEnabledWidgetsInOrder(resolved);
    }, [activeMember]);

    if (isLoading) {
        return (
            <div className="h-full w-full overflow-auto bg-gradient-to-br from-slate-50 via-white to-amber-50/60">
                <div className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6">
                    <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                        <p className="text-sm text-slate-600">Loading dashboard...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full w-full overflow-auto bg-gradient-to-br from-slate-50 via-white to-amber-50/60">
                <div className="mx-auto w-full max-w-[1800px] px-4 py-8 sm:px-6">
                    <div className="rounded-2xl border border-red-200 bg-red-50/70 p-8 shadow-sm">
                        <p className="text-sm font-medium text-red-700">Dashboard failed to load.</p>
                        <p className="mt-2 text-sm text-red-600">{error.message}</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-auto bg-[radial-gradient(circle_at_top_left,_#fefce8_0%,_#f8fafc_40%,_#ffffff_100%)]">
            <div className="mx-auto w-full max-w-[1800px] px-3 py-3 sm:px-4">
                {activeMemberId && (
                    <WidgetGrid
                        memberId={activeMemberId}
                        todayUtc={todayUtc}
                        enabledWidgetIds={enabledWidgetIds}
                        headerSlot={
                            <DashboardHeader
                                activeMember={activeMember}
                                familyMembers={familyMembers}
                                todayLabel={todayLabel}
                                todayUtc={todayUtc}
                                onSelectMember={selectMember}
                                onSwitchToFamily={onSwitchToFamily}
                            />
                        }
                    />
                )}
            </div>
        </div>
    );
}
