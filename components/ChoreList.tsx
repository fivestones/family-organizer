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
import { getTasksForDate, Task, getRecursiveTaskCompletionTransactions } from '@/lib/task-scheduler'; // Added getRecursiveTaskCompletionTransactions
import { TaskSeriesChecklist } from './TaskSeriesChecklist';

// +++ Accept new props passed down from ChoresTracker +++
function ChoreList({ chores, familyMembers, selectedMember, selectedDate, toggleChoreDone, updateChore, deleteChore, db, unitDefinitions, currencyOptions }) {
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

    const isToday = isSameDay(safeSelectedDate, toUTCDate(new Date()));

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
        // Calculate recursive transactions
        const transactions = getRecursiveTaskCompletionTransactions(taskId, !currentStatus, allTasks);
        db.transact(transactions);
    };

    const handleAvatarClick = (chore, memberId, visibleTasks: Task[]) => {
        // 1. Check if already done?
        const isDone = chore.completions?.some((c) => c.completedBy?.[0]?.id === memberId && c.dateDue === formattedSelectedDate && c.completed);

        if (isDone) {
            // Unchecking is always allowed
            toggleChoreDone(chore.id, memberId);
            return;
        }

        // 2. Check for incomplete tasks in the CURRENT visible block
        // If there are no visible tasks (e.g. standard chore), this is empty and we skip the check
        const incompleteIds = visibleTasks.filter((t) => !t.isCompleted).map((t) => t.id);

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

        // Batch transaction: Mark tasks done
        const transactions = incompleteTaskIds.map((tid) => tx.tasks[tid].update({ isCompleted: true, completedAt: new Date() }));

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
                                            const taskSeries = chore.taskSeries?.[0];
                                            let visibleTasks: Task[] = [];
                                            if (taskSeries && taskSeries.tasks) {
                                                visibleTasks = getTasksForDate(
                                                    taskSeries.tasks,
                                                    chore.rrule,
                                                    chore.startDate,
                                                    safeSelectedDate,
                                                    taskSeries.startDate // <--- PASS SERIES START DATE
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
                                                            // Use new handler to check for incomplete tasks
                                                            handleAvatarClick(chore, assignee.id, visibleTasks);
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
                                    {chore.taskSeries?.[0] && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Series</span>}
                                </span>
                                <Button variant="ghost" size="icon" onClick={() => handleEditChore(chore)}>
                                    <Edit className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => deleteChore(chore.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>

                            {/* --- Render Task Series Checklist --- */}
                            {(() => {
                                // Logic to decide which tasks to show below the header
                                // If 'All' is selected, we generally show the first relevant person's tasks or none to avoid clutter.
                                // If a specific member is selected, we show theirs.
                                const relevantAssignee = selectedMember !== 'All' ? assignedMembers.find((m) => m.id === selectedMember) : assignedMembers[0];

                                if (relevantAssignee && chore.taskSeries?.[0]) {
                                    const allTasks = chore.taskSeries[0].tasks || [];
                                    const tasks = getTasksForDate(
                                        allTasks,
                                        chore.rrule,
                                        chore.startDate,
                                        safeSelectedDate,
                                        chore.taskSeries[0].startDate // <--- PASS SERIES START DATE
                                    );

                                    // Don't render if empty or if up-for-grabs disabled it for this user
                                    const isUpForGrabsDisabled = chore.isUpForGrabs && upForGrabsCompletedByOther && relevantAssignee.id !== completerIdActual;

                                    if (tasks.length > 0 && !isUpForGrabsDisabled) {
                                        return (
                                            <TaskSeriesChecklist
                                                tasks={tasks}
                                                allTasks={allTasks}
                                                onToggle={(taskId, status) => handleTaskToggle(taskId, status, allTasks)}
                                                isReadOnly={!isToday}
                                            />
                                        );
                                    }
                                }
                            })()}
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
