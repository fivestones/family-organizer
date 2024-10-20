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
import Cropper from 'react-easy-crop';

function FamilyMembersList({ familyMembers, selectedMember, setSelectedMember, addFamilyMember, deleteFamilyMember, db }) {
  const [isAddMemberOpen, setIsAddMemberOpen] = useState(false);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberPhoto, setNewMemberPhoto] = useState<File | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const { toast } = useToast();

  // Add state variables for cropping images
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [croppedImage, setCroppedImage] = useState(null);
  const [imageSrc, setImageSrc] = useState(null);

  const handleAddMember = async () => {
    if (newMemberName) {
      let photoFile = null;
      if (croppedImage) {
        photoFile = croppedImage;
      }
      // Pass photoFile to addFamilyMember
      addFamilyMember(newMemberName, newMemberEmail || null, photoFile);
      // Reset states
      setNewMemberName('');
      setNewMemberEmail('');
      setImageSrc(null);
      setCroppedImage(null);
      setIsAddMemberOpen(false);
    }
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setNewMemberPhoto(e.target.files[0]);
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const imageDataUrl = await readFile(file);
      setImageSrc(imageDataUrl);
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
  
  const showCroppedImage = async () => {
    try {
      const croppedImage = await getCroppedImg(imageSrc, croppedAreaPixels);
      setCroppedImage(croppedImage);
    } catch (e) {
      console.error(e);
    }
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
          const file = new File([blob], 'cropped_image.png', { type: 'image/png' });
          resolve(file);
        }, 'image/png');
      };
      image.onerror = (error) => reject(error);
    });
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
                {member.photoUrls ? (
                  <AvatarImage src={'uploads/' + member.photoUrls[64]} alt={member.name} />
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
                </div>
              </div>

              {imageSrc && (
                <div className="relative w-full h-64">
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
                  <div className="flex justify-center mt-2">
                    <Button onClick={showCroppedImage}>Crop Image</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
          <Button onClick={handleAddMember} disabled={!newMemberName}>Add Member</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default FamilyMembersList;