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

function DetailedChoreForm({ familyMembers, onSave, initialChore = null, initialDate }) {
  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<Date>(toUTCDate(initialDate || new Date()));
  const [rotationType, setRotationType] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [rotationOrder, setRotationOrder] = useState<string[]>([]);
  const [useRotation, setUseRotation] = useState(false);

  // Initialize recurrenceOptions and initialRecurrenceOptions
  const [recurrenceOptions, setRecurrenceOptions] = useState<({ freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>>) | null>(null);

  const [initialRecurrenceOptions] = useState<({ freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>>) | null>(() => {
    if (initialChore && initialChore.rrule) {
      try {
        const options = RRule.parseString(initialChore.rrule);
        const rrule = new RRule(options);
        return rrule.options;
      } catch (error) {
        console.error('Error parsing RRule:', error);
        return null;
      }
    } else {
      // Default to daily recurrence when creating a new chore
      return { freq: Frequency.DAILY, interval: 1 };
    }
  });

  useEffect(() => {
    if (initialChore) {
      setTitle(initialChore.title);
      setDescription(initialChore.description || '');
      setStartDate(toUTCDate(new Date(initialChore.startDate)));

      // Set the initial recurrence options
      if (initialChore.rrule) {
        try {
          const options = RRule.parseString(initialChore.rrule);
          const rrule = new RRule(options);
          setRecurrenceOptions(rrule.options);
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
      }
    } else {
      // For new chores, set the default recurrence options
      setRecurrenceOptions(initialRecurrenceOptions);
    }
  }, [initialChore, initialRecurrenceOptions]);


  useEffect(() => {
    if (useRotation && assignees.length > 0) {
      setRotationOrder(assignees);
      setRotationType('daily');
    } else if (!useRotation) {
      setRotationType('none');
    }
    // We're not setting rotationOrder to an empty array if assignees is empty
  }, [assignees, useRotation]);

  useEffect(() => {
    console.log("Current state:", { 
      title, 
      assignees,
      description, 
      startDate, 
      recurrenceOptions, 
      rotationType, 
      rotationOrder, 
      useRotation 
    });
  });

  const handleAssigneeToggle = (memberId: string) => {
    if (useRotation) {
      setRotationOrder(prev =>
        prev.includes(memberId)
          ? prev.filter(id => id !== memberId)
          : [...prev, memberId]
      );
      setAssignees(prev =>
        prev.includes(memberId)
          ? prev.filter(id => id !== memberId)
          : [...prev, memberId]
      );
    } else {
      setAssignees(prev =>
        prev.includes(memberId)
          ? prev.filter(id => id !== memberId)
          : [...prev, memberId]
      );
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
        const rrule = new RRule({
          ...recurrenceOptions,
          dtstart: null,
        });
        finalRrule = rrule.toString();
        if (!finalRrule.startsWith('RRULE:')) {
          finalRrule = 'RRULE:' + finalRrule;
        }
      } catch (error) {
        console.error("Error creating RRule:", error);
        // Handle the error, perhaps by showing a message to the user
        return;
      }
    }

    onSave({
      title,
      assignees: assignees.map(id => ({ id })),
      description,
      startDate: startDate.toISOString(),
      rrule: finalRrule,
      rotationType: useRotation ? rotationType : 'none',
      assignments: useRotation
        ? rotationOrder.map((memberId, index) => ({
            order: index,
            familyMember: familyMembers.find(member => member.id === memberId),
          }))
        : null,
    });
  };

  return (
    <div className="space-y-4 w-full max-w-md mx-auto">
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          placeholder="Chore title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          placeholder="Chore description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="startDate">Start Date</Label>
        <Input
          id="startDate"
          type="date"
          value={startDate.toISOString().split('T')[0]}
          onChange={(e) => setStartDate(new Date(e.target.value))}
        />
      </div>

      {/* Family Members Selection */}
      <div className="space-y-2">
        <Label>Select Assignees:</Label>
        <div className="flex flex-wrap gap-2">
          {familyMembers.map(member => {
            const isSelected = assignees.includes(member.id);
            return (
              <button
                key={member.id}
                onClick={() => handleAssigneeToggle(member.id)}
                className={`px-2 py-1 rounded ${
                  isSelected ? 'bg-blue-500 text-white' : 'bg-gray-200'
                }`}
              >
                {member.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Rotation Options */}
      {assignees.length > 1 && (
        <div className="space-y-2">
          <div className="flex items-center space-x-2">
            <Switch
              id="useRotation"
              checked={useRotation}
              onCheckedChange={setUseRotation}
            />
            <Label htmlFor="useRotation">Rotate between assignees</Label>
          </div>

          {useRotation && (
            <div className="mt-4 p-4 border rounded-md bg-gray-50">
              <Label className="mb-2 block font-semibold">Rotation Frequency:</Label>
              <RadioGroup value={rotationType} onValueChange={(value: 'daily' | 'weekly' | 'monthly') => setRotationType(value)}>
                <div className="space-y-2">
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
                </div>
              </RadioGroup>

              <div className="mt-4">
                <Label className="mb-2 block">Rotation Order:</Label>
                <div className="space-y-1">
                  {rotationOrder.map((memberId, index) => {
                    const member = familyMembers.find(m => m.id === memberId);
                    return (
                      <div key={memberId} className="flex items-center">
                        <span className="flex-grow">{member?.name}</span>
                        <div className="flex flex-col">
                          <button
                            onClick={() => moveAssigneeUp(index)}
                            disabled={index === 0}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => moveAssigneeDown(index)}
                            disabled={index === rotationOrder.length - 1}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <RecurrenceRuleForm
        onSave={(options) => {
          console.log("Received options from RecurrenceRuleForm:", options);
          setRecurrenceOptions(options);
        }}
        initialOptions={initialRecurrenceOptions}
      />

      {/* Chore Calendar Preview */}
      {(assignees.length > 0 || (useRotation && rotationOrder.length > 0)) && recurrenceOptions && (
        <div className="space-y-2">
          <Label className="block">Assignment Preview:</Label>
          <div className="border rounded-md overflow-x-auto max-w-full" style={{ maxHeight: '300px' }}>
            <ChoreCalendarView
              chore={{
                id: 'temp-id',
                title,
                description,
                startDate: startDate.toISOString(),
                rrule: (() => {
                  try {
                    return new RRule({
                      ...recurrenceOptions,
                      dtstart: startDate,
                    }).toString();
                  } catch (error) {
                    console.error("Error creating RRule for preview:", error);
                    return '';
                  }
                })(),
                rotationType: useRotation ? rotationType : 'none',
                assignments: useRotation
                  ? rotationOrder.map((memberId, index) => ({
                      order: index,
                      familyMember: familyMembers.find(m => m.id === memberId),
                    }))
                  : null,
                assignees: !useRotation
                  ? assignees.map(id => familyMembers.find(m => m.id === id))
                  : null,
              }}
            />
          </div>
        </div>
      )}

      <Button onClick={handleSave} className="w-full">
        {initialChore ? 'Update Chore' : 'Save Chore'}
      </Button>
    </div>
  );
}

export default DetailedChoreForm;