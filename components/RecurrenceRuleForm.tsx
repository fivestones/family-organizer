import React, { useState, useEffect } from 'react';
import { RRule, Frequency, Weekday } from 'rrule';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from "@/components/ui/button";


const daysOfWeek = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;
type DayOfWeek = typeof daysOfWeek[number];

type FrequencyType = 'once' | 'daily' | 'weekly' | 'monthly';

interface RecurrenceRuleFormProps {
  onSave: (rule: { freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>> | null) => void;
  initialOptions?: { freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>>;
}

const frequencyMap: Record<FrequencyType, Frequency> = {
  once: Frequency.DAILY,
  daily: Frequency.DAILY,
  weekly: Frequency.WEEKLY,
  monthly: Frequency.MONTHLY,
};

const freqMapReverse = {
  [Frequency.DAILY]: 'daily',
  [Frequency.WEEKLY]: 'weekly',
  [Frequency.MONTHLY]: 'monthly',
};

const RecurrenceRuleForm: React.FC<RecurrenceRuleFormProps> = ({ onSave, initialOptions }) => {
  // Initialize state using useState initializers
  const [frequency, setFrequency] = useState<FrequencyType>(() => {
    return initialOptions?.freq !== undefined // Default to 'daily' for new chores, otherwise show once, daily, weekly, or monthly as per initialOptions of pre-exisiting chore
      ? freqMapReverse[initialOptions.freq] || 'once'
      : 'once'; 
  });

  const [interval, setInterval] = useState(() => initialOptions?.interval || 1);

  const [weeklyDays, setWeeklyDays] = useState<DayOfWeek[]>(() => {
    if (initialOptions?.byweekday) {
      const weekdays = Array.isArray(initialOptions.byweekday)
        ? initialOptions.byweekday
        : [initialOptions.byweekday];
      return weekdays
        .map((weekday) => {
          if (typeof weekday === 'number') {
            const dayCodes: DayOfWeek[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
            return dayCodes[weekday];
          } else if (weekday instanceof Weekday) {
            return weekday.toString().slice(0, 2).toUpperCase() as DayOfWeek;
          } else {
            console.warn('Unexpected type in byweekday:', weekday);
            return null;
          }
        })
        .filter(Boolean) as DayOfWeek[];
    }
    return [];
  });

  const [monthlyDays, setMonthlyDays] = useState<number[]>(() => {
    if (initialOptions?.bymonthday) {
      return Array.isArray(initialOptions.bymonthday)
        ? initialOptions.bymonthday
        : [initialOptions.bymonthday];
    }
    return [];
  });

  // Remove the useEffect that resets state when initialOptions change
  // This prevents the component from resetting during user interaction

  useEffect(() => {
    handleSave();
  }, [frequency, interval, weeklyDays, monthlyDays]);

  // Handle saving the recurrence rule
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
      rruleOptions.byweekday = weeklyDays.map(
        (day) => RRule[day as keyof typeof RRule] as Weekday
      );
    }

    if (frequency === 'monthly' && monthlyDays.length > 0) {
      rruleOptions.bymonthday = monthlyDays;
    }

    onSave(rruleOptions);
  };

  // Remove handleSave calls from state update functions
  const handleFrequencyChange = (value: FrequencyType) => {
    setFrequency(value);
    // handleSave(); // Optionally, call handleSave here if you want to update on change
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInterval(parseInt(e.target.value) || 1);
    // handleSave(); // Optionally, call handleSave here if you want to update on change
  };

  const handleWeeklyDayToggle = (day: DayOfWeek) => {
    setWeeklyDays((prev) => {
      const newDays = prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
      return newDays;
    });
    // handleSave(); // Optionally, call handleSave here if you want to update on change
  };

  const handleMonthlyDayToggle = (day: number) => {
    setMonthlyDays((prev) => {
      const newDays = prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day];
      return newDays;
    });
    // handleSave(); // Optionally, call handleSave here if you want to update on change
  };

  return (
    <div className="space-y-4">
      <RadioGroup value={frequency} onValueChange={handleFrequencyChange}>
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
            onChange={handleIntervalChange}
            className="w-16"
            min={1}
          />
          <span>
            {frequency === 'daily'
              ? 'day(s)'
              : frequency === 'weekly'
              ? 'week(s)'
              : 'month(s)'}
          </span>
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
                <Label htmlFor={`monthly-${day}`} className="ml-1">
                  {day}
                </Label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Optionally, you can add a Save button if you prefer manual saving */}
      {/* <Button onClick={handleSave}>Save Recurrence Rule</Button> */}
    </div>
  );
};

export default RecurrenceRuleForm;