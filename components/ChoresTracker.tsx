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
import AllChoresInventory from './AllChoresInventory';
import DetailedChoreForm from './DetailedChoreForm';
import DateCarousel from '@/components/ui/DateCarousel';
import { toUTCDate, calculateDailyXP } from '@/lib/chore-utils';
import { useToast } from '@/components/ui/use-toast';
import { getAssignedMembersForChoreOnDate } from '@/lib/chore-utils';
import type { ChorePauseState, ChoreSchedulePatch } from '@/lib/chore-schedule';
// **** NEW: Import types and utility ****
import { UnitDefinition, Envelope, computeAllApplicableCurrencyCodes } from '@/lib/currency-utils'; // Import computeMonetaryCurrencies
import TaskSeriesEditor from '@/components/task-series/TaskSeriesEditor';
import { buildHistoryEventTransactions } from '@/lib/history-events';

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
import {
    HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
    getFamilyDayDateUTC,
    getNextChoreSortOrder,
    localDateToUTC,
    parseSharedScheduleSettings,
    sortChoresForDisplay,
    computeCountdownTimelines,
    COUNTDOWN_SETTINGS_NAME,
    parseCountdownSettings,
    getChoreTimingMode,
    type SharedScheduleSettings,
    type SharedRoutineMarkerStatusLike,
    type CountdownEngineOutput,
    type CountdownChoreInput,
} from '@family-organizer/shared-core';

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
    createdAt?: string;
    startDate: string; // Keep as string to match DetailedChoreForm/utils expectations
    done: boolean; // Assuming this exists, though not used directly here
    rrule?: string;
    exdates?: string[] | null;
    pauseState?: ChorePauseState | null;
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
        notDone?: boolean;
    }[];
    estimatedDurationSecs?: number | null;
    isUpForGrabs?: boolean;
    isJoint?: boolean;
    rewardType?: 'fixed' | 'weight';
    rewardAmount?: number;
    rewardCurrency?: string;
    sortOrder?: number | null;
    timeBucket?: string | null;
    timingMode?: string | null;
    timingConfig?: any | null;
    taskSeries?: { id: string; name: string; startDate?: string; tasks?: any[] }[];
}

// +++ Add ChoreCompletion type if not implicitly handled by Schema +++
interface ChoreCompletion {
    id: string;
    completed: boolean;
    dateDue: string;
    notDone?: boolean;
    chore?: { id: string }; // Link to chore
    completedBy?: { id: string }; // Link to member
    // Add other fields from schema if needed
}

interface RoutineMarkerStatus extends SharedRoutineMarkerStatusLike {
    id: string;
    key: string;
}

// --- REMOVED: Local Schema definition and local db initialization ---
// The local schema was missing 'tasks' and 'taskSeries', causing the Save Failed error.
// We now use the imported `db` which uses the full `instant.schema.ts`.

interface ChoresTrackerProps {
    pageMode?: 'chores' | 'tasks';
    viewScope?: 'daily' | 'all';
    initialSelectedMember?: string | null;
    initialSelectedDate?: string | null;
    focusedChoreId?: string | null;
}

function ChoresTracker({
    pageMode = 'chores',
    viewScope = 'daily',
    initialSelectedMember = null,
    initialSelectedDate = null,
    focusedChoreId = null,
}: ChoresTrackerProps) {
    const [selectedMember, setSelectedMember] = useState<string>(viewScope === 'all' ? 'All' : initialSelectedMember || 'All');
    const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
    // --- Remove state for simple add form ---
    // const [newChoreTitle, setNewChoreTitle] = useState<string>('');
    // const [newChoreAssignee, setNewChoreAssignee] = useState<string>('');
    const [isDetailedChoreModalOpen, setIsDetailedChoreModalOpen] = useState(false);
    const [editingTaskSeriesId, setEditingTaskSeriesId] = useState<string | null>(null);
    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        if (initialSelectedDate) {
            const parsed = new Date(`${initialSelectedDate}T00:00:00Z`);
            if (!Number.isNaN(parsed.getTime())) {
                return parsed;
            }
        }
        return getFamilyDayDateUTC(new Date());
    });
    // +++ MOBILE STATE +++
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isMobileDateVisible, setIsMobileDateVisible] = useState(false);

    const { toast } = useToast();

    // +++ NEW: Get Auth +++
    const { currentUser } = useAuth();
    const { isParentMode } = useParentMode();

    React.useEffect(() => {
        if (viewScope === 'all') {
            setSelectedMember('All');
            return;
        }
        if (initialSelectedMember) {
            setSelectedMember(initialSelectedMember);
        }
    }, [initialSelectedMember, viewScope]);

    React.useEffect(() => {
        if (viewScope === 'all') {
            const now = new Date();
            setSelectedDate(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
            return;
        }
        if (!initialSelectedDate) return;
        const parsed = new Date(`${initialSelectedDate}T00:00:00Z`);
        if (!Number.isNaN(parsed.getTime())) {
            setSelectedDate(parsed);
        }
    }, [initialSelectedDate, viewScope]);

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
                    updates: {
                        attachments: {},
                        actor: {},
                        affectedPerson: {},
                        responseFieldValues: { field: {} },
                        gradeType: {},
                        replyTo: {},
                        replies: {
                            actor: {},
                            affectedPerson: {},
                            attachments: {},
                            gradeType: {},
                        },
                    },
                    // Note: notes is a direct field, so it comes automatically with the entity
                    responseFields: {},
                },
                familyMember: {},
            },
        },
        // Fetch grade types for grading panel
        gradeTypes: {
            $: { order: { createdAt: 'asc' } },
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
        routineMarkerStatuses: {},
        settings: {
            $: {
                where: {
                    or: [
                        { name: HOUSEHOLD_SCHEDULE_SETTINGS_NAME },
                        { name: COUNTDOWN_SETTINGS_NAME },
                    ],
                },
            },
        },
    });

    // --- Derived Data ---
    // Use 'as any' casting if strict schema typing conflicts with the generic interface,
    // but typically the global db schema inference should align if the interfaces match.
    const familyMembers: FamilyMember[] = useMemo(() => (data?.familyMembers as any) || [], [data?.familyMembers]);
    const chores: Chore[] = useMemo(() => (data?.chores as any) || [], [data?.chores]);
    const unitDefinitions: UnitDefinition[] = useMemo(() => (data?.unitDefinitions as any) || [], [data?.unitDefinitions]);
    const gradeTypes = useMemo(() => (data?.gradeTypes as any[]) || [], [data?.gradeTypes]);
    const allEnvelopes: Envelope[] = useMemo(() => (data?.allowanceEnvelopes as any) || [], [data?.allowanceEnvelopes]); // Get all envelopes from data
    // +++ Get top-level completions for the check +++
    const allChoreCompletions: ChoreCompletion[] = useMemo(() => (data?.choreCompletions as any) || [], [data?.choreCompletions]);
    const routineMarkerStatuses: RoutineMarkerStatus[] = useMemo(() => (data?.routineMarkerStatuses as any) || [], [data?.routineMarkerStatuses]);
    const scheduleSettings: SharedScheduleSettings = useMemo(
        () => {
            const row = (data?.settings as any[])?.find((s: any) => s.name === HOUSEHOLD_SCHEDULE_SETTINGS_NAME);
            return parseSharedScheduleSettings(row?.value || null);
        },
        [data?.settings]
    );
    const countdownSettings = useMemo(
        () => {
            const row = (data?.settings as any[])?.find((s: any) => s.name === COUNTDOWN_SETTINGS_NAME);
            return parseCountdownSettings(row?.value || null);
        },
        [data?.settings]
    );

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

    const selectedDateKey = selectedDate.toISOString().slice(0, 10);
    const todayDateKey = getFamilyDayDateUTC(new Date(), scheduleSettings).toISOString().slice(0, 10);

    // --- Countdown engine ---
    const countdownTimelines: CountdownEngineOutput | null = useMemo(() => {
        if (chores.length === 0) return null;
        try {
            const choreInputs: CountdownChoreInput[] = chores
                .filter((c) => {
                    // Only include chores that have timing and duration info
                    const mode = getChoreTimingMode(c as any);
                    return mode !== 'anytime';
                })
                .map((c) => {
                    const memberCompletions: Record<string, string> = {};
                    for (const comp of c.completions || []) {
                        if (comp.completed && comp.dateDue === selectedDateKey && comp.completedBy?.id) {
                            memberCompletions[comp.completedBy.id] = comp.dateCompleted || new Date().toISOString();
                        }
                    }
                    return {
                        id: c.id,
                        title: c.title,
                        estimatedDurationSecs: c.estimatedDurationSecs ?? null,
                        weight: c.weight ?? null,
                        sortOrder: c.sortOrder ?? null,
                        isJoint: c.isJoint ?? false,
                        assigneeIds: (() => {
                            // assignments (ordered rotation records) have familyMember nested
                            const fromAssignments = (c.assignments || []).map((a: any) => a.familyMember?.id).filter(Boolean);
                            if (fromAssignments.length > 0) return fromAssignments;
                            // Fall back to direct assignees link
                            return (c.assignees || []).map((a: any) => a.id).filter(Boolean);
                        })(),
                        timingMode: c.timingMode || 'anytime',
                        timingConfig: c.timingConfig || null,
                        timeBucket: c.timeBucket || null,
                        completedAt: null,
                        memberCompletions,
                    };
                });

            if (choreInputs.length === 0) return null;

            return computeCountdownTimelines({
                chores: choreInputs,
                routineMarkerStatuses,
                allChoresRaw: chores as any,
                countdownSettings,
                scheduleSettings,
                now: new Date(),
                date: selectedDate,
            });
        } catch (err) {
            console.error('Countdown engine error:', err);
            return null;
        }
    }, [chores, selectedDateKey, selectedDate, routineMarkerStatuses, countdownSettings, scheduleSettings]);

    const markRoutineMarkerHappened = async (markerKey: string) => {
        if (!isParentMode) {
            toast({
                title: 'Access Denied',
                description: 'Only parents can update routine markers.',
                variant: 'destructive',
            });
            return;
        }

        const recordKey = `${selectedDateKey}:${markerKey}`;
        const existing = routineMarkerStatuses.find((status) => String(status.key || '') === recordKey);
        const timestamp = new Date().toISOString();

        try {
            if (existing?.id) {
                await db.transact([
                    tx.routineMarkerStatuses[existing.id].update({
                        startedAt: timestamp,
                        completedAt: timestamp,
                        startedById: currentUser?.id || null,
                        completedById: currentUser?.id || null,
                    }),
                ]);
            } else {
                const statusId = id();
                await db.transact([
                    tx.routineMarkerStatuses[statusId].update({
                        key: recordKey,
                        markerKey,
                        date: selectedDateKey,
                        startedAt: timestamp,
                        completedAt: timestamp,
                        startedById: currentUser?.id || null,
                        completedById: currentUser?.id || null,
                    }),
                ]);
            }

            toast({
                title: 'Marker updated',
                description: `${markerKey[0]?.toUpperCase() || ''}${markerKey.slice(1)} was marked.`,
            });
        } catch (error: any) {
            console.error('Error updating routine marker status:', error);
            toast({
                title: 'Error',
                description: error?.message || 'Failed to update routine marker status.',
                variant: 'destructive',
            });
        }
    };

    const markRoutineMarkerStarted = async (markerKey: string) => {
        if (!isParentMode) {
            toast({ title: 'Access Denied', description: 'Only parents can update routine markers.', variant: 'destructive' });
            return;
        }

        const recordKey = `${selectedDateKey}:${markerKey}`;
        const existing = routineMarkerStatuses.find((status) => String(status.key || '') === recordKey);
        const timestamp = new Date().toISOString();

        try {
            if (existing?.id) {
                await db.transact([
                    tx.routineMarkerStatuses[existing.id].update({
                        startedAt: timestamp,
                        startedById: currentUser?.id || null,
                    }),
                ]);
            } else {
                const statusId = id();
                await db.transact([
                    tx.routineMarkerStatuses[statusId].update({
                        key: recordKey,
                        markerKey,
                        date: selectedDateKey,
                        startedAt: timestamp,
                        startedById: currentUser?.id || null,
                    }),
                ]);
            }

            toast({
                title: 'Marker started',
                description: `${markerKey[0]?.toUpperCase() || ''}${markerKey.slice(1)} was marked as started.`,
            });
        } catch (error: any) {
            console.error('Error updating routine marker status:', error);
            toast({ title: 'Error', description: error?.message || 'Failed to update routine marker status.', variant: 'destructive' });
        }
    };

    const markRoutineMarkerFinished = async (markerKey: string) => {
        if (!isParentMode) {
            toast({ title: 'Access Denied', description: 'Only parents can update routine markers.', variant: 'destructive' });
            return;
        }

        const recordKey = `${selectedDateKey}:${markerKey}`;
        const existing = routineMarkerStatuses.find((status) => String(status.key || '') === recordKey);
        const timestamp = new Date().toISOString();

        try {
            if (existing?.id) {
                await db.transact([
                    tx.routineMarkerStatuses[existing.id].update({
                        completedAt: timestamp,
                        completedById: currentUser?.id || null,
                    }),
                ]);
            } else {
                const statusId = id();
                await db.transact([
                    tx.routineMarkerStatuses[statusId].update({
                        key: recordKey,
                        markerKey,
                        date: selectedDateKey,
                        completedAt: timestamp,
                        completedById: currentUser?.id || null,
                    }),
                ]);
            }

            toast({
                title: 'Marker finished',
                description: `${markerKey[0]?.toUpperCase() || ''}${markerKey.slice(1)} was marked as finished.`,
            });
        } catch (error: any) {
            console.error('Error updating routine marker status:', error);
            toast({ title: 'Error', description: error?.message || 'Failed to update routine marker status.', variant: 'destructive' });
        }
    };

    const clearRoutineMarkerStatus = async (markerKey: string) => {
        if (!isParentMode) return;

        const recordKey = `${selectedDateKey}:${markerKey}`;
        const existing = routineMarkerStatuses.find((status) => String(status.key || '') === recordKey);
        if (!existing?.id) return;

        try {
            await db.transact([
                tx.routineMarkerStatuses[existing.id].update({
                    startedAt: null,
                    completedAt: null,
                    startedById: null,
                    completedById: null,
                }),
            ]);

            toast({
                title: 'Marker cleared',
                description: `${markerKey[0]?.toUpperCase() || ''}${markerKey.slice(1)} was reset for ${selectedDateKey}.`,
            });
        } catch (error: any) {
            console.error('Error clearing routine marker status:', error);
            toast({
                title: 'Error',
                description: error?.message || 'Failed to clear routine marker status.',
                variant: 'destructive',
            });
        }
    };

    const addChore = (choreData: Partial<Chore>) => {
        const choreId = id();
        const nowIso = new Date().toISOString();
        const transactions: any[] = [
            tx.chores[choreId].update({
                title: choreData.title!,
                createdAt: nowIso,
                description: choreData.description || '',
                startDate: new Date(choreData.startDate || Date.now()).toISOString(),
                // gemini wants the below instead of the above. It looks like it doesn't make a choreData.startDate into an ISOString. Not sure about this one.
                // startDate: choreData.startDate || new Date().toISOString(), // Ensure ISO string

                done: false,
                rrule: choreData.rrule || null,
                exdates: choreData.exdates ?? [],
                pauseState: choreData.pauseState ?? null,
                rotationType: choreData.rotationType || 'none',
                sortOrder: choreData.sortOrder ?? getNextChoreSortOrder(chores as any),
                weight: choreData.weight ?? null, // Save weight, null if undefined
                estimatedDurationSecs: choreData.estimatedDurationSecs ?? null,
                isUpForGrabs: choreData.isUpForGrabs ?? false,
                isJoint: choreData.isJoint ?? false,
                rewardType: choreData.rewardType ?? null,
                rewardAmount: choreData.rewardAmount ?? null,
                rewardCurrency: choreData.rewardCurrency ?? null,
                timeBucket: choreData.timeBucket ?? null,
                timingMode: choreData.timingMode ?? null,
                timingConfig: choreData.timingConfig ?? null,
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
                const nowIso = new Date().toISOString();
                const historyEvent = buildHistoryEventTransactions({
                    tx,
                    createId: id,
                    occurredAt: nowIso,
                    domain: 'chores',
                    actionType: existingCompletion.completed ? 'chore_marked_undone' : 'chore_marked_done',
                    summary: `${existingCompletion.completed ? 'Marked' : 'Completed'} "${chore.title}" ${existingCompletion.completed ? 'not done' : 'done'}`,
                    source: 'manual',
                    actorFamilyMemberId: executorId || familyMemberId,
                    affectedFamilyMemberIds: [familyMemberId],
                    choreId,
                    scheduledForDate: formattedDate,
                    metadata: {
                        choreTitle: chore.title,
                        completed: !existingCompletion.completed,
                        dateDue: formattedDate,
                    },
                });
                db.transact([
                    tx.choreCompletions[existingCompletion.id].update({
                        completed: !existingCompletion.completed,
                        notDone: false, // Clear notDone when toggling done status
                        dateCompleted: !existingCompletion.completed
                            ? nowIso // Use ISO string
                            : null,
                    }),
                    ...historyEvent.transactions,
                ]);
                toast({
                    title: 'Chore Updated',
                    description: `Marked as ${!existingCompletion.completed ? 'done' : 'not done'}.`,
                });
            } else {
                // Create new completion
                const newCompletionId = id();
                const nowIso = new Date().toISOString();
                const transactions: any[] = [
                    tx.choreCompletions[newCompletionId].update({
                        dateDue: formattedDate,
                        dateCompleted: nowIso, // Set completion time
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

                const historyEvent = buildHistoryEventTransactions({
                    tx,
                    createId: id,
                    occurredAt: nowIso,
                    domain: 'chores',
                    actionType: 'chore_marked_done',
                    summary: `Completed "${chore.title}"`,
                    source: 'manual',
                    actorFamilyMemberId: executorId || familyMemberId,
                    affectedFamilyMemberIds: [familyMemberId],
                    choreId,
                    scheduledForDate: formattedDate,
                    metadata: {
                        choreTitle: chore.title,
                        completed: true,
                        dateDue: formattedDate,
                    },
                });
                transactions.push(...historyEvent.transactions);

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

    // Toggle "not done" status on a chore completion for a given family member
    const toggleChoreNotDone = async (choreId: string, familyMemberId: string, executorId?: string) => {
        const chore = chores.find((c) => c.id === choreId);
        const formattedDate = selectedDate.toISOString().slice(0, 10);

        if (!chore) {
            console.error('Chore not found:', choreId);
            toast({ title: 'Error', description: 'Could not find the chore.', variant: 'destructive' });
            return;
        }

        const currentCompletions = chore.completions || [];
        const existingCompletion = currentCompletions.find(
            (completion) => completion.completedBy?.id === familyMemberId && completion.dateDue === formattedDate
        );

        try {
            if (existingCompletion) {
                // Toggle: if already notDone, revert to pending; if pending/done, mark notDone
                const isCurrentlyNotDone = existingCompletion.notDone === true;
                const nowIso = new Date().toISOString();
                const historyEvent = buildHistoryEventTransactions({
                    tx,
                    createId: id,
                    occurredAt: nowIso,
                    domain: 'chores',
                    actionType: isCurrentlyNotDone ? 'chore_marked_undone' : 'chore_marked_not_done',
                    summary: isCurrentlyNotDone
                        ? `Reverted "${chore.title}" to pending`
                        : `Marked "${chore.title}" as not done`,
                    source: 'manual',
                    actorFamilyMemberId: executorId || familyMemberId,
                    affectedFamilyMemberIds: [familyMemberId],
                    choreId,
                    scheduledForDate: formattedDate,
                    metadata: {
                        choreTitle: chore.title,
                        notDone: !isCurrentlyNotDone,
                        dateDue: formattedDate,
                    },
                });
                db.transact([
                    tx.choreCompletions[existingCompletion.id].update({
                        completed: false,
                        notDone: isCurrentlyNotDone ? false : true,
                        dateCompleted: null,
                    }),
                    ...historyEvent.transactions,
                ]);
                toast({
                    title: isCurrentlyNotDone ? 'Reverted to Pending' : 'Marked Not Done',
                    description: isCurrentlyNotDone
                        ? `${chore.title} is back to pending.`
                        : `${chore.title} marked as not done.`,
                });
            } else {
                // Create new completion record with notDone = true
                const newCompletionId = id();
                const nowIso = new Date().toISOString();
                const transactions: any[] = [
                    tx.choreCompletions[newCompletionId].update({
                        dateDue: formattedDate,
                        dateCompleted: null,
                        completed: false,
                        notDone: true,
                        allowanceAwarded: false,
                    }),
                    tx.chores[choreId].link({ completions: newCompletionId }),
                    tx.familyMembers[familyMemberId].link({ completedChores: newCompletionId }),
                ];

                if (executorId) {
                    transactions.push(tx.familyMembers[executorId].link({ markedCompletions: newCompletionId }));
                }

                const historyEvent = buildHistoryEventTransactions({
                    tx,
                    createId: id,
                    occurredAt: nowIso,
                    domain: 'chores',
                    actionType: 'chore_marked_not_done',
                    summary: `Marked "${chore.title}" as not done`,
                    source: 'manual',
                    actorFamilyMemberId: executorId || familyMemberId,
                    affectedFamilyMemberIds: [familyMemberId],
                    choreId,
                    scheduledForDate: formattedDate,
                    metadata: {
                        choreTitle: chore.title,
                        notDone: true,
                        dateDue: formattedDate,
                    },
                });
                transactions.push(...historyEvent.transactions);

                db.transact(transactions);
                toast({ title: 'Marked Not Done', description: `${chore.title} marked as not done.` });
            }
        } catch (err: any) {
            console.error('Error toggling not-done status:', err);
            toast({ title: 'Error', description: `Failed to update chore status: ${err.message}`, variant: 'destructive' });
        }
    };

    const updateChore = async (choreId: any, updatedChoreData: any) => {
        try {
            const transactions = [];
            const existingChore = chores.find((c) => c.id === choreId); // Use memoized data
            if (!existingChore) throw new Error('Original chore data not found for update.');

            // 1. Update basic chore info
            transactions.push(
                tx.chores[choreId].update({
                    title: updatedChoreData.title,
                    description: updatedChoreData.description,
                    startDate: updatedChoreData.startDate,
                    rrule: updatedChoreData.rrule,
                    exdates: updatedChoreData.exdates ?? [],
                    pauseState: updatedChoreData.pauseState ?? null,
                    rotationType: updatedChoreData.rotationType,
                    sortOrder: updatedChoreData.sortOrder ?? existingChore.sortOrder ?? null,
                    weight: updatedChoreData.weight ?? null,
                    estimatedDurationSecs: updatedChoreData.estimatedDurationSecs ?? null,
                    isUpForGrabs: updatedChoreData.isUpForGrabs ?? false,
                    isJoint: updatedChoreData.isJoint ?? false,
                    rewardType: updatedChoreData.rewardType ?? null,
                    rewardAmount: updatedChoreData.rewardAmount ?? null,
                    rewardCurrency: updatedChoreData.rewardCurrency ?? null,
                    timeBucket: updatedChoreData.timeBucket ?? null,
                    timingMode: updatedChoreData.timingMode ?? null,
                    timingConfig: updatedChoreData.timingConfig ?? null,
                })
            );

            // 2. Handle Assignees & Assignments (more robustly)
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

    const updateChoreSchedule = async (choreId: string, schedulePatch: ChoreSchedulePatch) => {
        try {
            await db.transact([
                tx.chores[choreId].update({
                    rrule: schedulePatch.rrule ?? null,
                    exdates: schedulePatch.exdates ?? [],
                    pauseState: schedulePatch.pauseState ?? null,
                }),
            ]);

            toast({
                title: 'Schedule updated',
                description: 'The chore schedule was updated successfully.',
            });
        } catch (error: any) {
            console.error('Error updating chore schedule:', error);
            toast({
                title: 'Error Updating Schedule',
                description: error.message || 'Failed to update the chore schedule. Please try again.',
                variant: 'destructive',
            });
            throw error;
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

    const filteredChores = useMemo(() => {
        const visible = chores.filter((chore) => {
            // Ensure chore is valid before processing
            if (!chore || !chore.id || !chore.startDate) {
                console.warn('Skipping invalid chore object:', chore);
                return false;
            }
            if (pageMode === 'tasks' && (!chore.taskSeries || chore.taskSeries.length === 0)) {
                return false;
            }

            // In tasks mode, also include chores with active pull-forwards for the selected member
            if (pageMode === 'tasks' && chore.taskSeries) {
                const hasActivePullForward = chore.taskSeries.some((series: any) => {
                    if (!series || (series.pullForwardCount || 0) <= 0) return false;
                    const ownerId = Array.isArray(series.familyMember)
                        ? series.familyMember[0]?.id
                        : series.familyMember?.id;
                    return selectedMember === 'All' || ownerId === selectedMember;
                });
                if (hasActivePullForward) return true;
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

        return sortChoresForDisplay(visible as any, {
            date: selectedDate,
            routineMarkerStatuses,
            chores: chores as any,
            scheduleSettings,
        }).map((entry) => entry.chore as Chore);
    }, [chores, pageMode, routineMarkerStatuses, scheduleSettings, selectedDate, selectedMember]);

    // +++ Logic for Add Button +++
    const isParent = isParentMode;
    const canAddChore = isParent;
    const pageTitle = pageMode === 'tasks' ? 'Tasks' : 'Chores';
    const selectedMemberName = familyMembers.find((m) => m.id === selectedMember)?.name;
    const selectedDateLabel = selectedDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const pageHeading =
        viewScope === 'all' && pageMode === 'chores'
            ? 'All Chores'
            : pageMode === 'chores'
              ? `Chores for ${selectedDateLabel}`
              : selectedMember === 'All'
                ? `All ${pageTitle}`
                : `${selectedMemberName || 'Selected Member'}'s ${pageTitle}`;
    const pageSubheading =
        viewScope === 'all' && pageMode === 'chores'
            ? `All family members as of ${selectedDateLabel}`
            : pageMode === 'chores'
              ? selectedMember === 'All'
                  ? 'All family members'
                  : selectedMemberName || 'Selected member'
              : null;
    const tasksHistoryHref = (() => {
        const params = new URLSearchParams();
        params.set('domain', 'tasks');
        if (selectedMember !== 'All') {
            params.set('member', selectedMember);
        }
        return `/history?${params.toString()}`;
    })();

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

    if (isLoading) return <div>Loading...</div>;
    if (error) return <div>Error: {error.message}</div>;

    return (
        <div className="mx-auto flex h-full min-h-0 w-full max-w-[1600px] flex-col md:flex-row md:px-4">
            {/* Left Sidebar (Desktop Only) */}
            {viewScope === 'daily' ? (
                <div className="hidden md:flex md:w-[clamp(260px,24vw,360px)] md:flex-shrink-0 md:py-4">
                    <div className="w-full h-full min-h-0 rounded-lg border bg-card p-4 shadow-sm">
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
                </div>
            ) : null}

            {/* Mobile Menu Modal (New Layout) */}
            <Dialog open={viewScope === 'daily' && isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                <DialogContent
                    className={cn(
                        'fixed z-50 flex flex-col gap-4 bg-background shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
                        'w-screen h-[100dvh] max-w-none m-0 rounded-none border-0 top-0 left-0 translate-x-0 translate-y-0',
                        'pt-12 pb-6 px-4'
                    )}
                >
                    {/* Header Removed (Menu title) */}

                    {/* 1. Top Buttons Grid */}
                    <div className="grid grid-cols-4 gap-3 mb-2 shrink-0">
                        {/* Chores Button */}
                        <Link href="/chores" onClick={() => setIsMobileMenuOpen(false)}>
                            <Button variant="outline" className="w-full flex flex-col h-auto py-3 gap-1 hover:bg-accent/50">
                                <CheckSquare className="h-6 w-6 text-primary" />
                                <span className="text-xs font-medium">Chores</span>
                            </Button>
                        </Link>

                        {/* Tasks Button */}
                        <Link href="/tasks" onClick={() => setIsMobileMenuOpen(false)}>
                            <Button variant="outline" className="w-full flex flex-col h-auto py-3 gap-1 hover:bg-accent/50">
                                <ListTodo className="h-6 w-6 text-blue-600" />
                                <span className="text-xs font-medium">Tasks</span>
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

                    {viewScope === 'daily' ? (
                        <div className="flex-grow flex flex-col min-h-0 bg-gray-50/50 rounded-xl border p-2 overflow-hidden">
                            <div className="flex-grow overflow-y-auto">
                                <FamilyMembersList
                                    familyMembers={familyMembers}
                                    selectedMember={selectedMember}
                                    setSelectedMember={(id) => {
                                        setSelectedMember(id);
                                        setIsMobileMenuOpen(false);
                                    }}
                                    db={db}
                                    showBalances={true}
                                    membersBalances={membersBalances}
                                    unitDefinitions={unitDefinitions}
                                />
                            </div>
                        </div>
                    ) : null}
                </DialogContent>
            </Dialog>

            {/* Right content area */}
            <div className="w-full md:flex-1 p-4 md:py-4 flex flex-col h-full min-h-0 space-y-4">
                {/* +++ UPDATED LAYOUT: Top Bar Container +++ */}
                <div className="flex items-center justify-between gap-2 md:gap-4 flex-shrink-0">
                    {/* 1. Header Title & Add Chore Button Column */}
                    <div className="flex items-center gap-3">
                        {/* Mobile Menu Button */}
                        {viewScope === 'daily' ? (
                            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setIsMobileMenuOpen(true)}>
                                <Menu className="h-5 w-5" />
                            </Button>
                        ) : null}

                        <div className="flex flex-col gap-2">
                            <h2 className="text-lg md:text-xl font-bold whitespace-nowrap">{pageHeading}</h2>
                            {pageSubheading ? <p className="text-sm text-muted-foreground">{pageSubheading}</p> : null}

                            <div className="flex flex-wrap items-center gap-2">
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
                                            availableChoreAnchors={chores as any}
                                            scheduleSettings={scheduleSettings}
                                        />
                                    </DialogContent>
                                </Dialog>

                                {pageMode === 'chores' && viewScope === 'daily' ? (
                                    <Link href="/chores/all">
                                        <Button variant="outline" size="sm">
                                            View all chores
                                        </Button>
                                    </Link>
                                ) : null}

                                {pageMode === 'chores' && viewScope === 'all' ? (
                                    <Link href="/chores">
                                        <Button variant="outline" size="sm">
                                            Back to day view
                                        </Button>
                                    </Link>
                                ) : null}

                                {pageMode === 'tasks' ? (
                                    <Link href={`/my-tasks${selectedMember !== 'All' ? `?member=${selectedMember}` : ''}`}>
                                        <Button variant="outline" size="sm">
                                            <ListTodo className="mr-2 h-4 w-4" /> My Task Series
                                        </Button>
                                    </Link>
                                ) : null}

                                {pageMode === 'tasks' && isParent ? (
                                    <>
                                        <Link href="/task-series">
                                            <Button variant="outline" size="sm">
                                                <ListTodo className="mr-2 h-4 w-4" /> Manage Series
                                            </Button>
                                        </Link>
                                        <Link href={tasksHistoryHref}>
                                            <Button variant="outline" size="sm">
                                                <ListTodo className="mr-2 h-4 w-4" /> View History
                                            </Button>
                                        </Link>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    </div>

                    {/* 2. DateCarousel (Centered and Flexible) */}
                    {/* Desktop: Visible / Mobile: Controlled by toggle */}
                    {viewScope === 'daily' ? (
                        <div
                            className={`
                        absolute md:static top-[120px] left-0 right-0 z-20 bg-background md:bg-transparent shadow-md md:shadow-none p-2 md:p-0
                        ${isMobileDateVisible ? 'flex' : 'hidden'} md:flex
                        flex-grow justify-center min-w-0
                    `}
                        >
                            <DateCarousel onDateSelect={handleDateSelect} initialDate={selectedDate} />
                        </div>
                    ) : (
                        <div className="hidden md:block flex-grow" />
                    )}

                    {/* 3. Settings & Mobile Calendar Toggle (Right side) */}
                    <div className="flex-shrink-0 flex items-center gap-2">
                        {/* Mobile Date Toggle */}
                        {viewScope === 'daily' ? (
                            <>
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
                                                        disabled={!loggedInMember}
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
                            </>
                        ) : null}
                    </div>
                </div>
                {/* Chores List Area */}
                {viewScope === 'all' && pageMode === 'chores' ? (
                    <AllChoresInventory
                        chores={chores as any}
                        familyMembers={familyMembers as any}
                        referenceDate={selectedDate}
                        updateChore={updateChore}
                        updateChoreSchedule={updateChoreSchedule}
                        db={db}
                        unitDefinitions={unitDefinitions}
                        currencyOptions={currencyOptions}
                        canEditChores={isParent}
                        allChores={chores as any}
                        scheduleSettings={scheduleSettings}
                    />
                ) : viewMode === 'list' ? (
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
                                toggleChoreNotDone={toggleChoreNotDone}
                                updateChore={updateChore}
                                updateChoreSchedule={updateChoreSchedule}
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
                                pageMode={pageMode}
                                focusedChoreId={focusedChoreId}
                                gradeTypes={gradeTypes}
                                routineMarkerStatuses={routineMarkerStatuses}
                                selectedDateKey={selectedDateKey}
                                todayDateKey={todayDateKey}
                                onRoutineMarkerStart={(markerKey: string) => markRoutineMarkerStarted(markerKey)}
                                onRoutineMarkerComplete={(markerKey: string) => markRoutineMarkerFinished(markerKey)}
                                onRoutineMarkerClear={clearRoutineMarkerStatus}
                                allChores={chores}
                                scheduleSettings={scheduleSettings}
                                countdownTimelines={countdownTimelines}
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
