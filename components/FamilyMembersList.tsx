import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PlusCircle, Trash2, Edit, X } from 'lucide-react';
import { Switch } from '@/components/ui/switch';

function FamilyMembersList({ familyMembers, selectedMember, setSelectedMember, addFamilyMember, deleteFamilyMember }) {
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);

  const handleAddMember = () => {
    addFamilyMember(newMemberName, newMemberEmail);
    setNewMemberName('');
    setNewMemberEmail('');
    setIsAddMemberOpen(false);
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Family Members</h2>
        <div className="flex items-center">
          <Label htmlFor="edit-mode" className="mr-2">Edit</Label>
          <Switch
            id="edit-mode"
            checked={isEditMode}
            onCheckedChange={setIsEditMode}
          />
        </div>
      </div>
      <ScrollArea className="flex-grow">
        <Button
          variant={selectedMember === 'All' ? 'default' : 'ghost'}
          className="w-full justify-start mb-2"
          onClick={() => setSelectedMember('All')}
        >
          All
        </Button>
        {familyMembers.map(member => (
          <div key={member.id} className="flex items-center mb-2">
            <Button
              variant={selectedMember === member.id ? 'default' : 'ghost'}
              className="w-full justify-start mr-2"
              onClick={() => setSelectedMember(member.id)}
            >
              {member.name}
            </Button>
            {isEditMode && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => deleteFamilyMember(member.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </ScrollArea>
      <Dialog open={isAddMemberOpen} onOpenChange={setIsAddMemberOpen}>
        <DialogTrigger asChild>
          <Button className="w-full mt-4" onClick={() => setIsAddMemberOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Family Member
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Family Member</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Name
              </Label>
              <Input
                id="name"
                value={newMemberName}
                onChange={(e) => setNewMemberName(e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="email" className="text-right">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                className="col-span-3"
              />
            </div>
          </div>
          <Button onClick={handleAddMember}>Add Member</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default FamilyMembersList;