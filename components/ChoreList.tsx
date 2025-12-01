// components/ChoreList.tsx
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Edit, Trash2 } from 'lucide-react';
import { createRRuleWithStartDate, getAssignedMembersForChoreOnDate, toUTCDate } from '@/lib/chore-utils';
import { format } from 'date-fns';
import ToggleableAvatar from '@/components/ui/ToggleableAvatar';
import DetailedChoreForm from './DetailedChoreForm';
import { tx } from '@instantdb/react';
import { getTasksForDate, Task, getRecursiveTaskCompletionTransactions, isSeriesActiveForDate } from '@/lib/task-scheduler'; // Added getRecursiveTaskCompletionTransactions and isSeriesActiveForDate
import { TaskSeriesChecklist } from './TaskSeriesChecklist';

// Helper: Check if a task functions as a header (has visible children)
const hasScheduledChildren = (parentId: string, scheduledIds: Set<string>, allTasks: any[]) => {
    return allTasks.some((t) => t.parentTask?.[0]?.id === parentId && scheduledIds.has(t.id));
};

// +++ Accept new props passed down from ChoresTracker +++
function ChoreList({
    chores,
    familyMembers,
    selectedMember,
    selectedDate,
    toggleChoreDone,
    updateChore,
    deleteChore,
    db,
    unitDefinitions,
    currencyOptions,
    onEditTaskSeries,
}: any) {
    const [editingChore, setEditingChore] = useState(null);

    // Guardrail State for Task Series
    const [pendingCompletion, setPendingCompletion] = useState<{
        choreId: string;
        memberId: string;
        incompleteTaskIds: string[];
    } | null>(null);

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

    const shouldShowChore = (chore) => {
        if (!chore.rrule) {
            // Handle potential invalid date string in chore.startDate
            try {
                const choreDate = toUTCDate(new Date(chore.startDate));
                return isSameDay(choreDate, safeSelectedDate);
            } catch (e) {
                console.error('Invalid chore start date:', chore.startDate, chore.id);
                return false;
            }
        }

        try {
            const rrule = createRRuleWithStartDate(chore.rrule, chore.startDate);
            if (!rrule) return false; // Handle invalid rrule gracefully

            const selectedDayStart = new Date(safeSelectedDate);
            // Adjust end date for 'between' to correctly include the selected day
            const selectedDayEnd = new Date(
                Date.UTC(safeSelectedDate.getUTCFullYear(), safeSelectedDate.getUTCMonth(), safeSelectedDate.getUTCDate(), 23, 59, 59, 999)
            );

            const occurrences = rrule.between(selectedDayStart, selectedDayEnd, true);

            // Check if any occurrence date matches the selected date (day, month, year)
            return occurrences.some((date) => isSameDay(toUTCDate(date), safeSelectedDate));
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

    const handleEditChore = (chore) => {
        setEditingChore(chore);
    };

    const handleUpdateChore = (updatedChore) => {
        if (editingChore?.id) {
            // Ensure editingChore is not null
            // updateChore(editingChore.id, updatedChore);
            updateChore(editingChore.id, updatedChore);
        }
        setEditingChore(null);
    };

    // --- Task Series Logic Helpers ---

    const handleTaskToggle = (taskId: string, currentStatus: boolean, allTasks: Task[]) => {
        // FIX: Pass formattedSelectedDate (YYYY-MM-DD) to lock the completion to the viewed day
        const transactions = getRecursiveTaskCompletionTransactions(taskId, !currentStatus, allTasks, formattedSelectedDate);
        db.transact(transactions);
    };

    // Updated: Accepts allTasks to properly identify parent/header relationships
    const handleAvatarClick = (chore, memberId, visibleTasks: Task[], allTasks: Task[]) => {
        // 1. Check if already done?
        const isDone = chore.completions?.some((c) => c.completedBy?.[0]?.id === memberId && c.dateDue === formattedSelectedDate && c.completed);

        if (isDone) {
            // Unchecking is always allowed
            toggleChoreDone(chore.id, memberId);
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
            toggleChoreDone(chore.id, memberId);
        }
    };

    const confirmMarkAllAndComplete = () => {
        if (!pendingCompletion) return;

        const { choreId, memberId, incompleteTaskIds } = pendingCompletion;

        // FIX: Update batch transaction to include completedOnDate
        const transactions = incompleteTaskIds.map((tid) =>
            tx.tasks[tid].update({
                isCompleted: true,
                completedAt: new Date(),
                completedOnDate: formattedSelectedDate, // <--- SAVE IT HERE TOO
            })
        );

        db.transact(transactions);

        // Small delay to allow DB to process tasks before completing chore
        setTimeout(() => {
            toggleChoreDone(choreId, memberId);
        }, 50);

        setPendingCompletion(null);
    };

    return (
        <ScrollArea className="grow min-h-0">
            {' '}
            {/* grow min-h-0 on ScrollArea: This makes the ScrollArea itself the expanding element within its direct parent (<div className="flex flex-col gap-6 grow min-h-0">). It will take up the space not used by the allowance balance section. The ScrollArea component (assuming it's from Shadcn UI or similar) internally handles overflow-y: auto;, so when its content exceeds the calculated height it receives from grow, a scrollbar will appear within the ScrollArea. */}
            <ul>
                {filteredChores.map((chore) => {
                    // Determine assigned members for THIS specific date
                    const assignedMembers = getAssignedMembersForChoreOnDate(chore, safeSelectedDate);
                    // +++ Check if UpForGrabs and completed by someone else +++
                    let upForGrabsCompletedByOther = false;
                    let completerName = '';
                    let completerIdActual: string | null = null; // Store ID of actual completer
                    if (chore.isUpForGrabs) {
                        // Find the first completion for this chore on this date
                        const completionOnDate = (chore.completions || []).find((c) => c.dateDue === formattedSelectedDate && c.completed);
                        if (completionOnDate) {
                            completerIdActual = completionOnDate.completedBy?.[0]?.id;
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

                    return (
                        <li key={chore.id} className="mb-2 p-2 bg-gray-50 rounded flex flex-col">
                            <div className="flex items-center">
                                <div className="flex space-x-2 mr-4">
                                    {assignedMembers
                                        // Filter avatars based on selectedMember OR show all if 'All'
                                        .filter((assignee) => selectedMember === 'All' || assignee.id === selectedMember)
                                        .map((assignee) => {
                                            const completion = chore.completions?.find(
                                                (c) => c.completedBy?.[0]?.id === assignee.id && c.dateDue === formattedSelectedDate // Safer check for completedBy
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
                                                return !owner;
                                            });

                                            // 3. Selection: Specific > Shared > None
                                            // (We REMOVED the fallback to index [0] to prevent Bob getting Alice's tasks)
                                            const targetSeries = userSeries || sharedSeries;

                                            if (targetSeries && targetSeries.tasks) {
                                                allTasks = targetSeries.tasks;
                                                visibleTasks = getTasksForDate(
                                                    allTasks,
                                                    chore.rrule,
                                                    chore.startDate,
                                                    safeSelectedDate,
                                                    targetSeries.startDate // <--- PASS SERIES START DATE
                                                );
                                            }

                                            return (
                                                <ToggleableAvatar
                                                    key={assignee.id}
                                                    name={assignee.name}
                                                    photoUrls={familyMember?.photoUrls}
                                                    isComplete={completion?.completed || false}
                                                    // Pass down disabled state and completer info
                                                    isDisabled={isDisabled}
                                                    completerName={actualCompleterName}
                                                    choreTitle={chore.title} // Pass chore title for toast
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
                                {/* +++ Gray out title if disabled (only when a single member is selected) +++ */}
                                <span
                                    className={`flex-grow ${
                                        upForGrabsCompletedByOther && selectedMember !== 'All' ? 'text-muted-foreground line-through' : ''
                                    }`}
                                >
                                    {chore.title}
                                    {chore.rrule && <span className="ml-2 text-sm text-gray-500">(Recurring)</span>}
                                    {/* Updated: Render Label for each Active Task Series */}
                                    {chore.taskSeries?.map((series: any) => {
                                        // Determine if this series is active for the current date
                                        const isActive = isSeriesActiveForDate(
                                            series.tasks || [],
                                            chore.rrule || null,
                                            chore.startDate,
                                            safeSelectedDate,
                                            series.startDate || null
                                        );

                                        if (isActive) {
                                            return (
                                                <span
                                                    key={series.id}
                                                    className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full cursor-pointer hover:bg-blue-200 transition-colors"
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
                                </span>
                                <Button variant="ghost" size="icon" onClick={() => handleEditChore(chore)}>
                                    <Edit className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => deleteChore(chore.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>

                            {/* --- Render Task Series Checklist(s) --- */}
                            <div className="flex flex-col gap-2 mt-2 w-full">
                                {chore.taskSeries?.map((series: any) => {
                                    // 1. Identify the owner of this specific series
                                    // Handle both object (single link) and array (InstantDB relation) formats
                                    const rawOwner = series.familyMember?.[0] || series.familyMember;
                                    const ownerId = rawOwner?.id;
                                    const ownerName = rawOwner?.name;

                                    // 2. Filter Logic: Should we show this series?

                                    // A. If the series is assigned to a specific person,
                                    //    only show it if that person is currently assigned to the chore TODAY.
                                    //    (This hides "Bob's Series" on days where only Alice is on rotation).
                                    if (ownerId) {
                                        const isOwnerAssignedToday = assignedMembers.some((m) => m.id === ownerId);
                                        if (!isOwnerAssignedToday) return null;
                                    }

                                    // B. Apply the global "Selected Member" filter
                                    //    If a specific person is picked in the sidebar, hide everyone else's series.
                                    if (selectedMember !== 'All' && ownerId && ownerId !== selectedMember) {
                                        return null;
                                    }

                                    // 3. Calculate Tasks for this specific series
                                    const allTasks = series.tasks || [];
                                    const tasks = getTasksForDate(
                                        allTasks,
                                        chore.rrule, // Use the Chore's recurrence
                                        chore.startDate, // Use the Chore's start date
                                        safeSelectedDate,
                                        series.startDate // Use the Series specific start date
                                    );

                                    // 4. Check if Up-For-Grabs logic disables this
                                    //    (Only applies if specific user logic is active)
                                    const isUpForGrabsDisabled = chore.isUpForGrabs && upForGrabsCompletedByOther && ownerId && ownerId !== completerIdActual;

                                    if (tasks.length === 0 || isUpForGrabsDisabled) return null;

                                    return (
                                        <div key={series.id} className="border-t pt-2 mt-1 first:border-t-0 first:mt-0">
                                            {/* Header: Only show if we are in 'All' view to distinguish lists */}
                                            {selectedMember === 'All' && ownerName && (
                                                <div className="text-[10px] font-bold text-muted-foreground mb-1 uppercase tracking-wider pl-1">
                                                    {ownerName}'s Checklist
                                                </div>
                                            )}

                                            <TaskSeriesChecklist
                                                tasks={tasks}
                                                allTasks={allTasks}
                                                onToggle={(taskId, status) => handleTaskToggle(taskId, status, allTasks)}
                                                isReadOnly={!isToday}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
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
        </ScrollArea>
    );
}

export default ChoreList;
