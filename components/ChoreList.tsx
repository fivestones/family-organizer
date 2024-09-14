import React from 'react';
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Edit, Trash2 } from "lucide-react";
import { RRule } from 'rrule';

function ChoreList({ chores, familyMembers, selectedMember, selectedDate, toggleChoreDone, updateChore, deleteChore }) {
  // Ensure selectedDate is a valid UTC Date object
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
      // For non-recurring chores, convert the chore's start date to UTC
      const choreDate = new Date(chore.startDate);
      const utcChoreDate = new Date(Date.UTC(choreDate.getUTCFullYear(), choreDate.getUTCMonth(), choreDate.getUTCDate()));
      return isSameDay(utcChoreDate, safeSelectedDate);
    }

    // For recurring chores
    let rruleString = chore.rrule.trim();
    if (rruleString.startsWith('"') && rruleString.endsWith('"')) {
      rruleString = rruleString.slice(1, -1);
    }
    rruleString = rruleString.startsWith("RRULE:") ? rruleString.slice(6) : rruleString;

    const rrule = RRule.fromString(rruleString);

    // Convert chore start date to UTC
    const choreStartDate = new Date(chore.startDate);
    const utcChoreStartDate = new Date(Date.UTC(
      choreStartDate.getUTCFullYear(),
      choreStartDate.getUTCMonth(),
      choreStartDate.getUTCDate()
    ));
    rrule.options.dtstart = utcChoreStartDate;

    // Check for occurrences on the selected date
    const selectedDayStart = new Date(safeSelectedDate);
    const selectedDayEnd = new Date(safeSelectedDate);
    selectedDayEnd.setUTCDate(selectedDayEnd.getUTCDate() + 1);

    const occurrences = rrule.between(selectedDayStart, selectedDayEnd, true);

    return occurrences.some(date => isSameDay(date, safeSelectedDate));
  };

  const filteredChores = chores.filter(shouldShowChore);


  return (
    <ScrollArea className="h-[calc(100vh-300px)]">
      <ul>
        {filteredChores.map(chore => (
          <li key={chore.id} className="mb-2 p-2 bg-gray-50 rounded flex items-center">
            <Checkbox
              checked={chore.done}
              onCheckedChange={() => toggleChoreDone(chore.id)}
              className="mr-2"
            />
            <span className={`flex-grow ${chore.done ? 'line-through text-gray-500' : ''}`}>
              {chore.title}
              {selectedMember === 'All' && chore.assignees && (
                <span className="ml-2 text-sm text-gray-500">
                  ({chore.assignees.map(assignee => 
                    familyMembers.find(m => m.id === assignee.id)?.name
                  ).join(', ')})
                </span>
              )}
              {chore.rrule && (
                <span className="ml-2 text-sm text-gray-500">
                  (Recurring)
                </span>
              )}
            </span>
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Edit className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                {/* Placeholder for ChoreDetailView */}
                <div>Chore Detail View (Not implemented)</div>
              </DialogContent>
            </Dialog>
            <Button variant="ghost" size="icon" onClick={() => deleteChore(chore.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}

export default ChoreList;