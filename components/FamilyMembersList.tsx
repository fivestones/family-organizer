import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PlusCircle, Trash2, Upload } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from "@/components/ui/use-toast";

function FamilyMembersList({ familyMembers, selectedMember, setSelectedMember, addFamilyMember, deleteFamilyMember, db }) {
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberPhoto, setNewMemberPhoto] = useState<File | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const { toast } = useToast();

  const handleAddMember = async () => {
    if (newMemberName) {
      let photoUrl = '';
      if (newMemberPhoto) {
        const fileName = `family-members/${Date.now()}-${newMemberPhoto.name}`;
        try {
          await db.storage.upload(fileName, newMemberPhoto);
          photoUrl = await db.storage.getDownloadUrl(fileName);
        } catch (error) {
          console.error('Error uploading photo:', error);
          toast({
            title: "Error",
            description: "Failed to upload photo. Please try again.",
            variant: "destructive",
          });
          return;
        }
      }

      addFamilyMember(newMemberName, newMemberEmail || null, photoUrl);
      setNewMemberName('');
      setNewMemberEmail('');
      setNewMemberPhoto(null);
      setIsAddMemberOpen(false);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setNewMemberPhoto(e.target.files[0]);
    }
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
              <Avatar className="h-8 w-8 mr-2">
                {member.photoUrl ? (
                  <AvatarImage src={member.photoUrl} alt={member.name} />
                ) : (
                  <AvatarFallback>
                    {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </AvatarFallback>
                )}
              </Avatar>
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
                Email (optional)
              </Label>
              <Input
                id="email"
                type="email"
                value={newMemberEmail}
                onChange={(e) => setNewMemberEmail(e.target.value)}
                className="col-span-3"
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="photo" className="text-right">
                Photo
              </Label>
              <div className="col-span-3">
                <Input
                  id="photo"
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoChange}
                  className="hidden"
                />
                <Label htmlFor="photo" className="cursor-pointer flex items-center justify-center w-full h-10 px-4 py-2 bg-white text-black border border-gray-300 rounded-md hover:bg-gray-100">
                  <Upload className="mr-2 h-4 w-4" />
                  {newMemberPhoto ? newMemberPhoto.name : 'Choose photo'}
                </Label>
              </div>
            </div>
          </div>
          <Button onClick={handleAddMember} disabled={!newMemberName}>Add Member</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default FamilyMembersList;