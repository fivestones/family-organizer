'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { User } from 'lucide-react';
import { db } from '@/lib/db';
import { registerFreeformWidget } from '@/lib/freeform-dashboard/freeform-widget-registry';
import type { FreeformWidgetProps } from '@/lib/freeform-dashboard/types';
import {
    calculateDailyXP,
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
import { useWidgetScale } from '@/lib/freeform-dashboard/widget-scale';

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
            const completion = getMemberCompletionForDate(chore, member.id, todayUtc) as any;
            // Skip chores that are done or explicitly marked "not done"
            if (completion?.completed || completion?.notDone) continue;
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

    const { s, sv } = useWidgetScale();

    if (!member) {
        return (
            <div className="flex h-full items-center justify-center text-slate-400" style={{ padding: s(8), fontSize: sv(12) }}>
                {memberId ? 'Member not found' : 'No member configured'}
            </div>
        );
    }

    const avatarSize = s(32);
    const isShort = height < 260;

    return (
        <div className="flex h-full flex-col" style={{ padding: s(12) }}>
            {/* Avatar + Name */}
            <div className="flex items-center" style={{ marginBottom: s(8), gap: s(8) }}>
                <Avatar style={{ width: avatarSize, height: avatarSize }}>
                    <AvatarImage src={getPhotoUrl(member)} />
                    <AvatarFallback style={{ fontSize: sv(12) }}>{toInitials(member.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900" style={{ fontSize: sv(14) }}>{member.name}</div>
                </div>
            </div>

            {/* Quick stats row */}
            {stats && (
                <>
                    <div className="flex flex-wrap text-slate-500" style={{ marginBottom: s(8), gap: `${s(4)}px ${s(12)}px`, fontSize: sv(10) }}>
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
                        <div className="rounded-lg bg-slate-50" style={{ marginBottom: s(6), padding: `${s(4)}px ${s(4)}px` }}>
                            <div className="font-medium uppercase tracking-wider text-slate-400" style={{ fontSize: sv(10) }}>Next</div>
                            <div className="text-slate-700" style={{ fontSize: sv(12), lineHeight: 1.3 }}>{stats.nextChoreTitle}</div>
                            {stats.nextTaskTitle && (
                                <div className="text-slate-500" style={{ marginTop: s(2), fontSize: sv(10), lineHeight: 1.3 }}>→ {stats.nextTaskTitle}</div>
                            )}
                        </div>
                    )}

                    {/* Next calendar item */}
                    {stats.nextCalendarItem && !isShort && (
                        <div
                            className="cursor-pointer rounded-lg bg-blue-50 transition-colors hover:bg-blue-100"
                            style={{ padding: `${s(6)}px ${s(8)}px` }}
                            onDoubleClick={() => handleCalendarDoubleClick(stats.nextCalendarItem!.id)}
                        >
                            <div className="truncate font-medium text-blue-700" style={{ fontSize: sv(12) }}>{stats.nextCalendarItem.title}</div>
                            <div className="text-blue-500" style={{ fontSize: sv(10) }}>{stats.nextCalendarItem.relativeLabel}</div>
                            <div className="text-blue-400" style={{ fontSize: sv(10) }}>{stats.nextCalendarItem.dateLabel}</div>
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
