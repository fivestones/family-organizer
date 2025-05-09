'use client';

import React, { useState, useMemo } from 'react'; // Added useMemo
import { init, tx, id } from '@instantdb/react';
// import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { PlusCircle } from 'lucide-react';
import FamilyMembersList from './FamilyMembersList';
import ChoreList from './ChoreList';
import DetailedChoreForm from './DetailedChoreForm';
import DateCarousel from '@/components/ui/DateCarousel';
import { createRRuleWithStartDate, getNextOccurrence, toUTCDate } from '@/lib/chore-utils'; // Ensure toUTCDate is imported
import { format } from 'date-fns';
import { useToast } from '@/components/ui/use-toast';
import { getAssignedMembersForChoreOnDate } from '@/lib/chore-utils';
// **** NEW: Import types and utility ****
import { UnitDefinition, Envelope, computeAllApplicableCurrencyCodes } from '@/lib/currency-utils'; // Import computeMonetaryCurrencies

// import { ScrollArea } from '@/components/ui/scroll-area';

// Define interfaces for our data structures
interface FamilyMember {
    id: string;
    name: string;
    email?: string;
    photoUrl?: string; // Legacy support if needed
    photoUrls?: {
        '64'?: string;
        '320'?: string;
        '1200'?: string;
    };
    // **** NEW: Add linked allowance envelopes ****
    allowanceEnvelopes?: Envelope[];
}

// Updated Chore interface
interface Chore {
    id: string;
    title: string;
    description?: string;
    startDate: string; // Keep as string to match DetailedChoreForm/utils expectations
    done: boolean; // Assuming this exists, though not used directly here
    rrule?: string;
    assignees: FamilyMember[];
    rotationType: 'none' | 'daily' | 'weekly' | 'monthly';
    weight?: number;
    assignments?: {
        id: string; // Added ID for assignments if needed for deletion
        order: number;
        familyMember: FamilyMember;
    }[];
    completions?: {
        id: string;
        completed: boolean;
        dateDue: string; // Assuming string based on ChoreList usage
        completedBy: { id: string }[]; // Assuming link structure
    }[];
    // +++ NEW: Add up-for-grabs fields +++
    isUpForGrabs?: boolean;
    rewardType?: 'fixed' | 'weight';
    rewardAmount?: number;
    rewardCurrency?: string;
}

// +++ Add ChoreCompletion type if not implicitly handled by Schema +++
interface ChoreCompletion {
    id: string;
    completed: boolean;
    dateDue: string;
    chore?: { id: string }[]; // Link to chore
    completedBy?: { id: string }[]; // Link to member
    // Add other fields from schema if needed
}

type Schema = {
    familyMembers: FamilyMember;
    chores: Chore;
    // **** NEW: Add other relevant namespaces ****
    allowanceEnvelopes: Envelope; // Needed for currency calculation
    unitDefinitions: UnitDefinition; // Needed for currency selector
    choreAssignments: any; // Add if needed for delete/update logic
    choreCompletions: ChoreCompletion; // Use defined interface
};

const APP_ID = process.env.NEXT_PUBLIC_INSTANT_APP_ID || 'af77353a-0a48-455f-b892-010232a052b4';
const db = init<Schema>({
    appId: APP_ID,
    apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI || 'http://localhost:8888',
    websocketURI: process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI || 'ws://localhost:8888/runtime/session',
});

function ChoresTracker() {
    const [selectedMember, setSelectedMember] = useState<string>('All');
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
    // --- Remove state for simple add form ---
    // const [newChoreTitle, setNewChoreTitle] = useState<string>('');
    // const [newChoreAssignee, setNewChoreAssignee] = useState<string>('');
    const [isDetailedChoreModalOpen, setIsDetailedChoreModalOpen] = useState(false);
    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const now = new Date();
        return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    });
    const { toast } = useToast();

    // **** UPDATED QUERY: Fetch members + linked envelopes, chores, and unit definitions ****
    const { isLoading, error, data } = db.useQuery({
        familyMembers: {
            assignedChores: {
                completions: {},
            },
            // **** Include allowance envelopes for balance calculation ****
            allowanceEnvelopes: {},
            choreAssignments: {},
        },
        chores: {
            assignees: {},
            assignments: {
                familyMember: {},
            },
            completions: {
                completedBy: {},
            },
        },
        // **** Fetch unit definitions ****
        unitDefinitions: {},
        // **** Fetch all envelopes for currency computation ****
        allowanceEnvelopes: {}, // Fetch all top-level envelopes
        // **** Fetch chore assignments and completions if needed for update/delete logic ****
        choreAssignments: {}, // Example: Fetch needed for update/delete
        choreCompletions: {
            // Fetch top-level completions needed for the check
            chore: {},
            completedBy: {},
        },
    });

    // --- Derived Data ---
    const familyMembers: FamilyMember[] = useMemo(() => data?.familyMembers || [], [data?.familyMembers]);
    const chores: Chore[] = useMemo(() => data?.chores || [], [data?.chores]);
    const unitDefinitions: UnitDefinition[] = useMemo(() => data?.unitDefinitions || [], [data?.unitDefinitions]);
    const allEnvelopes: Envelope[] = useMemo(() => data?.allowanceEnvelopes || [], [data?.allowanceEnvelopes]); // Get all envelopes from data
    // +++ Get top-level completions for the check +++
    const allChoreCompletions: ChoreCompletion[] = useMemo(() => data?.choreCompletions || [], [data?.choreCompletions]);

    // --- Compute Balances (existing logic) ---
    const membersBalances = useMemo(() => {
        const balances: { [memberId: string]: { [currency: string]: number } } = {};
        familyMembers.forEach((member) => {
            const memberId = member.id;
            balances[memberId] = {}; // Initialize balance object for member
            // Iterate through envelopes linked directly to the member in the query result
            (member.allowanceEnvelopes || []).forEach((envelope) => {
                if (envelope.balances) {
                    Object.entries(envelope.balances).forEach(([currency, amount]) => {
                        const upperCaseCurrency = currency.toUpperCase();
                        balances[memberId][upperCaseCurrency] = (balances[memberId][upperCaseCurrency] || 0) + amount;
                    });
                }
            });
        });
        return balances;
    }, [familyMembers]); // Recalculate when familyMembers data changes

    // +++ Compute Currency Data +++
    const allMonetaryCurrenciesInUse = useMemo(() => {
        // Use the utility function imported from currency-utils
        // Pass *all* fetched envelopes here
        return computeAllApplicableCurrencyCodes(allEnvelopes, unitDefinitions);
    }, [allEnvelopes, unitDefinitions]);

    const currencyOptions = useMemo(() => {
        const unitDefMap = new Map(unitDefinitions.map((def) => [def.code.toUpperCase(), def]));
        const codes = new Set<string>();

        // Add codes from definitions
        unitDefinitions.forEach((def) => codes.add(def.code.toUpperCase()));
        // Add codes from all monetary currencies found
        allMonetaryCurrenciesInUse.forEach((code) => codes.add(code.toUpperCase()));

        // Add common defaults like USD if defined or looks monetary
        ['USD'].forEach((c) => {
            const def = unitDefMap.get(c);
            const isMonetary = def?.isMonetary ?? c.length === 3;
            if (isMonetary || codes.has(c)) {
                codes.add(c);
            }
        });

        const sortedCodes = Array.from(codes).sort();

        // Generate label including symbol/name from definitions
        const optionsWithLabels = sortedCodes.map((code) => {
            const def = unitDefMap.get(code);
            const symbol = def?.symbol;
            const name = def?.name;
            let label = code;
            if (symbol && name) label = `${code} (${symbol} - ${name})`;
            else if (symbol) label = `${code} (${symbol})`;
            else if (name) label = `${code} (${name})`;
            return { value: code, label: label };
        });

        return [
            ...optionsWithLabels,
            { value: '__DEFINE_NEW__', label: 'Define New Unit...' }, // Add define new option
        ];
    }, [unitDefinitions, allMonetaryCurrenciesInUse]);

    if (isLoading) return <div>Loading...</div>;
    if (error) return <div>Error: {error.message}</div>;

    const addChore = (choreData: Partial<Chore>) => {
        const choreId = id();
        const transactions: any[] = [
            tx.chores[choreId].update({
                title: choreData.title!,
                description: choreData.description || '',
                startDate: new Date(choreData.startDate || Date.now()).toISOString(),
                // gemini wants the below instead of the above. It looks like it doesn't make a choreData.startDate into an ISOString. Not sure about this one.
                // startDate: choreData.startDate || new Date().toISOString(), // Ensure ISO string

                done: false,
                rrule: choreData.rrule || null,
                rotationType: choreData.rotationType || 'none',
                weight: choreData.weight ?? null, // Save weight, null if undefined
                // +++ NEW: Save up-for-grabs fields +++
                isUpForGrabs: choreData.isUpForGrabs ?? false,
                rewardType: choreData.rewardType ?? null,
                rewardAmount: choreData.rewardAmount ?? null,
                rewardCurrency: choreData.rewardCurrency ?? null,
            }),
        ];

        if (choreData.rotationType !== 'none' && !choreData.isUpForGrabs && choreData.assignments && choreData.assignments.length > 0) {
            // Use assignments with rotation (only if NOT up for grabs)
            choreData.assignments.forEach((assignment, index) => {
                const assignmentId = id();
                transactions.push(
                    tx.choreAssignments[assignmentId].update({
                        order: assignment.order ?? index,
                    }),
                    tx.chores[choreId].link({ assignments: assignmentId }),
                    tx.familyMembers[assignment.familyMember.id].link({
                        choreAssignments: assignmentId,
                    })
                );
            });
        }
        // Link assignees directly (always link assignees listed in choreData.assignees)
        if (choreData.assignees && choreData.assignees.length > 0) {
            // Link assignees directly
            choreData.assignees.forEach((assignee) => {
                // Ensure assignee has an id before trying to link
                if (assignee && assignee.id) {
                    transactions.push(
                        tx.chores[choreId].link({ assignees: assignee.id }),
                        tx.familyMembers[assignee.id].link({
                            assignedChores: choreId,
                        })
                    );
                } else {
                    console.warn('Skipping linking invalid assignee:', assignee);
                }
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

    const deleteFamilyMember = async (memberId: string) => {
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
        await db.transact([tx.familyMembers[memberId].delete()]);
        if (selectedMember === memberId) {
            setSelectedMember('All');
        }
        toast({
            title: 'Member Deleted',
            description: `${member?.name || 'Member'} removed.`,
        });
    };

    const toggleChoreDone = async (choreId: string, familyMemberId: string) => {
        const chore = chores.find((c) => c.id === choreId);
        // +++ Add check for Up for Grabs +++
        const isUpForGrabsChore = chore?.isUpForGrabs ?? false;
        const formattedDate = format(selectedDate, 'yyyy-MM-dd');

        if (!chore) {
            // Keep existing chore check
            console.error('Chore not found:', choreId);
            toast({
                title: 'Error',
                description: 'Could not find the chore.',
                variant: 'destructive',
            });
            return;
        }

        // +++ Check if Up for Grabs and already completed by someone else +++
        if (isUpForGrabsChore) {
            // Query completions for THIS chore on THIS date
            // Note: This requires `choreCompletions` to be fetched in the main query if not already linked sufficiently
            // Using `allChoreCompletions` derived from the main query
            const completionsOnDate = allChoreCompletions.filter((c: any) => c.chore?.[0]?.id === choreId && c.dateDue === formattedDate && c.completed);

            if (completionsOnDate.length > 0) {
                // Check if the current user is trying to mark it complete AGAIN (allow unchecking)
                const currentUserCompletion = completionsOnDate.find((c) => c.completedBy?.[0]?.id === familyMemberId);
                if (!currentUserCompletion) {
                    // Someone else completed it, prevent current user from completing
                    // Try to find the completer's name (might need fuller data fetch)
                    const completerId = completionsOnDate[0].completedBy?.[0]?.id;
                    const completer = familyMembers.find((fm) => fm.id === completerId);
                    toast({
                        title: 'Chore Already Completed',
                        description: `${chore.title} was already completed by ${completer?.name || 'another member'} on ${formattedDate}.`,
                        variant: 'default', // Or "info"
                    });
                    return; // Stop execution
                }
                // If currentUserCompletion exists, it means the current user is UNCHECKING it, allow this below.
            }
        }
        // --- End Up for Grabs Check ---

        // Original logic to find/update/create completion (proceed if not blocked above)
        const currentCompletions = chore.completions || [];
        const existingCompletion = currentCompletions.find(
            (completion) =>
                completion.completedBy?.[0]?.id === familyMemberId && // Safer access
                completion.dateDue === formattedDate
        );

        try {
            if (existingCompletion) {
                // Update existing completion
                db.transact([
                    tx.choreCompletions[existingCompletion.id].update({
                        completed: !existingCompletion.completed,
                        dateCompleted: !existingCompletion.completed
                            ? new Date().toISOString() // Use ISO string
                            : null,
                    }),
                ]);
                toast({
                    title: 'Chore Updated',
                    description: `Marked as ${!existingCompletion.completed ? 'done' : 'not done'}.`,
                });
            } else {
                // Create new completion
                const newCompletionId = id();
                db.transact([
                    tx.choreCompletions[newCompletionId].update({
                        dateDue: formattedDate,
                        dateCompleted: new Date().toISOString(), // Set completion time
                        completed: true,
                        allowanceAwarded: false, // Set allowanceAwarded to false for new completions
                    }),
                    tx.chores[choreId].link({ completions: newCompletionId }),
                    tx.familyMembers[familyMemberId].link({
                        completedChores: newCompletionId,
                    }),
                ]);
                toast({ title: 'Chore Marked Done' });
            }
        } catch (err: any) {
            console.error('Error toggling chore completion:', err);
            toast({
                title: 'Error',
                description: `Failed to update chore status: ${err.message}`,
                variant: 'destructive',
            });
        }
    };

    const updateChore = async (choreId, updatedChoreData) => {
        try {
            const transactions = [];

            // 1. Update basic chore info
            transactions.push(
                tx.chores[choreId].update({
                    title: updatedChoreData.title,
                    description: updatedChoreData.description,
                    startDate: updatedChoreData.startDate, // Already ISO string from form
                    rrule: updatedChoreData.rrule,
                    rotationType: updatedChoreData.rotationType,
                    weight: updatedChoreData.weight ?? null,
                    // +++ NEW: Update up-for-grabs fields +++
                    isUpForGrabs: updatedChoreData.isUpForGrabs ?? false,
                    rewardType: updatedChoreData.rewardType ?? null,
                    rewardAmount: updatedChoreData.rewardAmount ?? null,
                    rewardCurrency: updatedChoreData.rewardCurrency ?? null,
                })
            );

            // 2. Handle Assignees & Assignments (more robustly)
            const existingChore = chores.find((c) => c.id === choreId); // Use memoized data
            if (!existingChore) throw new Error('Original chore data not found for update.');

            // Get IDs of currently selected assignees from the form data
            const newAssigneeIds = new Set(updatedChoreData.assignees.map((a) => a.id));
            // Get IDs of existing linked assignees
            const oldAssigneeIds = new Set(existingChore.assignees?.map((a) => a.id) ?? []);
            // Get IDs of existing linked assignments (rotation)
            // --- Fetch existing assignments directly from data if needed ---
            const existingAssignments = data?.choreAssignments?.filter((a) => a.chore?.[0]?.id === choreId) || []; // Fetch if query includes choreAssignments linked to chore
            const oldAssignmentMemberIds = new Set(existingAssignments?.map((a) => a.familyMember?.[0]?.id) ?? []);

            // --- Unlink assignees who are no longer selected ---
            existingChore.assignees?.forEach((assignee) => {
                if (!newAssigneeIds.has(assignee.id)) {
                    transactions.push(tx.chores[choreId].unlink({ assignees: assignee.id }));
                    // Also unlink from member side if necessary, depends on schema/query needs
                    transactions.push(
                        tx.familyMembers[assignee.id].unlink({
                            assignedChores: choreId,
                        })
                    );
                }
            });

            // --- Link new assignees ---
            updatedChoreData.assignees.forEach((assignee) => {
                if (!oldAssigneeIds.has(assignee.id)) {
                    transactions.push(
                        tx.chores[choreId].link({ assignees: assignee.id }),
                        // Link from member side if needed
                        tx.familyMembers[assignee.id].link({
                            assignedChores: choreId,
                        })
                    );
                }
            });

            // --- Handle Rotation Assignments ---
            const isRotatingNow = updatedChoreData.rotationType !== 'none' && !updatedChoreData.isUpForGrabs;
            const newRotationMemberIds = updatedChoreData.assignments?.map((a) => a.familyMember.id) ?? [];

            // Delete old assignments that are no longer needed
            existingAssignments?.forEach((assignment) => {
                // Use fetched assignments
                if (!isRotatingNow || !newRotationMemberIds.includes(assignment.familyMember?.[0]?.id)) {
                    // Check if assignment.id exists before trying to delete
                    if (assignment.id) {
                        transactions.push(tx.choreAssignments[assignment.id].delete());
                        // Unlink from member? Depends if choreAssignments link exists
                        if (assignment.familyMember?.[0]?.id) {
                            transactions.push(
                                tx.familyMembers[assignment.familyMember[0].id].unlink({
                                    choreAssignments: assignment.id,
                                })
                            );
                        }
                    } else {
                        console.warn('Attempted to delete assignment without ID for chore:', choreId);
                    }
                }
            });

            // Add/Update new assignments if rotation is active
            if (isRotatingNow && updatedChoreData.assignments) {
                updatedChoreData.assignments.forEach((assignment, index) => {
                    const existingAssignment = existingAssignments?.find((a) => a.familyMember?.[0]?.id === assignment.familyMember.id);
                    if (existingAssignment) {
                        // Update existing assignment order if necessary
                        if (existingAssignment.order !== index) {
                            transactions.push(
                                tx.choreAssignments[existingAssignment.id].update({
                                    order: index,
                                })
                            );
                        }
                    } else {
                        // Create new assignment
                        const newAssignmentId = id();
                        transactions.push(
                            tx.choreAssignments[newAssignmentId].update({
                                order: index,
                            }),
                            tx.chores[choreId].link({
                                assignments: newAssignmentId,
                            }),
                            tx.familyMembers[assignment.familyMember.id].link({
                                choreAssignments: newAssignmentId,
                            })
                        );
                    }
                });
            }

            // 3. Transact
            await db.transact(transactions);

            toast({
                title: 'Success',
                description: 'Chore updated successfully.',
            });
            // Ensure modal closes upon successful update, potentially handle in ChoreList?
            // setIsDetailedChoreModalOpen(false); // Maybe handle in ChoreList where edit is triggered
        } catch (error: any) {
            console.error('Error updating chore:', error);
            toast({
                title: 'Error Updating Chore',
                description: error.message || 'Failed to update chore. Please try again.',
                variant: 'destructive',
            });
        }
    };

    const deleteChore = (choreId) => {
        // Consider implications: Should completions be deleted? Assignments?
        // Simple delete for now:
        db.transact([tx.chores[choreId].delete()])
            .then(() => {
                toast({ title: 'Chore Deleted' });
            })
            .catch((err) => {
                console.error('Error deleting chore:', err);
                toast({
                    title: 'Error',
                    description: 'Failed to delete chore.',
                    variant: 'destructive',
                });
            });
    };

    const handleDateSelect = (date: Date) => {
        // Ensure the selected date is UTC midnight for consistency
        setSelectedDate(toUTCDate(date));
    };

    const filteredChores = chores.filter((chore) => {
        // Ensure chore is valid before processing
        if (!chore || !chore.id || !chore.startDate) {
            console.warn('Skipping invalid chore object:', chore);
            return false;
        }
        const assignedMembers = getAssignedMembersForChoreOnDate(chore, selectedDate);
        if (selectedMember === 'All') {
            // Show if anyone is assigned on this date
            return assignedMembers.length > 0;
        } else {
            // Show if the selected member is assigned on this date
            return assignedMembers.some((assignee) => assignee.id === selectedMember);
        }
    });

    return (
        <div className="min-h-screen flex">
            {/* left sidebar */}
            <div className="w-1/4 bg-gray-100 p-4 flex-shrink-0 border-r">
                <FamilyMembersList
                    familyMembers={familyMembers}
                    selectedMember={selectedMember}
                    setSelectedMember={setSelectedMember}
                    addFamilyMember={addFamilyMember}
                    deleteFamilyMember={deleteFamilyMember}
                    db={db}
                    // **** NEW: Pass balance data ****
                    showBalances={true} // Enable balance display
                    membersBalances={membersBalances}
                    unitDefinitions={unitDefinitions}
                />
            </div>

            {/* right content area */}
            <div className="w-3/4 p-4 flex flex-col h-screen space-y-4">
                {' '}
                {/* h-screen on Right Panel: Sets a fixed boundary for the right panel based on the viewport height. Content exceeding this won't cause page scroll if overflow is handled internally. */}
                <h2 className="text-xl font-bold flex-shrink-0">
                    {selectedMember === 'All' ? 'All Chores' : `${familyMembers.find((m) => m.id === selectedMember)?.name}'s Chores`}
                </h2>
                {/* View Toggle Buttons */}
                {/* <div className="flex-shrink-0">
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
              </div> */}
                {/* DateCarousel */}
                <div className="mb-4 flex-shrink-0">
                    {/* Pass UTC date to initialDate */}
                    <DateCarousel onDateSelect={handleDateSelect} initialDate={selectedDate} />
                </div>
                {/* Add Chore Button */}
                <div className="flex-shrink-0 text-right">
                    <Dialog open={isDetailedChoreModalOpen} onOpenChange={setIsDetailedChoreModalOpen}>
                        <DialogTrigger asChild>
                            <Button variant="default">
                                <PlusCircle className="mr-2 h-4 w-4" /> Add Chore
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="sm:max-w-[500px]">
                            {' '}
                            {/* Adjust width as needed */}
                            <DialogHeader>
                                <DialogTitle>Add New Chore</DialogTitle>
                            </DialogHeader>
                            {/* Pass computed currencyOptions and other necessary props */}
                            <DetailedChoreForm
                                familyMembers={familyMembers}
                                onSave={addChore}
                                initialDate={selectedDate} // Pass the selected date
                                db={db} // Pass db instance
                                unitDefinitions={unitDefinitions} // Pass definitions
                                currencyOptions={currencyOptions} // Pass computed options
                            />
                        </DialogContent>
                    </Dialog>
                </div>
                {/* Chores List Area */}
                {viewMode === 'list' ? (
                    <div className="flex flex-col gap-4 grow min-h-0">
                        {' '}
                        {/* grow min-h-0 */}
                        {/* Removed simple Add Chore form */}
                        <div className="flex flex-col gap-6 grow min-h-0">
                            {' '}
                            {/* grow min-h-0 */}
                            <ChoreList
                                chores={filteredChores}
                                familyMembers={familyMembers}
                                selectedMember={selectedMember}
                                selectedDate={selectedDate} // Pass selectedDate
                                toggleChoreDone={toggleChoreDone}
                                updateChore={updateChore}
                                deleteChore={deleteChore}
                                // Pass props needed for DetailedChoreForm within ChoreList's Dialog
                                db={db}
                                unitDefinitions={unitDefinitions}
                                currencyOptions={currencyOptions}
                            />
                            {/* Optional: Add back allowance balance display if needed */}
                            {/* {selectedMember !== 'All' && ( ... allowance display ... )} */}
                        </div>
                    </div>
                ) : (
                    <div className="flex-grow">Calendar View (Not implemented)</div>
                )}
            </div>
        </div>
    );
}

// Removed AddChoreForm (using DetailedChoreForm in Dialog)
// Removed CalendarView placeholder

export default ChoresTracker;
