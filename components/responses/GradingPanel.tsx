'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { id as createId, tx } from '@instantdb/react';
import { Send, RotateCcw, CheckCircle2, Upload, X, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { uploadFilesToS3 } from '@/lib/file-uploads';
import { ResponseFieldDisplay } from '@/components/responses/ResponseFieldDisplay';
import { GradeDisplay } from '@/components/responses/GradeDisplay';
import { StarRating } from '@/components/responses/StarRating';
import {
    buildGradeTransactions,
    buildFeedbackTransactions,
    buildCompleteGradingTransactions,
    buildRevisionRequestTransactions,
} from '@/lib/task-response-mutations';
import { buildTaskProgressUpdateTransactions } from '@/lib/task-progress-mutations';
import { formatGradeDisplay, getLetterGrade } from '@/lib/grade-utils';
import type { TaskResponseFieldType } from '@/lib/task-response-types';
import type { GradeTypeLike } from '@/lib/task-response-types';
import type { Task } from '@/lib/task-scheduler';

interface ResponseField {
    id: string;
    type: string;
    label: string;
    description?: string;
    weight: number;
    required: boolean;
    order: number;
}

interface FieldValue {
    id: string;
    richTextContent?: string | null;
    fileUrl?: string | null;
    fileName?: string | null;
    fileType?: string | null;
    fileSizeBytes?: number | null;
    thumbnailUrl?: string | null;
    field?: Array<{ id: string }>;
}

interface TaskResponse {
    id: string;
    status: string;
    version: number;
    submittedAt?: number;
    author?: Array<{ id: string; name?: string }>;
    fieldValues?: FieldValue[];
    grades?: Array<{
        id: string;
        numericValue: number;
        displayValue: string;
        gradeType?: Array<{ id: string; kind: string; name: string; highValue?: number; lowValue?: number; highLabel?: string; lowLabel?: string; steps?: any }>;
        field?: Array<{ id: string }>;
        grader?: Array<{ id: string; name?: string }>;
        feedback?: Array<{
            id: string;
            text?: string | null;
            author?: Array<{ id: string; name?: string }>;
            attachments?: Array<{ id: string; name: string; type: string; url: string }>;
        }>;
    }>;
}

interface Props {
    taskId: string;
    response: TaskResponse;
    responseFields: ResponseField[];
    gradeTypes: GradeTypeLike[];
    currentMemberId: string;
    allTasks: Task[];
    selectedDateKey?: string;
    onGradingComplete?: () => void;
}

export const GradingPanel: React.FC<Props> = ({
    taskId,
    response,
    responseFields,
    gradeTypes,
    currentMemberId,
    allTasks,
    selectedDateKey,
    onGradingComplete,
}) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [feedbackText, setFeedbackText] = useState('');
    const [feedbackFiles, setFeedbackFiles] = useState<File[]>([]);
    const [showFeedback, setShowFeedback] = useState(false);

    // Grade values: field-specific or overall
    const [gradeValues, setGradeValues] = useState<Record<string, number>>({});
    const [selectedGradeTypeId, setSelectedGradeTypeId] = useState<string>(
        () => gradeTypes.find((gt) => gt.isDefault)?.id || gradeTypes[0]?.id || ''
    );

    const sortedFields = useMemo(
        () => [...responseFields].sort((a, b) => a.order - b.order),
        [responseFields]
    );

    const selectedGradeType = useMemo(
        () => gradeTypes.find((gt) => gt.id === selectedGradeTypeId) || null,
        [gradeTypes, selectedGradeTypeId]
    );

    // Determine if grading is per-field or whole-response
    const hasFieldWeights = sortedFields.some((f) => f.weight > 0);

    // Existing grades on this response
    const existingGrades = response.grades || [];

    const getDisplayValue = useCallback(
        (numericValue: number): string => {
            if (!selectedGradeType) return String(numericValue);
            return formatGradeDisplay(numericValue, selectedGradeType);
        },
        [selectedGradeType]
    );

    const handleGradeChange = (key: string, value: number) => {
        setGradeValues((prev) => ({ ...prev, [key]: value }));
    };

    const handleSubmitGrades = useCallback(async () => {
        if (!selectedGradeType || isSubmitting) return;
        setIsSubmitting(true);

        try {
            const allTxns: any[] = [];

            if (hasFieldWeights) {
                // Per-field grading
                for (const field of sortedFields) {
                    const value = gradeValues[field.id];
                    if (value === undefined) continue;

                    const { transactions } = buildGradeTransactions({
                        responseId: response.id,
                        fieldId: field.id,
                        gradeTypeId: selectedGradeType.id,
                        graderFamilyMemberId: currentMemberId,
                        numericValue: value,
                        displayValue: getDisplayValue(value),
                    });
                    allTxns.push(...transactions);
                }
            } else {
                // Whole-response grading
                const value = gradeValues['__overall'];
                if (value !== undefined) {
                    const { transactions } = buildGradeTransactions({
                        responseId: response.id,
                        gradeTypeId: selectedGradeType.id,
                        graderFamilyMemberId: currentMemberId,
                        numericValue: value,
                        displayValue: getDisplayValue(value),
                    });
                    allTxns.push(...transactions);
                }
            }

            // Add feedback if provided
            if (feedbackText.trim() || feedbackFiles.length > 0) {
                // Find the grade ID to link feedback to — use the first grade we just created,
                // or the overall one
                // For simplicity, create feedback linked to the first grade created above
                const lastGradeId = allTxns.length > 0
                    ? (allTxns.find((t: any) => t?._ops?.[0]?.op === 'update' || true) as any)?._id
                    : null;

                // Upload feedback files if any
                let uploadedAttachments: Array<{
                    id: string; name: string; type: string; url: string;
                    sizeBytes?: number | null; thumbnailUrl?: string | null;
                }> = [];
                if (feedbackFiles.length > 0) {
                    const uploaded = await uploadFilesToS3(feedbackFiles, createId);
                    uploadedAttachments = uploaded.map((u) => ({
                        id: createId(),
                        name: u.name,
                        type: u.type,
                        url: u.url,
                        sizeBytes: u.sizeBytes ?? null,
                        thumbnailUrl: u.thumbnailUrl ?? null,
                    }));
                }

                // We need the grade IDs. Since we're building transactions, the IDs are embedded.
                // Let's just create a fresh grade-linked feedback using the first created grade.
                // For simplicity, if there are grades, link feedback to the latest one.
                if (existingGrades.length > 0 || allTxns.length > 0) {
                    // Use existing grade or we'll handle this via the grade we just built
                    const gradeIdForFeedback = existingGrades[0]?.id || createId();
                    const { transactions: feedbackTxns } = buildFeedbackTransactions({
                        gradeId: gradeIdForFeedback,
                        authorFamilyMemberId: currentMemberId,
                        text: feedbackText.trim() || null,
                        attachments: uploadedAttachments,
                    });
                    allTxns.push(...feedbackTxns);
                }
            }

            if (allTxns.length > 0) {
                await db.transact(allTxns);
            }

            setFeedbackText('');
            setFeedbackFiles([]);
            setGradeValues({});
        } catch (err) {
            console.error('Failed to submit grades:', err);
        } finally {
            setIsSubmitting(false);
        }
    }, [
        selectedGradeType, isSubmitting, hasFieldWeights, sortedFields,
        gradeValues, response.id, currentMemberId, getDisplayValue,
        feedbackText, feedbackFiles, existingGrades,
    ]);

    const handleCompleteGrading = useCallback(async () => {
        setIsSubmitting(true);
        try {
            const completeTxns = buildCompleteGradingTransactions(response.id);

            // Move task to done
            const progressTxns = buildTaskProgressUpdateTransactions({
                tx,
                taskId,
                allTasks,
                nextState: 'done',
                selectedDateKey: selectedDateKey || new Date().toISOString().slice(0, 10),
                createId: () => `task-progress-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            });

            await db.transact([...completeTxns, ...progressTxns]);
            onGradingComplete?.();
        } catch (err) {
            console.error('Failed to complete grading:', err);
        } finally {
            setIsSubmitting(false);
        }
    }, [response.id, taskId, allTasks, selectedDateKey, onGradingComplete]);

    const handleRequestRevision = useCallback(async () => {
        setIsSubmitting(true);
        try {
            const revisionTxns = buildRevisionRequestTransactions(response.id);

            // Move task back to active queue
            const progressTxns = buildTaskProgressUpdateTransactions({
                tx,
                taskId,
                allTasks,
                nextState: 'in_progress',
                selectedDateKey: selectedDateKey || new Date().toISOString().slice(0, 10),
                createId: () => `task-progress-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            });

            // Also save any feedback
            const allTxns = [...revisionTxns, ...progressTxns];

            if (feedbackText.trim()) {
                // Need a grade to attach feedback to — use existing or skip
                const existingGradeId = existingGrades[0]?.id;
                if (existingGradeId) {
                    const { transactions: feedbackTxns } = buildFeedbackTransactions({
                        gradeId: existingGradeId,
                        authorFamilyMemberId: currentMemberId,
                        text: feedbackText.trim(),
                    });
                    allTxns.push(...feedbackTxns);
                }
            }

            await db.transact(allTxns);
            setFeedbackText('');
            setFeedbackFiles([]);
        } catch (err) {
            console.error('Failed to request revision:', err);
        } finally {
            setIsSubmitting(false);
        }
    }, [response.id, taskId, allTasks, selectedDateKey, feedbackText, existingGrades, currentMemberId]);

    const handleFeedbackFileSelection = (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        setFeedbackFiles((prev) => [...prev, ...files]);
        event.target.value = '';
    };

    const authorName = response.author?.[0]?.name || 'Student';
    const submittedAt = response.submittedAt ? new Date(response.submittedAt).toLocaleString() : null;
    const isAlreadyGraded = response.status === 'graded';

    return (
        <div className="space-y-5">
            {/* Submission header */}
            <div className="flex items-center justify-between">
                <div>
                    <h4 className="text-sm font-semibold text-slate-900">Submission by {authorName}</h4>
                    <p className="text-xs text-slate-500">
                        Version {response.version}{submittedAt ? ` — submitted ${submittedAt}` : ''}
                    </p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                    isAlreadyGraded
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-violet-200 bg-violet-50 text-violet-700'
                }`}>
                    {isAlreadyGraded ? 'Graded' : 'Awaiting Review'}
                </span>
            </div>

            {/* Submitted field values (read-only) */}
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                {sortedFields.map((field) => {
                    const value = response.fieldValues?.find(
                        (fv) => fv.field?.some((f) => f.id === field.id)
                    );
                    const existingFieldGrade = existingGrades.find(
                        (g) => g.field?.some((f) => f.id === field.id)
                    );

                    return (
                        <div key={field.id}>
                            <ResponseFieldDisplay
                                type={field.type as TaskResponseFieldType}
                                label={field.label}
                                description={field.description}
                                required={field.required}
                                richTextContent={value?.richTextContent}
                                fileUrl={value?.fileUrl}
                                fileName={value?.fileName}
                                fileType={value?.fileType}
                                fileSizeBytes={value?.fileSizeBytes}
                                thumbnailUrl={value?.thumbnailUrl}
                            />

                            {/* Existing grade for this field */}
                            {existingFieldGrade && (
                                <div className="mt-1.5 ml-6">
                                    <GradeDisplay
                                        numericValue={existingFieldGrade.numericValue}
                                        displayValue={existingFieldGrade.displayValue}
                                        gradeType={existingFieldGrade.gradeType?.[0] as GradeTypeLike | undefined}
                                        size="sm"
                                    />
                                </div>
                            )}

                            {/* Per-field grade input */}
                            {hasFieldWeights && !isAlreadyGraded && selectedGradeType && (
                                <div className="mt-2 ml-6">
                                    <GradeInput
                                        gradeType={selectedGradeType}
                                        value={gradeValues[field.id] ?? existingFieldGrade?.numericValue}
                                        onChange={(v) => handleGradeChange(field.id, v)}
                                        label={`Grade for ${field.label}`}
                                    />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Overall grade input (when no per-field weights) */}
            {!hasFieldWeights && !isAlreadyGraded && selectedGradeType && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <h5 className="text-sm font-medium text-slate-700 mb-2">Overall Grade</h5>
                    <GradeInput
                        gradeType={selectedGradeType}
                        value={gradeValues['__overall'] ?? existingGrades.find((g) => !g.field?.length)?.numericValue}
                        onChange={(v) => handleGradeChange('__overall', v)}
                        label="Overall grade"
                    />
                </div>
            )}

            {/* Overall existing grade display */}
            {existingGrades.filter((g) => !g.field?.length).map((grade) => (
                <div key={grade.id} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-emerald-800">Overall Grade:</span>
                        <GradeDisplay
                            numericValue={grade.numericValue}
                            displayValue={grade.displayValue}
                            gradeType={grade.gradeType?.[0] as GradeTypeLike | undefined}
                        />
                    </div>
                </div>
            ))}

            {/* Grade type selector */}
            {!isAlreadyGraded && gradeTypes.length > 1 && (
                <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-slate-600">Grade type:</label>
                    <select
                        value={selectedGradeTypeId}
                        onChange={(e) => {
                            setSelectedGradeTypeId(e.target.value);
                            setGradeValues({});
                        }}
                        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm"
                    >
                        {gradeTypes.map((gt) => (
                            <option key={gt.id} value={gt.id}>
                                {gt.name}{gt.isDefault ? ' (Default)' : ''}
                            </option>
                        ))}
                    </select>
                </div>
            )}

            {/* Feedback section */}
            {!isAlreadyGraded && (
                <div>
                    <button
                        type="button"
                        onClick={() => setShowFeedback(!showFeedback)}
                        className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-800"
                    >
                        <MessageSquare className="h-4 w-4" />
                        {showFeedback ? 'Hide feedback' : 'Add feedback'}
                    </button>
                    {showFeedback && (
                        <div className="mt-3 space-y-3">
                            <textarea
                                value={feedbackText}
                                onChange={(e) => setFeedbackText(e.target.value)}
                                placeholder="Write feedback for the student..."
                                rows={4}
                                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
                            />
                            <div className="flex items-center gap-2">
                                <label className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200">
                                    <Upload className="h-3.5 w-3.5" />
                                    Attach files
                                    <input type="file" multiple className="hidden" onChange={handleFeedbackFileSelection} />
                                </label>
                                {feedbackFiles.length > 0 && (
                                    <span className="text-xs text-slate-500">{feedbackFiles.length} file{feedbackFiles.length !== 1 ? 's' : ''}</span>
                                )}
                            </div>
                            {feedbackFiles.length > 0 && (
                                <div className="space-y-1">
                                    {feedbackFiles.map((file, i) => (
                                        <div key={`${file.name}-${i}`} className="flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                                            <span className="truncate text-slate-700">{file.name}</span>
                                            <button
                                                type="button"
                                                onClick={() => setFeedbackFiles((prev) => prev.filter((_, idx) => idx !== i))}
                                                className="text-rose-500 hover:text-rose-700"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Existing feedback display */}
            {existingGrades.flatMap((g) => g.feedback || []).map((fb) => (
                <div key={fb.id} className="rounded-xl border border-blue-100 bg-blue-50/50 px-4 py-3">
                    <div className="text-xs font-medium text-blue-700">
                        Feedback{fb.author?.[0]?.name ? ` from ${fb.author[0].name}` : ''}
                    </div>
                    {fb.text && <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{fb.text}</div>}
                    {fb.attachments?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {fb.attachments.map((att) => (
                                <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                                    {att.name}
                                </a>
                            ))}
                        </div>
                    ) : null}
                </div>
            ))}

            {/* Action buttons */}
            {!isAlreadyGraded && (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRequestRevision}
                        disabled={isSubmitting}
                    >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Request Revision
                    </Button>
                    {Object.keys(gradeValues).length > 0 && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleSubmitGrades}
                            disabled={isSubmitting}
                        >
                            <Send className="mr-1.5 h-3.5 w-3.5" />
                            {isSubmitting ? 'Saving...' : 'Save Grades'}
                        </Button>
                    )}
                    <Button
                        type="button"
                        size="sm"
                        onClick={handleCompleteGrading}
                        disabled={isSubmitting}
                    >
                        <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                        {isSubmitting ? 'Completing...' : 'Complete Grading'}
                    </Button>
                </div>
            )}
        </div>
    );
};

// --- Grade Input Component ---

function GradeInput({
    gradeType,
    value,
    onChange,
    label,
}: {
    gradeType: GradeTypeLike;
    value?: number;
    onChange: (value: number) => void;
    label: string;
}) {
    if (gradeType.kind === 'stars') {
        return (
            <div>
                <StarRating
                    value={value ?? 0}
                    maxStars={gradeType.highValue}
                    onChange={onChange}
                    size="md"
                />
            </div>
        );
    }

    if (gradeType.kind === 'letter') {
        const steps = (gradeType.steps || []) as Array<{ label: string; value: number }>;
        return (
            <select
                value={value ?? ''}
                onChange={(e) => onChange(Number(e.target.value))}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                aria-label={label}
            >
                <option value="" disabled>Select grade...</option>
                {steps.sort((a, b) => b.value - a.value).map((step) => (
                    <option key={step.label} value={step.value}>
                        {step.label} ({step.value})
                    </option>
                ))}
            </select>
        );
    }

    // Number grade
    return (
        <div className="flex items-center gap-2">
            <input
                type="number"
                min={gradeType.lowValue}
                max={gradeType.highValue}
                step={1}
                value={value ?? ''}
                onChange={(e) => onChange(Number(e.target.value))}
                placeholder={`${gradeType.lowValue}–${gradeType.highValue}`}
                className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm"
                aria-label={label}
            />
            <span className="text-xs text-slate-500">/ {gradeType.highValue}</span>
        </div>
    );
}
