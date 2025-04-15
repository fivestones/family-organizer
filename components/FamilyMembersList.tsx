// components/FamilyMembersList.tsx
import React, { useState, useEffect, useMemo } from 'react';
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
// **** NEW: Import types and components ****
import CombinedBalanceDisplay from '@/components/allowance/CombinedBalanceDisplay';
import { UnitDefinition } from '@/lib/currency-utils';

// Define FamilyMember type based on usage
interface FamilyMember {
    id: string;
    name: string;
    email?: string | null;
    photoUrls?: {
        '64'?: string;
        '320'?: string;
        '1200'?: string;
    } | null;
    // Add other fields if needed from the query context (ChoreList vs AllowanceView)
}

// **** NEW: Define Props ****
interface FamilyMembersListProps {
    familyMembers: FamilyMember[];
    selectedMember: string | null | 'All';
    setSelectedMember: (id: string | null | 'All') => void;
    addFamilyMember: (name: string, email: string | null, photoFile: File | null) => Promise<void>;
    deleteFamilyMember: (memberId: string) => Promise<void>;
    db: any; // InstantDB instance
    // **** NEW Props for balance display ****
    showBalances?: boolean; // To control the feature
    membersBalances?: { [memberId: string]: { [currency: string]: number } }; // Optional balances map
    unitDefinitions?: UnitDefinition[]; // Optional currency definitions
}


function FamilyMembersList({
  familyMembers,
  selectedMember,
  setSelectedMember,
  addFamilyMember,
  deleteFamilyMember,
  db,
  // **** Destructure new props ****
  showBalances = false, // Default to false if not provided
  membersBalances,
  unitDefinitions = [], // Default to empty array
}: FamilyMembersListProps) { // Add type annotation
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
  const [editingMember, setEditingMember] = useState<FamilyMember | null>(null); // Type annotation [cite: 780]
  const [editMemberName, setEditMemberName] = useState('');
  const [editMemberEmail, setEditMemberEmail] = useState('');
  const [editImageSrc, setEditImageSrc] = useState<string | null>(null); // Type annotation [cite: 781]
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
      setCrop({ x: 0, y: 0 }); // [cite: 790] // Reset crop
      setZoom(1); // Reset zoom [cite: 790]
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
  const handleEditMember = (member: FamilyMember) => { // Type annotation [cite: 798]
    setEditingMember(member);
    setEditMemberName(member.name);
    setEditMemberEmail(member.email || '');
    // Check if photoUrls exists and has the 1200 key before accessing
    setEditImageSrc(member.photoUrls?.[1200] ? 'uploads/' + member.photoUrls[1200] : null);
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
      setEditCrop({ x: 0, y: 0 }); // [cite: 802] // Reset crop
      setEditZoom(1); // Reset zoom [cite: 802]
      setEditCroppedAreaPixels(null);
    }
  };

  const onEditCropComplete = (croppedArea, croppedAreaPixels) => {
    setEditCroppedAreaPixels(croppedAreaPixels);
  };

  const handleUpdateMember = async () => {
    if (editMemberName && editingMember) { // Check editingMember is not null
      const updates: { [key: string]: any } = {
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
            setRemovePhoto(false);
          } catch (error) {
            console.error('Error deleting photo: ', error);
          }
        }
        updates.photoUrls = null; // [cite: 810] // Set photo URLs to null if removed
      } else if (editImageSrc && editCroppedAreaPixels && !editImageSrc.startsWith('uploads/')) { // Check if it's a new image data URL [cite: 810]
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
            '64': data.photoUrls['64'] || '', // Ensure keys are strings
            '320': data.photoUrls['320'] || '', // Ensure keys are strings
            '1200': data.photoUrls['1200'] || '', // Ensure keys are strings
          };
        } catch (error) {
          console.error('Error uploading photo:', error);
          toast({
            title: 'Error',
            description: 'Failed to upload photo. Please try again.',
            variant: 'destructive',
          });
          return; // Stop execution if upload fails [cite: 820]
        }
      }
      // If editImageSrc exists but starts with 'uploads/', it means no new file was selected, keep existing photoUrls
      else if (editImageSrc && editImageSrc.startsWith('uploads/')) {
          // No change needed for photoUrls unless removePhoto was checked (handled above)
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
        {familyMembers.map((member) => {
          // **** NEW: Get balances for this member ****
          const memberBalance = showBalances ? membersBalances?.[member.id] : null;
          const hasBalanceData = !!memberBalance && Object.keys(memberBalance).length > 0;

          return (
            <div key={member.id} className="flex items-center mb-2"> {/* [cite: 828] Reduced mb */}
              {/* Use flex-grow on the button container */}
              <div className="flex-grow mr-2">
            <Button
              variant={selectedMember === member.id ? 'default' : 'ghost'}
                    // Adjust button style for content alignment
                    className="w-full justify-start text-left h-auto py-2" // Allow height to adjust, align text left [cite: 829]
              onClick={() => setSelectedMember(member.id)}
            >
                     <div className="flex items-center space-x-3 flex-grow"> {/* Flex container for avatar, name, and balance */}
                       <Avatar className="h-10 w-10 flex-shrink-0"> {/* Adjusted size slightly */} 
                {member.photoUrls ? (
                  <AvatarImage
                             src={'uploads/' + member.photoUrls['64']} // Use string key
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
                       <span className="flex-grow font-medium">{member.name}</span> {/* Name taking available space */} 

                       {/* **** NEW: Render Balance Display **** */}
                       {showBalances && hasBalanceData && (
                           <div className="ml-auto pl-2 flex-shrink-0 text-xs"> {/* Position to the right, prevent shrinking */}
                               <CombinedBalanceDisplay
                                    totalBalances={memberBalance!}
                                    unitDefinitions={unitDefinitions}
                                    showCombinedBalance={false} // Hide combined part
                                    isLoading={false} // Data is already provided
                                    className="text-right" // Align balance text right if needed
                                    // No onCurrencyChange needed for static display
                                    // allMonetaryCurrenciesInUse is not needed when combined is hidden
                               />
                           </div>
                       )}
                       {showBalances && !hasBalanceData && (
                           <div className="ml-auto pl-2 flex-shrink-0 text-xs text-muted-foreground italic">No balance</div>
                       )}
                     </div>
            </Button>
               </div>
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
          )
        })} 
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
                  <div className="relative w-full h-64 mt-4" style={{ height: '300px' }}>
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
                  <div className="relative w-full h-64 mt-4" style={{ height: '300px' }}>
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
                    />
                  </div>
                )}
                {!editImageSrc && editingMember?.photoUrls &&
                 (
                  <div className="mt-4">
                    <Avatar className="h-16 w-16">
                      <AvatarImage
                        src={'uploads/' + editingMember.photoUrls['320']} // Use string key
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
                  onCheckedChange={(checked) => setRemovePhoto(checked === true)}
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