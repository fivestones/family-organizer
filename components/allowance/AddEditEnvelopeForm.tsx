import React, { useState, useEffect, FormEvent } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
import { id, tx } from '@instantdb/react'; // Assuming InstantDB setup provides these [cite: 2]
import { Envelope } from '@/components/EnvelopeItem'; // Assuming Envelope type is exported [cite: 32]
import { createAdditionalEnvelope, updateEnvelopeName } from '@/lib/currency-utils'; // Import InstantDB utilities [cite: 34]

interface AddEditEnvelopeFormProps {
  db: any; // InstantDB instance [cite: 24]
  isOpen: boolean;
  onClose: () => void;
  // onSubmit: (name: string) => Promise<void>; // Replaced by internal handling
  initialData?: Envelope | null; // Envelope data for editing [cite: 43]
  memberId: string; // Needed for creating envelopes [cite: 39]
}

const AddEditEnvelopeForm: React.FC<AddEditEnvelopeFormProps> = ({
  db,
  isOpen,
  onClose,
  initialData,
  memberId,
}) => {
  const { toast } = useToast(); // [cite: 40]
  const [envelopeName, setEnvelopeName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditMode = !!initialData; // Determine if we are editing or adding

  // Populate form when initialData changes (for edit mode)
  useEffect(() => {
    if (isEditMode && initialData) {
      setEnvelopeName(initialData.name); // [cite: 43]
    } else {
      setEnvelopeName(''); // Reset for add mode
    }
  }, [initialData, isEditMode, isOpen]); // Reset when modal opens/closes or data changes

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault(); // Prevent page reload
    const trimmedName = envelopeName.trim();

    if (!trimmedName) {
      toast({
        title: "Validation Error",
        description: "Envelope name cannot be empty.",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      if (isEditMode && initialData) {
        // Update existing envelope
        await updateEnvelopeName(db, initialData.id, trimmedName); // [cite: 78, 309]
        toast({
          title: "Success",
          description: `Envelope renamed to '${trimmedName}'.`, // [cite: 79]
        });
      } else {
        // Create new envelope
        await createAdditionalEnvelope(db, memberId, trimmedName); // [cite: 74, 263]
        toast({
          title: "Success",
          description: `Envelope '${trimmedName}' created.`, // [cite: 75]
        });
      }
      onClose(); // Close modal on success [cite: 76, 80]
    } catch (err: any) {
      console.error("Failed to save envelope:", err);
      toast({
        title: "Error",
        description: err.message || "Could not save envelope.", // [cite: 77, 81]
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Use Dialog's controlled state
  if (!isOpen) {
    return null;
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Envelope' : 'Add New Envelope'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="envelope-name" className="text-right">
                Name
              </Label>
              <Input
                id="envelope-name"
                value={envelopeName}
                onChange={(e) => setEnvelopeName(e.target.value)}
                className="col-span-3" // [cite: 193]
                placeholder="e.g., Spending Money"
                required
                disabled={isSubmitting}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting || !envelopeName.trim()}>
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />{' '}
                  {isEditMode ? 'Saving...' : 'Creating...'}
                </>
              ) : (
                isEditMode ? 'Save Changes' : 'Create Envelope'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddEditEnvelopeForm;