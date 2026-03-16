'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
    CalendarDays,
    CheckCircle2,
    ChevronDown,
    Gift,
    ListTodo,
    MessageCircle,
    Users,
    Wallet2,
} from 'lucide-react';
import { db } from '@/lib/db';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { formatBalances, type UnitDefinition } from '@/lib/currency-utils';
import {
    calculateDailyXP,
    formatDateKeyUTC,
    getAssignedMembersForChoreOnDate,
    getCompletedChoreCompletionsForDate,
    getMemberCompletionForDate,
    localDateToUTC,
} from '@family-organizer/shared-core';
import { getTasksForDate, type Task } from '@/lib/task-scheduler';
import { hasScheduledChildren } from '@/lib/task-series-progress';
import { getTaskWorkflowState } from '@/lib/task-progress';
import { getThreadDisplayName, getThreadPreviewText } from '@/lib/message-thread-display';
import {
    addUtcDays,
    buildCalendarPreviews,
    buildDueLabel,
    buildMemberBalanceLabel,
    buildMemberTotalBalances,
    completionMemberId,
    dayDiff,
    firstRef,
    formatTimeAgo,
    getPhotoUrl,
    toInitials,
    type CalendarPreview,
    type DashboardCalendarItem,
    type DashboardChoreCompletion,
    type DashboardFamilyMember,
} from '@/lib/dashboard-utils';

const SELECTED_MEMBER_KEY = 'dashboard-selected-member';
const UPCOMING_LOOKAHEAD_DAYS = 3;

type TaskSeriesRecord = {
    id: string;
    name?: string | null;
    startDate?: string | null;
    familyMember?: { id?: string; name?: string } | Array<{ id?: string; name?: string }> | null;
    tasks?: Task[] | null;
};

type ChoreRecord = {
    id: string;
    title?: string | null;
    description?: string | null;
    startDate: string;
    rrule?: string | null;
    exdates?: string[] | null;
    rewardType?: string | null;
    weight?: number | null;
    isUpForGrabs?: boolean | null;
    isJoint?: boolean | null;
    assignees?: Array<{ id: string; name?: string }> | null;
    assignments?: Array<{ order: number; familyMember?: { id: string; name?: string } | Array<{ id: string; name?: string }> | null }> | null;
    completions?: DashboardChoreCompletion[] | null;
    taskSeries?: TaskSeriesRecord[] | null;
};

type PersonalChore = {
    id: string;
    title: string;
    weight: number;
    isCompleted: boolean;
    isUpForGrabs: boolean;
    claimedByOther: boolean;
};

type PersonalTaskGroup = {
    seriesId: string;
    seriesName: string;
    choreTitle: string;
    tasks: Array<{
        id: string;
        text: string;
        workflowState: string;
        isCompleted: boolean;
    }>;
};

type UpcomingChore = {
    key: string;
    title: string;
    dueDate: Date;
    dueLabel: string;
    isUpForGrabs: boolean;
};

type UnreadThread = {
    id: string;
    displayName: string;
    previewText: string;
    latestMessageAt: string;
};

type ActivityItem = {
    key: string;
    label: string;
    timestamp: string;
    type: 'completion';
};

interface PersonalDashboardProps {
    onSwitchToFamily: () => void;
}

export default function PersonalDashboard({ onSwitchToFamily }: PersonalDashboardProps) {
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
    const [upcomingExpanded, setUpcomingExpanded] = useState(false);

    useEffect(() => {
        try {
            const saved = localStorage.getItem(SELECTED_MEMBER_KEY);
            if (saved) setSelectedMemberId(saved);
        } catch { /* ignore */ }
    }, []);

    const { data, isLoading, error } = db.useQuery({
        familyMembers: {
            $: { order: { order: 'asc' } },
            allowanceEnvelopes: {},
        },
        unitDefinitions: {},
        chores: {
            assignees: {},
            assignments: { familyMember: {} },
            completions: { completedBy: {} },
            taskSeries: {
                tasks: { parentTask: {} },
                familyMember: {},
            },
        },
        calendarItems: {
            pertainsTo: {},
        },
        messageThreads: {
            members: {},
        },
    });

    const todayUtc = useMemo(() => localDateToUTC(new Date()), []);
    const todayKey = useMemo(() => formatDateKeyUTC(todayUtc), [todayUtc]);

    const familyMembers = useMemo(
        () => ((data?.familyMembers || []) as unknown as DashboardFamilyMember[]).filter((m) => !!m?.id),
        [data?.familyMembers]
    );

    const activeMemberId = selectedMemberId || familyMembers[0]?.id || null;
    const activeMember = familyMembers.find((m) => m.id === activeMemberId) || null;

    const selectMember = (id: string) => {
        setSelectedMemberId(id);
        try { localStorage.setItem(SELECTED_MEMBER_KEY, id); } catch { /* ignore */ }
    };

    const unitDefinitions = useMemo(() => (data?.unitDefinitions || []) as UnitDefinition[], [data?.unitDefinitions]);
    const chores = useMemo(() => (data?.chores || []) as unknown as ChoreRecord[], [data?.chores]);
    const calendarItems = useMemo(() => (data?.calendarItems || []) as unknown as DashboardCalendarItem[], [data?.calendarItems]);

    // ---------- Today's Chores ----------
    const { assignedChores, upForGrabsChores, completedCount } = useMemo(() => {
        if (!activeMemberId) return { assignedChores: [] as PersonalChore[], upForGrabsChores: [] as PersonalChore[], completedCount: 0 };

        const assigned: PersonalChore[] = [];
        const upForGrabs: PersonalChore[] = [];
        let completed = 0;

        chores.forEach((chore) => {
            const assignedMembers = getAssignedMembersForChoreOnDate(chore as any, todayUtc);
            if (!assignedMembers.some((m) => m.id === activeMemberId)) return;

            const memberCompletion = getMemberCompletionForDate(chore as any, activeMemberId, todayUtc);
            const isCompleted = !!memberCompletion?.completed;

            const completionsOnDate = getCompletedChoreCompletionsForDate(chore as any, todayUtc) as DashboardChoreCompletion[];
            const firstCompleterId = completionMemberId(completionsOnDate.find((c) => completionMemberId(c)));
            const claimedByOther = !!(chore.isUpForGrabs && firstCompleterId && firstCompleterId !== activeMemberId);

            if (isCompleted) completed += 1;

            const entry: PersonalChore = {
                id: chore.id,
                title: chore.title || 'Untitled chore',
                weight: Number(chore.weight || 0),
                isCompleted,
                isUpForGrabs: !!chore.isUpForGrabs,
                claimedByOther,
            };

            if (chore.isUpForGrabs) {
                upForGrabs.push(entry);
            } else {
                assigned.push(entry);
            }
        });

        return {
            assignedChores: assigned.sort((a, b) => a.title.localeCompare(b.title)),
            upForGrabsChores: upForGrabs.sort((a, b) => a.title.localeCompare(b.title)),
            completedCount: completed,
        };
    }, [chores, activeMemberId, todayUtc]);

    // ---------- XP ----------
    const xp = useMemo(() => {
        if (!activeMemberId) return { current: 0, possible: 0 };
        const xpByMember = calculateDailyXP(chores as any, familyMembers as any, todayUtc);
        return xpByMember[activeMemberId] || { current: 0, possible: 0 };
    }, [chores, familyMembers, activeMemberId, todayUtc]);

    const xpPercent = xp.possible > 0 ? Math.round((xp.current / xp.possible) * 100) : 0;

    // ---------- Today's Tasks ----------
    const taskGroups = useMemo(() => {
        if (!activeMemberId) return [] as PersonalTaskGroup[];
        const groups: PersonalTaskGroup[] = [];

        chores.forEach((chore) => {
            const assignedMembers = getAssignedMembersForChoreOnDate(chore as any, todayUtc);
            if (!assignedMembers.some((m) => m.id === activeMemberId)) return;

            const assignedIds = new Set(assignedMembers.map((m) => m.id));

            chore.taskSeries?.forEach((series) => {
                const allTasks = [...(series.tasks || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
                if (!allTasks.length) return;

                const owner = firstRef(series.familyMember);
                if (owner?.id && !assignedIds.has(owner.id)) return;
                if (owner?.id && owner.id !== activeMemberId) return;

                const scheduledTasks = getTasksForDate(
                    allTasks,
                    chore.rrule || null,
                    chore.startDate,
                    todayUtc,
                    series.startDate || null,
                    chore.exdates || null
                );
                if (!scheduledTasks.length) return;

                const scheduledIds = new Set(scheduledTasks.map((t) => t.id));
                const actionableTasks = scheduledTasks.filter((t) => !hasScheduledChildren(t.id, scheduledIds, allTasks));

                if (!actionableTasks.length) return;

                groups.push({
                    seriesId: series.id,
                    seriesName: series.name || 'Task series',
                    choreTitle: chore.title || 'Untitled chore',
                    tasks: actionableTasks.map((t) => ({
                        id: t.id,
                        text: t.text || '',
                        workflowState: getTaskWorkflowState(t as any),
                        isCompleted: !!t.isCompleted,
                    })),
                });
            });
        });

        return groups;
    }, [chores, activeMemberId, todayUtc]);

    // ---------- Calendar Events ----------
    const calendarPreviews = useMemo(
        () => buildCalendarPreviews(calendarItems, todayUtc, activeMemberId, 10),
        [calendarItems, todayUtc, activeMemberId]
    );

    // ---------- Unread Messages ----------
    const unreadThreads = useMemo(() => {
        if (!activeMemberId || !data?.messageThreads) return [] as UnreadThread[];

        const threads = data.messageThreads as any[];
        const familyMemberNamesById = new Map(familyMembers.map((m) => [m.id, m.name]));
        const result: UnreadThread[] = [];

        for (const thread of threads) {
            if (!thread.latestMessageAt) continue;

            const membership = (thread.members || []).find(
                (m: any) => m.familyMemberId === activeMemberId
            );
            if (!membership) continue;
            if (membership.isArchived) continue;

            const lastRead = membership.lastReadAt || '';
            if (thread.latestMessageAt > lastRead) {
                result.push({
                    id: thread.id,
                    displayName: getThreadDisplayName(thread, familyMemberNamesById, activeMemberId),
                    previewText: getThreadPreviewText(thread),
                    latestMessageAt: thread.latestMessageAt,
                });
            }
        }

        return result.sort((a, b) => b.latestMessageAt.localeCompare(a.latestMessageAt));
    }, [data?.messageThreads, activeMemberId, familyMembers]);

    // ---------- Currency Totals ----------
    const balances = useMemo(() => {
        if (!activeMember) return {} as Record<string, number>;
        return buildMemberTotalBalances(activeMember);
    }, [activeMember]);

    const balanceLabel = useMemo(
        () => (activeMember ? buildMemberBalanceLabel(activeMember, unitDefinitions) : ''),
        [activeMember, unitDefinitions]
    );

    // ---------- Upcoming Chores (next 2-3 days) ----------
    const upcomingChores = useMemo(() => {
        if (!activeMemberId) return [] as UpcomingChore[];
        const items: UpcomingChore[] = [];

        for (let offset = 1; offset <= UPCOMING_LOOKAHEAD_DAYS; offset++) {
            const futureDate = addUtcDays(todayUtc, offset);
            const futureDateKey = formatDateKeyUTC(futureDate);

            chores.forEach((chore) => {
                const assignedMembers = getAssignedMembersForChoreOnDate(chore as any, futureDate);
                if (!assignedMembers.some((m) => m.id === activeMemberId)) return;

                const memberCompletion = getMemberCompletionForDate(chore as any, activeMemberId, futureDate);
                if (memberCompletion?.completed) return;

                items.push({
                    key: `${chore.id}:${futureDateKey}`,
                    title: chore.title || 'Untitled chore',
                    dueDate: futureDate,
                    dueLabel: buildDueLabel(futureDate, todayUtc),
                    isUpForGrabs: !!chore.isUpForGrabs,
                });
            });
        }

        return items.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    }, [chores, activeMemberId, todayUtc]);

    // ---------- Recent Activity ----------
    const recentActivity = useMemo(() => {
        if (!activeMemberId) return [] as ActivityItem[];
        const items: ActivityItem[] = [];

        chores.forEach((chore) => {
            (chore.completions || []).forEach((completion) => {
                if (!completion.completed) return;
                const cMemberId = completionMemberId(completion);
                if (cMemberId !== activeMemberId) return;

                const dateDue = completion.dateDue || '';
                if (dateDue !== todayKey) return;

                items.push({
                    key: `completion:${completion.id}`,
                    label: `Completed "${chore.title || 'chore'}"`,
                    timestamp: completion.dateCompleted || dateDue,
                    type: 'completion',
                });
            });
        });

        return items
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
            .slice(0, 6);
    }, [chores, activeMemberId, todayKey]);

    if (isLoading) {
        return (
            <div className="h-full w-full overflow-auto bg-gradient-to-br from-slate-50 via-white to-amber-50/60">
                <div className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6">
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
                <div className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6">
                    <div className="rounded-2xl border border-red-200 bg-red-50/70 p-8 shadow-sm">
                        <p className="text-sm font-medium text-red-700">Dashboard failed to load.</p>
                        <p className="mt-2 text-sm text-red-600">{error.message}</p>
                    </div>
                </div>
            </div>
        );
    }

    const todayLabel = todayUtc.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const statusTone: Record<string, string> = {
        not_started: 'bg-slate-100 text-slate-700',
        in_progress: 'bg-amber-100 text-amber-800',
        blocked: 'bg-rose-100 text-rose-700',
        skipped: 'bg-zinc-100 text-zinc-600',
        needs_review: 'bg-violet-100 text-violet-700',
        done: 'bg-emerald-100 text-emerald-700',
    };

    return (
        <div className="h-full w-full overflow-auto bg-[radial-gradient(circle_at_top_left,_#fefce8_0%,_#f8fafc_40%,_#ffffff_100%)]">
            <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-3 py-4 sm:px-6">

                {/* ===== HEADER ===== */}
                <header className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            {activeMember && (
                                <Avatar className="h-12 w-12 border-2 border-slate-200">
                                    {getPhotoUrl(activeMember) ? (
                                        <AvatarImage src={getPhotoUrl(activeMember)} alt={activeMember.name} />
                                    ) : null}
                                    <AvatarFallback className="bg-slate-100 text-sm font-semibold text-slate-700">
                                        {toInitials(activeMember.name)}
                                    </AvatarFallback>
                                </Avatar>
                            )}
                            <div>
                                <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                                    {activeMember?.name ? `${activeMember.name}'s Dashboard` : 'Personal Dashboard'}
                                </h1>
                                <p className="text-xs text-slate-600">{todayLabel}</p>
                            </div>
                        </div>
                        <button
                            onClick={onSwitchToFamily}
                            className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                        >
                            <Users className="h-3.5 w-3.5" />
                            Family View
                        </button>
                    </div>

                    {/* Member switcher strip */}
                    {familyMembers.length > 1 && (
                        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1">
                            {familyMembers.map((member) => {
                                const isActive = member.id === activeMemberId;
                                return (
                                    <button
                                        key={member.id}
                                        onClick={() => selectMember(member.id)}
                                        className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                                            isActive
                                                ? 'border-blue-300 bg-blue-50 text-blue-800'
                                                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                        }`}
                                    >
                                        <Avatar className="h-5 w-5">
                                            {getPhotoUrl(member) ? (
                                                <AvatarImage src={getPhotoUrl(member)} alt={member.name} />
                                            ) : null}
                                            <AvatarFallback className="text-[8px]">
                                                {toInitials(member.name)}
                                            </AvatarFallback>
                                        </Avatar>
                                        {member.name}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </header>

                {/* ===== XP PROGRESS BAR ===== */}
                <section className="rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm">
                    <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">Daily XP</span>
                        <span className="font-semibold text-slate-900">{xp.current}/{xp.possible}</span>
                    </div>
                    <div className="mt-1.5 h-3 overflow-hidden rounded-full bg-slate-100">
                        <div
                            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-600 transition-all duration-500"
                            style={{ width: `${xpPercent}%` }}
                        />
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">{xpPercent}% complete</p>
                </section>

                {/* ===== TODAY'S CHORES ===== */}
                <section className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                        <CheckCircle2 className="h-4 w-4" />
                        Today&apos;s Chores
                        <span className="ml-auto text-[10px] font-normal normal-case text-slate-500">
                            {completedCount}/{assignedChores.length + upForGrabsChores.length} done
                        </span>
                    </div>

                    {assignedChores.length === 0 && upForGrabsChores.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500">No chores assigned for today.</p>
                    ) : (
                        <>
                            {assignedChores.length > 0 && (
                                <ul className="mt-3 space-y-1.5">
                                    {assignedChores.map((chore) => (
                                        <li
                                            key={chore.id}
                                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                                                chore.isCompleted
                                                    ? 'border-emerald-200 bg-emerald-50/50 text-slate-500 line-through'
                                                    : 'border-slate-200 bg-white text-slate-900'
                                            }`}
                                        >
                                            <span className="truncate">{chore.title}</span>
                                            {chore.weight > 0 && (
                                                <span className="ml-2 shrink-0 text-[10px] font-semibold text-slate-400">
                                                    {chore.weight} XP
                                                </span>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            {upForGrabsChores.length > 0 && (
                                <div className="mt-3">
                                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                                        <Gift className="h-3.5 w-3.5" />
                                        Available to Claim
                                    </div>
                                    <ul className="mt-1.5 space-y-1.5">
                                        {upForGrabsChores.map((chore) => (
                                            <li
                                                key={chore.id}
                                                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                                                    chore.isCompleted
                                                        ? 'border-emerald-200 bg-emerald-50/50 text-slate-500 line-through'
                                                        : chore.claimedByOther
                                                            ? 'border-slate-200 bg-slate-50 text-slate-400'
                                                            : 'border-amber-200 bg-amber-50/50 text-slate-900'
                                                }`}
                                            >
                                                <span className="truncate">
                                                    {chore.title}
                                                    {chore.claimedByOther && (
                                                        <span className="ml-1.5 text-[10px] text-slate-400">(claimed)</span>
                                                    )}
                                                </span>
                                                {chore.weight > 0 && (
                                                    <span className="ml-2 shrink-0 text-[10px] font-semibold text-amber-500">
                                                        {chore.weight} XP
                                                    </span>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </>
                    )}
                </section>

                {/* ===== TODAY'S TASKS ===== */}
                {taskGroups.length > 0 && (
                    <section className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                            <ListTodo className="h-4 w-4" />
                            Today&apos;s Tasks
                        </div>

                        <div className="mt-3 space-y-3">
                            {taskGroups.map((group) => (
                                <div key={group.seriesId} className="rounded-lg border border-slate-200 p-3">
                                    <p className="text-xs font-semibold text-slate-900">{group.seriesName}</p>
                                    <p className="text-[10px] text-slate-500">{group.choreTitle}</p>

                                    <ul className="mt-2 space-y-1">
                                        {group.tasks.map((task) => (
                                            <li
                                                key={task.id}
                                                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                                                    task.isCompleted ? 'text-slate-400 line-through' : 'text-slate-800'
                                                }`}
                                            >
                                                <span
                                                    className={`inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                                                        statusTone[task.workflowState] || statusTone.not_started
                                                    }`}
                                                >
                                                    {task.workflowState.replace('_', ' ')}
                                                </span>
                                                <span className="truncate">{task.text}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* ===== CALENDAR EVENTS ===== */}
                <section className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                        <CalendarDays className="h-4 w-4" />
                        Calendar
                    </div>

                    {calendarPreviews.length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500">No upcoming events.</p>
                    ) : (
                        <ul className="mt-3 space-y-1.5">
                            {calendarPreviews.map((item) => (
                                <li key={item.id} className="flex items-start justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-medium text-slate-900">{item.title}</p>
                                        <p className="text-[11px] text-slate-600">{item.timeLabel}</p>
                                    </div>
                                    {item.isFamilyWide && (
                                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold uppercase text-slate-500">
                                            Family
                                        </span>
                                    )}
                                    {item.isAllDay && !item.isFamilyWide && (
                                        <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-semibold uppercase text-blue-600">
                                            All day
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {/* ===== UNREAD MESSAGES ===== */}
                {unreadThreads.length > 0 && (
                    <section className="rounded-xl border border-indigo-200 bg-white/95 p-4 shadow-sm">
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-indigo-700">
                            <MessageCircle className="h-4 w-4" />
                            Unread Messages
                            <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">
                                {unreadThreads.length}
                            </span>
                        </div>

                        <ul className="mt-3 space-y-1.5">
                            {unreadThreads.map((thread) => (
                                <li key={thread.id}>
                                    <Link
                                        href="/messages"
                                        className="flex items-start justify-between gap-2 rounded-lg border border-indigo-100 bg-indigo-50/30 px-3 py-2 hover:bg-indigo-50 transition-colors"
                                    >
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-semibold text-slate-900">{thread.displayName}</p>
                                            <p className="truncate text-[11px] text-slate-600">{thread.previewText}</p>
                                        </div>
                                        <span className="shrink-0 text-[10px] text-slate-400">
                                            {formatTimeAgo(thread.latestMessageAt)}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

                {/* ===== CURRENCY TOTALS ===== */}
                <section className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                        <Wallet2 className="h-4 w-4" />
                        Balances
                    </div>

                    {Object.keys(balances).length === 0 ? (
                        <p className="mt-3 text-sm text-slate-500">No balances.</p>
                    ) : (
                        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {Object.entries(balances)
                                .sort(([a], [b]) => a.localeCompare(b))
                                .map(([currency, amount]) => {
                                    const unit = unitDefinitions.find((u) => u.code?.toUpperCase() === currency);
                                    const symbol = unit?.symbol || currency;
                                    const decimals = unit?.decimalPlaces ?? (unit?.isMonetary ? 2 : 0);
                                    const formatted = Number(amount).toLocaleString(undefined, {
                                        minimumFractionDigits: decimals,
                                        maximumFractionDigits: decimals,
                                    });
                                    const placement = unit?.symbolPlacement ?? 'before';

                                    return (
                                        <div key={currency} className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
                                            <p className="text-[10px] uppercase tracking-wide text-slate-500">{unit?.name || currency}</p>
                                            <p className="text-lg font-semibold text-slate-900">
                                                {placement === 'before' ? `${symbol}${formatted}` : `${formatted} ${symbol}`}
                                            </p>
                                        </div>
                                    );
                                })}
                        </div>
                    )}
                </section>

                {/* ===== UPCOMING CHORES (COLLAPSIBLE) ===== */}
                {upcomingChores.length > 0 && (
                    <section className="rounded-xl border border-slate-200 bg-white/95 shadow-sm">
                        <button
                            onClick={() => setUpcomingExpanded(!upcomingExpanded)}
                            className="flex w-full items-center justify-between px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 hover:bg-slate-50 transition-colors rounded-xl"
                        >
                            <div className="flex items-center gap-2">
                                <CalendarDays className="h-4 w-4" />
                                Upcoming Chores ({upcomingChores.length})
                            </div>
                            <ChevronDown
                                className={`h-4 w-4 transition-transform duration-200 ${upcomingExpanded ? 'rotate-180' : ''}`}
                            />
                        </button>

                        <div
                            className={`overflow-hidden transition-all duration-300 ${
                                upcomingExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
                            }`}
                        >
                            <ul className="space-y-1.5 px-4 pb-4">
                                {upcomingChores.map((chore) => (
                                    <li
                                        key={chore.key}
                                        className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                                            chore.isUpForGrabs
                                                ? 'border-amber-200 bg-amber-50/50'
                                                : 'border-slate-200 bg-white'
                                        }`}
                                    >
                                        <span className="truncate text-slate-900">{chore.title}</span>
                                        <span className="ml-2 shrink-0 text-[10px] font-semibold text-slate-500">
                                            {chore.dueLabel}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </section>
                )}

                {/* ===== RECENT ACTIVITY ===== */}
                {recentActivity.length > 0 && (
                    <section className="rounded-xl border border-slate-200 bg-white/95 p-4 shadow-sm">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                            Recent Activity
                        </div>

                        <ul className="mt-3 space-y-1.5">
                            {recentActivity.map((item) => (
                                <li key={item.key} className="flex items-center justify-between gap-2 text-sm text-slate-700">
                                    <div className="flex items-center gap-2 min-w-0">
                                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                                        <span className="truncate">{item.label}</span>
                                    </div>
                                    <span className="shrink-0 text-[10px] text-slate-400">{formatTimeAgo(item.timestamp)}</span>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}

            </div>
        </div>
    );
}
