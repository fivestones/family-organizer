// components/ChoreList.tsx
import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Trash2 } from 'lucide-react';
import { getAssignedMembersForChoreOnDate, toUTCDate } from '@/lib/chore-utils';
import { choreOccursOnDate } from '@/lib/chore-schedule';
import { format } from 'date-fns';
import ToggleableAvatar from '@/components/ui/ToggleableAvatar';
import DetailedChoreForm from './DetailedChoreForm';
import { id, tx } from '@instantdb/react';
import { getTasksForDate, Task, isSeriesActiveForDate } from '@/lib/task-scheduler';
import { TaskSeriesChecklist } from './TaskSeriesChecklist';
import { useToast } from '@/components/ui/use-toast';
import { getTaskSeriesProgress, hasScheduledChildren } from '@/lib/task-series-progress';
import { uploadFilesToS3 } from '@/lib/file-uploads';
import { buildTaskProgressUpdateTransactions } from '@/lib/task-progress-mutations';
import { getTaskBucketCounts, getTaskLastActiveState, isActionableTask, isTaskDone } from '@/lib/task-progress';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import ChoreDetailDialog from './ChoreDetailDialog';

// +++ Accept new props passed down from ChoresTracker +++
function ChoreList({
    chores,
    familyMembers,
    selectedMember,
    selectedDate,
    toggleChoreDone,
    updateChore,
    updateChoreSchedule,
    deleteChore,
    db,
    unitDefinitions,
    currencyOptions,
    onEditTaskSeries,
    // +++ NEW PROPS +++
    currentUser,
    canEditChores,
    showChoreDescriptions, // View Setting
    showTaskDetails, // View Setting
    pageMode = 'chores',
    focusedChoreId = null,
}: any) {
    const [editingChore, setEditingChore] = useState(null);
    const [detailChoreId, setDetailChoreId] = useState<string | null>(null);
    const [expandedTaskSeriesByMember, setExpandedTaskSeriesByMember] = useState<Record<string, Record<string, boolean>>>({});
    const [expandedTaskSeriesInAllView, setExpandedTaskSeriesInAllView] = useState<Record<string, boolean>>({});

    // Guardrail State for Task Series
    const [pendingCompletion, setPendingCompletion] = useState<{
        choreId: string;
        memberId: string;
        incompleteTaskIds: string[];
    } | null>(null);

    // +++ NEW STATE: Track chore for deletion confirmation +++
    const [choreToDelete, setChoreToDelete] = useState<string | null>(null);

    // --- NEW: Manage expanded state for Task Series details (Show/Hide) ---
    // Key: choreId, Value: boolean (true = visible)
    // NOTE: This now serves as a LOCAL override for the global showTaskDetails setting.
    // However, since we removed the book icon, user can't toggle this manually for the whole chore anymore.
    // The requirement is: "We will remove the book icon... But we will leave in place the 'view details' link in tasks"
    // The "view details" link inside TaskSeriesChecklist handles its OWN local state.
    // So this `expandedChores` state might be redundant unless we want to keep it for some reason?
    // Actually, `TaskSeriesChecklist` takes `showDetails`. We should pass the GLOBAL setting there.
    // The `TaskSeriesChecklist` component has its own `localExpandedIds` state for individual task overrides.
    // So we don't need `expandedChores` at this level anymore.

    // const [expandedChores, setExpandedChores] = useState<Record<string, boolean>>({});

    // +++ NEW HOOK +++
    const { toast } = useToast();
    const familyMemberNamesById = React.useMemo(
        () =>
            (familyMembers || []).reduce((accumulator: Record<string, string>, member: any) => {
                if (member?.id && member?.name) {
                    accumulator[member.id] = member.name;
                }
                return accumulator;
            }, {}),
        [familyMembers]
    );

    useEffect(() => {
        if (!focusedChoreId) return;
        const frame = window.requestAnimationFrame(() => {
            const element = document.getElementById(`chore-${focusedChoreId}`);
            element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        });

        return () => window.cancelAnimationFrame(frame);
    }, [focusedChoreId, chores.length]);

    const detailChore = React.useMemo(() => {
        if (!detailChoreId) return null;
        return chores.find((chore) => chore.id === detailChoreId) || null;
    }, [chores, detailChoreId]);

    useEffect(() => {
        if (selectedMember === 'All') {
            // Always start "All family members" view collapsed.
            setExpandedTaskSeriesInAllView({});
        }
    }, [selectedMember]);

    /* const toggleChoreDetails = (choreId: string) => {
        setExpandedChores((prev) => ({
            ...prev,
            [choreId]: !prev[choreId],
        }));
    };
    */

    const safeSelectedDate =
        selectedDate instanceof Date && !isNaN(selectedDate.getTime())
            ? new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate()))
            : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

    const isSameDay = (date1, date2) => {
        return date1.getUTCFullYear() === date2.getUTCFullYear() && date1.getUTCMonth() === date2.getUTCMonth() && date1.getUTCDate() === date2.getUTCDate();
    };

    // FIX: Calculate "Today" based on Local Time mapped to UTC, not raw UTC timestamp.
    // This matches how 'selectedDate' is created in ChoresTracker and prevents timezone overlap issues (e.g. late night CST vs UTC).
    const now = new Date();
    const localToday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const isToday = isSameDay(safeSelectedDate, localToday);
    const isPastDate = safeSelectedDate.getTime() < localToday.getTime();

    const shouldShowChore = (chore) => {
        try {
            return choreOccursOnDate(chore, safeSelectedDate);
        } catch (error) {
            console.error(`Error processing RRULE for chore ${chore.id}:`, error);
            return false;
        }
    };

    const filteredChores = chores.filter((chore) => {
        if (!shouldShowChore(chore)) return false;

        // Get the assigned members for the chore on the selected date
        const assignedMembers = getAssignedMembersForChoreOnDate(chore, safeSelectedDate);

        // If 'All' is selected, include the chore if anyone is assigned
        if (selectedMember === 'All') {
            return assignedMembers.length > 0; // Show if there are any assignments for this day
        } else {
            // Check if the selected member is assigned to this chore on the selected date
            return assignedMembers.some((assignee) => assignee.id === selectedMember);
        }
    });

    const formattedSelectedDate = safeSelectedDate.toISOString().slice(0, 10); // Use safeSelectedDate

    const buildTasksHref = (choreId: string) => {
        const params = new URLSearchParams();
        params.set('date', formattedSelectedDate);
        params.set('member', selectedMember);
        params.set('choreId', choreId);
        return `/tasks?${params.toString()}#chore-${choreId}`;
    };

    const uploadProgressFiles = async (files: File[]) => uploadFilesToS3(files, id);

    const handleEditChore = (chore) => {
        // +++ CHECK AUTH +++
        if (!canEditChores) {
            toast({ title: 'Access Denied', description: 'Only parents can edit chores.', variant: 'destructive' });
            return;
        }
        setEditingChore(chore);
    };

    const handleOpenChoreDetails = (choreId: string) => {
        setDetailChoreId(choreId);
    };

    const handleEditFromDetails = () => {
        if (!detailChore) return;
        setDetailChoreId(null);
        handleEditChore(detailChore);
    };

    // +++ NEW HELPER +++
    const handleDeleteChore = (id: string) => {
        if (!canEditChores) {
            toast({ title: 'Access Denied', description: 'Only parents can delete chores.', variant: 'destructive' });
            return;
        }
        // +++ CHANGE: Set state for confirmation instead of deleting immediately +++
        setChoreToDelete(id);
    };

    // +++ CONFIRM DELETE HANDLER +++
    const confirmDeleteChore = () => {
        if (choreToDelete) {
            deleteChore(choreToDelete);
            setChoreToDelete(null);
        }
    };

    const handleUpdateChore = (updatedChore) => {
        if (editingChore?.id) {
            updateChore(editingChore.id, updatedChore);
        }
        setEditingChore(null);
    };

    const handleScheduleUpdate = async (patch) => {
        if (!editingChore?.id) return;
        await updateChoreSchedule(editingChore.id, patch);
        setEditingChore(null);
    };

    // --- Task Series Logic Helpers ---

    const handleTaskToggle = async (taskId: string, currentStatus: boolean, allTasks: Task[], chore: any, series?: any) => {
        if (!currentUser?.id) {
            toast({ title: 'Login Required', description: 'Choose a family member before updating task status.', variant: 'destructive' });
            return;
        }

        const targetTask = allTasks.find((task) => task.id === taskId);
        if (!targetTask) return;

        const nextState = currentStatus ? getTaskLastActiveState(targetTask) : 'done';
        const transactions = buildTaskProgressUpdateTransactions({
            tx,
            createId: id,
            taskId,
            allTasks,
            nextState,
            selectedDateKey: formattedSelectedDate,
            actorFamilyMemberId: currentUser.id,
            taskSeriesId: series?.id || null,
            choreId: chore.id,
            affectedFamilyMemberIds: series?.ownerId ? [series.ownerId] : [],
            schedule: {
                startDate: chore.startDate,
                rrule: chore.rrule || null,
                exdates: chore.exdates || null,
            },
            referenceDate: safeSelectedDate,
        });

        if (transactions.length === 0) return;

        try {
            await db.transact(transactions);
        } catch (error: any) {
            toast({
                title: 'Task update failed',
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        }
    };

    const handleTaskUpdate = async (
        taskId: string,
        input: {
            nextState: any;
            note?: string;
            files?: File[];
            restoreTiming?: 'now' | 'next_scheduled' | null;
        },
        allTasks: Task[],
        chore: any,
        series?: any
    ) => {
        if (!currentUser?.id) {
            toast({ title: 'Login Required', description: 'Choose a family member before updating task status.', variant: 'destructive' });
            return;
        }

        try {
            const uploadedAttachments = input.files?.length ? await uploadProgressFiles(input.files) : [];
            const transactions = buildTaskProgressUpdateTransactions({
                tx,
                createId: id,
                taskId,
                allTasks,
                nextState: input.nextState,
                selectedDateKey: formattedSelectedDate,
                note: input.note,
                actorFamilyMemberId: currentUser.id,
                restoreTiming: input.restoreTiming || null,
                taskSeriesId: series?.id || null,
                choreId: chore.id,
                affectedFamilyMemberIds: series?.ownerId ? [series.ownerId] : [],
                schedule: {
                    startDate: chore.startDate,
                    rrule: chore.rrule || null,
                    exdates: chore.exdates || null,
                },
                referenceDate: safeSelectedDate,
                attachments: uploadedAttachments,
            });

            if (transactions.length === 0) return;

            await db.transact(transactions);
        } catch (error: any) {
            toast({
                title: 'Task update failed',
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        }
    };

    const handleTaskPreviewToggle = async (task: Task, allTasks: Task[], chore: any, series?: any) => {
        await handleTaskUpdate(
            task.id,
            {
                nextState: isTaskDone(task) ? 'not_started' : 'done',
            },
            allTasks,
            chore,
            series
        );
    };

    // Updated: Accepts allTasks to properly identify parent/header relationships
    const handleAvatarClick = (chore, memberId, visibleTasks: Task[], allTasks: Task[]) => {
        // +++ CHECK AUTH +++
        if (!currentUser) {
            toast({ title: 'Login Required', description: 'Please log in to mark chores as complete.', variant: 'destructive' });
            return;
        }

        // 1. Check if already done?
        const isDone = chore.completions?.some((c) => c.completedBy?.id === memberId && c.dateDue === formattedSelectedDate && c.completed);

        if (isDone) {
            // Unchecking is always allowed
            // +++ Pass currentUser.id as executor +++
            toggleChoreDone(chore.id, memberId, currentUser.id);
            return;
        }

        // 2. Check for incomplete tasks in the CURRENT visible block
        // If there are no visible tasks (e.g. standard chore), this is empty and we skip the check

        // Identify tasks that are currently visible
        const scheduledIds = new Set(visibleTasks.map((t) => t.id));

        const incompleteIds = visibleTasks
            .filter((t) => {
                if (t.isCompleted) return false;

                // FIX: Check if this task is a header (has visible children) using the full task list
                // If it is a header, it doesn't have a checkbox, so we ignore it for "incomplete" status
                const isHeader = hasScheduledChildren(t.id, scheduledIds, allTasks);

                return !isHeader;
            })
            .map((t) => t.id);

        if (incompleteIds.length > 0) {
            // Guardrail triggered!
            setPendingCompletion({
                choreId: chore.id,
                memberId: memberId,
                incompleteTaskIds: incompleteIds,
            });
        } else {
            // All good, toggle
            // +++ Pass currentUser.id as executor +++
            toggleChoreDone(chore.id, memberId, currentUser.id);
        }
    };

    const confirmMarkAllAndComplete = () => {
        if (!pendingCompletion) return;

        const { choreId, memberId, incompleteTaskIds } = pendingCompletion;
        const chore = chores.find((candidate) => candidate.id === choreId);
        if (!chore || !currentUser?.id) {
            setPendingCompletion(null);
            return;
        }

        const targetSeries = chore.taskSeries?.find((series: any) => {
            const owner = series.familyMember?.[0] || series.familyMember;
            return owner?.id === memberId || !owner?.id;
        });
        const allTasks: Task[] = targetSeries?.tasks || [];

        const transactions = incompleteTaskIds.flatMap((taskId) =>
            buildTaskProgressUpdateTransactions({
                tx,
                createId: id,
                taskId,
                allTasks,
                nextState: 'done',
                selectedDateKey: formattedSelectedDate,
                actorFamilyMemberId: currentUser.id,
                taskSeriesId: targetSeries?.id || null,
                choreId,
                affectedFamilyMemberIds: memberId ? [memberId] : [],
                schedule: {
                    startDate: chore.startDate,
                    rrule: chore.rrule || null,
                    exdates: chore.exdates || null,
                },
                referenceDate: safeSelectedDate,
            })
        );

        db.transact(transactions);

        // Small delay to allow DB to process tasks before completing chore
        setTimeout(() => {
            // +++ Pass currentUser.id as executor +++
            toggleChoreDone(choreId, memberId, currentUser?.id);
        }, 50);

        setPendingCompletion(null);
    };

    return (
        <ScrollArea className="grow min-h-0">
            {' '}
            {/* grow min-h-0 on ScrollArea: This makes the ScrollArea itself the expanding element within its direct parent (<div className="flex flex-col gap-6 grow min-h-0">). It will take up the space not used by the allowance balance section. The ScrollArea component (assuming it's from Shadcn UI or similar) internally handles overflow-y: auto;, so when its content exceeds the calculated height it receives from grow, a scrollbar will appear within the ScrollArea. */}
            {/* Added p-3 padding to ul to prevent top avatar animation from being clipped by scroll area boundary */}
            <ul className="p-3">
                {filteredChores.map((chore) => {
                    // Determine assigned members for THIS specific date
                    const assignedMembers = getAssignedMembersForChoreOnDate(chore, safeSelectedDate);

                    // +++ Logic for "with..." text +++
                    let withOthersText = null;
                    // +++ Check isJoint constraint +++
                    if (selectedMember !== 'All' && chore.isJoint) {
                        const otherAssignees = assignedMembers.filter((m) => m.id !== selectedMember);
                        if (otherAssignees.length > 0) {
                            const names = otherAssignees.map((m) => m.name).filter(Boolean);
                            if (names.length === 1) {
                                withOthersText = `with ${names[0]}`;
                            } else if (names.length === 2) {
                                withOthersText = `with ${names[0]} and ${names[1]}`;
                            } else if (names.length > 2) {
                                const last = names.pop();
                                withOthersText = `with ${names.join(', ')}, and ${last}`;
                            }
                        }
                    }

                    // +++ Check if UpForGrabs and completed by someone else +++
                    let upForGrabsCompletedByOther = false;
                    let completerName = '';
                    let completerIdActual: string | null = null; // Store ID of actual completer
                    if (chore.isUpForGrabs) {
                        // Find the first completion for this chore on this date
                        const completionOnDate = (chore.completions || []).find((c) => c.dateDue === formattedSelectedDate && c.completed);
                        if (completionOnDate) {
                            completerIdActual = completionOnDate.completedBy?.id;
                            if (completerIdActual) {
                                // If a completer exists, set the flag
                                upForGrabsCompletedByOther = true; // It's completed by *someone*
                                // Find completer name
                                const completer = familyMembers.find((fm) => fm.id === completerIdActual);
                                completerName = completer?.name || 'another member';
                            }
                        }
                    }
                    // --- End Check ---

                    // --- Determine visibility of details ---
                    // Default behavior: Open if a specific member is selected, Closed if 'All' is selected.
                    // This can be overridden by the user toggling it.
                    // const isExplicitlyExpanded = expandedChores[chore.id];
                    // const showDetails = isExplicitlyExpanded !== undefined ? isExplicitlyExpanded : selectedMember !== 'All';

                    // +++ UPDATE: Use Global View Setting +++
                    const showDetails = showTaskDetails; // We simply pass the global boolean.
                    // Individual task expansion inside the checklist is handled by `TaskSeriesChecklist`'s local state.

                    const hasTaskSeries = chore.taskSeries && chore.taskSeries.length > 0;

                    // +++ Check for negative weight +++
                    const isNegative = (chore.weight ?? 0) < 0;

                    // --- COMPONENT EXTRACTION: Render Avatars ---
                    const renderAvatars = () => (
                        <div className="flex flex-wrap gap-2">
                            {assignedMembers
                                // Filter avatars based on selectedMember OR show all if 'All'
                                .filter((assignee) => selectedMember === 'All' || assignee.id === selectedMember)
                                .map((assignee) => {
                                    const completion = chore.completions?.find(
                                        (c) => c.completedBy?.id === assignee.id && c.dateDue === formattedSelectedDate // Safer check for completedBy
                                    );
                                    const familyMember = familyMembers.find((fm) => fm.id === assignee.id);
                                    // +++ Determine if this specific avatar should be disabled +++
                                    // Disabled if: It's an UpForGrabs chore completed by someone ELSE
                                    const isDisabled = chore.isUpForGrabs && upForGrabsCompletedByOther && assignee.id !== completerIdActual;
                                    const actualCompleterName = isDisabled ? completerName : ''; // Pass completer name only if disabling this avatar

                                    // --- Task Series Calculation for this Assignee ---
                                    // NOTE: When calculating "visibleTasks" for the avatar click handler,
                                    // we prioritize the specific series assigned to this person if it exists.
                                    let visibleTasks: Task[] = [];
                                    let allTasks: Task[] = []; // Capture all tasks for relationship lookup

                                    // FIX: Strict Series Ownership Check

                                    // 1. Priority: Series specifically assigned to this person
                                    const userSeries = chore.taskSeries?.find((s: any) => {
                                        const owner = s.familyMember?.[0] || s.familyMember;
                                        return owner?.id === assignee.id;
                                    });

                                    // 2. Secondary: Shared Series (No owner assigned at all)
                                    const sharedSeries = chore.taskSeries?.find((s: any) => {
                                        const owner = s.familyMember?.[0] || s.familyMember;
                                        return !owner?.id;
                                    });

                                    // 3. Selection: Specific > Shared > None
                                    const targetSeries = userSeries || sharedSeries;

                                    if (targetSeries && targetSeries.tasks) {
                                        allTasks = targetSeries.tasks;
                                        visibleTasks = getTasksForDate(
                                            allTasks,
                                            chore.rrule,
                                            chore.startDate,
                                            safeSelectedDate,
                                            targetSeries.startDate,
                                            chore.exdates || null
                                        );
                                    }

                                    const taskSeriesProgress = getTaskSeriesProgress(visibleTasks, allTasks);

                                    return (
                                        <ToggleableAvatar
                                            key={assignee.id}
                                            name={assignee.name}
                                            photoUrls={familyMember?.photoUrls}
                                            isComplete={completion?.completed || false}
                                            taskSeriesProgress={taskSeriesProgress}
                                            // Pass down disabled state and completer info
                                            isDisabled={isDisabled}
                                            completerName={actualCompleterName}
                                            choreTitle={chore.title} // Pass chore title for toast
                                            isNegative={isNegative} // +++ PASS NEGATIVE FLAG +++
                                            onToggle={() => {
                                                // Only allow toggle if not disabled
                                                if (!isDisabled) {
                                                    // Use new handler to check for incomplete tasks, passing allTasks for header detection
                                                    handleAvatarClick(chore, assignee.id, visibleTasks, allTasks);
                                                }
                                            }}
                                        />
                                    );
                                })}
                        </div>
                    );

                    // --- COMPONENT EXTRACTION: Render Details (Title, Desc, Labels) ---
                    const renderDetails = () => (
                        <div className="flex-grow flex flex-col min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    type="button"
                                    onClick={() => handleOpenChoreDetails(chore.id)}
                                    className={`truncate text-left font-medium transition-colors hover:text-sky-700 hover:underline ${
                                        upForGrabsCompletedByOther && selectedMember !== 'All' ? 'text-muted-foreground line-through' : ''
                                    }`}
                                >
                                    {chore.title}
                                </button>
                                {/* +++ ADDED: "with..." Text +++ */}
                                {withOthersText && <span className="text-xs text-muted-foreground whitespace-nowrap">{withOthersText}</span>}

                                <span className="text-xs text-muted-foreground whitespace-nowrap">XP: {chore.weight ?? 0}</span>
                                {/* +++ ADDED: Up for Grabs Label +++ */}
                                {chore.isUpForGrabs && (
                                    <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0 border border-green-200">
                                        Up for Grabs
                                    </span>
                                )}
                                {hasTaskSeries && pageMode === 'chores' && (
                                    <Link
                                        href={buildTasksHref(chore.id)}
                                        className="text-[10px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full whitespace-nowrap hover:bg-sky-200 transition-colors"
                                    >
                                        Tasks
                                    </Link>
                                )}
                                {/* Updated: Render Label for each Active Task Series */}
                                {pageMode === 'tasks' &&
                                    chore.taskSeries?.map((series: any) => {
                                    // 1. Identify Owner
                                    const rawOwner = series.familyMember?.[0] || series.familyMember;
                                    const ownerId = rawOwner?.id;

                                    // 2. Strict Display Logic
                                    // If a specific member is selected in sidebar, AND this series belongs to someone else -> HIDE
                                    if (selectedMember !== 'All' && ownerId && ownerId !== selectedMember) {
                                        return null;
                                    }

                                    // If 'All' is selected, BUT the owner is not assigned to this chore TODAY -> HIDE
                                    // (e.g. Rotation has moved to someone else)
                                    if (selectedMember === 'All' && ownerId) {
                                        const isOwnerAssignedToday = assignedMembers.some((m) => m.id === ownerId);
                                        if (!isOwnerAssignedToday) return null;
                                    }

                                    // 3. Time Activity Check
                                    const isActive = isSeriesActiveForDate(
                                        series.tasks || [],
                                        chore.rrule || null,
                                        chore.startDate,
                                        safeSelectedDate,
                                        series.startDate || null,
                                        chore.exdates || null
                                    );

                                    if (isActive) {
                                        return (
                                            <span
                                                key={series.id}
                                                className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full cursor-pointer hover:bg-blue-200 transition-colors whitespace-nowrap"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (onEditTaskSeries) onEditTaskSeries(series.id);
                                                }}
                                            >
                                                {series.name}
                                            </span>
                                        );
                                    }
                                    return null;
                                })}
                            </div>

                            {/* +++ SHOW DESCRIPTION CONDITIONALLY +++ */}
                            {showChoreDescriptions && chore.description && <div className="text-xs text-muted-foreground mt-0.5">{chore.description}</div>}
                        </div>
                    );

                    // --- COMPONENT EXTRACTION: Render Buttons ---
                    const renderButtons = () => (
                        <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteChore(chore.id)} className={!canEditChores ? 'opacity-50' : ''}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </div>
                    );

                    // --- COMPONENT EXTRACTION: Render Task Series ---
                    const renderTaskSeries = () => {
                        const renderableSeries = (chore.taskSeries || [])
                            .map((series: any) => {
                                const rawOwner = series.familyMember?.[0] || series.familyMember;
                                const ownerId = rawOwner?.id;
                                const ownerName = rawOwner?.name;

                                if (ownerId) {
                                    const isOwnerAssignedToday = assignedMembers.some((m) => m.id === ownerId);
                                    if (!isOwnerAssignedToday) return null;
                                }

                                if (selectedMember !== 'All' && ownerId && ownerId !== selectedMember) {
                                    return null;
                                }

                                const allTasks = series.tasks || [];
                                const tasks = getTasksForDate(
                                    allTasks,
                                    chore.rrule,
                                    chore.startDate,
                                    safeSelectedDate,
                                    series.startDate,
                                    chore.exdates || null
                                );
                                const bucketCounts = getTaskBucketCounts(allTasks);
                                const hasBucketedTasks = Object.values(bucketCounts).some((count) => count > 0);
                                const isUpForGrabsDisabled = chore.isUpForGrabs && upForGrabsCompletedByOther && ownerId && ownerId !== completerIdActual;

                                if ((!tasks.length && !hasBucketedTasks) || isUpForGrabsDisabled) return null;

                                return {
                                    series,
                                    ownerId,
                                    ownerName,
                                    allTasks,
                                    tasks,
                                    hasBucketedTasks,
                                };
                            })
                            .filter(Boolean) as Array<{
                            series: any;
                            ownerId?: string;
                            ownerName?: string;
                            allTasks: Task[];
                            tasks: Task[];
                            hasBucketedTasks: boolean;
                        }>;

                        if (renderableSeries.length === 0) return null;

                        return (
                            <div className="flex flex-col gap-2 mt-2 w-full pl-2">
                                {renderableSeries.map(({ series, ownerId, ownerName, allTasks, tasks }) => {
                                    const seriesToggleKey = `${chore.id}:${series.id}`;
                                    const actionableTasks = tasks.filter((task) => isActionableTask(task, allTasks));
                                    const previewTasks = actionableTasks.slice(0, 2);
                                    const remainingCount = Math.max(0, actionableTasks.length - previewTasks.length);
                                    const memberKey = selectedMember === 'All' ? 'All' : selectedMember;
                                    const hasMoreThanTwoTasks = tasks.length > 2;
                                    const isExpanded = !hasMoreThanTwoTasks
                                        ? true
                                        : selectedMember === 'All'
                                          ? (expandedTaskSeriesInAllView[seriesToggleKey] ?? false)
                                          : (expandedTaskSeriesByMember[memberKey]?.[seriesToggleKey] ?? true);
                                    const visibleTasks = hasMoreThanTwoTasks && !isExpanded ? tasks.slice(0, 2) : tasks;

                                    const handleTaskSeriesVisibilityToggle = () => {
                                        if (!hasMoreThanTwoTasks) return;
                                        if (selectedMember === 'All') {
                                            setExpandedTaskSeriesInAllView((prev) => ({
                                                ...prev,
                                                [seriesToggleKey]: !isExpanded,
                                            }));
                                            return;
                                        }

                                        setExpandedTaskSeriesByMember((prev) => ({
                                            ...prev,
                                            [memberKey]: {
                                                ...(prev[memberKey] || {}),
                                                [seriesToggleKey]: !isExpanded,
                                            },
                                        }));
                                    };

                                    if (pageMode === 'chores') {
                                        return (
                                            <div key={series.id} className="border-t pt-2 mt-1 first:border-t-0 first:mt-0">
                                                {selectedMember === 'All' && ownerName && assignedMembers.length > 1 && (
                                                    <div className="mb-1 pl-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                                                        {ownerName}'s Tasks
                                                    </div>
                                                )}
                                                <div className="rounded-lg border border-sky-100 bg-white/80 p-2">
                                                    {previewTasks.length > 0 ? (
                                                        <div className="space-y-2">
                                                            {previewTasks.map((task) => (
                                                                <div key={task.id} className="flex items-center gap-3">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isTaskDone(task)}
                                                                        disabled={isPastDate}
                                                                        onChange={() => {
                                                                            void handleTaskPreviewToggle(task, allTasks, chore, { id: series.id, ownerId });
                                                                        }}
                                                                        className="h-4 w-4 rounded border border-slate-300"
                                                                    />
                                                                    <Link
                                                                        href={buildTasksHref(chore.id)}
                                                                        className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 hover:text-sky-700 hover:underline"
                                                                    >
                                                                        {task.text}
                                                                    </Link>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ) : (
                                                        <div className="text-xs text-muted-foreground">Open tasks for the full task-series view.</div>
                                                    )}

                                                    <div className="mt-3 flex items-center gap-3 text-[11px] font-medium">
                                                        <Link href={buildTasksHref(chore.id)} className="text-sky-700 hover:text-sky-800 hover:underline">
                                                            Open Tasks
                                                        </Link>
                                                        {remainingCount > 0 && (
                                                            <Link href={buildTasksHref(chore.id)} className="text-sky-700 hover:text-sky-800 hover:underline">
                                                                {remainingCount}+ more
                                                            </Link>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }

                                    return (
                                        <div key={series.id} className="border-t pt-2 mt-1 first:border-t-0 first:mt-0">
                                            {selectedMember === 'All' && ownerName && assignedMembers.length > 1 && (
                                                <div className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-wider pl-1">
                                                    {ownerName}'s Checklist
                                                </div>
                                            )}

                                            <TaskSeriesChecklist
                                                tasks={visibleTasks}
                                                allTasks={allTasks}
                                                onToggle={(taskId, status) => handleTaskToggle(taskId, status, allTasks, chore, { id: series.id, ownerId })}
                                                onTaskUpdate={(taskId, input) => handleTaskUpdate(taskId, input, allTasks, chore, { id: series.id, ownerId })}
                                            canWriteTaskProgress={!!currentUser}
                                            onRequireTaskAuth={() =>
                                                toast({
                                                    title: 'Login Required',
                                                    description: 'Please log in before starting or updating task progress.',
                                                    variant: 'destructive',
                                                })
                                            }
                                            familyMemberNamesById={familyMemberNamesById}
                                            isReadOnly={isPastDate}
                                            selectedMember={selectedMember}
                                            showDetails={showDetails}
                                                isParentReviewer={canEditChores}
                                            />

                                            {hasMoreThanTwoTasks && (
                                                <button
                                                    type="button"
                                                    className="mt-1 ml-1 text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
                                                    onClick={handleTaskSeriesVisibilityToggle}
                                                >
                                                    {isExpanded ? 'hide tasks' : 'view more'}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    };

                    const taskSeriesContent = renderTaskSeries();
                    if (pageMode === 'tasks' && !taskSeriesContent) {
                        return null;
                    }

                    return (
                        <li
                            key={chore.id}
                            id={`chore-${chore.id}`}
                            className={cn(
                                'mb-2 flex flex-col rounded bg-gray-50 p-2',
                                focusedChoreId === chore.id && 'ring-2 ring-sky-300 ring-offset-2 ring-offset-background'
                            )}
                        >
                            {/* --- DESKTOP VIEW (Hidden on Mobile) --- */}
                            <div className="hidden md:flex items-center">
                                <div className="flex space-x-2 mr-4">{renderAvatars()}</div>
                                {renderDetails()}
                                {renderButtons()}
                            </div>

                            {/* --- MOBILE VIEW (Visible on Mobile) --- */}
                            {selectedMember === 'All' ? (
                                // Mobile "All" View: Card Layout
                                <div className="flex md:hidden flex-col gap-2">
                                    {/* Row 1: Title/XP + Buttons */}
                                    <div className="flex justify-between items-start">
                                        <div className="flex-1 mr-2">{renderDetails()}</div>
                                        {renderButtons()}
                                    </div>
                                    {/* Row 2: Avatars */}
                                    <div className="mt-1">{renderAvatars()}</div>
                                </div>
                            ) : (
                                // Mobile "Single" View: Horizontal Flex
                                <div className="flex md:hidden gap-3">
                                    {/* Left: Avatar */}
                                    <div className="flex-shrink-0 pt-1">{renderAvatars()}</div>
                                    {/* Right: Content */}
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <div className="flex justify-between items-start mb-1">
                                            {renderDetails()}
                                            {renderButtons()}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* --- Task Series (Shared across views, just rendered below) --- */}
                            {taskSeriesContent}
                        </li>
                    );
                })}
            </ul>
            {/* --- Modals --- */}
            <Dialog open={editingChore !== null} onOpenChange={() => setEditingChore(null)}>
                <DialogContent className="sm:max-w-[500px]">
                    {' '}
                    {/* Use width from ChoreTracker */}
                    <DialogHeader>
                        <DialogTitle>Edit Chore</DialogTitle>
                    </DialogHeader>
                    {editingChore && (
                        <DetailedChoreForm
                            familyMembers={familyMembers}
                            onSave={handleUpdateChore}
                            onScheduleAction={handleScheduleUpdate}
                            initialChore={editingChore}
                            initialDate={selectedDate} // Pass selectedDate
                            // +++ Pass props down +++
                            db={db}
                            unitDefinitions={unitDefinitions}
                            currencyOptions={currencyOptions}
                        />
                    )}
                </DialogContent>
            </Dialog>
            <ChoreDetailDialog
                chore={detailChore}
                familyMembers={familyMembers}
                open={detailChore !== null}
                onOpenChange={(open) => {
                    if (!open) setDetailChoreId(null);
                }}
                onEdit={handleEditFromDetails}
                selectedDate={safeSelectedDate}
                selectedMember={selectedMember}
            />
            <Dialog open={pendingCompletion !== null} onOpenChange={(open) => !open && setPendingCompletion(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Unfinished Tasks</DialogTitle>
                        <DialogDescription>
                            There are still unchecked tasks in this series for today. Do you want to mark them all as done and complete the chore?
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPendingCompletion(null)}>
                            Cancel
                        </Button>
                        <Button onClick={confirmMarkAllAndComplete}>Mark All Done & Complete</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {/* +++ Delete Confirmation Dialog +++ */}
            <Dialog open={!!choreToDelete} onOpenChange={(open) => !open && setChoreToDelete(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Delete Chore</DialogTitle>
                        <DialogDescription>Are you sure you want to delete this chore? This action cannot be undone.</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setChoreToDelete(null)}>
                            Cancel
                        </Button>
                        <Button variant="destructive" onClick={confirmDeleteChore}>
                            Delete
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </ScrollArea>
    );
}

export default ChoreList;
