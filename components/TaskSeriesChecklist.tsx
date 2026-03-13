import React, { useEffect, useMemo, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Task } from '@/lib/task-scheduler';
import { File as FileIcon, Loader2, Maximize2, Minimize2, RotateCcw, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { PDFPreview } from './PDFPreview';
import {
    getBucketedTasks,
    getLatestTaskProgressEntry,
    getTaskActorName,
    getTaskLastActiveState,
    getTaskProgressPlaceholder,
    getTaskStatusLabel,
    getTaskWorkflowState,
    isActionableTask,
    isTaskDone,
    sortTaskProgressEntries,
    type TaskBucketState,
    type TaskRestoreTiming,
    type TaskWorkflowState,
} from '@/lib/task-progress';

export interface TaskChecklistUpdateInput {
    nextState: TaskWorkflowState;
    note?: string;
    files?: File[];
    restoreTiming?: TaskRestoreTiming | null;
}

interface Props {
    tasks: Task[];
    allTasks: Task[];
    onToggle: (taskId: string, currentStatus: boolean) => void;
    onTaskUpdate?: (taskId: string, input: TaskChecklistUpdateInput) => Promise<void> | void;
    familyMemberNamesById?: Record<string, string>;
    isReadOnly?: boolean;
    selectedMember: string | null | 'All';
    showDetails: boolean;
    isParentReviewer?: boolean;
}

const getParentId = (task: Task): string | undefined => {
    if (!task.parentTask) return undefined;
    if (Array.isArray(task.parentTask)) {
        return task.parentTask[0]?.id;
    }
    return (task.parentTask as any).id;
};

const hasScheduledChildren = (parentId: string, scheduledIds: Set<string>, allTasks: Task[]) => {
    return allTasks.some((t) => {
        const pId = getParentId(t);
        return pId === parentId && scheduledIds.has(t.id);
    });
};

const bucketOrder: TaskBucketState[] = ['blocked', 'needs_review', 'skipped', 'done'];

const statusToneClassName: Record<TaskWorkflowState, string> = {
    not_started: 'bg-slate-100 text-slate-700 border-slate-200',
    in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
    blocked: 'bg-rose-100 text-rose-700 border-rose-200',
    skipped: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    needs_review: 'bg-violet-100 text-violet-700 border-violet-200',
    done: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const FileThumbnail = ({ file, onClick }: { file: any; onClick: () => void }) => {
    const isImage = /\.(jpg|jpeg|png|webp|gif)$/i.test(file.url);
    const isPdf = /\.pdf$/i.test(file.url);
    const isText = /\.(txt|md|csv|log)$/i.test(file.url);
    const [previewText, setPreviewText] = useState<string | null>(null);

    useEffect(() => {
        if (isText && !previewText) {
            fetch(`/files/${file.url}`)
                .then((res) => res.text())
                .then((text) => setPreviewText(text.slice(0, 150)))
                .catch((err) => console.error('Failed to load text preview', err));
        }
    }, [isText, file.url, previewText]);

    return (
        <div
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className="group relative h-12 w-12 cursor-pointer overflow-hidden rounded border bg-white transition-all hover:ring-2 hover:ring-blue-400"
            title={file.name}
        >
            {isImage ? (
                <img src={`/files/${file.url}`} alt={file.name} className="h-full w-full object-cover" />
            ) : isPdf ? (
                <div className="flex h-full w-full items-center justify-center bg-red-50 text-red-500">
                    <span className="text-[8px] font-bold">PDF</span>
                </div>
            ) : isText ? (
                <div className="h-full w-full overflow-hidden bg-gray-50 p-1">
                    <div className="break-all font-mono text-[5px] leading-[6px] text-gray-500 opacity-70">{previewText || 'Loading...'}</div>
                </div>
            ) : (
                <div className="flex h-full w-full items-center justify-center bg-gray-100">
                    <FileIcon className="h-5 w-5 text-gray-400" />
                </div>
            )}
        </div>
    );
};

export const TaskSeriesChecklist: React.FC<Props> = ({
    tasks: scheduledTasks,
    allTasks,
    onToggle,
    onTaskUpdate,
    familyMemberNamesById,
    isReadOnly,
    showDetails,
    isParentReviewer = false,
}) => {
    const [localExpandedIds, setLocalExpandedIds] = useState<Set<string>>(new Set());
    const [previewFile, setPreviewFile] = useState<any | null>(null);
    const [fullTextContent, setFullTextContent] = useState<string | null>(null);
    const [loadingText, setLoadingText] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [expandedBuckets, setExpandedBuckets] = useState<Record<TaskBucketState, boolean>>({
        blocked: true,
        skipped: false,
        needs_review: true,
        done: false,
    });
    const [composerTaskId, setComposerTaskId] = useState<string | null>(null);
    const [composerState, setComposerState] = useState<TaskWorkflowState>('not_started');
    const [composerNote, setComposerNote] = useState('');
    const [composerFiles, setComposerFiles] = useState<File[]>([]);
    const [isSubmittingComposer, setIsSubmittingComposer] = useState(false);
    const [pendingRestore, setPendingRestore] = useState<{ taskId: string; nextState: TaskWorkflowState } | null>(null);

    const toggleLocalExpand = (taskId: string) => {
        setLocalExpandedIds((prev) => {
            const next = new Set(prev);
            if (next.has(taskId)) {
                next.delete(taskId);
            } else {
                next.add(taskId);
            }
            return next;
        });
    };

    const openPreview = async (file: any) => {
        setPreviewFile(file);
        setFullTextContent(null);
        setIsExpanded(false);

        if (/\.(txt|md|csv|log)$/i.test(file.url)) {
            setLoadingText(true);
            try {
                const res = await fetch(`/files/${file.url}`);
                const text = await res.text();
                setFullTextContent(text);
            } catch (err) {
                console.error('Failed to load full text', err);
                setFullTextContent('Error loading file content.');
            } finally {
                setLoadingText(false);
            }
        }
    };

    const activeScheduledTasks = useMemo(() => scheduledTasks.filter((task) => !isTaskDone(task)), [scheduledTasks]);

    const visibleNodes: Task[] = useMemo(() => {
        if (!activeScheduledTasks || activeScheduledTasks.length === 0) return [];

        const scheduledIds = new Set(activeScheduledTasks.map((t) => t.id));
        const visibleNodesMap = new Map<string, Task>();

        activeScheduledTasks.forEach((t) => visibleNodesMap.set(t.id, t));

        activeScheduledTasks.forEach((task) => {
            let current = task;
            let depth = 0;
            let parentId = getParentId(current);

            while (parentId && depth < 10) {
                if (visibleNodesMap.has(parentId)) break;

                const parent = allTasks.find((t) => t.id === parentId);
                if (parent) {
                    visibleNodesMap.set(parent.id, parent);
                    current = parent;
                    parentId = getParentId(current);
                } else {
                    break;
                }
                depth++;
            }
        });

        return Array.from(visibleNodesMap.values()).sort((a, b) => (a.order || 0) - (b.order || 0));
    }, [activeScheduledTasks, allTasks]);

    const bucketedTasks = useMemo(() => {
        const sorted = (state: TaskBucketState) =>
            getBucketedTasks(allTasks, state).sort((left, right) => {
                const leftEntry = getLatestTaskProgressEntry(left);
                const rightEntry = getLatestTaskProgressEntry(right);
                const leftTime = leftEntry?.createdAt ? new Date(leftEntry.createdAt).getTime() : 0;
                const rightTime = rightEntry?.createdAt ? new Date(rightEntry.createdAt).getTime() : 0;
                if (rightTime !== leftTime) return rightTime - leftTime;
                return (left.order || 0) - (right.order || 0);
            });

        return {
            blocked: sorted('blocked'),
            skipped: sorted('skipped'),
            needs_review: sorted('needs_review'),
            done: sorted('done'),
        };
    }, [allTasks]);

    const actionableCount = useMemo(() => allTasks.filter((task) => isActionableTask(task, allTasks)).length, [allTasks]);
    const hasAnyBucketedTasks = bucketOrder.some((state) => bucketedTasks[state].length > 0);
    const hasAnyVisibleContent = visibleNodes.length > 0 || hasAnyBucketedTasks;
    const composerTask = composerTaskId ? allTasks.find((task) => task.id === composerTaskId) || null : null;

    if (!hasAnyVisibleContent || actionableCount === 0) return null;

    const scheduledIds = new Set(activeScheduledTasks.map((t) => t.id));

    const toggleBucketSection = (state: TaskBucketState) => {
        setExpandedBuckets((prev) => ({
            ...prev,
            [state]: !prev[state],
        }));
    };

    const openComposer = (task: Task) => {
        setComposerTaskId(task.id);
        setComposerState(getTaskWorkflowState(task));
        setComposerNote('');
        setComposerFiles([]);
    };

    const closeComposer = () => {
        if (isSubmittingComposer) return;
        setComposerTaskId(null);
        setComposerNote('');
        setComposerFiles([]);
    };

    const handleComposerFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
        const nextFiles = Array.from(event.target.files || []);
        setComposerFiles((prev) => [...prev, ...nextFiles]);
        event.target.value = '';
    };

    const handleRemovePendingFile = (index: number) => {
        setComposerFiles((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    };

    const getComposerOptions = (task: Task): TaskWorkflowState[] => {
        const currentState = getTaskWorkflowState(task);
        if (currentState === 'not_started') {
            return ['not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done'];
        }
        if (currentState === 'in_progress') {
            return ['in_progress', 'not_started', 'blocked', 'skipped', 'needs_review', 'done'];
        }
        return [currentState];
    };

    const submitComposer = async () => {
        if (!composerTask || !onTaskUpdate) return;
        const currentState = getTaskWorkflowState(composerTask);
        const trimmedNote = composerNote.trim();
        const hasPayload = composerState !== currentState || trimmedNote.length > 0 || composerFiles.length > 0;
        if (!hasPayload) return;

        setIsSubmittingComposer(true);
        try {
            await onTaskUpdate(composerTask.id, {
                nextState: composerState,
                note: trimmedNote,
                files: composerFiles,
                restoreTiming: null,
            });
            setComposerTaskId(null);
            setComposerNote('');
            setComposerFiles([]);
        } finally {
            setIsSubmittingComposer(false);
        }
    };

    const handleRestore = async (timing: TaskRestoreTiming) => {
        if (!pendingRestore || !onTaskUpdate) return;
        setIsSubmittingComposer(true);
        try {
            await onTaskUpdate(pendingRestore.taskId, {
                nextState: pendingRestore.nextState,
                restoreTiming: timing,
            });
            setPendingRestore(null);
        } finally {
            setIsSubmittingComposer(false);
        }
    };

    const renderReferenceDetails = (task: Task) => {
        const hasNotes = !!task.notes?.trim();
        const attachments = (task as any).attachments || [];
        const hasAttachments = attachments.length > 0;
        const hasMetadata = hasNotes || hasAttachments;
        const isDetailsVisible = showDetails || localExpandedIds.has(task.id);

        if (!hasMetadata) return null;

        return (
            <>
                {!showDetails && (
                    <button
                        type="button"
                        onClick={(event) => {
                            event.stopPropagation();
                            toggleLocalExpand(task.id);
                        }}
                        className="mt-1 w-fit text-[10px] font-medium text-blue-600 hover:underline"
                    >
                        {localExpandedIds.has(task.id) ? 'hide task details' : 'view task details'}
                    </button>
                )}
                {isDetailsVisible ? (
                    <div className="mt-2 rounded-md border border-blue-100 bg-blue-50/50 p-2 text-sm">
                        {hasNotes ? <div className="mb-2 whitespace-pre-wrap text-xs text-gray-700">{task.notes}</div> : null}
                        {hasAttachments ? (
                            <div className="flex flex-wrap gap-2">
                                {attachments.map((file: any) => (
                                    <FileThumbnail key={file.id} file={file} onClick={() => openPreview(file)} />
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </>
        );
    };

    const renderProgressMeta = (task: Task) => {
        const latestEntry = getLatestTaskProgressEntry(task);
        if (!latestEntry) return null;

        const actorName = getTaskActorName(latestEntry, familyMemberNamesById);
        const createdAt = latestEntry.createdAt ? new Date(latestEntry.createdAt).toLocaleString() : null;
        const attachmentCount = latestEntry.attachments?.length || 0;

        return (
            <div className="mt-2 rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-600">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn('rounded-full border px-2 py-0.5 font-semibold', statusToneClassName[getTaskWorkflowState(task)])}>
                        {getTaskStatusLabel(getTaskWorkflowState(task))}
                    </span>
                    {actorName ? <span>by {actorName}</span> : null}
                    {createdAt ? <span>{createdAt}</span> : null}
                    {attachmentCount > 0 ? <span>{attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}</span> : null}
                </div>
                {latestEntry.note ? <div className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{latestEntry.note}</div> : null}
            </div>
        );
    };

    const renderActiveTaskRow = (task: Task) => {
        const isHeader = hasScheduledChildren(task.id, scheduledIds, allTasks) || !scheduledIds.has(task.id);
        const currentState = getTaskWorkflowState(task);
        const canMutate = !isReadOnly;
        const parentId = getParentId(task);
        let subtitle = null;
        let breadcrumbs = '';

        if (parentId) {
            const parent = allTasks.find((t) => t.id === parentId);
            if (parent) {
                breadcrumbs = parent.text;
                const siblings = allTasks.filter((t) => getParentId(t) === parentId && !t.isDayBreak).sort((a, b) => (a.order || 0) - (b.order || 0));
                const index = siblings.findIndex((t) => t.id === task.id) + 1;
                const total = siblings.length;
                if (index > 0) {
                    subtitle = `Task ${index} of ${total}`;
                }
            }
        }

        if (isHeader) {
            return (
                <div
                    key={task.id}
                    className="relative my-1 mt-4 flex items-start pr-2"
                    style={{ marginLeft: `${(task.indentationLevel || 0) * 1.5}rem` }}
                >
                    <div className="flex min-w-0 flex-grow flex-col">
                        <span className="px-1 text-xs font-bold uppercase tracking-wider text-muted-foreground/80">{task.text}</span>
                        {renderReferenceDetails(task)}
                    </div>
                </div>
            );
        }

        return (
            <div
                key={task.id}
                className="group relative my-1 flex items-start pr-2"
                style={{ marginLeft: `${(task.indentationLevel || 0) * 1.5}rem` }}
            >
                <div className="flex min-w-0 flex-grow flex-col rounded-lg border border-slate-200 bg-white/80 p-3">
                    <div className="flex items-start gap-3">
                        <Checkbox
                            id={`task-${task.id}`}
                            checked={false}
                            disabled={!canMutate}
                            onCheckedChange={() => onToggle(task.id, isTaskDone(task))}
                            className="mt-0.5 h-4 w-4 border-muted-foreground/50 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm leading-tight text-foreground">{task.text}</span>
                                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', statusToneClassName[currentState])}>
                                    {getTaskStatusLabel(currentState)}
                                </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                {subtitle ? <span>{subtitle}</span> : null}
                                {breadcrumbs ? <span>{subtitle ? `in ${breadcrumbs}` : breadcrumbs}</span> : null}
                            </div>
                            {renderReferenceDetails(task)}
                            {renderProgressMeta(task)}
                        </div>
                    </div>

                    {canMutate ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {currentState === 'not_started' ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => onTaskUpdate?.(task.id, { nextState: 'in_progress' })}
                                >
                                    Start
                                </Button>
                            ) : null}
                            <Button type="button" variant="outline" size="sm" onClick={() => openComposer(task)} disabled={!onTaskUpdate}>
                                Update
                            </Button>
                            <Button type="button" size="sm" onClick={() => onToggle(task.id, false)}>
                                Done
                            </Button>
                        </div>
                    ) : null}
                </div>
            </div>
        );
    };

    const renderBucketTaskRow = (task: Task, state: TaskBucketState) => {
        const latestEntry = getLatestTaskProgressEntry(task);
        const actorName = getTaskActorName(latestEntry, familyMemberNamesById);
        const createdAt = latestEntry?.createdAt ? new Date(latestEntry.createdAt).toLocaleString() : null;

        return (
            <div key={`${state}-${task.id}`} className="rounded-lg border border-slate-200 bg-white/80 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-slate-900">{task.text}</span>
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', statusToneClassName[state])}>
                                {getTaskStatusLabel(state)}
                            </span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-500">
                            {actorName ? <span>Latest by {actorName}</span> : null}
                            {createdAt ? <span>{createdAt}</span> : null}
                        </div>
                        {latestEntry?.note ? <div className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{latestEntry.note}</div> : null}
                        {latestEntry?.attachments?.length ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {latestEntry.attachments.map((file: any) => (
                                    <FileThumbnail key={file.id} file={file} onClick={() => openPreview(file)} />
                                ))}
                            </div>
                        ) : null}
                    </div>
                    {!isReadOnly ? (
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => openComposer(task)} disabled={!onTaskUpdate}>
                                Update
                            </Button>
                            {state === 'done' ? (
                                <Button type="button" size="sm" variant="outline" onClick={() => onToggle(task.id, true)}>
                                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                                    Undo
                                </Button>
                            ) : null}
                            {state !== 'done' ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setPendingRestore({ taskId: task.id, nextState: getTaskLastActiveState(task) })}
                                    disabled={!onTaskUpdate}
                                >
                                    Restore
                                </Button>
                            ) : null}
                            {state === 'needs_review' && isParentReviewer ? (
                                <Button type="button" size="sm" onClick={() => onToggle(task.id, false)}>
                                    Approve as Done
                                </Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            </div>
        );
    };

    const previewIsPdf = previewFile && /\.pdf$/i.test(previewFile.url);

    return (
        <div className="relative mb-2 mt-3 space-y-3">
            {visibleNodes.length > 0 ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <h4 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">Active Work</h4>
                        <span className="text-[11px] text-slate-500">
                            {activeScheduledTasks.length} active item{activeScheduledTasks.length === 1 ? '' : 's'}
                        </span>
                    </div>
                    {visibleNodes.map((task) => renderActiveTaskRow(task))}
                </div>
            ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    No active tasks are due right now. Check the bins below for blocked, skipped, review, or finished items.
                </div>
            )}

            {bucketOrder.map((state) => {
                const tasksForBucket = bucketedTasks[state];
                if (tasksForBucket.length === 0) return null;

                return (
                    <div key={state} className="rounded-xl border border-slate-200 bg-slate-50/80">
                        <button
                            type="button"
                            onClick={() => toggleBucketSection(state)}
                            className="flex w-full items-center justify-between px-4 py-3 text-left"
                        >
                            <div>
                                <div className="text-sm font-semibold text-slate-900">{getTaskStatusLabel(state)}</div>
                                <div className="text-xs text-slate-500">{tasksForBucket.length} task{tasksForBucket.length === 1 ? '' : 's'}</div>
                            </div>
                            <span className="text-xs font-medium text-slate-500">{expandedBuckets[state] ? 'Hide' : 'Show'}</span>
                        </button>
                        {expandedBuckets[state] ? (
                            <div className="space-y-3 border-t border-slate-200 px-4 py-3">{tasksForBucket.map((task) => renderBucketTaskRow(task, state))}</div>
                        ) : null}
                    </div>
                );
            })}

            <Dialog open={!!composerTask} onOpenChange={(open) => !open && closeComposer()}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Task Progress Update</DialogTitle>
                    </DialogHeader>

                    {composerTask ? (
                        <div className="space-y-4">
                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                                <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Task</div>
                                <div className="mt-1 text-base font-semibold text-slate-900">{composerTask.text}</div>
                                {composerTask.notes ? <div className="mt-2 whitespace-pre-wrap text-sm text-slate-600">{composerTask.notes}</div> : null}
                            </div>

                            <div className="grid gap-4 md:grid-cols-[200px_minmax(0,1fr)]">
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">State</label>
                                    <select
                                        value={composerState}
                                        onChange={(event) => setComposerState(event.target.value as TaskWorkflowState)}
                                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    >
                                        {getComposerOptions(composerTask).map((state) => (
                                            <option key={state} value={state}>
                                                {getTaskStatusLabel(state)}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium text-slate-700">Notes</label>
                                    <textarea
                                        value={composerNote}
                                        onChange={(event) => setComposerNote(event.target.value)}
                                        placeholder={getTaskProgressPlaceholder(composerState)}
                                        rows={5}
                                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-sm font-medium text-slate-700">Evidence</label>
                                    <label className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100">
                                        <Upload className="h-3.5 w-3.5" />
                                        Add files
                                        <input type="file" multiple className="hidden" onChange={handleComposerFileSelection} />
                                    </label>
                                </div>
                                {composerFiles.length > 0 ? (
                                    <div className="space-y-2 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
                                        {composerFiles.map((file, index) => (
                                            <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                                                <span className="truncate">{file.name}</span>
                                                <button type="button" onClick={() => handleRemovePendingFile(index)} className="text-xs font-medium text-rose-600">
                                                    Remove
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                                        Add photos, documents, voice notes, or video for this update.
                                    </div>
                                )}
                            </div>

                            <div className="space-y-2">
                                <div className="text-sm font-medium text-slate-700">History</div>
                                <div className="max-h-64 space-y-3 overflow-y-auto pr-1">
                                    {sortTaskProgressEntries(composerTask.progressEntries).length === 0 ? (
                                        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                                            No progress updates yet.
                                        </div>
                                    ) : (
                                        sortTaskProgressEntries(composerTask.progressEntries).map((entry) => {
                                            const fromState = entry.fromState ? getTaskStatusLabel(entry.fromState as TaskWorkflowState) : null;
                                            const toState = entry.toState ? getTaskStatusLabel(entry.toState as TaskWorkflowState) : null;
                                            const actorName = getTaskActorName(entry, familyMemberNamesById);
                                            const createdAt = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : null;

                                            return (
                                                <div key={entry.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                                                        {toState ? (
                                                            <span className="font-semibold text-slate-700">
                                                                {fromState && fromState !== toState ? `${fromState} -> ${toState}` : toState}
                                                            </span>
                                                        ) : null}
                                                        {actorName ? <span>by {actorName}</span> : null}
                                                        {createdAt ? <span>{createdAt}</span> : null}
                                                    </div>
                                                    {entry.note ? <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{entry.note}</div> : null}
                                                    {entry.attachments?.length ? (
                                                        <div className="mt-2 flex flex-wrap gap-2">
                                                            {entry.attachments.map((file: any) => (
                                                                <FileThumbnail key={file.id} file={file} onClick={() => openPreview(file)} />
                                                            ))}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>

                            <div className="flex justify-end gap-2">
                                <Button type="button" variant="outline" onClick={closeComposer} disabled={isSubmittingComposer}>
                                    Cancel
                                </Button>
                                <Button type="button" onClick={submitComposer} disabled={isSubmittingComposer || !onTaskUpdate}>
                                    {isSubmittingComposer ? 'Saving...' : 'Save update'}
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </DialogContent>
            </Dialog>

            <Dialog open={!!pendingRestore} onOpenChange={(open) => !open && setPendingRestore(null)}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Restore Task</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <p className="text-sm text-slate-600">Choose whether this task should come back right away or wait for the next scheduled chore day.</p>
                        <div className="flex flex-col gap-2">
                            <Button type="button" onClick={() => handleRestore('now')} disabled={!onTaskUpdate || isSubmittingComposer}>
                                Return to active work now
                            </Button>
                            <Button type="button" variant="outline" onClick={() => handleRestore('next_scheduled')} disabled={!onTaskUpdate || isSubmittingComposer}>
                                Return on the next scheduled day
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
                <DialogContent
                    className={cn(
                        'flex flex-col overflow-hidden p-0 transition-all duration-300',
                        isExpanded
                            ? 'h-screen max-h-none w-screen max-w-none rounded-none border-0'
                            : cn('w-[90vw] max-w-4xl', previewIsPdf ? 'h-[85vh]' : 'max-h-[85vh]')
                    )}
                >
                    <DialogHeader className="z-10 flex shrink-0 flex-row items-center justify-between space-y-0 border-b bg-white p-4">
                        <div className="flex flex-1 items-center gap-2 overflow-hidden">
                            <DialogTitle className="truncate pr-4">{previewFile?.name}</DialogTitle>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-2">
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setIsExpanded(!isExpanded)}
                                className="text-gray-500 hover:bg-gray-100"
                                title={isExpanded ? 'Exit Full Screen' : 'Full Screen'}
                            >
                                {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                            </Button>

                            <DialogClose className="rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100">
                                <X className="h-4 w-4" />
                                <span className="sr-only">Close</span>
                            </DialogClose>
                        </div>
                    </DialogHeader>

                    <div className="h-full w-full flex-1 overflow-auto bg-gray-50">
                        <div className="flex min-h-full flex-col items-center justify-start">
                            {previewFile ? (
                                /\.(jpg|jpeg|png|webp|gif)$/i.test(previewFile.url) ? (
                                    <div className="flex w-full justify-center p-4">
                                        <img src={`/files/${previewFile.url}`} alt={previewFile.name} className="max-w-full rounded object-contain shadow-md" />
                                    </div>
                                ) : /\.pdf$/i.test(previewFile.url) ? (
                                    <PDFPreview url={`/files/${encodeURIComponent(previewFile.url)}`} />
                                ) : /\.(txt|md|csv|log)$/i.test(previewFile.url) ? (
                                    <div className="flex w-full justify-center p-4">
                                        {loadingText ? (
                                            <div className="mt-10 flex items-center gap-2 text-muted-foreground">
                                                <Loader2 className="h-6 w-6 animate-spin" /> Loading text...
                                            </div>
                                        ) : (
                                            <div className="w-full max-w-3xl overflow-hidden rounded border bg-white p-6 font-mono text-base shadow-sm whitespace-pre-wrap">
                                                {fullTextContent}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="mt-10 text-center">
                                        <FileIcon className="mx-auto mb-4 h-16 w-16 text-gray-300" />
                                        <p className="mb-4 text-muted-foreground">Preview not available for this file type.</p>
                                        <Button asChild>
                                            <a href={`/files/${previewFile.url}`} download target="_blank" rel="noreferrer">
                                                Download File
                                            </a>
                                        </Button>
                                    </div>
                                )
                            ) : null}
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};
