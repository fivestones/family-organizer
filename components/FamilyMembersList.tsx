// components/FamilyMembersList.tsx
import React, { useState, useEffect, useMemo, useCallback } from 'react'; // <-- Import useEffect, useState, useCallback
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { PlusCircle } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/use-toast';
import Cropper from 'react-easy-crop';
import { Checkbox } from '@/components/ui/checkbox';
import { tx, id } from '@instantdb/react';
import { UnitDefinition } from '@/lib/currency-utils';
import Link from 'next/link';

// **** NEW: Import PDND tools ****
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { extractClosestEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge';
import { reorderWithEdge } from '@atlaskit/pragmatic-drag-and-drop-hitbox/util/reorder-with-edge';
import { SortableFamilyMemberItem } from './SortableFamilyMemberItem'; // <-- Import new component

// +++ NEW: Import RadioGroup for Role selection +++
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
// +++ NEW: Import Hash util +++
import { hashPin } from '@/app/actions';
// +++ NEW: Import Auth Hook +++
import { useAuth } from '@/components/AuthProvider';
// +++ NEW: Import Utils for Internal Calculation +++
import { calculateDailyXP } from '@/lib/chore-utils';

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
    order?: number | null; // <-- Add order
    // +++ NEW: Add Role +++
    role?: string | null;
    // Add other fields if needed from the query context (ChoreList vs AllowanceView)
}

interface PhotoUrls {
    '64'?: string;
    '320'?: string;
    '1200'?: string;
}

// **** UPDATED: Removed addFamilyMember and deleteFamilyMember from props ****
interface FamilyMembersListProps {
    familyMembers: FamilyMember[];
    selectedMember?: string | null | 'All';
    setSelectedMember?: (id: string | null | 'All') => void;
    db: any; // InstantDB instance
    // **** NEW Props for balance display ****
    showBalances?: boolean; // To control the feature
    // +++ OPTIONAL OVERRIDES (If parent wants to force specific data, otherwise calculated internally) +++
    membersBalances?: { [memberId: string]: { [currency: string]: number } };
    unitDefinitions?: UnitDefinition[];
    membersXP?: { [memberId: string]: { current: number; possible: number } };
    // When true, the list is always in edit mode with no toggle (for settings page)
    alwaysEditMode?: boolean;
}

const noopSetSelectedMember = () => {};
const FAMILY_PHOTO_SETTING = 'familyPhotoUrls';

function FamilyMembersList({
    familyMembers,
    selectedMember = null,
    setSelectedMember = noopSetSelectedMember,
    db,
    // **** Destructure new props ****
    showBalances = false, // Default to false if not provided
    // +++ Default these to undefined so we can check if we need to fetch them +++
    membersBalances: propBalances,
    unitDefinitions: propUnitDefs,
    membersXP: propXP,
    alwaysEditMode = false,
}: FamilyMembersListProps) {
    // **** UPDATED: Removed props ****
    const { currentUser } = useAuth(); // +++ Get current user +++

    // +++ INTERNAL DATA FETCHING (Make component smart) +++
    // We only fetch if the props weren't provided. This allows backward compatibility/overrides.
    const shouldFetchData = !propBalances || !propUnitDefs || !propXP;

    const { data: internalData } = db.useQuery(
        shouldFetchData
            ? {
                  // Fetch Chores for XP
                  chores: {
                      assignees: {},
                      assignments: { familyMember: {} },
                      completions: { completedBy: {} },
                  },
                  // Fetch Members+Envelopes for Balances
                  familyMembers: {
                      allowanceEnvelopes: {},
                  },
                  // Fetch Units for formatting
                  unitDefinitions: {},
              }
            : null
    );
    const { data: familyPhotoData } = db.useQuery({
        settings: {
            $: {
                where: {
                    name: FAMILY_PHOTO_SETTING,
                },
            },
        },
    });

    const familyPhotoUrls = useMemo<PhotoUrls | null>(() => {
        const setting = familyPhotoData?.settings?.[0];
        if (!setting?.value) return null;
        try {
            const parsed = JSON.parse(setting.value);
            if (!parsed || typeof parsed !== 'object') return null;
            return {
                '64': typeof parsed['64'] === 'string' ? parsed['64'] : undefined,
                '320': typeof parsed['320'] === 'string' ? parsed['320'] : undefined,
                '1200': typeof parsed['1200'] === 'string' ? parsed['1200'] : undefined,
            };
        } catch {
            return null;
        }
    }, [familyPhotoData?.settings]);

    // +++ INTERNAL CALCULATIONS +++

    // 1. Resolve Unit Definitions
    const unitDefinitions = useMemo(() => {
        return propUnitDefs || (internalData?.unitDefinitions as UnitDefinition[]) || [];
    }, [propUnitDefs, internalData?.unitDefinitions]);

    // 2. Resolve Balances
    const membersBalances = useMemo(() => {
        if (propBalances) return propBalances;

        const balances: { [memberId: string]: { [currency: string]: number } } = {};
        const membersList = (internalData?.familyMembers as any[]) || [];

        membersList.forEach((member) => {
            const memberId = member.id;
            balances[memberId] = {};
            (member.allowanceEnvelopes || []).forEach((envelope: any) => {
                if (envelope.balances) {
                    Object.entries(envelope.balances).forEach(([currency, amount]) => {
                        const upperCaseCurrency = currency.toUpperCase();
                        balances[memberId][upperCaseCurrency] = (balances[memberId][upperCaseCurrency] || 0) + (amount as number);
                    });
                }
            });
        });
        return balances;
    }, [propBalances, internalData?.familyMembers]);

    // 3. Resolve XP
    const membersXP = useMemo(() => {
        if (propXP) return propXP;

        const chores = internalData?.chores || [];
        // We use the familyMembers prop for the list of people to calculate for,
        // ensuring consistency with the list being displayed.
        // However, calculateDailyXP expects objects with IDs.
        const now = new Date();
        const realWorldToday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

        return calculateDailyXP(chores, familyMembers, realWorldToday);
    }, [propXP, internalData?.chores, familyMembers]);

    // --- End Internal Calculation ---

    const [isCreatingMember, setIsCreatingMember] = useState(false);
    const [newMemberName, setNewMemberName] = useState('');
    const [newMemberEmail, setNewMemberEmail] = useState('');
    // +++ NEW State for Add Member +++
    const [newMemberRole, setNewMemberRole] = useState('child');
    const [newMemberPin, setNewMemberPin] = useState('');

    const isEditMode = alwaysEditMode;
    const { toast } = useToast();

    // State variables for cropping images
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
    const [imageSrc, setImageSrc] = useState(null);

    // State variables for editing members
    const [editingMember, setEditingMember] = useState<FamilyMember | null>(null); // Type annotation
    const [editMemberName, setEditMemberName] = useState('');
    const [editMemberEmail, setEditMemberEmail] = useState('');
    // +++ NEW State for Edit Member +++
    const [editMemberRole, setEditMemberRole] = useState('child');
    const [editMemberPin, setEditMemberPin] = useState('');

    const [editImageSrc, setEditImageSrc] = useState<string | null>(null); // Type annotation
    const [editCrop, setEditCrop] = useState({ x: 0, y: 0 });
    const [editZoom, setEditZoom] = useState(1);
    const [editCroppedAreaPixels, setEditCroppedAreaPixels] = useState(null);
    const [removePhoto, setRemovePhoto] = useState(false);
    const [isEditingAll, setIsEditingAll] = useState(alwaysEditMode);
    const [isFamilyPhotoSaving, setIsFamilyPhotoSaving] = useState(false);
    const needsAllHandleSpacer = alwaysEditMode && currentUser?.role === 'parent';

    // --- NEW: State for optimistic UI reordering ---
    const [orderedMembers, setOrderedMembers] = useState<FamilyMember[]>(familyMembers);

    // --- NEW: Sync local state with sorted prop ---
    useEffect(() => {
        setOrderedMembers(familyMembers);
    }, [familyMembers]);

    // --- NEW: PDND Monitor Setup ---
    useEffect(() => {
        const cleanup = monitorForElements({
            onDrop: async ({ source, location }) => {
                // No drop target -> ignore
                if (!location.current.dropTargets.length) return;

                const target = location.current.dropTargets[0];

                const sourceIndex = source.data.index as number | undefined;
                const targetIndex = target.data.index as number | undefined;
                const closestEdgeOfTarget = extractClosestEdge(target.data);

                // Sanity checks
                if (sourceIndex == null || targetIndex == null || closestEdgeOfTarget == null) {
                    return;
                }

                // Nothing to do if we effectively didn't move
                if (sourceIndex === targetIndex && closestEdgeOfTarget === 'top') {
                    return;
                }

                // 1. Compute new list using both index and edge
                const reorderedList = reorderWithEdge({
                    list: orderedMembers,
                    startIndex: sourceIndex,
                    indexOfTarget: targetIndex,
                    closestEdgeOfTarget,
                    axis: 'vertical',
                });

                setOrderedMembers(reorderedList);

                // 2. Persist new order to InstantDB
                const transactions = reorderedList.map((member, index) =>
                    tx.familyMembers[member.id].update({
                        order: index,
                    })
                );

                try {
                    await db.transact(transactions);
                    toast({
                        title: 'Order Saved',
                        description: 'Family member order has been updated.',
                    });
                } catch (error: any) {
                    console.error('Failed to save member order:', error);
                    toast({
                        title: 'Error Saving Order',
                        description: 'Could not save the new order. Reverting changes.',
                        variant: 'destructive',
                    });
                    setOrderedMembers(familyMembers);
                }
            },
        });

        return cleanup;
    }, [orderedMembers, familyMembers, db, toast]); // Re-run if these change

    // **** MOVED: Full implementation of addFamilyMember logic ****
    const _internal_addFamilyMember = async (name: string, email: string | null, photoFile: File | null) => {
        if (!name) return;
        let photoUrls: {
            '64'?: string;
            '320'?: string;
            '1200'?: string;
        } | null = null; // Type annotation
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
                    '64': data.photoUrls['64'] || '', // Use string key
                    '320': data.photoUrls['320'] || '', // Use string key
                    '1200': data.photoUrls['1200'] || '', // Use string key
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
        const memberData: any = {
            // Use Partial<FamilyMember> or any to include new fields easily
            name,
            email: email || '',
            order: orderedMembers.length, // <-- NEW: Set order to be the last item

            // Set some sane defaults
            lastDisplayCurrency: null,
            allowanceAmount: null,
            allowanceCurrency: null,
            allowanceRrule: null,
            allowanceStartDate: null,
            allowanceConfig: {}, // Default to an empty JSON object
            allowancePayoutDelayDays: 0, // Default to 0 days

            // +++ NEW: Add Role +++
            role: newMemberRole,
        };

        // +++ NEW: Hash PIN if provided +++
        if (newMemberPin) {
            memberData.pinHash = await hashPin(newMemberPin);
        }

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
            // **** UPDATED: Call internal function ****
            await _internal_addFamilyMember(newMemberName, newMemberEmail || null, photoFile);
            // Reset states
            setNewMemberName('');
            setNewMemberEmail('');
            setNewMemberRole('child'); // Reset role
            setNewMemberPin(''); // Reset pin
            setImageSrc(null);
            setCrop({ x: 0, y: 0 });
            setZoom(1);
            setCroppedAreaPixels(null);
            if (alwaysEditMode) {
                setIsCreatingMember(false);
                setIsEditingAll(true);
            }
        }
    };

    const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            const imageDataUrl = await readFile(file);
            setImageSrc(imageDataUrl);
            setCrop({ x: 0, y: 0 });
            setZoom(1);
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

                ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, canvasWidth, canvasHeight);

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
    const activateMemberForEditing = (member: FamilyMember) => {
        // Type annotation
        setIsCreatingMember(false);
        setIsEditingAll(false);
        setEditingMember(member);
        if (!alwaysEditMode) {
            setSelectedMember(member.id);
        }
        setEditMemberName(member.name);
        setEditMemberEmail(member.email || '');
        // +++ Populate Role +++
        setEditMemberRole(member.role || 'child');
        setEditMemberPin(''); // Always clear PIN input on open

        // Check if photoUrls exists and has the 1200 key before accessing
        setEditImageSrc(member.photoUrls?.[1200] ? 'uploads/' + member.photoUrls[1200] : null);
        setEditCrop({ x: 0, y: 0 });
        setEditZoom(1);
        setEditCroppedAreaPixels(null);
        setRemovePhoto(false);
    };

    const activateAllForSettings = () => {
        if (!alwaysEditMode) {
            setSelectedMember('All');
            return;
        }
        setIsCreatingMember(false);
        setIsEditingAll(true);
        setEditingMember(null);
        setEditMemberName('');
        setEditMemberEmail('');
        setEditMemberRole('child');
        setEditMemberPin('');
        setEditImageSrc(null);
        setEditCrop({ x: 0, y: 0 });
        setEditZoom(1);
        setEditCroppedAreaPixels(null);
        setRemovePhoto(false);
    };

    const activateCreateMember = () => {
        if (!alwaysEditMode) {
            return;
        }
        setIsCreatingMember(true);
        setIsEditingAll(false);
        setEditingMember(null);
        setNewMemberName('');
        setNewMemberEmail('');
        setNewMemberRole('child');
        setNewMemberPin('');
        setImageSrc(null);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setCroppedAreaPixels(null);
    };

    const onEditFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            const imageDataUrl = await readFile(file);
            setEditImageSrc(imageDataUrl);
            setEditCrop({ x: 0, y: 0 });
            setEditZoom(1);
            setEditCroppedAreaPixels(null);
        }
    };

    const onEditCropComplete = (croppedArea, croppedAreaPixels) => {
        setEditCroppedAreaPixels(croppedAreaPixels);
    };

    const handleUpdateMember = async () => {
        if (editMemberName && editingMember) {
            // Check editingMember is not null
            const updates: { [key: string]: any } = {
                name: editMemberName,
                email: editMemberEmail || '',
                role: editMemberRole,
            };

            // +++ Update PIN only if user typed something +++
            if (editMemberPin.trim() !== '') {
                updates.pinHash = await hashPin(editMemberPin);
            }

            // If 'Remove Photo' is checked, delete the photo first
            if (removePhoto) {
                console.log('Removing photo');
                const member = familyMembers.find((m) => m.id === editingMember.id);
                if (member && member.photoUrls) {
                    try {
                        const result = await fetch('/api/delete-image', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ urls: member.photoUrls }),
                        });

                        console.log('JSON.stringify({urls: member.photoUrls }): ', JSON.stringify({ urls: member.photoUrls }));
                        setRemovePhoto(false);
                    } catch (error) {
                        console.error('Error deleting photo: ', error);
                    }
                }
                updates.photoUrls = null; // // Set photo URLs to null if removed
            } else if (editImageSrc && editCroppedAreaPixels && !editImageSrc.startsWith('uploads/')) {
                // Check if it's a new image data URL
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
                    return; // Stop execution if upload fails
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
                const updatedPhotoUrls =
                    updates.photoUrls === undefined ? editingMember.photoUrls || null : (updates.photoUrls as FamilyMember['photoUrls'] | null);
                const updatedMember: FamilyMember = {
                    ...editingMember,
                    name: editMemberName,
                    email: editMemberEmail || '',
                    role: editMemberRole,
                    photoUrls: updatedPhotoUrls,
                };
                setEditingMember(updatedMember);
                setEditImageSrc(updatedPhotoUrls?.['1200'] ? `uploads/${updatedPhotoUrls['1200']}` : null);
            } catch (error) {
                console.error('Error updating family member:', error);
                toast({
                    title: 'Error',
                    description: 'Failed to update family member. Please try again.',
                    variant: 'destructive',
                });
            }

            // Reset states
            setEditMemberPin(''); // Reset
            setEditCrop({ x: 0, y: 0 });
            setEditZoom(1);
            setEditCroppedAreaPixels(null);
            setRemovePhoto(false);
        }
    };

    // **** MOVED: Full implementation of deleteFamilyMember logic ****
    const handleDeleteMember = async (memberId: string) => {
        // Add type annotation
        // Fetch the family member to get the photo URLs
        const member = familyMembers.find((m) => m.id === memberId);
        if (member && member.photoUrls) {
            try {
                await fetch('/api/delete-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ urls: member.photoUrls }),
                });
            } catch (error) {
                console.error('Error deleting photo:', error);
            }
        }
        // Also update the order of remaining members
        const newOrderedList = orderedMembers.filter((m) => m.id !== memberId);
        const transactions = newOrderedList.map((m, index) => tx.familyMembers[m.id].update({ order: index }));
        transactions.push(tx.familyMembers[memberId].delete());

        await db.transact(transactions);

        if (selectedMember === memberId) {
            setSelectedMember('All');
        }
        if (editingMember?.id === memberId) {
            setEditingMember(null);
            if (alwaysEditMode) {
                setIsEditingAll(true);
            }
        }
        toast({
            title: 'Member Deleted',
            description: `${member?.name || 'Member'} removed.`,
        });
    };

    // +++ Helper to detect if the logged-in child is editing themselves +++
    const isChildSelfEdit = currentUser?.role === 'child' && currentUser?.id === editingMember?.id;

    const activeMemberId = alwaysEditMode ? (isCreatingMember ? null : isEditingAll ? 'All' : editingMember?.id ?? null) : selectedMember;

    const handleSaveFamilyPhoto = async (nextPhotoUrls: PhotoUrls | null) => {
        const currentSetting = familyPhotoData?.settings?.[0];
        if (currentSetting?.id) {
            if (nextPhotoUrls) {
                await db.transact([
                    tx.settings[currentSetting.id].update({
                        value: JSON.stringify(nextPhotoUrls),
                    }),
                ]);
            } else {
                await db.transact([tx.settings[currentSetting.id].delete()]);
            }
            return;
        }
        if (nextPhotoUrls) {
            const settingId = id();
            await db.transact([
                tx.settings[settingId].update({
                    name: FAMILY_PHOTO_SETTING,
                    value: JSON.stringify(nextPhotoUrls),
                }),
            ]);
        }
    };

    const uploadFamilyPhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setIsFamilyPhotoSaving(true);
        const previousPhotoUrls = familyPhotoUrls;
        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) {
                throw new Error('Failed to upload family photo');
            }
            const data = await response.json();
            const nextPhotoUrls: PhotoUrls = {
                '64': data.photoUrls?.['64'],
                '320': data.photoUrls?.['320'],
                '1200': data.photoUrls?.['1200'],
            };

            await handleSaveFamilyPhoto(nextPhotoUrls);

            if (previousPhotoUrls) {
                try {
                    await fetch('/api/delete-image', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ urls: previousPhotoUrls }),
                    });
                } catch (cleanupErr) {
                    console.error('Failed to remove previous family photo:', cleanupErr);
                }
            }

            toast({
                title: 'Family Photo Updated',
                description: 'The All avatar now uses this photo.',
            });
        } catch (error) {
            console.error('Failed to upload family photo:', error);
            toast({
                title: 'Upload Failed',
                description: 'Could not update the family photo. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsFamilyPhotoSaving(false);
            event.target.value = '';
        }
    };

    const removeFamilyPhoto = async () => {
        if (!familyPhotoUrls) return;
        setIsFamilyPhotoSaving(true);
        const previousPhotoUrls = familyPhotoUrls;
        try {
            await handleSaveFamilyPhoto(null);
            try {
                await fetch('/api/delete-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ urls: previousPhotoUrls }),
                });
            } catch (cleanupErr) {
                console.error('Failed to remove stored family photo file:', cleanupErr);
            }
            toast({
                title: 'Family Photo Removed',
                description: 'The All avatar is back to its default.',
            });
        } catch (error) {
            console.error('Failed to remove family photo:', error);
            toast({
                title: 'Remove Failed',
                description: 'Could not remove the family photo. Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsFamilyPhotoSaving(false);
        }
    };

    return (
        <div className={alwaysEditMode ? 'w-full grid gap-6 md:grid-cols-[minmax(280px,360px)_minmax(420px,1fr)]' : 'w-full h-full min-h-0 flex flex-col'}>
            <div className="w-full h-full min-h-0 flex flex-col">
                <div className="mb-4 space-y-3">
                    <div className="flex justify-between items-center">
                        <h2 className="text-xl font-bold">Family Members</h2>
                    </div>
                </div>
                <ScrollArea className="flex-grow min-h-0">
                    <div className="pr-2 pb-1">
                        <div className="flex items-center mb-2">
                            {needsAllHandleSpacer && <div className="h-10 w-10 shrink-0" aria-hidden="true" />}
                            <Button
                                variant={activeMemberId === 'All' ? 'default' : 'ghost'}
                                className="w-full justify-start h-auto py-2"
                                onClick={activateAllForSettings}
                            >
                                <div className="flex items-center gap-3 min-w-0 w-full">
                                    <Avatar className="h-10 w-10 flex-shrink-0">
                                        {familyPhotoUrls?.['64'] ? (
                                            <AvatarImage src={'uploads/' + familyPhotoUrls['64']} alt="All family members" />
                                        ) : (
                                            <AvatarFallback>All</AvatarFallback>
                                        )}
                                    </Avatar>
                                    <span className="font-medium truncate">All</span>
                                </div>
                            </Button>
                        </div>
                        {orderedMembers.map((member, index) => {
                            return (
                                <SortableFamilyMemberItem
                                    key={member.id}
                                    member={member}
                                    index={index}
                                    isEditMode={isEditMode}
                                    selectedMember={activeMemberId}
                                    setSelectedMember={setSelectedMember}
                                    showBalances={showBalances}
                                    membersBalances={membersBalances}
                                    unitDefinitions={unitDefinitions}
                                    onMemberActivate={activateMemberForEditing}
                                    handleDeleteMember={handleDeleteMember}
                                    currentUser={currentUser}
                                    xpData={membersXP?.[member.id]}
                                    alwaysEditMode={alwaysEditMode}
                                />
                            );
                        })}
                    </div>
                </ScrollArea>
                {alwaysEditMode && (
                    <Button className="w-full mt-4" onClick={activateCreateMember}>
                        <PlusCircle className="mr-2 h-4 w-4" /> Add Family Member
                    </Button>
                )}
                {!alwaysEditMode && (
                    <Button asChild variant="outline" className="w-full mt-4">
                        <Link href="/settings#family-member-settings">Family Member Settings</Link>
                    </Button>
                )}
            </div>

            {alwaysEditMode && (
                <div className="border rounded-lg bg-card p-4 md:p-6 min-h-[320px]">
                    {isCreatingMember ? (
                        <div className="space-y-4">
                            <h3 className="text-xl font-semibold">Add Family Member</h3>
                            <div className="grid gap-4 py-2">
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="name" className="text-right">
                                        Name
                                    </Label>
                                    <Input id="name" value={newMemberName} onChange={(e) => setNewMemberName(e.target.value)} className="col-span-3" />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="email" className="text-right">
                                        Email (optional)
                                    </Label>
                                    <Input id="email" type="email" value={newMemberEmail} onChange={(e) => setNewMemberEmail(e.target.value)} className="col-span-3" />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label className="text-right">Role</Label>
                                    <RadioGroup value={newMemberRole} onValueChange={setNewMemberRole} className="col-span-3 flex gap-4">
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="parent" id="role-parent-add" />
                                            <Label htmlFor="role-parent-add">Parent</Label>
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            <RadioGroupItem value="child" id="role-child-add" />
                                            <Label htmlFor="role-child-add">Child</Label>
                                        </div>
                                    </RadioGroup>
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="pin" className="text-right">
                                        PIN (Numbers)
                                    </Label>
                                    <Input
                                        id="pin"
                                        type="password"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        maxLength={6}
                                        value={newMemberPin}
                                        onChange={(e) => setNewMemberPin(e.target.value)}
                                        className="col-span-3"
                                        placeholder="4-6 digit code"
                                    />
                                </div>
                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="photo" className="text-right">
                                        Photo
                                    </Label>
                                    <div className="col-span-3">
                                        <Input id="photo" type="file" accept="image/*" onChange={onFileChange} />
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
                            <div className="flex justify-end">
                                <Button onClick={handleAddMember} disabled={!newMemberName}>
                                    Add Member
                                </Button>
                            </div>
                        </div>
                    ) : isEditingAll ? (
                        <div className="space-y-4">
                            <h3 className="text-xl font-semibold">All Family Avatar</h3>
                            <p className="text-sm text-muted-foreground">
                                This photo is used for the <strong>All</strong> row avatar in family member lists.
                            </p>
                            <div className="flex items-center gap-4">
                                <Avatar className="h-20 w-20">
                                    {familyPhotoUrls?.['320'] ? (
                                        <AvatarImage src={'uploads/' + familyPhotoUrls['320']} alt="All family members" />
                                    ) : (
                                        <AvatarFallback>All</AvatarFallback>
                                    )}
                                </Avatar>
                                <div className="space-y-2">
                                    <Input
                                        type="file"
                                        accept="image/*"
                                        onChange={uploadFamilyPhoto}
                                        disabled={isFamilyPhotoSaving}
                                        className="max-w-sm"
                                    />
                                    <Button
                                        variant="outline"
                                        onClick={removeFamilyPhoto}
                                        disabled={isFamilyPhotoSaving || !familyPhotoUrls}
                                    >
                                        Remove Family Photo
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ) : editingMember ? (
                        <div className="space-y-4">
                            <h3 className="text-xl font-semibold">{isChildSelfEdit ? 'Update Profile' : `Edit ${editingMember.name}`}</h3>
                            <div className="grid gap-4 py-2">
                                {isChildSelfEdit ? (
                                    <div className="flex justify-center py-2">
                                        <h4 className="text-2xl font-bold">{editingMember?.name}</h4>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="edit-name" className="text-right">
                                            Name
                                        </Label>
                                        <Input id="edit-name" value={editMemberName} onChange={(e) => setEditMemberName(e.target.value)} className="col-span-3" />
                                    </div>
                                )}

                                {!isChildSelfEdit && (
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
                                )}

                                {!isChildSelfEdit && (
                                    <div className="grid grid-cols-4 items-center gap-4">
                                        <Label className="text-right">Role</Label>
                                        <RadioGroup value={editMemberRole} onValueChange={setEditMemberRole} className="col-span-3 flex gap-4">
                                            <div className="flex items-center space-x-2">
                                                <RadioGroupItem value="parent" id="role-parent-edit" />
                                                <Label htmlFor="role-parent-edit">Parent</Label>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                <RadioGroupItem value="child" id="role-child-edit" />
                                                <Label htmlFor="role-child-edit">Child</Label>
                                            </div>
                                        </RadioGroup>
                                    </div>
                                )}

                                <div className="grid grid-cols-4 items-center gap-4">
                                    <Label htmlFor="edit-pin" className={isChildSelfEdit ? 'text-right font-semibold' : 'text-right'}>
                                        New PIN
                                    </Label>
                                    <Input
                                        id="edit-pin"
                                        type="password"
                                        inputMode="numeric"
                                        pattern="[0-9]*"
                                        maxLength={6}
                                        value={editMemberPin}
                                        onChange={(e) => setEditMemberPin(e.target.value)}
                                        className="col-span-3"
                                        placeholder={isChildSelfEdit ? 'Enter new PIN to change' : 'Leave blank to keep existing'}
                                    />
                                </div>

                                {isChildSelfEdit ? (
                                    <div className="flex justify-center mt-2 mb-2">
                                        <Avatar className="h-32 w-32">
                                            <AvatarImage
                                                src={editingMember?.photoUrls?.['320'] ? `uploads/${editingMember.photoUrls['320']}` : undefined}
                                                alt={editingMember?.name}
                                                className="object-cover"
                                            />
                                            <AvatarFallback className="text-4xl">{editingMember?.name?.charAt(0).toUpperCase()}</AvatarFallback>
                                        </Avatar>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-4 items-start gap-4">
                                        <Label htmlFor="edit-photo" className="text-right">
                                            Photo
                                        </Label>
                                        <div className="col-span-3">
                                            <Input id="edit-photo" type="file" accept="image/*" onChange={onEditFileChange} />
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
                                            {!editImageSrc && editingMember?.photoUrls && (
                                                <div className="mt-4">
                                                    <Avatar className="h-16 w-16">
                                                        <AvatarImage
                                                            src={'uploads/' + editingMember.photoUrls['320']}
                                                            alt={editingMember.name}
                                                            className="object-cover"
                                                        />
                                                        <AvatarFallback className="text-lg">{editingMember.name.charAt(0).toUpperCase()}</AvatarFallback>
                                                    </Avatar>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {!isChildSelfEdit && editingMember?.photoUrls && (
                                    <div className="flex items-center">
                                        <Checkbox id="remove-photo" checked={removePhoto} onCheckedChange={(checked) => setRemovePhoto(checked === true)} />
                                        <Label htmlFor="remove-photo" className="ml-2">
                                            Remove existing photo
                                        </Label>
                                    </div>
                                )}
                            </div>
                            <div className="flex justify-end">
                                <Button onClick={handleUpdateMember} disabled={!editMemberName}>
                                    Save Member
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className="h-full min-h-[240px] flex items-center justify-center text-sm text-muted-foreground">
                            Select a family member to edit their profile and permissions.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

export default FamilyMembersList;
