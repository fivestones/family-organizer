import React from 'react';
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Edit, Trash2 } from "lucide-react";
import { createRRule, getNextOccurrence } from '@/lib/chore-utils';
import { RRule } from 'rrule';
import next from 'next';

function ChoreList({ chores, familyMembers, selectedMember, toggleChoreDone, updateChore, deleteChore }) {
  const today = new Date();

  const shouldShowChore = (chore) => {
    if (!chore.rrule) return true; // Non-recurring chores always show

    console.log("chore", chore);
    console.log("chore.rrule", chore.rrule);
        
    // Remove surrounding quotes and "RRULE:" prefix if they exist
    let rruleString = chore.rrule.trim();
    if (rruleString.startsWith('"') && rruleString.endsWith('"')) {
      rruleString = rruleString.slice(1, -1);
    }
    rruleString = rruleString.startsWith("RRULE:") ? rruleString.slice(6) : rruleString;
    console.log("rrule string: ", rruleString);
    
    // Use RRule.fromString with the cleaned rrule string
    const rrule = RRule.fromString(rruleString);
    console.log("rrule: ", rrule)
    const nextOccurrence = getNextOccurrence(rrule, today);
    console.log("nextOccurrence: ", nextOccurrence);

    // Show the chore if its next occurrence is today
    return (
      nextOccurrence &&
      nextOccurrence.getDate() === today.getDate() &&
      nextOccurrence.getMonth() === today.getMonth() &&
      nextOccurrence.getFullYear() === today.getFullYear()
    );
  };

  const filteredChores = chores.filter(shouldShowChore);

  return (
    <ScrollArea className="h-[calc(100vh-200px)]">
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