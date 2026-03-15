'use client';

import React, { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import DetailedChoreForm from '@/components/DetailedChoreForm';
import ChoreDetailDialog from '@/components/ChoreDetailDialog';
import {
    choreMatchesCatalogFilter,
    formatCatalogDateLabel,
    getChoreCatalogState,
    getChoreRecurrenceSummary,
    type ChoreCatalogFilter,
    type ChoreCatalogSort,
} from '@/lib/chore-catalog';

type ChoreRecord = {
    id: string;
    title?: string | null;
    description?: string | null;
    createdAt?: string | null;
    startDate: string;
    rrule?: string | null;
    exdates?: unknown;
    pauseState?: any;
    isUpForGrabs?: boolean | null;
    isJoint?: boolean | null;
    rotationType?: string | null;
    weight?: number | null;
    rewardType?: string | null;
    rewardAmount?: number | null;
    rewardCurrency?: string | null;
    assignees?: Array<{ id: string; name?: string | null }> | null;
    assignments?: any[] | null;
    completions?: any[] | null;
    taskSeries?: Array<{ id: string }> | null;
};

type InventoryEntry = {
    chore: ChoreRecord;
    state: ReturnType<typeof getChoreCatalogState>;
    title: string;
    recurrenceText: string;
    assigneeText: string;
    hasTasks: boolean;
};

interface AllChoresInventoryProps {
    chores: ChoreRecord[];
    familyMembers: Array<{ id: string; name?: string | null }>;
    referenceDate: Date;
    updateChore: (choreId: string, updatedChore: any) => Promise<void> | void;
    updateChoreSchedule: (choreId: string, patch: any) => Promise<void>;
    db: any;
    unitDefinitions: any[];
    currencyOptions: Array<{ value: string; label: string }>;
    canEditChores: boolean;
}

const FILTERS: Array<{ value: ChoreCatalogFilter; label: string }> = [
    { value: 'active', label: 'Active' },
    { value: 'paused', label: 'Paused' },
    { value: 'starts_later', label: 'Starts later' },
    { value: 'ended', label: 'Ended' },
    { value: 'one_time', label: 'One-time' },
    { value: 'all', label: 'All' },
];

const SORT_OPTIONS: Array<{ value: ChoreCatalogSort; label: string }> = [
    { value: 'smart', label: 'Smart' },
    { value: 'alpha_asc', label: 'Alphabetical (A-Z)' },
    { value: 'alpha_desc', label: 'Alphabetical (Z-A)' },
    { value: 'next_active_asc', label: 'Next active date' },
    { value: 'next_active_desc', label: 'Next active date (reverse)' },
    { value: 'start_asc', label: 'First scheduled date' },
    { value: 'start_desc', label: 'First scheduled date (reverse)' },
    { value: 'created_asc', label: 'Created date' },
    { value: 'created_desc', label: 'Created date (reverse)' },
];

function badgeClassForStatus(status: InventoryEntry['state']['statusTone']) {
    if (status === 'active') return 'bg-emerald-100 text-emerald-800';
    if (status === 'paused') return 'bg-amber-100 text-amber-800';
    if (status === 'starts_later') return 'bg-sky-100 text-sky-800';
    return 'bg-slate-200 text-slate-700';
}

function badgeClassForAuxiliary(tone: InventoryEntry['state']['auxiliaryTone']) {
    if (tone === 'emerald') return 'bg-emerald-100 text-emerald-800';
    if (tone === 'amber') return 'bg-amber-100 text-amber-800';
    if (tone === 'sky') return 'bg-sky-100 text-sky-800';
    return 'bg-slate-100 text-slate-700';
}

function compareMaybeDate(left: Date | null, right: Date | null, direction: 'asc' | 'desc') {
    const leftValue = left ? left.getTime() : null;
    const rightValue = right ? right.getTime() : null;

    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;
    return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
}

function compareEntries(left: InventoryEntry, right: InventoryEntry, sort: ChoreCatalogSort, filter: ChoreCatalogFilter) {
    if (sort === 'alpha_asc') return left.title.localeCompare(right.title);
    if (sort === 'alpha_desc') return right.title.localeCompare(left.title);
    if (sort === 'next_active_asc') {
        return compareMaybeDate(left.state.nextActiveDate, right.state.nextActiveDate, 'asc') || left.title.localeCompare(right.title);
    }
    if (sort === 'next_active_desc') {
        return compareMaybeDate(left.state.nextActiveDate, right.state.nextActiveDate, 'desc') || left.title.localeCompare(right.title);
    }
    if (sort === 'start_asc') {
        return compareMaybeDate(new Date(`${left.state.startDateToken}T00:00:00Z`), new Date(`${right.state.startDateToken}T00:00:00Z`), 'asc') || left.title.localeCompare(right.title);
    }
    if (sort === 'start_desc') {
        return compareMaybeDate(new Date(`${left.state.startDateToken}T00:00:00Z`), new Date(`${right.state.startDateToken}T00:00:00Z`), 'desc') || left.title.localeCompare(right.title);
    }
    if (sort === 'created_asc') {
        return compareMaybeDate(left.state.createdAtDate, right.state.createdAtDate, 'asc') || left.title.localeCompare(right.title);
    }
    if (sort === 'created_desc') {
        return compareMaybeDate(left.state.createdAtDate, right.state.createdAtDate, 'desc') || left.title.localeCompare(right.title);
    }

    const statusRank = (entry: InventoryEntry) => {
        if (entry.state.status === 'active') return 0;
        if (entry.state.status === 'paused') return 1;
        if (entry.state.status === 'starts_later') return 2;
        return 3;
    };

    if (filter === 'all') {
        const rankDifference = statusRank(left) - statusRank(right);
        if (rankDifference !== 0) return rankDifference;
    }

    if (left.state.status === 'active' && right.state.status === 'active') {
        if (left.state.occursToday !== right.state.occursToday) {
            return left.state.occursToday ? -1 : 1;
        }
        return compareMaybeDate(left.state.nextActiveDate, right.state.nextActiveDate, 'asc') || left.title.localeCompare(right.title);
    }

    if (left.state.status === 'paused' && right.state.status === 'paused') {
        return compareMaybeDate(left.state.nextActiveDate, right.state.nextActiveDate, 'asc') || left.title.localeCompare(right.title);
    }

    if (left.state.status === 'starts_later' && right.state.status === 'starts_later') {
        return compareMaybeDate(new Date(`${left.state.startDateToken}T00:00:00Z`), new Date(`${right.state.startDateToken}T00:00:00Z`), 'asc') || left.title.localeCompare(right.title);
    }

    if (left.state.status === 'ended' && right.state.status === 'ended') {
        return compareMaybeDate(new Date(`${left.state.startDateToken}T00:00:00Z`), new Date(`${right.state.startDateToken}T00:00:00Z`), 'desc') || left.title.localeCompare(right.title);
    }

    return left.title.localeCompare(right.title);
}

function buildNextRelevantLabel(entry: InventoryEntry) {
    if (entry.state.status === 'paused') {
        return entry.state.statusBadge;
    }
    if (entry.state.status === 'starts_later') {
        return entry.state.statusBadge;
    }
    if (entry.state.status === 'ended') {
        return entry.state.isOneTime ? `Scheduled ${formatCatalogDateLabel(entry.chore.startDate)}` : 'No future occurrence';
    }
    return entry.state.nextActiveDate ? `Next active ${formatCatalogDateLabel(entry.state.nextActiveDate)}` : 'No future occurrence';
}

export default function AllChoresInventory({
    chores,
    familyMembers,
    referenceDate,
    updateChore,
    updateChoreSchedule,
    db,
    unitDefinitions,
    currencyOptions,
    canEditChores,
}: AllChoresInventoryProps) {
    const { toast } = useToast();
    const [filter, setFilter] = useState<ChoreCatalogFilter>('active');
    const [sort, setSort] = useState<ChoreCatalogSort>('smart');
    const [detailChoreId, setDetailChoreId] = useState<string | null>(null);
    const [editingChore, setEditingChore] = useState<ChoreRecord | null>(null);

    const inventory = useMemo(() => {
        return (chores || []).map((chore) => ({
            chore,
            state: getChoreCatalogState(chore, referenceDate),
            title: String(chore.title || 'Untitled chore'),
            recurrenceText: getChoreRecurrenceSummary(chore),
            assigneeText:
                (chore.assignees || []).map((assignee) => assignee.name || 'Unknown member').join(', ') || 'No assignees',
            hasTasks: Boolean(chore.taskSeries && chore.taskSeries.length > 0),
        }));
    }, [chores, referenceDate]);

    const filterCounts = useMemo(() => {
        const counts = new Map<ChoreCatalogFilter, number>(FILTERS.map((item) => [item.value, 0]));
        inventory.forEach((entry) => {
            FILTERS.forEach((item) => {
                if (choreMatchesCatalogFilter(entry.state, item.value)) {
                    counts.set(item.value, (counts.get(item.value) || 0) + 1);
                }
            });
        });
        return counts;
    }, [inventory]);

    const filteredEntries = useMemo(() => {
        const entries = inventory.filter((entry) => choreMatchesCatalogFilter(entry.state, filter));
        return [...entries].sort((left, right) => compareEntries(left, right, sort, filter));
    }, [filter, inventory, sort]);

    const oneTimeSections = useMemo(() => {
        if (filter !== 'one_time') return null;

        return {
            past: filteredEntries.filter((entry) => entry.state.oneTimeTiming === 'past'),
            today: filteredEntries.filter((entry) => entry.state.oneTimeTiming === 'today'),
            future: filteredEntries.filter((entry) => entry.state.oneTimeTiming === 'future'),
        };
    }, [filter, filteredEntries]);

    const detailChore = useMemo(() => {
        if (!detailChoreId) return null;
        return chores.find((chore) => chore.id === detailChoreId) || null;
    }, [chores, detailChoreId]);

    const handleEditChore = (chore: ChoreRecord) => {
        if (!canEditChores) {
            toast({ title: 'Access Denied', description: 'Only parents can edit chores.', variant: 'destructive' });
            return;
        }
        setEditingChore(chore);
    };

    const handleEditFromDetails = () => {
        if (!detailChore) return;
        setDetailChoreId(null);
        handleEditChore(detailChore);
    };

    const handleUpdateChore = async (updatedChore: any) => {
        if (!editingChore?.id) return;
        await updateChore(editingChore.id, updatedChore);
        setEditingChore(null);
    };

    const handleScheduleUpdate = async (patch: any) => {
        if (!editingChore?.id) return;
        await updateChoreSchedule(editingChore.id, patch);
        setEditingChore(null);
    };

    const renderEntry = (entry: InventoryEntry) => (
        <button
            key={entry.chore.id}
            type="button"
            onClick={() => setDetailChoreId(entry.chore.id)}
            className="w-full rounded-2xl border border-slate-200 bg-white/90 p-4 text-left shadow-sm transition hover:border-sky-300 hover:shadow-md"
        >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-base font-semibold text-slate-950">{entry.title}</span>
                        <Badge className={badgeClassForStatus(entry.state.statusTone)}>{entry.state.statusBadge}</Badge>
                        {entry.state.auxiliaryBadge ? <Badge className={badgeClassForAuxiliary(entry.state.auxiliaryTone)}>{entry.state.auxiliaryBadge}</Badge> : null}
                        {entry.chore.isUpForGrabs ? <Badge className="bg-emerald-100 text-emerald-800">Up for grabs</Badge> : null}
                        {entry.chore.isJoint ? <Badge className="bg-amber-100 text-amber-800">Joint</Badge> : null}
                        {entry.chore.rotationType && entry.chore.rotationType !== 'none' ? (
                            <Badge className="bg-sky-100 text-sky-800">Rotates {String(entry.chore.rotationType).toLowerCase()}</Badge>
                        ) : null}
                        {entry.hasTasks ? <Badge className="bg-indigo-100 text-indigo-800">Has tasks</Badge> : null}
                    </div>
                    <div className="grid gap-1 text-sm text-slate-600 sm:grid-cols-2">
                        <div>{entry.recurrenceText}</div>
                        <div>{buildNextRelevantLabel(entry)}</div>
                        <div>{entry.assigneeText}</div>
                        <div>First scheduled {formatCatalogDateLabel(entry.chore.startDate)}</div>
                    </div>
                </div>
                <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Open details</div>
            </div>
        </button>
    );

    return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white/85 p-4 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div className="space-y-2">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Filters</div>
                        <div className="flex flex-wrap gap-2">
                            {FILTERS.map((item) => (
                                <button
                                    key={item.value}
                                    type="button"
                                    onClick={() => setFilter(item.value)}
                                    className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                                        filter === item.value
                                            ? 'border-sky-500 bg-sky-100 text-sky-800'
                                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                                    }`}
                                >
                                    {item.label} ({filterCounts.get(item.value) || 0})
                                </button>
                            ))}
                        </div>
                    </div>

                    <label className="flex items-center gap-3 text-sm text-slate-600">
                        <span className="font-medium text-slate-700">Sort</span>
                        <select
                            value={sort}
                            onChange={(event) => setSort(event.target.value as ChoreCatalogSort)}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                        >
                            {SORT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </div>

            {filter === 'one_time' && oneTimeSections ? (
                <div className="space-y-6">
                    {(['past', 'today', 'future'] as const).map((section) => {
                        const entries = oneTimeSections[section];
                        if (!entries || entries.length === 0) return null;
                        return (
                            <section key={section} className="space-y-3">
                                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{section}</h3>
                                <div className="space-y-3">{entries.map(renderEntry)}</div>
                            </section>
                        );
                    })}
                </div>
            ) : (
                <div className="space-y-3">
                    {filteredEntries.length > 0 ? (
                        filteredEntries.map(renderEntry)
                    ) : (
                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/80 p-8 text-center text-sm text-slate-500">
                            No chores match this filter right now.
                        </div>
                    )}
                </div>
            )}

            <ChoreDetailDialog
                chore={detailChore}
                familyMembers={familyMembers}
                open={detailChore !== null}
                onOpenChange={(open) => {
                    if (!open) setDetailChoreId(null);
                }}
                onEdit={handleEditFromDetails}
                selectedDate={referenceDate}
                selectedMember="All"
            />

            <Dialog open={editingChore !== null} onOpenChange={() => setEditingChore(null)}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>Edit Chore</DialogTitle>
                    </DialogHeader>
                    {editingChore ? (
                        <DetailedChoreForm
                            familyMembers={familyMembers}
                            onSave={handleUpdateChore}
                            onScheduleAction={handleScheduleUpdate}
                            initialChore={editingChore}
                            initialDate={referenceDate}
                            db={db}
                            unitDefinitions={unitDefinitions}
                            currencyOptions={currencyOptions}
                        />
                    ) : null}
                </DialogContent>
            </Dialog>
        </div>
    );
}
