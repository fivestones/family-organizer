'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Filter, Plus, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { db } from '@/lib/db';
import {
    CALENDAR_COMMAND_EVENT,
    CALENDAR_DAY_HEIGHT_DEFAULT,
    CALENDAR_DAY_HEIGHT_MAX,
    CALENDAR_DAY_HEIGHT_MIN,
    CALENDAR_DAY_HEIGHT_STORAGE_KEY,
    CALENDAR_STATE_EVENT,
    CALENDAR_VISIBLE_WEEKS_MAX,
    CALENDAR_VISIBLE_WEEKS_MIN,
    type CalendarCommandDetail,
    type CalendarStateDetail,
} from '@/lib/calendar-controls';

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeChecked = (value: boolean | 'indeterminate') => value === true;

interface FamilyMember {
    id: string;
    name?: string | null;
}

const dispatchCalendarCommand = (detail: CalendarCommandDetail) => {
    window.dispatchEvent(new CustomEvent<CalendarCommandDetail>(CALENDAR_COMMAND_EVENT, { detail }));
};

export default function CalendarHeaderControls() {
    const pathname = usePathname();
    const isCalendarRoute = useMemo(() => pathname?.startsWith('/calendar') ?? false, [pathname]);
    const [dayHeight, setDayHeight] = useState(CALENDAR_DAY_HEIGHT_DEFAULT);
    const [visibleWeeks, setVisibleWeeks] = useState(6);
    const [everyoneSelected, setEveryoneSelected] = useState(true);
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

    const familyMembersQuery = db.useQuery({
        familyMembers: {
            $: {
                order: {
                    order: 'asc',
                },
            },
        },
    });
    const familyMembers = useMemo(() => {
        return (((familyMembersQuery.data?.familyMembers as FamilyMember[]) || []).filter((member) => Boolean(member?.id)));
    }, [familyMembersQuery.data?.familyMembers]);
    const familyMemberIds = useMemo(() => familyMembers.map((member) => member.id), [familyMembers]);

    useEffect(() => {
        if (!isCalendarRoute) return;

        const stored = window.localStorage.getItem(CALENDAR_DAY_HEIGHT_STORAGE_KEY);
        if (!stored) return;

        const parsed = Number(stored);
        if (!Number.isFinite(parsed)) return;

        setDayHeight(clampNumber(Math.round(parsed), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX));
    }, [isCalendarRoute]);

    useEffect(() => {
        if (!isCalendarRoute) return;

        const onCalendarState = (event: Event) => {
            const detail = (event as CustomEvent<CalendarStateDetail>).detail;
            if (!detail) return;
            setDayHeight(clampNumber(Math.round(detail.dayHeight), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX));
            setVisibleWeeks(clampNumber(Math.round(detail.visibleWeeks), CALENDAR_VISIBLE_WEEKS_MIN, CALENDAR_VISIBLE_WEEKS_MAX));
            if (detail.memberFilter) {
                setEveryoneSelected(Boolean(detail.memberFilter.everyoneSelected));
                setSelectedMemberIds(
                    Array.from(
                        new Set(
                            (Array.isArray(detail.memberFilter.selectedMemberIds) ? detail.memberFilter.selectedMemberIds : [])
                                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                                .map((value) => value.trim())
                        )
                    )
                );
            }
        };

        window.addEventListener(CALENDAR_STATE_EVENT, onCalendarState);
        dispatchCalendarCommand({ type: 'requestState' });

        return () => {
            window.removeEventListener(CALENDAR_STATE_EVENT, onCalendarState);
        };
    }, [isCalendarRoute]);

    useEffect(() => {
        if (!isCalendarRoute) return;
        if (familyMemberIds.length === 0) return;

        setSelectedMemberIds((previousIds) => {
            const previousSet = new Set(previousIds);
            const normalizedExisting = familyMemberIds.filter((id) => previousSet.has(id));

            if (normalizedExisting.length > 0 || !everyoneSelected) {
                return normalizedExisting.length === previousIds.length &&
                    normalizedExisting.every((id, index) => id === previousIds[index])
                    ? previousIds
                    : normalizedExisting;
            }

            return familyMemberIds;
        });
    }, [everyoneSelected, familyMemberIds, isCalendarRoute]);

    const applyMemberFilter = (nextEveryoneSelected: boolean, nextMemberIds: string[]) => {
        const dedupedMemberIds = Array.from(new Set(nextMemberIds));
        setEveryoneSelected(nextEveryoneSelected);
        setSelectedMemberIds(dedupedMemberIds);
        dispatchCalendarCommand({
            type: 'setMemberFilter',
            everyoneSelected: nextEveryoneSelected,
            selectedMemberIds: dedupedMemberIds,
        });
    };

    if (!isCalendarRoute) {
        return null;
    }

    return (
        <div className="flex items-center gap-2">
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                        <SlidersHorizontal className="h-4 w-4" />
                        Settings
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72">
                    <div className="grid gap-4">
                        <div className="space-y-1">
                            <h4 className="text-sm font-semibold leading-none">Calendar Settings</h4>
                            <p className="text-xs text-muted-foreground">Adjust day height or weeks visible.</p>
                        </div>

                        <div className="grid gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <Label htmlFor="calendar-day-height-header">Day Height</Label>
                                <span className="text-xs text-muted-foreground">{dayHeight}px</span>
                            </div>
                            <input
                                id="calendar-day-height-header"
                                type="range"
                                min={CALENDAR_DAY_HEIGHT_MIN}
                                max={CALENDAR_DAY_HEIGHT_MAX}
                                step={2}
                                value={dayHeight}
                                onChange={(event) => {
                                    const next = clampNumber(Number(event.target.value), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX);
                                    setDayHeight(next);
                                    dispatchCalendarCommand({ type: 'setDayHeight', dayHeight: next });
                                }}
                            />
                        </div>

                        <div className="grid gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <Label htmlFor="calendar-weeks-visible-header">Weeks Visible</Label>
                                <span className="text-xs text-muted-foreground">{visibleWeeks}</span>
                            </div>
                            <input
                                id="calendar-weeks-visible-header"
                                type="range"
                                min={CALENDAR_VISIBLE_WEEKS_MIN}
                                max={CALENDAR_VISIBLE_WEEKS_MAX}
                                step={1}
                                value={visibleWeeks}
                                onChange={(event) => {
                                    const next = clampNumber(
                                        Number(event.target.value),
                                        CALENDAR_VISIBLE_WEEKS_MIN,
                                        CALENDAR_VISIBLE_WEEKS_MAX
                                    );
                                    setVisibleWeeks(next);
                                    dispatchCalendarCommand({ type: 'setVisibleWeeks', visibleWeeks: next });
                                }}
                            />
                            <p className="text-xs text-muted-foreground">Approx. days visible: {visibleWeeks * 7}</p>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                        <Filter className="h-4 w-4" />
                        Filter
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80">
                    <div className="grid gap-4">
                        <div className="space-y-1">
                            <h4 className="text-sm font-semibold leading-none">Member Filter</h4>
                            <p className="text-xs text-muted-foreground">
                                Turn off Everyone to filter calendar events by selected family members.
                            </p>
                        </div>

                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={() => applyMemberFilter(true, familyMemberIds)}
                            >
                                Select all
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={() => applyMemberFilter(false, [])}
                            >
                                Select none
                            </Button>
                        </div>

                        <label
                            htmlFor="calendar-filter-everyone"
                            className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                        >
                            <Checkbox
                                id="calendar-filter-everyone"
                                checked={everyoneSelected}
                                onCheckedChange={(checked) => applyMemberFilter(normalizeChecked(checked), selectedMemberIds)}
                            />
                            <span className="text-sm font-medium">Everyone</span>
                        </label>

                        {familyMembersQuery.isLoading ? (
                            <p className="text-xs text-muted-foreground">Loading family members...</p>
                        ) : familyMembersQuery.error ? (
                            <p className="text-xs text-destructive">Could not load family members.</p>
                        ) : familyMembers.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No family members available yet.</p>
                        ) : (
                            <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">
                                {familyMembers.map((member) => (
                                    <label
                                        key={member.id}
                                        htmlFor={`calendar-filter-member-${member.id}`}
                                        className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                                    >
                                        <Checkbox
                                            id={`calendar-filter-member-${member.id}`}
                                            checked={selectedMemberIds.includes(member.id)}
                                            onCheckedChange={(checked) => {
                                                const next = normalizeChecked(checked)
                                                    ? [...selectedMemberIds, member.id]
                                                    : selectedMemberIds.filter((id) => id !== member.id);
                                                applyMemberFilter(everyoneSelected, next);
                                            }}
                                        />
                                        <span className="text-sm">{member.name || 'Unnamed member'}</span>
                                    </label>
                                ))}
                            </div>
                        )}
                    </div>
                </PopoverContent>
            </Popover>

            <Button variant="outline" size="sm" onClick={() => dispatchCalendarCommand({ type: 'scrollToday' })}>
                Today
            </Button>

            <Button variant="default" size="icon" aria-label="Add event" onClick={() => dispatchCalendarCommand({ type: 'quickAdd' })}>
                <Plus className="h-4 w-4" />
            </Button>
        </div>
    );
}
