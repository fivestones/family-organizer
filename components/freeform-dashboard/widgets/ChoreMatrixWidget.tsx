'use client';

import React, { useMemo } from 'react';
import { Grid3X3 } from 'lucide-react';
import { db } from '@/lib/db';
import { registerFreeformWidget } from '@/lib/freeform-dashboard/freeform-widget-registry';
import type { FreeformWidgetProps } from '@/lib/freeform-dashboard/types';
import {
    calculateDailyXP,
    formatDateKeyUTC,
    getAssignedMembersForChoreOnDate,
    sortChoresForDisplay,
    parseSharedScheduleSettings,
    HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
} from '@family-organizer/shared-core';
import { toInitials } from '@/lib/dashboard-utils';
import { getPhotoUrl } from '@/lib/photo-urls';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { buildMemberColorMap } from '@/lib/family-member-colors';

interface ChoreRow {
    choreId: string;
    title: string;
    assignedMemberIds: Set<string>;
    completedMemberIds: Set<string>;
    notDoneMemberIds: Set<string>;
}

/* ── SVG helpers ─────────────────────────────────────────────── */

const RING_SIZE = 30;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const NODE_SIZE = 22;
const NODE_STROKE = 2;
const LINE_WIDTH = 2;

function XpRing({ color, percent }: { color: string; percent: number }) {
    const dashoffset = RING_CIRCUMFERENCE * (1 - percent);
    return (
        <svg
            width={RING_SIZE}
            height={RING_SIZE}
            className="absolute inset-0"
            style={{ transform: 'rotate(90deg)' }}
        >
            <circle
                cx={RING_SIZE / 2}
                cy={RING_SIZE / 2}
                r={RING_RADIUS}
                fill="none"
                stroke={color}
                strokeOpacity={0.15}
                strokeWidth={RING_STROKE}
            />
            {percent > 0 && (
                <circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={color}
                    strokeWidth={RING_STROKE}
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={dashoffset}
                    strokeLinecap="round"
                />
            )}
        </svg>
    );
}

/* ── Main widget ─────────────────────────────────────────────── */

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
    const routineMarkerStatuses = useMemo(
        () => (data?.routineMarkerStatuses as any[]) || [],
        [data?.routineMarkerStatuses],
    );
    const scheduleSettings = useMemo(
        () => parseSharedScheduleSettings((data?.settings as any[])?.[0]?.value || null),
        [data?.settings],
    );

    const colorMap = useMemo(() => buildMemberColorMap(members), [members]);

    const xpMap = useMemo(() => {
        if (!data?.chores || members.length === 0) return {};
        return (calculateDailyXP as any)(data.chores, members, todayUtc) as Record<
            string,
            { current: number; possible: number }
        >;
    }, [data?.chores, members, todayUtc]);

    /* Build ALL chore rows for today (no pending-only filter) */
    const choreRows: ChoreRow[] = useMemo(() => {
        const allChores = (data?.chores ?? []) as any[];

        const todayChores = allChores.filter((chore) => {
            if (!chore.rrule || !chore.startDate) return false;
            const assigned = getAssignedMembersForChoreOnDate(
                chore as Parameters<typeof getAssignedMembersForChoreOnDate>[0],
                todayUtc,
            );
            return assigned.length > 0;
        });

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
                todayUtc,
            );

            const completedMemberIds = new Set<string>();
            const notDoneMemberIds = new Set<string>();
            for (const c of (chore.completions ?? []) as any[]) {
                if (c.dateDue !== todayKey) continue;
                const completedBy = Array.isArray(c.completedBy)
                    ? c.completedBy[0]
                    : c.completedBy;
                if (!completedBy?.id) continue;
                if (c.completed) {
                    completedMemberIds.add(completedBy.id);
                } else if (c.notDone) {
                    notDoneMemberIds.add(completedBy.id);
                }
            }

            rows.push({
                choreId: chore.id,
                title: chore.title || 'Untitled',
                assignedMemberIds: new Set(assigned.map((a) => a.id)),
                completedMemberIds,
                notDoneMemberIds,
            });
        }

        return rows;
    }, [data, todayUtc, todayKey, routineMarkerStatuses, scheduleSettings]);

    /* Last assigned row index per member (for vertical-line termination) */
    const memberLastRowIndex = useMemo(() => {
        const last: Record<string, number> = {};
        choreRows.forEach((row, idx) => {
            row.assignedMemberIds.forEach((id) => {
                last[id] = idx;
            });
        });
        return last;
    }, [choreRows]);

    /* ── Layout measurements ──────────────────────────────────── */
    const headerHeight = 44;
    const rowHeight = 36;
    const maxRows = Math.max(1, Math.floor((height - headerHeight) / rowHeight));
    const visibleRows = choreRows.slice(0, maxRows);
    const hiddenCount = choreRows.length - visibleRows.length;

    const labelWidth = Math.min(160, Math.max(80, width * 0.3));
    const memberColWidth =
        members.length > 0
            ? Math.min(40, (width - labelWidth - 16) / members.length)
            : 40;

    return (
        <div className="flex h-full flex-col p-3">
            {/* ── Header row ───────────────────────────────────── */}
            <div className="mb-1 flex items-end" style={{ height: headerHeight }}>
                <div
                    className="shrink-0 pb-1 text-xs font-semibold text-slate-500"
                    style={{ width: labelWidth }}
                >
                    Today&apos;s Chores
                </div>
                <div className="flex flex-1 items-stretch">
                    {members.map((m) => {
                        const color = colorMap[m.id] || '#94A3B8';
                        const xp = xpMap[m.id] || { current: 0, possible: 0 };
                        const percent =
                            xp.possible > 0
                                ? Math.max(0, Math.min(1, xp.current / xp.possible))
                                : 0;
                        const hasChores = memberLastRowIndex[m.id] !== undefined;

                        return (
                            <div
                                key={m.id}
                                className="relative flex flex-col items-center"
                                style={{ width: memberColWidth, height: headerHeight }}
                            >
                                {/* Ring + avatar (centered) */}
                                <div
                                    className="relative z-10 flex items-center justify-center"
                                    style={{ width: RING_SIZE, height: RING_SIZE, marginTop: 4 }}
                                >
                                    <XpRing color={color} percent={percent} />
                                    <Avatar className="h-6 w-6">
                                        <AvatarImage
                                            src={getPhotoUrl(m.photoUrls, '64')}
                                            alt={m.name}
                                        />
                                        <AvatarFallback className="text-[9px]">
                                            {toInitials(m.name)}
                                        </AvatarFallback>
                                    </Avatar>
                                </div>

                                {/* Vertical line: ring bottom → header bottom */}
                                {hasChores && (
                                    <div
                                        className="flex-1"
                                        style={{
                                            width: LINE_WIDTH,
                                            backgroundColor: color,
                                            opacity: 0.35,
                                        }}
                                    />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Chore rows ───────────────────────────────────── */}
            {visibleRows.map((row, rowIndex) => (
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
                            const color = colorMap[m.id] || '#94A3B8';
                            const isAssigned = row.assignedMemberIds.has(m.id);
                            const isCompleted = row.completedMemberIds.has(m.id);
                            const isNotDone = row.notDoneMemberIds.has(m.id);
                            const lastRow = memberLastRowIndex[m.id];
                            const showLine =
                                lastRow !== undefined && rowIndex <= lastRow;
                            const isLast = rowIndex === lastRow;

                            return (
                                <div
                                    key={m.id}
                                    className="relative flex items-center justify-center"
                                    style={{
                                        width: memberColWidth,
                                        height: rowHeight,
                                    }}
                                >
                                    {/* Vertical line segment */}
                                    {showLine && (
                                        <div
                                            className="absolute left-1/2 -translate-x-1/2"
                                            style={{
                                                top: 0,
                                                bottom: isLast ? '50%' : 0,
                                                width: LINE_WIDTH,
                                                backgroundColor: color,
                                                opacity: 0.35,
                                            }}
                                        />
                                    )}

                                    {/* Node / content */}
                                    {isAssigned ? (
                                        isCompleted ? (
                                            <div
                                                className="relative z-10 flex items-center justify-center rounded-full"
                                                style={{
                                                    width: NODE_SIZE,
                                                    height: NODE_SIZE,
                                                    border: `${NODE_STROKE}px solid ${color}`,
                                                    backgroundColor: 'white',
                                                }}
                                            >
                                                <Avatar className="h-4 w-4">
                                                    <AvatarImage
                                                        src={getPhotoUrl(
                                                            m.photoUrls,
                                                            '64',
                                                        )}
                                                        alt={m.name}
                                                    />
                                                    <AvatarFallback className="text-[7px]">
                                                        {toInitials(m.name)}
                                                    </AvatarFallback>
                                                </Avatar>
                                            </div>
                                        ) : isNotDone ? (
                                            <div className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full bg-slate-100">
                                                <svg
                                                    className="h-3 w-3 text-slate-400"
                                                    viewBox="0 0 12 12"
                                                    fill="none"
                                                >
                                                    <path
                                                        d="M3 3L9 9M9 3L3 9"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
                                                        strokeLinecap="round"
                                                    />
                                                </svg>
                                            </div>
                                        ) : (
                                            <div className="relative z-10 rounded-full bg-white">
                                                <Avatar className="h-5 w-5 opacity-50">
                                                    <AvatarImage
                                                        src={getPhotoUrl(
                                                            m.photoUrls,
                                                            '64',
                                                        )}
                                                        alt={m.name}
                                                    />
                                                    <AvatarFallback className="text-[8px]">
                                                        {toInitials(m.name)}
                                                    </AvatarFallback>
                                                </Avatar>
                                            </div>
                                        )
                                    ) : !showLine ? (
                                        <span className="text-slate-200">&middot;</span>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}

            {hiddenCount > 0 && (
                <div className="mt-1 text-[10px] text-slate-400">
                    +{hiddenCount} more
                </div>
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
        description:
            "Grid of today's chores with family member completion status",
        minWidth: 300,
        minHeight: 200,
        defaultWidth: 600,
        defaultHeight: 350,
        allowMultiple: false,
    },
    component: ChoreMatrixWidget,
});

export default ChoreMatrixWidget;
