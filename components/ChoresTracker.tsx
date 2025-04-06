'use client'

import React, { useState } from 'react';
import { init, tx, id } from '@instantdb/react';
// import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PlusCircle } from 'lucide-react';
import FamilyMembersList from './FamilyMembersList';
import ChoreList from './ChoreList';
import DetailedChoreForm from './DetailedChoreForm';
import DateCarousel from '@/components/ui/DateCarousel';
import { createRRuleWithStartDate, getNextOccurrence } from '@/lib/chore-utils';
import { format } from 'date-fns';
import { useToast } from "@/components/ui/use-toast";
import { getAssignedMembersForChoreOnDate } from '@/lib/chore-utils';
import AllowanceBalance from '@/components/AllowanceBalance';

// import { ScrollArea } from '@/components/ui/scroll-area';



// Define interfaces for our data structures
interface FamilyMember {
  id: string;
  name: string;
  email?: string;
  photoUrl?: string; // Legacy support if needed
  photoUrls?: {
    64?: string;
    320?: string;
    1200?: string;
  };
}

// Updated Chore interface
interface Chore {
  id: string;
  title: string;
  description?: string;
  startDate: number;
  done: boolean;
  rrule?: string;
  assignees: FamilyMember[];
  rotationType: 'none' | 'daily' | 'weekly' | 'monthly';
  assignments?: {
    order: number;
    familyMember: FamilyMember;
  }[];
}

type Schema = {
  familyMembers: FamilyMember;
  chores: Chore;
}

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4';
const db = init<Schema>({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});


function ChoresTracker() {
  const [selectedMember, setSelectedMember] = useState<string>('All');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [newChoreTitle, setNewChoreTitle] = useState<string>('');
  const [newChoreAssignee, setNewChoreAssignee] = useState<string>('');
  const [isDetailedChoreModalOpen, setIsDetailedChoreModalOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  });
  const { toast } = useToast();

  const { isLoading, error, data } = db.useQuery({
    familyMembers: {
      assignedChores: {
        completions: {},
      }
    },
    chores: {
      assignees: {},
      assignments: {
        familyMember: {},
      },
      completions: {
        completedBy: {}
      },
    },
  });

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;

  const { familyMembers, chores } = data;

  const addChore = (choreData: Partial<Chore>) => {
    const choreId = id();
    const transactions = [
      tx.chores[choreId].update({
        title: choreData.title!,
        description: choreData.description || '',
        startDate: new Date(choreData.startDate || Date.now()).toISOString(),
        done: false,
        rrule: choreData.rrule || null,
        rotationType: choreData.rotationType || 'none',
      }),
    ];
  
    if (choreData.rotationType !== 'none' && choreData.assignments && choreData.assignments.length > 0) {
      // Use assignments with rotation
      choreData.assignments.forEach((assignment, index) => {
        const assignmentId = id();
        transactions.push(
          tx.choreAssignments[assignmentId].update({
            order: assignment.order ?? index,
          }),
          tx.chores[choreId].link({ assignments: assignmentId }),
          tx.familyMembers[assignment.familyMember.id].link({ choreAssignments: assignmentId })
        );
      });
    }
    if (choreData.assignees && choreData.assignees.length > 0) {
      // Link assignees directly
      choreData.assignees.forEach(assignee => {
        transactions.push(
          tx.chores[choreId].link({ assignees: assignee.id }),
          tx.familyMembers[assignee.id].link({ assignedChores: choreId })
        );
      });
    } else {
      // Handle case where no assignees are selected
      console.warn('No assignees selected for the chore.');
    }
    
    db.transact(transactions);
    setIsDetailedChoreModalOpen(false);
  };

  const addFamilyMember = async (name: string, email: string | null, photoFile: File | null) => {
    if (!name) return;
  
    let photoUrls: { 64?: string; 320?: string; 1200?: string } | null = null;
  
    if (photoFile) {
      const formData = new FormData();
      formData.append('file', photoFile);
  
      try {
        const response = await fetch('/api/upload', {
          method: 'POST',
          body: formData,
        });
  
        if (!response.ok) throw new Error('Failed to upload photo');
  
        const data = await response.json();
  
        // Ensure that the response contains the expected properties
        photoUrls = {
          64: data.photoUrls[64] || '',
          320: data.photoUrls[320] || '',
          1200: data.photoUrls[1200] || '',
        };
      } catch (error) {
        console.error('Error uploading photo:', error);
        toast({
          title: 'Error',
          description: 'Failed to upload photo. Please try again.',
          variant: 'destructive',
        });
        return; // Stop execution if upload fails
      }
    }
  
    const memberId = id();
    const memberData: Partial<FamilyMember> = {
      name,
      email: email || '',
    };
  
    // Only add photoUrls if it is not null (i.e., a photo was uploaded)
    if (photoUrls) {
      memberData.photoUrls = photoUrls;
    }
  
    try {
      await db.transact([tx.familyMembers[memberId].update(memberData)]);
      toast({
        title: 'Success',
        description: 'Family member added successfully.',
      });
    } catch (error) {
      console.error('Error adding family member:', error);
      toast({
        title: 'Error',
        description: 'Failed to add family member. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const deleteFamilyMember = async (memberId) => {
    // Fetch the family member to get the photo URL
    const member = familyMembers.find((m) => m.id === memberId);
    if (member && member.photoUrl) {
      try {
        await fetch('/api/delete-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: member.photoUrl }),
        });
      } catch (error) {
        console.error('Error deleting photo:', error);
      }
    }
    await db.transact([tx.familyMembers[memberId].delete()]);
    if (selectedMember === memberId) {
      setSelectedMember('All');
    }
  };

  const toggleChoreDone = async (choreId: string, familyMemberId: string) => {
    const chore = chores.find(c => c.id === choreId);
    if (!chore) return;
  
    const formattedDate = format(selectedDate, 'yyyy-MM-dd');

    const existingCompletion = chore.completions.find(
      completion => completion.completedBy[0].id === familyMemberId &&
                    completion.dateDue === formattedDate
    );

    if (existingCompletion) {
      // Update existing completion
      db.transact([
        tx.choreCompletions[existingCompletion.id].update({
          completed: !existingCompletion.completed,
          dateCompleted: !existingCompletion.completed ? format(new Date(), 'yyyy-MM-dd') : null
        })
      ]);
    } else {
      // Create new completion
      const newCompletionId = id();
      db.transact([
        tx.choreCompletions[newCompletionId].update({
          dateDue: formattedDate,
          dateCompleted: format(new Date(), 'yyyy-MM-dd'),
          completed: true
        }),
        tx.chores[choreId].link({ completions: newCompletionId }),
        tx.familyMembers[familyMemberId].link({ completedChores: newCompletionId })
      ]);
    }
  };

const updateChore = async (choreId, updatedChore) => {
  try {
    const transactions = [
      tx.chores[choreId].update({
        title: updatedChore.title,
        description: updatedChore.description,
        startDate: updatedChore.startDate,
        rrule: updatedChore.rrule,
        rotationType: updatedChore.rotationType,
      }),
    ];

    // Remove existing assignments and assignees using existing data
    const existingChore = data.chores.find(c => c.id === choreId);

    if (existingChore) {
      // Remove assignments
      existingChore.assignments?.forEach(assignment => {
        transactions.push(tx.choreAssignments[assignment.id].delete());
      });

      // Remove assignees
      existingChore.assignees?.forEach(assignee => {
        transactions.push(tx.chores[choreId].unlink({ assignees: assignee.id }));
      });
    }

    // Add new assignments or assignees
    if (
      updatedChore.rotationType !== 'none' &&
      updatedChore.assignments &&
      updatedChore.assignments.length > 0
    ) {
      updatedChore.assignments.forEach((assignment, index) => {
        const assignmentId = id();
        transactions.push(
          tx.choreAssignments[assignmentId].update({
            order: index,
          }),
          tx.chores[choreId].link({ assignments: assignmentId }),
          tx.familyMembers[assignment.familyMember.id].link({ choreAssignments: assignmentId })
        );
      });
    }

    // Always link assignees
    if (updatedChore.assignees && updatedChore.assignees.length > 0) {
      updatedChore.assignees.forEach(assignee => {
        transactions.push(
          tx.chores[choreId].link({ assignees: assignee.id }),
          tx.familyMembers[assignee.id].link({ assignedChores: choreId })
        );
      });
    } else {
      console.warn('No assignees selected for the chore.');
    }

    await db.transact(transactions);

    toast({
      title: "Success",
      description: "Chore updated successfully.",
    });
  } catch (error) {
    toast({
      title: "Error",
      description: "Failed to update chore. Please try again.",
      variant: "destructive",
    });
  }
};

  const deleteChore = (choreId) => {
    db.transact([tx.chores[choreId].delete()]);
  };
  
  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
  };

  const filteredChores = chores.filter(chore => {
    const assignedMembers = getAssignedMembersForChoreOnDate(chore, selectedDate);
    if (selectedMember === 'All') {
      return assignedMembers.length > 0;
    } else {
      return assignedMembers.some(assignee => assignee.id === selectedMember);
    }
  });

  return (
    <div className="min-h-screen flex">
      {/* left sidebar */}
      <div className="w-1/4 bg-gray-100 p-4 flex-shrink-0">
        <FamilyMembersList
          familyMembers={familyMembers}
          selectedMember={selectedMember}
          setSelectedMember={setSelectedMember}
          addFamilyMember={addFamilyMember}
          deleteFamilyMember={deleteFamilyMember}
          db={db}
        />
      </div>

      {/* right content area */}
      <div className="w-3/4 p-4 flex flex-col h-screen space-y-4"> {/* h-screen on Right Panel: Sets a fixed boundary for the right panel based on the viewport height. Content exceeding this won't cause page scroll if overflow is handled internally. */}
        <h2 className="text-xl font-bold">
          {selectedMember === 'All' ? 'All Chores' : `${familyMembers.find(m => m.id === selectedMember)?.name}'s Chores`}
        </h2>

        {/* toggle buttons */}
        <div className="mb-4">
          <Button
            variant={viewMode === 'list' ? 'default' : 'outline'}
            className="mr-2"
            onClick={() => setViewMode('list')}
          >
            List View
          </Button>
          <Button
            variant={viewMode === 'calendar' ? 'default' : 'outline'}
            onClick={() => setViewMode('calendar')}
          >
            Calendar View
          </Button>
        </div>
        
        {/* DateCarousel */}
        <div className="mb-4">
          <DateCarousel onDateSelect={handleDateSelect} />
        </div>

        {/* Chores and allowance */}
        {viewMode === 'list' ? (
          <div className="flex flex-col gap-4 grow min-h-0"> {/* grow on Parent Containers: The grow utility (equivalent to flex-grow: 1;) tells a flex item to take up any available free space in its parent along the main axis (which is vertical here because of flex-col). We apply this progressively to the containers that should expand. */}
            {/* min-h-0: This is crucial when using grow on containers that might have tall content. By default, a flex item's minimum size is its intrinsic content size. min-h-0 overrides this, allowing the item to shrink below its content size if necessary, which is essential for the grow property to distribute space correctly and for overflow/scrolling to work reliably within the item. */}
            <div className="flex mb-4 flex-shrink-0">
              <Input
                placeholder="New chore title"
                value={newChoreTitle}
                onChange={(e) => setNewChoreTitle(e.target.value)}
                className="mr-2"
              />
              <Select value={newChoreAssignee} onValueChange={setNewChoreAssignee}>
                <SelectTrigger className="w-[180px] mr-2">
                  <SelectValue placeholder="Assignee" />
                </SelectTrigger>
                <SelectContent>
                  {familyMembers.map(member => (
                    <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => addChore({ 
                title: newChoreTitle, 
                assignees: [{ id: newChoreAssignee } as FamilyMember], 
                startDate: selectedDate.getTime() 
              })}>
                Add Chore
              </Button>
              <Dialog open={isDetailedChoreModalOpen} onOpenChange={setIsDetailedChoreModalOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" className="ml-2">
                    <PlusCircle className="mr-2 h-4 w-4" /> Detailed
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Detailed Chore</DialogTitle>
                  </DialogHeader>
                  <DetailedChoreForm
                    familyMembers={familyMembers}
                    onSave={addChore}
                    initialDate={selectedDate}
                  />
                </DialogContent>
              </Dialog>
            </div>
            <div className="flex flex-col gap-6 grow min-h-0">
              <ChoreList
                chores={filteredChores}
                familyMembers={familyMembers}
                selectedMember={selectedMember}
                selectedDate={selectedDate}
                toggleChoreDone={toggleChoreDone}
                updateChore={updateChore}
                deleteChore={deleteChore}
              />
              {selectedMember !== 'All' && (
                <div className="flex-shrink-0">
                  <h3 className="text-lg font-semibold mb-2 text-gray-700">Current Allowance</h3>
                  <AllowanceBalance
                    familyMember={familyMembers.find(m => m.id === selectedMember)}
                    db={db}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <div>Calendar View (Not implemented)</div>
        )}
      </div>
    </div>
  );
}

function AddChoreForm({ newChoreTitle, setNewChoreTitle, newChoreAssignee, setNewChoreAssignee, addChore, familyMembers }) {
  return (
    <div className="flex mb-4">
      <Input
        placeholder="New chore title"
        value={newChoreTitle}
        onChange={(e) => setNewChoreTitle(e.target.value)}
        className="mr-2"
      />
      <Select value={newChoreAssignee} onValueChange={setNewChoreAssignee}>
        <SelectTrigger className="w-[180px] mr-2">
          <SelectValue placeholder="Assignee" />
        </SelectTrigger>
        <SelectContent>
          {familyMembers.map(member => (
            <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={addChore}>Add Chore</Button>
    </div>
  );
}

function CalendarView({ chores }) {
  // Implement calendar view here
  return <div>Calendar View (Not implemented yet)</div>;
}

export default ChoresTracker;