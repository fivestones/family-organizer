import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import RecurrenceRuleForm from './RecurrenceRuleForm';
import { RRule, Frequency } from 'rrule';

function DetailedChoreForm({ familyMembers, onSave }) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [recurrenceOptions, setRecurrenceOptions] = useState<({ freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>>) | null>(null);

  const handleSave = () => {
    let finalRrule = null;
    if (recurrenceOptions) {
      // Create a Date object with only year, month, and day
      // This effectively creates a "floating" time zone date
      const dtstart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      
      // Combine the recurrence options with the start date
      const fullOptions: RRule.Options = {
        ...recurrenceOptions,
        dtstart: dtstart
      };

      // Create the RRule
      const rrule = new RRule(fullOptions);

      // Convert the RRule to a string, but remove the DTSTART part
      finalRrule = rrule.toString().replace(/DTSTART:[^;T]*;?/, '');

      // Prepend RRULE: to the string if it's not already there
      if (!finalRrule.startsWith('RRULE:')) {
        finalRrule = 'RRULE:' + finalRrule;
      }
    }

    onSave({
      title,
      assignees: [{ id: assignee }],
      description,
      startDate: startDate.toISOString().split('T')[0], // Store only the date part
      rrule: finalRrule,
    });
  };

  return (
    <div className="space-y-4">
      <Input
        placeholder="Chore title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      
      <Select value={assignee} onValueChange={setAssignee}>
        <SelectTrigger>
          <SelectValue placeholder="Select assignee" />
        </SelectTrigger>
        <SelectContent>
          {familyMembers.map(member => (
            <SelectItem key={member.id} value={member.id}>{member.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      
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
      
      <RecurrenceRuleForm onSave={setRecurrenceOptions} />
      
      <Button onClick={handleSave}>Save Chore</Button>
    </div>
  );
}

export default DetailedChoreForm;