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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'; // Added this import
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Info, AlertTriangle, PlusCircle, Trash2, Settings, Save, Edit, Check } from 'lucide-react'; // Added Check
import { format, parseISO, isValid, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import type { AppSchema } from '@/instant.schema'; // Adjust path if needed
import TaskItem from './TaskItem'; // ADD this import

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
    prerequisites?: Array<{ id: string; $type: 'tasks' }>; // ADDED
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

// const APP_ID = process.env.NEXT_PUBLIC_INSTANT_APP_ID!;
// db should be passed as a prop, but initializing here for standalone dev if needed

const TaskSeriesEditor: React.FC<TaskSeriesEditorProps> = ({ db: propDb, initialSeriesId = null, initialFamilyMemberId = null, onClose }) => {
    const db = propDb; // Use passed db or init
    const { toast } = useToast();

    const [isEditing, setIsEditing] = useState(!!initialSeriesId);
    const [seriesId, setSeriesId] = useState<string>(initialSeriesId || id()); // Generate new ID if creating

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
    const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null); // ADD this state

    // TODO: Add state for parsed tasks and dynamic date margin calculation

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
                      $: { where: { 'assignees.id': selectedFamilyMemberId } }, // TODO: Adjust if schema for chore assignees changes
                      assignees: {}, // Need to ensure this fetches members linked to chores
                  },
              }
            : null // Don't query if no family member is selected
    );
    const availableChores = choresData?.chores || [];

    // --- Helper function to parse task list text ---
    const parseTaskListText = (text: string): ParsedTask[] => {
        const lines = text.split('\n');
        const parsedTasks: ParsedTask[] = [];
        const parentCanditates: Array<{ id: string; indentationLevel: number }> = [];

        lines.forEach((line, index) => {
            const trimmedLine = line.trim();
            const dayBreakChars = ['~', '-', '='];
            const isDayBreak = dayBreakChars.includes(trimmedLine) && line.length === trimmedLine.length; // Ensure it's only the char

            let indentationLevel = 0;
            const match = line.match(/^(\s*)/);
            if (match) {
                // Simple tab-based indentation for V1: count tabs
                indentationLevel = line.match(/^\t*/)?.[0]?.length || 0;
                // Or for spaces (e.g., 2 spaces per indent level)
                // indentationLevel = Math.floor((line.match(/^ */)?.[0]?.length || 0) / 2);
            }

            const taskText = isDayBreak ? '' : line.substring(indentationLevel); // Remove leading tabs/spaces for text
            const taskId = id(); // Generate a new ID for each parsed task item

            let parentId: string | null = null;
            // Determine parent based on indentation
            // Remove candidates from the stack that are at the same or higher level
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

    const handleCreateNewTaskAfter = (currentTaskId: string, currentTaskText: string) => {
        // First, update the text of the current task, in case it changed before Enter was pressed
        setUiTasks((prevTasks) => prevTasks.map((t) => (t.id === currentTaskId ? { ...t, text: currentTaskText } : t)));

        const currentIndex = uiTasks.findIndex((t) => t.id === currentTaskId);
        const currentTask = uiTasks[currentIndex];
        const newUiTask: UITask = {
            id: id(),
            text: '',
            indentationLevel: currentTask ? currentTask.indentationLevel : 0, // Inherit indentation
            isDayBreak: false,
        };

        setUiTasks((prevTasks) => [...prevTasks.slice(0, currentIndex + 1), newUiTask, ...prevTasks.slice(currentIndex + 1)]);
        setFocusedTaskId(newUiTask.id); // Focus the new task
        // handleImmediateAutoSave(); // Decide if Enter should immediately save
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

            // Insert new tasks after the current one
            newUiTasks = [...newUiTasks.slice(0, currentTaskIndex + 1), ...tasksToInsert, ...newUiTasks.slice(currentTaskIndex + 1)];
        }

        setUiTasks(newUiTasks);
        setFocusedTaskId(lastFocusedId); // Focus the last task that was part of the paste
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
        } else if (newUiTasks.length > 0) {
            // Deleted the first item, focus the new first item
            setFocusedTaskId(newUiTasks[0].id);
        }

        const transactions = [
            tx.tasks[taskId].delete(),
            tx.taskSeries[seriesId].unlink({ tasks: taskId }),
            // TODO: If tasks can be parents/prerequisites, handle unlinking those relationships too
        ];

        try {
            await db.transact(transactions);
            toast({ title: 'Task Deleted', description: `Task "${taskToDelete.text || 'Untitled'}" removed.` });
            // Also update dbTasks state to reflect the deletion
            setDbTasks((prevDbTasks) => prevDbTasks.filter((t) => t.id !== taskId));
        } catch (error: any) {
            console.error('Failed to delete task from DB:', error);
            toast({ title: 'Error Deleting Task', description: error.message, variant: 'destructive' });
            // Revert UI change if DB operation failed
            setUiTasks(uiTasks); // Revert to previous uiTasks state
            // Potentially re-focus the task that failed to delete if focus logic is intricate
            if (taskIndex !== -1 && uiTasks[taskIndex]) {
                setFocusedTaskId(uiTasks[taskIndex].id);
            }
        }
    };

    const handleIndentTask = (taskId: string) => {
        setUiTasks((prevTasks) =>
            prevTasks.map((task) => {
                if (task.id === taskId) {
                    // Basic indentation: Allow indenting if not a day break and if previous task is not a daybreak
                    // and if its new indentation level is not more than 1 greater than the previous task's level
                    // or if it's the first task (cannot indent further as no parent)
                    const taskIndex = prevTasks.findIndex((t) => t.id === taskId);
                    if (taskIndex > 0) {
                        // Cannot indent the very first task this way
                        const prevTask = prevTasks[taskIndex - 1];
                        // Can only indent if previous task allows children (not a daybreak)
                        // and new indent level isn't too far from previous task's indent.
                        if (!task.isDayBreak && !prevTask.isDayBreak && task.indentationLevel <= prevTask.indentationLevel) {
                            return { ...task, indentationLevel: prevTask.indentationLevel + 1 };
                        }
                        // A more robust check: new indent level should be at most prevTask.indentationLevel + 1
                        // And a task cannot indent beyond being a child of the immediate previous task
                        // For V1, simple increment if possible:
                        // if (task.indentationLevel < (prevTask.indentationLevel + (prevTask.isDayBreak ? 0 : 1) ) ) {
                        //    return { ...task, indentationLevel: task.indentationLevel + 1 };
                        // }
                    }
                    // Max indentation depth (e.g., 5 levels) could also be added.
                    // For now, simple +1 if possible relative to previous non-daybreak task, else no change.
                    // This logic for indenting relative to previous needs careful thought for all edge cases.
                    // A simpler V1 indent: just increase if taskIndex > 0 and prevTask isn't a daybreak.
                    // The parent linking in autoSave will use this indentation level.
                    if (taskIndex > 0 && !prevTasks[taskIndex - 1].isDayBreak && !task.isDayBreak) {
                        // Allow indenting only if the new level isn't more than 1 greater than the prev non-daybreak task at same or lesser indent
                        let potentialParentIndex = -1;
                        for (let i = taskIndex - 1; i >= 0; i--) {
                            if (prevTasks[i].indentationLevel < task.indentationLevel + 1 && !prevTasks[i].isDayBreak) {
                                potentialParentIndex = i;
                                break;
                            }
                            if (prevTasks[i].indentationLevel < task.indentationLevel && !prevTasks[i].isDayBreak) break; // Stop if we go too far up
                        }
                        if (potentialParentIndex !== -1 && task.indentationLevel <= prevTasks[potentialParentIndex].indentationLevel) {
                            return { ...task, indentationLevel: prevTasks[potentialParentIndex].indentationLevel + 1 };
                        } else if (potentialParentIndex === -1 && taskIndex > 0 && !prevTasks[taskIndex - 1].isDayBreak) {
                            // Indent under immediate previous if it's shallower
                            if (task.indentationLevel <= prevTasks[taskIndex - 1].indentationLevel) {
                                return { ...task, indentationLevel: prevTasks[taskIndex - 1].indentationLevel + 1 };
                            }
                        }
                    }
                }
                return task;
            })
        );
        handleImmediateAutoSave();
    };

    const handleUnindentTask = (taskId: string) => {
        setUiTasks((prevTasks) =>
            prevTasks.map((task) =>
                task.id === taskId && !task.isDayBreak // Cannot unindent day breaks with this logic
                    ? { ...task, indentationLevel: Math.max(0, task.indentationLevel - 1) }
                    : task
            )
        );
        handleImmediateAutoSave();
    };

    const handleFocusTask = (taskId: string) => {
        setFocusedTaskId(taskId);
    };

    const handleBlurTask = (taskId: string) => {
        // If the blurred task is the currently focused one, clear focus.
        // This helps avoid issues if a task is deleted while it (conceptually) has focus.
        // if (focusedTaskId === taskId) {
        //   setFocusedTaskId(null);
        // }
        // Trigger save on blur of a task item's input.
        // autoSave(); // This will be called by the Input's onBlur via handleImmediateAutoSave in some fashion
    };

    const handleAddNewTask = () => {
        console.log('Add new task to end');
        const newUiTask: UITask = { id: id(), text: '', indentationLevel: 0, isDayBreak: false };
        setUiTasks((prevTasks) => [...prevTasks, newUiTask]);
        setFocusedTaskId(newUiTask.id); // Focus the new task
        // handleImmediateAutoSave(); // Save after adding
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
                transactions.push(tx.taskSeries[seriesId].link({ familyMember: selectedFamilyMemberId }));
                // Also ensure reverse link if familyMembers.taskSeries is defined (it is in our schema)
                transactions.push(tx.familyMembers[selectedFamilyMemberId].link({ taskSeries: seriesId }));
            }

            // Link scheduled activity
            if (linkedScheduledActivityId) {
                transactions.push(tx.taskSeries[seriesId].link({ scheduledActivity: linkedScheduledActivityId }));
                // Add reverse link if chores.taskSeries is defined
                transactions.push(tx.chores[linkedScheduledActivityId].link({ taskSeries: seriesId }));
            } else {
                // TODO: Handle unlinking if a scheduled activity was previously linked and now is "None"
                // This requires knowing the previous state or fetching the existing link.
                // For V1 auto-save, we might simplify and only handle linking for now.
            }

            // --- Task Processing: Create or Update tasks based on uiTasks ---
            // Deletions are now handled directly by handleDeleteTask.
            // This section ensures tasks in uiTasks are present and up-to-date in the DB.
            const parentCandidates: Array<{ id: string; indentationLevel: number }> = [];
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
                        // Unlink old parent if it changed
                        transactions.push(tx.tasks[uiTask.id].unlink({ parentTask: oldParentId }));
                    }
                    transactions.push(tx.tasks[uiTask.id].link({ parentTask: parentId }));
                } else if (!parentId && oldParentId) {
                    // Parent removed
                    transactions.push(tx.tasks[uiTask.id].unlink({ parentTask: oldParentId }));
                }

                // Handle prerequisites link
                if (!uiTask.isDayBreak && !parentId) {
                    // Only top-level tasks get explicit sequential prerequisites for now
                    const oldPrerequisites = originalDbTask?.prerequisites?.map((p) => p.id) || [];
                    if (previousTaskForPrerequisite) {
                        // Link to the new prerequisite if it's different or wasn't there
                        if (!oldPrerequisites.includes(previousTaskForPrerequisite.id)) {
                            transactions.push(tx.tasks[uiTask.id].link({ prerequisites: previousTaskForPrerequisite.id }));
                        }
                        // Unlink any old prerequisites that are not the current `previousTaskForPrerequisite`
                        oldPrerequisites.forEach((oldPrereqId) => {
                            if (oldPrereqId !== previousTaskForPrerequisite!.id) {
                                // Safe due to previousTaskForPrerequisite check
                                transactions.push(tx.tasks[uiTask.id].unlink({ prerequisites: oldPrereqId }));
                            }
                        });
                    } else {
                        // This is the first non-day-break, non-child task
                        oldPrerequisites.forEach((oldPrereqId) => {
                            // Unlink all old prerequisites
                            transactions.push(tx.tasks[uiTask.id].unlink({ prerequisites: oldPrereqId }));
                        });
                    }
                } else if (originalDbTask?.prerequisites && originalDbTask.prerequisites.length > 0) {
                    // If it's a day break or child task, it shouldn't have direct prerequisites from this logic
                    // so unlink any it might have had.
                    originalDbTask.prerequisites.forEach((oldPrereqId) => {
                        transactions.push(tx.tasks[uiTask.id].unlink({ prerequisites: oldPrereqId.id }));
                    });
                }

                if (!uiTask.isDayBreak && uiTask.text.trim() !== '') {
                    parentCandidates.push({ id: uiTask.id, indentationLevel: uiTask.indentationLevel });
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
                const parentCandidatesStack: Array<{ id: string; indentationLevel: number }> = [];
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
                        parentCandidatesStack.push({ id: uiTask.id, indentationLevel: uiTask.indentationLevel });
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
                        taskSeries: originalDbTask?.taskSeries || (seriesId ? [{ id: seriesId, $type: 'taskSeries' }] : []),
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
            // taskListText, // REMOVE this from autoSave dependencies for now
            uiTasks, // ADD uiTasks as a dependency
            // dbTasks, // ADD dbTasks as a dependency
            isEditing,
            initialSeriesId,
            db,
            toast,
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
                                // Fetch linked tasks
                                parentTask: {}, // Also fetch parentTask link if needed for initial structuring
                                // subsequentTasks: {} // And subsequentTasks (prerequisites)
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
                            .sort((a, b) => (a.order || 0) - (b.order || 0))
                            .map((dbTask) => ({
                                id: dbTask.id,
                                text: dbTask.text || '',
                                indentationLevel: 0, // TODO: Determine initial indentation from parentTask links
                                isDayBreak: dbTask.isDayBreak || false,
                            }));
                        setUiTasks(initialUiTasks);

                        setIsEditing(true); // Ensure isEditing is true
                    } else {
                        toast({ title: 'Error', description: `Task Series with ID ${initialSeriesId} not found.`, variant: 'destructive' });
                        // Optionally call onClose or navigate away
                    }
                } catch (error: any) {
                    console.error('Failed to fetch task series:', error);
                    toast({ title: 'Error fetching series', description: error.message, variant: 'destructive' });
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
    }, [initialSeriesId, initialFamilyMemberId, db, autoSave]);

    // Debounced auto-save for text inputs (could be more sophisticated with a proper debounce hook)
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
                        {familyMembers.map((member) => (
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
                                {availableChores.map((chore) => (
                                    <SelectItem key={chore.id} value={chore.id}>
                                        {chore.title}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {/* TODO: Display selected activity's pattern */}
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
                        {' '}
                        {/* Adjusted for alignment */}
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
                            // Reset other break fields when type changes
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
                                            disabled={(date) => targetEndDate && date < targetEndDate} // Optionally disable dates before targetEndDate
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
                                    onBlur={handleImmediateAutoSave} // Save on blur for number input
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
                            {uiTasks.map((task, index) => (
                                <TaskItem
                                    key={task.id}
                                    task={task}
                                    onTextChange={handleTaskTextChange}
                                    onPressEnter={handleCreateNewTaskAfter}
                                    onPaste={handlePasteTasks}
                                    onDelete={handleDeleteTask}
                                    onIndent={handleIndentTask}
                                    onUnindent={handleUnindentTask}
                                    onFocus={handleFocusTask}
                                    onBlur={handleBlurTask}
                                    isFocused={focusedTaskId === task.id}
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
