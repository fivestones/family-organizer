'use client';

import React, { useMemo } from 'react';
import { Grid3X3 } from 'lucide-react';
import { db } from '@/lib/db';
import { registerFreeformWidget } from '@/lib/freeform-dashboard/freeform-widget-registry';
import type { FreeformWidgetProps } from '@/lib/freeform-dashboard/types';
import {
    formatDateKeyUTC,
    getAssignedMembersForChoreOnDate,
    sortChoresForDisplay,
    parseSharedScheduleSettings,
    HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
} from '@family-organizer/shared-core';
import { toInitials } from '@/lib/dashboard-utils';
import { getPhotoUrl } from '@/lib/photo-urls';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

interface ChoreRow {
    choreId: string;
    title: string;
    assignedMemberIds: Set<string>;
    completedMemberIds: Set<string>;
    notDoneMemberIds: Set<string>;
}

function ChoreMatrixWidget({ width, height, todayUtc }: FreeformWidgetProps) {
    const { data } = db.useQuery({
        familyMembers: {
            $: { order: { order: 'asc' } },
        },
        chores: {
            assignees: {},
            assignments: { familyMember: {} },
            completions: { completedBy: {} },
        },
        routineMarkerStatuses: {},
        settings: {
            $: {
                where: {
                    name: HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
                },
            },
        },
    });

    const members = (data?.familyMembers ?? []) as any[];
    const todayKey = formatDateKeyUTC(todayUtc);
    const routineMarkerStatuses = useMemo(() => (data?.routineMarkerStatuses as any[]) || [], [data?.routineMarkerStatuses]);
    const scheduleSettings = useMemo(
        () => parseSharedScheduleSettings((data?.settings as any[])?.[0]?.value || null),
        [data?.settings]
    );

    const choreRows: ChoreRow[] = useMemo(() => {
        const allChores = (data?.chores ?? []) as any[];

        // Filter to chores that occur today with at least one assignee
        const todayChores = allChores.filter((chore) => {
            if (!chore.rrule || !chore.startDate) return false;
            const assigned = getAssignedMembersForChoreOnDate(
                chore as Parameters<typeof getAssignedMembersForChoreOnDate>[0],
                todayUtc
            );
            return assigned.length > 0;
        });

        // Sort using the same logic as the chores page
        const sorted = sortChoresForDisplay<any>(todayChores as any, {
            date: todayUtc,
            routineMarkerStatuses,
            chores: allChores,
            scheduleSettings,
        });

        const rows: ChoreRow[] = [];

        for (const { chore } of sorted) {
            const assigned = getAssignedMembersForChoreOnDate(
                chore as Parameters<typeof getAssignedMembersForChoreOnDate>[0],
                todayUtc
            );

            const completedMemberIds = new Set<string>();
            const notDoneMemberIds = new Set<string>();
            for (const c of (chore.completions ?? []) as any[]) {
                if (c.dateDue !== todayKey) continue;
                const completedBy = Array.isArray(c.completedBy) ? c.completedBy[0] : c.completedBy;
                if (!completedBy?.id) continue;
                if (c.completed) {
                    completedMemberIds.add(completedBy.id);
                } else if (c.notDone) {
                    notDoneMemberIds.add(completedBy.id);
                }
            }

            // Only show the row if at least one assigned member is still pending
            const assignedIds = assigned.map((a) => a.id);
            const hasPending = assignedIds.some(
                (id) => !completedMemberIds.has(id) && !notDoneMemberIds.has(id)
            );
            if (!hasPending) continue;

            rows.push({
                choreId: chore.id,
                title: chore.title || 'Untitled',
                assignedMemberIds: new Set(assignedIds),
                completedMemberIds,
                notDoneMemberIds,
            });
        }

        return rows;
    }, [data, todayUtc, todayKey, routineMarkerStatuses, scheduleSettings]);

    // How many rows can fit
    const headerHeight = 36;
    const rowHeight = 36;
    const maxRows = Math.max(1, Math.floor((height - headerHeight) / rowHeight));
    const visibleRows = choreRows.slice(0, maxRows);
    const hiddenCount = choreRows.length - visibleRows.length;

    // Column width for member avatars
    const labelWidth = Math.min(160, Math.max(80, width * 0.3));
    const memberColWidth = members.length > 0 ? Math.min(40, (width - labelWidth - 16) / members.length) : 40;

    return (
        <div className="flex h-full flex-col p-3">
            {/* Header row with member avatars */}
            <div className="mb-1 flex items-center" style={{ height: headerHeight }}>
                <div className="shrink-0 text-xs font-semibold text-slate-500" style={{ width: labelWidth }}>
                    Today&apos;s Chores
                </div>
                <div className="flex flex-1 items-center">
                    {members.map((m) => (
                        <div key={m.id} className="flex items-center justify-center" style={{ width: memberColWidth }}>
                            <Avatar className="h-6 w-6">
                                <AvatarImage src={getPhotoUrl(m.photoUrls, '64')} alt={m.name} />
                                <AvatarFallback className="text-[9px]">{toInitials(m.name)}</AvatarFallback>
                            </Avatar>
                        </div>
                    ))}
                </div>
            </div>

            {/* Chore rows */}
            {visibleRows.map((row) => (
                <div
                    key={row.choreId}
                    className="flex items-center border-t border-slate-100"
                    style={{ height: rowHeight }}
                >
                    <div
                        className="shrink-0 truncate text-xs text-slate-700"
                        style={{ width: labelWidth }}
                        title={row.title}
                    >
                        {row.title}
                    </div>
                    <div className="flex flex-1 items-center">
                        {members.map((m) => {
                            const isAssigned = row.assignedMemberIds.has(m.id);
                            const isCompleted = row.completedMemberIds.has(m.id);
                            const isNotDone = row.notDoneMemberIds.has(m.id);

                            return (
                                <div
                                    key={m.id}
                                    className="flex items-center justify-center"
                                    style={{ width: memberColWidth }}
                                >
                                    {isAssigned ? (
                                        isCompleted ? (
                                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100">
                                                <svg className="h-3 w-3 text-emerald-600" viewBox="0 0 12 12" fill="none">
                                                    <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </div>
                                        ) : isNotDone ? (
                                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100">
                                                <svg className="h-3 w-3 text-slate-400" viewBox="0 0 12 12" fill="none">
                                                    <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                                </svg>
                                            </div>
                                        ) : (
                                            <Avatar className="h-5 w-5 opacity-60">
                                                <AvatarImage src={getPhotoUrl(m.photoUrls, '64')} alt={m.name} />
                                                <AvatarFallback className="text-[8px]">{toInitials(m.name)}</AvatarFallback>
                                            </Avatar>
                                        )
                                    ) : (
                                        <span className="text-slate-200">·</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {hiddenCount > 0 && (
                <div className="mt-1 text-[10px] text-slate-400">+{hiddenCount} more</div>
            )}

            {choreRows.length === 0 && (
                <div className="flex flex-1 items-center justify-center text-xs text-slate-400">
                    No chores today
                </div>
            )}
        </div>
    );
}

registerFreeformWidget({
    meta: {
        type: 'chore-matrix',
        label: 'Chore Matrix',
        icon: Grid3X3,
        description: 'Grid of today\'s chores with family member completion status',
        minWidth: 300,
        minHeight: 200,
        defaultWidth: 600,
        defaultHeight: 350,
        allowMultiple: false,
    },
    component: ChoreMatrixWidget,
});

export default ChoreMatrixWidget;
