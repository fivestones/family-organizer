'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { addDays, format } from 'date-fns';
import { CalendarDays, CheckCircle2, ChevronDown, ListTodo, MessageCircle } from 'lucide-react';
import { db } from '@/lib/db';
import Calendar from '@/components/Calendar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import DateCarousel from '@/components/ui/DateCarousel';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    formatDateKeyUTC,
    getAssignedMembersForChoreOnDate,
    getCompletedChoreCompletionsForDate,
    getMemberCompletionForDate,
    localDateToUTC,
} from '@family-organizer/shared-core';
import { getThreadDisplayName, getThreadPreviewText } from '@/lib/message-thread-display';
import { getTasksForDate, type Task } from '@/lib/task-scheduler';
import { hasScheduledChildren } from '@/lib/task-series-progress';
import {
    getTaskParentId,
    getTaskUpdateActorId,
    getTaskUpdateReplyToId,
    getTaskUpdateTime,
    getTaskWorkflowState,
    taskUpdateHasMeaningfulFeedbackContent,
    type TaskUpdateLike,
    type TaskWorkflowState,
} from '@/lib/task-progress';
import {
    buildCalendarLabel,
    completionMemberId,
    firstRef,
    formatTimeAgo,
    getPhotoUrl,
    toInitials,
    type DashboardCalendarItem,
    type DashboardChoreCompletion,
    type DashboardFamilyMember,
} from '@/lib/dashboard-utils';
import { cn } from '@/lib/utils';

const SELECTED_MEMBER_KEY = 'dashboard-selected-member';
const SELECTED_DATE_KEY = 'dashboard-selected-date';

const SECTION_GAP_PX = 12;
const SECTION_HEADER_HEIGHT = 28;
const EMPTY_STATE_HEIGHT = 52;
const CHORE_ROW_HEIGHT = 52;
const COMPLETED_LABEL_HEIGHT = 24;
const CHORE_OVERFLOW_HEIGHT = 24;
const MESSAGE_ROW_HEIGHT = 76;
const TASK_GROUP_HEADER_HEIGHT = 26;
const TASK_ROW_HEIGHT = 96;
const TASK_OVERFLOW_HEIGHT = 24;
const EVENT_ROW_HEIGHT = 72;
const DESKTOP_LEFT_COLUMN_MIN_WIDTH = 544;
const DESKTOP_RIGHT_COLUMN_MIN_WIDTH = 780;

type FamilyMemberRecord = DashboardFamilyMember & {
    order?: number | null;
    role?: string | null;
};

type MessageThreadMembership = {
    familyMemberId?: string | null;
    lastReadAt?: string | null;
    isArchived?: boolean | null;
    familyMember?: { id?: string | null; name?: string | null } | Array<{ id?: string | null; name?: string | null }> | null;
};

type MessageThreadRecord = {
    id: string;
    title?: string | null;
    threadType?: string | null;
    latestMessageAt?: string | null;
    latestMessagePreview?: string | null;
    members?: MessageThreadMembership[] | null;
};

type TaskRecord = Task & {
    updates?: TaskUpdateLike[] | null;
    notes?: string | null;
    parentTask?: Array<{ id?: string | null }> | { id?: string | null } | null;
};

type TaskSeriesRecord = {
    id: string;
    name?: string | null;
    startDate?: string | null;
    familyMember?: { id?: string | null; name?: string | null } | Array<{ id?: string | null; name?: string | null }> | null;
    tasks?: TaskRecord[] | null;
};

type ChoreRecord = {
    id: string;
    title?: string | null;
    startDate: string;
    rrule?: string | null;
    exdates?: string[] | null;
    isUpForGrabs?: boolean | null;
    weight?: number | null;
    assignees?: Array<{ id: string; name?: string | null }> | null;
    assignments?: Array<{
        order?: number | null;
        familyMember?: { id?: string | null; name?: string | null } | Array<{ id?: string | null; name?: string | null }> | null;
    }> | null;
    completions?: DashboardChoreCompletion[] | null;
    taskSeries?: TaskSeriesRecord[] | null;
};

type ChoreRow = {
    id: string;
    title: string;
    weight: number;
    isUpForGrabs: boolean;
    isCompleted: boolean;
};

type UnreadThread = {
    id: string;
    displayName: string;
    previewText: string;
    latestMessageAt: string;
};

type TaskRow = {
    id: string;
    text: string;
    workflowState: TaskWorkflowState;
    notePreview: string | null;
    parentLabel: string | null;
    depth: number;
};

type TaskGroup = {
    seriesId: string;
    seriesName: string;
    tasks: TaskRow[];
};

type EventRow = {
    id: string;
    title: string;
    timeLabel: string;
    dayLabel: string;
    isFamilyWide: boolean;
    isAllDay: boolean;
    withinInitialWindow: boolean;
    startsAt: Date;
};

type ChoreSectionPlan = {
    visibleIncompleteCount: number;
    visibleCompletedCount: number;
    hiddenCount: number;
    showCompletedLabel: boolean;
    usedHeight: number;
};

type LinearSectionPlan = {
    visibleCount: number;
    usedHeight: number;
};

type TaskSectionPlan = {
    visibleGroups: TaskGroup[];
    hiddenCount: number;
    usedHeight: number;
};

const TASK_STATUS_TONE: Record<TaskWorkflowState, string> = {
    not_started: 'bg-slate-100 text-slate-700',
    in_progress: 'bg-amber-100 text-amber-800',
    blocked: 'bg-rose-100 text-rose-700',
    skipped: 'bg-zinc-100 text-zinc-600',
    needs_review: 'bg-violet-100 text-violet-700',
    done: 'bg-emerald-100 text-emerald-700',
};

function dateKeyToUtcDate(dateKey: string): Date {
    const [year, month, day] = String(dateKey || '').split('-').map(Number);
    if (!year || !month || !day) {
        return localDateToUTC(new Date());
    }
    return new Date(Date.UTC(year, month - 1, day));
}

function dateKeyToLocalDate(dateKey: string): Date {
    return new Date(`${dateKey}T00:00:00`);
}

function formatUtcDateLabel(
    dateKey: string,
    options: Intl.DateTimeFormatOptions
) {
    return dateKeyToUtcDate(dateKey).toLocaleDateString(undefined, {
        timeZone: 'UTC',
        ...options,
    });
}

function stripToPlainText(value?: string | null) {
    return String(value || '')
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatCountLabel(count: number, singular: string, plural: string, suffix = '') {
    return `${count} ${count === 1 ? singular : plural}${suffix}`;
}

function getTaskUpdateAffectedPersonId(entry: TaskUpdateLike | null | undefined) {
    const affectedPerson = entry?.affectedPerson;
    if (Array.isArray(affectedPerson)) {
        return affectedPerson[0]?.id || null;
    }
    return affectedPerson?.id || null;
}

function taskUpdateHasMeaningfulDashboardResponseContent(entry: TaskUpdateLike | null | undefined) {
    if (!entry) return false;

    if (entry.note?.trim()) return true;
    if (entry.attachments && entry.attachments.length > 0) return true;

    return (entry.responseFieldValues || []).some((value) => {
        return Boolean(stripToPlainText(value.richTextContent) || value.fileUrl?.trim());
    });
}

function formatEventDayLabel(startsAt: Date, selectedDateKey: string, nextDateKey: string) {
    const eventDayKey = format(startsAt, 'yyyy-MM-dd');
    if (eventDayKey === selectedDateKey) return 'Today';
    if (eventDayKey === nextDateKey) return 'Tomorrow';
    return format(startsAt, 'EEE, MMM d');
}

function useIsDesktop() {
    const [isDesktop, setIsDesktop] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
        const mediaQuery = window.matchMedia('(min-width: 1024px)');
        const sync = () => setIsDesktop(mediaQuery.matches);
        sync();

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', sync);
            return () => mediaQuery.removeEventListener('change', sync);
        }

        mediaQuery.addListener(sync);
        return () => mediaQuery.removeListener(sync);
    }, []);

    return isDesktop;
}

function useElementHeight<T extends HTMLElement>() {
    const ref = useRef<T | null>(null);
    const [height, setHeight] = useState(0);

    useEffect(() => {
        const node = ref.current;
        if (!node) return;

        const updateHeight = () => setHeight(node.clientHeight);
        updateHeight();

        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(updateHeight);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return [ref, height] as const;
}

function useElementWidth<T extends HTMLElement>() {
    const ref = useRef<T | null>(null);
    const [width, setWidth] = useState(0);

    useEffect(() => {
        const node = ref.current;
        if (!node) return;

        const updateWidth = () => setWidth(node.clientWidth);
        updateWidth();

        if (typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(updateWidth);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    return [ref, width] as const;
}

function planChoreSection(incompleteCount: number, completedCount: number, maxHeight: number | null): ChoreSectionPlan {
    if (maxHeight == null) {
        return {
            visibleIncompleteCount: incompleteCount,
            visibleCompletedCount: completedCount,
            hiddenCount: 0,
            showCompletedLabel: completedCount > 0,
            usedHeight: 0,
        };
    }

    const totalCount = incompleteCount + completedCount;
    if (totalCount === 0) {
        return {
            visibleIncompleteCount: 0,
            visibleCompletedCount: 0,
            hiddenCount: 0,
            showCompletedLabel: false,
            usedHeight: SECTION_HEADER_HEIGHT + EMPTY_STATE_HEIGHT,
        };
    }

    let visibleIncompleteCount = 0;
    let visibleCompletedCount = 0;
    let showCompletedLabel = false;
    let usedHeight = SECTION_HEADER_HEIGHT;
    let remaining = Math.max(0, maxHeight - SECTION_HEADER_HEIGHT);

    visibleIncompleteCount = Math.min(incompleteCount, Math.floor(remaining / CHORE_ROW_HEIGHT));
    usedHeight += visibleIncompleteCount * CHORE_ROW_HEIGHT;
    remaining -= visibleIncompleteCount * CHORE_ROW_HEIGHT;

    if (visibleIncompleteCount === incompleteCount && completedCount > 0 && remaining >= COMPLETED_LABEL_HEIGHT + CHORE_ROW_HEIGHT) {
        showCompletedLabel = true;
        usedHeight += COMPLETED_LABEL_HEIGHT;
        remaining -= COMPLETED_LABEL_HEIGHT;
        visibleCompletedCount = Math.min(completedCount, Math.floor(remaining / CHORE_ROW_HEIGHT));
        usedHeight += visibleCompletedCount * CHORE_ROW_HEIGHT;
        remaining -= visibleCompletedCount * CHORE_ROW_HEIGHT;

        if (visibleCompletedCount === 0) {
            showCompletedLabel = false;
            usedHeight -= COMPLETED_LABEL_HEIGHT;
        }
    }

    let hiddenCount = totalCount - visibleIncompleteCount - visibleCompletedCount;
    if (hiddenCount > 0) {
        while (usedHeight + CHORE_OVERFLOW_HEIGHT > maxHeight && (visibleCompletedCount > 0 || visibleIncompleteCount > 0)) {
            if (visibleCompletedCount > 0) {
                visibleCompletedCount -= 1;
                usedHeight -= CHORE_ROW_HEIGHT;
                if (visibleCompletedCount === 0 && showCompletedLabel) {
                    showCompletedLabel = false;
                    usedHeight -= COMPLETED_LABEL_HEIGHT;
                }
            } else {
                visibleIncompleteCount -= 1;
                usedHeight -= CHORE_ROW_HEIGHT;
            }
            hiddenCount = totalCount - visibleIncompleteCount - visibleCompletedCount;
        }
        usedHeight = Math.min(maxHeight, usedHeight + CHORE_OVERFLOW_HEIGHT);
    }

    return {
        visibleIncompleteCount,
        visibleCompletedCount,
        hiddenCount,
        showCompletedLabel,
        usedHeight,
    };
}

function planLinearSection(totalCount: number, rowHeight: number, maxHeight: number | null): LinearSectionPlan {
    if (maxHeight == null) {
        return {
            visibleCount: totalCount,
            usedHeight: 0,
        };
    }

    if (totalCount === 0) {
        return {
            visibleCount: 0,
            usedHeight: SECTION_HEADER_HEIGHT + EMPTY_STATE_HEIGHT,
        };
    }

    const visibleCount = Math.min(totalCount, Math.max(1, Math.floor((maxHeight - SECTION_HEADER_HEIGHT) / rowHeight)));
    return {
        visibleCount,
        usedHeight: SECTION_HEADER_HEIGHT + visibleCount * rowHeight,
    };
}

function planTaskSection(taskGroups: TaskGroup[], maxHeight: number | null): TaskSectionPlan {
    if (maxHeight == null) {
        return {
            visibleGroups: taskGroups,
            hiddenCount: 0,
            usedHeight: 0,
        };
    }

    const totalTaskCount = taskGroups.reduce((sum, group) => sum + group.tasks.length, 0);
    if (totalTaskCount === 0) {
        return {
            visibleGroups: [],
            hiddenCount: 0,
            usedHeight: SECTION_HEADER_HEIGHT + EMPTY_STATE_HEIGHT,
        };
    }

    const visibleGroups: TaskGroup[] = [];
    let visibleTaskCount = 0;
    let usedHeight = SECTION_HEADER_HEIGHT;
    let remaining = Math.max(0, maxHeight - SECTION_HEADER_HEIGHT);

    for (const group of taskGroups) {
        if (remaining < TASK_GROUP_HEADER_HEIGHT + TASK_ROW_HEIGHT) break;

        usedHeight += TASK_GROUP_HEADER_HEIGHT;
        remaining -= TASK_GROUP_HEADER_HEIGHT;

        let visibleTaskRows = 0;
        for (const task of group.tasks) {
            if (remaining < TASK_ROW_HEIGHT) break;
            visibleTaskRows += 1;
            visibleTaskCount += 1;
            usedHeight += TASK_ROW_HEIGHT;
            remaining -= TASK_ROW_HEIGHT;
        }

        if (visibleTaskRows > 0) {
            visibleGroups.push({
                ...group,
                tasks: group.tasks.slice(0, visibleTaskRows),
            });
        }

        if (visibleTaskRows < group.tasks.length) break;
    }

    let hiddenCount = totalTaskCount - visibleTaskCount;
    if (hiddenCount > 0) {
        while (usedHeight + TASK_OVERFLOW_HEIGHT > maxHeight && visibleGroups.length > 0) {
            const lastGroup = visibleGroups[visibleGroups.length - 1];
            if (lastGroup.tasks.length > 0) {
                lastGroup.tasks = lastGroup.tasks.slice(0, -1);
                visibleTaskCount -= 1;
                usedHeight -= TASK_ROW_HEIGHT;
            }
            if (lastGroup.tasks.length === 0) {
                visibleGroups.pop();
                usedHeight -= TASK_GROUP_HEADER_HEIGHT;
            }
            hiddenCount = totalTaskCount - visibleTaskCount;
        }
        usedHeight = Math.min(maxHeight, usedHeight + TASK_OVERFLOW_HEIGHT);
    }

    return {
        visibleGroups,
        hiddenCount,
        usedHeight,
    };
}

function DashboardSectionHeader({
    icon: Icon,
    title,
    href,
    countLabel,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    href: string;
    countLabel: string;
}) {
    return (
        <div className="flex h-7 items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                    <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <span className="hidden text-[11px] text-slate-500 sm:inline">{countLabel}</span>
                <Link href={href} className="text-[11px] font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline">
                    Open
                </Link>
            </div>
        </div>
    );
}

export default function PersonalDashboard() {
    const isDesktop = useIsDesktop();
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
    const [selectedDateKey, setSelectedDateKey] = useState(() => formatDateKeyUTC(localDateToUTC(new Date())));
    const [datePickerOpen, setDatePickerOpen] = useState(false);
    const [memberPickerOpen, setMemberPickerOpen] = useState(false);
    const [layoutRef, layoutWidth] = useElementWidth<HTMLDivElement>();
    const [leftColumnRef, leftColumnHeight] = useElementHeight<HTMLDivElement>();
    const [rightColumnRef, rightColumnHeight] = useElementHeight<HTMLDivElement>();
    const headerMeasureRef = useRef<HTMLDivElement | null>(null);
    const headerMeasureTitleRef = useRef<HTMLHeadingElement | null>(null);
    const headerMeasureSummaryRef = useRef<HTMLParagraphElement | null>(null);
    const [desktopLeftColumnWidth, setDesktopLeftColumnWidth] = useState<number>(DESKTOP_LEFT_COLUMN_MIN_WIDTH);

    useEffect(() => {
        try {
            const savedMemberId = localStorage.getItem(SELECTED_MEMBER_KEY);
            if (savedMemberId) setSelectedMemberId(savedMemberId);
            const savedDateKey = localStorage.getItem(SELECTED_DATE_KEY);
            if (savedDateKey) setSelectedDateKey(savedDateKey);
        } catch {
            // Ignore storage access issues.
        }
    }, []);

    useEffect(() => {
        try {
            if (selectedMemberId) {
                localStorage.setItem(SELECTED_MEMBER_KEY, selectedMemberId);
            }
            localStorage.setItem(SELECTED_DATE_KEY, selectedDateKey);
        } catch {
            // Ignore storage access issues.
        }
    }, [selectedDateKey, selectedMemberId]);

    const { data, isLoading, error } = db.useQuery({
        familyMembers: {
            $: { order: { order: 'asc' } },
        },
        messageThreads: {
            members: {
                familyMember: {},
            },
        },
        chores: {
            assignees: {},
            assignments: { familyMember: {} },
            completions: { completedBy: {} },
            taskSeries: {
                familyMember: {},
                tasks: {
                    parentTask: {},
                    updates: {
                        actor: {},
                        affectedPerson: {},
                        attachments: {},
                        gradeType: {},
                        replyTo: {},
                        responseFieldValues: { field: {} },
                    },
                },
            },
        },
        calendarItems: {
            pertainsTo: {},
        },
    });

    const familyMembers = useMemo(
        () => ((data?.familyMembers || []) as unknown as FamilyMemberRecord[]).filter((member) => Boolean(member?.id)),
        [data?.familyMembers]
    );

    const activeMemberId = selectedMemberId || familyMembers[0]?.id || null;
    const activeMember = familyMembers.find((member) => member.id === activeMemberId) || null;

    const selectedDateUtc = useMemo(() => dateKeyToUtcDate(selectedDateKey), [selectedDateKey]);
    const selectedDateLocal = useMemo(() => dateKeyToLocalDate(selectedDateKey), [selectedDateKey]);
    const nextSelectedDateKey = useMemo(() => format(addDays(selectedDateLocal, 1), 'yyyy-MM-dd'), [selectedDateLocal]);
    const todayKey = formatDateKeyUTC(localDateToUTC(new Date()));
    const isSelectedToday = selectedDateKey === todayKey;

    const memberNamesById = useMemo(
        () => new Map(familyMembers.map((member) => [member.id, member.name] as const)),
        [familyMembers]
    );

    const unreadThreads = useMemo(() => {
        if (!activeMemberId) return [] as UnreadThread[];

        return ((data?.messageThreads || []) as unknown as MessageThreadRecord[])
            .reduce<UnreadThread[]>((result, thread) => {
                const membership = (thread.members || []).find((entry) => entry.familyMemberId === activeMemberId);
                if (!membership || membership.isArchived || !thread.latestMessageAt) return result;

                if (thread.latestMessageAt > String(membership.lastReadAt || '')) {
                    result.push({
                        id: thread.id,
                        displayName: getThreadDisplayName(thread, memberNamesById, activeMemberId),
                        previewText: getThreadPreviewText(thread),
                        latestMessageAt: thread.latestMessageAt,
                    });
                }

                return result;
            }, [])
            .sort((left, right) => right.latestMessageAt.localeCompare(left.latestMessageAt));
    }, [activeMemberId, data?.messageThreads, memberNamesById]);

    const choresForDay = useMemo(() => {
        if (!activeMemberId) {
            return { incomplete: [] as ChoreRow[], completed: [] as ChoreRow[] };
        }

        const rows = ((data?.chores || []) as unknown as ChoreRecord[]).reduce<ChoreRow[]>((result, chore) => {
            const assignedMembers = getAssignedMembersForChoreOnDate(chore as any, selectedDateUtc);
            if (!assignedMembers.some((member) => member.id === activeMemberId)) return result;

            const memberCompletion = getMemberCompletionForDate(chore as any, activeMemberId, selectedDateUtc);
            const isCompleted = Boolean(memberCompletion?.completed);

            const completionsOnDate = getCompletedChoreCompletionsForDate(chore as any, selectedDateUtc) as DashboardChoreCompletion[];
            const firstCompleterId = completionMemberId(completionsOnDate.find((completion) => completionMemberId(completion)));
            const claimedByOther = Boolean(chore.isUpForGrabs && firstCompleterId && firstCompleterId !== activeMemberId);
            if (claimedByOther) return result;

            result.push({
                id: chore.id,
                title: chore.title || 'Untitled chore',
                weight: Number(chore.weight || 0),
                isUpForGrabs: Boolean(chore.isUpForGrabs),
                isCompleted,
            });
            return result;
        }, []);

        const sortRows = (left: ChoreRow, right: ChoreRow) => {
            if (left.isUpForGrabs !== right.isUpForGrabs) {
                return left.isUpForGrabs ? 1 : -1;
            }
            return left.title.localeCompare(right.title);
        };

        return {
            incomplete: rows.filter((row) => !row.isCompleted).sort(sortRows),
            completed: rows.filter((row) => row.isCompleted).sort(sortRows),
        };
    }, [activeMemberId, data?.chores, selectedDateUtc]);

    const taskGroups = useMemo(() => {
        if (!activeMemberId) return [] as TaskGroup[];

        return ((data?.chores || []) as unknown as ChoreRecord[]).reduce<TaskGroup[]>((result, chore) => {
            const assignedMembers = getAssignedMembersForChoreOnDate(chore as any, selectedDateUtc);
            if (!assignedMembers.some((member) => member.id === activeMemberId)) return result;

            const assignedIds = new Set(assignedMembers.map((member) => member.id));

            (chore.taskSeries || []).forEach((series) => {
                const owner = firstRef(series.familyMember);
                if (owner?.id && !assignedIds.has(owner.id)) return;
                if (owner?.id && owner.id !== activeMemberId) return;

                const allTasks = [...(series.tasks || [])].sort((left, right) => (left.order || 0) - (right.order || 0));
                if (allTasks.length === 0) return;

                const scheduledTasks = getTasksForDate(
                    allTasks,
                    chore.rrule || null,
                    chore.startDate,
                    selectedDateUtc,
                    series.startDate || null,
                    chore.exdates || null
                );

                if (scheduledTasks.length === 0) return;

                const scheduledIds = new Set(scheduledTasks.map((task) => task.id));
                const tasksById = new Map(allTasks.map((task) => [task.id, task] as const));

                const rows = scheduledTasks
                    .filter((task) => !hasScheduledChildren(task.id, scheduledIds, allTasks))
                    .map<TaskRow>((task) => {
                        const workflowState = getTaskWorkflowState(task);
                        const parents: string[] = [];
                        let parentId = getTaskParentId(task);
                        while (parentId) {
                            const parentTask = tasksById.get(parentId);
                            if (!parentTask) break;
                            parents.unshift(parentTask.text || 'Parent task');
                            parentId = getTaskParentId(parentTask);
                        }
                        return {
                            id: task.id,
                            text: task.text || 'Untitled task',
                            workflowState,
                            notePreview: stripToPlainText(task.notes || null) || null,
                            parentLabel: parents.length > 0 ? parents.join(' / ') : null,
                            depth: Math.min(parents.length, 3),
                        };
                    })
                    .filter((task) => task.workflowState !== 'done');

                if (rows.length === 0) return;

                result.push({
                    seriesId: series.id,
                    seriesName: series.name || 'Task series',
                    tasks: rows,
                });
            });

            return result;
        }, []);
    }, [activeMemberId, data?.chores, selectedDateUtc]);

    const taskCount = useMemo(
        () => taskGroups.reduce((sum, group) => sum + group.tasks.length, 0),
        [taskGroups]
    );

    const upcomingEvents = useMemo(() => {
        if (!activeMemberId) return [] as EventRow[];

        return ((data?.calendarItems || []) as unknown as DashboardCalendarItem[])
            .map((item) => {
                const memberIds = (item.pertainsTo || []).map((member) => member.id).filter(Boolean) as string[];
                const isFamilyWide = memberIds.length === 0;
                if (!isFamilyWide && !memberIds.includes(activeMemberId)) {
                    return null;
                }

                const { startsAt, endsAt, label } = buildCalendarLabel(item);
                if (endsAt.getTime() < selectedDateLocal.getTime()) {
                    return null;
                }

                return {
                    id: item.id,
                    title: item.title || 'Untitled event',
                    timeLabel: label,
                    dayLabel: formatEventDayLabel(startsAt, selectedDateKey, nextSelectedDateKey),
                    isFamilyWide,
                    isAllDay: item.isAllDay,
                    withinInitialWindow: startsAt.getTime() < addDays(selectedDateLocal, 2).getTime(),
                    startsAt,
                } satisfies EventRow;
            })
            .filter((item): item is EventRow => item !== null)
            .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
    }, [activeMemberId, data?.calendarItems, nextSelectedDateKey, selectedDateKey, selectedDateLocal]);

    const outstandingFeedbackCount = useMemo(() => {
        if (!activeMemberId || !isSelectedToday) return 0;

        const allTasks = ((data?.chores || []) as unknown as ChoreRecord[]).flatMap((chore) =>
            (chore.taskSeries || []).flatMap((series) => series.tasks || [])
        );

        return allTasks.reduce((count, task) => {
            const updates = (task.updates || []).filter((entry) => !entry.isDraft);
            const topLevelResponses = updates
                .filter((entry) => !getTaskUpdateReplyToId(entry))
                .filter((entry) => taskUpdateHasMeaningfulDashboardResponseContent(entry))
                .filter((entry) => {
                    const actorId = getTaskUpdateActorId(entry);
                    const affectedId = getTaskUpdateAffectedPersonId(entry);
                    return actorId === activeMemberId || affectedId === activeMemberId;
                })
                .sort((left, right) => getTaskUpdateTime(right) - getTaskUpdateTime(left));

            const latestResponse = topLevelResponses[0];
            if (!latestResponse?.id) return count;

            const feedbackReplies = updates
                .filter((entry) => getTaskUpdateReplyToId(entry) === latestResponse.id)
                .filter((entry) => taskUpdateHasMeaningfulFeedbackContent(entry))
                .sort((left, right) => getTaskUpdateTime(right) - getTaskUpdateTime(left));

            if (feedbackReplies.length === 0) return count;

            const latestFeedbackAt = getTaskUpdateTime(feedbackReplies[0]);
            const hasSubsequentUpdate = updates.some((entry) => getTaskUpdateTime(entry) > latestFeedbackAt);

            return hasSubsequentUpdate ? count : count + 1;
        }, 0);
    }, [activeMemberId, data?.chores, isSelectedToday]);

    const summaryLine = useMemo(() => {
        const parts = [
            formatCountLabel(choresForDay.incomplete.length, 'chore left', 'chores left'),
            formatCountLabel(unreadThreads.length, 'unread message', 'unread messages'),
            formatCountLabel(taskCount, 'task to do', 'tasks to do'),
        ];

        if (isSelectedToday && outstandingFeedbackCount > 0) {
            parts.push(formatCountLabel(outstandingFeedbackCount, 'new feedback', 'new feedback'));
        }

        return parts.join(' • ');
    }, [choresForDay.incomplete.length, isSelectedToday, outstandingFeedbackCount, taskCount, unreadThreads.length]);

    useLayoutEffect(() => {
        if (!isDesktop || !activeMember) return;
        const mirror = headerMeasureRef.current;
        const title = headerMeasureTitleRef.current;
        const summary = headerMeasureSummaryRef.current;
        if (!mirror || !title || !summary || layoutWidth <= 0 || typeof window === 'undefined') {
            return;
        }

        const availableWidth = layoutWidth - SECTION_GAP_PX - DESKTOP_RIGHT_COLUMN_MIN_WIDTH;
        const minWidth = DESKTOP_LEFT_COLUMN_MIN_WIDTH;
        const maxWidth = Math.max(minWidth, availableWidth);

        const titleStyles = window.getComputedStyle(title);
        const summaryStyles = window.getComputedStyle(summary);
        const titleLineHeight = Number.parseFloat(titleStyles.lineHeight) || Number.parseFloat(titleStyles.fontSize) * 1.2 || 40;
        const summaryLineHeight = Number.parseFloat(summaryStyles.lineHeight) || Number.parseFloat(summaryStyles.fontSize) * 1.4 || 20;

        const fitsAtWidth = (nextWidth: number) => {
            mirror.style.width = `${nextWidth}px`;

            const titleFits = title.getBoundingClientRect().height <= titleLineHeight * 1.35;
            const summaryFits = summary.getBoundingClientRect().height <= summaryLineHeight * 2.35;

            return titleFits && summaryFits;
        };

        let nextWidth = maxWidth;
        if (fitsAtWidth(maxWidth)) {
            let low = minWidth;
            let high = maxWidth;
            let best = maxWidth;

            while (low <= high) {
                const mid = Math.floor((low + high) / 2);
                if (fitsAtWidth(mid)) {
                    best = mid;
                    high = mid - 1;
                } else {
                    low = mid + 1;
                }
            }

            nextWidth = best;
        }

        mirror.style.width = '';
        setDesktopLeftColumnWidth(Math.max(minWidth, Math.round(nextWidth)));
    }, [activeMember, isDesktop, layoutWidth, selectedDateKey, summaryLine]);

    const leftAvailableHeight = useMemo(
        () => (isDesktop && leftColumnHeight > 0 ? Math.max(0, leftColumnHeight - SECTION_GAP_PX) : null),
        [isDesktop, leftColumnHeight]
    );
    const rightAvailableHeight = useMemo(
        () => (isDesktop && rightColumnHeight > 0 ? Math.max(0, rightColumnHeight - SECTION_GAP_PX) : null),
        [isDesktop, rightColumnHeight]
    );

    const minimumMessageHeight = unreadThreads.length === 0
        ? SECTION_HEADER_HEIGHT + EMPTY_STATE_HEIGHT
        : SECTION_HEADER_HEIGHT + Math.min(2, unreadThreads.length) * MESSAGE_ROW_HEIGHT;

    const chorePlan = useMemo(
        () =>
            planChoreSection(
                choresForDay.incomplete.length,
                choresForDay.completed.length,
                leftAvailableHeight == null ? null : Math.max(SECTION_HEADER_HEIGHT + EMPTY_STATE_HEIGHT, leftAvailableHeight - minimumMessageHeight)
            ),
        [choresForDay.completed.length, choresForDay.incomplete.length, leftAvailableHeight, minimumMessageHeight]
    );

    const leftTopHeight = leftAvailableHeight == null ? null : chorePlan.usedHeight;
    const leftBottomHeight = leftAvailableHeight == null ? null : Math.max(minimumMessageHeight, leftAvailableHeight - chorePlan.usedHeight);
    const messagePlan = useMemo(
        () => planLinearSection(unreadThreads.length, MESSAGE_ROW_HEIGHT, leftBottomHeight),
        [leftBottomHeight, unreadThreads.length]
    );

    const initialWindowEvents = useMemo(
        () => upcomingEvents.filter((event) => event.withinInitialWindow),
        [upcomingEvents]
    );
    const minimumEventHeight = initialWindowEvents.length === 0
        ? SECTION_HEADER_HEIGHT + EMPTY_STATE_HEIGHT
        : SECTION_HEADER_HEIGHT + Math.min(2, initialWindowEvents.length) * EVENT_ROW_HEIGHT;

    const taskPlan = useMemo(
        () =>
            planTaskSection(
                taskGroups,
                rightAvailableHeight == null ? null : Math.max(SECTION_HEADER_HEIGHT + EMPTY_STATE_HEIGHT, rightAvailableHeight - minimumEventHeight)
            ),
        [minimumEventHeight, rightAvailableHeight, taskGroups]
    );

    const rightTopHeight = rightAvailableHeight == null ? null : taskPlan.usedHeight;
    const rightBottomHeight = rightAvailableHeight == null ? null : Math.max(minimumEventHeight, rightAvailableHeight - taskPlan.usedHeight);
    const eventSource = taskPlan.hiddenCount === 0 ? upcomingEvents : initialWindowEvents;
    const eventPlan = useMemo(
        () => planLinearSection(eventSource.length, EVENT_ROW_HEIGHT, rightBottomHeight),
        [eventSource.length, rightBottomHeight]
    );

    const visibleIncompleteChores = choresForDay.incomplete.slice(0, chorePlan.visibleIncompleteCount);
    const visibleCompletedChores = choresForDay.completed.slice(0, chorePlan.visibleCompletedCount);
    const visibleThreads = unreadThreads.slice(0, messagePlan.visibleCount);
    const visibleEvents = eventSource.slice(0, eventPlan.visibleCount);

    if (isLoading) {
        return (
            <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,_#fff7ed_0%,_#f8fafc_35%,_#ffffff_100%)]">
                <div className="mx-auto flex h-full max-w-[1880px] items-center justify-center px-4">
                    <div className="rounded-3xl border border-slate-200 bg-white/90 px-8 py-6 shadow-sm">
                        <p className="text-sm text-slate-600">Loading day view...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,_#fff7ed_0%,_#f8fafc_35%,_#ffffff_100%)]">
                <div className="mx-auto flex h-full max-w-[1880px] items-center justify-center px-4">
                    <div className="rounded-3xl border border-rose-200 bg-rose-50/90 px-8 py-6 shadow-sm">
                        <p className="text-sm font-medium text-rose-700">The personal day view failed to load.</p>
                        <p className="mt-2 text-sm text-rose-600">{error.message}</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!activeMember) {
        return (
            <div className="h-full w-full bg-[radial-gradient(circle_at_top_left,_#fff7ed_0%,_#f8fafc_35%,_#ffffff_100%)]">
                <div className="mx-auto flex h-full max-w-[1880px] items-center justify-center px-4">
                    <div className="rounded-3xl border border-slate-200 bg-white/90 px-8 py-6 shadow-sm">
                        <p className="text-sm text-slate-600">Add a family member to start using the day view.</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full overflow-auto bg-[radial-gradient(circle_at_top_left,_#fff7ed_0%,_#f8fafc_35%,_#ffffff_100%)] lg:overflow-hidden">
            <div className="pointer-events-none fixed left-[-10000px] top-[-10000px] z-[-1] opacity-0" aria-hidden="true">
                <div
                    ref={headerMeasureRef}
                    className="rounded-[28px] border border-transparent px-4 py-4 sm:px-5"
                >
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3 text-left">
                            <div className="h-14 w-14 shrink-0 rounded-full border-2 border-transparent" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                    <h1
                                        ref={headerMeasureTitleRef}
                                        className="text-2xl font-semibold tracking-tight text-slate-900"
                                    >
                                        {activeMember.name}&apos;s Day
                                    </h1>
                                    <div className="h-4 w-4 shrink-0" />
                                </div>
                                <p
                                    ref={headerMeasureSummaryRef}
                                    className="mt-1 text-sm leading-5 text-slate-600"
                                >
                                    {summaryLine}
                                </p>
                            </div>
                        </div>

                        <div className="shrink-0 rounded-2xl border border-transparent px-3 py-2 text-right">
                            <div className="flex items-center gap-2">
                                <div className="h-4 w-4 shrink-0" />
                                <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                        {isSelectedToday ? 'Today' : 'Selected date'}
                                    </p>
                                    <p className="text-sm font-medium text-slate-900">
                                        {formatUtcDateLabel(selectedDateKey, {
                                            weekday: 'short',
                                            month: 'short',
                                            day: 'numeric',
                                            year: 'numeric',
                                        })}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div ref={layoutRef} className="mx-auto flex min-h-full w-full max-w-[1880px] flex-col gap-3 px-3 py-3 sm:px-4 lg:h-full lg:min-h-0 lg:flex-row">
                <div
                    className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-none"
                    style={isDesktop ? { width: `${desktopLeftColumnWidth}px`, flexBasis: `${desktopLeftColumnWidth}px` } : undefined}
                >
                    <section className="shrink-0 rounded-[28px] border border-slate-200 bg-white/95 px-4 py-4 shadow-[0_18px_65px_-36px_rgba(15,23,42,0.45)] sm:px-5">
                        <div className="flex items-start justify-between gap-4">
                            <Popover open={memberPickerOpen} onOpenChange={setMemberPickerOpen}>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                                    >
                                        <Avatar className="h-14 w-14 border-2 border-slate-200 shadow-sm">
                                            {getPhotoUrl(activeMember) ? (
                                                <AvatarImage src={getPhotoUrl(activeMember)} alt={activeMember.name} />
                                            ) : null}
                                            <AvatarFallback className="bg-slate-100 text-sm font-semibold text-slate-700">
                                                {toInitials(activeMember.name)}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                                                    {activeMember.name}&apos;s Day
                                                </h1>
                                                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                                            </div>
                                            <p className="mt-1 text-sm leading-5 text-slate-600">
                                                {summaryLine}
                                            </p>
                                        </div>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent align="start" className="w-80 p-2">
                                    <div className="space-y-1">
                                        <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                            Choose family member
                                        </p>
                                        {familyMembers.map((member) => {
                                            const isActive = member.id === activeMemberId;
                                            return (
                                                <button
                                                    key={member.id}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedMemberId(member.id);
                                                        setMemberPickerOpen(false);
                                                    }}
                                                    className={cn(
                                                        'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors',
                                                        isActive
                                                            ? 'bg-amber-50 text-amber-950'
                                                            : 'text-slate-700 hover:bg-slate-50'
                                                    )}
                                                >
                                                    <Avatar className="h-10 w-10 border border-slate-200">
                                                        {getPhotoUrl(member) ? (
                                                            <AvatarImage src={getPhotoUrl(member)} alt={member.name} />
                                                        ) : null}
                                                        <AvatarFallback className="text-xs font-semibold">
                                                            {toInitials(member.name)}
                                                        </AvatarFallback>
                                                    </Avatar>
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-medium">{member.name}</p>
                                                        <p className="truncate text-xs text-slate-500">
                                                            {isActive ? 'Currently shown' : 'Show this day view'}
                                                        </p>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </PopoverContent>
                            </Popover>

                            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                                <PopoverTrigger asChild>
                                    <button
                                        type="button"
                                        className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-right shadow-sm transition-colors hover:bg-slate-100"
                                    >
                                        <div className="flex items-center gap-2">
                                            <CalendarDays className="h-4 w-4 text-slate-500" />
                                            <div>
                                                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                                    {isSelectedToday ? 'Today' : 'Selected date'}
                                                </p>
                                                <p className="text-sm font-medium text-slate-900">
                                                    {formatUtcDateLabel(selectedDateKey, {
                                                        weekday: 'short',
                                                        month: 'short',
                                                        day: 'numeric',
                                                        year: 'numeric',
                                                    })}
                                                </p>
                                            </div>
                                        </div>
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-[min(92vw,640px)] p-2">
                                    <DateCarousel
                                        initialDate={selectedDateLocal}
                                        onDateSelect={(nextDate) => {
                                            setSelectedDateKey(formatDateKeyUTC(localDateToUTC(nextDate)));
                                            setDatePickerOpen(false);
                                        }}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                    </section>

                    <section className="rounded-[28px] border border-slate-200 bg-white/95 shadow-[0_18px_65px_-36px_rgba(15,23,42,0.45)] lg:min-h-0 lg:flex-1">
                        <div
                            ref={leftColumnRef}
                            className="flex h-full min-h-0 flex-col gap-3 px-4 py-4 sm:px-5 sm:py-5"
                        >
                            <div
                                className="overflow-hidden rounded-3xl border border-slate-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.96))] px-3 py-3 sm:px-4"
                                style={leftTopHeight != null ? { height: `${leftTopHeight}px` } : undefined}
                            >
                                <DashboardSectionHeader
                                    icon={CheckCircle2}
                                    title="Chores"
                                    href="/chores"
                                    countLabel={formatCountLabel(choresForDay.incomplete.length, 'left', 'left')}
                                />
                                <div className="mt-3 space-y-2">
                                    {visibleIncompleteChores.length === 0 && visibleCompletedChores.length === 0 ? (
                                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-3 text-sm text-slate-500">
                                            No chores scheduled for this day.
                                        </div>
                                    ) : (
                                        <>
                                            {visibleIncompleteChores.map((chore) => (
                                                <div
                                                    key={chore.id}
                                                    className="flex h-[52px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-3 shadow-sm"
                                                >
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-medium text-slate-900">{chore.title}</p>
                                                        <p className="text-[11px] text-slate-500">
                                                            {chore.isUpForGrabs ? 'Claimable chore' : 'Assigned chore'}
                                                        </p>
                                                    </div>
                                                    {chore.weight > 0 ? (
                                                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-500">
                                                            {chore.weight} XP
                                                        </span>
                                                    ) : null}
                                                </div>
                                            ))}
                                            {chorePlan.showCompletedLabel && visibleCompletedChores.length > 0 ? (
                                                <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                                    Done
                                                </p>
                                            ) : null}
                                            {visibleCompletedChores.map((chore) => (
                                                <div
                                                    key={`${chore.id}-completed`}
                                                    className="flex h-[52px] items-center justify-between gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 px-3"
                                                >
                                                    <p className="truncate text-sm text-slate-500 line-through">{chore.title}</p>
                                                    {chore.weight > 0 ? (
                                                        <span className="shrink-0 rounded-full bg-white/90 px-2 py-1 text-[10px] font-semibold text-emerald-600">
                                                            {chore.weight} XP
                                                        </span>
                                                    ) : null}
                                                </div>
                                            ))}
                                            {chorePlan.hiddenCount > 0 ? (
                                                <Link href="/chores" className="block pt-1 text-xs font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline">
                                                    {chorePlan.hiddenCount} more chore{chorePlan.hiddenCount === 1 ? '' : 's'}
                                                </Link>
                                            ) : null}
                                        </>
                                    )}
                                </div>
                            </div>

                            <div
                                className="overflow-hidden rounded-3xl border border-slate-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.96))] px-3 py-3 sm:px-4"
                                style={leftBottomHeight != null ? { height: `${leftBottomHeight}px` } : undefined}
                            >
                                <DashboardSectionHeader
                                    icon={MessageCircle}
                                    title="Unread Messages"
                                    href="/messages"
                                    countLabel={formatCountLabel(unreadThreads.length, 'thread', 'threads')}
                                />
                                <div className="mt-3 space-y-2">
                                    {visibleThreads.length === 0 ? (
                                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-3 text-sm text-slate-500">
                                            All caught up on messages.
                                        </div>
                                    ) : (
                                        visibleThreads.map((thread) => (
                                            <Link
                                                key={thread.id}
                                                href="/messages"
                                                className="block rounded-2xl border border-indigo-100 bg-indigo-50/50 px-3 py-3 transition-colors hover:bg-indigo-50"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-semibold text-slate-900">{thread.displayName}</p>
                                                        <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-600">
                                                            {thread.previewText}
                                                        </p>
                                                    </div>
                                                    <span className="shrink-0 text-[10px] font-medium text-slate-400">
                                                        {formatTimeAgo(thread.latestMessageAt)}
                                                    </span>
                                                </div>
                                            </Link>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3">
                    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white/95 shadow-[0_18px_65px_-36px_rgba(15,23,42,0.45)]">
                        <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Calendar</p>
                                <p className="text-sm text-slate-600">Selected member and family events</p>
                            </div>
                            <div className="text-right text-sm font-medium text-slate-700">
                                {formatUtcDateLabel(selectedDateKey, { month: 'short', day: 'numeric' })} + 3 days
                            </div>
                        </div>
                        <div className="h-[320px] sm:h-[360px] lg:h-[min(42vh,420px)]">
                            <Calendar
                                className="h-full"
                                currentDate={selectedDateLocal}
                                showChores={false}
                                everyoneSelected={true}
                                selectedMemberIds={[activeMemberId]}
                                commandBusEnabled={false}
                                viewMode="day"
                                dayVisibleDays={4}
                                dayRowCount={1}
                                dayHourHeight={40}
                                dayFontScale={0.72}
                                dayBufferDays={0}
                                eventFontScale={0.7}
                                displayBS={true}
                            />
                        </div>
                    </section>

                    <section className="rounded-[28px] border border-slate-200 bg-white/95 shadow-[0_18px_65px_-36px_rgba(15,23,42,0.45)] lg:min-h-0 lg:flex-1">
                        <div
                            ref={rightColumnRef}
                            className="flex h-full min-h-0 flex-col gap-3 px-4 py-4 sm:px-5 sm:py-5"
                        >
                            <div
                                className="overflow-hidden rounded-3xl border border-slate-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.96))] px-3 py-3 sm:px-4"
                                style={rightTopHeight != null ? { height: `${rightTopHeight}px` } : undefined}
                            >
                                <DashboardSectionHeader
                                    icon={ListTodo}
                                    title="Tasks"
                                    href={activeMemberId ? `/my-tasks?member=${encodeURIComponent(activeMemberId)}` : '/my-tasks'}
                                    countLabel={formatCountLabel(taskCount, 'task', 'tasks')}
                                />
                                <div className="mt-3 space-y-2">
                                    {taskPlan.visibleGroups.length === 0 ? (
                                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-3 text-sm text-slate-500">
                                            No scheduled tasks for this day.
                                        </div>
                                    ) : (
                                        <>
                                            {taskPlan.visibleGroups.map((group) => (
                                                <div key={group.seriesId} className="space-y-2">
                                                    <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                                        {group.seriesName}
                                                    </p>
                                                    {group.tasks.map((task) => (
                                                        <div
                                                            key={task.id}
                                                            className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm"
                                                            style={task.depth > 0 ? { marginLeft: `${Math.min(task.depth * 12, 32)}px` } : undefined}
                                                        >
                                                            <div className="flex items-start gap-3">
                                                                <span className={cn('shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase', TASK_STATUS_TONE[task.workflowState])}>
                                                                    {task.workflowState.replace('_', ' ')}
                                                                </span>
                                                                <div className="min-w-0 flex-1">
                                                                    {task.parentLabel ? (
                                                                        <p className="truncate text-[11px] uppercase tracking-[0.12em] text-slate-400">
                                                                            {task.parentLabel}
                                                                        </p>
                                                                    ) : null}
                                                                    <p className="truncate text-sm font-medium text-slate-900">{task.text}</p>
                                                                    {task.notePreview ? (
                                                                        <p className="mt-1 line-clamp-2 text-[12px] leading-5 text-slate-600">
                                                                            {task.notePreview}
                                                                        </p>
                                                                    ) : null}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ))}
                                            {taskPlan.hiddenCount > 0 ? (
                                                <Link
                                                    href={activeMemberId ? `/my-tasks?member=${encodeURIComponent(activeMemberId)}` : '/my-tasks'}
                                                    className="block pt-1 text-xs font-medium text-slate-600 underline-offset-4 hover:text-slate-900 hover:underline"
                                                >
                                                    {taskPlan.hiddenCount} more
                                                </Link>
                                            ) : null}
                                        </>
                                    )}
                                </div>
                            </div>

                            <div
                                className="overflow-hidden rounded-3xl border border-slate-100 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.96))] px-3 py-3 sm:px-4"
                                style={rightBottomHeight != null ? { height: `${rightBottomHeight}px` } : undefined}
                            >
                                <DashboardSectionHeader
                                    icon={CalendarDays}
                                    title="Upcoming Events"
                                    href="/calendar"
                                    countLabel={formatCountLabel(upcomingEvents.length, 'event', 'events')}
                                />
                                <div className="mt-3 space-y-2">
                                    {visibleEvents.length === 0 ? (
                                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-3 py-3 text-sm text-slate-500">
                                            Nothing on the calendar yet.
                                        </div>
                                    ) : (
                                        visibleEvents.map((event) => (
                                            <Link
                                                key={event.id}
                                                href="/calendar"
                                                className="block rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm transition-colors hover:bg-slate-50"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase text-slate-500">
                                                                {event.dayLabel}
                                                            </span>
                                                            {event.isFamilyWide ? (
                                                                <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-semibold uppercase text-amber-700">
                                                                    Family
                                                                </span>
                                                            ) : null}
                                                            {event.isAllDay ? (
                                                                <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold uppercase text-blue-700">
                                                                    All day
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                        <p className="mt-2 truncate text-sm font-medium text-slate-900">{event.title}</p>
                                                        <p className="mt-1 text-[12px] text-slate-600">{event.timeLabel}</p>
                                                    </div>
                                                </div>
                                            </Link>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>
                </div>
            </div>
        </div>
    );
}
