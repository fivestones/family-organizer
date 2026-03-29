import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea'; // Added back as it's used
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
// --- Remove unused Lucide icons if Check/ChevronsUpDown aren't needed elsewhere ---
// Check and ChevronsUpDown are used by CurrencySelector internally, so keep them if DetailedChoreForm still needs ChevronUp/Down for other things
import { ChevronUp, ChevronDown } from 'lucide-react'; // Keeping these as they are used for rotation order
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
// --- Removed Popover/Command imports as they are handled by CurrencySelector ---
// import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
// import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
// --- Removed DefineUnitForm import as it's handled by CurrencySelector ---
// import DefineUnitForm from '@/components/allowance/DefineUnitForm';
// --- Removed init import as db is passed as prop ---
// import { init } from '@instantdb/react';
// +++ Import CurrencySelector +++
import CurrencySelector from '@/components/CurrencySelector';
import ChoreRecurrenceFields from './ChoreRecurrenceFields';
import ChoreScheduleActions from './ChoreScheduleActions';
import ChoreAssignmentPreviewSection from './ChoreAssignmentPreviewSection';
import { toUTCDate } from '@/lib/chore-utils';
import type { ChorePauseState, ChoreSchedulePatch } from '@/lib/chore-schedule';
import { getChorePauseStatus } from '@/lib/chore-schedule';
import { getDefaultRecurrenceUiState, normalizeRrule, parseRecurrenceUiStateFromRrule, serializeRecurrenceToRrule, type RecurrenceUiState } from '@/lib/recurrence';
import {
    getRoutineMarkerOptions,
    getTimeBucketOptions,
    wouldCreateChoreTimingCycle,
    type SharedScheduleSettings,
} from '@family-organizer/shared-core';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { HelpCircle } from 'lucide-react';
// here gemini wants to initialize the db for fetching units, but I'm not sure if we should do this. Should we instead be fetching the units elsewhere and sending them to DetailedChoreForm as a prop? I'm not sure.
// Interface for the data structure passed to onSave
// Ensure it includes the new 'weight' field
interface ChoreSaveData {
    title: string;
    assignees: { id: string }[];
    description?: string;
    startDate: string; // ISO String
    rrule: string | null;
    exdates?: string[] | null;
    pauseState?: ChorePauseState | null;
    rotationType: 'none' | 'daily' | 'weekly' | 'monthly';
    assignments: { order: number; familyMember: any }[] | null; // Adjust 'any' if FamilyMember type is available here
    weight?: number | null;
    estimatedDurationSecs?: number | null;
    isUpForGrabs?: boolean | null;
    isJoint?: boolean | null;
    rewardType?: 'fixed' | 'weight' | null;
    rewardAmount?: number | null;
    rewardCurrency?: string | null;
    sortOrder?: number | null;
    timeBucket?: string | null;
    timingMode?: string | null;
    timingConfig?: any | null;
}

// +++ Define props interface +++
interface DetailedChoreFormProps {
    familyMembers: any[];
    onSave: (data: Partial<ChoreSaveData>) => void;
    onScheduleAction?: (patch: ChoreSchedulePatch) => Promise<void> | void;
    initialChore?: any | null;
    initialDate: Date;
    db: any; // InstantDB instance passed down
    unitDefinitions: any[]; // Pass definitions
    currencyOptions: { value: string; label: string }[]; // Pass computed options
    availableChoreAnchors?: any[];
    scheduleSettings?: SharedScheduleSettings | null;
}

function TimingHelpPopover({ title, lines }: { title: string; lines: string[] }) {
    return (
        <Popover>
            <TooltipProvider delayDuration={150}>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                                aria-label={`Explain ${title}`}
                            >
                                <HelpCircle className="h-4 w-4" />
                            </button>
                        </PopoverTrigger>
                    </TooltipTrigger>
                    <TooltipContent>{title}</TooltipContent>
                </Tooltip>
            </TooltipProvider>
            <PopoverContent align="start" className="w-80 space-y-2">
                <div className="font-medium text-slate-900">{title}</div>
                <div className="space-y-2 text-sm text-slate-600">
                    {lines.map((line, index) => (
                        <p key={index}>{line}</p>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function DetailedChoreForm({
    // New signature using props interface
    familyMembers,
    onSave,
    onScheduleAction,
    initialChore = null,
    initialDate,
    db,
    unitDefinitions,
    currencyOptions,
    availableChoreAnchors = [],
    scheduleSettings = null,
}: DetailedChoreFormProps) {
    const [title, setTitle] = useState('');
    const [assignees, setAssignees] = useState<string[]>([]);
    const [description, setDescription] = useState('');
    const [startDate, setStartDate] = useState<Date>(toUTCDate(initialDate || new Date()));
    const [rotationType, setRotationType] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
    const [rotationOrder, setRotationOrder] = useState<string[]>([]);
    const [useRotation, setUseRotation] = useState(false);
    const [weight, setWeight] = useState<string>('0'); // Default to '0'
    const [durationHours, setDurationHours] = useState<string>('');
    const [durationMinutes, setDurationMinutes] = useState<string>('');
    const [durationSeconds, setDurationSeconds] = useState<string>('');
    const [isUpForGrabs, setIsUpForGrabs] = useState(false);
    const [isJoint, setIsJoint] = useState(false);
    const [rewardType, setRewardType] = useState<'fixed' | 'weight'>('weight'); // Default to weight-based
    const [rewardAmount, setRewardAmount] = useState<string>('');
    const [rewardCurrency, setRewardCurrency] = useState<string>('');
    const [timeBucket, setTimeBucket] = useState<string>('');
    const [timingMode, setTimingMode] = useState<
        'anytime' | 'named_window' | 'before_time' | 'after_time' | 'between_times' | 'before_marker' | 'after_marker' | 'before_chore' | 'after_chore'
    >('anytime');
    const [triggerTime, setTriggerTime] = useState<string>('');
    const [windowStartTime, setWindowStartTime] = useState<string>('');
    const [windowEndTime, setWindowEndTime] = useState<string>('');
    const [anchorRoutineKey, setAnchorRoutineKey] = useState<string>('breakfast');
    const [anchorChoreId, setAnchorChoreId] = useState<string>('');
    const [anchorFallbackTime, setAnchorFallbackTime] = useState<string>('');
    const [recurrenceUi, setRecurrenceUi] = useState<RecurrenceUiState>(() => ({
        ...getDefaultRecurrenceUiState(
            initialDate instanceof Date && !Number.isNaN(initialDate.getTime()) ? initialDate.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)
        ),
        mode: 'daily',
    }));
    const timeBucketOptions = React.useMemo(() => getTimeBucketOptions(scheduleSettings), [scheduleSettings]);
    const routineMarkerOptions = React.useMemo(() => getRoutineMarkerOptions(scheduleSettings), [scheduleSettings]);
    const availableAnchorChores = availableChoreAnchors
        .filter((chore) => chore?.id && chore.id !== initialChore?.id)
        .sort((left, right) => String(left?.title || '').localeCompare(String(right?.title || ''), undefined, { sensitivity: 'base' }));

    useEffect(() => {
        if (initialChore) {
            const timingConfig = initialChore.timingConfig && typeof initialChore.timingConfig === 'object' ? initialChore.timingConfig : {};
            const anchorConfig = timingConfig?.anchor && typeof timingConfig.anchor === 'object' ? timingConfig.anchor : {};
            const rawTimingMode = initialChore.timingMode || timingConfig.mode || (initialChore.timeBucket || timingConfig.timeBucket ? 'day_part' : 'anytime');
            const initialTimingMode =
                rawTimingMode === 'day_part'
                    ? 'named_window'
                    : rawTimingMode === 'clock_window'
                    ? 'between_times'
                    : rawTimingMode === 'routine_anchor'
                    ? anchorConfig?.relation === 'after'
                        ? 'after_marker'
                        : 'before_marker'
                    : rawTimingMode === 'chore_anchor'
                    ? anchorConfig?.relation === 'after'
                        ? 'after_chore'
                        : 'before_chore'
                    : rawTimingMode;

            setTitle(initialChore.title);
            setDescription(initialChore.description || '');
            setStartDate(toUTCDate(new Date(initialChore.startDate)));
            setWeight(initialChore.weight !== null && initialChore.weight !== undefined ? String(initialChore.weight) : '');
            if (initialChore.estimatedDurationSecs != null && initialChore.estimatedDurationSecs > 0) {
                const totalSecs = initialChore.estimatedDurationSecs;
                const h = Math.floor(totalSecs / 3600);
                const m = Math.floor((totalSecs % 3600) / 60);
                const s = totalSecs % 60;
                setDurationHours(h > 0 ? String(h) : '');
                setDurationMinutes(m > 0 ? String(m) : '');
                setDurationSeconds(s > 0 ? String(s) : '');
            } else {
                setDurationHours('');
                setDurationMinutes('');
                setDurationSeconds('');
            }
            setIsUpForGrabs(initialChore.isUpForGrabs ?? false);
            setIsJoint(initialChore.isJoint ?? false);
            setRewardType(initialChore.rewardType === 'fixed' ? 'fixed' : 'weight');
            setRewardAmount(initialChore.rewardAmount !== null && initialChore.rewardAmount !== undefined ? String(initialChore.rewardAmount) : '');
            setRewardCurrency(initialChore.rewardCurrency || '');
            setTimeBucket(timingConfig?.namedWindowKey || initialChore.timeBucket || timingConfig.timeBucket || timeBucketOptions[0]?.value || '');
            setTimingMode(initialTimingMode as any);
            setTriggerTime(timingConfig?.time || '');
            setWindowStartTime(timingConfig?.window?.startTime || '');
            setWindowEndTime(timingConfig?.window?.endTime || '');
            setAnchorRoutineKey(anchorConfig?.routineKey || 'breakfast');
            setAnchorChoreId(anchorConfig?.sourceChoreId || '');
            setAnchorFallbackTime(anchorConfig?.fallbackTime || anchorConfig?.fallbackStartTime || anchorConfig?.fallbackEndTime || '');
            const startDateValue = toUTCDate(new Date(initialChore.startDate)).toISOString().slice(0, 10);
            setRecurrenceUi(
                initialChore.rrule
                    ? parseRecurrenceUiStateFromRrule(initialChore.rrule, startDateValue)
                    : { ...getDefaultRecurrenceUiState(startDateValue), mode: 'never' }
            );

            const isRotatingChore = initialChore.rotationType !== 'none';
            setUseRotation(isRotatingChore);
            setRotationType(initialChore.rotationType);

            if (isRotatingChore && initialChore.assignments) {
                const sortedAssignments = [...initialChore.assignments].sort((a: any, b: any) => {
                    const orderA = a.order ?? 0;
                    const orderB = b.order ?? 0;
                    return orderA - orderB;
                });

                const rotationIds = sortedAssignments
                    .map((assignment: any) => {
                        const fm = Array.isArray(assignment.familyMember) ? assignment.familyMember[0] : assignment.familyMember;
                        return fm?.id;
                    })
                    .filter((id: any) => !!id);

                setRotationOrder(rotationIds);
                const assigneeIds = initialChore.assignees.map((a: any) => a.id);
                setAssignees(assigneeIds);
            } else if (!isRotatingChore && initialChore.assignees) {
                const assigneeIds = initialChore.assignees.map((a: any) => a.id);
                setAssignees(assigneeIds);
                setRotationOrder([]);
            } else {
                setAssignees([]);
                setRotationOrder([]);
            }
        } else {
            setTitle('');
            setDescription('');
            setStartDate(toUTCDate(initialDate || new Date()));
            setRecurrenceUi({
                ...getDefaultRecurrenceUiState(toUTCDate(initialDate || new Date()).toISOString().slice(0, 10)),
                mode: 'daily',
            });
            setWeight('0');
            setDurationHours('');
            setDurationMinutes('');
            setDurationSeconds('');
            setIsUpForGrabs(false);
            setIsJoint(false);
            setRewardType('weight');
            setRewardAmount('');
            setRewardCurrency('');
            setTimeBucket(timeBucketOptions[0]?.value || '');
            setTimingMode('anytime');
            setTriggerTime('');
            setWindowStartTime('');
            setWindowEndTime('');
            setAnchorRoutineKey('breakfast');
            setAnchorChoreId('');
            setAnchorFallbackTime('');
            setAssignees([]);
            setUseRotation(false);
            setRotationType('none');
            setRotationOrder([]);
        }
    }, [initialChore, initialDate, timeBucketOptions]);

    useEffect(() => {
        // +++ Condition added: Only apply rotation logic if NOT Up for Grabs +++
        if (useRotation && assignees.length > 0 && !isUpForGrabs) {
            // When rotation is turned on, initialize rotation order from current assignees
            // only if rotationOrder is empty or doesn't match assignees
            if (rotationOrder.length !== assignees.length || !assignees.every((id) => rotationOrder.includes(id))) {
                setRotationOrder(assignees);
            }
            // Set a default rotation type if none is set
            if (rotationType === 'none') {
                setRotationType('daily');
            }
        } else if (!useRotation || isUpForGrabs) {
            // +++ Reset if rotation toggled off OR if marked Up for Grabs +++
            // When rotation is turned off, reset rotation type and order
            setRotationType('none');
            setRotationOrder([]);
        }
        // We're not setting rotationOrder to an empty array if assignees is empty
    }, [assignees, useRotation, isUpForGrabs]); // +++ Added isUpForGrabs dependency +++

    const handleAssigneeToggle = (memberId: string) => {
        const currentlySelected = assignees.includes(memberId);
        const newAssignees = currentlySelected ? assignees.filter((id) => id !== memberId) : [...assignees, memberId];

        setAssignees(newAssignees);

        // If using rotation, update rotation order accordingly
        // +++ Only update rotation if NOT Up for Grabs +++
        if (useRotation && !isUpForGrabs) {
            setRotationOrder(newAssignees);
        }
    };

    const moveAssigneeUp = (index: number) => {
        if (index === 0) return;
        setRotationOrder((prev) => {
            const newOrder = [...prev];
            [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
            return newOrder;
        });
    };

    const moveAssigneeDown = (index: number) => {
        if (index === rotationOrder.length - 1) return;
        setRotationOrder((prev) => {
            const newOrder = [...prev];
            [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
            return newOrder;
        });
    };

    const handleSave = () => {
        const startDateValue = startDate.toISOString().slice(0, 10);
        const finalRrule = normalizeRrule(serializeRecurrenceToRrule(recurrenceUi, startDateValue)) || null;
        if (recurrenceUi.mode !== 'never' && !finalRrule) {
            alert('Please configure a valid repeat pattern before saving.');
            return;
        }
        if (recurrenceUi.repeatEndMode === 'until' && recurrenceUi.mode !== 'never' && !recurrenceUi.repeatEndUntil) {
            alert('Choose an end date for the repeat pattern, or switch it back to repeat forever.');
            return;
        }

        // +++ NEW: Validate and parse reward fields based on type +++
        let finalWeight: number | null = null;
        let finalRewardAmount: number | null = null;
        let finalRewardCurrency: string | null = null;

        // Use weight from state if not Up for Grabs or if type is weight
        if (!isUpForGrabs || rewardType === 'weight') {
            finalWeight = parseFloat(weight);
            if (isNaN(finalWeight)) {
                alert('Invalid weight. Please enter a valid number.');
                return;
            }
        }

        // Use reward amount/currency only if Up for Grabs and type is fixed
        if (isUpForGrabs && rewardType === 'fixed') {
            finalRewardAmount = parseFloat(rewardAmount);
            finalRewardCurrency = rewardCurrency.trim().toUpperCase();
            if (isNaN(finalRewardAmount) || finalRewardAmount <= 0) {
                alert('Invalid fixed reward amount. Please enter a positive number.');
                return;
            }
            if (!finalRewardCurrency || finalRewardCurrency === '__DEFINE_NEW__') {
                alert('Please select a valid currency for the fixed reward.');
                return;
            }
            // If fixed, ensure weight is nullified in save data
            finalWeight = null;
        }

        if (timingMode === 'between_times' && windowStartTime && windowEndTime && windowStartTime >= windowEndTime) {
            alert('The end time must be later than the start time.');
            return;
        }

        if ((timingMode === 'before_time' || timingMode === 'after_time') && !triggerTime) {
            alert('Choose the time this chore should be relative to.');
            return;
        }

        if ((timingMode === 'before_marker' || timingMode === 'after_marker') && !anchorRoutineKey) {
            alert('Choose a routine marker for this chore timing.');
            return;
        }

        if (timingMode === 'between_times' && (!windowStartTime || !windowEndTime)) {
            alert('Choose both a start and end time for this chore.');
            return;
        }

        if (timingMode === 'named_window' && !timeBucket) {
            alert('Choose a named window for this chore.');
            return;
        }

        if (timingMode === 'before_chore' || timingMode === 'after_chore') {
            if (!anchorChoreId) {
                alert('Choose another chore to anchor this chore to.');
                return;
            }
            if (!anchorFallbackTime) {
                alert('Choose a fallback time for chore anchors.');
                return;
            }
            if (initialChore?.id && wouldCreateChoreTimingCycle(initialChore.id, anchorChoreId, availableChoreAnchors as any)) {
                alert('That chore anchor would create a cycle. Choose a different source chore.');
                return;
            }
        }

        let finalTimeBucket: string | null = null;
        let finalTimingMode: ChoreSaveData['timingMode'] = timingMode;
        let finalTimingConfig: ChoreSaveData['timingConfig'] = null;

        if (timingMode === 'named_window') {
            finalTimeBucket = timeBucket || null;
            finalTimingConfig = {
                mode: 'named_window',
                namedWindowKey: finalTimeBucket,
            };
        } else if (timingMode === 'before_time' || timingMode === 'after_time') {
            finalTimingConfig = {
                mode: timingMode,
                time: triggerTime || null,
            };
        } else if (timingMode === 'between_times') {
            finalTimingConfig = {
                mode: 'between_times',
                window: {
                    startTime: windowStartTime || null,
                    endTime: windowEndTime || null,
                },
            };
        } else if (timingMode === 'before_marker' || timingMode === 'after_marker') {
            finalTimingConfig = {
                mode: timingMode,
                anchor: {
                    sourceType: 'routine',
                    routineKey: anchorRoutineKey,
                    fallbackTime: anchorFallbackTime || null,
                },
            };
        } else if (timingMode === 'before_chore' || timingMode === 'after_chore') {
            finalTimingConfig = {
                mode: timingMode,
                anchor: {
                    sourceType: 'chore',
                    sourceChoreId: anchorChoreId,
                    fallbackTime: anchorFallbackTime || null,
                },
            };
        } else {
            finalTimingMode = 'anytime';
            finalTimingConfig = {
                mode: 'anytime',
            };
        }

        const saveData: ChoreSaveData = {
            title,
            assignees: assignees.map((id) => ({ id })),
            description,
            startDate: startDate.toISOString(),
            rrule: finalRrule,
            exdates: initialChore?.exdates ?? [],
            pauseState: initialChore?.pauseState ?? null,
            // +++ Adjust rotation/assignment based on isUpForGrabs +++
            rotationType: useRotation && !isUpForGrabs ? rotationType : 'none',
            assignments:
                useRotation && !isUpForGrabs && rotationOrder.length > 0
                    ? rotationOrder.map((memberId, index) => ({
                          order: index,
                          familyMember: familyMembers.find((member) => member.id === memberId),
                      }))
                    : null, // Send null if not using rotation or no one is in rotation order
            weight: finalWeight, // Use parsed weight or null
            estimatedDurationSecs: (() => {
                const h = parseInt(durationHours, 10) || 0;
                const m = parseInt(durationMinutes, 10) || 0;
                const s = parseInt(durationSeconds, 10) || 0;
                const total = h * 3600 + m * 60 + s;
                return total > 0 ? total : null;
            })(),
            isUpForGrabs: isUpForGrabs,
            isJoint: isJoint,
            rewardType: isUpForGrabs ? rewardType : null, // Only set rewardType if up for grabs
            rewardAmount: finalRewardAmount,
            rewardCurrency: finalRewardCurrency,
            sortOrder: initialChore?.sortOrder ?? null,
            timeBucket: finalTimeBucket,
            timingMode: finalTimingMode,
            timingConfig: finalTimingConfig,
        };

        // Ensure assignees are always included, even if rotation is off
        // +++ Adjust assignees based on isUpForGrabs +++
        if ((!useRotation || isUpForGrabs) && assignees.length > 0) {
            saveData.assignees = assignees.map((id) => ({ id }));
        } else if (useRotation && !isUpForGrabs && rotationOrder.length > 0) {
            // If using rotation, assignees should match rotation order members
            saveData.assignees = rotationOrder.map((id) => ({ id }));
        } else {
            // If no one is selected (or rotation is on but empty)
            saveData.assignees = [];
        }

        onSave(saveData);
    };

    // Generate chore object for preview
    const choreForPreview = {
        id: initialChore?.id || 'temp-preview-id', // Use existing ID or temp
        title,
        description,
        startDate: startDate.toISOString(),
        rrule: normalizeRrule(serializeRecurrenceToRrule(recurrenceUi, startDate.toISOString().slice(0, 10))) || null,
        exdates: initialChore?.exdates || [],
        pauseState: initialChore?.pauseState || null,
        // +++ Adjust preview assignees/assignments based on isUpForGrabs +++
        rotationType: useRotation && !isUpForGrabs ? rotationType : 'none', // Set rotationType correctly for preview
        assignments:
            useRotation && !isUpForGrabs && rotationOrder.length > 0
                ? rotationOrder.map((memberId, index) => ({ order: index, familyMember: familyMembers.find((m) => m.id === memberId) }))
                : [], // assignments only exist if rotation is on AND NOT up for grabs
        assignees: isUpForGrabs
            ? assignees.length > 0
                ? assignees.map((id) => familyMembers.find((m) => m.id === id)).filter(Boolean)
                : [] // Direct assignees if up for grabs
            : useRotation && !isUpForGrabs // Assignees from rotation order if rotation is on and NOT up for grabs
            ? rotationOrder.length > 0
                ? rotationOrder.map((id) => familyMembers.find((m) => m.id === id)).filter(Boolean)
                : []
            : assignees.length > 0
            ? assignees.map((id) => familyMembers.find((m) => m.id === id)).filter(Boolean)
            : [], // Direct assignees if rotation is off
        isUpForGrabs: isUpForGrabs,
        isJoint: isJoint,
        rewardType: isUpForGrabs ? rewardType : null,
        rewardAmount: isUpForGrabs && rewardType === 'fixed' ? parseFloat(rewardAmount) || 0 : null,
        rewardCurrency: isUpForGrabs && rewardType === 'fixed' ? rewardCurrency : null,
        timeBucket: timingMode === 'named_window' ? timeBucket || null : null,
        timingMode: timingMode,
        timingConfig:
            timingMode === 'named_window'
                ? {
                      mode: 'named_window',
                      namedWindowKey: timeBucket || null,
                  }
                : timingMode === 'before_time' || timingMode === 'after_time'
                ? {
                      mode: timingMode,
                      time: triggerTime || null,
                  }
                : timingMode === 'between_times'
                ? {
                      mode: 'between_times',
                      window: {
                          startTime: windowStartTime || null,
                          endTime: windowEndTime || null,
                      },
                  }
                : timingMode === 'before_marker' || timingMode === 'after_marker'
                ? {
                      mode: timingMode,
                      anchor: {
                          sourceType: 'routine',
                          routineKey: anchorRoutineKey || null,
                          fallbackTime: anchorFallbackTime || null,
                      },
                  }
                : timingMode === 'before_chore' || timingMode === 'after_chore'
                ? {
                      mode: timingMode,
                      anchor: {
                          sourceType: 'chore',
                          sourceChoreId: anchorChoreId || null,
                          fallbackTime: anchorFallbackTime || null,
                      },
                  }
                : {
                      mode: 'anytime',
                  },
        weight: !isUpForGrabs || rewardType === 'weight' ? parseFloat(weight) || 0 : 0, // Use weight if not up for grabs OR if type is weight
        // Add any other fields needed by ChoreCalendarView, ensure they match expected types
        completions: initialChore?.completions || [], // Pass existing completions if editing
    };

    // Determine if preview should be shown
    const showPreview = !!(
        ((assignees.length > 0 || (useRotation && rotationOrder.length > 0)) && choreForPreview.rrule) // Only show if recurrence is set
    );
    const startDateValue = startDate instanceof Date && !Number.isNaN(startDate.getTime()) ? startDate.toISOString().slice(0, 10) : '';
    const activePauseStatus = initialChore ? getChorePauseStatus(initialChore) : { kind: 'none' as const, pauseState: null };
    const recurrenceEditingDisabled = activePauseStatus.kind === 'scheduled' || activePauseStatus.kind === 'paused' || activePauseStatus.kind === 'ended';
    const familyDayStartsAt = scheduleSettings?.dayBoundaryTime || '03:00';
    const routineAnchorHelpLines = timingMode === 'before_marker'
        ? [
              `This chore runs from the family-day start at ${familyDayStartsAt} until the marker happens.`,
              'Fallback time is the backup anchor if the marker is never marked that day.',
              'Example: “Before Breakfast” means 3:00 AM until Breakfast, or until the fallback time if Breakfast is not marked.',
          ]
        : [
              `This chore starts when the marker happens and runs until the next family-day cutoff at ${familyDayStartsAt}.`,
              'Fallback time is the backup anchor if the marker is never marked that day.',
              'Example: “After Dinner” means Dinner until 3:00 AM, or from the fallback time if Dinner is not marked.',
          ];
    const choreAnchorHelpLines = timingMode === 'before_chore'
        ? [
              `This chore runs from the family-day start at ${familyDayStartsAt} until the linked chore is completed.`,
              'Fallback time is required so the chore still has a usable backup anchor if the linked chore never gets completed.',
          ]
        : [
              `This chore runs from the linked chore completion until the next family-day cutoff at ${familyDayStartsAt}.`,
              'Fallback time is required so the chore still has a usable backup anchor if the linked chore never gets completed.',
          ];

    return (
        <div className="space-y-4 w-full max-w-md mx-auto">
            {/* Title */}
            <div className="space-y-2">
                <Label htmlFor="title">
                    Title <span className="text-destructive">*</span>
                </Label>
                <Input id="title" placeholder="Chore title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>

            {/* Description */}
            <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" placeholder="Chore description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>

            {/* Estimated Duration */}
            <div className="space-y-2">
                <Label>Estimated Duration</Label>
                <div className="flex items-center gap-1.5">
                    <Input
                        id="durationHours"
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={durationHours}
                        onChange={(e) => setDurationHours(e.target.value)}
                        className="w-16 text-center"
                    />
                    <span className="text-sm text-muted-foreground">h</span>
                    <Input
                        id="durationMinutes"
                        type="number"
                        min="0"
                        max="59"
                        step="1"
                        placeholder="0"
                        value={durationMinutes}
                        onChange={(e) => setDurationMinutes(e.target.value)}
                        className="w-16 text-center"
                    />
                    <span className="text-sm text-muted-foreground">m</span>
                    <Input
                        id="durationSeconds"
                        type="number"
                        min="0"
                        max="59"
                        step="1"
                        placeholder="0"
                        value={durationSeconds}
                        onChange={(e) => setDurationSeconds(e.target.value)}
                        className="w-16 text-center"
                    />
                    <span className="text-sm text-muted-foreground">s</span>
                </div>
                <p className="text-xs text-muted-foreground">
                    How long this chore typically takes. Used for start-time alerts and countdown timers.
                </p>
            </div>

            {/* +++ NEW: Up for Grabs Toggle +++ */}
            <div className="space-y-3 pt-3 border-t">
                <div className="flex items-center space-x-2">
                    <Switch
                        id="isUpForGrabs"
                        checked={isUpForGrabs}
                        onCheckedChange={(checked) => {
                            setIsUpForGrabs(checked);
                            if (checked) setIsJoint(false); // Mutually exclusive
                        }}
                    />
                    <Label htmlFor="isUpForGrabs">Up for Grabs Chore</Label>
                </div>
                <p className="text-xs text-muted-foreground pl-8">
                    Any assigned member can complete this chore on a first-come, first-served basis each day it's due. No rotation applies.
                </p>
            </div>

            {/* +++ Conditional Rendering START: Only show reward options if Up for Grabs +++ */}
            {isUpForGrabs && (
                <>
                    {/* +++ NEW: Reward Type Selection +++ */}
                    <div className="space-y-2 pt-3 border-t">
                        <Label className="font-semibold">Reward / Allowance Value:</Label>
                        <RadioGroup value={rewardType} onValueChange={(value: 'fixed' | 'weight') => setRewardType(value)} className="flex flex-col space-y-1">
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="weight" id="reward-weight" />
                                <Label htmlFor="reward-weight" className="font-normal flex flex-col">
                                    <span>Use Weight</span>
                                    <span className="text-xs text-muted-foreground">
                                        Counts towards allowance based on assigned weight (can exceed 100% total).
                                    </span>
                                </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                                <RadioGroupItem value="fixed" id="reward-fixed" />
                                <Label htmlFor="reward-fixed" className="font-normal flex flex-col">
                                    <span>Fixed Amount</span>
                                    <span className="text-xs text-muted-foreground">Adds a specific, non-editable amount to allowance upon completion.</span>
                                </Label>
                            </div>
                        </RadioGroup>
                    </div>
                </>
            )}
            {/* +++ Conditional Rendering END +++ */}

            {/* +++ NEW: Conditional Inputs for Reward Type (and Weight) +++ */}
            {/* Show Weight Input if NOT UpForGrabs OR if UpForGrabs and rewardType is 'weight' */}
            {!isUpForGrabs || rewardType === 'weight' ? (
                <div className="space-y-2 pt-3 border-t">
                    <Label htmlFor="weight">
                        Weight <span className="text-destructive">*</span>
                    </Label>
                    <Input
                        id="weight"
                        type="number"
                        step="any" // Allow decimals and negatives
                        placeholder="e.g., 1, 0.5, -2 (0=exclude)"
                        value={weight}
                        onChange={(e) => setWeight(e.target.value)}
                        required // <-- Make the input required
                    />
                    <p className="text-xs text-muted-foreground">
                        Enter a number (positive or negative). Chores with 0 weight are excluded from allowance calculation.
                    </p>
                </div>
            ) : null}
            {/* Show Fixed Amount Inputs ONLY if UpForGrabs and rewardType is 'fixed' */}
            {isUpForGrabs && rewardType === 'fixed' ? (
                // Show Fixed Amount Inputs
                <div className="space-y-4 pt-3 border-t">
                    <div>
                        <Label htmlFor="reward-amount">
                            Fixed Reward Amount <span className="text-destructive">*</span>
                        </Label>
                        <Input
                            id="reward-amount"
                            type="number"
                            step="0.01"
                            placeholder="e.g., 2.50"
                            value={rewardAmount}
                            onChange={(e) => setRewardAmount(e.target.value)}
                            min="0" // Fixed rewards likely non-negative
                            required={rewardType === 'fixed'} // Require if fixed is selected
                        />
                    </div>
                    <div>
                        <Label htmlFor="reward-currency-input">
                            Reward Currency <span className="text-destructive">*</span>
                        </Label>
                        {/* +++ Use CurrencySelector Component +++ */}
                        <CurrencySelector
                            db={db} // Pass db instance from props
                            value={rewardCurrency}
                            onChange={setRewardCurrency} // Pass setter for rewardCurrency state
                            currencyOptions={currencyOptions} // Pass options from props
                            unitDefinitions={unitDefinitions} // Pass definitions from props (needed for DefineUnitForm)
                            placeholder="Select reward currency..."
                            disabled={rewardType !== 'fixed'} // Disable if not fixed reward type
                        />
                    </div>
                </div>
            ) : null}

            {/* Start Date */}
            <div className="space-y-2">
                <Label htmlFor="startDate">
                    Start Date <span className="text-destructive">*</span>
                </Label>
                <Input
                    id="startDate"
                    type="date"
                    value={startDateValue}
                    disabled={recurrenceEditingDisabled}
                    onChange={(e) => {
                        const dateValue = e.target.value;
                        if (dateValue) {
                            const [year, month, day] = dateValue.split('-').map(Number);
                            setStartDate(new Date(Date.UTC(year, month - 1, day)));
                        }
                    }}
                    required
                />
                {recurrenceEditingDisabled ? (
                    <p className="text-xs text-muted-foreground">Start date is locked while a pause or end is currently scheduled.</p>
                ) : null}
            </div>

            <ChoreRecurrenceFields
                startDateValue={startDateValue}
                recurrenceUi={recurrenceUi}
                setRecurrenceUi={setRecurrenceUi}
                disableEditing={recurrenceEditingDisabled}
            />

            {initialChore && onScheduleAction ? (
                <ChoreScheduleActions
                    chore={initialChore}
                    onApplySchedulePatch={async (patch) => {
                        await onScheduleAction(patch);
                    }}
                />
            ) : null}

            <div className="space-y-4 border-t pt-3">
                <div className="space-y-2">
                    <Label className="font-semibold">When does this happen?</Label>
                    <RadioGroup value={timingMode} onValueChange={(value: any) => setTimingMode(value)}>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="anytime" id="timing-anytime" />
                            <Label htmlFor="timing-anytime">Anytime</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="named_window" id="timing-named-window" />
                            <Label htmlFor="timing-named-window">Named window</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="before_time" id="timing-before-time" />
                            <Label htmlFor="timing-before-time">Before a time</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="after_time" id="timing-after-time" />
                            <Label htmlFor="timing-after-time">After a time</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="between_times" id="timing-between-times" />
                            <Label htmlFor="timing-between-times">Between two times</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="before_marker" id="timing-before-marker" />
                            <Label htmlFor="timing-before-marker">Before a routine marker</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="after_marker" id="timing-after-marker" />
                            <Label htmlFor="timing-after-marker">After a routine marker</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="before_chore" id="timing-before-chore" />
                            <Label htmlFor="timing-before-chore">Before another chore</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <RadioGroupItem value="after_chore" id="timing-after-chore" />
                            <Label htmlFor="timing-after-chore">After another chore</Label>
                        </div>
                    </RadioGroup>
                </div>

                {timingMode === 'named_window' ? (
                    <div className="space-y-2">
                        <Label htmlFor="timeBucket">Named Window</Label>
                        <select
                            id="timeBucket"
                            value={timeBucket}
                            onChange={(event) => setTimeBucket(event.target.value)}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                            <option value="">Choose a named window…</option>
                            {timeBucketOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-muted-foreground">
                            This uses one of the reusable labeled ranges from Household Scheduling settings.
                        </p>
                    </div>
                ) : null}

                {(timingMode === 'before_time' || timingMode === 'after_time') ? (
                    <div className="space-y-2">
                        <Label htmlFor="triggerTime">Anchor Time</Label>
                        <Input id="triggerTime" type="time" value={triggerTime} onChange={(event) => setTriggerTime(event.target.value)} />
                        <p className="text-xs text-muted-foreground">
                            `{timingMode === 'before_time' ? 'Before' : 'After'}` uses the family-day boundary at {familyDayStartsAt} as the other edge of the window.
                        </p>
                    </div>
                ) : null}

                {timingMode === 'between_times' ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="windowStartTime">Window Start</Label>
                            <Input id="windowStartTime" type="time" value={windowStartTime} onChange={(event) => setWindowStartTime(event.target.value)} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="windowEndTime">Window End</Label>
                            <Input id="windowEndTime" type="time" value={windowEndTime} onChange={(event) => setWindowEndTime(event.target.value)} />
                        </div>
                    </div>
                ) : null}

                {(timingMode === 'before_marker' || timingMode === 'after_marker') ? (
                    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                        <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white/80 p-3">
                            <div>
                                <div className="font-medium text-slate-900">Marker fallback anchor</div>
                                <p className="mt-1 text-xs text-slate-600">
                                    This chore uses one marker moment. If the marker is not marked, the fallback time becomes the backup anchor.
                                </p>
                            </div>
                            <TimingHelpPopover title="How fallback times work" lines={routineAnchorHelpLines} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="anchorRoutineKey">Routine Marker</Label>
                            <select
                                id="anchorRoutineKey"
                                value={anchorRoutineKey}
                                onChange={(event) => setAnchorRoutineKey(event.target.value)}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            >
                                {routineMarkerOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="anchorFallbackTime">Fallback Time (Optional)</Label>
                            <Input
                                id="anchorFallbackTime"
                                type="time"
                                value={anchorFallbackTime}
                                onChange={(event) => setAnchorFallbackTime(event.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                If the marker is never marked, this time becomes the backup anchor. Otherwise the marker&apos;s own default time is used.
                            </p>
                        </div>
                    </div>
                ) : null}

                {(timingMode === 'before_chore' || timingMode === 'after_chore') ? (
                    <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                        <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white/80 p-3">
                            <div>
                                <div className="font-medium text-slate-900">Chore fallback anchor</div>
                                <p className="mt-1 text-xs text-slate-600">
                                    The linked chore gives the real anchor when it is completed. The fallback time is required so this chore still resolves if that never happens.
                                </p>
                            </div>
                            <TimingHelpPopover title="How chore-anchor fallback works" lines={choreAnchorHelpLines} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="anchorChoreId">Anchor Chore</Label>
                            <select
                                id="anchorChoreId"
                                value={anchorChoreId}
                                onChange={(event) => setAnchorChoreId(event.target.value)}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            >
                                <option value="">Choose a chore…</option>
                                {availableAnchorChores.map((chore) => (
                                    <option key={chore.id} value={chore.id}>
                                        {chore.title || 'Untitled chore'}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="choreAnchorFallbackTime">Fallback Time</Label>
                            <Input
                                id="choreAnchorFallbackTime"
                                type="time"
                                value={anchorFallbackTime}
                                onChange={(event) => setAnchorFallbackTime(event.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                This backup anchor is used if the linked chore is never completed that day.
                            </p>
                        </div>
                    </div>
                ) : null}
            </div>

            {/* Family Members Selection */}
            <div className="space-y-2">
                <Label>
                    Assignees <span className="text-destructive">*</span>
                </Label>
                <div className="flex flex-wrap gap-2">
                    {familyMembers.map((member) => {
                        const isSelected = assignees.includes(member.id);
                        // +++ Conditionally disable rotation UI if Up for Grabs +++
                        const isRotationDisabled = isUpForGrabs;
                        return (
                            <button
                                type="button" // Prevent form submission
                                key={member.id}
                                onClick={() => handleAssigneeToggle(member.id)}
                                className={`px-2 py-1 rounded text-sm transition-colors ${
                                    isSelected ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                                }`}
                            >
                                {member.name}
                            </button>
                        );
                    })}
                </div>
                {assignees.length === 0 && <p className="text-xs text-destructive">At least one assignee is required.</p>}
            </div>

            {/* +++ NEW: Joint Chore Checkbox (Condition: >1 assignee AND NOT Up for Grabs) +++ */}
            {assignees.length > 1 && !isUpForGrabs && (
                <div className="space-y-2 pt-2">
                    <div className="flex items-center space-x-2">
                        <Switch id="isJoint" checked={isJoint} onCheckedChange={setIsJoint} />
                        <Label htmlFor="isJoint">Joint Chore</Label>
                    </div>
                    <p className="text-xs text-muted-foreground pl-8">
                        Check this if the selected members work together to complete one single task (e.g., 'Clean Game Room'). Leave unchecked if they each do
                        their own individual task (e.g., 'Math Practice').
                    </p>
                </div>
            )}

            {/* Rotation Options - Only show if more than one assignee selected AND NOT Up for Grabs */}
            {assignees.length > 1 && !isUpForGrabs && (
                <div className="space-y-3 pt-3 border-t">
                    <div className="flex items-center space-x-2">
                        <Switch id="useRotation" checked={useRotation} onCheckedChange={setUseRotation} />
                        <Label htmlFor="useRotation">Rotate between selected assignees</Label>
                    </div>

                    {useRotation && (
                        <div className="pl-4 space-y-4">
                            {' '}
                            {/* Indent rotation options */}
                            {/* Rotation Frequency */}
                            <div className="space-y-2">
                                <Label className="font-semibold">Rotation Frequency:</Label>
                                <RadioGroup value={rotationType} onValueChange={(value: 'daily' | 'weekly' | 'monthly') => setRotationType(value)}>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="daily" id="rotate-daily" />
                                        <Label htmlFor="rotate-daily">Rotate Each Scheduled Day</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="weekly" id="rotate-weekly" />
                                        <Label htmlFor="rotate-weekly">Rotate Weekly</Label>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <RadioGroupItem value="monthly" id="rotate-monthly" />
                                        <Label htmlFor="rotate-monthly">Rotate Monthly</Label>
                                    </div>
                                </RadioGroup>
                            </div>
                            {/* Rotation Order */}
                            {rotationOrder.length > 0 && (
                                <div className="space-y-2">
                                    <Label className="mb-1 block font-semibold">Rotation Order:</Label>
                                    <div className="space-y-1 max-h-40 overflow-y-auto border rounded p-2 bg-background">
                                        {rotationOrder.map((memberId, index) => {
                                            const member = familyMembers.find((m) => m.id === memberId);
                                            return (
                                                <div key={memberId} className="flex items-center justify-between p-1 hover:bg-muted rounded">
                                                    <span className="text-sm">
                                                        {index + 1}. {member?.name || 'Unknown Member'}
                                                    </span>
                                                    <div className="flex space-x-1">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-5 w-5"
                                                            onClick={() => moveAssigneeUp(index)}
                                                            disabled={index === 0}
                                                            aria-label={`Move ${member?.name} up`}
                                                        >
                                                            <ChevronUp className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-5 w-5"
                                                            onClick={() => moveAssigneeDown(index)}
                                                            disabled={index === rotationOrder.length - 1}
                                                            aria-label={`Move ${member?.name} down`}
                                                        >
                                                            <ChevronDown className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Chore Calendar Preview - Only show if recurrence is set */}
            {showPreview && (
                <div className="pt-3 border-t">
                    <ChoreAssignmentPreviewSection
                        chore={choreForPreview}
                        anchorDate={startDate}
                        description="Preview how this chore will be assigned over time, including completion state for each occurrence."
                    />
                </div>
            )}

            {/* Save Button */}
            <Button
                onClick={handleSave}
                className="w-full"
                disabled={
                    !title ||
                    assignees.length === 0 ||
                    (rewardType === 'weight' && !weight) || // Disable if weight type and no weight
                    (rewardType === 'fixed' && isUpForGrabs && (!rewardAmount || !rewardCurrency || rewardCurrency === '__DEFINE_NEW__')) // Disable if fixed type and missing info, ONLY IF up for grabs
                }
            >
                {initialChore ? 'Update Chore' : 'Save Chore'}
            </Button>
        </div>
    );
}

export default DetailedChoreForm;
