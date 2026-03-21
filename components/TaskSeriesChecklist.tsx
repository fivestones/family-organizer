import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { Task } from '@/lib/task-scheduler';
import { ClipboardList, RotateCcw, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AttachmentCollection } from '@/components/attachments/AttachmentCollection';
import { AttachmentThumbnailRow } from '@/components/attachments/AttachmentThumbnail';
import { TaskUpdatePanel } from '@/components/task-updates/TaskUpdatePanel';
import { UpdateHistory } from '@/components/task-updates/UpdateHistory';
import { TaskResponseFeedbackThread } from '@/components/task-updates/TaskUpdateThread';
import type { ResponseFieldValueInput } from '@/lib/task-update-mutations';
import { uploadSingleFileToS3 } from '@/lib/file-uploads';
import { FocusOverlay } from '@/components/responses/FocusOverlay';
import type { FocusPanelItem, FocusPanelState, FocusableItem } from '@/components/responses/focus-panel-types';
import type { GradeTypeLike } from '@/lib/task-response-types';
import {
    getTaskChildProgressPercent,
    getBucketedTasks,
    getLatestTaskResponseThread,
    getLatestTaskUpdate,
    getTaskUpdateActorName,
    getTaskUpdateReplyToId,
    getTaskLastActiveState,
    getTaskStatusLabel,
    getTaskWorkflowState,
    isActionableTask,
    isTaskDone,
    sortTaskUpdates,
    taskUpdateHasMeaningfulFeedbackContent,
    type TaskBucketState,
    type TaskRestoreTiming,
    type TaskWorkflowState,
} from '@/lib/task-progress';

export interface TaskChecklistUpdateInput {
    nextState: TaskWorkflowState;
    note?: string;
    files?: File[];
    restoreTiming?: TaskRestoreTiming | null;
    responseFieldValues?: ResponseFieldValueInput[];
    replyToUpdateId?: string | null;
}

interface Props {
    tasks: Task[];
    allTasks: Task[];
    onToggle: (taskId: string, currentStatus: boolean) => void;
    onTaskUpdate?: (taskId: string, input: TaskChecklistUpdateInput) => Promise<void> | void;
    canWriteTaskProgress?: boolean;
    onRequireTaskAuth?: () => void;
    familyMemberNamesById?: Record<string, string>;
    isReadOnly?: boolean;
    selectedMember: string | null | 'All';
    /** The logged-in family member's ID (independent of the sidebar filter). */
    currentMemberId?: string | null;
    /** The logged-in family member's display name. */
    currentMemberName?: string;
    showDetails: boolean;
    isParentReviewer?: boolean;
    selectedDateKey?: string;
    gradeTypes?: GradeTypeLike[];
    detailContext?: {
        choreTitle?: string;
        seriesName?: string;
        ownerName?: string;
        selectedDateLabel?: string;
    };
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

type TaskModalIntent = 'details' | 'update';

const formatDateTimeLabel = (value: number | string | Date | null | undefined) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString();
};

const formatDateKeyLabel = (value: string | null | undefined) => {
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
};

const getTaskLineage = (task: Task, allTasks: Task[]) => {
    const lineage: Task[] = [];
    let parentId = getParentId(task);
    let depth = 0;

    while (parentId && depth < 10) {
        const parent = allTasks.find((candidate) => candidate.id === parentId);
        if (!parent) break;
        lineage.unshift(parent);
        parentId = getParentId(parent);
        depth += 1;
    }

    return lineage;
};

const getTaskContextMeta = (task: Task, allTasks: Task[]) => {
    const lineage = getTaskLineage(task, allTasks);
    const immediateParent = lineage[lineage.length - 1] || null;
    let subtitle: string | null = null;

    if (immediateParent) {
        const siblings = allTasks
            .filter((candidate) => getParentId(candidate) === immediateParent.id && !candidate.isDayBreak)
            .sort((left, right) => (left.order || 0) - (right.order || 0));
        const index = siblings.findIndex((candidate) => candidate.id === task.id) + 1;
        if (index > 0) {
            subtitle = `Task ${index} of ${siblings.length}`;
        }
    }

    return {
        subtitle,
        immediateParentLabel: immediateParent?.text || '',
        breadcrumbLabel: lineage.map((candidate) => candidate.text).join(' / '),
    };
};

export const TaskSeriesChecklist: React.FC<Props> = ({
    tasks: scheduledTasks,
    allTasks,
    onToggle,
    onTaskUpdate,
    canWriteTaskProgress = true,
    onRequireTaskAuth,
    familyMemberNamesById,
    isReadOnly,
    selectedMember,
    currentMemberId,
    currentMemberName,
    showDetails,
    isParentReviewer = false,
    selectedDateKey,
    gradeTypes = [],
    detailContext,
}) => {
    // Use the logged-in member for response authoring; fall back to sidebar selection for backwards compat
    const effectiveMemberId = currentMemberId || (selectedMember !== 'All' ? selectedMember : null);

    // File upload handler for response field file inputs
    const handleResponseFileUpload = useCallback(
        async (_fieldId: string, file: File) => uploadSingleFileToS3(file),
        []
    );
    const [localExpandedIds, setLocalExpandedIds] = useState<Set<string>>(new Set());
    const [expandedBuckets, setExpandedBuckets] = useState<Record<TaskBucketState, boolean>>({
        blocked: true,
        skipped: false,
        needs_review: true,
        done: false,
    });
    const [composerTaskId, setComposerTaskId] = useState<string | null>(null);
    const [modalIntent, setModalIntent] = useState<TaskModalIntent>('details');
    const [composerFiles, setComposerFiles] = useState<File[]>([]);
    const [composerRestoreTiming, setComposerRestoreTiming] = useState<TaskRestoreTiming | null>(null);
    const [isSubmittingComposer, setIsSubmittingComposer] = useState(false);
    const [focusPanelState, setFocusPanelState] = useState<FocusPanelState>({ mode: 'closed' });

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
                const leftEntry = getLatestTaskUpdate(left);
                const rightEntry = getLatestTaskUpdate(right);
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
    const composerTaskCurrentState = composerTask ? getTaskWorkflowState(composerTask) : null;
    const composerTaskIsActionable = composerTask ? isActionableTask(composerTask, allTasks) : false;
    const canRestoreFromComposer =
        composerTaskCurrentState === 'blocked' || composerTaskCurrentState === 'skipped' || composerTaskCurrentState === 'needs_review';
    const restoreTargetState = composerTask ? getTaskLastActiveState(composerTask) : null;
    const composerTaskMeta = composerTask ? getTaskContextMeta(composerTask, allTasks) : null;
    const composerTaskAttachments = composerTask ? ((composerTask as any).attachments || []) : [];
    const composerLatestEntry = composerTask ? getLatestTaskUpdate(composerTask) : null;
    const composerHistoryEntries = composerTask ? sortTaskUpdates((composerTask.updates || []).filter((entry) => !entry.isDraft)) : [];

    if (!hasAnyVisibleContent || actionableCount === 0) return null;

    const scheduledIds = new Set(activeScheduledTasks.map((t) => t.id));

    const toggleBucketSection = (state: TaskBucketState) => {
        setExpandedBuckets((prev) => ({
            ...prev,
            [state]: !prev[state],
        }));
    };

    const openComposer = (
        task: Task,
        options?: {
            intent?: TaskModalIntent;
            nextState?: TaskWorkflowState;
            restoreTiming?: TaskRestoreTiming | null;
        }
    ) => {
        setComposerTaskId(task.id);
        setModalIntent(options?.intent || 'details');
        setComposerFiles([]);
        setComposerRestoreTiming(options?.restoreTiming ?? null);
    };

    const closeComposer = () => {
        if (isSubmittingComposer) return;
        setComposerTaskId(null);
        setModalIntent('details');
        setComposerFiles([]);
        setComposerRestoreTiming(null);
        setFocusPanelState({ mode: 'closed' });
    };

    // --- Focus / Split panel logic ---
    const focusAvailableItems: FocusableItem[] = useMemo(() => {
        if (!composerTask) return [];
        const items: FocusableItem[] = [];
        // Response fields
        const fields = (composerTask as any).responseFields as Array<{ id: string; type: string; label: string }> | undefined;
        if (fields) {
            for (const f of fields) {
                items.push({ kind: f.type === 'rich_text' ? 'rich_text' : 'attachment', id: f.id, label: f.label });
            }
        }
        // Task attachments
        for (const att of composerTaskAttachments) {
            items.push({ kind: 'attachment', id: att.id || att.url, label: att.name || 'Attachment', thumbnailUrl: att.thumbnailUrl });
        }
        // Notes
        if (composerTask.notes?.trim()) {
            items.push({ kind: 'notes', id: 'task-notes', label: 'Task Notes' });
        }
        return items;
    }, [composerTask, composerTaskAttachments]);

    const buildFocusItemForField = useCallback(
        (fieldId: string): FocusPanelItem | null => {
            if (!composerTask) return null;
            const fields = (composerTask as any).responseFields as Array<{ id: string; type: string; label: string }> | undefined;
            const field = fields?.find((f) => f.id === fieldId);
            if (!field) return null;
            if (field.type === 'rich_text') {
                // Get current draft value from updates
                const updates = (composerTask as any).updates as Array<{ isDraft?: boolean; responseFieldValues?: Array<{ field?: Array<{ id: string }>; richTextContent?: string | null }> }> | undefined;
                const draft = updates?.find((u) => u.isDraft);
                const fv = draft?.responseFieldValues?.find((v) => {
                    const f = v.field;
                    const resolved = Array.isArray(f) ? f[0] : f;
                    return resolved?.id === fieldId;
                });
                return {
                    kind: 'rich_text',
                    fieldId,
                    label: field.label,
                    taskId: composerTask.id,
                    content: fv?.richTextContent || '',
                    onContentChange: () => {}, // The RichTextEditor in the overlay uses the same auto-save through TaskUpdatePanel
                };
            }
            return null;
        },
        [composerTask]
    );

    const buildFocusItemFromPickerItem = useCallback(
        (pickerItem: FocusableItem): FocusPanelItem | null => {
            if (!composerTask) return null;
            if (pickerItem.kind === 'rich_text') {
                return buildFocusItemForField(pickerItem.id);
            }
            if (pickerItem.kind === 'attachment') {
                // Could be a response field file or a task attachment
                const att = composerTaskAttachments.find((a: any) => (a.id || a.url) === pickerItem.id);
                if (att) {
                    return { kind: 'attachment', url: att.url, name: att.name || 'Attachment', type: att.type || 'application/octet-stream', label: pickerItem.label };
                }
                return null;
            }
            if (pickerItem.kind === 'notes') {
                return { kind: 'notes', text: composerTask.notes || '', label: 'Task Notes' };
            }
            return null;
        },
        [composerTask, composerTaskAttachments, buildFocusItemForField]
    );

    const handleExpandField = useCallback(
        (fieldId: string) => {
            const item = buildFocusItemForField(fieldId);
            if (item) {
                setFocusPanelState({ mode: 'focus', item });
            }
        },
        [buildFocusItemForField]
    );

    const handleFocusClose = useCallback(() => {
        setFocusPanelState({ mode: 'closed' });
    }, []);

    const handleEnterSplit = useCallback(() => {
        setFocusPanelState((prev) => {
            if (prev.mode === 'focus') {
                return { mode: 'split', left: prev.item, right: null };
            }
            return prev;
        });
    }, []);

    const handleSwapPanels = useCallback(() => {
        setFocusPanelState((prev) => {
            if (prev.mode === 'split' && prev.right) {
                return { mode: 'split', left: prev.right, right: prev.left };
            }
            return prev;
        });
    }, []);

    const handleCloseSplitPanel = useCallback((side: 'left' | 'right') => {
        setFocusPanelState((prev) => {
            if (prev.mode !== 'split') return prev;
            const remaining = side === 'left' ? prev.right : prev.left;
            if (remaining) {
                return { mode: 'focus', item: remaining };
            }
            return { mode: 'closed' };
        });
    }, []);

    const handlePickSplitItem = useCallback(
        (pickerItem: FocusableItem) => {
            const item = buildFocusItemFromPickerItem(pickerItem);
            if (!item) return;
            setFocusPanelState((prev) => {
                if (prev.mode === 'split') {
                    return { mode: 'split', left: prev.left, right: item };
                }
                return prev;
            });
        },
        [buildFocusItemFromPickerItem]
    );

    // Filter available items for split picker (exclude the item already shown)
    const splitPickerItems = useMemo(() => {
        if (focusPanelState.mode !== 'split') return focusAvailableItems;
        const leftId = focusPanelState.left.kind === 'rich_text' ? focusPanelState.left.fieldId
            : focusPanelState.left.kind === 'attachment' ? focusPanelState.left.url
            : 'task-notes';
        return focusAvailableItems.filter((item) => item.id !== leftId);
    }, [focusPanelState, focusAvailableItems]);

    const handleComposerFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
        const nextFiles = Array.from(event.target.files || []);
        setComposerFiles((prev) => [...prev, ...nextFiles]);
        event.target.value = '';
    };

    const handleRemovePendingFile = (index: number) => {
        setComposerFiles((prev) => prev.filter((_, currentIndex) => currentIndex !== index));
    };

    useEffect(() => {
        if (!composerTask) return;
        if (!canRestoreFromComposer && composerRestoreTiming) {
            setComposerRestoreTiming(null);
        }
    }, [canRestoreFromComposer, composerRestoreTiming, composerTask]);

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
                            <AttachmentCollection attachments={attachments} variant="compact" />
                        ) : null}
                    </div>
                ) : null}
            </>
        );
    };

    const renderResponseFieldBadge = (task: Task) => {
        const fields = task.responseFields;
        if (!fields || fields.length === 0) return null;

        const updates = task.updates || [];
        const nonDraftUpdates = updates.filter((u) => !u.isDraft);
        const hasDraftUpdate = updates.some((u) => u.isDraft);
        const hasGrade = nonDraftUpdates.some((u) => u.gradeDisplayValue && !u.gradeIsProvisional);
        const taskState = getTaskWorkflowState(task);
        const requiredCount = fields.filter((f) => f.required).length;

        let label: string;
        let badgeClass: string;

        if (hasGrade && taskState === 'done') {
            label = 'Graded';
            badgeClass = 'border-emerald-200 bg-emerald-50 text-emerald-700';
        } else if (taskState === 'needs_review') {
            label = 'Needs review';
            badgeClass = 'border-amber-200 bg-amber-50 text-amber-700';
        } else if (taskState === 'in_progress' && nonDraftUpdates.some((u) => u.toState === 'in_progress' && u.fromState === 'needs_review')) {
            label = 'Revision requested';
            badgeClass = 'border-rose-200 bg-rose-50 text-rose-700';
        } else if (hasDraftUpdate) {
            label = 'Draft response';
            badgeClass = 'border-slate-200 bg-slate-50 text-slate-600';
        } else {
            label = requiredCount > 0 ? 'Response required' : 'Response available';
            badgeClass = requiredCount > 0 ? 'border-purple-200 bg-purple-50 text-purple-700' : 'border-purple-100 bg-purple-50/50 text-purple-600';
        }

        return (
            <button
                type="button"
                onClick={() => openComposer(task, { intent: 'details' })}
                className={cn(
                    'mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors hover:opacity-80',
                    badgeClass,
                )}
            >
                <ClipboardList className="h-3 w-3" />
                {label}
            </button>
        );
    };

    const renderProgressMeta = (task: Task) => {
        const latestEntry = getLatestTaskUpdate(task);
        if (!latestEntry) return null;
        const latestEntryIsThreadedFeedback =
            Boolean(getTaskUpdateReplyToId(latestEntry)) &&
            taskUpdateHasMeaningfulFeedbackContent(latestEntry);
        if (latestEntryIsThreadedFeedback) return null;

        const actorName = getTaskUpdateActorName(latestEntry);
        const createdAt = latestEntry.createdAt ? new Date(latestEntry.createdAt).toLocaleString() : null;

        return (
            <div className="mt-2 rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-[11px] text-slate-600">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn('rounded-full border px-2 py-0.5 font-semibold', statusToneClassName[getTaskWorkflowState(task)])}>
                        {getTaskStatusLabel(getTaskWorkflowState(task))}
                    </span>
                    {actorName ? <span>by {actorName}</span> : null}
                    {createdAt ? <span>{createdAt}</span> : null}
                </div>
                {latestEntry.note ? <div className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{latestEntry.note}</div> : null}
                {latestEntry.attachments && latestEntry.attachments.length > 0 && (
                    <div className="mt-1.5">
                        <AttachmentThumbnailRow
                            attachments={latestEntry.attachments.map((a: any) => ({
                                id: a.id || '',
                                name: a.name || '',
                                type: a.type || '',
                                url: a.url || '',
                                thumbnailUrl: a.thumbnailUrl || null,
                                durationSec: a.durationSec || null,
                                waveformPeaks: a.waveformPeaks || null,
                            }))}
                            size={36}
                            maxVisible={3}
                        />
                    </div>
                )}
            </div>
        );
    };

    const renderLatestResponseThread = (task: Task, className?: string) => {
        const thread = getLatestTaskResponseThread(task);
        if (!thread) return null;

        return (
            <TaskResponseFeedbackThread
                submission={thread.submission}
                feedbackReplies={thread.feedbackReplies}
                className={className}
                label="Latest response"
                tone="indigo"
            />
        );
    };

    const renderActiveTaskRow = (task: Task) => {
        const isHeader = hasScheduledChildren(task.id, scheduledIds, allTasks) || !scheduledIds.has(task.id);
        const currentState = getTaskWorkflowState(task);
        const canMutate = !isReadOnly;
        const { subtitle, immediateParentLabel } = getTaskContextMeta(task, allTasks);
        const childProgressPercent = isHeader ? getTaskChildProgressPercent(task.id, allTasks) : null;

        if (isHeader) {
            return (
                <div
                    key={task.id}
                    className="relative my-1 mt-4 flex items-start pr-2"
                    style={{ marginLeft: `${(task.indentationLevel || 0) * 1.5}rem` }}
                >
                    <div className="flex min-w-0 flex-grow flex-col">
                        <div className="flex min-w-0 items-center gap-2 px-1">
                            <button
                                type="button"
                                onClick={() => openComposer(task, { intent: 'details' })}
                                className="min-w-0 text-left text-xs font-bold uppercase tracking-wider text-muted-foreground/80 transition-colors hover:text-sky-700 hover:underline"
                            >
                                {task.text}
                            </button>
                            {typeof childProgressPercent === 'number' ? (
                                <span className="shrink-0 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-sky-700">
                                    {childProgressPercent}% complete
                                </span>
                            ) : null}
                        </div>
                        {renderResponseFieldBadge(task)}
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
                                <button
                                    type="button"
                                    onClick={() => openComposer(task, { intent: 'details' })}
                                    className="text-left text-sm leading-tight text-foreground transition-colors hover:text-sky-700 hover:underline"
                                >
                                    {task.text}
                                </button>
                                <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', statusToneClassName[currentState])}>
                                    {getTaskStatusLabel(currentState)}
                                </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                                {subtitle ? <span>{subtitle}</span> : null}
                                {immediateParentLabel ? <span>{subtitle ? `in ${immediateParentLabel}` : immediateParentLabel}</span> : null}
                            </div>
                            {renderReferenceDetails(task)}
                            {renderProgressMeta(task)}
                            {renderLatestResponseThread(task, 'mt-3')}
                        </div>
                    </div>

                    {/* Inline response fields — shown directly in the card */}
                    {task.responseFields && task.responseFields.length > 0 && effectiveMemberId ? (
                        <div className="mt-3">
                            <TaskUpdatePanel
                                task={task}
                                variant="inline"
                                canEdit={canWriteTaskProgress}
                                disabled={!canMutate}
                                onRequireAuth={onRequireTaskAuth}
                                onFileUpload={handleResponseFileUpload}
                                onSubmit={
                                    canMutate
                                        ? async (submission) => {
                                              await onTaskUpdate?.(task.id, {
                                                  nextState: submission.nextState,
                                                  note: submission.note,
                                                  responseFieldValues: submission.responseFieldValues,
                                              });
                                          }
                                        : undefined
                                }
                            />
                        </div>
                    ) : task.responseFields && task.responseFields.length > 0 && !effectiveMemberId ? (
                        renderResponseFieldBadge(task)
                    ) : null}

                    {/* Action buttons — only for tasks WITHOUT inline response fields */}
                    {canMutate && !(task.responseFields && task.responseFields.length > 0 && effectiveMemberId) ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                            {currentState === 'not_started' ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        if (!canWriteTaskProgress) {
                                            onRequireTaskAuth?.();
                                            return;
                                        }
                                        onTaskUpdate?.(task.id, { nextState: 'in_progress' });
                                    }}
                                >
                                    Start
                                </Button>
                            ) : null}
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openComposer(task, { intent: 'details' })}
                            >
                                Details
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
        const latestEntry = getLatestTaskUpdate(task);
        const latestResponseThread = getLatestTaskResponseThread(task);
        const latestEntryIsThreadedFeedback =
            Boolean(latestEntry && getTaskUpdateReplyToId(latestEntry)) &&
            taskUpdateHasMeaningfulFeedbackContent(latestEntry);
        const actorName = getTaskUpdateActorName(latestEntry);
        const createdAt = formatDateTimeLabel(latestEntry?.createdAt);

        // Resolve a has-one link that may arrive as a single object or 1-element array
        const resolveField = (field: any): { id?: string; label?: string | null } | null => {
            if (!field) return null;
            if (Array.isArray(field)) return field[0] ?? null;
            return field;
        };

        // Check which response fields have meaningful submitted values
        const submittedFieldIds = new Set(
            (latestEntry?.responseFieldValues || [])
                .filter((rfv) => (rfv.richTextContent && rfv.richTextContent !== '<p></p>') || rfv.fileUrl)
                .map((rfv) => resolveField(rfv.field)?.id)
                .filter(Boolean)
        );
        const hasSubmittedResponse = submittedFieldIds.size > 0;
        const allFieldsSubmitted =
            hasSubmittedResponse &&
            (task.responseFields || []).every((f) => submittedFieldIds.has(f.id));

        // Helper to render a response field values summary
        const renderResponseSummary = (rfvs: typeof latestEntry.responseFieldValues) => (
            <div className="mt-2 space-y-1.5">
                {rfvs?.map((rfv, i) => {
                    const resolved = resolveField(rfv.field);
                    const fieldLabel = resolved?.label || '';
                    const isGenericLabel = fieldLabel.toLowerCase().replace(/[\s_-]+/g, '') === 'richtext';
                    if (!rfv.richTextContent && !rfv.fileUrl) return null;
                    if (rfv.richTextContent === '<p></p>') return null;
                    return (
                        <div key={rfv.id || i} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                            {fieldLabel && !isGenericLabel ? (
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{fieldLabel}</div>
                            ) : null}
                            {rfv.richTextContent && rfv.richTextContent !== '<p></p>' ? (
                                <div className="prose prose-sm mt-1 max-w-none text-xs text-slate-700" dangerouslySetInnerHTML={{ __html: rfv.richTextContent }} />
                            ) : null}
                            {rfv.fileUrl ? (
                                <div className="mt-1.5">
                                    <AttachmentCollection
                                        attachments={[{
                                            id: rfv.id || `rfv-${i}`,
                                            name: rfv.fileName || 'File',
                                            type: rfv.fileType || '',
                                            url: rfv.fileUrl,
                                        }]}
                                        variant="compact"
                                    />
                                </div>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        );

        return (
            <div key={`${state}-${task.id}`} className="rounded-lg border border-slate-200 bg-white/80 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                type="button"
                                onClick={() => openComposer(task, { intent: 'details' })}
                                className="text-left text-sm font-medium text-slate-900 transition-colors hover:text-sky-700 hover:underline"
                            >
                                {task.text}
                            </button>
                            <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', statusToneClassName[state])}>
                                {getTaskStatusLabel(state)}
                            </span>
                        </div>

                        {/* Update metadata — above response content */}
                        {!latestEntryIsThreadedFeedback ? (
                            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-slate-500">
                                {actorName ? <span>Latest by {actorName}</span> : null}
                                {createdAt ? <span>{createdAt}</span> : null}
                            </div>
                        ) : null}

                        {latestResponseThread ? (
                            <TaskResponseFeedbackThread
                                submission={latestResponseThread.submission}
                                feedbackReplies={latestResponseThread.feedbackReplies}
                                className="mt-3"
                                label="Latest response"
                                tone="indigo"
                            />
                        ) : null}

                        {/* Response fields: read-only summary when all submitted,
                            inline editor (pre-populated) when some are missing */}
                        {task.responseFields && task.responseFields.length > 0 ? (
                            allFieldsSubmitted && !latestResponseThread ? (
                                // All response fields answered — read-only summary
                                renderResponseSummary(latestEntry?.responseFieldValues)
                            ) : effectiveMemberId && (state === 'blocked' || state === 'skipped') ? (
                                // Some fields unanswered — inline editor pre-populated from latest update
                                <div className="mt-2">
                                    <TaskUpdatePanel
                                        task={task}
                                        variant="inline"
                                        canEdit={canWriteTaskProgress}
                                        disabled={isReadOnly}
                                        onFileUpload={handleResponseFileUpload}
                                        onRequireAuth={onRequireTaskAuth}
                                        onSubmit={
                                            !isReadOnly
                                                ? async (submission) => {
                                                      await onTaskUpdate?.(task.id, {
                                                          nextState: submission.nextState,
                                                          note: submission.note,
                                                          responseFieldValues: submission.responseFieldValues,
                                                      });
                                                  }
                                                : undefined
                                        }
                                    />
                                </div>
                            ) : hasSubmittedResponse && !latestResponseThread ? (
                                // Partial responses exist — show what we have
                                renderResponseSummary(latestEntry?.responseFieldValues)
                            ) : null
                        ) : null}

                        {!latestEntryIsThreadedFeedback && latestEntry?.note ? <div className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{latestEntry.note}</div> : null}
                        {!latestEntryIsThreadedFeedback && latestEntry?.attachments?.length ? (
                            <AttachmentCollection attachments={latestEntry.attachments} className="mt-2" variant="compact" />
                        ) : null}
                    </div>
                    {!isReadOnly ? (
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => openComposer(task, { intent: 'details' })}
                            >
                                Details
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
                                    onClick={() =>
                                        openComposer(task, {
                                            intent: 'update',
                                            nextState: getTaskLastActiveState(task),
                                            restoreTiming: 'now',
                                        })
                                    }
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

    const composerLatestActorName = getTaskUpdateActorName(composerLatestEntry);
    const composerLatestCreatedAt = formatDateTimeLabel(composerLatestEntry?.createdAt);
    const composerScheduledForDate = formatDateKeyLabel(composerLatestEntry?.scheduledForDate || composerTask?.completedOnDate || null);
    const composerDeferredUntilDate = formatDateKeyLabel(composerTask?.deferredUntilDate || null);
    const composerCompletedOnDate = formatDateKeyLabel(composerTask?.completedOnDate || null);
    const composerHistoryCountLabel = `${composerHistoryEntries.length} update${composerHistoryEntries.length === 1 ? '' : 's'}`;
    const composerCurrentStateLabel = composerTaskCurrentState ? getTaskStatusLabel(composerTaskCurrentState) : null;
    const composerTaskSpecificTime = composerTask?.specificTime || null;
    const composerTaskHasReferenceContent =
        Boolean(composerTask?.notes?.trim()) || composerTaskAttachments.length > 0 || Boolean(composerTaskSpecificTime);
    const composerUpdateUnavailableReason = !composerTaskIsActionable
        ? 'This is a parent/header task. Update the child tasks below it instead.'
        : isReadOnly
          ? 'This date is read-only, so progress updates are disabled here.'
          : !canWriteTaskProgress
            ? 'Sign in as a family member to save updates, notes, or evidence.'
            : !onTaskUpdate
              ? 'Task updates are unavailable in this view.'
              : null;

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
                <DialogContent className="max-w-5xl p-0">
                    {composerTask ? (
                        <div className="flex max-h-[85vh] flex-col">
                            <DialogHeader className="border-b border-slate-200 bg-gradient-to-br from-slate-50 via-white to-sky-50 px-6 py-5">
                                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                    <div className="space-y-3">
                                        <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Task Details</div>
                                        <div className="space-y-2">
                                            <DialogTitle className="text-2xl leading-tight text-slate-900">{composerTask.text}</DialogTitle>
                                            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                                                {detailContext?.choreTitle ? (
                                                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">Chore: {detailContext.choreTitle}</span>
                                                ) : null}
                                                {detailContext?.seriesName ? (
                                                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">Series: {detailContext.seriesName}</span>
                                                ) : null}
                                                {detailContext?.ownerName ? (
                                                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">Owner: {detailContext.ownerName}</span>
                                                ) : null}
                                                {detailContext?.selectedDateLabel ? (
                                                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">For {detailContext.selectedDateLabel}</span>
                                                ) : null}
                                                {composerTaskMeta?.subtitle ? (
                                                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">{composerTaskMeta.subtitle}</span>
                                                ) : null}
                                                {composerTaskMeta?.breadcrumbLabel ? (
                                                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1">In {composerTaskMeta.breadcrumbLabel}</span>
                                                ) : null}
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2 xl:max-w-[320px] xl:justify-end">
                                        {composerCurrentStateLabel ? (
                                            <span
                                                className={cn(
                                                    'rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]',
                                                    statusToneClassName[composerTaskCurrentState as TaskWorkflowState]
                                                )}
                                            >
                                                {composerCurrentStateLabel}
                                            </span>
                                        ) : null}
                                        <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600">
                                            {composerHistoryCountLabel}
                                        </span>
                                        {composerTaskAttachments.length > 0 ? (
                                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600">
                                                {composerTaskAttachments.length} file{composerTaskAttachments.length === 1 ? '' : 's'}
                                            </span>
                                        ) : null}
                                    </div>
                                </div>
                            </DialogHeader>

                            <div className="flex-1 overflow-y-auto px-6 py-5">
                                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                                    <div className="space-y-5">
                                        <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <h3 className="text-sm font-semibold text-slate-900">Overview</h3>
                                                {composerLatestCreatedAt ? (
                                                    <span className="text-xs text-slate-500">Latest update {composerLatestCreatedAt}</span>
                                                ) : (
                                                    <span className="text-xs text-slate-500">No progress updates yet</span>
                                                )}
                                            </div>
                                            <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                                <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Current State</div>
                                                    <div className="mt-2 text-sm font-medium text-slate-900">{composerCurrentStateLabel || 'Not started'}</div>
                                                    {composerLatestActorName ? <div className="mt-1 text-xs text-slate-500">Latest by {composerLatestActorName}</div> : null}
                                                </div>
                                                <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Schedule</div>
                                                    <div className="mt-2 text-sm font-medium text-slate-900">
                                                        {composerScheduledForDate || detailContext?.selectedDateLabel || 'Active now'}
                                                    </div>
                                                    {composerDeferredUntilDate ? (
                                                        <div className="mt-1 text-xs text-slate-500">Deferred until {composerDeferredUntilDate}</div>
                                                    ) : composerCompletedOnDate ? (
                                                        <div className="mt-1 text-xs text-slate-500">Completed on {composerCompletedOnDate}</div>
                                                    ) : null}
                                                </div>
                                                <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Timing</div>
                                                    <div className="mt-2 text-sm font-medium text-slate-900">{composerTaskSpecificTime || 'No specific time'}</div>
                                                    {composerTask?.overrideWorkAhead ? (
                                                        <div className="mt-1 text-xs text-slate-500">Work-ahead override enabled</div>
                                                    ) : null}
                                                </div>
                                                <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                                                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Structure</div>
                                                    <div className="mt-2 text-sm font-medium text-slate-900">
                                                        {composerTaskMeta?.breadcrumbLabel ? `In ${composerTaskMeta.breadcrumbLabel}` : 'Top-level task'}
                                                    </div>
                                                    {composerTaskMeta?.subtitle ? <div className="mt-1 text-xs text-slate-500">{composerTaskMeta.subtitle}</div> : null}
                                                </div>
                                            </div>
                                        </section>

                                        <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <h3 className="text-sm font-semibold text-slate-900">Reference Details</h3>
                                                <span className="text-xs text-slate-500">
                                                    {composerTaskHasReferenceContent ? 'Instructions and supporting files' : 'No saved instructions yet'}
                                                </span>
                                            </div>
                                            {composerTaskHasReferenceContent ? (
                                                <div className="mt-4 space-y-4">
                                                    {composerTask?.notes?.trim() ? (
                                                        <div>
                                                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Notes</div>
                                                            <div className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-sm text-slate-700">
                                                                {composerTask.notes}
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                    {composerTaskAttachments.length > 0 ? (
                                                        <div>
                                                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Attachments</div>
                                                            <div className="mt-2 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                                                                <AttachmentCollection attachments={composerTaskAttachments} variant="compact" />
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-500">
                                                    This task does not have saved notes or reference files yet.
                                                </div>
                                            )}
                                        </section>

                                        {composerLatestEntry ? (
                                            <section className="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <h3 className="text-sm font-semibold text-slate-900">Latest Activity</h3>
                                                    <div className="flex flex-wrap gap-2 text-xs text-slate-500">
                                                        {composerLatestActorName ? <span>by {composerLatestActorName}</span> : null}
                                                        {composerLatestCreatedAt ? <span>{composerLatestCreatedAt}</span> : null}
                                                    </div>
                                                </div>
                                                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                                                    <span
                                                        className={cn(
                                                            'rounded-full border px-2 py-0.5 font-semibold',
                                                            statusToneClassName[getTaskWorkflowState(composerTask)]
                                                        )}
                                                    >
                                                        {getTaskStatusLabel(getTaskWorkflowState(composerTask))}
                                                    </span>
                                                </div>
                                                {composerLatestEntry.note ? (
                                                    <div className="mt-3 whitespace-pre-wrap rounded-xl border border-slate-100 bg-slate-50/80 p-3 text-sm text-slate-700">
                                                        {composerLatestEntry.note}
                                                    </div>
                                                ) : null}
                                                {/* Response field values from the latest update */}
                                                {composerLatestEntry.responseFieldValues && composerLatestEntry.responseFieldValues.length > 0 && (
                                                    <div className="mt-3 space-y-1.5">
                                                        {composerLatestEntry.responseFieldValues.map((rfv: any, i: number) => {
                                                            const rawField = rfv.field;
                                                            const resolvedF = Array.isArray(rawField) ? rawField[0] : rawField;
                                                            const fieldLabel = resolvedF?.label || '';
                                                            const isGenericLabel = fieldLabel.toLowerCase().replace(/[\s_-]+/g, '') === 'richtext';
                                                            return (
                                                                <div key={rfv.id || i} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                                                                    {fieldLabel && !isGenericLabel ? (
                                                                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{fieldLabel}</div>
                                                                    ) : null}
                                                                    {rfv.richTextContent && rfv.richTextContent !== '<p></p>' ? (
                                                                        <div className="prose prose-sm mt-1 max-w-none text-sm text-slate-700" dangerouslySetInnerHTML={{ __html: rfv.richTextContent }} />
                                                                    ) : null}
                                                                    {rfv.fileUrl ? (
                                                                        <div className="mt-1.5">
                                                                            <AttachmentCollection
                                                                                attachments={[{
                                                                                    id: rfv.id || `rfv-${i}`,
                                                                                    name: rfv.fileName || 'File',
                                                                                    type: rfv.fileType || '',
                                                                                    url: rfv.fileUrl,
                                                                                }]}
                                                                                variant="compact"
                                                                            />
                                                                        </div>
                                                                    ) : null}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                {composerLatestEntry.attachments?.length ? (
                                                    <div className="mt-3">
                                                        <AttachmentThumbnailRow
                                                            attachments={composerLatestEntry.attachments.map((a: any) => ({
                                                                id: a.id || '',
                                                                name: a.name || '',
                                                                type: a.type || '',
                                                                url: a.url || '',
                                                                thumbnailUrl: a.thumbnailUrl || null,
                                                                durationSec: a.durationSec || null,
                                                                waveformPeaks: a.waveformPeaks || null,
                                                            }))}
                                                            size={44}
                                                        />
                                                    </div>
                                                ) : null}
                                            </section>
                                        ) : null}
                                    </div>

                                    <div className="space-y-5 xl:sticky xl:top-0">
                                        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                            <div className="flex flex-wrap items-start justify-between gap-3">
                                                <div>
                                                    <h3 className="text-sm font-semibold text-slate-900">Update</h3>
                                                    <p className="mt-1 text-xs text-slate-500">
                                                        {composerTask?.responseFields?.length
                                                            ? 'Respond, set status, and add notes in one step.'
                                                            : 'Capture progress, blockers, or review notes.'}
                                                    </p>
                                                </div>
                                            </div>

                                            {composerUpdateUnavailableReason ? (
                                                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-sm text-slate-600">
                                                    <p>{composerUpdateUnavailableReason}</p>
                                                    {!canWriteTaskProgress && !isReadOnly && composerTaskIsActionable ? (
                                                        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => onRequireTaskAuth?.()}>
                                                            Log in to update
                                                        </Button>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <div className="mt-4">
                                                    <TaskUpdatePanel
                                                        task={composerTask}
                                                        variant="full"
                                                        canEdit={canWriteTaskProgress}
                                                        disabled={isReadOnly}
                                                        isParentReviewer={isParentReviewer}
                                                        ownerName={detailContext?.ownerName}
                                                        gradeTypes={gradeTypes}
                                                        onFileUpload={handleResponseFileUpload}
                                                        onSubmit={async (submission) => {
                                                            setIsSubmittingComposer(true);
                                                            try {
                                                                await onTaskUpdate?.(composerTask.id, {
                                                                    nextState: submission.nextState,
                                                                    note: submission.note,
                                                                    responseFieldValues: submission.responseFieldValues,
                                                                    files: composerFiles,
                                                                    restoreTiming: composerRestoreTiming,
                                                                    replyToUpdateId: submission.replyToUpdateId,
                                                                });
                                                                closeComposer();
                                                            } finally {
                                                                setIsSubmittingComposer(false);
                                                            }
                                                        }}
                                                    >
                                                        {/* Restore With Context — shown inside the panel for blocked/skipped/needs_review tasks */}
                                                        {canRestoreFromComposer && restoreTargetState ? (
                                                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                                                                <div className="text-sm font-medium text-amber-900">Restore With Context</div>
                                                                <p className="mt-1 text-xs text-amber-800">
                                                                    Bring this task back to active work and include notes or files as part of the restore event.
                                                                </p>
                                                                <div className="mt-3 flex flex-wrap gap-2">
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => setComposerRestoreTiming('now')}
                                                                    >
                                                                        Restore now
                                                                    </Button>
                                                                    <Button
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="sm"
                                                                        onClick={() => setComposerRestoreTiming('next_scheduled')}
                                                                    >
                                                                        Restore next scheduled day
                                                                    </Button>
                                                                </div>
                                                                {composerRestoreTiming ? (
                                                                    <div className="mt-3 space-y-2">
                                                                        <label className="text-sm font-medium text-slate-700">Restore timing</label>
                                                                        <select
                                                                            value={composerRestoreTiming}
                                                                            onChange={(event) => setComposerRestoreTiming(event.target.value as TaskRestoreTiming)}
                                                                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                                                        >
                                                                            <option value="now">Return now</option>
                                                                            <option value="next_scheduled">Return on the next scheduled day</option>
                                                                        </select>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        ) : null}

                                                        {/* Evidence / file uploads */}
                                                        <div className="space-y-2">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Evidence</div>
                                                                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100">
                                                                    <Upload className="h-3.5 w-3.5" />
                                                                    Add files
                                                                    <input type="file" multiple className="hidden" onChange={handleComposerFileSelection} />
                                                                </label>
                                                            </div>
                                                            {composerFiles.length > 0 ? (
                                                                <div className="space-y-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
                                                                    {composerFiles.map((file, index) => (
                                                                        <div key={`${file.name}-${index}`} className="flex items-center justify-between gap-3 text-sm text-slate-700">
                                                                            <span className="truncate">{file.name}</span>
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleRemovePendingFile(index)}
                                                                                className="text-xs font-medium text-rose-600"
                                                                            >
                                                                                Remove
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-xs text-slate-500">
                                                                    Add photos, documents, voice notes, or video for this update.
                                                                </div>
                                                            )}
                                                        </div>
                                                    </TaskUpdatePanel>
                                                </div>
                                            )}
                                        </section>
                                    </div>
                                </div>

                                <section className="mt-5 rounded-2xl border border-slate-200 bg-white/90 shadow-sm">
                                    <div className="border-b border-slate-200 px-4 py-3">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div>
                                                <h3 className="text-sm font-semibold text-slate-900">History</h3>
                                                <p className="mt-1 text-xs text-slate-500">Every saved task update, restore, note, and evidence file appears here.</p>
                                            </div>
                                            <span className="text-xs text-slate-500">{composerHistoryCountLabel}</span>
                                        </div>
                                    </div>
                                    <div className="max-h-[320px] space-y-3 overflow-y-auto p-4">
                                        {composerHistoryEntries.length === 0 ? (
                                            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                                                No progress updates yet.
                                            </div>
                                        ) : (
                                            <UpdateHistory updates={composerTask?.updates || []} />
                                        )}
                                    </div>
                                </section>
                            </div>

                            <div className="flex items-center justify-end border-t border-slate-200 bg-white px-6 py-4">
                                <Button type="button" variant="outline" onClick={closeComposer} disabled={isSubmittingComposer}>
                                    Close
                                </Button>
                            </div>
                        </div>
                    ) : null}
                </DialogContent>
            </Dialog>

            <FocusOverlay
                state={focusPanelState}
                onClose={handleFocusClose}
                onEnterSplit={handleEnterSplit}
                onSelectSplitItem={() => {}}
                onSwapPanels={handleSwapPanels}
                onCloseSplitPanel={handleCloseSplitPanel}
                availableItems={splitPickerItems}
                onPickItem={handlePickSplitItem}
            />
        </div>
    );
};
