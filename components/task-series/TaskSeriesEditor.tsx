// components/task-series/TaskSeriesEditor.tsx
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { init, tx, id } from '@instantdb/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Info, AlertTriangle, PlusCircle, Trash2, Settings, Save, Edit, Check } from 'lucide-react';
import { format, parseISO, isValid, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import type { AppSchema } from '@/instant.schema';
import TaskItem from './TaskItem';

const INDENT_CHAR_EQUIVALENT = 4; // Assume 1 indent level = 4 characters visually

// Types based on V1 schema
type FamilyMember = AppSchema['entities']['familyMembers'];
type Chore = AppSchema['entities']['chores'];
type TaskSeries = AppSchema['entities']['taskSeries'];
// type Task = AppSchema['entities']['tasks'];
type TaskAttachment = AppSchema['entities']['taskAttachments'];

interface Task {
    id: string;
    text?: string | null;
    order?: number | null;
    isDayBreak?: boolean | null;
    overrideWorkAhead?: boolean | null;
    notes?: string | null;
    specificTime?: string | null;
    createdAt?: string | null; // Assuming ISO string from DB
    updatedAt?: string | null; // Assuming ISO string from DB
    parentTask?: Array<{ id: string; $type: 'tasks' }>;
    prerequisites?: Array<{ id: string; $type: 'tasks' }>;
    subsequentTasks?: Array<{ id: string; $type: 'tasks' }>;
    attachments?: Array<{ id: string; $type: 'taskAttachments' }>;
    taskSeries?: Array<{ id: string; $type: 'taskSeries' }>;
}

// Interface for tasks managed in the UI state
interface UITask {
    id: string; // Stable ID for the UI session, maps to DB task ID
    text: string;
    indentationLevel: number;
    isDayBreak: boolean;
    // parentId: string | null; // We'll determine this dynamically or store it
    // Add other UI-specific states if needed, like `isEditingText: boolean`
}

interface TaskSeriesEditorProps {
    db: any; // InstantDB instance
    initialSeriesId?: string | null; // For editing existing series
    initialFamilyMemberId?: string | null; // Pre-select family member if provided
    onClose?: () => void; // Optional callback for when "Finished" or "Cancel" is clicked
}

const TaskSeriesEditor: React.FC<TaskSeriesEditorProps> = ({ db: propDb, initialSeriesId = null, initialFamilyMemberId = null, onClose }) => {
    const db = propDb;
    const { toast } = useToast();

    const [isEditing, setIsEditing] = useState(!!initialSeriesId);
    const [seriesId, setSeriesId] = useState<string>(initialSeriesId || id());

    // States for Task Series Details
    const [taskSeriesName, setTaskSeriesName] = useState('');
    const [description, setDescription] = useState('');
    const [selectedFamilyMemberId, setSelectedFamilyMemberId] = useState<string | null>(initialFamilyMemberId);
    const [linkedScheduledActivityId, setLinkedScheduledActivityId] = useState<string | null>(null);
    const [startDate, setStartDate] = useState<Date | undefined>(startOfDay(new Date()));
    const [targetEndDate, setTargetEndDate] = useState<Date | undefined>(undefined);
    const [workAheadAllowed, setWorkAheadAllowed] = useState(true);
    const [breakType, setBreakType] = useState<'immediate' | 'specificDate' | 'delay'>('immediate');
    const [breakStartDate, setBreakStartDate] = useState<Date | undefined>(undefined);
    const [breakDelayValue, setBreakDelayValue] = useState<string>('');
    const [breakDelayUnit, setBreakDelayUnit] = useState<'days' | 'weeks' | 'months'>('days');

    // State for Task List Editor
    const [uiTasks, setUiTasks] = useState<UITask[]>([]);
    const [dbTasks, setDbTasks] = useState<Task[]>([]);
    const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
    const [desiredVisualCursorPos, setDesiredVisualCursorPos] = useState<number | null>(null);
    const [cursorEntryDirection, setCursorEntryDirection] = useState<'up' | 'down' | null>(null); // NEW

    if (!db) {
        //fixes bug where useQuery() was running before hydration completed, or before the component tree could use the db context correctly, causing useQuery to come up empty
        return <div>Loading DB...</div>;
    }

    // Data fetching
    const { data: familyMembersData, isLoading: isLoadingFamilyMembers } = db.useQuery({
        familyMembers: {},
    });
    const familyMembers = familyMembersData?.familyMembers || [];

    const { data: choresData, isLoading: isLoadingChores } = db.useQuery(
        selectedFamilyMemberId
            ? {
                  chores: {
                      $: { where: { 'assignees.id': selectedFamilyMemberId } },
                      assignees: {},
                  },
              }
            : null // Don't query if no family member is selected
    );
    const availableChores = choresData?.chores || [];

    // --- Helper function to parse task list text ---
    interface ParsedTask {
        id: string;
        text: string;
        indentationLevel: number;
        isDayBreak: boolean;
        originalLineNumber: number;
        parentId: string | null;
    }

    const parseTaskListText = (text: string): ParsedTask[] => {
        const lines = text.split('\n');
        const parsedTasks: ParsedTask[] = [];
        const parentCanditates: Array<{ id: string; indentationLevel: number }> = [];

        lines.forEach((line, index) => {
            const trimmedLine = line.trim();
            const dayBreakChars = ['~', '-', '='];
            const isDayBreak = dayBreakChars.includes(trimmedLine) && line.length === trimmedLine.length;

            let indentationLevel = 0;
            const match = line.match(/^(\s*)/);
            if (match) {
                // Simple tab-based indentation for V1: count tabs
                indentationLevel = line.match(/^\t*/)?.[0]?.length || 0;
                // Or for spaces (e.g., 2 spaces per indent level)
                // indentationLevel = Math.floor((line.match(/^ */)?.[0]?.length || 0) / 2);
            }

            const taskText = isDayBreak ? '' : line.substring(indentationLevel);
            const taskId = id();

            let parentId: string | null = null;
            while (parentCanditates.length > 0 && parentCanditates[parentCanditates.length - 1].indentationLevel >= indentationLevel) {
                parentCanditates.pop();
            }
            // If there's a candidate left, it's the parent
            if (parentCanditates.length > 0) {
                parentId = parentCanditates[parentCanditates.length - 1].id;
            }

            parsedTasks.push({
                id: taskId, // Assign the generated ID
                text: taskText,
                indentationLevel,
                isDayBreak,
                originalLineNumber: index,
                parentId: parentId,
            });

            // If not a day break and not empty, add to candidates for next tasks' parent
            if (!isDayBreak && taskText.trim() !== '') {
                parentCanditates.push({ id: taskId, indentationLevel: indentationLevel });
            }
        });
        return parsedTasks;
    };

    const handleTaskTextChange = (taskId: string, newText: string) => {
        setUiTasks((prevTasks) => prevTasks.map((t) => (t.id === taskId ? { ...t, text: newText } : t)));
        // Potentially debounce this or rely on a less frequent autoSave trigger for text changes within a task
        // For now, let's assume individual task input blurs or a main save button will handle persisting this.
        // If immediate auto-save on text change is needed, call handleImmediateAutoSave() here, possibly debounced.
    };

    const handlePressEnter = (currentTaskId: string, currentTaskText: string, cursorPos: number) => {
        const currentIndex = uiTasks.findIndex((t) => t.id === currentTaskId);
        if (currentIndex === -1) return;

        const currentTask = uiTasks[currentIndex];

        if (cursorPos === 0) {
            // Case 1: Enter at the beginning
            const newUiTask: UITask = {
                id: id(),
                text: '',
                indentationLevel: currentTask.indentationLevel,
                isDayBreak: false,
            };
            setUiTasks((prevTasks) => [
                ...prevTasks.slice(0, currentIndex),
                newUiTask,
                ...prevTasks.slice(currentIndex), // Keep the original task
            ]);
            setFocusedTaskId(currentTaskId);
            setDesiredVisualCursorPos(null);
            setCursorEntryDirection(null);
        } else {
            // Case 2: Enter in the middle or at the end
            const textBefore = currentTaskText.substring(0, cursorPos);
            const textAfter = currentTaskText.substring(cursorPos);

            const newUiTask: UITask = {
                id: id(),
                text: textAfter,
                indentationLevel: currentTask.indentationLevel,
                isDayBreak: false,
            };

            setUiTasks((prevTasks) => [
                ...prevTasks.slice(0, currentIndex), // All tasks before
                { ...currentTask, text: textBefore }, // The updated current task
                newUiTask, // The new task
                ...prevTasks.slice(currentIndex + 1), // All tasks after
            ]);

            setFocusedTaskId(newUiTask.id);
            // Set desired visual pos to the start of the new task (accounting for indent)
            const newVisualPos = newUiTask.indentationLevel * INDENT_CHAR_EQUIVALENT;
            setDesiredVisualCursorPos(newVisualPos);
            setCursorEntryDirection('down');
        }
    };

    const handlePasteTasks = (currentTaskId: string, pastedText: string, currentTaskTextBeforePaste: string) => {
        const lines = pastedText.split('\n');
        if (lines.length === 0) return;

        const currentTaskIndex = uiTasks.findIndex((t) => t.id === currentTaskId);
        if (currentTaskIndex === -1) return;

        const currentTask = uiTasks[currentTaskIndex];
        let lastFocusedId = currentTask.id;

        // Update the current task with the first line of pasted text
        // For simplicity, appending. Could also replace or insert at cursor.
        const updatedFirstTaskText = currentTaskTextBeforePaste + lines[0];
        let newUiTasks = uiTasks.map((t) => (t.id === currentTaskId ? { ...t, text: updatedFirstTaskText } : t));

        if (lines.length > 1) {
            const tasksToInsert: UITask[] = [];
            for (let i = 1; i < lines.length; i++) {
                const newTask: UITask = {
                    id: id(),
                    text: lines[i],
                    indentationLevel: currentTask.indentationLevel, // Inherit indentation from current task
                    isDayBreak: false, // Pasted lines are not day breaks by default
                };
                tasksToInsert.push(newTask);
                lastFocusedId = newTask.id; // Keep track of the last task added for focus
            }

            newUiTasks = [...newUiTasks.slice(0, currentTaskIndex + 1), ...tasksToInsert, ...newUiTasks.slice(currentTaskIndex + 1)];
        }

        setUiTasks(newUiTasks);
        setFocusedTaskId(lastFocusedId);
        setCursorEntryDirection('down');
        handleImmediateAutoSave();
    };

    const handleDeleteTask = async (taskId: string) => {
        // Make it async
        const taskToDelete = uiTasks.find((t) => t.id === taskId);
        if (!taskToDelete) return;

        // Optimistically update UI first
        const newUiTasks = uiTasks.filter((t) => t.id !== taskId);
        setUiTasks(newUiTasks);

        // Focus management after deletion
        const taskIndex = uiTasks.findIndex((t) => t.id === taskId);
        if (newUiTasks.length === 0) {
            setFocusedTaskId(null);
        } else if (taskIndex > 0 && newUiTasks[taskIndex - 1]) {
            setFocusedTaskId(newUiTasks[taskIndex - 1].id);
            setCursorEntryDirection('up');
        } else if (newUiTasks.length > 0) {
            // Deleted the first item, focus the new first item
            setFocusedTaskId(newUiTasks[0].id);
            setCursorEntryDirection('down');
        }

        const transactions = [
            tx.tasks[taskId].delete(),
            tx.taskSeries[seriesId].unlink({ tasks: taskId }),
            // TODO: If tasks can be parents/prerequisites, handle unlinking those relationships too
        ];

        try {
            await db.transact(transactions);
            toast({
                title: 'Task Deleted',
                description: `Task "${taskToDelete.text || 'Untitled'}" removed.`,
            });
            setDbTasks((prevDbTasks) => prevDbTasks.filter((t) => t.id !== taskId));
        } catch (error: any) {
            console.error('Failed to delete task from DB:', error);
            toast({
                title: 'Error Deleting Task',
                description: error.message,
                variant: 'destructive',
            });
            setUiTasks(uiTasks);
            if (taskIndex !== -1 && uiTasks[taskIndex]) {
                setFocusedTaskId(uiTasks[taskIndex].id);
            }
        }
    };

    const handleIndentTask = (taskId: string) => {
        setUiTasks((prevTasks) => {
            const taskIndex = prevTasks.findIndex((t) => t.id === taskId);
            if (taskIndex === -1) return prevTasks;

            const targetTask = prevTasks[taskIndex];
            const originalLevel = targetTask.indentationLevel;

            // Constraint 1: Is it the first task?
            if (taskIndex === 0) return prevTasks;

            const prevTask = prevTasks[taskIndex - 1];

            // Constraint 2: Is the preceding task a "Day Break"?
            if (prevTask.isDayBreak) return prevTasks;

            // Constraint 3: Is it already over-indented?
            if (originalLevel >= prevTask.indentationLevel + 1) {
                return prevTasks;
            }

            // Identify the branch
            const branchIndices: number[] = [taskIndex];
            for (let i = taskIndex + 1; i < prevTasks.length; i++) {
                if (prevTasks[i].indentationLevel <= originalLevel) {
                    break; // Stop when we hit a sibling or an outdented task
                }
                branchIndices.push(i);
            }

            // Apply the transformation
            const newUiTasks = [...prevTasks]; // Create a mutable copy
            branchIndices.forEach((idx) => {
                const task = newUiTasks[idx];
                newUiTasks[idx] = { ...task, indentationLevel: task.indentationLevel + 1 };
            });

            return newUiTasks;
        });
        handleImmediateAutoSave();
    };

    const handleUnindentTask = (taskId: string) => {
        setUiTasks((prevTasks) => {
            const taskIndex = prevTasks.findIndex((t) => t.id === taskId);
            if (taskIndex === -1) return prevTasks; // Task not found

            const targetTask = prevTasks[taskIndex];
            const originalLevel = targetTask.indentationLevel;

            // Constraint: Check Root Level
            if (originalLevel === 0) return prevTasks;

            // Identify the branch
            const branchIndices: number[] = [taskIndex];
            for (let i = taskIndex + 1; i < prevTasks.length; i++) {
                if (prevTasks[i].indentationLevel <= originalLevel) {
                    break; // Stop when we hit a sibling or an outdented task
                }
                branchIndices.push(i);
            }

            // Apply the transformation
            const newUiTasks = [...prevTasks]; // Create a mutable copy
            branchIndices.forEach((idx) => {
                const task = newUiTasks[idx];
                // Ensure level doesn't go below 0
                newUiTasks[idx] = { ...task, indentationLevel: Math.max(0, task.indentationLevel - 1) };
            });

            return newUiTasks;
        });
        handleImmediateAutoSave();
    };

    const handleFocusTask = (taskId: string) => {
        setFocusedTaskId(taskId);
    };

    const handleBlurTask = (taskId: string) => {
        // Currently no-op; hook if you want blur-based saves
    };

    const handleArrowUp = (taskId: string, cursorPos: number) => {
        const currentIndex = uiTasks.findIndex((t) => t.id === taskId);
        if (currentIndex > 0) {
            const currentTask = uiTasks[currentIndex];
            const visualPos = currentTask.indentationLevel * INDENT_CHAR_EQUIVALENT + cursorPos;
            setDesiredVisualCursorPos(visualPos);
            setCursorEntryDirection('up');

            const prevTaskId = uiTasks[currentIndex - 1].id;
            setFocusedTaskId(prevTaskId); // Switch focus
        }
    };

    const handleArrowDown = (taskId: string, cursorPos: number) => {
        const currentIndex = uiTasks.findIndex((t) => t.id === taskId);
        if (currentIndex < uiTasks.length - 1) {
            const currentTask = uiTasks[currentIndex];
            const visualPos = currentTask.indentationLevel * INDENT_CHAR_EQUIVALENT + cursorPos;
            setDesiredVisualCursorPos(visualPos);
            setCursorEntryDirection('down');

            const nextTaskId = uiTasks[currentIndex + 1].id;
            setFocusedTaskId(nextTaskId); // Switch focus
        }
    };

    const handleFocusClearCursorPos = () => {
        setDesiredVisualCursorPos(null);
        setCursorEntryDirection(null);
    };

    const handleArrowLeftAtStart = (taskId: string) => {
        const currentIndex = uiTasks.findIndex((t) => t.id === taskId);
        if (currentIndex > 0) {
            // Move to the end of the previous task
            const prevTask = uiTasks[currentIndex - 1];
            const visualPos = prevTask.indentationLevel * INDENT_CHAR_EQUIVALENT + prevTask.text.length;
            setDesiredVisualCursorPos(visualPos);
            setCursorEntryDirection('up');
            setFocusedTaskId(prevTask.id);
        }
    };

    const handleArrowRightAtEnd = (taskId: string) => {
        const currentIndex = uiTasks.findIndex((t) => t.id === taskId);
        if (currentIndex < uiTasks.length - 1) {
            // Move to the start of the next task
            const nextTask = uiTasks[currentIndex + 1];
            const visualPos = nextTask.indentationLevel * INDENT_CHAR_EQUIVALENT;
            setDesiredVisualCursorPos(visualPos);
            setCursorEntryDirection('down');
            setFocusedTaskId(nextTask.id);
        }
    };

    const handleBackspaceEmpty = (taskId: string) => {
        // Deleting a task will also handle moving focus
        handleDeleteTask(taskId);
    };

    const handleAddNewTask = () => {
        const newUiTask: UITask = {
            id: id(),
            text: '',
            indentationLevel: 0,
            isDayBreak: false,
        };
        setUiTasks((prevTasks) => [...prevTasks, newUiTask]);
        setFocusedTaskId(newUiTask.id);
        setDesiredVisualCursorPos(0);
        setCursorEntryDirection('down');
    };

    // --- Auto-Save Logic ---
    const autoSave = useCallback(
        async (field?: string, value?: any) => {
            if (!selectedFamilyMemberId && !isEditing) {
                // Don't auto-save a brand new series if no family member is selected yet,
                // as the familyMember link is crucial.
                // However, if it's an existing series being edited, seriesId is known.
                return;
            }

            const seriesData: Partial<TaskSeries> = {
                name: taskSeriesName || `Untitled Series ${format(new Date(), 'yyyy-MM-dd HH:mm')}`,
                description: description,
                startDate: startDate ? startDate.toISOString() : new Date().toISOString(),
                targetEndDate: targetEndDate ? targetEndDate.toISOString() : null,
                workAheadAllowed: workAheadAllowed,
                breakType: breakType,
                breakStartDate: breakStartDate ? breakStartDate.toISOString() : null,
                breakDelayValue: breakDelayValue ? parseInt(breakDelayValue) : null,
                breakDelayUnit: breakDelayValue ? breakDelayUnit : null,
                updatedAt: new Date().toISOString(),
            };

            if (!isEditing && !initialSeriesId) {
                // Only set createdAt for new series
                seriesData.createdAt = new Date().toISOString();
            }

            const transactions: any[] = [];
            transactions.push(tx.taskSeries[seriesId].update(seriesData));

            // Link family member if creating or changing
            if (selectedFamilyMemberId) {
                transactions.push(
                    tx.taskSeries[seriesId].link({
                        familyMember: selectedFamilyMemberId,
                    })
                );
                transactions.push(
                    tx.familyMembers[selectedFamilyMemberId].link({
                        taskSeries: seriesId,
                    })
                );
            }

            // Link scheduled activity
            if (linkedScheduledActivityId) {
                transactions.push(
                    tx.taskSeries[seriesId].link({
                        scheduledActivity: linkedScheduledActivityId,
                    })
                );
                transactions.push(
                    tx.chores[linkedScheduledActivityId].link({
                        taskSeries: seriesId,
                    })
                );
            }

            const parentCandidates: Array<{
                id: string;
                indentationLevel: number;
            }> = [];
            const currentDbTaskIds = new Set(dbTasks.map((dbt) => dbt.id));
            let previousTaskForPrerequisite: UITask | null = null;

            uiTasks.forEach((uiTask, index) => {
                let parentId: string | null = null;
                while (parentCandidates.length > 0 && parentCandidates[parentCandidates.length - 1].indentationLevel >= uiTask.indentationLevel) {
                    parentCandidates.pop();
                }
                if (parentCandidates.length > 0 && uiTask.indentationLevel > parentCandidates[parentCandidates.length - 1].indentationLevel) {
                    parentId = parentCandidates[parentCandidates.length - 1].id;
                }

                const taskData: Partial<Task> = {
                    text: uiTask.text,
                    order: index,
                    isDayBreak: uiTask.isDayBreak,
                    updatedAt: new Date().toISOString(),
                };

                // Set createdAt only if it's a genuinely new task (not in currentDbTaskIds)
                if (!currentDbTaskIds.has(uiTask.id)) {
                    taskData.createdAt = new Date().toISOString();
                }

                transactions.push(tx.tasks[uiTask.id].update(taskData));
                transactions.push(tx.taskSeries[seriesId].link({ tasks: uiTask.id }));

                const originalDbTask = dbTasks.find((dbT) => dbT.id === uiTask.id);
                const oldParentId = originalDbTask?.parentTask?.[0]?.id;

                if (parentId && oldParentId !== parentId) {
                    if (oldParentId) {
                        transactions.push(
                            tx.tasks[uiTask.id].unlink({
                                parentTask: oldParentId,
                            })
                        );
                    }
                    transactions.push(tx.tasks[uiTask.id].link({ parentTask: parentId }));
                } else if (!parentId && oldParentId) {
                    transactions.push(tx.tasks[uiTask.id].unlink({ parentTask: oldParentId }));
                }

                // Handle prerequisites link
                if (!uiTask.isDayBreak && !parentId) {
                    const oldPrerequisites = originalDbTask?.prerequisites?.map((p) => p.id) || [];
                    if (previousTaskForPrerequisite) {
                        if (!oldPrerequisites.includes(previousTaskForPrerequisite.id)) {
                            transactions.push(
                                tx.tasks[uiTask.id].link({
                                    prerequisites: previousTaskForPrerequisite.id,
                                })
                            );
                        }
                        // Unlink any old prerequisites that are not the current `previousTaskForPrerequisite`
                        oldPrerequisites.forEach((oldPrereqId) => {
                            if (oldPrereqId !== previousTaskForPrerequisite!.id) {
                                transactions.push(
                                    tx.tasks[uiTask.id].unlink({
                                        prerequisites: oldPrereqId,
                                    })
                                );
                            }
                        });
                    } else {
                        // This is the first non-day-break, non-child task
                        oldPrerequisites.forEach((oldPrereqId) => {
                            transactions.push(
                                tx.tasks[uiTask.id].unlink({
                                    prerequisites: oldPrereqId,
                                })
                            );
                        });
                    }
                } else if (originalDbTask?.prerequisites && originalDbTask.prerequisites.length > 0) {
                    originalDbTask.prerequisites.forEach((oldPrereq) => {
                        transactions.push(
                            tx.tasks[uiTask.id].unlink({
                                prerequisites: oldPrereq.id,
                            })
                        );
                    });
                }

                if (!uiTask.isDayBreak && uiTask.text.trim() !== '') {
                    parentCandidates.push({
                        id: uiTask.id,
                        indentationLevel: uiTask.indentationLevel,
                    });
                    if (!parentId) {
                        // Update predecessor for next top-level task
                        previousTaskForPrerequisite = uiTask;
                    }
                } else if (uiTask.isDayBreak) {
                    if (!parentId) {
                        // Only reset if it's a top-level daybreak
                        previousTaskForPrerequisite = null;
                    }
                }
            });

            try {
                console.log('Auto-saving TaskSeries:', seriesId, seriesData, 'Transactions:', transactions);
                db.transact(transactions);
                if (!isEditing && !initialSeriesId) {
                    setIsEditing(true); // Mark as editing after first save
                    // If a new series was just created, we might want to update the URL
                    // or notify the parent component, but for now, just set internal state.
                }
                // toast({ title: "Auto-saved!", duration: 2000 });
                // After successful save, update dbTasks to reflect the current state

                const finalParentLookups: Record<string, string | null> = {};
                const parentCandidatesStack: Array<{
                    id: string;
                    indentationLevel: number;
                }> = [];
                uiTasks.forEach((uiTask) => {
                    let determinedParentId: string | null = null;
                    while (
                        parentCandidatesStack.length > 0 &&
                        parentCandidatesStack[parentCandidatesStack.length - 1].indentationLevel >= uiTask.indentationLevel
                    ) {
                        parentCandidatesStack.pop();
                    }
                    if (
                        parentCandidatesStack.length > 0 &&
                        uiTask.indentationLevel > parentCandidatesStack[parentCandidatesStack.length - 1].indentationLevel
                    ) {
                        determinedParentId = parentCandidatesStack[parentCandidatesStack.length - 1].id;
                    }
                    finalParentLookups[uiTask.id] = determinedParentId;
                    if (!uiTask.isDayBreak && uiTask.text.trim() !== '') {
                        parentCandidatesStack.push({
                            id: uiTask.id,
                            indentationLevel: uiTask.indentationLevel,
                        });
                    }
                });

                let lastValidPredecessorIdForDbTasks: string | null = null;
                const newDbTasks: Task[] = uiTasks.map((uiTask, index) => {
                    const originalDbTask = dbTasks.find((dbt) => dbt.id === uiTask.id);
                    const currentParentId = finalParentLookups[uiTask.id];
                    let currentPrerequisiteId: string | null = null;

                    if (!uiTask.isDayBreak && !currentParentId) {
                        currentPrerequisiteId = lastValidPredecessorIdForDbTasks;
                        lastValidPredecessorIdForDbTasks = uiTask.id;
                    } else if (uiTask.isDayBreak && !currentParentId) {
                        lastValidPredecessorIdForDbTasks = null; // Reset prerequisite chain after a top-level daybreak
                    }

                    return {
                        id: uiTask.id,
                        text: uiTask.text,
                        isDayBreak: uiTask.isDayBreak,
                        order: index,
                        createdAt: originalDbTask?.createdAt || new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        parentTask: currentParentId ? [{ id: currentParentId, $type: 'tasks' }] : [],
                        prerequisites: currentPrerequisiteId ? [{ id: currentPrerequisiteId, $type: 'tasks' }] : [],
                        overrideWorkAhead: originalDbTask?.overrideWorkAhead || false,
                        notes: originalDbTask?.notes || '',
                        specificTime: originalDbTask?.specificTime || '',
                        subsequentTasks: originalDbTask?.subsequentTasks || [],
                        attachments: originalDbTask?.attachments || [],
                        taskSeries:
                            originalDbTask?.taskSeries ||
                            (seriesId
                                ? [
                                      {
                                          id: seriesId,
                                          $type: 'taskSeries',
                                      },
                                  ]
                                : []),
                    };
                });
                setDbTasks(newDbTasks);
            } catch (error: any) {
                console.error('Auto-save failed:', error);
                toast({
                    title: 'Auto-save failed',
                    description: error.message,
                    variant: 'destructive',
                });
            }
        },
        [
            seriesId,
            taskSeriesName,
            description,
            startDate,
            targetEndDate,
            workAheadAllowed,
            breakType,
            breakStartDate,
            breakDelayValue,
            breakDelayUnit,
            selectedFamilyMemberId,
            linkedScheduledActivityId,
            uiTasks,
            isEditing,
            initialSeriesId,
            db,
            toast,
            dbTasks,
        ]
    );

    // Effect for initial load of an existing series
    useEffect(() => {
        if (initialSeriesId && db) {
            const fetchSeries = async () => {
                try {
                    const { data: seriesFetchData } = await db.queryOnce({
                        taskSeries: {
                            $: { where: { id: initialSeriesId } },
                            familyMember: {},
                            scheduledActivity: {},
                            tasks: {
                                parentTask: {},
                            },
                        },
                    });

                    const series = seriesFetchData?.taskSeries?.[0];

                    if (series) {
                        setTaskSeriesName(series.name || '');
                        setDescription(series.description || '');
                        setSelectedFamilyMemberId(series.familyMember?.[0]?.id || null);
                        setLinkedScheduledActivityId(series.scheduledActivity?.[0]?.id || null);
                        setStartDate(series.startDate ? parseISO(series.startDate) : undefined);
                        setTargetEndDate(series.targetEndDate ? parseISO(series.targetEndDate) : undefined);
                        setWorkAheadAllowed(series.workAheadAllowed !== null ? series.workAheadAllowed : true);
                        setBreakType(series.breakType || 'immediate');
                        setBreakStartDate(series.breakStartDate ? parseISO(series.breakStartDate) : undefined);
                        setBreakDelayValue(series.breakDelayValue !== null ? String(series.breakDelayValue) : '');
                        setBreakDelayUnit(series.breakDelayUnit || 'days');
                        setDbTasks(series.tasks || []);
                        // Transform DB tasks to UITask structure for the editor
                        const initialUiTasks: UITask[] = (series.tasks || [])
                            .sort((a: Task, b: Task) => (a.order || 0) - (b.order || 0))
                            .map((dbTask: Task) => ({
                                id: dbTask.id,
                                text: dbTask.text || '',
                                indentationLevel: 0,
                                isDayBreak: dbTask.isDayBreak || false,
                            }));
                        setUiTasks(initialUiTasks);

                        setIsEditing(true);
                    } else {
                        toast({
                            title: 'Error',
                            description: `Task Series with ID ${initialSeriesId} not found.`,
                            variant: 'destructive',
                        });
                    }
                } catch (error: any) {
                    console.error('Failed to fetch task series:', error);
                    toast({
                        title: 'Error fetching series',
                        description: error.message,
                        variant: 'destructive',
                    });
                }
            };
            fetchSeries();
        } else if (!initialSeriesId) {
            // This is a new series. If a family member is pre-selected, set it.
            if (initialFamilyMemberId) {
                setSelectedFamilyMemberId(initialFamilyMemberId);
            }
            // Trigger initial save for a new series
            autoSave();
        }
    }, [initialSeriesId, initialFamilyMemberId, db, autoSave, toast]);

    // Debounced auto-save for text inputs
    useEffect(() => {
        const handler = setTimeout(() => {
            if (isEditing || (selectedFamilyMemberId && taskSeriesName)) {
                // Save if editing or if new and has a member+name
                autoSave();
            }
        }, 1500); // Auto-save after 1.5 seconds of inactivity
        return () => clearTimeout(handler);
    }, [taskSeriesName, description, autoSave, isEditing, selectedFamilyMemberId]); // Added taskListText

    // Auto-save immediately for other field types on change
    // For dropdowns, date pickers, checkboxes
    const handleImmediateAutoSave = () => {
        if (isEditing || (selectedFamilyMemberId && taskSeriesName)) {
            autoSave();
        }
    };

    const handleFinished = () => {
        // TODO: Final validation if any
        autoSave(); // Ensure last changes are saved
        toast({ title: 'Task Series Saved!' });
        if (onClose) onClose();
        // else navigate back, e.g. router.push('/task-series-list');
    };

    const handleCancel = () => {
        // Auto-save handles persistence, so cancel just means navigate away
        if (onClose) onClose();
        // else navigate back
    };

    const handleDelete = async () => {
        if (!initialSeriesId) return; // Should not happen if button is only in edit mode
        // TODO: Confirmation dialog
        try {
            // TODO: Delete linked tasks and attachments as well
            db.transact([tx.taskSeries[initialSeriesId].delete()]);
            toast({ title: 'Task Series Deleted' });
            if (onClose) onClose();
            // else navigate to a safe page
        } catch (error: any) {
            toast({ title: 'Error Deleting', description: error.message, variant: 'destructive' });
        }
    };

    if (isLoadingFamilyMembers && !initialSeriesId) {
        // Only block for new series if members are loading
        return <div>Loading family members...</div>;
    }

    return (
        <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold">{isEditing ? `Edit: ${taskSeriesName || 'Task Series'}` : 'Create New Task Series'}</h1>

            {/* Family Member Selector */}
            <div>
                <Label htmlFor="family-member">Family Member</Label>
                <Select
                    value={selectedFamilyMemberId || ''}
                    onValueChange={(value) => {
                        setSelectedFamilyMemberId(value);
                        // Reset linked scheduled activity when family member changes
                        setLinkedScheduledActivityId(null);
                        handleImmediateAutoSave();
                    }}
                    disabled={isLoadingFamilyMembers || (isEditing && !!initialFamilyMemberId)} // Disable if editing and member was pre-set (or handle change differently)
                >
                    <SelectTrigger id="family-member">
                        <SelectValue placeholder="Select a family member" />
                    </SelectTrigger>
                    <SelectContent>
                        {familyMembers.map((member: any) => (
                            <SelectItem key={member.id} value={member.id}>
                                {member.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {!selectedFamilyMemberId && <p className="text-xs text-destructive mt-1">Please select a family member.</p>}
            </div>

            {/* Task Series Details Section */}
            <section className="space-y-4 p-4 border rounded-lg">
                <h2 className="text-xl font-semibold">Series Details</h2>
                <div>
                    <Label htmlFor="task-series-name">Task Series Name</Label>
                    <Input
                        id="task-series-name"
                        value={taskSeriesName}
                        onChange={(e) => setTaskSeriesName(e.target.value)}
                        placeholder="e.g., 7th Grade Mathematics"
                    />
                </div>
                <div>
                    <Label htmlFor="task-series-description">Description (Optional)</Label>
                    <Textarea
                        id="task-series-description"
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="e.g., Covers chapters 1-5..."
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <Label htmlFor="scheduled-activity">Assign to Scheduled Activity</Label>
                        <Select
                            value={linkedScheduledActivityId || ''}
                            onValueChange={(value) => {
                                setLinkedScheduledActivityId(value === 'none' ? null : value);
                                handleImmediateAutoSave();
                            }}
                            disabled={!selectedFamilyMemberId || isLoadingChores}
                        >
                            <SelectTrigger id="scheduled-activity">
                                <SelectValue placeholder="Select a scheduled activity" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {availableChores.map((chore: any) => (
                                    <SelectItem key={chore.id} value={chore.id}>
                                        {chore.title}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {!linkedScheduledActivityId && selectedFamilyMemberId && (
                            <p className="text-xs text-muted-foreground mt-1">Tasks will default to daily schedule (Mon-Fri).</p>
                        )}
                    </div>
                    <div>
                        <Label>Start Date</Label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant={'outline'} className={cn('w-full justify-start text-left font-normal', !startDate && 'text-muted-foreground')}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {startDate ? format(startDate, 'PPP') : <span>Pick a date</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar
                                    mode="single"
                                    selected={startDate}
                                    onSelect={(date) => {
                                        setStartDate(date);
                                        handleImmediateAutoSave();
                                    }}
                                    initialFocus
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <Label>Target End Date (Optional)</Label>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant={'outline'}
                                    className={cn('w-full justify-start text-left font-normal', !targetEndDate && 'text-muted-foreground')}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {targetEndDate ? format(targetEndDate, 'PPP') : <span>Pick a date</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0">
                                <Calendar
                                    mode="single"
                                    selected={targetEndDate}
                                    onSelect={(date) => {
                                        setTargetEndDate(date);
                                        handleImmediateAutoSave();
                                    }}
                                    disabled={(date) => startDate && date < startDate}
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="flex items-center space-x-2 pt-6">
                        <Checkbox
                            id="work-ahead"
                            checked={workAheadAllowed}
                            onCheckedChange={(checked) => {
                                setWorkAheadAllowed(!!checked);
                                handleImmediateAutoSave();
                            }}
                        />
                        <Label htmlFor="work-ahead" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                            Allow working ahead on tasks by default
                        </Label>
                    </div>
                </div>

                {/* Optional Break After Series Completion */}
                <div>
                    <Label className="mb-2 block font-semibold">After this series is completed, the next series:</Label>
                    <RadioGroup
                        value={breakType}
                        onValueChange={(value: 'immediate' | 'specificDate' | 'delay') => {
                            setBreakType(value);
                            if (value !== 'specificDate') setBreakStartDate(undefined);
                            if (value !== 'delay') {
                                setBreakDelayValue('');
                                setBreakDelayUnit('days');
                            }
                            handleImmediateAutoSave();
                        }}
                        className="space-y-2"
                    >
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="immediate" id="break-immediate" />
                            <Label htmlFor="break-immediate" className="font-normal">
                                Starts immediately (no defined break)
                            </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="specificDate" id="break-specificDate" />
                            <Label htmlFor="break-specificDate" className="font-normal">
                                Starts on specific date:
                            </Label>
                        </div>
                        {breakType === 'specificDate' && (
                            <div className="pl-6">
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant={'outline'}
                                            className={cn('w-full justify-start text-left font-normal', !breakStartDate && 'text-muted-foreground')}
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {breakStartDate ? format(breakStartDate, 'PPP') : <span>Pick a date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar
                                            mode="single"
                                            selected={breakStartDate}
                                            onSelect={(date) => {
                                                setBreakStartDate(date);
                                                handleImmediateAutoSave();
                                            }}
                                            disabled={(date) => targetEndDate && date < targetEndDate}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        )}
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="delay" id="break-delay" />
                            <Label htmlFor="break-delay" className="font-normal">
                                Starts after a delay of:
                            </Label>
                        </div>
                        {breakType === 'delay' && (
                            <div className="pl-6 flex items-center space-x-2">
                                <Input
                                    type="number"
                                    value={breakDelayValue}
                                    onChange={(e) => {
                                        setBreakDelayValue(e.target.value);
                                    }}
                                    onBlur={handleImmediateAutoSave}
                                    className="w-20"
                                    min="0"
                                />
                                <Select
                                    value={breakDelayUnit}
                                    onValueChange={(value: 'days' | 'weeks' | 'months') => {
                                        setBreakDelayUnit(value);
                                        handleImmediateAutoSave();
                                    }}
                                >
                                    <SelectTrigger className="w-[120px]">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="days">Days</SelectItem>
                                        <SelectItem value="weeks">Weeks</SelectItem>
                                        <SelectItem value="months">Months</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        )}
                    </RadioGroup>
                </div>
            </section>

            {/* Task List Editor Section */}
            <section className="space-y-4 p-4 border rounded-lg">
                <h2 className="text-xl font-semibold">Task List</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="md:col-span-1 bg-muted p-2 rounded min-h-[200px]">
                        <p className="text-sm font-semibold text-center">Dynamic Date Margin</p>
                        <p className="text-xs text-center text-muted-foreground">(Preview of scheduled dates will appear here)</p>
                        {/* TODO: Implement Dynamic Date Margin display */}
                    </div>
                    <div className="md:col-span-2">
                        <Label htmlFor="task-list-editor">Tasks</Label>
                        {/* Container for Task List with a border */}
                        <div className="task-list-container border rounded-md p-2 min-h-[200px] space-y-1 bg-background">
                            {uiTasks.map((task) => (
                                <TaskItem
                                    key={task.id}
                                    task={task}
                                    onTextChange={handleTaskTextChange}
                                    onPressEnter={handlePressEnter}
                                    onPaste={handlePasteTasks}
                                    onDelete={handleDeleteTask}
                                    onIndent={handleIndentTask}
                                    onUnindent={handleUnindentTask}
                                    onFocus={handleFocusTask}
                                    onBlur={handleBlurTask}
                                    isFocused={focusedTaskId === task.id}
                                    onArrowUp={handleArrowUp}
                                    onArrowDown={handleArrowDown}
                                    onBackspaceEmpty={handleBackspaceEmpty}
                                    desiredVisualCursorPos={focusedTaskId === task.id ? desiredVisualCursorPos : null}
                                    indentCharEquivalent={INDENT_CHAR_EQUIVALENT}
                                    onFocusClearCursorPos={handleFocusClearCursorPos}
                                    cursorEntryDirection={focusedTaskId === task.id ? cursorEntryDirection : null}
                                    onArrowLeftAtStart={handleArrowLeftAtStart}
                                    onArrowRightAtEnd={handleArrowRightAtEnd}
                                />
                            ))}
                            <Button variant="outline" size="sm" onClick={handleAddNewTask} className="mt-2">
                                <PlusCircle className="mr-2 h-4 w-4" /> Add Task
                            </Button>
                        </div>
                        {/* TODO: Add buttons for automated task distribution */}
                    </div>
                </div>
            </section>

            {/* Actions Bar */}
            <section className="flex justify-end space-x-2 pt-4">
                <Button variant="outline" onClick={handleCancel}>
                    Cancel
                </Button>
                {isEditing && (
                    <Button variant="destructive" onClick={handleDelete}>
                        <Trash2 className="mr-2 h-4 w-4" /> Delete Series
                    </Button>
                )}
                <Button onClick={handleFinished}>
                    <Check className="mr-2 h-4 w-4" /> Finished
                </Button>
            </section>
        </div>
    );
};

export default TaskSeriesEditor;
