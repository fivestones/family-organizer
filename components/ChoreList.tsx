import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Edit, Trash2 } from 'lucide-react';
import { createRRuleWithStartDate, getAssignedMembersForChoreOnDate, toUTCDate } from '@/lib/chore-utils';
import { format } from 'date-fns';
import ToggleableAvatar from '@/components/ui/ToggleableAvatar';
import DetailedChoreForm from './DetailedChoreForm';

// +++ Accept new props passed down from ChoresTracker +++
function ChoreList({ chores, familyMembers, selectedMember, selectedDate, toggleChoreDone, updateChore, deleteChore, db, unitDefinitions, currencyOptions }) {
    const [editingChore, setEditingChore] = useState(null);
    const safeSelectedDate =
        selectedDate instanceof Date && !isNaN(selectedDate.getTime())
            ? new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate()))
            : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

    const isSameDay = (date1, date2) => {
        return date1.getUTCFullYear() === date2.getUTCFullYear() && date1.getUTCMonth() === date2.getUTCMonth() && date1.getUTCDate() === date2.getUTCDate();
    };

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

    const formattedSelectedDate = format(safeSelectedDate, 'yyyy-MM-dd'); // Use safeSelectedDate

    const handleEditChore = (chore) => {
        setEditingChore(chore);
    };

    const handleUpdateChore = (updatedChore) => {
        if (editingChore?.id) {
            // Ensure editingChore is not null
            updateChore(editingChore.id, updatedChore);
        }
        setEditingChore(null);
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
                        <li key={chore.id} className="mb-2 p-2 bg-gray-50 rounded flex items-center">
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
                                                        toggleChoreDone(chore.id, assignee.id);
                                                    }
                                                }}
                                            />
                                        );
                                    })}
                            </div>
                            {/* +++ Gray out title if disabled (only when a single member is selected) +++ */}
                            <span className={`flex-grow ${upForGrabsCompletedByOther && selectedMember !== 'All' ? 'text-muted-foreground line-through' : ''}`}>
                                {chore.title}
                                {chore.rrule && <span className="ml-2 text-sm text-gray-500">(Recurring)</span>}
                            </span>
                            <Button variant="ghost" size="icon" onClick={() => handleEditChore(chore)}>
                                <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => deleteChore(chore.id)}>
                                <Trash2 className="h-4 w-4" />
                            </Button>
                        </li>
                    );
                })}
            </ul>
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
        </ScrollArea>
    );
}

export default ChoreList;
