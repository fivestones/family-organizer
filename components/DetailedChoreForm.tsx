import React, { useState, useEffect, useRef } from 'react';
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
import RecurrenceRuleForm from './RecurrenceRuleForm';
import ChoreCalendarView from './ChoreCalendarView';
import { RRule, Frequency, rrulestr } from 'rrule';
import { toUTCDate } from '@/lib/chore-utils';
import { cn } from '@/lib/utils';
// here gemini wants to initialize the db for fetching units, but I'm not sure if we should do this. Should we instead be fetching the units elsewhere and sending them to DetailedChoreForm as a prop? I'm not sure.
// Interface for the data structure passed to onSave
// Ensure it includes the new 'weight' field
interface ChoreSaveData {
    title: string;
    assignees: { id: string }[];
    description?: string;
    startDate: string; // ISO String
    rrule: string | null;
    rotationType: 'none' | 'daily' | 'weekly' | 'monthly';
    assignments: { order: number; familyMember: any }[] | null; // Adjust 'any' if FamilyMember type is available here
    weight?: number | null;
    isUpForGrabs?: boolean | null;
    isJoint?: boolean | null;
    rewardType?: 'fixed' | 'weight' | null;
    rewardAmount?: number | null;
    rewardCurrency?: string | null;
}

// +++ Define props interface +++
interface DetailedChoreFormProps {
    familyMembers: any[];
    onSave: (data: Partial<ChoreSaveData>) => void;
    initialChore?: any | null;
    initialDate: Date;
    db: any; // InstantDB instance passed down
    unitDefinitions: any[]; // Pass definitions
    currencyOptions: { value: string; label: string }[]; // Pass computed options
}

function DetailedChoreForm({
    // New signature using props interface
    familyMembers,
    onSave,
    initialChore = null,
    initialDate,
    db,
    unitDefinitions,
    currencyOptions,
}: DetailedChoreFormProps) {
    const [title, setTitle] = useState('');
    const [assignees, setAssignees] = useState<string[]>([]);
    const [description, setDescription] = useState('');
    const [startDate, setStartDate] = useState<Date>(toUTCDate(initialDate || new Date()));
    const [rotationType, setRotationType] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
    const [rotationOrder, setRotationOrder] = useState<string[]>([]);
    const [useRotation, setUseRotation] = useState(false);
    const [weight, setWeight] = useState<string>('0'); // Default to '0'
    const [isUpForGrabs, setIsUpForGrabs] = useState(false);
    const [isJoint, setIsJoint] = useState(false);
    const [rewardType, setRewardType] = useState<'fixed' | 'weight'>('weight'); // Default to weight-based
    const [rewardAmount, setRewardAmount] = useState<string>('');
    const [rewardCurrency, setRewardCurrency] = useState<string>('');
    // --- Remove state for inline selector ---
    // const [rewardCurrencyPopoverOpen, setRewardCurrencyPopoverOpen] = useState(false);
    // const [rewardCurrencySearch, setRewardCurrencySearch] = useState('');
    // const rewardItemSelectedRef = useRef(false);
    // const [isDefineUnitModalOpen, setIsDefineUnitModalOpen] = useState(false);

    // Initialize recurrenceOptions and initialRecurrenceOptions
    const [recurrenceOptions, setRecurrenceOptions] = useState<({ freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>>) | null>(null);

    const [initialRecurrenceOptions] = useState<({ freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>>) | null>(() => {
        if (initialChore) {
            if (initialChore.rrule) {
                // Parse the existing rrule
                try {
                    const options = RRule.parseString(initialChore.rrule);
                    const rrule = new RRule(options);
                    return rrule.options;
                } catch (error) {
                    console.error('Error parsing RRule:', error);
                    return null;
                }
            } else {
                return null; // Chore is set to "once"
            }
        } else {
            // Creating a new chore; default to daily recurrence
            return { freq: Frequency.DAILY, interval: 1 };
        }
    });

    useEffect(() => {
        if (initialChore) {
            console.log('DEBUG: Opening Edit Modal for:', initialChore.title);
            setTitle(initialChore.title);
            setDescription(initialChore.description || '');
            setStartDate(toUTCDate(new Date(initialChore.startDate)));
            // +++ Set initial weight +++
            setWeight(initialChore.weight !== null && initialChore.weight !== undefined ? String(initialChore.weight) : '');
            // +++ Set initial up-for-grabs state +++
            setIsUpForGrabs(initialChore.isUpForGrabs ?? false);
            // +++ Set initial joint state +++
            setIsJoint(initialChore.isJoint ?? false);
            setRewardType(initialChore.rewardType === 'fixed' ? 'fixed' : 'weight'); // Default to weight if not set
            setRewardAmount(initialChore.rewardAmount !== null && initialChore.rewardAmount !== undefined ? String(initialChore.rewardAmount) : '');
            setRewardCurrency(initialChore.rewardCurrency || '');

            // Set the initial recurrence options
            if (initialChore.rrule) {
                try {
                    const options = RRule.parseString(initialChore.rrule);
                    // Make sure options includes freq before creating RRule
                    if (options.freq !== undefined) {
                        const rrule = new RRule(options);
                        // Filter out default time values if they were not explicitly provided
                        if (!('byhour' in options)) rrule.options.byhour = null;
                        if (!('byminute' in options)) rrule.options.byminute = null;
                        if (!('bysecond' in options)) rrule.options.bysecond = null;
                        if (!('wkst' in options)) rrule.options.wkst = null;
                        // if (!('byweekday' in options)) rrule.options.byweekday = null;

                        setRecurrenceOptions(rrule.options);
                    } else {
                        console.error('Parsed RRule options missing frequency:', options);
                        setRecurrenceOptions(null); // Fallback if freq is missing
                    }
                } catch (error) {
                    console.error('Error parsing RRule:', error);
                    setRecurrenceOptions(null);
                }
            } else {
                setRecurrenceOptions(null);
            }

            const isRotatingChore = initialChore.rotationType !== 'none';
            setUseRotation(isRotatingChore);
            setRotationType(initialChore.rotationType);

            if (isRotatingChore && initialChore.assignments) {
                // +++ DEBUG: Log raw assignments +++
                console.log('DEBUG: Initial Assignments Raw:', JSON.stringify(initialChore.assignments, null, 2));

                const sortedAssignments = [...initialChore.assignments].sort((a: any, b: any) => {
                    const orderA = a.order ?? 0;
                    const orderB = b.order ?? 0;
                    return orderA - orderB;
                });

                // +++ DEBUG: Log sorted assignments +++
                console.log(
                    'DEBUG: Sorted Assignments:',
                    sortedAssignments.map((a: any) => `id=${a.id}, order=${a.order}, member=${a.familyMember?.id}`)
                );

                const rotationIds = sortedAssignments
                    .map((assignment: any) => {
                        // Handle potential array vs object structure for familyMember
                        const fm = Array.isArray(assignment.familyMember) ? assignment.familyMember[0] : assignment.familyMember;
                        return fm?.id;
                    })
                    .filter((id: any) => !!id);

                console.log('DEBUG: Final Rotation IDs:', rotationIds);

                setRotationOrder(rotationIds);
                const assigneeIds = initialChore.assignees.map((a: any) => a.id);
                setAssignees(assigneeIds);
            } else if (!isRotatingChore && initialChore.assignees) {
                const assigneeIds = initialChore.assignees.map((a: any) => a.id);
                setAssignees(assigneeIds);
                // Ensure rotationOrder is empty if not using rotation
                setRotationOrder([]);
            } else {
                // Reset if neither case applies
                setAssignees([]);
                setRotationOrder([]);
            }
        } else {
            // For new chores, set the default recurrence options
            setRecurrenceOptions(initialRecurrenceOptions);
            // Reset other fields for a new chore form
            // Not sure if the below setX() functions are needed or if it might mess things up
            // TODO
            setTitle('');
            setDescription('');
            setStartDate(toUTCDate(initialDate || new Date()));
            setWeight('0'); // Reset to '0' instead of ''
            // +++ NEW: Reset up-for-grabs fields +++
            setIsUpForGrabs(false);
            setIsJoint(false);
            setRewardType('weight');
            setRewardAmount('');
            setRewardCurrency('');
            setAssignees([]);
            setUseRotation(false);
            setRotationType('none');
            setRotationOrder([]);
        }
    }, [initialChore, initialDate, initialRecurrenceOptions]);

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
        let finalRrule = null;
        if (recurrenceOptions) {
            try {
                // Remove dtstart before generating string if it exists, RRule adds it automatically based on context
                const optionsForString = { ...recurrenceOptions };
                if ('dtstart' in optionsForString) {
                    delete optionsForString.dtstart;
                }
                // Also remove internal properties that might cause issues if they slipped in
                delete (optionsForString as any)._dtstart; // Example if internal properties exist

                // Ensure freq is present
                if (optionsForString.freq === undefined) {
                    throw new Error('Frequency (freq) is required to generate RRULE string.');
                }

                const rrule = new RRule(optionsForString);
                finalRrule = rrule.toString();
                if (!finalRrule.startsWith('RRULE:')) {
                    console.log('needed to add the RRULE: prefix even after doing rrule.toString()');
                    finalRrule = 'RRULE:' + finalRrule;
                }
            } catch (error: any) {
                console.error('Error creating RRule:', error);
                // Handle the error, perhaps by showing a message to the user
                alert(`Error saving recurrence rule: ${error.message}`);
                return; // Prevent saving if recurrence is invalid
            }
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

        const saveData: ChoreSaveData = {
            title,
            assignees: assignees.map((id) => ({ id })),
            description,
            startDate: startDate.toISOString(),
            rrule: finalRrule,
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
            isUpForGrabs: isUpForGrabs,
            isJoint: isJoint,
            rewardType: isUpForGrabs ? rewardType : null, // Only set rewardType if up for grabs
            rewardAmount: finalRewardAmount,
            rewardCurrency: finalRewardCurrency,
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
        rrule: (() => {
            if (!recurrenceOptions) return null;
            try {
                // Remove dtstart before generating string if it exists
                const optionsForPreview = { ...recurrenceOptions };
                if ('dtstart' in optionsForPreview) {
                    delete optionsForPreview.dtstart;
                }
                delete (optionsForPreview as any)._dtstart;

                // Ensure freq is present
                if (optionsForPreview.freq === undefined) return null;

                const rrule = new RRule({
                    ...optionsForPreview,
                    dtstart: startDate, // Add start date specifically for preview calculation
                });
                return rrule.toString();
            } catch (error) {
                console.error('Error creating RRule for preview:', error);
                return null; // Return null if rule is invalid for preview
            }
        })(),
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
        weight: !isUpForGrabs || rewardType === 'weight' ? parseFloat(weight) || 0 : 0, // Use weight if not up for grabs OR if type is weight
        // Add any other fields needed by ChoreCalendarView, ensure they match expected types
        completions: initialChore?.completions || [], // Pass existing completions if editing
    };

    // Determine if preview should be shown
    const showPreview = !!(
        ((assignees.length > 0 || (useRotation && rotationOrder.length > 0)) && choreForPreview.rrule) // Only show if recurrence is set
    );

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
                    // Ensure value is in 'yyyy-MM-dd' format for the input
                    value={startDate instanceof Date && !isNaN(startDate.getTime()) ? startDate.toISOString().split('T')[0] : ''}
                    onChange={(e) => {
                        // Parse the date input, ensuring it's treated as UTC
                        const dateValue = e.target.value; // yyyy-MM-dd string
                        if (dateValue) {
                            const [year, month, day] = dateValue.split('-').map(Number);
                            // Create Date object using UTC values
                            setStartDate(new Date(Date.UTC(year, month - 1, day)));
                        }
                    }}
                    required
                />
            </div>

            {/* Recurrence Rule Form */}
            <div className="space-y-2">
                <Label>Frequency</Label>
                <RecurrenceRuleForm
                    // Key prop forces re-initialization if initialOptions change significantly
                    // This helps when switching between editing different chores.
                    key={initialChore?.id || 'new-chore'}
                    onSave={(options) => {
                        setRecurrenceOptions(options); // Update state when recurrence changes
                    }}
                    initialOptions={initialRecurrenceOptions} // Pass initial options for editing
                />
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
                <div className="space-y-2 pt-3 border-t">
                    <Label className="block font-semibold">Assignment Preview (Next 3 Months):</Label>
                    <div className="border rounded-md overflow-x-auto max-w-full bg-background" style={{ maxHeight: '300px' }}>
                        <ChoreCalendarView chore={choreForPreview} />
                    </div>
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
