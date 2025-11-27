'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { RRule } from 'rrule';
import { id, tx } from '@instantdb/react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress'; // if you don’t have this, we can inline a div-based bar
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';

type Status = 'draft' | 'pending' | 'in_progress' | 'archived';

interface TaskSeriesManagerProps {
    db: any;
}

const TaskSeriesManager: React.FC<TaskSeriesManagerProps> = ({ db }) => {
    const router = useRouter();
    const { toast } = useToast();
    const [statusFilter, setStatusFilter] = useState<Status | 'all'>('all');

    const { data, isLoading } = db.useQuery({
        taskSeries: {
            $: { order: { updatedAt: 'desc' } },
            tasks: {},
            familyMember: {},
            scheduledActivity: {},
        },
    });

    const seriesList = data?.taskSeries || [];
    const today = useMemo(() => new Date(), []);

    const enrichedSeries = useMemo(() => {
        type BaseInfo = {
            series: any;
            totalTasks: number;
            completedTasks: number;
            hasAssignee: boolean;
            hasScheduledActivity: boolean;
            effectiveStartDate: Date | null;
            lastScheduledDate: Date | null;
            dependsOnSeriesId?: string | null;
        };

        const baseMap = new Map<string, BaseInfo>();

        // --- First pass: compute progress & scheduling info ---
        for (const s of seriesList) {
            const tasks = s.tasks || [];
            const nonDayBreakTasks = tasks.filter((t: any) => !t.isDayBreak);
            const totalTasks = nonDayBreakTasks.length;
            const completedTasks = nonDayBreakTasks.filter((t: any) => t.isCompleted).length;

            const hasAssignee = !!s.familyMember;
            const hasScheduledActivity = !!s.scheduledActivity;

            const seriesStartDate = s.startDate ? new Date(s.startDate) : null;
            const choreStartDate = s.scheduledActivity?.startDate ? new Date(s.scheduledActivity.startDate) : null;

            // Effective start = explicit series start, else chore start, else null
            const effectiveStartDate = seriesStartDate ?? choreStartDate ?? null;

            // Last scheduled day:
            // Prefer chore.rrule if we can interpret it (with UNTIL or small COUNT),
            // else fall back to series.targetEndDate, else null (open-ended).
            let lastScheduledDate: Date | null = null;

            if (s.scheduledActivity?.rrule) {
                try {
                    const rule = RRule.fromString(s.scheduledActivity.rrule);

                    if (rule.options.until) {
                        lastScheduledDate = rule.options.until;
                    } else if (typeof rule.options.count === 'number' && rule.options.count > 0 && rule.options.count <= 365) {
                        const all = rule.all();
                        if (all.length > 0) {
                            lastScheduledDate = all[all.length - 1];
                        }
                    }
                } catch (e) {
                    console.warn('Failed to parse rrule for chore', s.scheduledActivity?.id, e);
                }
            }

            if (!lastScheduledDate && s.targetEndDate) {
                lastScheduledDate = new Date(s.targetEndDate);
            }

            baseMap.set(s.id, {
                series: s,
                totalTasks,
                completedTasks,
                hasAssignee,
                hasScheduledActivity,
                effectiveStartDate,
                lastScheduledDate,
                dependsOnSeriesId: s.dependsOnSeriesId ?? null,
            });
        }

        // --- Second pass: compute status with dependency awareness ---
        const statusCache = new Map<string, Status>();

        const computeStatus = (seriesId: string): Status => {
            if (statusCache.has(seriesId)) {
                return statusCache.get(seriesId)!;
            }

            const info = baseMap.get(seriesId);
            if (!info) {
                statusCache.set(seriesId, 'draft');
                return 'draft';
            }

            const { hasAssignee, hasScheduledActivity, totalTasks, completedTasks, effectiveStartDate, lastScheduledDate, dependsOnSeriesId } = info;

            const allCompleted = totalTasks > 0 && completedTasks === totalTasks;

            let status: Status = 'draft';

            if (!hasAssignee || !hasScheduledActivity) {
                status = 'draft';
            } else {
                // Dependency
                let dependencyBlocking = false;
                if (dependsOnSeriesId) {
                    const depStatus = computeStatus(dependsOnSeriesId);
                    dependencyBlocking = depStatus !== 'archived';
                }

                if (allCompleted) {
                    // Archived when everything is done AND either:
                    // - we know lastScheduledDate and it's in the past, OR
                    // - we *don't* know lastScheduledDate (treat as done now).
                    if (!lastScheduledDate || lastScheduledDate < today) {
                        status = 'archived';
                    } else {
                        status = 'in_progress';
                    }
                } else if (dependencyBlocking) {
                    status = 'pending';
                } else if (effectiveStartDate && effectiveStartDate > today) {
                    status = 'pending';
                } else {
                    status = 'in_progress';
                }
            }

            statusCache.set(seriesId, status);
            return status;
        };

        return seriesList.map((s: any) => {
            const info = baseMap.get(s.id)!;
            const status = computeStatus(s.id);

            const { totalTasks, completedTasks } = info;
            const progress = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;

            return {
                raw: s,
                status,
                totalTasks,
                completedTasks,
                progress,
            };
        });
    }, [seriesList, today]);

    const filteredSeries = statusFilter === 'all' ? enrichedSeries : enrichedSeries.filter((s) => s.status === statusFilter);

    const handleOpenSeries = (id: string) => {
        router.push(`/task-series/${id}`);
    };

    const handleNewSeries = () => {
        router.push('/task-series/new');
    };

    const renderStatusBadge = (status: Status) => {
        switch (status) {
            case 'draft':
                return <Badge variant="outline">Draft</Badge>;
            case 'pending':
                return <Badge className="bg-amber-100 text-amber-800">Pending</Badge>;
            case 'in_progress':
                return <Badge className="bg-blue-100 text-blue-800">In Progress</Badge>;
            case 'archived':
                return <Badge className="bg-emerald-100 text-emerald-800">Archived</Badge>;
        }
    };

    const handleDuplicate = async (seriesWithMeta: (typeof enrichedSeries)[number], e: React.MouseEvent) => {
        e.stopPropagation(); // don't trigger open-on-card-click

        const s = seriesWithMeta.raw;

        try {
            const newSeriesId = id();
            const now = new Date();

            const transactions: any[] = [];

            // Create the new series (copying metadata except assignee/scheduledActivity/dependency)
            transactions.push(
                tx.taskSeries[newSeriesId].update({
                    name: s.name ? `${s.name} (copy)` : 'Untitled series (copy)',
                    description: s.description || '',
                    startDate: s.startDate ? new Date(s.startDate) : undefined,
                    targetEndDate: s.targetEndDate ? new Date(s.targetEndDate) : undefined,
                    workAheadAllowed: s.workAheadAllowed ?? undefined,
                    breakType: s.breakType ?? undefined,
                    breakStartDate: s.breakStartDate ? new Date(s.breakStartDate) : undefined,
                    breakDelayValue: s.breakDelayValue ?? undefined,
                    breakDelayUnit: s.breakDelayUnit ?? undefined,
                    dependsOnSeriesId: null,
                    createdAt: now,
                    updatedAt: now,
                })
            );

            // Duplicate tasks (reset completion, keep structure)
            const originalTasks = (s.tasks || []).slice().sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

            for (const t of originalTasks) {
                const newTaskId = id();

                const taskData: any = {
                    text: t.text,
                    order: t.order,
                    isDayBreak: t.isDayBreak,
                    overrideWorkAhead: t.overrideWorkAhead ?? undefined,
                    notes: t.notes ?? undefined,
                    specificTime: t.specificTime ?? undefined,
                    // Reset completion
                    isCompleted: false,
                    completedAt: null,
                    createdAt: now,
                    updatedAt: now,
                };

                // Preserve indentation if your schema includes it
                if (typeof t.indentationLevel === 'number') {
                    taskData.indentationLevel = t.indentationLevel;
                }

                transactions.push(tx.tasks[newTaskId].update(taskData));
                transactions.push(tx.taskSeries[newSeriesId].link({ tasks: newTaskId }));
            }

            await db.transact(transactions);
            toast({ title: 'Task series duplicated' });

            router.push(`/task-series/${newSeriesId}`);
        } catch (err) {
            console.error('Duplicate failed', err);
            toast({
                title: 'Could not duplicate series',
                variant: 'destructive',
            });
        }
    };

    return (
        <div className="max-w-6xl mx-auto p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Task Series</h1>
                <Button onClick={handleNewSeries}>New Task Series</Button>
            </div>

            {/* Status Filters */}
            <div className="flex flex-wrap gap-2">
                {(['all', 'draft', 'pending', 'in_progress', 'archived'] as const).map((s) => (
                    <button
                        key={s}
                        onClick={() => setStatusFilter(s)}
                        className={cn(
                            'px-3 py-1 rounded-full text-xs font-medium border',
                            statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-foreground border-border'
                        )}
                    >
                        {s === 'all' ? 'All' : s === 'in_progress' ? 'In Progress' : s.charAt(0).toUpperCase() + s.slice(1)}
                    </button>
                ))}
            </div>

            {/* List */}
            {isLoading ? (
                <div className="text-sm text-muted-foreground">Loading task series...</div>
            ) : filteredSeries.length === 0 ? (
                <div className="text-sm text-muted-foreground">No task series yet. Click &ldquo;New Task Series&rdquo; to create one.</div>
            ) : (
                <div className="space-y-3">
                    {filteredSeries.map((item) => {
                        const { raw: s, status, totalTasks, completedTasks, progress } = item;

                        return (
                            <div
                                key={s.id}
                                className="border rounded-lg bg-card p-4 hover:bg-accent/30 cursor-pointer transition-colors flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                                onClick={() => handleOpenSeries(s.id)}
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-base font-semibold">{s.name || 'Untitled series'}</h2>
                                        {renderStatusBadge(status)}
                                    </div>
                                    {s.description && <p className="text-sm text-muted-foreground line-clamp-2">{s.description}</p>}
                                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground mt-1">
                                        {s.familyMember && <span>Assignee: {s.familyMember.name}</span>}
                                        {s.scheduledActivity && <span>Activity: {s.scheduledActivity.title}</span>}
                                        {s.updatedAt && <span>Updated: {format(new Date(s.updatedAt), 'MMM d, yyyy')}</span>}
                                    </div>
                                </div>

                                <div className="w-full md:w-72 flex flex-col items-stretch gap-2">
                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <span>Progress</span>
                                        {totalTasks > 0 ? (
                                            <span>
                                                {completedTasks}/{totalTasks} tasks
                                            </span>
                                        ) : (
                                            <span>No tasks yet</span>
                                        )}
                                    </div>
                                    <Progress value={progress} />

                                    <div className="flex justify-end">
                                        <Button size="sm" variant="outline" onClick={(e) => handleDuplicate(item, e)}>
                                            Duplicate
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default TaskSeriesManager;
