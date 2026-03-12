'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Filter, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import CalendarEventFontScaleControl from '@/components/calendar/CalendarEventFontScaleControl';
import { useCalendarFilterOptions } from '@/components/calendar/useCalendarFilterOptions';
import {
    CALENDAR_AGENDA_FONT_SCALE_DEFAULT,
    CALENDAR_AGENDA_FONT_SCALE_MAX,
    CALENDAR_AGENDA_FONT_SCALE_MIN,
    CALENDAR_AGENDA_FONT_SCALE_STORAGE_KEY,
    CALENDAR_AGENDA_SHOW_DESCRIPTION_STORAGE_KEY,
    CALENDAR_AGENDA_SHOW_LOCATION_STORAGE_KEY,
    CALENDAR_AGENDA_SHOW_METADATA_STORAGE_KEY,
    CALENDAR_AGENDA_SHOW_TAGS_STORAGE_KEY,
    CALENDAR_COMMAND_EVENT,
    CALENDAR_DAY_HEIGHT_DEFAULT,
    CALENDAR_DAY_HEIGHT_MAX,
    CALENDAR_DAY_HEIGHT_MIN,
    CALENDAR_DAY_HEIGHT_STORAGE_KEY,
    CALENDAR_DAY_VIEW_HOUR_HEIGHT_DEFAULT,
    CALENDAR_DAY_VIEW_HOUR_HEIGHT_MAX,
    CALENDAR_DAY_VIEW_HOUR_HEIGHT_MIN,
    CALENDAR_DAY_VIEW_HOUR_HEIGHT_STORAGE_KEY,
    CALENDAR_DAY_VIEW_ROW_COUNT_DEFAULT,
    CALENDAR_DAY_VIEW_ROW_COUNT_STORAGE_KEY,
    CALENDAR_DAY_VIEW_VISIBLE_DAYS_DEFAULT,
    CALENDAR_DAY_VIEW_VISIBLE_DAYS_MAX,
    CALENDAR_DAY_VIEW_VISIBLE_DAYS_MIN,
    CALENDAR_DAY_VIEW_VISIBLE_DAYS_STORAGE_KEY,
    CALENDAR_SHOW_BS_CALENDAR_STORAGE_KEY,
    CALENDAR_SHOW_CHORES_STORAGE_KEY,
    CALENDAR_SHOW_GREGORIAN_CALENDAR_STORAGE_KEY,
    CALENDAR_SHOW_INLINE_NON_BASIS_MONTH_BREAKS_STORAGE_KEY,
    CALENDAR_STATE_EVENT,
    CALENDAR_VIEW_MODE_STORAGE_KEY,
    CALENDAR_VISIBLE_WEEKS_MAX,
    CALENDAR_VISIBLE_WEEKS_MIN,
    CALENDAR_YEAR_FONT_SCALE_DEFAULT,
    CALENDAR_YEAR_FONT_SCALE_STORAGE_KEY,
    CALENDAR_YEAR_MONTH_BASIS_STORAGE_KEY,
    clampCalendarAgendaFontScale,
    clampCalendarDayHourHeight,
    clampCalendarDayRowCount,
    clampCalendarDayVisibleDays,
    clampCalendarYearFontScale,
    createDefaultCalendarAgendaDisplaySettings,
    createDefaultCalendarPersistentFilters,
    createEmptyCalendarDateRangeFilter,
    createEmptyCalendarTagExpression,
    type CalendarAgendaDisplaySettings,
    type CalendarCommandDetail,
    type CalendarFilterDateRange,
    type CalendarLiveSearchState,
    type CalendarPersistentFilters,
    type CalendarStateDetail,
    type CalendarTagExpression,
    type CalendarViewMode,
    type CalendarYearMonthBasis,
} from '@/lib/calendar-controls';
import { createFlatOrTagExpression, flattenCalendarTagExpressionIds, normalizeCalendarTagExpression } from '@/lib/calendar-search';

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const normalizeChecked = (value: boolean | 'indeterminate') => value === true;

const humanJoin = (items: string[]) => {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
};

const dispatchCalendarCommand = (detail: CalendarCommandDetail) => {
    window.dispatchEvent(new CustomEvent<CalendarCommandDetail>(CALENDAR_COMMAND_EVENT, { detail }));
};

const normalizeDateRange = (value?: CalendarFilterDateRange | null): CalendarFilterDateRange => ({
    mode: value?.mode || 'any',
    startDate: String(value?.startDate || ''),
    endDate: String(value?.endDate || ''),
});

const summarizeDateRange = (dateRange: CalendarFilterDateRange) => {
    if (dateRange.mode === 'before') {
        return dateRange.endDate ? `On or before ${dateRange.endDate}` : 'Any date';
    }
    if (dateRange.mode === 'after') {
        return dateRange.startDate ? `On or after ${dateRange.startDate}` : 'Any date';
    }
    if (dateRange.mode === 'between') {
        if (dateRange.startDate && dateRange.endDate) return `${dateRange.startDate} to ${dateRange.endDate}`;
        if (dateRange.startDate) return `From ${dateRange.startDate}`;
        if (dateRange.endDate) return `Until ${dateRange.endDate}`;
    }
    return 'Any date';
};

const summarizeTagExpression = (
    expression: CalendarTagExpression,
    tagNameById: Map<string, string>
) => {
    const normalized = normalizeCalendarTagExpression(expression);
    const includeSummary = normalized.anyOf
        .map((group) => group.map((tagId) => tagNameById.get(tagId) || tagId).join(' + '))
        .filter(Boolean);
    const excludeSummary = normalized.exclude.map((tagId) => tagNameById.get(tagId) || tagId).filter(Boolean);

    if (includeSummary.length === 0 && excludeSummary.length === 0) {
        return 'No tag filter';
    }

    const parts: string[] = [];
    if (includeSummary.length > 0) {
        parts.push(`match ${includeSummary.join(' or ')}`);
    }
    if (excludeSummary.length > 0) {
        parts.push(`exclude ${excludeSummary.join(', ')}`);
    }
    return parts.join(' • ');
};

const normalizeAgendaDisplay = (value?: Partial<CalendarAgendaDisplaySettings> | null): CalendarAgendaDisplaySettings => {
    const defaults = createDefaultCalendarAgendaDisplaySettings();
    return {
        fontScale: clampCalendarAgendaFontScale(
            typeof value?.fontScale === 'number' ? value.fontScale : defaults.fontScale
        ),
        showTags: typeof value?.showTags === 'boolean' ? value.showTags : defaults.showTags,
        showDescription: typeof value?.showDescription === 'boolean' ? value.showDescription : defaults.showDescription,
        showLocation: typeof value?.showLocation === 'boolean' ? value.showLocation : defaults.showLocation,
        showMetadata: typeof value?.showMetadata === 'boolean' ? value.showMetadata : defaults.showMetadata,
    };
};

const normalizeSearchState = (value?: Partial<CalendarLiveSearchState> | null): CalendarLiveSearchState => ({
    isOpen: Boolean(value?.isOpen),
    query: String(value?.query || ''),
});

export default function CalendarHeaderControls() {
    const pathname = usePathname();
    const isCalendarRoute = useMemo(() => pathname?.startsWith('/calendar') ?? false, [pathname]);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const hasInitializedMemberFilterRef = useRef(false);

    const [dayHeight, setDayHeight] = useState(CALENDAR_DAY_HEIGHT_DEFAULT);
    const [visibleWeeks, setVisibleWeeks] = useState(6);
    const [showChores, setShowChores] = useState(false);
    const [viewMode, setViewMode] = useState<CalendarViewMode>('monthly');
    const [dayVisibleDays, setDayVisibleDays] = useState(CALENDAR_DAY_VIEW_VISIBLE_DAYS_DEFAULT);
    const [dayRowCount, setDayRowCount] = useState(CALENDAR_DAY_VIEW_ROW_COUNT_DEFAULT);
    const [dayHourHeight, setDayHourHeight] = useState(CALENDAR_DAY_VIEW_HOUR_HEIGHT_DEFAULT);
    const [yearMonthBasis, setYearMonthBasis] = useState<CalendarYearMonthBasis>('gregorian');
    const [showGregorianCalendar, setShowGregorianCalendar] = useState(true);
    const [showBsCalendar, setShowBsCalendar] = useState(true);
    const [showInlineNonBasisMonthBreaks, setShowInlineNonBasisMonthBreaks] = useState(true);
    const [yearFontScale, setYearFontScale] = useState(CALENDAR_YEAR_FONT_SCALE_DEFAULT);
    const [agendaDisplay, setAgendaDisplay] = useState<CalendarAgendaDisplaySettings>(
        createDefaultCalendarAgendaDisplaySettings()
    );
    const [searchState, setSearchState] = useState<CalendarLiveSearchState>({ isOpen: false, query: '' });
    const [filters, setFilters] = useState<CalendarPersistentFilters>(createDefaultCalendarPersistentFilters);
    const [selectedChoreIds, setSelectedChoreIds] = useState<string[]>([]);
    const [choreFilterConfigured, setChoreFilterConfigured] = useState(false);
    const [everyoneSelected, setEveryoneSelected] = useState(true);
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
    const [isChoreFilterExpanded, setIsChoreFilterExpanded] = useState(false);
    const [draftTagGroupCount, setDraftTagGroupCount] = useState(1);

    const filterOptionsQuery = useCalendarFilterOptions();
    const { familyMembers, familyMemberIds, chores, choreIds, tags, tagIds } = filterOptionsQuery;
    const normalizedTagExpression = useMemo(() => normalizeCalendarTagExpression(filters.tagExpression), [filters.tagExpression]);
    const renderedTagGroupCount = useMemo(
        () => Math.max(draftTagGroupCount, normalizedTagExpression.anyOf.length || 1),
        [draftTagGroupCount, normalizedTagExpression.anyOf.length]
    );
    const tagNameById = useMemo(
        () => new Map(tags.map((tag) => [tag.id, String(tag.name || '').trim() || 'Untitled tag'])),
        [tags]
    );
    const effectiveSelectedChoreIds = useMemo(
        () => (choreFilterConfigured ? selectedChoreIds : choreIds),
        [choreFilterConfigured, choreIds, selectedChoreIds]
    );

    useEffect(() => {
        if (!isCalendarRoute) return;

        setShowChores(window.localStorage.getItem(CALENDAR_SHOW_CHORES_STORAGE_KEY) === 'true');
        const storedViewMode = window.localStorage.getItem(CALENDAR_VIEW_MODE_STORAGE_KEY);
        if (storedViewMode === 'monthly' || storedViewMode === 'year' || storedViewMode === 'day' || storedViewMode === 'agenda') {
            setViewMode(storedViewMode);
        }

        const storedDayVisibleDays = Number(window.localStorage.getItem(CALENDAR_DAY_VIEW_VISIBLE_DAYS_STORAGE_KEY));
        if (Number.isFinite(storedDayVisibleDays)) {
            setDayVisibleDays(clampCalendarDayVisibleDays(storedDayVisibleDays));
        }
        const storedDayRowCount = Number(window.localStorage.getItem(CALENDAR_DAY_VIEW_ROW_COUNT_STORAGE_KEY));
        if (Number.isFinite(storedDayRowCount)) {
            setDayRowCount(clampCalendarDayRowCount(storedDayRowCount));
        }
        const storedDayHourHeight = Number(window.localStorage.getItem(CALENDAR_DAY_VIEW_HOUR_HEIGHT_STORAGE_KEY));
        if (Number.isFinite(storedDayHourHeight)) {
            setDayHourHeight(clampCalendarDayHourHeight(storedDayHourHeight));
        }

        const storedYearMonthBasis = window.localStorage.getItem(CALENDAR_YEAR_MONTH_BASIS_STORAGE_KEY);
        if (storedYearMonthBasis === 'gregorian' || storedYearMonthBasis === 'bs') {
            setYearMonthBasis(storedYearMonthBasis);
        }
        const storedShowGregorianCalendar = window.localStorage.getItem(CALENDAR_SHOW_GREGORIAN_CALENDAR_STORAGE_KEY);
        if (storedShowGregorianCalendar === 'true' || storedShowGregorianCalendar === 'false') {
            setShowGregorianCalendar(storedShowGregorianCalendar === 'true');
        }
        const storedShowBsCalendar = window.localStorage.getItem(CALENDAR_SHOW_BS_CALENDAR_STORAGE_KEY);
        if (storedShowBsCalendar === 'true' || storedShowBsCalendar === 'false') {
            setShowBsCalendar(storedShowBsCalendar === 'true');
        }
        const storedShowInlineNonBasisMonthBreaks = window.localStorage.getItem(CALENDAR_SHOW_INLINE_NON_BASIS_MONTH_BREAKS_STORAGE_KEY);
        if (storedShowInlineNonBasisMonthBreaks === 'true' || storedShowInlineNonBasisMonthBreaks === 'false') {
            setShowInlineNonBasisMonthBreaks(storedShowInlineNonBasisMonthBreaks === 'true');
        }
        const storedYearFontScale = Number(window.localStorage.getItem(CALENDAR_YEAR_FONT_SCALE_STORAGE_KEY));
        if (Number.isFinite(storedYearFontScale)) {
            setYearFontScale(clampCalendarYearFontScale(storedYearFontScale));
        }

        const storedAgendaFontScale = Number(window.localStorage.getItem(CALENDAR_AGENDA_FONT_SCALE_STORAGE_KEY));
        const storedAgendaDisplay = normalizeAgendaDisplay({
            fontScale: Number.isFinite(storedAgendaFontScale) ? storedAgendaFontScale : undefined,
            showTags: window.localStorage.getItem(CALENDAR_AGENDA_SHOW_TAGS_STORAGE_KEY) !== 'false',
            showDescription: window.localStorage.getItem(CALENDAR_AGENDA_SHOW_DESCRIPTION_STORAGE_KEY) !== 'false',
            showLocation: window.localStorage.getItem(CALENDAR_AGENDA_SHOW_LOCATION_STORAGE_KEY) !== 'false',
            showMetadata: window.localStorage.getItem(CALENDAR_AGENDA_SHOW_METADATA_STORAGE_KEY) !== 'false',
        });
        setAgendaDisplay(storedAgendaDisplay);

        const storedDayHeight = window.localStorage.getItem(CALENDAR_DAY_HEIGHT_STORAGE_KEY);
        if (storedDayHeight) {
            const parsed = Number(storedDayHeight);
            if (Number.isFinite(parsed)) {
                setDayHeight(clampNumber(Math.round(parsed), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX));
            }
        }
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
            setSearchState(normalizeSearchState(detail.search));
            setFilters({
                textQuery: String(detail.filters?.textQuery || ''),
                dateRange: normalizeDateRange(detail.filters?.dateRange),
                tagExpression:
                    detail.filters?.tagExpression ||
                    detail.tagFilter?.tagExpression ||
                    createFlatOrTagExpression(detail.tagFilter?.selectedTagIds || []),
            });
            setAgendaDisplay(normalizeAgendaDisplay(detail.agendaDisplay));
            setDayVisibleDays(clampCalendarDayVisibleDays(detail.dayVisibleDays));
            setDayRowCount(clampCalendarDayRowCount(detail.dayRowCount));
            setDayHourHeight(clampCalendarDayHourHeight(detail.dayHourHeight));
            setYearMonthBasis(detail.yearMonthBasis);
            setShowGregorianCalendar(Boolean(detail.showGregorianCalendar));
            setShowBsCalendar(Boolean(detail.showBsCalendar));
            setShowInlineNonBasisMonthBreaks(Boolean(detail.showInlineNonBasisMonthBreaks));
            setYearFontScale(clampCalendarYearFontScale(detail.yearFontScale));

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
        return () => window.removeEventListener(CALENDAR_STATE_EVENT, onCalendarState);
    }, [isCalendarRoute]);

    useEffect(() => {
        if (!searchState.isOpen) return;
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
    }, [searchState.isOpen]);

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
        if (filterOptionsQuery.isLoading) return;

        const nextExpression = normalizeCalendarTagExpression(filters.tagExpression);
        const allowedIds = new Set(tagIds);
        const sanitizedExpression = normalizeCalendarTagExpression({
            anyOf: nextExpression.anyOf.map((group) => group.filter((tagId) => allowedIds.has(tagId))),
            exclude: nextExpression.exclude.filter((tagId) => allowedIds.has(tagId)),
        });

        const flattenedCurrent = flattenCalendarTagExpressionIds(nextExpression).join('|');
        const flattenedNext = flattenCalendarTagExpressionIds(sanitizedExpression).join('|');
        if (flattenedCurrent !== flattenedNext || nextExpression.anyOf.length !== sanitizedExpression.anyOf.length) {
            setFilters((current) => ({ ...current, tagExpression: sanitizedExpression }));
            dispatchCalendarCommand({ type: 'setTagExpressionFilter', tagExpression: sanitizedExpression });
        }
    }, [filterOptionsQuery.isLoading, filters.tagExpression, isCalendarRoute, tagIds]);

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
            new Set(nextMemberIds.map((id) => String(id || '').trim()).filter((id) => id.length > 0 && allowedIds.has(id)))
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
            new Set(nextChoreIds.map((id) => String(id || '').trim()).filter((id) => id.length > 0 && allowedIds.has(id)))
        );
        setChoreFilterConfigured(true);
        setSelectedChoreIds(dedupedChoreIds);
        dispatchCalendarCommand({
            type: 'setChoreFilter',
            selectedChoreIds: dedupedChoreIds,
        });
    };

    const applySearchOpen = (isOpen: boolean) => {
        setSearchState((current) => ({ ...current, isOpen }));
        dispatchCalendarCommand({ type: 'setSearchOpen', isOpen });
    };

    const applySearchQuery = (query: string) => {
        setSearchState((current) => ({ ...current, query }));
        dispatchCalendarCommand({ type: 'setSearchQuery', query });
    };

    const applyPersistentTextFilter = (textQuery: string) => {
        setFilters((current) => ({ ...current, textQuery }));
        dispatchCalendarCommand({ type: 'setPersistentTextFilter', textQuery });
    };

    const applyDateRange = (dateRange: CalendarFilterDateRange) => {
        const normalized = normalizeDateRange(dateRange);
        setFilters((current) => ({ ...current, dateRange: normalized }));
        dispatchCalendarCommand({ type: 'setPersistentDateRange', dateRange: normalized });
    };

    const applyTagExpression = (tagExpression: CalendarTagExpression) => {
        const normalized = normalizeCalendarTagExpression(tagExpression);
        setFilters((current) => ({ ...current, tagExpression: normalized }));
        dispatchCalendarCommand({ type: 'setTagExpressionFilter', tagExpression: normalized });
    };

    const applyAgendaDisplay = (nextValue: Partial<CalendarAgendaDisplaySettings>) => {
        const merged = normalizeAgendaDisplay({ ...agendaDisplay, ...nextValue });
        setAgendaDisplay(merged);
        dispatchCalendarCommand({ type: 'setAgendaDisplay', agendaDisplay: merged });
    };

    const memberFilterSummary = useMemo(() => {
        const selectedIdSet = new Set(selectedMemberIds);
        const selectedNames = familyMembers
            .filter((member) => selectedIdSet.has(member.id))
            .map((member) => String(member.name || '').trim() || 'Unnamed member');
        const allMembersSelected =
            familyMemberIds.length === 0 || familyMemberIds.every((memberId) => selectedIdSet.has(memberId));

        if (everyoneSelected && allMembersSelected) {
            return 'Show all events';
        }
        if (!everyoneSelected) {
            if (selectedNames.length === 0) return 'Show no events';
            return `Show events pertaining to ${humanJoin(selectedNames)}`;
        }
        if (selectedNames.length === 0) {
            return "Show only events that don't pertain to any individual family members";
        }
        return `Show events that apply to everyone and pertain to ${humanJoin(selectedNames)}`;
    }, [everyoneSelected, familyMemberIds, familyMembers, selectedMemberIds]);

    const choreFilterSummary = useMemo(() => {
        if (chores.length === 0) return 'No chores available yet';
        if (!choreFilterConfigured) return 'All chores selected';
        if (selectedChoreIds.length === 0) return 'No chores selected';
        if (effectiveSelectedChoreIds.length === choreIds.length) return 'All chores selected';
        return `Showing ${effectiveSelectedChoreIds.length} of ${choreIds.length} chores`;
    }, [choreFilterConfigured, choreIds.length, chores.length, effectiveSelectedChoreIds.length, selectedChoreIds.length]);

    const tagFilterSummary = useMemo(
        () => summarizeTagExpression(normalizedTagExpression, tagNameById),
        [normalizedTagExpression, tagNameById]
    );

    const agendaDisplaySummary = useMemo(() => {
        const enabled = [
            agendaDisplay.showDescription ? 'description' : '',
            agendaDisplay.showLocation ? 'location' : '',
            agendaDisplay.showTags ? 'tags' : '',
            agendaDisplay.showMetadata ? 'metadata' : '',
        ].filter(Boolean);
        return enabled.length > 0 ? `Showing ${enabled.join(', ')}` : 'Minimal rows';
    }, [agendaDisplay]);

    const updateTagGroup = (groupIndex: number, tagId: string, checked: boolean | 'indeterminate') => {
        const normalized = normalizedTagExpression;
        const nextAnyOf = normalized.anyOf.map((group) => [...group]);
        if (!nextAnyOf[groupIndex]) {
            nextAnyOf[groupIndex] = [];
        }
        const withoutTarget = nextAnyOf[groupIndex].filter((value) => value !== tagId);
        nextAnyOf[groupIndex] = normalizeChecked(checked) ? [...withoutTarget, tagId] : withoutTarget;
        applyTagExpression({ ...normalized, anyOf: nextAnyOf.filter((group) => group.length > 0) });
    };

    const updateExcludeTag = (tagId: string, checked: boolean | 'indeterminate') => {
        const normalized = normalizedTagExpression;
        const withoutTarget = normalized.exclude.filter((value) => value !== tagId);
        applyTagExpression({
            ...normalized,
            exclude: normalizeChecked(checked) ? [...withoutTarget, tagId] : withoutTarget,
        });
    };

    if (!isCalendarRoute) {
        return null;
    }

    return (
        <div className="flex items-center gap-2">
            <Popover open={searchState.isOpen} onOpenChange={applySearchOpen}>
                <PopoverTrigger asChild>
                    <Button variant={searchState.isOpen ? 'default' : 'outline'} size="icon" aria-label="Search calendar">
                        <Search className="h-4 w-4" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[26rem]">
                    <div className="grid gap-4">
                        <div className="space-y-1">
                            <h4 className="text-sm font-semibold leading-none">Live search</h4>
                            <p className="text-xs text-muted-foreground">
                                Search titles, descriptions, locations, and tags. Results appear in the calendar rail or drawer.
                            </p>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="calendar-search-query-input">Search query</Label>
                            <Input
                                id="calendar-search-query-input"
                                ref={searchInputRef}
                                value={searchState.query}
                                placeholder="Birthday, dentist, school pickup"
                                onChange={(event) => applySearchQuery(event.target.value)}
                            />
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => applyPersistentTextFilter(searchState.query)}
                                    disabled={searchState.query.trim().length === 0}
                                >
                                    Add to filters
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => applySearchQuery('')}
                                    disabled={searchState.query.length === 0}
                                >
                                    Clear live query
                                </Button>
                            </div>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                        <SlidersHorizontal className="h-4 w-4" />
                        Settings
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80">
                    <div className="grid gap-4">
                        <div className="space-y-1">
                            <h4 className="text-sm font-semibold leading-none">Calendar settings</h4>
                            <p className="text-xs text-muted-foreground">Switch views and tune the display for the active calendar mode.</p>
                        </div>

                        <div className="grid gap-2">
                            <Label htmlFor="calendar-view-mode-header">View</Label>
                            <select
                                id="calendar-view-mode-header"
                                value={viewMode}
                                onChange={(event) => {
                                    const rawValue = event.target.value;
                                    const next: CalendarViewMode =
                                        rawValue === 'year' ? 'year' : rawValue === 'day' ? 'day' : rawValue === 'agenda' ? 'agenda' : 'monthly';
                                    setViewMode(next);
                                    dispatchCalendarCommand({ type: 'setViewMode', viewMode: next });
                                }}
                                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                            >
                                <option value="monthly">Monthly</option>
                                <option value="day">Daily / Weekly</option>
                                <option value="agenda">Agenda</option>
                                <option value="year">Full year</option>
                            </select>
                        </div>

                        {viewMode === 'year' ? (
                            <div className="grid gap-4">
                                {showGregorianCalendar && showBsCalendar ? (
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
                                ) : null}

                                <CalendarEventFontScaleControl
                                    id="calendar-year-font-scale-header"
                                    value={yearFontScale}
                                    onChange={(nextValue) => {
                                        const next = clampCalendarYearFontScale(nextValue);
                                        setYearFontScale(next);
                                        dispatchCalendarCommand({ type: 'setYearFontScale', yearFontScale: next });
                                    }}
                                    description="Year view auto-sizes the months to fit the display and uses this slider for event density."
                                />

                                <div className="grid gap-2">
                                    <span className="text-sm font-medium leading-none">Shift visible months</span>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8 flex-1"
                                            onClick={() => dispatchCalendarCommand({ type: 'shiftYearView', direction: 'left' })}
                                        >
                                            Shift left
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-8 flex-1"
                                            onClick={() => dispatchCalendarCommand({ type: 'shiftYearView', direction: 'right' })}
                                        >
                                            Shift right
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        ) : viewMode === 'day' ? (
                            <div className="grid gap-4">
                                <div className="grid gap-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <Label htmlFor="calendar-day-visible-days-header">Visible Days</Label>
                                        <span className="text-xs text-muted-foreground">{dayVisibleDays}</span>
                                    </div>
                                    <input
                                        id="calendar-day-visible-days-header"
                                        type="range"
                                        min={CALENDAR_DAY_VIEW_VISIBLE_DAYS_MIN}
                                        max={CALENDAR_DAY_VIEW_VISIBLE_DAYS_MAX}
                                        step={1}
                                        value={dayVisibleDays}
                                        onChange={(event) => {
                                            const next = clampCalendarDayVisibleDays(Number(event.target.value));
                                            setDayVisibleDays(next);
                                            dispatchCalendarCommand({ type: 'setDayVisibleDays', dayVisibleDays: next });
                                        }}
                                    />
                                </div>

                                <label
                                    htmlFor="calendar-day-row-count-header"
                                    className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                                >
                                    <Checkbox
                                        id="calendar-day-row-count-header"
                                        checked={dayRowCount === 2}
                                        onCheckedChange={(checked) => {
                                            const next = normalizeChecked(checked) ? 2 : 1;
                                            setDayRowCount(next);
                                            dispatchCalendarCommand({ type: 'setDayRowCount', dayRowCount: next });
                                        }}
                                    />
                                    <div className="space-y-1">
                                        <span className="block text-sm font-medium">Second row of days</span>
                                        <span className="block text-xs text-muted-foreground">
                                            Show twice as many days by stacking a second row below the first.
                                        </span>
                                    </div>
                                </label>

                                <div className="grid gap-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <Label htmlFor="calendar-day-hour-height-header">Hour Zoom</Label>
                                        <span className="text-xs text-muted-foreground">{dayHourHeight}px</span>
                                    </div>
                                    <input
                                        id="calendar-day-hour-height-header"
                                        type="range"
                                        min={CALENDAR_DAY_VIEW_HOUR_HEIGHT_MIN}
                                        max={CALENDAR_DAY_VIEW_HOUR_HEIGHT_MAX}
                                        step={2}
                                        value={dayHourHeight}
                                        onChange={(event) => {
                                            const next = clampCalendarDayHourHeight(Number(event.target.value));
                                            setDayHourHeight(next);
                                            dispatchCalendarCommand({ type: 'setDayHourHeight', dayHourHeight: next });
                                        }}
                                    />
                                </div>
                            </div>
                        ) : viewMode === 'agenda' ? (
                            <div className="grid gap-4">
                                <div className="space-y-1">
                                    <h4 className="text-sm font-semibold leading-none">Agenda details</h4>
                                    <p className="text-xs text-muted-foreground">{agendaDisplaySummary}</p>
                                </div>

                                <div className="grid gap-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <Label htmlFor="calendar-agenda-font-scale-header">Text size</Label>
                                        <span className="text-xs text-muted-foreground">{agendaDisplay.fontScale.toFixed(2)}x</span>
                                    </div>
                                    <input
                                        id="calendar-agenda-font-scale-header"
                                        type="range"
                                        min={CALENDAR_AGENDA_FONT_SCALE_MIN}
                                        max={CALENDAR_AGENDA_FONT_SCALE_MAX}
                                        step={0.01}
                                        value={agendaDisplay.fontScale}
                                        onChange={(event) => applyAgendaDisplay({ fontScale: Number(event.target.value) })}
                                    />
                                </div>

                                {[
                                    {
                                        id: 'calendar-agenda-show-description-header',
                                        label: 'Show descriptions',
                                        checked: agendaDisplay.showDescription,
                                        field: 'showDescription' as const,
                                    },
                                    {
                                        id: 'calendar-agenda-show-location-header',
                                        label: 'Show locations',
                                        checked: agendaDisplay.showLocation,
                                        field: 'showLocation' as const,
                                    },
                                    {
                                        id: 'calendar-agenda-show-tags-header',
                                        label: 'Show tags',
                                        checked: agendaDisplay.showTags,
                                        field: 'showTags' as const,
                                    },
                                    {
                                        id: 'calendar-agenda-show-metadata-header',
                                        label: 'Show extra metadata',
                                        checked: agendaDisplay.showMetadata,
                                        field: 'showMetadata' as const,
                                    },
                                ].map(({ id, label, checked, field }) => (
                                    <label
                                        key={id}
                                        htmlFor={id}
                                        className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                                    >
                                        <Checkbox
                                            id={id}
                                            checked={checked}
                                            onCheckedChange={(nextChecked) =>
                                                applyAgendaDisplay({ [field]: normalizeChecked(nextChecked) } as Partial<CalendarAgendaDisplaySettings>)
                                            }
                                        />
                                        <span className="text-sm font-medium">{label}</span>
                                    </label>
                                ))}
                            </div>
                        ) : (
                            <>
                                <div className="grid gap-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <Label htmlFor="calendar-day-height-header">Day height</Label>
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
                                        <Label htmlFor="calendar-weeks-visible-header">Weeks visible</Label>
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
                                            const next = clampNumber(Number(event.target.value), CALENDAR_VISIBLE_WEEKS_MIN, CALENDAR_VISIBLE_WEEKS_MAX);
                                            setVisibleWeeks(next);
                                            dispatchCalendarCommand({ type: 'setVisibleWeeks', visibleWeeks: next });
                                        }}
                                    />
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
                                    Overlay due chores in a separate color and include them in agenda/search when visible.
                                </span>
                            </div>
                        </label>

                        <div className="grid gap-2 border-t border-slate-200 pt-3">
                            <span className="text-sm font-medium leading-none">Calendar labels</span>

                            <label
                                htmlFor="calendar-show-gregorian-header"
                                className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                            >
                                <Checkbox
                                    id="calendar-show-gregorian-header"
                                    checked={showGregorianCalendar}
                                    onCheckedChange={(checked) => {
                                        const next = normalizeChecked(checked);
                                        setShowGregorianCalendar(next);
                                        dispatchCalendarCommand({ type: 'setShowGregorianCalendar', showGregorianCalendar: next });
                                    }}
                                />
                                <span className="text-sm font-medium">Show Gregorian calendar</span>
                            </label>

                            <label
                                htmlFor="calendar-show-bs-header"
                                className="flex cursor-pointer items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                            >
                                <Checkbox
                                    id="calendar-show-bs-header"
                                    checked={showBsCalendar}
                                    onCheckedChange={(checked) => {
                                        const next = normalizeChecked(checked);
                                        setShowBsCalendar(next);
                                        dispatchCalendarCommand({ type: 'setShowBsCalendar', showBsCalendar: next });
                                    }}
                                />
                                <span className="text-sm font-medium">Show BS calendar</span>
                            </label>

                            {showGregorianCalendar && showBsCalendar ? (
                                <label
                                    htmlFor="calendar-show-inline-non-basis-breaks-header"
                                    className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2"
                                >
                                    <Checkbox
                                        id="calendar-show-inline-non-basis-breaks-header"
                                        checked={showInlineNonBasisMonthBreaks}
                                        onCheckedChange={(checked) => {
                                            const next = normalizeChecked(checked);
                                            setShowInlineNonBasisMonthBreaks(next);
                                            dispatchCalendarCommand({
                                                type: 'setShowInlineNonBasisMonthBreaks',
                                                showInlineNonBasisMonthBreaks: next,
                                            });
                                        }}
                                    />
                                    <div className="space-y-1">
                                        <span className="block text-sm font-medium">Show secondary month breaks inline</span>
                                        <span className="block text-xs text-muted-foreground">
                                            Keep the non-basis calendar transitions visible when both date systems are active.
                                        </span>
                                    </div>
                                </label>
                            ) : null}
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
                <PopoverContent align="end" className="w-[30rem]">
                    <div className="grid gap-5">
                        <div className="grid gap-2">
                            <div className="space-y-1">
                                <h4 className="text-sm font-semibold leading-none">Search filter</h4>
                                <p className="text-xs text-muted-foreground">
                                    Persistent text filtering hides non-matches in every calendar view.
                                </p>
                            </div>
                            <Input
                                aria-label="Persistent search filter"
                                value={filters.textQuery}
                                placeholder="Filter calendar by text"
                                onChange={(event) => applyPersistentTextFilter(event.target.value)}
                            />
                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => applyPersistentTextFilter(searchState.query)}
                                    disabled={searchState.query.trim().length === 0}
                                >
                                    Use live search
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => applyPersistentTextFilter('')}
                                    disabled={filters.textQuery.length === 0}
                                >
                                    Clear
                                </Button>
                            </div>
                        </div>

                        <div className="grid gap-2 border-t border-slate-200 pt-4">
                            <div className="space-y-1">
                                <h4 className="text-sm font-semibold leading-none">Date range</h4>
                                <p className="text-xs text-muted-foreground">{summarizeDateRange(filters.dateRange)}</p>
                            </div>
                            <select
                                aria-label="Date range mode"
                                value={filters.dateRange.mode}
                                onChange={(event) =>
                                    applyDateRange({
                                        ...filters.dateRange,
                                        mode: event.target.value as CalendarFilterDateRange['mode'],
                                    })
                                }
                                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                            >
                                <option value="any">Any date</option>
                                <option value="before">Before or on</option>
                                <option value="after">After or on</option>
                                <option value="between">Between</option>
                            </select>

                            {(filters.dateRange.mode === 'after' || filters.dateRange.mode === 'between') ? (
                                <div className="grid gap-2">
                                    <Label htmlFor="calendar-filter-date-start">Start date</Label>
                                    <Input
                                        id="calendar-filter-date-start"
                                        type="date"
                                        value={filters.dateRange.startDate}
                                        onChange={(event) =>
                                            applyDateRange({
                                                ...filters.dateRange,
                                                startDate: event.target.value,
                                            })
                                        }
                                    />
                                </div>
                            ) : null}

                            {(filters.dateRange.mode === 'before' || filters.dateRange.mode === 'between') ? (
                                <div className="grid gap-2">
                                    <Label htmlFor="calendar-filter-date-end">End date</Label>
                                    <Input
                                        id="calendar-filter-date-end"
                                        type="date"
                                        value={filters.dateRange.endDate}
                                        onChange={(event) =>
                                            applyDateRange({
                                                ...filters.dateRange,
                                                endDate: event.target.value,
                                            })
                                        }
                                    />
                                </div>
                            ) : null}
                        </div>

                        <div className="space-y-4 border-t border-slate-200 pt-4">
                            <div className="space-y-1">
                                <h4 className="text-sm font-semibold leading-none">Member filter</h4>
                                <p className="text-xs text-muted-foreground">{memberFilterSummary}</p>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => applyMemberFilter(true, familyMemberIds)}>
                                    Select all
                                </Button>
                                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => applyMemberFilter(false, [])}>
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
                                <div className="grid max-h-52 gap-2 overflow-y-auto pr-1">
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

                        <div className="space-y-4 border-t border-slate-200 pt-4">
                            <div className="space-y-1">
                                <h4 className="text-sm font-semibold leading-none">Tag logic</h4>
                                <p className="text-xs text-muted-foreground">{tagFilterSummary}</p>
                            </div>

                            <div className="flex items-center gap-2">
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setDraftTagGroupCount((current) => current + 1)}
                                    disabled={tags.length === 0}
                                >
                                    Add OR group
                                </Button>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => applyTagExpression(createEmptyCalendarTagExpression())}
                                    disabled={flattenCalendarTagExpressionIds(filters.tagExpression).length === 0}
                                >
                                    Clear tag logic
                                </Button>
                            </div>

                            {tags.length === 0 ? (
                                <p className="text-xs text-muted-foreground">No calendar tags have been created yet.</p>
                            ) : (
                                <>
                                    {Array.from({ length: renderedTagGroupCount }, (_unused, groupIndex) => normalizedTagExpression.anyOf[groupIndex] || []).map(
                                        (group, groupIndex) => (
                                        <div
                                            key={`calendar-tag-group-${groupIndex}`}
                                            data-testid={`calendar-tag-group-${groupIndex}`}
                                            className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3"
                                        >
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-medium text-slate-900">Match all tags in group {groupIndex + 1}</div>
                                                    <div className="text-xs text-muted-foreground">Groups are ORed together.</div>
                                                </div>
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => {
                                                        if (group.length > 0) {
                                                            applyTagExpression({
                                                                ...normalizedTagExpression,
                                                                anyOf: normalizedTagExpression.anyOf.filter(
                                                                    (_unused, index) => index !== groupIndex
                                                                ),
                                                            });
                                                        }
                                                        setDraftTagGroupCount((current) => Math.max(1, current - 1));
                                                    }}
                                                >
                                                    Remove
                                                </Button>
                                            </div>
                                            <div className="grid max-h-44 gap-2 overflow-y-auto pr-1">
                                                {tags.map((tag) => (
                                                    <label
                                                        key={`${groupIndex}-${tag.id}`}
                                                        htmlFor={`calendar-tag-group-${groupIndex}-${tag.id}`}
                                                        className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                                                    >
                                                        <Checkbox
                                                            id={`calendar-tag-group-${groupIndex}-${tag.id}`}
                                                            checked={group.includes(tag.id)}
                                                            onCheckedChange={(checked) => updateTagGroup(groupIndex, tag.id, checked)}
                                                        />
                                                        <span className="text-sm">{tag.name || 'Untitled tag'}</span>
                                                    </label>
                                                ))}
                                            </div>
                                        </div>
                                        )
                                    )}

                                    <div className="grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
                                        <div className="text-sm font-medium text-slate-900">Exclude tags</div>
                                        <div className="text-xs text-muted-foreground">
                                            Excluded tags always remove an event even if an OR group matches.
                                        </div>
                                        <div className="grid max-h-44 gap-2 overflow-y-auto pr-1">
                                            {tags.map((tag) => (
                                                <label
                                                    key={`calendar-tag-exclude-${tag.id}`}
                                                    htmlFor={`calendar-tag-exclude-${tag.id}`}
                                                    className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2"
                                                >
                                                    <Checkbox
                                                        id={`calendar-tag-exclude-${tag.id}`}
                                                        checked={normalizedTagExpression.exclude.includes(tag.id)}
                                                        onCheckedChange={(checked) => updateExcludeTag(tag.id, checked)}
                                                    />
                                                    <span className="text-sm">{tag.name || 'Untitled tag'}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>

                        {showChores ? (
                            <div className="grid gap-2 border-t border-slate-200 pt-4">
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
                                    <span className="text-xs font-medium text-slate-600">{isChoreFilterExpanded ? 'Hide' : 'Show'}</span>
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
