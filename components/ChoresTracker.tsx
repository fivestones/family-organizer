// components/ChoresTracker.tsx
'use client';

import React, { useState, useMemo } from 'react'; // Removed useEffect
import { tx, id } from '@instantdb/react'; // Removed init, keep tx/id
import { db } from '@/lib/db'; // <--- FIX: Import the global DB instance with full schema
// import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import {
    PlusCircle,
    SlidersHorizontal,
    Menu,
    Calendar as CalendarIcon,
    MoreHorizontal,
    CheckSquare,
    ListTodo,
    CreditCard,
    Settings,
    Users,
} from 'lucide-react';
import FamilyMembersList from './FamilyMembersList';
import ChoreList from './ChoreList';
import DetailedChoreForm from './DetailedChoreForm';
import DateCarousel from '@/components/ui/DateCarousel';
import { createRRuleWithStartDate, getNextOccurrence, toUTCDate, calculateDailyXP } from '@/lib/chore-utils'; // +++ Added calculateDailyXP +++
import { useToast } from '@/components/ui/use-toast';
import { getAssignedMembersForChoreOnDate } from '@/lib/chore-utils';
// **** NEW: Import types and utility ****
import { UnitDefinition, Envelope, computeAllApplicableCurrencyCodes } from '@/lib/currency-utils'; // Import computeMonetaryCurrencies
import TaskSeriesEditor from '@/components/task-series/TaskSeriesEditor';

// +++ NEW IMPORTS +++
import { useAuth } from '@/components/AuthProvider';
import { useParentMode } from '@/components/auth/useParentMode';
import { RestrictedButton } from '@/components/ui/RestrictedButton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils'; // Import cn for class merging
import Link from 'next/link';

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
    allowanceEnvelopes?: Envelope[];
    lastDisplayCurrency?: string | null;
    allowanceAmount?: number | null;
    allowanceCurrency?: string | null;
    allowanceRrule?: string | null;
    allowanceStartDate?: string | null; // Schema is i.date(), so this will be an ISO string or null
    allowanceConfig?: any | null; // Using 'any' for the JSON object
    allowancePayoutDelayDays?: number | null;
    // +++ ADD ROLE +++
    role?: string | null;
    // +++ VIEW SETTINGS +++
    viewShowChoreDescriptions?: boolean;
    viewShowTaskDetails?: boolean;
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
        completedBy: { id: string }; // Assuming link structure
        allowanceAwarded?: boolean;
        dateCompleted?: string;
    }[];
    isUpForGrabs?: boolean;
    isJoint?: boolean;
    rewardType?: 'fixed' | 'weight';
    rewardAmount?: number;
    rewardCurrency?: string;
    taskSeries?: { id: string; name: string; startDate?: string; tasks?: any[] }[];
}

// +++ Add ChoreCompletion type if not implicitly handled by Schema +++
interface ChoreCompletion {
    id: string;
    completed: boolean;
    dateDue: string;
    chore?: { id: string }; // Link to chore
    completedBy?: { id: string }; // Link to member
    // Add other fields from schema if needed
}

// --- REMOVED: Local Schema definition and local db initialization ---
// The local schema was missing 'tasks' and 'taskSeries', causing the Save Failed error.
// We now use the imported `db` which uses the full `instant.schema.ts`.

function ChoresTracker() {
    const [selectedMember, setSelectedMember] = useState<string>('All');
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
    // --- Remove state for simple add form ---
    // const [newChoreTitle, setNewChoreTitle] = useState<string>('');
    // const [newChoreAssignee, setNewChoreAssignee] = useState<string>('');
    const [isDetailedChoreModalOpen, setIsDetailedChoreModalOpen] = useState(false);
    const [editingTaskSeriesId, setEditingTaskSeriesId] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const now = new Date();
        return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    });
    // +++ MOBILE STATE +++
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isMobileDateVisible, setIsMobileDateVisible] = useState(false);

    const { toast } = useToast();

    // +++ NEW: Get Auth +++
    const { currentUser } = useAuth();
    const { isParentMode } = useParentMode();

    // **** UPDATED QUERY: Fetch members + linked envelopes, chores, and unit definitions ****
    const { isLoading, error, data } = db.useQuery({
        familyMembers: {
            $: { order: { order: 'asc' } },

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
            taskSeries: {
                tasks: {
                    // Fetch all tasks for the series
                    parentTask: {},
                    // +++ NEW: Fetch notes and attachments for metadata display +++
                    attachments: {},
                    // Note: notes is a direct field, so it comes automatically with the entity
                },
                familyMember: {},
            },
        },
        // **** Fetch unit definitions ****
        unitDefinitions: {},
        // **** Fetch all envelopes for currency computation ****
        allowanceEnvelopes: {}, // Fetch all top-level envelopes
        // **** Fetch chore assignments and completions if needed for update/delete logic ****

        // +++ FIX: Request 'chore' relation so we can filter by it in updateChore +++
        choreAssignments: {
            chore: {}, // Ensure we fetch the parent chore
        },

        choreCompletions: {
            // Fetch top-level completions needed for the check
            chore: {},
            completedBy: {},
            // +++ NEW: Fetch markedBy +++
            markedBy: {},
        },
    });

    // --- Derived Data ---
    // Use 'as any' casting if strict schema typing conflicts with the generic interface,
    // but typically the global db schema inference should align if the interfaces match.
    const familyMembers: FamilyMember[] = useMemo(() => (data?.familyMembers as any) || [], [data?.familyMembers]);
    const chores: Chore[] = useMemo(() => (data?.chores as any) || [], [data?.chores]);
    const unitDefinitions: UnitDefinition[] = useMemo(() => (data?.unitDefinitions as any) || [], [data?.unitDefinitions]);
    const allEnvelopes: Envelope[] = useMemo(() => (data?.allowanceEnvelopes as any) || [], [data?.allowanceEnvelopes]); // Get all envelopes from data
    // +++ Get top-level completions for the check +++
    const allChoreCompletions: ChoreCompletion[] = useMemo(() => (data?.choreCompletions as any) || [], [data?.choreCompletions]);

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
                isUpForGrabs: choreData.isUpForGrabs ?? false,
                isJoint: choreData.isJoint ?? false,
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

    // **** REMOVED: addFamilyMember function ****
    // **** REMOVED: deleteFamilyMember function ****

    // **** UPDATED: toggleChoreDone now accepts executorId ****
    const toggleChoreDone = async (choreId: string, familyMemberId: string, executorId?: string) => {
        const chore = chores.find((c) => c.id === choreId);
        // +++ Add check for Up for Grabs +++
        const isUpForGrabsChore = chore?.isUpForGrabs ?? false;
        const formattedDate = selectedDate.toISOString().slice(0, 10);

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
                const currentUserCompletion = completionsOnDate.find((c: any) => c.completedBy?.id === familyMemberId);
                if (!currentUserCompletion) {
                    // Someone else completed it, prevent current user from completing
                    // Try to find the completer's name (might need fuller data fetch)
                    const completerId = completionsOnDate[0].completedBy?.id;
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
                completion.completedBy?.id === familyMemberId && // Safer access
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
                const transactions: any[] = [
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
                ];

                // +++ NEW: Link markedBy if executor exists +++
                if (executorId) {
                    transactions.push(tx.familyMembers[executorId].link({ markedCompletions: newCompletionId }));
                }

                db.transact(transactions);
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

    const updateChore = async (choreId: any, updatedChoreData: any) => {
        try {
            const transactions = [];

            // 1. Update basic chore info
            transactions.push(
                tx.chores[choreId].update({
                    title: updatedChoreData.title,
                    description: updatedChoreData.description,
                    startDate: updatedChoreData.startDate,
                    rrule: updatedChoreData.rrule,
                    rotationType: updatedChoreData.rotationType,
                    weight: updatedChoreData.weight ?? null,
                    isUpForGrabs: updatedChoreData.isUpForGrabs ?? false,
                    isJoint: updatedChoreData.isJoint ?? false,
                    rewardType: updatedChoreData.rewardType ?? null,
                    rewardAmount: updatedChoreData.rewardAmount ?? null,
                    rewardCurrency: updatedChoreData.rewardCurrency ?? null,
                })
            );

            // 2. Handle Assignees & Assignments (more robustly)
            const existingChore = chores.find((c) => c.id === choreId); // Use memoized data
            if (!existingChore) throw new Error('Original chore data not found for update.');

            // Get IDs of currently selected assignees from the form data
            const newAssigneeIds = new Set(updatedChoreData.assignees.map((a: any) => a.id));
            // Get IDs of existing linked assignees
            const oldAssigneeIds = new Set(existingChore.assignees?.map((a) => a.id) ?? []);
            // Get IDs of existing linked assignments (rotation)
            // --- Fetch existing assignments directly from data if needed ---

            // --- FILTER: Attempt to find assignments for this chore
            // The logic below handles BOTH 'Array' (standard) and 'Object' (possible edge case) relations
            const existingAssignments: any[] =
                (data?.choreAssignments as any)?.filter((a: any) => {
                    if (!a.chore) return false;
                    // Check if array
                    if (Array.isArray(a.chore)) {
                        return a.chore[0]?.id === choreId;
                    }
                    // Check if direct object
                    return (a.chore as any).id === choreId;
                }) || [];

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
            updatedChoreData.assignees.forEach((assignee: any) => {
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
            const newRotationMemberIds = updatedChoreData.assignments?.map((a: any) => a.familyMember.id) ?? [];

            // Delete old assignments that are no longer needed
            existingAssignments?.forEach((assignment) => {
                // Determine member ID safely
                const memberId = Array.isArray(assignment.familyMember) ? assignment.familyMember[0]?.id : assignment.familyMember?.id;

                // Use fetched assignments
                if (!isRotatingNow || !newRotationMemberIds.includes(memberId)) {
                    // Check if assignment.id exists before trying to delete
                    if (assignment.id) {
                        transactions.push(tx.choreAssignments[assignment.id].delete());
                        // Unlink from member? Depends if choreAssignments link exists
                        if (memberId) {
                            transactions.push(
                                tx.familyMembers[memberId].unlink({
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
                updatedChoreData.assignments.forEach((assignment: any, index: any) => {
                    // Find existing by member ID
                    const existingAssignment = existingAssignments?.find((a) => {
                        const memberId = Array.isArray(a.familyMember) ? a.familyMember[0]?.id : a.familyMember?.id;
                        return memberId === assignment.familyMember.id;
                    });

                    if (existingAssignment) {
                        // Update existing assignment order if necessary
                        if (existingAssignment.order !== index) {
                            transactions.push(tx.choreAssignments[existingAssignment.id].update({ order: index }));
                        }
                    } else {
                        // Create new assignment
                        const newAssignmentId = id();
                        transactions.push(
                            tx.choreAssignments[newAssignmentId].update({ order: index }),
                            tx.chores[choreId].link({ assignments: newAssignmentId }),
                            tx.familyMembers[assignment.familyMember.id].link({ choreAssignments: newAssignmentId })
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
            // setIsDetailedChoreModalOpen(false);
            // Maybe handle in ChoreList where edit is triggered
        } catch (error: any) {
            console.error('Error updating chore:', error);
            toast({
                title: 'Error Updating Chore',
                description: error.message || 'Failed to update chore. Please try again.',
                variant: 'destructive',
            });
        }
    };

    const deleteChore = (choreId: any) => {
        // Consider implications: Should completions be deleted? Assignments?
        // Simple delete for now:
        db.transact([tx.chores[choreId].delete()])
            .then(() => {
                toast({ title: 'Chore Deleted' });
            })
            .catch((err: any) => {
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

    // +++ Logic for Add Button +++
    const isParent = isParentMode;
    const canAddChore = isParent;

    // +++ Persistence for View Settings +++
    // We assume 'currentUser' is available and synced with familyMembers in the DB.
    // If not authenticated, default to false.
    const loggedInMember = familyMembers.find((m) => m.id === currentUser?.id);

    // +++ FIX: Default Settings Logic +++
    // If viewing a specific person (not 'All'), default to TRUE (Show everything).
    // If viewing 'All', default to FALSE (Hide details to reduce clutter).
    // This applies if the user is Logged Out OR if they haven't explicitly set a preference (value is null/undefined).
    const defaultViewSetting = selectedMember !== 'All';

    const showChoreDescriptions = loggedInMember?.viewShowChoreDescriptions ?? defaultViewSetting;
    const showTaskDetails = loggedInMember?.viewShowTaskDetails ?? defaultViewSetting;

    const toggleViewSetting = (setting: 'viewShowChoreDescriptions' | 'viewShowTaskDetails', value: boolean) => {
        if (!loggedInMember) return;
        db.transact(tx.familyMembers[loggedInMember.id].update({ [setting]: value }));
    };

    return (
        <div className="min-h-screen flex flex-col md:flex-row">
            {/* Left Sidebar (Desktop Only) */}
            <div className="hidden md:block w-1/4 bg-gray-100 p-4 flex-shrink-0 border-r min-h-screen">
                <FamilyMembersList
                    familyMembers={familyMembers}
                    selectedMember={selectedMember}
                    setSelectedMember={setSelectedMember}
                    // **** REMOVED: addFamilyMember and deleteFamilyMember props ****
                    db={db}
                    // **** NEW: Pass balance data ****
                    showBalances={true} // Enable balance display
                    membersBalances={membersBalances}
                    unitDefinitions={unitDefinitions}
                />
            </div>

            {/* Mobile Menu Modal (New Layout) */}
            <Dialog open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                <DialogContent
                    className={cn(
                        'fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
                        'w-screen h-[100dvh] max-w-none m-0 rounded-none border-0 top-0 left-0 translate-x-0 translate-y-0',
                        'pt-12 pb-6 px-4'
                    )}
                >
                    {/* Header Removed (Menu title) */}

                    {/* 1. Top Buttons Grid */}
                    <div className="grid grid-cols-3 gap-3 mb-2 shrink-0">
                        {/* Chores Button */}
                        <Link href="/" onClick={() => setIsMobileMenuOpen(false)}>
                            <Button variant="outline" className="w-full flex flex-col h-auto py-3 gap-1 hover:bg-accent/50">
                                <CheckSquare className="h-6 w-6 text-primary" />
                                <span className="text-xs font-medium">Chores</span>
                            </Button>
                        </Link>

                        {/* Calendar Button */}
                        <Link href="/calendar" onClick={() => setIsMobileMenuOpen(false)}>
                            <Button variant="outline" className="w-full flex flex-col h-auto py-3 gap-1 hover:bg-accent/50">
                                <CalendarIcon className="h-6 w-6 text-blue-500" />
                                <span className="text-xs font-medium">Calendar</span>
                            </Button>
                        </Link>

                        {/* More Button (Dropdown) */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="w-full flex flex-col h-auto py-3 gap-1 hover:bg-accent/50">
                                    <MoreHorizontal className="h-6 w-6 text-muted-foreground" />
                                    <span className="text-xs font-medium">More</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56" sideOffset={8}>
                                <Link href="/task-series" onClick={() => setIsMobileMenuOpen(false)}>
                                    <DropdownMenuItem className="cursor-pointer gap-2">
                                        <ListTodo className="h-4 w-4" /> Task Series
                                    </DropdownMenuItem>
                                </Link>
                                <Link href="/familyMemberDetail" onClick={() => setIsMobileMenuOpen(false)}>
                                    <DropdownMenuItem className="cursor-pointer gap-2">
                                        <CreditCard className="h-4 w-4" /> Manage Finances
                                    </DropdownMenuItem>
                                </Link>
                                <Link href="/allowance-distribution" onClick={() => setIsMobileMenuOpen(false)}>
                                    <DropdownMenuItem className="cursor-pointer gap-2">
                                        <Users className="h-4 w-4" /> Allowance Dist.
                                    </DropdownMenuItem>
                                </Link>
                                <Link href="/settings" onClick={() => setIsMobileMenuOpen(false)}>
                                    <DropdownMenuItem className="cursor-pointer gap-2">
                                        <Settings className="h-4 w-4" /> Settings
                                    </DropdownMenuItem>
                                </Link>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    {/* 2. Family Members (Takes remaining space) */}
                    <div className="flex-grow flex flex-col min-h-0 bg-gray-50/50 rounded-xl border p-2 overflow-hidden">
                        {/* Removed Label "Family & Balance" */}
                        <div className="flex-grow overflow-y-auto">
                            <FamilyMembersList
                                familyMembers={familyMembers}
                                selectedMember={selectedMember}
                                setSelectedMember={(id) => {
                                    setSelectedMember(id);
                                    setIsMobileMenuOpen(false); // Close menu on selection
                                }}
                                db={db}
                                showBalances={true}
                                membersBalances={membersBalances}
                                unitDefinitions={unitDefinitions}
                            />
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Right content area */}
            <div className="w-full md:w-3/4 p-4 flex flex-col h-screen space-y-4">
                {' '}
                {/* h-screen on Right Panel: Sets a fixed boundary for the right panel based on the viewport height. Content exceeding this won't cause page scroll if overflow is handled internally. */}
                {/* +++ UPDATED LAYOUT: Top Bar Container +++ */}
                <div className="flex items-center justify-between gap-2 md:gap-4 flex-shrink-0">
                    {/* 1. Header Title & Add Chore Button Column */}
                    <div className="flex items-center gap-3">
                        {/* Mobile Menu Button */}
                        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setIsMobileMenuOpen(true)}>
                            <Menu className="h-5 w-5" />
                        </Button>

                        <div className="flex flex-col gap-2">
                            <h2 className="text-lg md:text-xl font-bold whitespace-nowrap">
                                {selectedMember === 'All' ? 'All Chores' : `${familyMembers.find((m) => m.id === selectedMember)?.name}'s Chores`}
                            </h2>

                            <div className="flex-shrink-0">
                                <Dialog open={isDetailedChoreModalOpen} onOpenChange={setIsDetailedChoreModalOpen}>
                                    {/* +++ Use RestrictedButton Trigger Logic +++ */}
                                    {canAddChore ? (
                                        <DialogTrigger asChild>
                                            <Button variant="default" size="sm">
                                                <PlusCircle className="mr-2 h-4 w-4" /> Add Chore
                                            </Button>
                                        </DialogTrigger>
                                    ) : (
                                        <RestrictedButton isRestricted={true} restrictionMessage="Only parents can add chores." variant="default" size="sm">
                                            <PlusCircle className="mr-2 h-4 w-4" /> Add Chore
                                        </RestrictedButton>
                                    )}
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
                        </div>
                    </div>

                    {/* 2. DateCarousel (Centered and Flexible) */}
                    {/* Desktop: Visible / Mobile: Controlled by toggle */}
                    <div
                        className={`
                        absolute md:static top-[120px] left-0 right-0 z-20 bg-background md:bg-transparent shadow-md md:shadow-none p-2 md:p-0
                        ${isMobileDateVisible ? 'flex' : 'hidden'} md:flex
                        flex-grow justify-center min-w-0
                    `}
                    >
                        {/* Pass UTC date to initialDate */}
                        <DateCarousel onDateSelect={handleDateSelect} initialDate={selectedDate} />
                    </div>

                    {/* 3. Settings & Mobile Calendar Toggle (Right side) */}
                    <div className="flex-shrink-0 flex items-center gap-2">
                        {/* Mobile Date Toggle */}
                        <Button
                            variant={isMobileDateVisible ? 'secondary' : 'outline'}
                            size="icon"
                            className="md:hidden"
                            onClick={() => setIsMobileDateVisible(!isMobileDateVisible)}
                        >
                            <CalendarIcon className="h-4 w-4" />
                        </Button>

                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" size="icon">
                                    <SlidersHorizontal className="h-4 w-4" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-60" align="end">
                                <div className="grid gap-4">
                                    <div className="space-y-2">
                                        <h4 className="font-medium leading-none">View Options</h4>
                                        <p className="text-sm text-muted-foreground">Customize your chore list view.</p>
                                    </div>
                                    <div className="grid gap-2">
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="show-descriptions">Chore Descriptions</Label>
                                            <Switch
                                                id="show-descriptions"
                                                checked={showChoreDescriptions}
                                                onCheckedChange={(val) => toggleViewSetting('viewShowChoreDescriptions', val)}
                                                disabled={!loggedInMember} // Disable if not logged in
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <Label htmlFor="show-details">Show Task Details</Label>
                                            <Switch
                                                id="show-details"
                                                checked={showTaskDetails}
                                                onCheckedChange={(val) => toggleViewSetting('viewShowTaskDetails', val)}
                                                disabled={!loggedInMember}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>
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
                                onEditTaskSeries={(seriesId: string) => setEditingTaskSeriesId(seriesId)}
                                // +++ NEW PROPS +++
                                currentUser={currentUser}
                                canEditChores={isParent} // Only parents can edit/delete
                                showChoreDescriptions={showChoreDescriptions}
                                showTaskDetails={showTaskDetails}
                            />
                            {/* Optional: Add back allowance balance display if needed */}
                            {/* {selectedMember !== 'All' && ( ... allowance display ... )} */}
                        </div>
                    </div>
                ) : (
                    <div className="flex-grow">Calendar View (Not implemented)</div>
                )}
            </div>

            {/* Task Series Editor Modal */}
            <Dialog open={!!editingTaskSeriesId} onOpenChange={(open) => !open && setEditingTaskSeriesId(null)}>
                <DialogContent className="w-[90vw] max-w-[1400px] h-[85vh] overflow-y-auto p-0">
                    {editingTaskSeriesId && (
                        <TaskSeriesEditor
                            db={db}
                            initialSeriesId={editingTaskSeriesId}
                            onClose={() => setEditingTaskSeriesId(null)}
                            className="w-full max-w-none" // <--- FIX: Force full width inside modal
                        />
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}

// Removed AddChoreForm (using DetailedChoreForm in Dialog)
// Removed CalendarView placeholder

export default ChoresTracker;
