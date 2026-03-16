'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { id as createId, tx } from '@instantdb/react';
import { useDebouncedCallback } from 'use-debounce';
import { Send, Plus, ChevronDown, ChevronUp, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { uploadFilesToS3 } from '@/lib/file-uploads';
import { ResponseFieldInput } from '@/components/responses/ResponseFieldInput';
import { ResponseFieldDisplay } from '@/components/responses/ResponseFieldDisplay';
import {
    buildCreateDraftResponseTransactions,
    buildDraftFieldValueTransactions,
    buildSubmitResponseTransactions,
    buildCreateRevisionResponseTransactions,
} from '@/lib/task-response-mutations';
import { buildTaskProgressUpdateTransactions } from '@/lib/task-progress-mutations';
import { RESPONSE_FIELD_TYPE_LABELS, type TaskResponseFieldType } from '@/lib/task-response-types';
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
    createdAt?: number;
    updatedAt?: number;
    author?: { id: string; name?: string };
    fieldValues?: FieldValue[];
    grades?: Array<{
        id: string;
        numericValue: number;
        displayValue: string;
        gradeType?: Array<{ id: string; kind: string; name: string }>;
        field?: Array<{ id: string }>;
        grader?: Array<{ id: string; name?: string }>;
        feedback?: Array<{
            id: string;
            text?: string | null;
            author?: { id: string; name?: string };
            attachments?: Array<{
                id: string;
                name: string;
                type: string;
                url: string;
            }>;
        }>;
    }>;
}

interface Props {
    taskId: string;
    responseFields: ResponseField[];
    responses: TaskResponse[];
    currentMemberId: string;
    currentMemberName?: string;
    isParentReviewer?: boolean;
    allTasks: Task[];
    selectedDateKey?: string;
    onResponseSubmitted?: () => void;
    onExpandField?: (fieldId: string) => void;
}

export const TaskResponseComposer: React.FC<Props> = ({
    taskId,
    responseFields,
    responses,
    currentMemberId,
    currentMemberName,
    isParentReviewer = false,
    allTasks,
    selectedDateKey,
    onResponseSubmitted,
    onExpandField,
}) => {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [uploadingFieldId, setUploadingFieldId] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);

    const sortedFields = useMemo(
        () => [...responseFields].sort((a, b) => a.order - b.order),
        [responseFields]
    );

    // Find the current user's latest draft or create-ready state
    const myResponses = useMemo(
        () =>
            responses
                .filter((r) => r.author?.id === currentMemberId)
                .sort((a, b) => (b.version || 0) - (a.version || 0)),
        [responses, currentMemberId]
    );

    const latestResponse = myResponses[0] || null;
    const currentDraft = latestResponse?.status === 'draft' ? latestResponse : null;
    const latestSubmitted = myResponses.find(
        (r) => r.status === 'submitted' || r.status === 'graded' || r.status === 'revision_requested'
    );

    // Submitted/graded responses for history (all versions, newest first)
    const submittedHistory = useMemo(
        () => myResponses.filter((r) => r.status !== 'draft'),
        [myResponses]
    );

    // All responses for parent view (not drafts)
    const allSubmittedResponses = useMemo(
        () =>
            responses
                .filter((r) => r.status !== 'draft')
                .sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0)),
        [responses]
    );

    const canSubmit = useMemo(() => {
        if (!currentDraft) return false;
        // Check that all required fields have values
        for (const field of sortedFields) {
            if (!field.required) continue;
            const value = currentDraft.fieldValues?.find(
                (fv) => fv.field?.some((f) => f.id === field.id)
            );
            if (!value) return false;
            if (field.type === 'rich_text') {
                if (!value.richTextContent?.trim()) return false;
            } else {
                if (!value.fileUrl) return false;
            }
        }
        return true;
    }, [currentDraft, sortedFields]);

    const needsRevision = latestResponse?.status === 'revision_requested';

    // Get or create a draft response
    const ensureDraft = useCallback(async (): Promise<string> => {
        if (currentDraft) return currentDraft.id;

        const previousVersion = latestResponse?.version || 0;

        if (previousVersion === 0) {
            // First response ever
            const { transactions, responseId } = buildCreateDraftResponseTransactions({
                taskId,
                authorFamilyMemberId: currentMemberId,
            });
            await db.transact(transactions);
            return responseId;
        } else {
            // New revision
            const { transactions, responseId } = buildCreateRevisionResponseTransactions({
                taskId,
                authorFamilyMemberId: currentMemberId,
                previousVersion,
            });
            await db.transact(transactions);
            return responseId;
        }
    }, [currentDraft, latestResponse, taskId, currentMemberId]);

    const getExistingValueId = useCallback(
        (fieldId: string): string | null => {
            if (!currentDraft?.fieldValues) return null;
            const fv = currentDraft.fieldValues.find(
                (v) => v.field?.some((f) => f.id === fieldId)
            );
            return fv?.id || null;
        },
        [currentDraft]
    );

    // Auto-save rich text with debounce
    const debouncedSaveRichText = useDebouncedCallback(
        async (fieldId: string, content: string) => {
            const responseId = await ensureDraft();
            const existingValueId = getExistingValueId(fieldId);
            const { transactions } = buildDraftFieldValueTransactions({
                responseId,
                fieldId,
                richTextContent: content,
                existingValueId,
            });
            await db.transact(transactions);
        },
        800
    );

    const handleRichTextChange = useCallback(
        (fieldId: string, content: string) => {
            debouncedSaveRichText(fieldId, content);
        },
        [debouncedSaveRichText]
    );

    const handleFileSelect = useCallback(
        async (fieldId: string, files: File[]) => {
            if (files.length === 0) return;
            setUploadingFieldId(fieldId);
            try {
                const responseId = await ensureDraft();
                const [uploaded] = await uploadFilesToS3(files, createId);
                const existingValueId = getExistingValueId(fieldId);
                const { transactions } = buildDraftFieldValueTransactions({
                    responseId,
                    fieldId,
                    fileUrl: uploaded.url,
                    fileName: uploaded.name,
                    fileType: uploaded.type,
                    fileSizeBytes: uploaded.sizeBytes ?? null,
                    thumbnailUrl: uploaded.thumbnailUrl ?? null,
                    existingValueId,
                });
                await db.transact(transactions);
            } catch (err) {
                console.error('Failed to upload file:', err);
            } finally {
                setUploadingFieldId(null);
            }
        },
        [ensureDraft, getExistingValueId]
    );

    const handleFileClear = useCallback(
        async (fieldId: string) => {
            if (!currentDraft) return;
            const existingValueId = getExistingValueId(fieldId);
            if (!existingValueId) return;
            const { transactions } = buildDraftFieldValueTransactions({
                responseId: currentDraft.id,
                fieldId,
                fileUrl: null,
                fileName: null,
                fileType: null,
                fileSizeBytes: null,
                thumbnailUrl: null,
                existingValueId,
            });
            await db.transact(transactions);
        },
        [currentDraft, getExistingValueId]
    );

    const handleSubmit = useCallback(async () => {
        if (!currentDraft || isSubmitting) return;
        setIsSubmitting(true);
        try {
            const submitTxns = buildSubmitResponseTransactions({
                responseId: currentDraft.id,
                version: currentDraft.version || 1,
            });

            // Move task to needs_review
            const progressTxns = buildTaskProgressUpdateTransactions({
                tx,
                taskId,
                allTasks,
                nextState: 'needs_review',
                selectedDateKey: selectedDateKey || new Date().toISOString().slice(0, 10),
                createId: () => `task-progress-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
            });

            await db.transact([...submitTxns, ...progressTxns]);
            onResponseSubmitted?.();
        } catch (err) {
            console.error('Failed to submit response:', err);
        } finally {
            setIsSubmitting(false);
        }
    }, [currentDraft, isSubmitting, taskId, allTasks, selectedDateKey, onResponseSubmitted]);

    const handleStartRevision = useCallback(async () => {
        await ensureDraft();
    }, [ensureDraft]);

    // Get field value from current draft
    const getDraftFieldValue = (fieldId: string): FieldValue | undefined => {
        return currentDraft?.fieldValues?.find(
            (fv) => fv.field?.some((f) => f.id === fieldId)
        );
    };

    // --- OTHER MEMBERS' SUBMITTED RESPONSES (visible to parent reviewers) ---
    const otherSubmittedResponses = useMemo(
        () => allSubmittedResponses.filter((r) => r.author?.id !== currentMemberId),
        [allSubmittedResponses, currentMemberId]
    );

    // --- RESPONDENT VIEW (everyone can respond) ---
    return (
        <div className="space-y-4">
            {/* Other members' submitted responses (parent reviewer context) */}
            {isParentReviewer && otherSubmittedResponses.length > 0 && (
                <div className="space-y-3">
                    {otherSubmittedResponses.map((response) => (
                        <SubmittedResponseCard
                            key={response.id}
                            response={response}
                            sortedFields={sortedFields}
                        />
                    ))}
                </div>
            )}

            {/* Revision requested banner */}
            {needsRevision && !currentDraft && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <div className="text-sm font-medium text-amber-900">Revision Requested</div>
                    <p className="mt-1 text-xs text-amber-700">
                        Your submission needs changes. Review the feedback below and submit a revised response.
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-2"
                        onClick={handleStartRevision}
                    >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Start revision
                    </Button>
                </div>
            )}

            {/* Draft editor */}
            {(currentDraft || (!latestSubmitted && !needsRevision)) && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h4 className="text-sm font-semibold text-slate-900">
                                {currentDraft && currentDraft.version > 1 ? `Response (Revision ${currentDraft.version})` : 'Your Response'}
                            </h4>
                            <p className="mt-0.5 text-xs text-slate-500">
                                {currentDraft ? 'Auto-saving as you type' : 'Fill in the fields below. Your work is saved automatically.'}
                            </p>
                        </div>
                        {currentDraft && (
                            <span className="flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                                <Clock className="h-3 w-3" />
                                Draft
                            </span>
                        )}
                    </div>

                    {sortedFields.map((field) => {
                        const draftValue = getDraftFieldValue(field.id);
                        return (
                            <ResponseFieldInput
                                key={field.id}
                                fieldId={field.id}
                                type={field.type as TaskResponseFieldType}
                                label={field.label}
                                description={field.description}
                                required={field.required}
                                richTextContent={draftValue?.richTextContent}
                                fileUrl={draftValue?.fileUrl}
                                fileName={draftValue?.fileName}
                                fileType={draftValue?.fileType}
                                onRichTextChange={(content) => handleRichTextChange(field.id, content)}
                                onFileSelect={(files) => handleFileSelect(field.id, files)}
                                onFileClear={() => handleFileClear(field.id)}
                                isUploading={uploadingFieldId === field.id}
                                onExpand={onExpandField ? () => onExpandField(field.id) : undefined}
                            />
                        );
                    })}

                    <div className="flex items-center justify-end gap-2 pt-2">
                        <Button
                            type="button"
                            onClick={handleSubmit}
                            disabled={!canSubmit || isSubmitting}
                        >
                            <Send className="mr-1.5 h-3.5 w-3.5" />
                            {isSubmitting ? 'Submitting...' : 'Submit for Review'}
                        </Button>
                    </div>
                </div>
            )}

            {/* Latest submitted / graded response display */}
            {latestSubmitted && !currentDraft && !needsRevision && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-900">Your Latest Submission</h4>
                        <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                            latestSubmitted.status === 'graded'
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : latestSubmitted.status === 'submitted'
                                    ? 'border-violet-200 bg-violet-50 text-violet-700'
                                    : 'border-slate-200 bg-slate-50 text-slate-600'
                        }`}>
                            {latestSubmitted.status === 'submitted'
                                ? 'Awaiting Review'
                                : latestSubmitted.status === 'graded'
                                    ? 'Graded'
                                    : latestSubmitted.status}
                        </span>
                    </div>
                    <SubmittedResponseCard response={latestSubmitted} sortedFields={sortedFields} />

                    {/* Allow new submission */}
                    {latestSubmitted.status === 'graded' && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleStartRevision}
                        >
                            <Plus className="mr-1.5 h-3.5 w-3.5" />
                            Submit new revision
                        </Button>
                    )}
                </div>
            )}

            {/* Previous submissions history */}
            {submittedHistory.length > 1 && (
                <div>
                    <button
                        type="button"
                        onClick={() => setShowHistory(!showHistory)}
                        className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                    >
                        {showHistory ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {submittedHistory.length - 1} previous submission{submittedHistory.length - 1 !== 1 ? 's' : ''}
                    </button>
                    {showHistory && (
                        <div className="mt-3 space-y-3">
                            {submittedHistory.slice(1).map((response) => (
                                <SubmittedResponseCard
                                    key={response.id}
                                    response={response}
                                    sortedFields={sortedFields}
                                    isHistorical
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// --- Submitted Response Card ---

function SubmittedResponseCard({
    response,
    sortedFields,
    isHistorical = false,
}: {
    response: TaskResponse;
    sortedFields: ResponseField[];
    isHistorical?: boolean;
}) {
    const submittedAt = response.submittedAt
        ? new Date(response.submittedAt).toLocaleString()
        : null;
    const authorName = response.author?.name;

    return (
        <div className={`rounded-xl border ${isHistorical ? 'border-slate-100 bg-slate-50/50' : 'border-slate-200 bg-white'} p-4`}>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {authorName && <span className="font-medium text-slate-700">{authorName}</span>}
                <span>Version {response.version}</span>
                {submittedAt && <span>{submittedAt}</span>}
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    response.status === 'graded'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : response.status === 'submitted'
                            ? 'border-violet-200 bg-violet-50 text-violet-700'
                            : response.status === 'revision_requested'
                                ? 'border-amber-200 bg-amber-50 text-amber-700'
                                : 'border-slate-200 bg-slate-50 text-slate-600'
                }`}>
                    {response.status === 'revision_requested' ? 'Revision Requested' : response.status}
                </span>
            </div>

            <div className="mt-3 space-y-3">
                {sortedFields.map((field) => {
                    const value = response.fieldValues?.find(
                        (fv) => fv.field?.some((f) => f.id === field.id)
                    );

                    // Show grade for this field if exists
                    const fieldGrade = response.grades?.find(
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
                            {fieldGrade && (
                                <div className="mt-1.5 ml-6 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-1.5 text-xs">
                                    <span className="font-semibold text-emerald-700">
                                        Grade: {fieldGrade.displayValue}
                                    </span>
                                    {fieldGrade.gradeType?.[0]?.name && (
                                        <span className="ml-1.5 text-emerald-600">({fieldGrade.gradeType[0].name})</span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                {/* Overall grade (not field-specific) */}
                {response.grades?.filter((g) => !g.field?.length).map((grade) => (
                    <div key={grade.id} className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                        <div className="text-sm font-semibold text-emerald-800">
                            Overall Grade: {grade.displayValue}
                        </div>
                        {grade.gradeType?.[0]?.name && (
                            <div className="text-xs text-emerald-600">{grade.gradeType[0].name}</div>
                        )}
                        {/* Feedback on this grade */}
                        {grade.feedback?.map((fb) => (
                            <div key={fb.id} className="mt-2 border-t border-emerald-200 pt-2">
                                <div className="text-xs font-medium text-slate-600">
                                    Feedback{fb.author?.name ? ` from ${fb.author.name}` : ''}
                                </div>
                                {fb.text && (
                                    <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{fb.text}</div>
                                )}
                                {fb.attachments?.length ? (
                                    <div className="mt-1.5">
                                        {fb.attachments.map((att) => (
                                            <a key={att.id} href={att.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                                                {att.name}
                                            </a>
                                        ))}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ))}

                {/* Field-specific feedback */}
                {response.grades?.filter((g) => g.field?.length && g.feedback?.length).map((grade) => (
                    grade.feedback?.map((fb) => (
                        <div key={fb.id} className="ml-6 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs">
                            <div className="font-medium text-blue-700">
                                Feedback{fb.author?.name ? ` from ${fb.author.name}` : ''}
                            </div>
                            {fb.text && <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{fb.text}</div>}
                        </div>
                    ))
                ))}
            </div>
        </div>
    );
}
