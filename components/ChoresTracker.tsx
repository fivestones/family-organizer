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

// import { ScrollArea } from '@/components/ui/scroll-area';



// Define interfaces for our data structures
interface FamilyMember {
  id: string;
  name: string;
  email?: string;
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
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const { isLoading, error, data } = db.useQuery({
    familyMembers: {},
    chores: {
      assignees: {},
      assignments: {
        familyMember: {},
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
      choreData.assignments.forEach(assignment => {
        const assignmentId = id();
        transactions.push(
          tx.choreAssignments[assignmentId].update({
            order: assignment.order,
            chore: choreId,
            familyMember: assignment.familyMember.id,
          })
        );
      });
    } else if (choreData.assignees && choreData.assignees.length > 0) {
      // Link assignees directly
      choreData.assignees.forEach(assignee => {
        transactions.push(
          tx.chores[choreId].link({ assignees: assignee.id })
        );
      });
    } else {
      // Handle case where no assignees are selected
      console.warn('No assignees selected for the chore.');
    }
  
    db.transact(transactions);
    setIsDetailedChoreModalOpen(false);
  };

  const addFamilyMember = (name, email) => {
    if (name) {
      const memberId = id();
      const memberData: Partial<FamilyMember> = { name };
      if (email) {
        memberData.email = email;
      }
      db.transact([
        tx.familyMembers[memberId].update(memberData),
      ]);
    }
  };

  const deleteFamilyMember = (memberId) => {
    db.transact([tx.familyMembers[memberId].delete()]);
    if (selectedMember === memberId) {
      setSelectedMember('All');
    }
  };

  const toggleChoreDone = (choreId) => {
    const chore = chores.find(c => c.id === choreId);
    if (chore) {
      db.transact([
        tx.chores[choreId].update({ done: !chore.done }),
      ]);
    }
  };

  const updateChore = (choreId, updatedChore) => {
    db.transact([
      tx.chores[choreId].update(updatedChore),
    ]);
  };

  const deleteChore = (choreId) => {
    db.transact([tx.chores[choreId].delete()]);
  };
  
  const handleDateSelect = (date: Date) => {
    setSelectedDate(date);
    console.log("just set the seletecDate to ", date)
    // You might want to filter chores based on the selected date here
  };

  const filteredChores = selectedMember === 'All'
    ? chores
    : chores.filter(chore => chore.assignees.some(assignee => assignee.id === selectedMember));

    return (
      <div className="flex h-screen">
        <div className="w-1/4 bg-gray-100 p-4">
          <FamilyMembersList
            familyMembers={familyMembers}
            selectedMember={selectedMember}
            setSelectedMember={setSelectedMember}
            addFamilyMember={addFamilyMember}
            deleteFamilyMember={deleteFamilyMember}
          />
        </div>
        <div className="w-3/4 p-4">
          <h2 className="text-xl font-bold mb-4">
            {selectedMember === 'All' ? 'All Chores' : `${familyMembers.find(m => m.id === selectedMember)?.name}'s Chores`}
          </h2>
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
  
          {viewMode === 'list' ? (
            <>
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
              <ChoreList
                chores={filteredChores}
                familyMembers={familyMembers}
                selectedMember={selectedMember}
                selectedDate={selectedDate}
                toggleChoreDone={toggleChoreDone}
                updateChore={updateChore}
                deleteChore={deleteChore}
              />
            </>
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