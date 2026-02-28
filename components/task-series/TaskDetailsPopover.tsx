'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react-dom';
import { id as generateId, tx } from '@instantdb/react';
import { ChevronLeft, ChevronRight, File as FileIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useDebouncedCallback } from 'use-debounce';

import { getPresignedUploadUrl, refreshFiles } from '@/app/actions';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import { cn } from '@/lib/utils';

import {
    dispatchCloseTaskDetails,
    findAdjacentTaskDetailsTarget,
    formatTaskSeriesShortcutLabel,
    matchesTaskSeriesShortcut,
    openAdjacentTaskDetails,
    TASK_SERIES_CLOSE_DETAILS_EVENT,
    TASK_SERIES_OPEN_DETAILS_EVENT,
    type TaskSeriesCloseDetailsPayload,
    type TaskSeriesNavigationDirection,
    type TaskSeriesOpenDetailsPayload,
    type TaskSeriesSelectionSnapshot,
} from './taskSeriesCommands';

type TaskDateMap = Record<string, { label: string; date: Date } | undefined>;

const POSITION_TRANSITION = 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
const CONTENT_TRANSITION = 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)';

const getTaskDetailsTriggerElement = (editor: Editor | null, taskPos: number) => {
    if (!editor || editor.isDestroyed) return null;

    const nodeDom = editor.view.nodeDOM(taskPos);
    if (!(nodeDom instanceof HTMLElement)) return null;

    return nodeDom.querySelector<HTMLElement>('[data-task-details-trigger="true"]');
};

const restoreEditorSelection = (editor: Editor | null, selection: TaskSeriesSelectionSnapshot | null) => {
    if (!editor || editor.isDestroyed || !selection) return;

    const target = selection.anchor === selection.head ? selection.anchor : { from: selection.anchor, to: selection.head };
    editor.chain().focus().setTextSelection(target).run();
};

const TaskMetadataManager = ({
    taskId,
    registerPendingSaveFlush,
}: {
    taskId: string;
    registerPendingSaveFlush?: (flushFn: null | (() => Promise<void>)) => void;
}) => {
    const { data, isLoading } = db.useQuery({
        tasks: {
            $: { where: { id: taskId } },
            attachments: {},
        },
    });

    const task = data?.tasks?.[0] as
        | {
              id: string;
              notes?: string | null;
              attachments?: Array<{ id: string; name?: string; url?: string; type?: string }>;
          }
        | undefined;
    const [notes, setNotes] = useState(task?.notes || '');
    const [uploading, setUploading] = useState(false);
    const notesRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        if (task) {
            setNotes(task.notes || '');
        }
    }, [task?.notes]);

    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            const textarea = notesRef.current;
            if (!textarea) return;

            textarea.focus({ preventScroll: true });
            const cursorPosition = textarea.value.length;
            textarea.setSelectionRange(cursorPosition, cursorPosition);
        });

        return () => {
            window.cancelAnimationFrame(frame);
        };
    }, [taskId]);

    const saveNotes = useDebouncedCallback((newNotes: string) => {
        db.transact(tx.tasks[taskId].update({ notes: newNotes }));
    }, 1000);

    const flushPendingNotes = useCallback(async () => {
        const flush = (saveNotes as typeof saveNotes & { flush?: () => unknown | Promise<unknown> }).flush;
        if (typeof flush === 'function') {
            await flush();
        }
    }, [saveNotes]);

    useEffect(() => {
        registerPendingSaveFlush?.(flushPendingNotes);

        return () => {
            registerPendingSaveFlush?.(null);
            void flushPendingNotes();
        };
    }, [flushPendingNotes, registerPendingSaveFlush]);

    const handleNotesChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const value = event.target.value;
        setNotes(value);
        saveNotes(value);
    };

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const { url, fields, key } = await getPresignedUploadUrl(file.type, file.name);

            const formData = new FormData();
            Object.entries(fields).forEach(([fieldKey, fieldValue]) => formData.append(fieldKey, fieldValue as string));
            formData.append('file', file);

            const uploadResponse = await fetch(url, {
                method: 'POST',
                body: formData,
            });

            if (!uploadResponse.ok) throw new Error('Upload failed');

            const attachmentId = generateId();
            db.transact([
                tx.taskAttachments[attachmentId].update({
                    name: file.name,
                    url: key,
                    type: file.type,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }),
                tx.tasks[taskId].link({ attachments: attachmentId }),
            ]);

            await refreshFiles();
        } catch (error) {
            console.error('File upload error:', error);
            alert('Failed to upload file.');
        } finally {
            setUploading(false);
            event.target.value = '';
        }
    };

    const handleDeleteAttachment = (attachmentId: string) => {
        if (confirm('Are you sure you want to remove this attachment?')) {
            db.transact(tx.taskAttachments[attachmentId].delete());
        }
    };

    if (isLoading) {
        return <div className="p-4 text-xs text-muted-foreground">Loading details...</div>;
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-700">Notes</label>
                <textarea
                    ref={notesRef}
                    className="w-full min-h-[100px] p-2 text-sm border rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white/50 resize-y"
                    placeholder="Add details, instructions, or context..."
                    value={notes}
                    onChange={handleNotesChange}
                />
                <div className="text-[10px] text-gray-400 text-right">Auto-saved</div>
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-700">Attachments</label>
                    <label className="cursor-pointer text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 bg-blue-50 px-2 py-1 rounded transition-colors">
                        {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                        <span>{uploading ? 'Uploading...' : 'Upload'}</span>
                        <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                    </label>
                </div>

                <div className="flex flex-col gap-2 max-h-[150px] overflow-y-auto pr-1">
                    {task?.attachments?.length === 0 && (
                        <div className="text-xs text-gray-400 italic py-2 text-center border border-dashed rounded">No files attached</div>
                    )}
                    {task?.attachments?.map((file: any) => (
                        <div
                            key={file.id}
                            className="group flex items-center justify-between gap-2 p-2 rounded border bg-white hover:border-blue-200 transition-all text-xs"
                        >
                            <a
                                href={`/files/${file.url}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 flex-1 min-w-0 truncate hover:text-blue-600"
                            >
                                <FileIcon className="h-3 w-3 shrink-0 text-gray-400" />
                                <span className="truncate">{file.name}</span>
                            </a>
                            <button
                                type="button"
                                onClick={() => handleDeleteAttachment(file.id)}
                                className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <Trash2 className="h-3 w-3" />
                            </button>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export function TaskDetailsPopover({ editor, taskDateMap }: { editor: Editor | null; taskDateMap: TaskDateMap }) {
    const [activeDetails, setActiveDetails] = useState<TaskSeriesOpenDetailsPayload | null>(null);
    const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
    const [positionShouldAnimate, setPositionShouldAnimate] = useState(false);
    const [contentMotionKey, setContentMotionKey] = useState(0);
    const [contentDirection, setContentDirection] = useState<TaskSeriesNavigationDirection>('next');
    const [contentAtRest, setContentAtRest] = useState(true);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const restoreSelectionRef = useRef<TaskSeriesSelectionSnapshot | null>(null);
    const pendingSaveFlushRef = useRef<null | (() => Promise<void>)>(null);

    const { refs, floatingStyles } = useFloating({
        open: !!activeDetails,
        placement: 'bottom-end',
        strategy: 'fixed',
        whileElementsMounted: autoUpdate,
        middleware: [offset(10), shift({ padding: 16 }), flip({ padding: 16 })],
    });

    useLayoutEffect(() => {
        refs.setReference(anchorElement);
    }, [anchorElement, refs]);

    const registerPendingSaveFlush = useCallback((flushFn: null | (() => Promise<void>)) => {
        pendingSaveFlushRef.current = flushFn;
    }, []);

    const flushPendingEdits = useCallback(async () => {
        await pendingSaveFlushRef.current?.();
    }, []);

    const requestClose = useCallback(
        async (restoreSelection: boolean) => {
            await flushPendingEdits();
            dispatchCloseTaskDetails({ restoreSelection });
        },
        [flushPendingEdits]
    );

    const navigateTaskDetails = useCallback(
        async (direction: TaskSeriesNavigationDirection) => {
            if (!editor || !activeDetails) return;

            await flushPendingEdits();
            openAdjacentTaskDetails(editor, activeDetails.taskPos, direction);
        },
        [activeDetails, editor, flushPendingEdits]
    );

    useLayoutEffect(() => {
        if (!editor || !activeDetails) {
            setAnchorElement(null);
            return;
        }

        setAnchorElement(getTaskDetailsTriggerElement(editor, activeDetails.taskPos));
    }, [activeDetails?.taskPos, editor]);

    useEffect(() => {
        if (!activeDetails) return;
        if (contentAtRest) return;

        const frame = window.requestAnimationFrame(() => {
            setContentAtRest(true);
        });

        return () => {
            window.cancelAnimationFrame(frame);
        };
    }, [activeDetails, contentAtRest]);

    useEffect(() => {
        const handleOpen = (event: Event) => {
            const detail = (event as CustomEvent<TaskSeriesOpenDetailsPayload>).detail;
            if (!detail) return;

            restoreSelectionRef.current = detail.selection;
            setAnchorElement(getTaskDetailsTriggerElement(editor, detail.taskPos));
            setActiveDetails((currentDetails) => {
                const isAdjacentMove = !!currentDetails && currentDetails.taskPos !== detail.taskPos;
                setPositionShouldAnimate(isAdjacentMove);

                if (currentDetails && currentDetails.taskPos !== detail.taskPos) {
                    setContentDirection(detail.taskPos > currentDetails.taskPos ? 'next' : 'previous');
                    setContentAtRest(false);
                    setContentMotionKey((currentKey) => currentKey + 1);
                } else {
                    setContentAtRest(true);
                }

                return detail;
            });
        };

        const handleClose = (event: Event) => {
            const detail = (event as CustomEvent<TaskSeriesCloseDetailsPayload>).detail;
            const shouldRestoreSelection = !!detail?.restoreSelection;

            setActiveDetails(null);
            setAnchorElement(null);
            setPositionShouldAnimate(false);
            setContentAtRest(true);

            const selectionToRestore = restoreSelectionRef.current;
            restoreSelectionRef.current = null;

            if (shouldRestoreSelection) {
                restoreEditorSelection(editor, selectionToRestore);
            }
        };

        window.addEventListener(TASK_SERIES_OPEN_DETAILS_EVENT, handleOpen as EventListener);
        window.addEventListener(TASK_SERIES_CLOSE_DETAILS_EVENT, handleClose as EventListener);

        return () => {
            window.removeEventListener(TASK_SERIES_OPEN_DETAILS_EVENT, handleOpen as EventListener);
            window.removeEventListener(TASK_SERIES_CLOSE_DETAILS_EVENT, handleClose as EventListener);
        };
    }, [editor]);

    const previousTaskTarget = useMemo(() => {
        if (!editor || !activeDetails) return null;
        return findAdjacentTaskDetailsTarget(editor, activeDetails.taskPos, 'previous');
    }, [activeDetails, editor]);

    const nextTaskTarget = useMemo(() => {
        if (!editor || !activeDetails) return null;
        return findAdjacentTaskDetailsTarget(editor, activeDetails.taskPos, 'next');
    }, [activeDetails, editor]);

    useEffect(() => {
        if (!activeDetails || !editor) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;

            if (panelRef.current?.contains(target)) return;
            if (target.closest('[data-task-details-trigger="true"]')) return;

            void requestClose(false);
        };

        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            const targetNode = target instanceof Node ? target : null;
            const targetIsInPanel = !!(targetNode && panelRef.current?.contains(targetNode));
            const targetIsInEditor = !!(targetNode && editor.view.dom.contains(targetNode));
            const targetIsTrigger = !!(target instanceof HTMLElement && target.closest('[data-task-details-trigger="true"]'));

            if (!targetIsInPanel && !targetIsInEditor && !targetIsTrigger) {
                return;
            }

            if (event.key === 'Escape') {
                event.preventDefault();
                void requestClose(true);
                return;
            }

            if (!targetIsInPanel && !targetIsTrigger) {
                return;
            }

            if (matchesTaskSeriesShortcut(event, 'Ctrl-Alt-,')) {
                if (!previousTaskTarget) return;
                event.preventDefault();
                void navigateTaskDetails('previous');
                return;
            }

            if (matchesTaskSeriesShortcut(event, 'Ctrl-Alt-.')) {
                if (!nextTaskTarget) return;
                event.preventDefault();
                void navigateTaskDetails('next');
            }
        };

        document.addEventListener('pointerdown', handlePointerDown, true);
        document.addEventListener('keydown', handleKeyDown, true);

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
            document.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [activeDetails, editor, navigateTaskDetails, nextTaskTarget, previousTaskTarget, requestClose]);

    if (!activeDetails || !anchorElement || typeof document === 'undefined') {
        return null;
    }

    const currentTaskDate = activeDetails.taskId ? taskDateMap[activeDetails.taskId] : undefined;
    const previousShortcutLabel = formatTaskSeriesShortcutLabel('Ctrl-Alt-,');
    const nextShortcutLabel = formatTaskSeriesShortcutLabel('Ctrl-Alt-.');
    const contentStartTransform = contentDirection === 'next' ? 'translateX(18px)' : 'translateX(-18px)';

    return createPortal(
        <div
            ref={refs.setFloating}
            style={{
                ...floatingStyles,
                transition: positionShouldAnimate ? POSITION_TRANSITION : undefined,
            }}
            className="z-50"
        >
            <div
                ref={panelRef}
                role="dialog"
                aria-label="Task Details"
                className="w-80 rounded-xl border border-slate-200 bg-white/95 p-4 shadow-[0_24px_60px_-24px_rgba(15,23,42,0.45)] backdrop-blur-sm"
            >
                <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                        <h4 className="font-medium leading-none">Task Details</h4>
                        <div className="flex items-center gap-1">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 px-2"
                                disabled={!previousTaskTarget}
                                onClick={() => void navigateTaskDetails('previous')}
                            >
                                <ChevronLeft className="h-3.5 w-3.5" />
                                <span>Prev</span>
                                <span className="text-[10px] text-muted-foreground">{previousShortcutLabel}</span>
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 px-2"
                                disabled={!nextTaskTarget}
                                onClick={() => void navigateTaskDetails('next')}
                            >
                                <span>Next</span>
                                <ChevronRight className="h-3.5 w-3.5" />
                                <span className="text-[10px] text-muted-foreground">{nextShortcutLabel}</span>
                            </Button>
                        </div>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-slate-100 bg-slate-50/70">
                        <div
                            key={`${activeDetails.taskId ?? activeDetails.taskPos}-${contentMotionKey}`}
                            className={cn('min-h-[260px] px-3 py-3')}
                            style={{
                                transform: contentAtRest ? 'translateX(0)' : contentStartTransform,
                                transition: CONTENT_TRANSITION,
                            }}
                        >
                            <div className="text-xs text-gray-400 pb-3 border-b mb-3 space-y-1">
                                <div>Task ID: {activeDetails.taskId ? `${activeDetails.taskId.slice(0, 8)}...` : 'Pending ID'}</div>
                                {currentTaskDate?.date && <div>Assigned Date: {currentTaskDate.date.toDateString()}</div>}
                            </div>

                            {activeDetails.taskId ? (
                                <TaskMetadataManager taskId={activeDetails.taskId} registerPendingSaveFlush={registerPendingSaveFlush} />
                            ) : (
                                <div className="p-4 text-xs text-muted-foreground">This task is still getting an ID. Try again in a moment.</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
