// components/FamilyMembersList.tsx
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PlusCircle, Trash2, Edit } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/use-toast';
import Cropper from 'react-easy-crop';
import { Checkbox } from '@/components/ui/checkbox';
import { tx, id } from '@instantdb/react';

function FamilyMembersList({
  familyMembers,
  selectedMember,
  setSelectedMember,
  addFamilyMember,
  deleteFamilyMember,
  db,
}) {
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const { toast } = useToast();

  // State variables for cropping images
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);

  // State variables for editing members
  const [editingMember, setEditingMember] = useState(null);
  const [editMemberName, setEditMemberName] = useState('');
  const [editMemberEmail, setEditMemberEmail] = useState('');
  const [editImageSrc, setEditImageSrc] = useState(null);
  const [editCrop, setEditCrop] = useState({ x: 0, y: 0 });
  const [editZoom, setEditZoom] = useState(1);
  const [editCroppedAreaPixels, setEditCroppedAreaPixels] = useState(null);
  const [removePhoto, setRemovePhoto] = useState(false);

  const handleAddMember = async () => {
    if (newMemberName) {
      let photoFile = null;
      let photoUrls = null;
      if (imageSrc && croppedAreaPixels) {
        try {
          photoFile = await getCroppedImg(imageSrc, croppedAreaPixels);
        } catch (e) {
          console.error(e);
        }
      }
      // Pass photoFile to addFamilyMember
      await addFamilyMember(newMemberName, newMemberEmail || null, photoFile);
      // Reset states
      setNewMemberName('');
      setNewMemberEmail('');
      setImageSrc(null);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setIsAddMemberOpen(false);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const imageDataUrl = await readFile(file);
      setImageSrc(imageDataUrl);
      setCrop({ x: 0, y: 0 }); // Reset crop
      setZoom(1); // Reset zoom
      setCroppedAreaPixels(null);
    }
  };

  const readFile = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result as string));
      reader.readAsDataURL(file);
    });
  };

  const onCropComplete = (croppedArea, croppedAreaPixels) => {
    setCroppedAreaPixels(croppedAreaPixels);
  };

  const getCroppedImg = (imageSrc, pixelCrop): Promise<File> => {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.src = imageSrc;
      image.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const maxSize = 1200;
        const scale = maxSize / Math.max(pixelCrop.width, pixelCrop.height);
        const canvasWidth = pixelCrop.width * scale;
        const canvasHeight = pixelCrop.height * scale;

        canvas.width = canvasWidth;
        canvas.height = canvasHeight;

        ctx.drawImage(
          image,
          pixelCrop.x,
          pixelCrop.y,
          pixelCrop.width,
          pixelCrop.height,
          0,
          0,
          canvasWidth,
          canvasHeight
        );

        canvas.toBlob((blob) => {
          if (!blob) {
            return reject(new Error('Canvas is empty'));
          }
          const file = new File([blob], 'cropped_image.png', {
            type: 'image/png',
          });
          resolve(file);
        }, 'image/png');
      };
      image.onerror = (error) => reject(error);
    });
  };

  // Edit member functions
  const handleEditMember = (member) => {
    setEditingMember(member);
    setEditMemberName(member.name);
    setEditMemberEmail(member.email || '');
    setEditImageSrc(member.photoUrls ? 'uploads/' + member.photoUrls[1200] : null);
    setEditCrop({ x: 0, y: 0 });
    setEditZoom(1);
    setEditCroppedAreaPixels(null);
    setRemovePhoto(false);
  };

  const onEditFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const imageDataUrl = await readFile(file);
      setEditImageSrc(imageDataUrl);
      setEditCrop({ x: 0, y: 0 }); // Reset crop
      setEditZoom(1); // Reset zoom
      setEditCroppedAreaPixels(null);
    }
  };

  const onEditCropComplete = (croppedArea, croppedAreaPixels) => {
    setEditCroppedAreaPixels(croppedAreaPixels);
  };

  const handleUpdateMember = async () => {
    if (editMemberName) {
      const updates = {
        name: editMemberName,
        email: editMemberEmail || '',
      };
  
      // If 'Remove Photo' is checked, delete the photo first
      if (removePhoto) {
        console.log("Removing photo");
        const member = familyMembers.find((m) => m.id === editingMember.id);
        if (member && member.photoUrls) {
          try {
            const result = await fetch('/api/delete-image', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ urls: member.photoUrls }),
            });
            console.log(
              'JSON.stringify({urls: member.photoUrls }): ',
              JSON.stringify({ urls: member.photoUrls })
            );
            console.log('Delete image result: ', result);
          } catch (error) {
            console.error('Error deleting photo:', error);
          }
        }
        updates.photoUrls = null; // Set photo URLs to null if removed
      } else if (editImageSrc && editCroppedAreaPixels) {
        // If 'Remove Photo' is not checked, upload new photo if provided
        console.log('Uploading new photo');
        try {
          const photoFile = await getCroppedImg(editImageSrc, editCroppedAreaPixels);
  
          const formData = new FormData();
          formData.append('file', photoFile);
  
          const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData,
          });
  
          if (!response.ok) throw new Error('Failed to upload photo');
  
          const data = await response.json();
  
          updates.photoUrls = {
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
  
      try {
        await db.transact([tx.familyMembers[editingMember.id].update(updates)]);
        toast({
          title: 'Success',
          description: 'Family member updated successfully.',
        });
      } catch (error) {
        console.error('Error updating family member:', error);
        toast({
          title: 'Error',
          description: 'Failed to update family member. Please try again.',
          variant: 'destructive',
        });
      }
  
      // Reset states
      setEditingMember(null);
      setEditMemberName('');
      setEditMemberEmail('');
      setEditImageSrc(null);
      setEditCrop({ x: 0, y: 0 });
      setEditZoom(1);
      setEditCroppedAreaPixels(null);
      setRemovePhoto(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold">Family Members</h2>
        <div className="flex items-center">
          <Label htmlFor="edit-mode" className="mr-2">
            Edit
          </Label>
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
        {familyMembers.map((member) => (
          <div key={member.id} className="flex items-center mb-2 space-y-4">
            <Button
              variant={selectedMember === member.id ? 'default' : 'ghost'}
              className="w-full justify-start mr-2"
              onClick={() => setSelectedMember(member.id)}
            >
              <Avatar className="h-12 w-12 mr-2">
                {member.photoUrls ? (
                  <AvatarImage
                    src={'uploads/' + member.photoUrls[64]}
                    alt={member.name}
                  />
                ) : (
                  <AvatarFallback>
                    {member.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')
                      .toUpperCase()}
                  </AvatarFallback>
                )}
              </Avatar>
              {member.name}
            </Button>
            {isEditMode && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleEditMember(member)}
                >
                  <Edit className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => deleteFamilyMember(member.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
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
                  onChange={onFileChange}
                />
                {imageSrc && (
                  <div className="relative w-full h-64 mt-4">
                    <Cropper
                      image={imageSrc}
                      crop={crop}
                      zoom={zoom}
                      aspect={1}
                      cropShape="round"
                      showGrid={false}
                      onCropChange={setCrop}
                      onZoomChange={setZoom}
                      onCropComplete={onCropComplete}
                      containerStyle={{ height: '300px' }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          <Button onClick={handleAddMember} disabled={!newMemberName}>
            Add Member
          </Button>
        </DialogContent>
      </Dialog>

      {/* Edit Member Dialog */}
      <Dialog
        open={editingMember !== null}
        onOpenChange={() => setEditingMember(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Family Member</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Name Field */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-name" className="text-right">
                Name
              </Label>
              <Input
                id="edit-name"
                value={editMemberName}
                onChange={(e) => setEditMemberName(e.target.value)}
                className="col-span-3"
              />
            </div>

            {/* Email Field */}
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-email" className="text-right">
                Email (optional)
              </Label>
              <Input
                id="edit-email"
                type="email"
                value={editMemberEmail}
                onChange={(e) => setEditMemberEmail(e.target.value)}
                className="col-span-3"
              />
            </div>

            {/* Photo Input and Cropping */}
            <div className="grid grid-cols-4 items-start gap-4">
              <Label htmlFor="edit-photo" className="text-right">
                Photo
              </Label>
              <div className="col-span-3">
                <Input
                  id="edit-photo"
                  type="file"
                  accept="image/*"
                  onChange={onEditFileChange}
                />
                {editImageSrc && (
                  <div className="relative w-full h-64 mt-4">
                    <Cropper
                      image={editImageSrc}
                      crop={editCrop}
                      zoom={editZoom}
                      aspect={1}
                      cropShape="round"
                      showGrid={false}
                      onCropChange={setEditCrop}
                      onZoomChange={setEditZoom}
                      onCropComplete={onEditCropComplete}
                      containerStyle={{ height: '300px' }}
                    />
                  </div>
                )}
                {!editImageSrc && editingMember?.photoUrls && (
                  <div className="mt-4">
                    <Avatar className="h-16 w-16">
                      <AvatarImage
                        src={'uploads/' + editingMember.photoUrls[320]}
                        alt={editingMember.name}
                      />
                    </Avatar>
                  </div>
                )}
              </div>
            </div>

            {/* Remove Photo Checkbox */}
            {editingMember?.photoUrls && (
              <div className="flex items-center">
                <Checkbox
                  id="remove-photo"
                  checked={removePhoto}
                  onCheckedChange={setRemovePhoto}
                />
                <Label htmlFor="remove-photo" className="ml-2">
                  Remove existing photo
                </Label>
              </div>
            )}
          </div>

          {/* Save Button */}
          <Button onClick={handleUpdateMember} disabled={!editMemberName}>
            Save Member
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default FamilyMembersList;