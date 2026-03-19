'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { AttachmentThumbnailRow } from '@/components/attachments/AttachmentThumbnail';
import {
    getTaskStatusLabel,
    getTaskUpdateActorName,
    getTaskUpdateAffectedName,
    sortTaskUpdates,
    type TaskUpdateLike,
    type TaskWorkflowState,
} from '@/lib/task-progress';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
    updates: TaskUpdateLike[];
    /** Maximum entries to display. Defaults to all. */
    limit?: number;
    className?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toneClassName: Record<TaskWorkflowState, string> = {
    not_started: 'bg-slate-100 text-slate-700 border-slate-200',
    in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
    blocked: 'bg-rose-100 text-rose-700 border-rose-200',
    skipped: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    needs_review: 'bg-violet-100 text-violet-700 border-violet-200',
    done: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

function formatTimestamp(value: number | string | Date | null | undefined): string {
    if (!value) return 'Unknown time';
    const date = typeof value === 'number' ? new Date(value) : new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown time';
    return date.toLocaleString();
}

function getToneClass(state: string | null | undefined): string {
    if (!state) return toneClassName.not_started;
    return toneClassName[state as TaskWorkflowState] || toneClassName.not_started;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UpdateHistory: React.FC<Props> = ({ updates, limit, className }) => {
    const nonDraftUpdates = (updates || []).filter((u) => !u.isDraft);
    const sorted = sortTaskUpdates(nonDraftUpdates);
    const visible = limit ? sorted.slice(0, limit) : sorted;

    if (visible.length === 0) {
        return (
            <div className={cn('rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-5 text-center text-sm text-slate-500', className)}>
                No progress updates yet.
            </div>
        );
    }

    return (
        <div className={cn('space-y-2', className)}>
            {visible.map((entry) => {
                const fromState = entry.fromState ? getTaskStatusLabel(entry.fromState as TaskWorkflowState) : null;
                const toState = entry.toState ? getTaskStatusLabel(entry.toState as TaskWorkflowState) : null;
                const actorName = getTaskUpdateActorName(entry);
                const affectedName = getTaskUpdateAffectedName(entry);
                const timestamp = formatTimestamp(entry.createdAt);
                const hasGrade = entry.gradeDisplayValue != null;

                return (
                    <div key={entry.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                        {/* Header: state transition + metadata */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                            {toState && (
                                <span
                                    className={cn(
                                        'rounded-full border px-2 py-0.5 font-semibold',
                                        getToneClass(entry.toState)
                                    )}
                                >
                                    {toState}
                                </span>
                            )}
                            {fromState && toState && fromState !== toState && (
                                <span className="text-slate-400">from {fromState}</span>
                            )}
                            {actorName && <span>by {actorName}</span>}
                            {affectedName && actorName !== affectedName && (
                                <span className="text-slate-400">for {affectedName}</span>
                            )}
                            <span className="text-slate-400">{timestamp}</span>
                        </div>

                        {/* Grade badge */}
                        {hasGrade && (
                            <div className="mt-2 flex items-center gap-2">
                                <span
                                    className={cn(
                                        'rounded-full border px-2.5 py-0.5 text-xs font-semibold',
                                        entry.gradeIsProvisional
                                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                                            : 'border-violet-200 bg-violet-50 text-violet-700'
                                    )}
                                >
                                    Grade: {entry.gradeDisplayValue}
                                    {entry.gradeIsProvisional && ' (provisional)'}
                                </span>
                                {entry.gradeType?.[0]?.name && (
                                    <span className="text-[10px] text-slate-400">
                                        {entry.gradeType[0].name}
                                    </span>
                                )}
                            </div>
                        )}

                        {/* Note */}
                        {entry.note && (
                            <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">
                                {entry.note}
                            </div>
                        )}

                        {/* Response field values summary */}
                        {entry.responseFieldValues && entry.responseFieldValues.length > 0 && (
                            <div className="mt-2 space-y-1">
                                {entry.responseFieldValues.map((fv) => {
                                    const fieldLabel = fv.field?.[0]?.label || 'Response';
                                    return (
                                        <div key={fv.id} className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                                            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                                {fieldLabel}
                                            </div>
                                            {fv.richTextContent && (
                                                <div
                                                    className="prose prose-sm mt-1 max-w-none text-slate-700"
                                                    dangerouslySetInnerHTML={{ __html: fv.richTextContent }}
                                                />
                                            )}
                                            {fv.fileUrl && (
                                                <div className="mt-1 text-xs text-blue-600 underline">
                                                    <a href={fv.fileUrl} target="_blank" rel="noopener noreferrer">
                                                        {fv.fileName || 'View file'}
                                                    </a>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}

                        {/* Attachments — responsive: medium on large viewports, scale down on small */}
                        {entry.attachments && entry.attachments.length > 0 && (
                            <div className="mt-2">
                                <AttachmentThumbnailRow
                                    attachments={entry.attachments.map((a) => ({
                                        id: a.id || '',
                                        name: a.name || '',
                                        type: a.type || '',
                                        url: a.url || '',
                                        thumbnailUrl: a.thumbnailUrl || null,
                                        durationSec: a.durationSec || null,
                                        waveformPeaks: a.waveformPeaks || null,
                                    }))}
                                    responsive
                                />
                            </div>
                        )}
                    </div>
                );
            })}

            {limit && sorted.length > limit && (
                <div className="text-center text-xs text-slate-400">
                    {sorted.length - limit} more update{sorted.length - limit === 1 ? '' : 's'}
                </div>
            )}
        </div>
    );
};
