// components/task-series/TaskSeriesEditor.tsx
'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { id, tx } from '@instantdb/react';
import { startOfDay, format, parseISO, addDays } from 'date-fns';
import { RRule } from 'rrule';
import { Loader2 } from 'lucide-react';
import { useDebouncedCallback } from 'use-debounce';
import { SlashCommand, slashCommandSuggestion } from './SlashCommand';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import TaskItemExtension, { TaskDateContext } from './TaskItem';

// --- Types (Simplified for brevity, matching your provided types) ---
interface Task {
    id: string;
    text?: string | null;
    indentationLevel?: number;
    order?: number | null;
    isDayBreak?: boolean | null;
    // ... other DB fields (notes, attachments, etc)
    parentTask?: { id: string }[]; // Added to track existing parent
}

interface TaskSeriesEditorProps {
    db: any;
    initialSeriesId?: string | null;
    initialFamilyMemberId?: string | null;
    onClose?: () => void;
}

type DropState = {
    isActive: boolean;
    top: number;
    left: number;
    width: number;
    indentationLevel: number;
};

const ensureDate = (value: any): Date | null => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string') return parseISO(value);
    // Fallback: allow timestamp or other serializable forms
    return new Date(value);
};

const TaskSeriesEditor: React.FC<TaskSeriesEditorProps> = ({ db, initialSeriesId, onClose }) => {
    const { toast } = useToast();

    // If initialSeriesId is present, we know it exists in DB
    const [hasPersisted, setHasPersisted] = useState<boolean>(!!initialSeriesId);

    const [seriesId] = useState<string>(initialSeriesId || id());
    const [isSaving, setIsSaving] = useState(false);

    // Map stores object { label, date } instead of just string
    const [taskDateMap, setTaskDateMap] = useState<Record<string, { label: string; date: Date } | undefined>>({});

    const [taskSeriesName, setTaskSeriesName] = useState('');
    const [description, setDescription] = useState('');
    const [startDate, setStartDate] = useState<Date>(startOfDay(new Date()));
    const [targetEndDate, setTargetEndDate] = useState<Date | null>(null);

    // Links
    const [familyMemberId, setFamilyMemberId] = useState<string | null>(null);
    const [scheduledActivityId, setScheduledActivityId] = useState<string | null>(null);

    // --- Drag and Drop State ---
    const editorRef = useRef<HTMLDivElement>(null);
    const [dropState, setDropState] = useState<DropState | null>(null);
    const [isDraggingGlobal, setIsDraggingGlobal] = useState(false);

    // --- Cursor Hiding Logic ---
    useEffect(() => {
        if (isDraggingGlobal) {
            // Force cursor to grabbing globally to hide text cursor and indicate drag
            document.body.style.cursor = 'grabbing';
            document.body.classList.add('select-none'); // Optional: helps prevent text selection
        } else {
            document.body.style.cursor = '';
            document.body.classList.remove('select-none');
        }
        return () => {
            document.body.style.cursor = '';
            document.body.classList.remove('select-none');
        };
    }, [isDraggingGlobal]);

    // --- 1. Fetch Data ---
    const { data, isLoading } = db.useQuery({
        taskSeries: {
            $: { where: { id: seriesId } },
            tasks: {
                parentTask: {}, // Fetch parentTask so we can unlink if hierarchy changes
            },
            familyMember: {}, // link: taskSeriesOwner
            scheduledActivity: {}, // link: taskSeriesScheduledActivity (chores)
        },
        familyMembers: {
            $: { order: { order: 'asc' } },
        },
        chores: {
            $: {}, // you can later add filters if this is too broad
        },
    });

    const dbTasks: Task[] = data?.taskSeries?.[0]?.tasks || [];
    const seriesData = data?.taskSeries?.[0];

    // Keep a ref of seriesData so debouncedSave can access the *current* DB state
    // to know what to unlink without needing to be recreated on every render.
    const seriesDataRef = useRef(seriesData);
    useEffect(() => {
        seriesDataRef.current = seriesData;
    }, [seriesData]);

    // Load series metadata
    useEffect(() => {
        if (seriesData) {
            setHasPersisted(true); // confirms this series exists in DB

            setTaskSeriesName(seriesData.name || '');
            setDescription(seriesData.description || '');

            const start = ensureDate(seriesData.startDate);
            if (start) {
                setStartDate(startOfDay(start));
            }

            const target = ensureDate(seriesData.targetEndDate);
            if (target) {
                setTargetEndDate(startOfDay(target));
            } else {
                setTargetEndDate(null);
            }

            // Linked family member & chore, if present
            if (seriesData.familyMember) {
                setFamilyMemberId(seriesData.familyMember.id);
            } else {
                setFamilyMemberId(null);
            }

            if (seriesData.scheduledActivity) {
                setScheduledActivityId(seriesData.scheduledActivity.id);
            } else {
                setScheduledActivityId(null);
            }
        }
    }, [seriesData]);

    // --- 3. Date Calculation Logic (RRule) ---
    // Ref pattern to handle closure staleness in useEditor's onUpdate
    const calculateDatesRef = useRef<(json: JSONContent) => void>(() => {});

    const calculateDates = useCallback(
        (json: JSONContent) => {
            if (!json.content) return;

            const map: Record<string, { label: string; date: Date } | undefined> = {};

            // 1. Determine Logic Strategy
            // Do we use a Chores RRule? Or Manual Relative Days?
            const chore = scheduledActivityId ? data?.chores?.find((c: any) => c.id === scheduledActivityId) : null;
            const useRRule = chore && chore.rrule;

            try {
                let rruleObj: RRule | null = null;
                let currentDate: Date = startDate || startOfDay(new Date());
                let dayCounter = 1; // 1-based index for "Day 1", "Day 2", etc.

                if (useRRule) {
                    // --- RRULE STRATEGY ---
                    const rruleOptions = RRule.parseString(chore.rrule);
                    rruleOptions.dtstart = startDate; // Override start date
                    rruleObj = new RRule(rruleOptions);

                    // Get first valid date
                    const firstDate = rruleObj.after(new Date(startDate.getTime() - 24 * 60 * 60 * 1000), true);
                    if (firstDate) {
                        currentDate = firstDate;
                    }
                } else {
                    // --- MANUAL STRATEGY ---
                    // currentDate defaults to startDate (or today).
                    // We will increment dayCounter on breaks.
                }

                let lastDisplayedDateLabel = '';

                json.content.forEach((node) => {
                    if (node.type === 'taskItem' && node.attrs) {
                        const { id, isDayBreak } = node.attrs;

                        if (isDayBreak) {
                            // --- HANDLE BREAK ---
                            if (useRRule && rruleObj) {
                                // Advance to next scheduled instance
                                const next = rruleObj.after(currentDate);
                                if (next) currentDate = next;
                            } else {
                                // Advance counter
                                dayCounter++;
                                // We increment the date object too, assuming consecutive days for "Day 2", etc.
                                currentDate = addDays(currentDate, 1);
                            }

                            // Breaks get the internal date but no label
                            map[id] = { label: '', date: currentDate };
                        } else {
                            // --- STANDARD TASK ---
                            let dateLabel = '';

                            if (useRRule) {
                                dateLabel = format(currentDate, 'E, M/d');
                            } else {
                                // Manual Strategy
                                if (dayCounter === 1) {
                                    // First section shows the actual date
                                    dateLabel = format(currentDate, 'E, M/d');
                                } else {
                                    // Successive sections show "Day X"
                                    dateLabel = `Day ${dayCounter}`;
                                }
                            }

                            const showLabel = dateLabel !== lastDisplayedDateLabel;

                            map[id] = {
                                label: showLabel ? dateLabel : '',
                                date: currentDate,
                            };

                            if (showLabel) {
                                lastDisplayedDateLabel = dateLabel;
                            }
                        }
                    }
                });

                setTaskDateMap(map);
            } catch (err) {
                console.error('Failed to calculate dates', err);
                setTaskDateMap({});
            }
        },
        [startDate, scheduledActivityId, data?.chores]
    );

    // Keep the ref updated with the latest callback
    useEffect(() => {
        calculateDatesRef.current = calculateDates;
    }, [calculateDates]);

    // --- 2. Editor Setup ---
    const editor = useEditor({
        immediatelyRender: false,
        extensions: [
            StarterKit.configure({
                paragraph: false,
                bulletList: false,
                orderedList: false,
                listItem: false,

                // Disable other blocks to keep the schema clean/flat
                blockquote: false,
                codeBlock: false,
                heading: false,
                horizontalRule: false,

                // Disables the default black drop indicator line
                dropcursor: false,
                // --------------------

                // Note: We implicitly KEEP 'document', 'text', 'bold', 'history', etc.
            }),
            TaskItemExtension,
            // Add Slash Command Extension
            SlashCommand.configure({
                suggestion: slashCommandSuggestion,
            }),
        ],
        content: { type: 'doc', content: [] },
        editorProps: {
            attributes: {
                class: 'focus:outline-none min-h-[300px] p-4',
            },
            // prevent native drag/drop caret & insertion behavior
            handleDOMEvents: {
                dragover: (_view, event) => {
                    event.preventDefault();
                    return true;
                },
                drop: (_view, event) => {
                    event.preventDefault();
                    return true;
                },
            },
        },
        onUpdate: ({ editor }) => {
            // 1. DATE CALCULATION
            requestAnimationFrame(() => {
                // Use the ref to ensure we use the latest calculateDates logic (with latest startDate/activity)
                calculateDatesRef.current(editor.getJSON());
            });

            // 2. SAVE
            debouncedSave(editor.getJSON());
        },
    });

    // Trigger calculation when dependencies change (so dates update without typing)
    useEffect(() => {
        if (editor && !editor.isDestroyed) {
            calculateDates(editor.getJSON());
        }
    }, [calculateDates, editor]);

    // --- 3. Drag and Drop Logic ---
    useEffect(() => {
        if (!editor) return;

        return monitorForElements({
            onDragStart: ({ source }) => {
                if (source.data.type !== 'task-item') return;
                setIsDraggingGlobal(true);
                editor.commands.blur(); // hide caret while dragging
            },
            onDrag: ({ location, source }) => {
                if (source.data.type !== 'task-item') return;

                const container = editorRef.current;
                if (!container) return;

                const clientX = location.current.input.clientX;
                const clientY = location.current.input.clientY;

                // 1. Identify Target
                // Try direct hit first
                let targetElement = document.elementFromPoint(clientX, clientY)?.closest('[data-task-id]') as HTMLElement | null;

                // GAP FIX: If no direct hit, find nearest task vertically within container
                if (!targetElement) {
                    const elements = Array.from(container.querySelectorAll('[data-task-id]'));
                    let closest: HTMLElement | null = null;
                    let minDistance = Infinity;

                    for (const el of elements) {
                        const rect = el.getBoundingClientRect();
                        // Distance to vertical center of the element
                        const dist = Math.abs(clientY - (rect.top + rect.height / 2));
                        if (dist < minDistance) {
                            minDistance = dist;
                            closest = el as HTMLElement;
                        }
                    }
                    // Only snap if we are relatively close (e.g. within 50px) to prevent snapping from miles away
                    if (closest && minDistance < 100) {
                        targetElement = closest;
                    }
                }

                if (!targetElement) {
                    setDropState(null);
                    return;
                }

                // 2. Calculate Edges (Top vs Bottom)
                const rect = targetElement.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const isTop = clientY < midY;

                // 3. Determine "Preceding Node" (The parent we are checking against)
                // If dropping Top: predecessor is the target's previous sibling.
                // If dropping Bottom: predecessor is the target itself.
                let precedingElement: HTMLElement | null = null;

                if (isTop) {
                    // If we are dropping on the top edge of a task,
                    // effective predecessor is the previous task in the list.
                    // We loop previousElementSibling to skip over non-task nodes (like drag previews)
                    let prev = targetElement.previousElementSibling;
                    while (prev) {
                        if (prev.hasAttribute('data-task-id')) {
                            precedingElement = prev as HTMLElement;
                            break;
                        }
                        prev = prev.previousElementSibling;
                    }
                } else {
                    // If dropping on bottom edge, this task itself is the predecessor
                    precedingElement = targetElement;
                }

                // 4. Calculate Max Indentation
                // Max is predecessor's level + 1.
                // If no predecessor (top of list), Max is 0.
                let maxIndent = 0;
                if (precedingElement) {
                    const prevLevel = parseInt(precedingElement.getAttribute('data-indent-level') || '0', 10);
                    maxIndent = prevLevel + 1;
                }

                // 5. Calculate Desired Indentation from Horizontal Mouse Position
                const INDENT_ZERO_OFFSET = 116; // w-20(80) + pr-3(12) + handle(24)
                const INDENT_WIDTH = 32; // 2rem

                const mouseXRelative = clientX - containerRect.left;
                const rawIndent = Math.floor((mouseXRelative - INDENT_ZERO_OFFSET) / INDENT_WIDTH);

                // Clamp indentation between 0 and allowed Max
                const finalIndent = Math.max(0, Math.min(rawIndent, maxIndent));

                // 6. Set Drop State
                const visualLeft = INDENT_ZERO_OFFSET + finalIndent * INDENT_WIDTH;

                // Align line exactly with the gap
                // If Top: line is at top of rect. If Bottom: line is at bottom of rect.
                const relativeTop = (isTop ? rect.top : rect.bottom) - containerRect.top;

                setDropState({
                    isActive: true,
                    top: relativeTop,
                    left: visualLeft,
                    width: containerRect.width - visualLeft - 40,
                    indentationLevel: finalIndent,
                });
            },
            onDrop: ({ location, source }) => {
                setIsDraggingGlobal(false);
                setDropState(null);
                if (source.data.type !== 'task-item') return;
                if (!editor || editor.isDestroyed) return;

                const draggedId = source.data.id as string;

                // Re-calculate drop target (same logic as onDrag)
                const container = editorRef.current;
                if (!container) return;

                const clientX = location.current.input.clientX;
                const clientY = location.current.input.clientY;

                // --- REPEAT TARGET FINDING LOGIC (Must match onDrag) ---
                let targetElement = document.elementFromPoint(clientX, clientY)?.closest('[data-task-id]') as HTMLElement | null;

                if (!targetElement) {
                    const elements = Array.from(container.querySelectorAll('[data-task-id]'));
                    let closest: HTMLElement | null = null;
                    let minDistance = Infinity;
                    for (const el of elements) {
                        const rect = el.getBoundingClientRect();
                        const dist = Math.abs(clientY - (rect.top + rect.height / 2));
                        if (dist < minDistance) {
                            minDistance = dist;
                            closest = el as HTMLElement;
                        }
                    }
                    if (closest && minDistance < 100) targetElement = closest;
                }
                // -------------------------------------------------------

                if (!targetElement) return;

                const targetId = targetElement.getAttribute('data-task-id');
                if (targetId === draggedId) return;

                // --- Re-calculate logic (must match onDrag exactly) ---
                const rect = targetElement.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const isTop = clientY < midY;

                // --- REPEAT INDENTATION LOGIC ---
                let precedingElement: HTMLElement | null = null;
                if (isTop) {
                    let prev = targetElement.previousElementSibling;
                    while (prev) {
                        if (prev.hasAttribute('data-task-id')) {
                            precedingElement = prev as HTMLElement;
                            break;
                        }
                        prev = prev.previousElementSibling;
                    }
                } else {
                    precedingElement = targetElement;
                }

                let maxIndent = 0;
                if (precedingElement) {
                    const prevLevel = parseInt(precedingElement.getAttribute('data-indent-level') || '0', 10);
                    maxIndent = prevLevel + 1;
                }

                const INDENT_ZERO_OFFSET = 116;
                const INDENT_WIDTH = 32;
                const mouseXRelative = clientX - containerRect.left;
                const rawIndent = Math.floor((mouseXRelative - INDENT_ZERO_OFFSET) / INDENT_WIDTH);
                const finalIndent = Math.max(0, Math.min(rawIndent, maxIndent));
                // -----------------------------------------------------

                // Execute Transaction
                editor
                    .chain()
                    .command(({ state, dispatch, tr }) => {
                        const { doc } = state;
                        let draggedPos: number | null = null;
                        let draggedNode: any = null;
                        let targetPos: number | null = null;

                        // Find positions
                        doc.descendants((node, pos) => {
                            if (node.attrs.id === draggedId) {
                                draggedPos = pos;
                                draggedNode = node;
                            }
                            if (node.attrs.id === targetId) {
                                targetPos = pos;
                            }
                        });

                        if (draggedPos === null || targetPos === null || !draggedNode) return false;

                        // 1. Determine Insertion Point
                        // If isTop, insert before target. If !isTop, insert after target.
                        // We must account for node size.
                        const targetNode = doc.nodeAt(targetPos);
                        if (!targetNode) return false;

                        let insertPos = isTop ? targetPos : targetPos + targetNode.nodeSize;

                        // Adjust insertPos if we are deleting the dragged node *before* the insertion point
                        // (Logic simplifies if we delete first, but we need to map position)

                        // 2. Delete Dragged Node
                        tr.delete(draggedPos, draggedPos + draggedNode.nodeSize);

                        // Map insertion position
                        const mappedInsertPos = tr.mapping.map(insertPos);

                        tr.insert(
                            mappedInsertPos,
                            draggedNode.type.create(
                                {
                                    ...draggedNode.attrs,
                                    indentationLevel: finalIndent,
                                },
                                draggedNode.content
                            )
                        );

                        if (dispatch) dispatch(tr);
                        return true;
                    })
                    .run();
            },
        });
    }, [editor]);

    // --- 4. Hydration (DB -> TipTap) ---
    // We use a ref to ensure we only hydrate ONCE when data is first available
    const hasHydrated = React.useRef(false);

    useEffect(() => {
        if (editor && !isLoading && !hasHydrated.current) {
            if (dbTasks.length > 0) {
                // Sort by order
                const sortedTasks = [...dbTasks].sort((a, b) => (a.order || 0) - (b.order || 0));

                // Convert to TipTap JSON
                const content = sortedTasks.map((t) => ({
                    type: 'taskItem',
                    attrs: {
                        id: t.id,
                        indentationLevel: t.indentationLevel || 0,
                        // STRICT HYDRATION: Only true if DB says true.
                        // If DB has text: "-" but isDayBreak is false, it loads as a normal task with text "-".
                        isDayBreak: t.isDayBreak || false,
                    },
                    content: t.text ? [{ type: 'text', text: t.text }] : undefined,
                }));

                editor.commands.setContent({ type: 'doc', content });
            } else {
                // Initialize with one empty task if new
                editor.commands.setContent({
                    type: 'doc',
                    content: [{ type: 'taskItem', attrs: { id: id(), indentationLevel: 0, isDayBreak: false } }],
                });
            }

            hasHydrated.current = true;
            // Initial date calc
            calculateDates(editor.getJSON());
        }
    }, [editor, isLoading, dbTasks, calculateDates]);

    // --- 5. Saving (TipTap -> DB) ---
    const debouncedSave = useDebouncedCallback(async (json: JSONContent) => {
        if (!json.content) return;

        // 0. Decide if there is any meaningful content
        const hasMetadataContent = taskSeriesName.trim().length > 0 || description.trim().length > 0;

        let hasTaskContent = false;
        for (const node of json.content) {
            if (node.type !== 'taskItem' || !node.content) continue;
            const textNode = node.content[0];
            if (textNode?.type === 'text' && textNode.text && textNode.text.trim().length > 0) {
                hasTaskContent = true;
                break;
            }
        }

        const hasAnyContent = hasMetadataContent || hasTaskContent;

        // If this is a new series and literally nothing has been entered yet,
        // don't write anything to InstantDB.
        if (!hasPersisted && !hasAnyContent) {
            return;
        }

        setIsSaving(true);

        const transactions: any[] = [];
        const currentIds = new Set<string>();

        // Stack to track hierarchy: Array of { id, level }
        const stack: { id: string; level: number }[] = [];

        // 1. Prepare Updates/Inserts for tasks
        json.content.forEach((node, index) => {
            if (node.type !== 'taskItem' || !node.attrs) return;

            const taskId = node.attrs.id || id();
            const isDayBreak = !!node.attrs.isDayBreak;
            const currentLevel = node.attrs.indentationLevel || 0;

            const textContent = isDayBreak ? '' : node.content?.[0]?.text || '';

            currentIds.add(taskId);

            // Note: We aren't saving the calculated date to DB yet, per requirements.
            // When you are ready, you can grab the date from 'taskDateMap' here using taskId.
            const taskData = {
                text: textContent,
                order: index,
                indentationLevel: currentLevel,
                isDayBreak,
                updatedAt: new Date(),
            };

            // Upsert task
            transactions.push(tx.tasks[taskId].update(taskData));

            // Link to series (idempotent)
            transactions.push(tx.taskSeries[seriesId].link({ tasks: taskId }));

            // --- HIERARCHY LOGIC ---
            // 1. Find the parent
            // We look backwards in the stack for the first item with a level LESS than currentLevel
            while (stack.length > 0 && stack[stack.length - 1].level >= currentLevel) {
                stack.pop();
            }

            const parent = stack.length > 0 ? stack[stack.length - 1] : null;

            // 2. Determine if we need to update the parent relationship
            // Check the current DB state for this task's parent
            const existingTaskInDb = dbTasks.find((t) => t.id === taskId);
            const existingParentId = existingTaskInDb?.parentTask?.[0]?.id;

            if (parent) {
                // Should have a parent
                if (existingParentId !== parent.id) {
                    // It changed (or didn't exist).
                    // If it had a different parent before, we should technically unlink it,
                    // but InstantDB 'link' with 'has: one' (forward) usually overwrites or merges.
                    // To be safe and explicit based on best practices for moving items:
                    if (existingParentId) {
                        transactions.push(tx.tasks[taskId].unlink({ parentTask: existingParentId }));
                    }
                    transactions.push(tx.tasks[taskId].link({ parentTask: parent.id }));
                }
            } else {
                // Should NOT have a parent (root level)
                if (existingParentId) {
                    transactions.push(tx.tasks[taskId].unlink({ parentTask: existingParentId }));
                }
            }

            // 3. Push self to stack
            stack.push({ id: taskId, level: currentLevel });
        });

        // 2. Handle Deletions
        // Find tasks in DB that are NOT in the current editor content
        const tasksToDelete = dbTasks.filter((t) => !currentIds.has(t.id));
        tasksToDelete.forEach((t) => {
            transactions.push(tx.tasks[t.id].delete());
            transactions.push(tx.taskSeries[seriesId].unlink({ tasks: t.id }));
        });

        // 3. Update Series Metadata
        const now = new Date();

        const seriesUpdate: any = {
            name: taskSeriesName,
            description,
            updatedAt: now,
        };

        // Dates: InstantDB expects Date objects for i.date()
        if (startDate) {
            seriesUpdate.startDate = startDate;
        }
        if (targetEndDate) {
            seriesUpdate.targetEndDate = targetEndDate;
        } else {
            seriesUpdate.targetEndDate = null;
        }

        // If this is a brand new series, ensure createdAt is set
        if (!seriesData?.createdAt && !hasPersisted) {
            seriesUpdate.createdAt = now;
        }

        transactions.push(tx.taskSeries[seriesId].update(seriesUpdate));

        // Manage links to familyMember and scheduledActivity
        if (familyMemberId) {
            transactions.push(tx.taskSeries[seriesId].link({ familyMember: familyMemberId }));
        } else if (seriesDataRef.current?.familyMember) {
            // Explicitly unlink if null
            transactions.push(tx.taskSeries[seriesId].unlink({ familyMember: seriesDataRef.current.familyMember.id }));
        }

        // Manage links to scheduledActivity
        if (scheduledActivityId) {
            transactions.push(
                tx.taskSeries[seriesId].link({
                    scheduledActivity: scheduledActivityId,
                })
            );
        } else if (seriesDataRef.current?.scheduledActivity) {
            // Explicitly unlink if null
            transactions.push(
                tx.taskSeries[seriesId].unlink({
                    scheduledActivity: seriesDataRef.current.scheduledActivity.id,
                })
            );
        }

        try {
            await db.transact(transactions);

            if (!hasPersisted) {
                setHasPersisted(true); // from now on, always save
            }
        } catch (err) {
            console.error('Save failed', err);
            toast({ title: 'Save failed', variant: 'destructive' });
        } finally {
            setIsSaving(false);
        }
    }, 1000);

    // FIX: Flush pending saves when the component unmounts (modal closes)
    useEffect(() => {
        return () => {
            debouncedSave.flush();
        };
    }, [debouncedSave]);

    const triggerSave = useCallback(() => {
        if (editor) {
            debouncedSave(editor.getJSON());
        }
    }, [editor, debouncedSave]);

    // --- Render ---
    if (isLoading && !hasHydrated.current) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="animate-spin" />
            </div>
        );
    }

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Task Series Editor</h1>
                <div className="text-sm text-muted-foreground">{isSaving ? 'Saving...' : 'Saved'}</div>
            </div>

            {/* Header Inputs */}
            <div className="space-y-4 border p-4 rounded-lg bg-card">
                <div>
                    <label className="text-sm font-medium">Series Name</label>
                    <Input
                        value={taskSeriesName}
                        onChange={(e) => {
                            setTaskSeriesName(e.target.value);
                            triggerSave();
                        }}
                        placeholder="7th Grade Math..."
                    />
                </div>

                <div>
                    <label className="text-sm font-medium">Description</label>
                    <textarea
                        className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        rows={3}
                        value={description}
                        onChange={(e) => {
                            setDescription(e.target.value);
                            triggerSave();
                        }}
                        placeholder="Describe this task series (e.g., full 7th grade math curriculum)..."
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm font-medium">Assignee</label>
                        <select
                            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={familyMemberId || ''}
                            onChange={(e) => {
                                setFamilyMemberId(e.target.value || null);
                                triggerSave();
                            }}
                        >
                            <option value="">Unassigned</option>
                            {data?.familyMembers?.map((fm: any) => (
                                <option key={fm.id} value={fm.id}>
                                    {fm.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="text-sm font-medium">Scheduled Activity</label>
                        <select
                            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={scheduledActivityId || ''}
                            onChange={(e) => {
                                setScheduledActivityId(e.target.value || null);
                                triggerSave();
                            }}
                        >
                            <option value="">Not linked</option>
                            {data?.chores?.map((chore: any) => (
                                <option key={chore.id} value={chore.id}>
                                    {chore.title}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="text-sm font-medium">Start Date</label>
                        <Input
                            type="date"
                            value={startDate ? format(startDate, 'yyyy-MM-dd') : ''}
                            onChange={(e) => {
                                if (e.target.value) {
                                    setStartDate(startOfDay(parseISO(e.target.value)));
                                    triggerSave();
                                }
                            }}
                        />
                    </div>

                    <div>
                        <label className="text-sm font-medium">Target End Date (optional)</label>
                        <Input
                            type="date"
                            value={targetEndDate ? format(targetEndDate, 'yyyy-MM-dd') : ''}
                            onChange={(e) => {
                                if (e.target.value) {
                                    setTargetEndDate(startOfDay(parseISO(e.target.value)));
                                } else {
                                    setTargetEndDate(null);
                                }
                                triggerSave();
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* FIX: Added onDragOver to prevent Default (Native) drop behavior 
               This prevents the "black lines" / native insertion cursor from appearing.
            */}
            <div
                ref={editorRef}
                className="border rounded-lg bg-background shadow-sm min-h-[500px] flex flex-col relative"
                onDragOver={(e) => e.preventDefault()}
            >
                {dropState && dropState.isActive && (
                    <div
                        className="absolute pointer-events-none z-50 transition-all duration-75 ease-out"
                        style={{
                            top: dropState.top,
                            left: dropState.left,
                            width: dropState.width,
                        }}
                    >
                        <div className="border-t-2 border-blue-500 w-full relative">
                            <div className="absolute -left-1 -top-[5px] h-2.5 w-2.5 rounded-full bg-blue-500" />
                        </div>
                    </div>
                )}

                <div className="bg-muted/40 px-4 py-2 border-b text-xs font-medium text-muted-foreground flex">
                    <div className="w-20 text-right pr-3">Date</div>
                    <div>Task</div>
                </div>

                <TaskDateContext.Provider value={taskDateMap}>
                    <div style={isDraggingGlobal ? { caretColor: 'transparent' } : undefined}>
                        <EditorContent editor={editor} />
                    </div>
                </TaskDateContext.Provider>
            </div>

            {onClose && (
                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>
                        Close
                    </Button>
                </div>
            )}
        </div>
    );
};

export default TaskSeriesEditor;
