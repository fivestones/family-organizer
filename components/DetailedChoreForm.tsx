import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import RecurrenceRuleForm from './RecurrenceRuleForm';

function DetailedChoreForm({ familyMembers, onSave }) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [description, setDescription] = useState('');
  const [recurrenceRule, setRecurrenceRule] = useState(null);

  const handleSave = () => {
    onSave({
      title,
      assignees: [{ id: assignee }],
      description,
      rrule: recurrenceRule || null, // Remove JSON.stringify, ensure it's a string or null
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
      
      <RecurrenceRuleForm onSave={setRecurrenceRule} />
      
      <Button onClick={handleSave}>Save Chore</Button>
    </div>
  );
}

export default DetailedChoreForm;