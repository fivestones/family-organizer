'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '@/lib/db';
import FamilyMembersList from '@/components/FamilyMembersList';
import { Button } from '@/components/ui/button';
import { AttachmentCollection } from '@/components/attachments/AttachmentCollection';
import {
    getHistoryActorKey,
    getHistoryActorLabel,
    getHistoryAffectedMemberIds,
    getLinkedMessage,
    HISTORY_ACTOR_APPLE_SYNC,
    HISTORY_DOMAIN_LABELS,
    type HistoryEventLike,
    type HistoryFilterMode,
    toggleFilterMode,
} from '@/lib/history-events';

type HistoryPageProps = {
    initialSelectedMember?: string | null;
    initialDomain?: string | null;
    initialTaskSeriesId?: string | null;
};

function cycleFilter(map: Record<string, HistoryFilterMode>, key: string) {
    return {
        ...map,
        [key]: toggleFilterMode(map[key] || 'off'),
    };
}

function matchesFilterGroup(filterModes: Record<string, HistoryFilterMode>, eventKeys: string[]) {
    const keys = Array.from(new Set(eventKeys.filter(Boolean)));
    const includeKeys = Object.entries(filterModes)
        .filter(([, mode]) => mode === 'include')
        .map(([key]) => key);
    const excludeKeys = Object.entries(filterModes)
        .filter(([, mode]) => mode === 'exclude')
        .map(([key]) => key);

    if (includeKeys.length > 0 && !includeKeys.some((key) => keys.includes(key))) {
        return false;
    }
    if (excludeKeys.some((key) => keys.includes(key))) {
        return false;
    }
    return true;
}

function formatOccurredAt(value?: string | null) {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';

    return parsed.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function filterButtonClass(mode: HistoryFilterMode) {
    if (mode === 'include') {
        return 'border-sky-300 bg-sky-100 text-sky-800';
    }
    if (mode === 'exclude') {
        return 'border-rose-300 bg-rose-100 text-rose-800';
    }
    return 'border-slate-200 bg-white text-slate-700';
}

export default function HistoryPage({
    initialSelectedMember = null,
    initialDomain = null,
    initialTaskSeriesId = null,
}: HistoryPageProps) {
    const [selectedMember, setSelectedMember] = useState<string | 'All'>(initialSelectedMember || 'All');
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
    const [queryLimit, setQueryLimit] = useState(200);
    const [domainFilters, setDomainFilters] = useState<Record<string, HistoryFilterMode>>({});
    const [actorFilters, setActorFilters] = useState<Record<string, HistoryFilterMode>>({});
    const [affectedFilters, setAffectedFilters] = useState<Record<string, HistoryFilterMode>>({});
    const [dateStart, setDateStart] = useState('');
    const [dateEnd, setDateEnd] = useState('');
    const [taskSeriesFilterId, setTaskSeriesFilterId] = useState(initialTaskSeriesId || '');
    const [taskSeriesFilterMode, setTaskSeriesFilterMode] = useState<'include' | 'exclude'>('include');
    const feedRef = useRef<HTMLDivElement | null>(null);

    const { data, isLoading, error } = db.useQuery({
        historyEvents: {
            $: {
                order: {
                    occurredAt: sortDirection,
                },
                limit: queryLimit,
            },
            actor: {},
            affectedFamilyMembers: {},
            attachments: {},
            message: {
                attachments: {},
                author: {},
            },
        },
        familyMembers: {
            $: {
                order: {
                    order: 'asc',
                },
            },
        },
        taskSeries: {
            familyMember: {},
        },
    });

    const familyMembers = useMemo(() => (data?.familyMembers as any[]) || [], [data?.familyMembers]);
    const taskSeriesList = useMemo(() => (data?.taskSeries as any[]) || [], [data?.taskSeries]);
    const historyEvents = useMemo(() => (data?.historyEvents as HistoryEventLike[]) || [], [data?.historyEvents]);
    const familyMemberNamesById = useMemo(
        () => new Map(familyMembers.map((member: any) => [member.id, member.name || 'Unknown'])),
        [familyMembers]
    );

    useEffect(() => {
        if (!initialDomain) return;
        setDomainFilters((prev) => ({
            ...prev,
            [initialDomain]: prev[initialDomain] === 'off' || !prev[initialDomain] ? 'include' : prev[initialDomain],
        }));
    }, [initialDomain]);

    const actorOptions = useMemo(() => {
        const options = familyMembers.map((member: any) => ({
            id: member.id,
            label: member.name || 'Unknown',
        }));

        if (historyEvents.some((event) => getHistoryActorKey(event) === HISTORY_ACTOR_APPLE_SYNC)) {
            options.push({
                id: HISTORY_ACTOR_APPLE_SYNC,
                label: 'Apple Sync',
            });
        }

        return options;
    }, [familyMembers, historyEvents]);

    const filteredEvents = useMemo(() => {
        return historyEvents.filter((event) => {
            const actorKey = getHistoryActorKey(event);
            const affectedIds = getHistoryAffectedMemberIds(event);
            const linkedMessage = getLinkedMessage(event);

            if (selectedMember !== 'All') {
                const involvesSelectedMember = actorKey === selectedMember || affectedIds.includes(selectedMember);
                if (!involvesSelectedMember) {
                    return false;
                }
            }

            if (!matchesFilterGroup(domainFilters, [String(event.domain || '')])) {
                return false;
            }

            if (!matchesFilterGroup(actorFilters, actorKey ? [actorKey] : [])) {
                return false;
            }

            if (!matchesFilterGroup(affectedFilters, affectedIds)) {
                return false;
            }

            if (taskSeriesFilterId) {
                const matched = event.taskSeriesId === taskSeriesFilterId;
                if (taskSeriesFilterMode === 'include' && !matched) {
                    return false;
                }
                if (taskSeriesFilterMode === 'exclude' && matched) {
                    return false;
                }
            }

            const occurredAt = String(event.occurredAt || '');
            if (dateStart && occurredAt.slice(0, 10) < dateStart) {
                return false;
            }
            if (dateEnd && occurredAt.slice(0, 10) > dateEnd) {
                return false;
            }

            if (event.domain === 'messages' && !linkedMessage && !event.messageId) {
                return false;
            }

            return true;
        });
    }, [historyEvents, selectedMember, domainFilters, actorFilters, affectedFilters, taskSeriesFilterId, taskSeriesFilterMode, dateStart, dateEnd]);

    const jumpToNow = () => {
        if (!feedRef.current) return;
        feedRef.current.scrollTo({
            top: sortDirection === 'desc' ? 0 : feedRef.current.scrollHeight,
            behavior: 'smooth',
        });
    };

    const clearFilters = () => {
        setDomainFilters(initialDomain ? { [initialDomain]: 'include' } : {});
        setActorFilters({});
        setAffectedFilters({});
        setDateStart('');
        setDateEnd('');
        setTaskSeriesFilterId(initialTaskSeriesId || '');
        setTaskSeriesFilterMode('include');
    };

    return (
        <div className="p-4">
            <div className="mx-auto flex h-[calc(100vh-8rem)] w-full max-w-[1700px] flex-col gap-4 md:flex-row md:items-start">
                <div className="rounded-2xl border bg-card p-4 md:h-full md:w-[clamp(260px,24vw,360px)] md:flex-shrink-0">
                    <FamilyMembersList
                        familyMembers={familyMembers}
                        selectedMember={selectedMember}
                        setSelectedMember={(memberId: string | null | 'All') => setSelectedMember(memberId || 'All')}
                        db={db}
                    />
                </div>

                <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                    <div className="border-b border-slate-200 bg-white px-6 py-5">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                                <h1 className="text-3xl font-bold">History</h1>
                                <p className="mt-1 text-sm text-slate-500">Unified family activity across chores, tasks, calendar, finance, and messages.</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button type="button" variant="outline" onClick={jumpToNow}>
                                    Jump to now
                                </Button>
                                <Button type="button" variant="outline" onClick={clearFilters}>
                                    Clear filters
                                </Button>
                            </div>
                        </div>

                        <div className="mt-5 space-y-4">
                            <div>
                                <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Activity Types</div>
                                <div className="flex flex-wrap gap-2">
                                    {Object.entries(HISTORY_DOMAIN_LABELS).map(([key, label]) => (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => setDomainFilters((prev) => cycleFilter(prev, key))}
                                            className={`rounded-full border px-3 py-1 text-sm transition-colors ${filterButtonClass(domainFilters[key] || 'off')}`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <details className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                <summary className="cursor-pointer text-sm font-semibold text-slate-800">More filters</summary>
                                <div className="mt-4 space-y-4">
                                    <div className="grid gap-4 lg:grid-cols-2">
                                        <div>
                                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Actor</div>
                                            <div className="flex flex-wrap gap-2">
                                                {actorOptions.map((actor) => (
                                                    <button
                                                        key={actor.id}
                                                        type="button"
                                                        onClick={() => setActorFilters((prev) => cycleFilter(prev, actor.id))}
                                                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${filterButtonClass(actorFilters[actor.id] || 'off')}`}
                                                    >
                                                        {actor.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Affected People</div>
                                            <div className="flex flex-wrap gap-2">
                                                {familyMembers.map((member: any) => (
                                                    <button
                                                        key={member.id}
                                                        type="button"
                                                        onClick={() => setAffectedFilters((prev) => cycleFilter(prev, member.id))}
                                                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${filterButtonClass(affectedFilters[member.id] || 'off')}`}
                                                    >
                                                        {member.name}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                                        <div>
                                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Task Series</div>
                                            <select
                                                value={taskSeriesFilterId}
                                                onChange={(event) => setTaskSeriesFilterId(event.target.value)}
                                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                            >
                                                <option value="">All task series</option>
                                                {taskSeriesList
                                                    .slice()
                                                    .sort((left: any, right: any) => String(left.name || '').localeCompare(String(right.name || '')))
                                                    .map((series: any) => (
                                                        <option key={series.id} value={series.id}>
                                                            {series.name}
                                                        </option>
                                                    ))}
                                            </select>
                                        </div>
                                        <div>
                                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Series Mode</div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => setTaskSeriesFilterMode((prev) => (prev === 'include' ? 'exclude' : 'include'))}
                                            >
                                                {taskSeriesFilterMode === 'include' ? 'Include' : 'Exclude'}
                                            </Button>
                                        </div>
                                        <div>
                                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Sort</div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => setSortDirection((prev) => (prev === 'desc' ? 'asc' : 'desc'))}
                                            >
                                                {sortDirection === 'desc' ? 'Newest first' : 'Oldest first'}
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="grid gap-4 lg:grid-cols-2">
                                        <div>
                                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Start Date</div>
                                            <input
                                                type="date"
                                                value={dateStart}
                                                onChange={(event) => setDateStart(event.target.value)}
                                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                            />
                                        </div>
                                        <div>
                                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">End Date</div>
                                            <input
                                                type="date"
                                                value={dateEnd}
                                                onChange={(event) => setDateEnd(event.target.value)}
                                                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                                            />
                                        </div>
                                    </div>

                                    <p className="text-xs text-slate-500">Click a filter pill repeatedly to cycle include, exclude, and off.</p>
                                </div>
                            </details>
                        </div>
                    </div>

                    <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto bg-slate-50 px-6 py-5">
                        {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error.message}</div> : null}
                        {isLoading ? <div className="text-sm text-slate-500">Loading history...</div> : null}

                        {!isLoading && filteredEvents.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-sm text-slate-500">
                                No history items match these filters.
                            </div>
                        ) : null}

                        <div className="space-y-3">
                            {filteredEvents.map((event) => {
                                const linkedMessage = getLinkedMessage(event);
                                const actorLabel = getHistoryActorLabel(event, familyMemberNamesById);
                                const affectedLabels = getHistoryAffectedMemberIds(event)
                                    .map((memberId) => familyMemberNamesById.get(memberId))
                                    .filter(Boolean);
                                const messageAttachments = linkedMessage?.attachments || [];
                                const eventAttachments = event.attachments || [];
                                const detailsNote = typeof event.metadata?.note === 'string' ? event.metadata.note : null;

                                return (
                                    <div key={event.id} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-semibold text-slate-700">
                                                {HISTORY_DOMAIN_LABELS[(event.domain as keyof typeof HISTORY_DOMAIN_LABELS) || 'system'] || event.domain}
                                            </span>
                                            {event.source === 'apple_sync' ? (
                                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">Apple Sync</span>
                                            ) : null}
                                            <span>{formatOccurredAt(event.occurredAt)}</span>
                                        </div>

                                        <div className="mt-3 text-base font-semibold text-slate-900">{event.summary}</div>

                                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-600">
                                            {actorLabel ? <span>Actor: {actorLabel}</span> : null}
                                            {affectedLabels.length > 0 ? <span>Affected: {affectedLabels.join(', ')}</span> : null}
                                            {linkedMessage?.editedAt ? <span>Edited</span> : null}
                                        </div>

                                        {linkedMessage?.body ? <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{linkedMessage.body}</div> : null}
                                        {!linkedMessage?.body && detailsNote ? <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{detailsNote}</div> : null}

                                        {messageAttachments.length > 0 ? (
                                            <AttachmentCollection attachments={messageAttachments} className="mt-3" variant="panel" />
                                        ) : null}

                                        {eventAttachments.length > 0 ? (
                                            <AttachmentCollection attachments={eventAttachments} className="mt-3" variant="panel" />
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>

                        {filteredEvents.length >= queryLimit ? (
                            <div className="mt-6 flex justify-center">
                                <Button type="button" variant="outline" onClick={() => setQueryLimit((prev) => prev + 200)}>
                                    Load more
                                </Button>
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}
