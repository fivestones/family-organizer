import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Edit, Trash2 } from "lucide-react";
import { createRRuleWithStartDate, getAssignedMembersForChoreOnDate, toUTCDate } from '@/lib/chore-utils';
import { format } from 'date-fns';
import ToggleableAvatar from '@/components/ui/ToggleableAvatar';
import DetailedChoreForm from './DetailedChoreForm';

function ChoreList({ chores, familyMembers, selectedMember, selectedDate, toggleChoreDone, updateChore, deleteChore }) {
  
  const [editingChore, setEditingChore] = useState(null);
  const safeSelectedDate = selectedDate instanceof Date && !isNaN(selectedDate.getTime()) 
    ? new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), selectedDate.getUTCDate()))
    : new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()));

  const isSameDay = (date1, date2) => {
    return date1.getUTCFullYear() === date2.getUTCFullYear() &&
           date1.getUTCMonth() === date2.getUTCMonth() &&
           date1.getUTCDate() === date2.getUTCDate();
  };

  const shouldShowChore = (chore) => {
    if (!chore.rrule) {
      const choreDate = new Date(chore.startDate);
      return isSameDay(choreDate, safeSelectedDate);
    }

    try {
      const rrule = createRRuleWithStartDate(chore.rrule, chore.startDate);

      const selectedDayStart = new Date(safeSelectedDate);
      const selectedDayEnd = new Date(safeSelectedDate);
      selectedDayEnd.setUTCDate(selectedDayEnd.getUTCDate() + 1);

      const occurrences = rrule.between(selectedDayStart, selectedDayEnd, true);

      return occurrences.some(date => isSameDay(date, safeSelectedDate));
    } catch (error) {
      console.error(`Error processing RRULE for chore ${chore.id}:`, error);
      return false;
    }
  };

  const filteredChores = chores.filter(chore => {
    if (!shouldShowChore(chore)) return false;
  
    // Get the assigned members for the chore on the selected date
    const assignedMembers = getAssignedMembersForChoreOnDate(chore, safeSelectedDate);
  
    // If 'All' is selected, include the chore
    if (selectedMember === 'All') {
      return true;
    } else {
      // Check if the selected member is assigned to this chore on the selected date
      return assignedMembers.some(assignee => assignee.id === selectedMember);
    }
  });
  
  const formattedSelectedDate = format(selectedDate, 'yyyy-MM-dd');

  const handleEditChore = (chore) => {
    setEditingChore(chore);
  };

  const handleUpdateChore = (updatedChore) => {
    updateChore(editingChore.id, updatedChore);
    setEditingChore(null);
  };

  return (
    <ScrollArea className="h-[calc(100vh-300px)]">
      <ul>
        {filteredChores.map(chore => {
          const assignedMembers = getAssignedMembersForChoreOnDate(chore, safeSelectedDate);
          return (
            <li key={chore.id} className="mb-2 p-2 bg-gray-50 rounded flex items-center">
              <div className="flex space-x-2 mr-4">
                {assignedMembers
                  .filter(assignee => selectedMember === 'All' || assignee.id === selectedMember)
                  .map(assignee => {
                    const completion = chore.completions?.find(
                      c => c.completedBy[0].id === assignee.id && c.dateDue === formattedSelectedDate
                    );
                    const familyMember = familyMembers.find(fm => fm.id === assignee.id);
                    return (
                      <ToggleableAvatar
                        key={assignee.id}
                        name={assignee.name}
                        photoUrl={familyMember?.photoUrl}
                        isComplete={completion?.completed || false}
                        onToggle={() => toggleChoreDone(chore.id, assignee.id)}
                      />
                    );
                  })}
              </div>
              <span className="flex-grow">
                {chore.title}
                {chore.rrule && (
                  <span className="ml-2 text-sm text-gray-500">
                    (Recurring)
                  </span>
                )}
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Chore</DialogTitle>
          </DialogHeader>
          {editingChore && (
            <DetailedChoreForm
              familyMembers={familyMembers}
              onSave={handleUpdateChore}
              initialChore={editingChore}
              initialDate={selectedDate}
            />
          )}
        </DialogContent>
      </Dialog>
    </ScrollArea>
  );
}

export default ChoreList;