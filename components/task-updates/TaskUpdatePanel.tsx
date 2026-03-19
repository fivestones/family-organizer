'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ResponseFieldInput } from '@/components/responses/ResponseFieldInput';
import { cn } from '@/lib/utils';
import {
    getTaskStatusLabel,
    getTaskWorkflowState,
    getTaskProgressPlaceholder,
    getLatestDraftUpdate,
    getLatestTaskUpdate,
    type TaskWorkflowState,
    isTaskWorkflowState,
} from '@/lib/task-progress';
import {
    validateUpdateSubmission,
    type ResponseFieldValueInput,
    type TaskUpdateGradeInput,
} from '@/lib/task-update-mutations';
import type { TaskResponseFieldType } from '@/lib/task-response-types';
import type { GradeTypeLike } from '@/lib/task-response-types';
import { AlertCircle, ChevronDown, MessageSquare, Send, Star, X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResponseField {
    id: string;
    type: string;
    label: string;
    description?: string | null;
    weight: number;
    required: boolean;
    order: number;
}

export interface TaskUpdatePanelTask {
    id: string;
    workflowState?: string | null;
    responseFields?: ResponseField[] | null;
    updates?: Array<{
        id?: string;
        isDraft?: boolean | null;
        responseFieldValues?: Array<{
            id?: string;
            richTextContent?: string | null;
            fileUrl?: string | null;
            fileName?: string | null;
            fileType?: string | null;
            field?: Array<{ id?: string; label?: string | null }> | null;
        }> | null;
    }> | null;
}

export interface TaskUpdatePanelSubmission {
    nextState: TaskWorkflowState;
    note?: string;
    responseFieldValues: ResponseFieldValueInput[];
    grade?: TaskUpdateGradeInput | null;
}

interface Props {
    task: TaskUpdatePanelTask;
    /** Compact mode for inline card rendering (no note/grade fields). */
    variant?: 'inline' | 'full';
    /** Whether the user can edit (false = read-only). */
    canEdit?: boolean;
    /** Grade types available for grading (parent-only). */
    gradeTypes?: GradeTypeLike[];
    /** Whether the current user is a parent reviewer. */
    isParentReviewer?: boolean;
    /** Called when the user submits an update. */
    onSubmit?: (submission: TaskUpdatePanelSubmission) => Promise<void> | void;
    /** Called when auto-save fires for draft field values. */
    onAutoSave?: (fieldValues: ResponseFieldValueInput[]) => void;
    /** Called when a file needs uploading. Returns the URL. */
    onFileUpload?: (fieldId: string, file: File) => Promise<{ url: string; fileName: string; fileType: string }>;
    disabled?: boolean;
    /**
     * Extra content rendered before the submit button in the full variant.
     * Useful for dialog-specific sections like restore timing or evidence uploads.
     */
    children?: React.ReactNode;
    /**
     * Called when the user requires authentication to proceed.
     * Used by the inline variant to show auth prompts on button clicks.
     */
    onRequireAuth?: () => void;
}

// All possible target states
const ALL_STATES: TaskWorkflowState[] = ['not_started', 'in_progress', 'blocked', 'skipped', 'needs_review', 'done'];

const STATE_COLORS: Record<TaskWorkflowState, string> = {
    not_started: 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200',
    in_progress: 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-200',
    blocked: 'bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-200',
    skipped: 'bg-zinc-100 text-zinc-700 border-zinc-200 hover:bg-zinc-200',
    needs_review: 'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200',
    done: 'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200',
};

const STATE_SOLID_COLORS: Record<TaskWorkflowState, string> = {
    not_started: 'bg-slate-600 hover:bg-slate-700 text-white',
    in_progress: 'bg-amber-600 hover:bg-amber-700 text-white',
    blocked: 'bg-rose-600 hover:bg-rose-700 text-white',
    skipped: 'bg-zinc-600 hover:bg-zinc-700 text-white',
    needs_review: 'bg-violet-600 hover:bg-violet-700 text-white',
    done: 'bg-emerald-600 hover:bg-emerald-700 text-white',
};

// ---------------------------------------------------------------------------
// Draft persistence helpers (localStorage)
// ---------------------------------------------------------------------------

const DRAFT_KEY_PREFIX = 'task-update-draft:';

interface DraftState {
    selectedState: TaskWorkflowState;
    note: string;
    showNote: boolean;
    showGrade: boolean;
    gradeValue: string;
    selectedGradeTypeId: string | null;
    savedAt: number;
}

/** Max age for a draft: 7 days. */
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function loadDraft(taskId: string): DraftState | null {
    try {
        const raw = localStorage.getItem(`${DRAFT_KEY_PREFIX}${taskId}`);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as DraftState;
        if (Date.now() - parsed.savedAt > DRAFT_MAX_AGE_MS) {
            localStorage.removeItem(`${DRAFT_KEY_PREFIX}${taskId}`);
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function saveDraft(taskId: string, draft: DraftState) {
    try {
        localStorage.setItem(`${DRAFT_KEY_PREFIX}${taskId}`, JSON.stringify(draft));
    } catch {
        // localStorage quota exceeded, silently ignore
    }
}

function clearDraft(taskId: string) {
    try {
        localStorage.removeItem(`${DRAFT_KEY_PREFIX}${taskId}`);
    } catch {
        // ignore
    }
}

function getDefaultState(currentState: TaskWorkflowState): TaskWorkflowState {
    return currentState === 'not_started' ? 'in_progress' : currentState;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const TaskUpdatePanel: React.FC<Props> = ({
    task,
    variant = 'full',
    canEdit = true,
    gradeTypes,
    isParentReviewer,
    onSubmit,
    onAutoSave,
    onFileUpload,
    disabled,
    children,
    onRequireAuth,
}) => {
    const currentState = getTaskWorkflowState(task) as TaskWorkflowState;
    const sortedFields = useMemo(
        () => [...(task.responseFields || [])].sort((a, b) => a.order - b.order),
        [task.responseFields]
    );
    const hasResponseFields = sortedFields.length > 0;

    // ---- Load draft or compute defaults ----
    const initialDraft = useRef(variant === 'full' ? loadDraft(task.id) : null);

    // ---- Field values state ----
    const [fieldValues, setFieldValues] = useState<Record<string, ResponseFieldValueInput>>({});
    const [uploadingFields, setUploadingFields] = useState<Set<string>>(new Set());

    // Initialize field values from the latest draft, or fall back to the
    // latest non-draft update's response values so previously-submitted
    // responses pre-populate the fields and can be edited/replaced.
    useEffect(() => {
        const draft = getLatestDraftUpdate(task);
        const source = draft ?? (variant === 'inline' ? getLatestTaskUpdate(task) : null);
        if (source?.responseFieldValues) {
            const initial: Record<string, ResponseFieldValueInput> = {};
            for (const fv of source.responseFieldValues) {
                // has-one links may arrive as a single object or a 1-element array
                const rawField = fv.field;
                const resolved = Array.isArray(rawField) ? rawField[0] : rawField;
                const fieldId = resolved?.id;
                if (fieldId) {
                    initial[fieldId] = {
                        fieldId,
                        existingValueId: fv.id,
                        richTextContent: fv.richTextContent ?? null,
                        fileUrl: fv.fileUrl ?? null,
                        fileName: fv.fileName ?? null,
                        fileType: fv.fileType ?? null,
                    };
                }
            }
            setFieldValues(initial);
        }
    }, [task, variant]);

    // ---- Status picker state ----
    const [selectedState, setSelectedState] = useState<TaskWorkflowState>(() => {
        const draft = initialDraft.current;
        if (draft?.selectedState && isTaskWorkflowState(draft.selectedState)) {
            return draft.selectedState;
        }
        return getDefaultState(currentState);
    });
    const [showAllStates, setShowAllStates] = useState(false);

    // ---- Note state ----
    const [note, setNote] = useState(() => initialDraft.current?.note ?? '');
    const [showNote, setShowNote] = useState(() => {
        const draft = initialDraft.current;
        return draft?.showNote ?? false;
    });

    // ---- Grade state ----
    const [selectedGradeTypeId, setSelectedGradeTypeId] = useState<string | null>(() => {
        const draft = initialDraft.current;
        return draft?.selectedGradeTypeId ?? gradeTypes?.[0]?.id ?? null;
    });
    const [gradeValue, setGradeValue] = useState(() => initialDraft.current?.gradeValue ?? '');
    const [showGrade, setShowGrade] = useState(() => initialDraft.current?.showGrade ?? false);

    // ---- Submitting state ----
    const [isSubmitting, setIsSubmitting] = useState(false);

    // ---- Debounced draft save (localStorage) ----
    const draftTimerRef = useRef<ReturnType<typeof setTimeout>>();

    useEffect(() => {
        if (variant !== 'full') return;

        // Only save a draft if there's meaningful content
        const hasDraftContent =
            note.trim().length > 0 ||
            showGrade ||
            gradeValue.trim().length > 0 ||
            selectedState !== getDefaultState(currentState);

        if (!hasDraftContent) {
            // Nothing worth drafting — clear any stale draft
            clearDraft(task.id);
            return;
        }

        clearTimeout(draftTimerRef.current);
        draftTimerRef.current = setTimeout(() => {
            saveDraft(task.id, {
                selectedState,
                note,
                showNote,
                showGrade,
                gradeValue,
                selectedGradeTypeId,
                savedAt: Date.now(),
            });
        }, 800);

        return () => clearTimeout(draftTimerRef.current);
    }, [variant, task.id, selectedState, note, showNote, showGrade, gradeValue, selectedGradeTypeId, currentState]);

    // ---- Auto-save debounce (DB-side response field values) ----
    const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout>>();
    const handleFieldValueChange = useCallback(
        (fieldId: string, partial: Partial<ResponseFieldValueInput>) => {
            setFieldValues((prev) => {
                const current = prev[fieldId] || { fieldId };
                const updated = { ...current, ...partial, fieldId };
                const next = { ...prev, [fieldId]: updated };

                // Trigger auto-save
                if (onAutoSave) {
                    clearTimeout(autoSaveTimerRef.current);
                    autoSaveTimerRef.current = setTimeout(() => {
                        onAutoSave(Object.values(next));
                    }, 1500);
                }

                return next;
            });
        },
        [onAutoSave]
    );

    useEffect(() => {
        return () => clearTimeout(autoSaveTimerRef.current);
    }, []);

    // ---- File upload handler ----
    const handleFileSelect = useCallback(
        async (fieldId: string, files: File[]) => {
            if (!onFileUpload || files.length === 0) return;
            setUploadingFields((prev) => new Set(prev).add(fieldId));
            try {
                const result = await onFileUpload(fieldId, files[0]);
                handleFieldValueChange(fieldId, {
                    fileUrl: result.url,
                    fileName: result.fileName,
                    fileType: result.fileType,
                });
            } finally {
                setUploadingFields((prev) => {
                    const next = new Set(prev);
                    next.delete(fieldId);
                    return next;
                });
            }
        },
        [onFileUpload, handleFieldValueChange]
    );

    // ---- Validation ----
    const filledFieldIds = useMemo(() => {
        const ids = new Set<string>();
        for (const [fieldId, value] of Object.entries(fieldValues)) {
            const hasContent =
                (value.richTextContent && value.richTextContent.trim().length > 0) ||
                (value.fileUrl && value.fileUrl.trim().length > 0);
            if (hasContent) ids.add(fieldId);
        }
        return ids;
    }, [fieldValues]);

    const validation = useMemo(() => {
        return validateUpdateSubmission({
            toState: selectedState,
            requiredResponseFields: sortedFields.filter((f) => f.required),
            filledFieldIds,
        });
    }, [selectedState, sortedFields, filledFieldIds]);

    // ---- Quick states: show a smart subset, with expand option ----
    const quickStates = useMemo(() => {
        // Always include the current state so users can submit notes/grades
        // without changing status.
        const states = new Set<TaskWorkflowState>();
        states.add(currentState);
        if (currentState === 'not_started') {
            states.add('in_progress');
            states.add('done');
        } else if (currentState === 'in_progress') {
            states.add('done');
            states.add('needs_review');
            states.add('blocked');
        } else if (currentState === 'blocked') {
            states.add('in_progress');
        } else if (currentState === 'needs_review') {
            states.add('done');
            states.add('in_progress');
        } else if (currentState === 'done') {
            states.add('in_progress');
            states.add('not_started');
        } else if (currentState === 'skipped') {
            states.add('not_started');
            states.add('in_progress');
        }
        return Array.from(states);
    }, [currentState]);

    const visibleStates = showAllStates ? ALL_STATES : quickStates;

    // ---- Grade helpers ----
    const selectedGradeType = gradeTypes?.find((g) => g.id === selectedGradeTypeId);
    const parsedGradeValue = parseFloat(gradeValue);
    const gradeIsValid = !Number.isNaN(parsedGradeValue);

    // ---- Submit ----
    const handleSubmit = useCallback(async () => {
        if (!onSubmit) return;

        const effectiveState = validation?.routedState || selectedState;
        const responseFieldValues = Object.values(fieldValues);

        const grade: TaskUpdateGradeInput | null =
            showGrade && selectedGradeType && gradeIsValid
                ? {
                      numericValue: parsedGradeValue,
                      displayValue: gradeValue,
                      gradeTypeId: selectedGradeType.id,
                      isProvisional: false,
                  }
                : null;

        setIsSubmitting(true);
        try {
            await onSubmit({
                nextState: effectiveState,
                note: note.trim() || undefined,
                responseFieldValues,
                grade,
            });
            // Reset panel and clear draft
            setNote('');
            setShowNote(false);
            setSelectedState(getDefaultState(currentState));
            setGradeValue('');
            setShowGrade(false);
            clearDraft(task.id);
        } finally {
            setIsSubmitting(false);
        }
    }, [
        selectedState,
        onSubmit,
        validation,
        fieldValues,
        showGrade,
        selectedGradeType,
        gradeIsValid,
        parsedGradeValue,
        gradeValue,
        note,
        currentState,
        task.id,
    ]);

    const isDisabled = disabled || !canEdit;

    // ---- Inline action helpers ----
    const hasRequiredResponseFields = sortedFields.some((f) => f.required);

    const handleInlineAction = useCallback(
        async (nextState: TaskWorkflowState) => {
            if (!onSubmit) return;
            if (!canEdit) {
                onRequireAuth?.();
                return;
            }

            // Validate required fields for needs_review / done transitions
            if (nextState === 'needs_review' || nextState === 'done') {
                const inlineValidation = validateUpdateSubmission({
                    toState: nextState,
                    requiredResponseFields: sortedFields.filter((f) => f.required),
                    filledFieldIds,
                });
                if (!inlineValidation.valid) {
                    // Don't submit — validation message will show via state update
                    setSelectedState(nextState);
                    return;
                }
                // If done with required responses → route to needs_review
                if (inlineValidation.routedState) {
                    nextState = inlineValidation.routedState;
                }
            }

            setIsSubmitting(true);
            try {
                const rfvs = Object.values(fieldValues);
                await onSubmit({
                    nextState,
                    responseFieldValues: rfvs,
                });
                // Clear field values after successful inline submission
                setFieldValues({});
            } finally {
                setIsSubmitting(false);
            }
        },
        [onSubmit, canEdit, onRequireAuth, sortedFields, filledFieldIds, fieldValues]
    );

    // ======= INLINE VARIANT (compact, for task card) =======
    if (variant === 'inline') {
        // Inline validation for showing messages
        const inlineValidation = hasResponseFields
            ? validateUpdateSubmission({
                  toState: selectedState,
                  requiredResponseFields: sortedFields.filter((f) => f.required),
                  filledFieldIds,
              })
            : null;

        return (
            <div className="space-y-3">
                {sortedFields.map((field) => {
                    const value = fieldValues[field.id];
                    return (
                        <ResponseFieldInput
                            key={field.id}
                            fieldId={field.id}
                            type={field.type as TaskResponseFieldType}
                            label={field.label}
                            description={field.description}
                            required={field.required}
                            richTextContent={value?.richTextContent}
                            fileUrl={value?.fileUrl}
                            fileName={value?.fileName}
                            fileType={value?.fileType}
                            onRichTextChange={(content) =>
                                handleFieldValueChange(field.id, { richTextContent: content })
                            }
                            onFileSelect={(files) => handleFileSelect(field.id, files)}
                            onFileClear={() =>
                                handleFieldValueChange(field.id, {
                                    fileUrl: null,
                                    fileName: null,
                                    fileType: null,
                                })
                            }
                            isUploading={uploadingFields.has(field.id)}
                            disabled={isDisabled}
                        />
                    );
                })}

                {/* Inline validation message */}
                {inlineValidation && !inlineValidation.valid && selectedState !== currentState && (
                    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
                        <div className="text-xs text-amber-800">{inlineValidation.message}</div>
                    </div>
                )}

                {/* Inline action buttons — shown when onSubmit is provided */}
                {onSubmit && !isDisabled && (
                    <div className="flex flex-wrap gap-2">
                        {currentState === 'not_started' && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isSubmitting}
                                onClick={() => handleInlineAction('in_progress')}
                            >
                                Start
                            </Button>
                        )}
                        {currentState === 'in_progress' && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isSubmitting}
                                onClick={() => handleInlineAction('in_progress')}
                            >
                                Update
                            </Button>
                        )}
                        {/* For blocked/skipped: "Update" saves response data without changing state */}
                        {(currentState === 'blocked' || currentState === 'skipped') && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isSubmitting}
                                onClick={() => handleInlineAction(currentState)}
                            >
                                {isSubmitting ? 'Saving...' : 'Update'}
                            </Button>
                        )}
                        {/* Active states: Submit or Done based on required response fields */}
                        {(currentState === 'not_started' || currentState === 'in_progress') && (
                            hasRequiredResponseFields ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={isSubmitting}
                                    onClick={() => handleInlineAction('needs_review')}
                                >
                                    {isSubmitting ? 'Submitting...' : 'Submit'}
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={isSubmitting}
                                    onClick={() => handleInlineAction('done')}
                                >
                                    {isSubmitting ? 'Saving...' : 'Done'}
                                </Button>
                            )
                        )}
                    </div>
                )}
            </div>
        );
    }

    // ======= FULL VARIANT (for dialog/detail panel) =======
    const effectiveSubmitState = validation?.routedState || selectedState;

    return (
        <div className="space-y-5">
            {/* Response fields */}
            {hasResponseFields && (
                <div className="space-y-4">
                    {sortedFields.map((field) => {
                        const value = fieldValues[field.id];
                        return (
                            <ResponseFieldInput
                                key={field.id}
                                fieldId={field.id}
                                type={field.type as TaskResponseFieldType}
                                label={field.label}
                                description={field.description}
                                required={field.required}
                                richTextContent={value?.richTextContent}
                                fileUrl={value?.fileUrl}
                                fileName={value?.fileName}
                                fileType={value?.fileType}
                                onRichTextChange={(content) =>
                                    handleFieldValueChange(field.id, { richTextContent: content })
                                }
                                onFileSelect={(files) => handleFileSelect(field.id, files)}
                                onFileClear={() =>
                                    handleFieldValueChange(field.id, {
                                        fileUrl: null,
                                        fileName: null,
                                        fileType: null,
                                    })
                                }
                                isUploading={uploadingFields.has(field.id)}
                                disabled={isDisabled}
                            />
                        );
                    })}
                </div>
            )}

            {/* Status transition picker + Add grade inline */}
            {canEdit && (
                <div className="space-y-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Update Status
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {visibleStates.map((state) => (
                            <button
                                key={state}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => setSelectedState(state)}
                                className={cn(
                                    'rounded-full border px-3 py-1.5 text-xs font-semibold transition-all',
                                    selectedState === state
                                        ? STATE_SOLID_COLORS[state]
                                        : STATE_COLORS[state],
                                    isDisabled && 'cursor-not-allowed opacity-50'
                                )}
                            >
                                {getTaskStatusLabel(state)}
                            </button>
                        ))}
                        {!showAllStates && visibleStates.length < ALL_STATES.length && (
                            <button
                                type="button"
                                onClick={() => setShowAllStates(true)}
                                className="flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-100"
                            >
                                More
                                <ChevronDown className="h-3 w-3" />
                            </button>
                        )}
                        {isParentReviewer && !showGrade && gradeTypes && gradeTypes.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setShowGrade(true)}
                                className="flex items-center gap-1.5 rounded-full border border-violet-200 px-3 py-1.5 text-xs font-medium text-violet-600 transition-colors hover:bg-violet-50"
                            >
                                <Star className="h-3.5 w-3.5" />
                                Add grade
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Validation message */}
            {validation && !validation.valid && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
                    <div className="text-sm text-amber-800">{validation.message}</div>
                </div>
            )}
            {validation?.routedState && validation.valid && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600" />
                    <div className="text-sm text-blue-800">{validation.message}</div>
                </div>
            )}

            {/* Optional note toggle */}
            {canEdit && !showNote && (
                <div>
                    <button
                        type="button"
                        onClick={() => setShowNote(true)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
                    >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Add note
                    </button>
                </div>
            )}

            {/* Note input */}
            {showNote && (
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                            Note
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setShowNote(false);
                                setNote('');
                            }}
                            className="rounded-full p-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    <Textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder={getTaskProgressPlaceholder(selectedState)}
                        rows={3}
                        disabled={isDisabled}
                        className="resize-none text-sm"
                    />
                </div>
            )}

            {/* Grade input (parent-only) */}
            {showGrade && gradeTypes && gradeTypes.length > 0 && (
                <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
                    <div className="flex items-center justify-between">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-600">
                            Grade
                        </div>
                        <button
                            type="button"
                            onClick={() => {
                                setShowGrade(false);
                                setGradeValue('');
                            }}
                            className="rounded-full p-0.5 text-violet-400 transition-colors hover:bg-violet-200 hover:text-violet-700"
                        >
                            <X className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    {gradeTypes.length > 1 && (
                        <div className="flex flex-wrap gap-1.5">
                            {gradeTypes.map((gt) => (
                                <button
                                    key={gt.id}
                                    type="button"
                                    onClick={() => setSelectedGradeTypeId(gt.id)}
                                    className={cn(
                                        'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                                        selectedGradeTypeId === gt.id
                                            ? 'border-violet-400 bg-violet-200 text-violet-800'
                                            : 'border-violet-200 bg-white text-violet-600 hover:bg-violet-100'
                                    )}
                                >
                                    {gt.name}
                                </button>
                            ))}
                        </div>
                    )}
                    {selectedGradeType && (
                        <div className="flex items-center gap-3">
                            <input
                                type="number"
                                value={gradeValue}
                                onChange={(e) => setGradeValue(e.target.value)}
                                placeholder={`${selectedGradeType.lowValue}–${selectedGradeType.highValue}`}
                                min={selectedGradeType.lowValue}
                                max={selectedGradeType.highValue}
                                step="any"
                                disabled={isDisabled}
                                className="w-24 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                            />
                            <span className="text-xs text-slate-500">
                                {selectedGradeType.lowLabel} – {selectedGradeType.highLabel}
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* Extra content (e.g. restore timing, evidence uploads) */}
            {children}

            {/* Submit button — always visible in full variant */}
            {canEdit && (
                <Button
                    type="button"
                    onClick={handleSubmit}
                    disabled={
                        isDisabled ||
                        isSubmitting ||
                        (validation !== null && !validation.valid)
                    }
                    className={cn(
                        'w-full gap-2 rounded-xl py-2.5 text-sm font-semibold shadow-sm transition-all',
                        STATE_SOLID_COLORS[effectiveSubmitState]
                    )}
                >
                    <Send className="h-4 w-4" />
                    {isSubmitting
                        ? 'Submitting...'
                        : validation?.routedState
                          ? `Submit as ${getTaskStatusLabel(validation.routedState)}`
                          : `Submit as ${getTaskStatusLabel(selectedState)}`}
                </Button>
            )}
        </div>
    );
};
