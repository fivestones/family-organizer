import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from '@/components/ui/switch';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import RecurrenceRuleForm from './RecurrenceRuleForm';
import ChoreCalendarView from './ChoreCalendarView';
import { RRule, Frequency, rrulestr } from 'rrule';
import { toUTCDate } from '@/lib/chore-utils';

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
    weight?: number | null; // Add weight field
}


function DetailedChoreForm({ familyMembers, onSave, initialChore = null, initialDate }) {
  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<Date>(toUTCDate(initialDate || new Date()));
  const [rotationType, setRotationType] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [rotationOrder, setRotationOrder] = useState<string[]>([]);
  const [useRotation, setUseRotation] = useState(false);
  // +++ NEW: State for chore weight +++
  const [weight, setWeight] = useState<string>('0'); // Default to '0'

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
      setTitle(initialChore.title);
      setDescription(initialChore.description || '');
      setStartDate(toUTCDate(new Date(initialChore.startDate)));
      // +++ NEW: Set initial weight +++
      setWeight(initialChore.weight !== null && initialChore.weight !== undefined ? String(initialChore.weight) : '');


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
               console.error("Parsed RRule options missing frequency:", options);
               setRecurrenceOptions(null); // Fallback if freq is missing
           }

        } catch (error) {
          console.error("Error parsing RRule:", error);
          setRecurrenceOptions(null);
        }
      } else {
        setRecurrenceOptions(null);
      }

      const isRotatingChore = initialChore.rotationType !== 'none';
      setUseRotation(isRotatingChore);
      setRotationType(initialChore.rotationType);

      if (isRotatingChore && initialChore.assignments) {
        const rotationIds = initialChore.assignments
          .filter(assignment => assignment.familyMember)
          .map(assignment => assignment.familyMember.id);
        setRotationOrder(rotationIds);
        const assigneeIds = initialChore.assignees.map(a => a.id);
        setAssignees(assigneeIds);
      } else if (!isRotatingChore && initialChore.assignees) {
        const assigneeIds = initialChore.assignees.map(a => a.id);
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
      setAssignees([]);
      setUseRotation(false);
      setRotationType('none');
      setRotationOrder([]);
    }
  }, [initialChore, initialDate, initialRecurrenceOptions]);


  useEffect(() => {
    if (useRotation && assignees.length > 0) {
        // When rotation is turned on, initialize rotation order from current assignees
        // only if rotationOrder is empty or doesn't match assignees
        if (rotationOrder.length !== assignees.length || !assignees.every(id => rotationOrder.includes(id))) {
      setRotationOrder(assignees);
        }
        // Set a default rotation type if none is set
        if (rotationType === 'none') {
      setRotationType('daily');
        }
    } else if (!useRotation) {
      // When rotation is turned off, reset rotation type and order
      setRotationType('none');
       setRotationOrder([]);
    }
    // We're not setting rotationOrder to an empty array if assignees is empty
  }, [assignees, useRotation]);

  // useEffect(() => {
  //   console.log("Current state:", { 
  //     title, 
  //     assignees,
  //     description, 
  //     startDate, 
  //     recurrenceOptions, 
  //     rotationType, 
  //     rotationOrder, 
  //     useRotation 
  //   });
  // });

  const handleAssigneeToggle = (memberId: string) => {
    const currentlySelected = assignees.includes(memberId);
    const newAssignees = currentlySelected
        ? assignees.filter(id => id !== memberId)
        : [...assignees, memberId];

    setAssignees(newAssignees);

    // If using rotation, update rotation order accordingly
    if (useRotation) {
        setRotationOrder(newAssignees);
    }
  };

  const moveAssigneeUp = (index: number) => {
    if (index === 0) return;
    setRotationOrder(prev => {
      const newOrder = [...prev];
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      return newOrder;
    });
  };

  const moveAssigneeDown = (index: number) => {
    if (index === rotationOrder.length - 1) return;
    setRotationOrder(prev => {
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
        delete optionsForString._dtstart; // Example if internal properties exist

        // Ensure freq is present
         if (optionsForString.freq === undefined) {
             throw new Error("Frequency (freq) is required to generate RRULE string.");
         }


        const rrule = new RRule(optionsForString);
        finalRrule = rrule.toString();
        if (!finalRrule.startsWith('RRULE:')) {
          console.log("needed to add the RRULE: prefix even after doing rrule.toString()");
          finalRrule = 'RRULE:' + finalRrule;
        }
      } catch (error) {
        console.error("Error creating RRule:", error);
        // Handle the error, perhaps by showing a message to the user
        alert(`Error saving recurrence rule: ${error.message}`);
        return; // Prevent saving if recurrence is invalid
      }
    }

    // +++ NEW: Parse weight +++
    const parsedWeight = parseFloat(weight); // Directly parse, as it shouldn't be empty
    if (isNaN(parsedWeight)) { // Check if the result is not a number
        alert("Invalid weight. Please enter a valid number.");
         return; // Prevent saving with invalid weight
     }


    const saveData: ChoreSaveData = {
      title,
      assignees: assignees.map(id => ({ id })),
      description,
      startDate: startDate.toISOString(),
      rrule: finalRrule,
      rotationType: useRotation ? rotationType : 'none',
      assignments: useRotation && rotationOrder.length > 0
        ? rotationOrder.map((memberId, index) => ({
            order: index,
            familyMember: familyMembers.find(member => member.id === memberId),
          }))
        : null, // Send null if not using rotation or no one is in rotation order
      weight: parsedWeight, // Pass parsed weight (can be null)
    };

    // Ensure assignees are always included, even if rotation is off
     if (!useRotation && assignees.length > 0) {
         saveData.assignees = assignees.map(id => ({ id }));
     } else if (useRotation && rotationOrder.length > 0) {
         // If using rotation, assignees should match rotation order members
         saveData.assignees = rotationOrder.map(id => ({ id }));
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
            delete optionsForPreview._dtstart;

           // Ensure freq is present
             if (optionsForPreview.freq === undefined) return null;


          const rrule = new RRule({
              ...optionsForPreview,
              dtstart: startDate, // Add start date specifically for preview calculation
          });
          return rrule.toString();
      } catch (error) {
        console.error("Error creating RRule for preview:", error);
        return null; // Return null if rule is invalid for preview
      }
    })(),
    rotationType: useRotation ? rotationType : 'none',
    assignments: useRotation && rotationOrder.length > 0
      ? rotationOrder.map((memberId, index) => ({
          order: index,
          familyMember: familyMembers.find(m => m.id === memberId),
        }))
      : [], // Use empty array instead of null for preview if needed
    assignees: useRotation ?
        (rotationOrder.length > 0 ? rotationOrder.map(id => familyMembers.find(m => m.id === id)).filter(Boolean) : []) // Assignees from rotation order
      : (assignees.length > 0 ? assignees.map(id => familyMembers.find(m => m.id === id)).filter(Boolean) : []), // Assignees directly selected

    weight: parseFloat(weight) || 0, // Use 0 for preview if weight is unset/invalid
    // Add any other fields needed by ChoreCalendarView, ensure they match expected types
    completions: initialChore?.completions || [], // Pass existing completions if editing
  };

   // Determine if preview should be shown
   const showPreview = !!(
        (assignees.length > 0 || (useRotation && rotationOrder.length > 0)) &&
        choreForPreview.rrule // Only show if recurrence is set
    );


  return (
    <div className="space-y-4 w-full max-w-md mx-auto">
      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">Title <span className="text-destructive">*</span></Label>
        <Input
          id="title"
          placeholder="Chore title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="Chore description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

       {/* +++ NEW: Weight Input +++ */}
      <div className="space-y-2">
            <Label htmlFor="weight">Weight <span className="text-destructive">*</span></Label>
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


      {/* Start Date */}
      <div className="space-y-2">
        <Label htmlFor="startDate">Start Date <span className="text-destructive">*</span></Label>
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
        <Label>Assignees <span className="text-destructive">*</span></Label>
        <div className="flex flex-wrap gap-2">
          {familyMembers.map(member => {
            const isSelected = assignees.includes(member.id);
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

      {/* Rotation Options - Only show if more than one assignee selected */}
      {assignees.length > 1 && (
        <div className="space-y-3 pt-3 border-t">
          <div className="flex items-center space-x-2">
            <Switch
              id="useRotation"
              checked={useRotation}
              onCheckedChange={setUseRotation}
            />
            <Label htmlFor="useRotation">Rotate between selected assignees</Label>
          </div>

          {useRotation && (
            <div className="pl-4 space-y-4"> {/* Indent rotation options */}
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
                    const member = familyMembers.find(m => m.id === memberId);
                    return (
                       <div key={memberId} className="flex items-center justify-between p-1 hover:bg-muted rounded">
                         <span className="text-sm">{index + 1}. {member?.name || 'Unknown Member'}</span>
                         <div className="flex space-x-1">
                           <Button
                                variant="ghost" size="icon" className="h-5 w-5"
                            onClick={() => moveAssigneeUp(index)}
                            disabled={index === 0}
                                aria-label={`Move ${member?.name} up`}
                          >
                            <ChevronUp className="h-4 w-4" />
                           </Button>
                           <Button
                                variant="ghost" size="icon" className="h-5 w-5"
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
      <Button onClick={handleSave} className="w-full" disabled={!title || assignees.length === 0 || !weight}>
        {initialChore ? 'Update Chore' : 'Save Chore'}
      </Button>
    </div>
  );
}

export default DetailedChoreForm;