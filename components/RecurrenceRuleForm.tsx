import React, { useState, useEffect } from 'react';
import { RRule, Frequency, Weekday } from 'rrule';
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

const daysOfWeek = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
type DayOfWeek = typeof daysOfWeek[number];

type FrequencyType = 'once' | 'daily' | 'weekly' | 'monthly';

interface RecurrenceRuleFormProps {
  onSave: (rule: { freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>> | null) => void;
}

const frequencyMap: Record<FrequencyType, Frequency> = {
  once: Frequency.DAILY,
  daily: Frequency.DAILY,
  weekly: Frequency.WEEKLY,
  monthly: Frequency.MONTHLY,
};

const RecurrenceRuleForm: React.FC<RecurrenceRuleFormProps> = ({ onSave }) => {
  const [frequency, setFrequency] = useState<FrequencyType>('daily');
  const [interval, setInterval] = useState(1);
  const [weeklyDays, setWeeklyDays] = useState<DayOfWeek[]>([]);
  const [monthlyDays, setMonthlyDays] = useState<number[]>([]);

  useEffect(() => {
    handleSave();
  }, [frequency, interval, weeklyDays, monthlyDays]);

  const handleSave = () => {
    if (frequency === 'once') {
      onSave(null);
      return;
    }

    const rruleOptions: { freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>> = {
      freq: frequencyMap[frequency],
      interval: interval,
    };

    if (frequency === 'weekly' && weeklyDays.length > 0) {
      rruleOptions.byweekday = weeklyDays.map(day => RRule[day as keyof typeof RRule] as Weekday);
    }

    if (frequency === 'monthly' && monthlyDays.length > 0) {
      rruleOptions.bymonthday = monthlyDays;
    }

    onSave(rruleOptions);
  };

  const handleWeeklyDayToggle = (day: DayOfWeek) => {
    setWeeklyDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const handleMonthlyDayToggle = (day: number) => {
    setMonthlyDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  return (
    <div className="space-y-4">
      <RadioGroup value={frequency} onValueChange={(value: FrequencyType) => setFrequency(value)}>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="once" id="once" />
          <Label htmlFor="once">Once</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="daily" id="daily" />
          <Label htmlFor="daily">Daily</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="weekly" id="weekly" />
          <Label htmlFor="weekly">Weekly</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="monthly" id="monthly" />
          <Label htmlFor="monthly">Monthly</Label>
        </div>
      </RadioGroup>

      {frequency !== 'once' && (
        <div className="flex items-center space-x-2">
          <Label htmlFor="interval">Every</Label>
          <Input
            id="interval"
            type="number"
            value={interval}
            onChange={(e) => setInterval(parseInt(e.target.value))}
            className="w-16"
            min={1}
          />
          <span>{frequency === 'daily' ? 'day(s)' : frequency === 'weekly' ? 'week(s)' : 'month(s)'}</span>
        </div>
      )}

      {frequency === 'weekly' && (
        <div className="space-y-2">
          <Label>Repeat on:</Label>
          <div className="flex space-x-2">
            {daysOfWeek.map((day) => (
              <div key={day} className="flex flex-col items-center">
                <Checkbox
                  id={`weekly-${day}`}
                  checked={weeklyDays.includes(day)}
                  onCheckedChange={() => handleWeeklyDayToggle(day)}
                />
                <Label htmlFor={`weekly-${day}`}>{day}</Label>
              </div>
            ))}
          </div>
        </div>
      )}

      {frequency === 'monthly' && (
        <div className="space-y-2">
          <Label>Repeat on day:</Label>
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
              <div key={day} className="flex items-center justify-center">
                <Checkbox
                  id={`monthly-${day}`}
                  checked={monthlyDays.includes(day)}
                  onCheckedChange={() => handleMonthlyDayToggle(day)}
                />
                <Label htmlFor={`monthly-${day}`} className="ml-1">{day}</Label>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RecurrenceRuleForm;