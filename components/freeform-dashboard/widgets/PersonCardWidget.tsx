'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { User } from 'lucide-react';
import { db } from '@/lib/db';
import { registerFreeformWidget } from '@/lib/freeform-dashboard/freeform-widget-registry';
import type { FreeformWidgetProps } from '@/lib/freeform-dashboard/types';
import {
    calculateDailyXP,
    formatDateKeyUTC,
    getAssignedMembersForChoreOnDate,
    getCompletedChoreCompletionsForDate,
    getMemberCompletionForDate,
    HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
    parseSharedScheduleSettings,
    sortChoresForDisplay,
} from '@family-organizer/shared-core';
import { getPhotoUrl, toInitials, buildCalendarPreviews, addUtcDays, buildMemberBalanceLabel } from '@/lib/dashboard-utils';
import type { DashboardFamilyMember } from '@/lib/dashboard-utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import CalendarEventDetailDialog from '@/components/CalendarEventDetailDialog';

function PersonCardWidget({ config, width, height, todayUtc }: FreeformWidgetProps) {
    const memberId = config.memberId as string | undefined;

    const [detailOpen, setDetailOpen] = useState(false);
    const [detailEventId, setDetailEventId] = useState<string | null>(null);

    const { data } = db.useQuery({
        familyMembers: {
            $: { order: { order: 'asc' } },
            allowanceEnvelopes: {},
        },
        unitDefinitions: {},
        chores: {
            assignees: {},
            assignments: { familyMember: {} },
            completions: { completedBy: {} },
            taskSeries: { tasks: { parentTask: {} } },
        },
        calendarItems: { pertainsTo: {} },
        messageThreads: {},
        routineMarkerStatuses: {},
        settings: {
            $: { where: { name: HOUSEHOLD_SCHEDULE_SETTINGS_NAME } },
        },
    });

    const member = useMemo(
        () => ((data?.familyMembers ?? []) as any[]).find((m) => m.id === memberId),
        [data?.familyMembers, memberId]
    );

    const stats = useMemo(() => {
        if (!member || !data) return null;

        const chores = (data.chores ?? []) as any[];
        const calendarItems = (data.calendarItems ?? []) as any[];
        const unitDefs = (data.unitDefinitions ?? []) as any[];
        const todayKey = formatDateKeyUTC(todayUtc);
        const routineMarkerStatuses = (data.routineMarkerStatuses ?? []) as any[];
        const scheduleSettings = parseSharedScheduleSettings(((data.settings ?? []) as any[])?.[0]?.value ?? null);

        // Filter to chores assigned to this member today
        const memberChores: any[] = [];
        let choresRemaining = 0;
        let choresTotalToday = 0;

        for (const chore of chores) {
            if (!chore.rrule || !chore.startDate) continue;
            const assigned = getAssignedMembersForChoreOnDate(chore, todayUtc);
            const isAssigned = assigned.some((a: any) => a.id === member.id);
            if (!isAssigned) continue;

            choresTotalToday++;
            const completion = getMemberCompletionForDate(
                chore.completions ?? [],
                todayKey,
                member.id
            );
            // Skip chores with any completion record (done or explicitly marked "not done")
            if (completion) continue;
            choresRemaining++;
            memberChores.push(chore);
        }

        // Sort using the same logic as the chores page
        const sorted = sortChoresForDisplay<any>(memberChores, {
            date: todayUtc,
            routineMarkerStatuses,
            chores,
            scheduleSettings,
        });

        // Find first incomplete chore in sorted order
        let nextChoreTitle: string | null = null;
        let nextTaskTitle: string | null = null;
        let tasksRemaining = 0;

        for (const { chore } of sorted) {
            if (!nextChoreTitle) nextChoreTitle = chore.title || 'Untitled';

            // Check for task series
            if (!nextTaskTitle && chore.taskSeries?.length) {
                const series = chore.taskSeries[0];
                const tasks = (series?.tasks ?? []).filter((t: { isDayBreak?: boolean; isCompleted?: boolean }) => !t.isDayBreak && !t.isCompleted);
                if (tasks.length > 0 && tasks[0]) {
                    nextTaskTitle = (tasks[0] as { text?: string }).text || 'Task';
                    tasksRemaining = tasks.length;
                }
            }

            if (nextChoreTitle && nextTaskTitle) break;
        }

        // XP
        const xpMap = (calculateDailyXP as any)(chores, [member], todayUtc) as Record<string, { current: number; possible: number }>;
        const memberXp = xpMap[member.id];

        // Calendar preview — exclude family-wide events
        const memberCalendar = buildCalendarPreviews(calendarItems, todayUtc, member.id, 1, true);

        // Finance
        const balanceLabel = buildMemberBalanceLabel(member as DashboardFamilyMember, unitDefs);

        return {
            choresRemaining,
            choresTotalToday,
            tasksRemaining,
            nextChoreTitle,
            nextTaskTitle,
            xpCurrent: memberXp?.current ?? 0,
            xpPossible: memberXp?.possible ?? 0,
            nextCalendarItem: memberCalendar[0] ?? null,
            balanceLabel,
        };
    }, [member, data, todayUtc]);

    const detailEvent = useMemo(() => {
        if (!detailEventId || !data?.calendarItems) return null;
        return ((data.calendarItems ?? []) as any[]).find((item) => item.id === detailEventId) ?? null;
    }, [detailEventId, data?.calendarItems]);

    const handleCalendarDoubleClick = useCallback((eventId: string) => {
        setDetailEventId(eventId);
        setDetailOpen(true);
    }, []);

    if (!member) {
        return (
            <div className="flex h-full items-center justify-center p-2 text-xs text-slate-400">
                {memberId ? 'Member not found' : 'No member configured'}
            </div>
        );
    }

    const isNarrow = width < 200;
    const isShort = height < 260;

    return (
        <div className="flex h-full flex-col p-3">
            {/* Avatar + Name */}
            <div className="mb-2 flex items-center gap-2">
                <Avatar className={isNarrow ? 'h-7 w-7' : 'h-8 w-8'}>
                    <AvatarImage src={getPhotoUrl(member)} />
                    <AvatarFallback className="text-xs">{toInitials(member.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">{member.name}</div>
                </div>
            </div>

            {/* Quick stats row */}
            {stats && (
                <>
                    <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                        <span title="XP">
                            ⚡ {stats.xpCurrent}/{stats.xpPossible}
                        </span>
                        <span title="Chores remaining">
                            ✓ {stats.choresTotalToday - stats.choresRemaining}/{stats.choresTotalToday}
                        </span>
                        {stats.tasksRemaining > 0 && (
                            <span title="Tasks remaining">📋 {stats.tasksRemaining}</span>
                        )}
                        {stats.balanceLabel && (
                            <span title="Balance">💰 {stats.balanceLabel}</span>
                        )}
                    </div>

                    {/* Next chore */}
                    {stats.nextChoreTitle && !isShort && (
                        <div className="mb-1.5 rounded-lg bg-slate-50 px-2 py-1.5">
                            <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">Next</div>
                            <div className="truncate text-xs text-slate-700">{stats.nextChoreTitle}</div>
                            {stats.nextTaskTitle && (
                                <div className="mt-0.5 truncate text-[10px] text-slate-500">→ {stats.nextTaskTitle}</div>
                            )}
                        </div>
                    )}

                    {/* Next calendar item */}
                    {stats.nextCalendarItem && !isShort && (
                        <div
                            className="mt-auto cursor-pointer rounded-lg bg-blue-50 px-2 py-1.5 transition-colors hover:bg-blue-100"
                            onDoubleClick={() => handleCalendarDoubleClick(stats.nextCalendarItem!.id)}
                        >
                            <div className="truncate text-xs font-medium text-blue-700">{stats.nextCalendarItem.title}</div>
                            <div className="text-[10px] text-blue-500">{stats.nextCalendarItem.relativeLabel}</div>
                            <div className="text-[10px] text-blue-400">{stats.nextCalendarItem.dateLabel}</div>
                        </div>
                    )}
                </>
            )}

            <CalendarEventDetailDialog
                event={detailEvent}
                open={detailOpen}
                onOpenChange={setDetailOpen}
                onEdit={() => setDetailOpen(false)}
            />
        </div>
    );
}

registerFreeformWidget({
    meta: {
        type: 'person-card',
        label: 'Person Card',
        icon: User,
        description: 'Compact card showing one family member\'s status, chores, and next items',
        minWidth: 160,
        minHeight: 200,
        defaultWidth: 180,
        defaultHeight: 220,
        allowMultiple: true,
        configFields: [{ key: 'memberId', label: 'Family Member', type: 'family-member', required: true }],
    },
    component: PersonCardWidget,
});

export default PersonCardWidget;
