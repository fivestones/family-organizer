import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import RecurrenceRuleForm from './RecurrenceRuleForm';
import ChoreCalendarView from './ChoreCalendarView';
import { RRule, Frequency } from 'rrule';
import { Switch } from '@/components/ui/switch';
import { ChevronUp, ChevronDown } from 'lucide-react';

function DetailedChoreForm({ familyMembers, onSave, initialDate }) {
  const [title, setTitle] = useState('');
  const [assignees, setAssignees] = useState<string[]>([]); // Array of selected family member IDs
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<Date>(initialDate || new Date());
  const [recurrenceOptions, setRecurrenceOptions] = useState<({ freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>>) | null>(null);
  const [rotationType, setRotationType] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [rotationOrder, setRotationOrder] = useState<string[]>([]);
  const [useRotation, setUseRotation] = useState(false);

  useEffect(() => {
    if (useRotation) {
      setRotationOrder(assignees);
    }
  }, [assignees, useRotation]);

  const handleAssigneeToggle = (memberId: string) => {
    setAssignees(prev =>
      prev.includes(memberId)
        ? prev.filter(id => id !== memberId)
        : [...prev, memberId]
    );
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
      const rrule = new RRule({
        ...recurrenceOptions,
        dtstart: null, // Exclude dtstart to prevent duplication
      });
      finalRrule = rrule.toString();
      if (!finalRrule.startsWith('RRULE:')) {
        finalRrule = 'RRULE:' + finalRrule;
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
    <div className="space-y-4">
      <Input
        placeholder="Chore title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <Textarea
        placeholder="Chore description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="flex items-center space-x-2">
        <Label htmlFor="startDate">Start Date</Label>
        <Input
          id="startDate"
          type="date"
          value={startDate.toISOString().split('T')[0]}
          onChange={(e) => setStartDate(new Date(e.target.value))}
        />
      </div>

      {/* Family Members Selection */}
      <div>
        <Label>Select Assignees:</Label>
        <div className="flex flex-wrap">
          {familyMembers.map(member => {
            const isSelected = assignees.includes(member.id);
            return (
              <button
                key={member.id}
                onClick={() => handleAssigneeToggle(member.id)}
                className={`m-1 px-2 py-1 rounded ${
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
            <>
              <div>
                <Label>Rotation Frequency:</Label>
                <div className="flex items-center space-x-4">
                  <div className="flex items-center">
                    <input
                      type="radio"
                      id="rotate-daily"
                      name="rotationFrequency"
                      value="daily"
                      checked={rotationType === 'daily'}
                      onChange={() => setRotationType('daily')}
                    />
                    <Label htmlFor="rotate-daily" className="ml-2">
                      Rotate Each Scheduled Day
                    </Label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="radio"
                      id="rotate-weekly"
                      name="rotationFrequency"
                      value="weekly"
                      checked={rotationType === 'weekly'}
                      onChange={() => setRotationType('weekly')}
                    />
                    <Label htmlFor="rotate-weekly" className="ml-2">
                      Rotate Weekly
                    </Label>
                  </div>
                  <div className="flex items-center">
                    <input
                      type="radio"
                      id="rotate-monthly"
                      name="rotationFrequency"
                      value="monthly"
                      checked={rotationType === 'monthly'}
                      onChange={() => setRotationType('monthly')}
                    />
                    <Label htmlFor="rotate-monthly" className="ml-2">
                      Rotate Monthly
                    </Label>
                  </div>
                </div>
              </div>

              {/* Rotation Order */}
              <div>
                <Label>Rotation Order:</Label>
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
            </>
          )}
        </div>
      )}

      <RecurrenceRuleForm onSave={setRecurrenceOptions} />

      {/* Chore Calendar Preview */}
      {assignees.length > 0 && recurrenceOptions && (
        <div>
          <Label>Assignment Preview:</Label>
          <ChoreCalendarView
            chore={{
              id: 'temp-id', // Temporary ID for preview purposes
              title,
              description,
              startDate: startDate.toISOString(),
              rrule: new RRule({
                ...recurrenceOptions,
                dtstart: startDate,
              }).toString(),
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
      )}

      <Button onClick={handleSave}>Save Chore</Button>
    </div>
  );
}

export default DetailedChoreForm;