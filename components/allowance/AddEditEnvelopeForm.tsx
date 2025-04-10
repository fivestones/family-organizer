// components/allowance/AddEditEnvelopeForm.tsx
import React, { useState, useEffect, FormEvent } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch"; // Import Switch
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
import { id, tx } from '@instantdb/react';
import { Envelope } from '@/components/EnvelopeItem'; // Assuming Envelope type is exported
// **** IMPORT UPDATED/RENAMED UTILITY FUNCTIONS ****
import { createAdditionalEnvelope, updateEnvelope, setDefaultEnvelope } from '@/lib/currency-utils'; // Import InstantDB utilities

interface AddEditEnvelopeFormProps {
  db: any; // InstantDB instance
  isOpen: boolean;
  onClose: () => void;
  initialData?: Envelope | null; // Envelope data for editing
  memberId: string; // Needed for creating envelopes
  // **** NEW PROP: Pass all envelopes for the member ****
  allMemberEnvelopes: Envelope[];
}

const AddEditEnvelopeForm: React.FC<AddEditEnvelopeFormProps> = ({
  db,
  isOpen,
  onClose,
  initialData,
  memberId,
  allMemberEnvelopes, // Destructure new prop
}) => {
  const { toast } = useToast();
  const [envelopeName, setEnvelopeName] = useState('');
  // **** NEW STATE for the default switch ****
  const [isDefault, setIsDefault] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditMode = !!initialData;

  // Populate form when initialData changes (for edit mode)
  useEffect(() => {
    if (isOpen) {
      if (isEditMode && initialData) {
        setEnvelopeName(initialData.name);
        // **** Initialize switch based on initial data ****
        setIsDefault(initialData.isDefault ?? false);
      } else {
        setEnvelopeName('');
        // **** Reset switch for add mode (default is false) ****
        setIsDefault(false);
      }
    }
  }, [initialData, isEditMode, isOpen]); // Reset when modal opens/closes or data changes

  const handleDefaultChange = (checked: boolean) => {
    // Check if trying to turn OFF the switch WHILE editing an ALREADY default envelope
    if (isEditMode && initialData?.isDefault && !checked) {
        // Prevent the change and show a toast
        toast({
            title: "Action Needed",
            description: "To change the default, please edit a different envelope and make *it* the default.",
            variant: "default", // Or choose another appropriate variant
        });
        // Do NOT update the state, keep the switch visually ON
    } else {
        // Otherwise, allow the state change
        setIsDefault(checked);
    }
  };
  
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
    // This check might be redundant now due to the handleDefaultChange logic, but kept for safety.
    if (isEditMode && initialData?.isDefault && !isDefault && allMemberEnvelopes.length <= 1) {
         toast({
             title: "Action Denied",
             description: "Cannot remove default status from the only envelope.",
             variant: "destructive",
         });
         return;
     }

    setIsSubmitting(true);

    try {
      if (isEditMode && initialData) {
        // --- UPDATE ---
        const originalIsDefault = initialData.isDefault ?? false;
        await updateEnvelope(db, initialData.id, trimmedName, isDefault); // Use updated utility
        toast({
          title: "Success",
          description: `Envelope '${trimmedName}' updated.`,
        });
        // If the default status was CHECKED during edit AND it wasn't default before
        if (isDefault && !originalIsDefault) {
           console.log("Setting new default (edit):", initialData.id);
           await setDefaultEnvelope(db, allMemberEnvelopes, initialData.id);
        }
      } else {
        // --- CREATE ---
        const newEnvelopeId = await createAdditionalEnvelope(db, memberId, trimmedName, isDefault); // Pass isDefault
        toast({
          title: "Success",
          description: `Envelope '${trimmedName}' created.`,
        });
         // If the default status was CHECKED during creation
        if (isDefault) {
            console.log("Setting new default (create):", newEnvelopeId);
            // Fetch the *updated* list of envelopes AFTER creation before setting default
            // This is tricky as the component's state `allMemberEnvelopes` might be stale.
            // It's safer if `setDefaultEnvelope` fetches fresh data, or we pass the newly created envelope info.
            // For now, assume `setDefaultEnvelope` can handle it, or requires a refresh/refetch mechanism in parent.
            // A simpler approach might be needed if atomicity across calls is strict.
            // Let's pass the current list + the new one conceptually
            const newEnvelopePlaceholder = { id: newEnvelopeId, name: trimmedName, balances: {}, isDefault: true };
            await setDefaultEnvelope(db, [...allMemberEnvelopes, newEnvelopePlaceholder], newEnvelopeId);
        }
      }
      onClose(); // Close modal on success
    } catch (err: any) {
      console.error("Failed to save envelope:", err);
      toast({
        title: "Error",
        description: err.message || "Could not save envelope.",
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
    // **** Increase Modal Width ****
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
       {/* Changed sm:max-w-[425px] to sm:max-w-md */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Envelope' : 'Add New Envelope'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          {/* Define grid with a wider first column (e.g., 140px) */}
           {/* Adjust '140px' as needed */}
          <div className="grid grid-cols-[140px_1fr] items-center gap-x-4 gap-y-4 py-4">

            {/* -- Row 1: Name -- */}
            <Label htmlFor="envelope-name" className="text-right">
              Name
            </Label>
            <Input
              id="envelope-name"
              value={envelopeName}
              onChange={(e) => setEnvelopeName(e.target.value)}
              placeholder="e.g., Spending Money"
              required
              disabled={isSubmitting}
            />

            {/* -- Row 2: Make Default -- */}
            {/* Label now contains the helper text and spans the first column */}
            <Label htmlFor="make-default" className="text-right flex flex-col items-end"> {/* Align items end for right align */}
                <span>Make Default</span>
                 <span className="font-normal leading-snug text-muted-foreground text-xs mt-1"> {/* Added margin-top */}
                     Default for deposits/transfers.
                 </span>
            </Label>
            {/* Switch stays in the second column */}
            <div className="flex items-center"> {/* Keeps switch vertically centered */}
                <Switch
                    id="make-default"
                    checked={isDefault}
                    // Use the new handler function
                    onCheckedChange={handleDefaultChange}
                    // Keep disable logic for the only envelope case (visual cue)
                    disabled={isSubmitting || (isEditMode && initialData?.isDefault && allMemberEnvelopes.length <= 1)}
                    aria-label="Make this the default envelope"
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
                <> <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {isEditMode ? 'Saving...' : 'Creating...'} </>
              ) : ( isEditMode ? 'Save Changes' : 'Create Envelope' )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddEditEnvelopeForm;