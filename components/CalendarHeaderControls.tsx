'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
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
    CALENDAR_SHOW_CHORES_STORAGE_KEY,
    CALENDAR_STATE_EVENT,
    CALENDAR_VISIBLE_WEEKS_MAX,
    CALENDAR_VISIBLE_WEEKS_MIN,
    CALENDAR_VIEW_MODE_STORAGE_KEY,
    CALENDAR_YEAR_FONT_SCALE_DEFAULT,
    CALENDAR_YEAR_FONT_SCALE_MAX,
    CALENDAR_YEAR_FONT_SCALE_MIN,
    CALENDAR_YEAR_FONT_SCALE_STORAGE_KEY,
    CALENDAR_YEAR_MONTH_BASIS_STORAGE_KEY,
    type CalendarViewMode,
    type CalendarYearMonthBasis,
    type CalendarCommandDetail,
    type CalendarStateDetail,
} from '@/lib/calendar-controls';

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clampYearFontScale = (value: number) =>
    Math.round(clampNumber(value, CALENDAR_YEAR_FONT_SCALE_MIN, CALENDAR_YEAR_FONT_SCALE_MAX) * 100) / 100;
const normalizeChecked = (value: boolean | 'indeterminate') => value === true;
const humanJoin = (items: string[]) => {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

interface FamilyMember {
    id: string;
    name?: string | null;
}

interface ChoreFilterOption {
    id: string;
    title?: string | null;
}

const dispatchCalendarCommand = (detail: CalendarCommandDetail) => {
    window.dispatchEvent(new CustomEvent<CalendarCommandDetail>(CALENDAR_COMMAND_EVENT, { detail }));
};

export default function CalendarHeaderControls() {
    const pathname = usePathname();
    const isCalendarRoute = useMemo(() => pathname?.startsWith('/calendar') ?? false, [pathname]);
    const [dayHeight, setDayHeight] = useState(CALENDAR_DAY_HEIGHT_DEFAULT);
    const [visibleWeeks, setVisibleWeeks] = useState(6);
    const [showChores, setShowChores] = useState(false);
    const [viewMode, setViewMode] = useState<CalendarViewMode>('monthly');
    const [yearMonthBasis, setYearMonthBasis] = useState<CalendarYearMonthBasis>('gregorian');
    const [yearFontScale, setYearFontScale] = useState(CALENDAR_YEAR_FONT_SCALE_DEFAULT);
    const [selectedChoreIds, setSelectedChoreIds] = useState<string[]>([]);
    const [choreFilterConfigured, setChoreFilterConfigured] = useState(false);
    const [everyoneSelected, setEveryoneSelected] = useState(true);
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
    const [isChoreFilterExpanded, setIsChoreFilterExpanded] = useState(false);
    const hasInitializedMemberFilterRef = useRef(false);

    const filterOptionsQuery = db.useQuery({
        familyMembers: {
            $: {
                order: {
                    order: 'asc',
                },
            },
        },
        chores: {},
    });
    const familyMembers = useMemo(() => {
        return ((((filterOptionsQuery.data?.familyMembers as FamilyMember[]) || []).filter((member) => Boolean(member?.id))));
    }, [filterOptionsQuery.data?.familyMembers]);
    const familyMemberIds = useMemo(() => familyMembers.map((member) => member.id), [familyMembers]);
    const chores = useMemo(() => {
        return (((filterOptionsQuery.data?.chores as ChoreFilterOption[]) || [])
            .filter((chore) => Boolean(chore?.id))
            .sort((left, right) => {
                const leftTitle = String(left?.title || '').trim() || 'Untitled chore';
                const rightTitle = String(right?.title || '').trim() || 'Untitled chore';
                return leftTitle.localeCompare(rightTitle);
            }));
    }, [filterOptionsQuery.data?.chores]);
    const choreIds = useMemo(() => chores.map((chore) => chore.id), [chores]);
    const effectiveSelectedChoreIds = useMemo(
        () => (choreFilterConfigured ? selectedChoreIds : choreIds),
        [choreFilterConfigured, choreIds, selectedChoreIds]
    );

    useEffect(() => {
        if (!isCalendarRoute) return;

        setShowChores(window.localStorage.getItem(CALENDAR_SHOW_CHORES_STORAGE_KEY) === 'true');
        const storedViewMode = window.localStorage.getItem(CALENDAR_VIEW_MODE_STORAGE_KEY);
        if (storedViewMode === 'monthly' || storedViewMode === 'year') {
            setViewMode(storedViewMode);
        }
        const storedYearMonthBasis = window.localStorage.getItem(CALENDAR_YEAR_MONTH_BASIS_STORAGE_KEY);
        if (storedYearMonthBasis === 'gregorian' || storedYearMonthBasis === 'bs') {
            setYearMonthBasis(storedYearMonthBasis);
        }
        const storedYearFontScale = Number(window.localStorage.getItem(CALENDAR_YEAR_FONT_SCALE_STORAGE_KEY));
        if (Number.isFinite(storedYearFontScale)) {
            setYearFontScale(clampYearFontScale(storedYearFontScale));
        }

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
            setShowChores(Boolean(detail.showChores));
            setViewMode(detail.viewMode);
            setYearMonthBasis(detail.yearMonthBasis);
            setYearFontScale(clampYearFontScale(detail.yearFontScale));
            if (detail.choreFilter) {
                setChoreFilterConfigured(Boolean(detail.choreFilter.configured));
                setSelectedChoreIds(
                    Array.from(
                        new Set(
                            (Array.isArray(detail.choreFilter.selectedChoreIds) ? detail.choreFilter.selectedChoreIds : [])
                                .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                                .map((value) => value.trim())
                        )
                    )
                );
            }
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

        const selectedSet = new Set(selectedMemberIds);
        const normalizedSelectedIds = familyMemberIds.filter((id) => selectedSet.has(id));
        const normalizedMatchesState =
            normalizedSelectedIds.length === selectedMemberIds.length &&
            normalizedSelectedIds.every((id, index) => id === selectedMemberIds[index]);

        if (!hasInitializedMemberFilterRef.current && everyoneSelected && normalizedSelectedIds.length === 0) {
            hasInitializedMemberFilterRef.current = true;
            setSelectedMemberIds(familyMemberIds);
            dispatchCalendarCommand({
                type: 'setMemberFilter',
                everyoneSelected: true,
                selectedMemberIds: familyMemberIds,
            });
            return;
        }

        hasInitializedMemberFilterRef.current = true;

        if (!normalizedMatchesState) {
            setSelectedMemberIds(normalizedSelectedIds);
            dispatchCalendarCommand({
                type: 'setMemberFilter',
                everyoneSelected,
                selectedMemberIds: normalizedSelectedIds,
            });
        }
    }, [everyoneSelected, familyMemberIds, isCalendarRoute, selectedMemberIds]);

    useEffect(() => {
        if (!showChores) {
            setIsChoreFilterExpanded(false);
        }
    }, [showChores]);

    useEffect(() => {
        if (!isCalendarRoute) return;
        if (!showChores) return;
        if (choreIds.length === 0) return;

        const selectedSet = new Set(selectedChoreIds);
        const normalizedSelectedIds = choreIds.filter((id) => selectedSet.has(id));
        const normalizedMatchesState =
            normalizedSelectedIds.length === selectedChoreIds.length &&
            normalizedSelectedIds.every((id, index) => id === selectedChoreIds[index]);

        if (!choreFilterConfigured && normalizedSelectedIds.length === 0) {
            setChoreFilterConfigured(true);
            setSelectedChoreIds(choreIds);
            dispatchCalendarCommand({
                type: 'setChoreFilter',
                selectedChoreIds: choreIds,
            });
            return;
        }

        if (choreFilterConfigured && !normalizedMatchesState) {
            setSelectedChoreIds(normalizedSelectedIds);
            dispatchCalendarCommand({
                type: 'setChoreFilter',
                selectedChoreIds: normalizedSelectedIds,
            });
        }
    }, [choreFilterConfigured, choreIds, isCalendarRoute, selectedChoreIds, showChores]);

    const applyMemberFilter = (nextEveryoneSelected: boolean, nextMemberIds: string[]) => {
        hasInitializedMemberFilterRef.current = true;
        const allowedIds = new Set(familyMemberIds);
        const dedupedMemberIds = Array.from(
            new Set(
                nextMemberIds
                    .map((id) => String(id || '').trim())
                    .filter((id) => id.length > 0 && allowedIds.has(id))
            )
        );
        setEveryoneSelected(nextEveryoneSelected);
        setSelectedMemberIds(dedupedMemberIds);
        dispatchCalendarCommand({
            type: 'setMemberFilter',
            everyoneSelected: nextEveryoneSelected,
            selectedMemberIds: dedupedMemberIds,
        });
    };

    const applyChoreFilter = (nextChoreIds: string[]) => {
        const allowedIds = new Set(choreIds);
        const dedupedChoreIds = Array.from(
            new Set(
                nextChoreIds
                    .map((id) => String(id || '').trim())
                    .filter((id) => id.length > 0 && allowedIds.has(id))
            )
        );

        setChoreFilterConfigured(true);
        setSelectedChoreIds(dedupedChoreIds);
        dispatchCalendarCommand({
            type: 'setChoreFilter',
            selectedChoreIds: dedupedChoreIds,
        });
    };

    const memberFilterSummary = useMemo(() => {
        const selectedIdSet = new Set(selectedMemberIds);
        const selectedNames = familyMembers
            .filter((member) => selectedIdSet.has(member.id))
            .map((member) => {
                const normalizedName = String(member.name || '').trim();
                return normalizedName || 'Unnamed member';
            });
        const allMembersSelected =
            familyMemberIds.length === 0 || familyMemberIds.every((memberId) => selectedIdSet.has(memberId));

        if (everyoneSelected && allMembersSelected) {
            return 'Show all events';
        }

        if (!everyoneSelected) {
            if (selectedNames.length === 0) {
                return 'Show no events';
            }
            return `Show events pertaining to ${humanJoin(selectedNames)}`;
        }

        if (selectedNames.length === 0) {
            return "Show only events that don't pertain to any individual family members";
        }

        return `Show events that apply to everyone and pertain to ${humanJoin(selectedNames)}`;
    }, [everyoneSelected, familyMemberIds, familyMembers, selectedMemberIds]);

    const choreFilterSummary = useMemo(() => {
        if (chores.length === 0) {
            return 'No chores available yet';
        }

        if (!choreFilterConfigured) {
            return 'All chores selected';
        }

        if (selectedChoreIds.length === 0) {
            return 'No chores selected';
        }

        if (effectiveSelectedChoreIds.length === choreIds.length) {
            return 'All chores selected';
        }

        return `Showing ${effectiveSelectedChoreIds.length} of ${choreIds.length} chores`;
    }, [choreFilterConfigured, choreIds.length, chores.length, effectiveSelectedChoreIds.length, selectedChoreIds.length]);

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
                            <p className="text-xs text-muted-foreground">Switch views and adjust the calendar display.</p>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="calendar-view-mode-header">View</Label>
                            <select
                                id="calendar-view-mode-header"
                                value={viewMode}
                                onChange={(event) => {
                                    const next = event.target.value === 'year' ? 'year' : 'monthly';
                                    setViewMode(next);
                                    dispatchCalendarCommand({ type: 'setViewMode', viewMode: next });
                                }}
                                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                            >
                                <option value="monthly">Monthly</option>
                                <option value="year">Full year</option>
                            </select>
                        </div>

                        {viewMode === 'year' ? (
                            <div className="grid gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="calendar-year-month-basis-header">Year View Month Basis</Label>
                                    <select
                                        id="calendar-year-month-basis-header"
                                        value={yearMonthBasis}
                                        onChange={(event) => {
                                            const next = event.target.value === 'bs' ? 'bs' : 'gregorian';
                                            setYearMonthBasis(next);
                                            dispatchCalendarCommand({ type: 'setYearMonthBasis', yearMonthBasis: next });
                                        }}
                                        className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                                    >
                                        <option value="gregorian">Gregorian months</option>
                                        <option value="bs">BS months</option>
                                    </select>
                                </div>

                                <div className="grid gap-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <Label htmlFor="calendar-year-font-scale-header">Event Font Size</Label>
                                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                                            <span>Small</span>
                                            <span>Large</span>
                                        </div>
                                    </div>
                                    <input
                                        id="calendar-year-font-scale-header"
                                        type="range"
                                        min={CALENDAR_YEAR_FONT_SCALE_MIN}
                                        max={CALENDAR_YEAR_FONT_SCALE_MAX}
                                        step={0.02}
                                        value={yearFontScale}
                                        onChange={(event) => {
                                            const next = clampYearFontScale(Number(event.target.value));
                                            setYearFontScale(next);
                                            dispatchCalendarCommand({ type: 'setYearFontScale', yearFontScale: next });
                                        }}
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        Year view auto-sizes the months to fit the display and uses this slider for event density.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
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
                            </>
                        )}

                        <label
                            htmlFor="calendar-show-chores-header"
                            className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                        >
                            <Checkbox
                                id="calendar-show-chores-header"
                                checked={showChores}
                                onCheckedChange={(checked) => {
                                    const next = normalizeChecked(checked);
                                    setShowChores(next);
                                    dispatchCalendarCommand({ type: 'setShowChores', showChores: next });
                                }}
                            />
                            <div className="space-y-1">
                                <span className="block text-sm font-medium">Show chores on calendar</span>
                                <span className="block text-xs text-muted-foreground">
                                    Overlay due chores in a separate color and apply the same person filter.
                                </span>
                            </div>
                        </label>
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
                            <p className="text-xs text-muted-foreground">{memberFilterSummary}</p>
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

                        {filterOptionsQuery.isLoading ? (
                            <p className="text-xs text-muted-foreground">Loading family members...</p>
                        ) : filterOptionsQuery.error ? (
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

                        {showChores ? (
                            <div className="grid gap-2 border-t border-slate-200 pt-3">
                                <button
                                    type="button"
                                    className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-left"
                                    aria-expanded={isChoreFilterExpanded}
                                    onClick={() => setIsChoreFilterExpanded((previous) => !previous)}
                                >
                                    <div className="space-y-1">
                                        <span className="block text-sm font-medium">Specific chores</span>
                                        <span className="block text-xs text-muted-foreground">{choreFilterSummary}</span>
                                    </div>
                                    <span className="text-xs font-medium text-slate-600">
                                        {isChoreFilterExpanded ? 'Hide' : 'Show'}
                                    </span>
                                </button>

                                {isChoreFilterExpanded ? (
                                    <div data-testid="calendar-chore-filter-options" className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                                        <div className="flex items-center gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-8"
                                                onClick={() => applyChoreFilter(choreIds)}
                                                disabled={choreIds.length === 0}
                                            >
                                                Select all
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-8"
                                                onClick={() => applyChoreFilter([])}
                                                disabled={choreIds.length === 0}
                                            >
                                                Select none
                                            </Button>
                                        </div>

                                        {filterOptionsQuery.isLoading ? (
                                            <p className="text-xs text-muted-foreground">Loading chores...</p>
                                        ) : filterOptionsQuery.error ? (
                                            <p className="text-xs text-destructive">Could not load chores.</p>
                                        ) : chores.length === 0 ? (
                                            <p className="text-xs text-muted-foreground">No chores available yet.</p>
                                        ) : (
                                            <div className="grid max-h-56 gap-2 overflow-y-auto pr-1">
                                                {chores.map((chore) => (
                                                    <label
                                                        key={chore.id}
                                                        htmlFor={`calendar-filter-chore-${chore.id}`}
                                                        className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                                                    >
                                                        <Checkbox
                                                            id={`calendar-filter-chore-${chore.id}`}
                                                            checked={effectiveSelectedChoreIds.includes(chore.id)}
                                                            onCheckedChange={(checked) => {
                                                                const currentSelection = effectiveSelectedChoreIds;
                                                                const next = normalizeChecked(checked)
                                                                    ? [...currentSelection, chore.id]
                                                                    : currentSelection.filter((id) => id !== chore.id);
                                                                applyChoreFilter(next);
                                                            }}
                                                        />
                                                        <span className="text-sm">{chore.title || 'Untitled chore'}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
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
