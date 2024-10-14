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
  initialOptions?: { freq: Frequency } & Partial<Omit<RRule.Options, 'freq'>>;
}

const frequencyMap: Record<FrequencyType, Frequency> = {
  once: Frequency.DAILY,
  daily: Frequency.DAILY,
  weekly: Frequency.WEEKLY,
  monthly: Frequency.MONTHLY,
};

const RecurrenceRuleForm: React.FC<RecurrenceRuleFormProps> = ({ onSave, initialOptions }) => {
  const [frequency, setFrequency] = useState<FrequencyType>(() => {
    if (initialOptions === undefined) return 'daily'; // New chore, default to 'daily'
    if (initialOptions === null) return 'once'; // Existing chore with no recurrence

    switch (initialOptions.freq) {
      case Frequency.DAILY:
        return 'daily';
      case Frequency.WEEKLY:
        return 'weekly';
      case Frequency.MONTHLY:
        return 'monthly';
      default:
        return 'once';
    }
  });
  
  
  // Update when initialOptions change
  useEffect(() => {
    console.log("initialOptions changed: ", initialOptions);
    if (initialOptions === undefined) {
      setFrequency('daily');
    } else if (initialOptions === null) {
      setFrequency('once');
    } else {
      switch (initialOptions.freq) {
        case Frequency.DAILY:
          setFrequency('daily');
          break;
        case Frequency.WEEKLY:
          setFrequency('weekly');
          break;
        case Frequency.MONTHLY:
          setFrequency('monthly');
          break;
        default:
          setFrequency('once');
      }
      setInterval(initialOptions.interval || 1);

      if (initialOptions.byweekday) {
        const weekdays = Array.isArray(initialOptions.byweekday)
          ? initialOptions.byweekday
          : [initialOptions.byweekday];
        const days = weekdays.map(weekday => weekday.toString().slice(0,2).toUpperCase() as DayOfWeek);
        console.log("initialOptions.byweekday is True, and we are about to setWeeklyDays. days: ", days);
        setWeeklyDays(days);
      }

      if (initialOptions.bymonthday) {
        const monthdays = Array.isArray(initialOptions.bymonthday)
          ? initialOptions.bymonthday
          : [initialOptions.bymonthday];
        setMonthlyDays(monthdays);
      }
    }
  }, [initialOptions]);

  const [interval, setInterval] = useState(() => initialOptions?.interval || 1);

  const [weeklyDays, setWeeklyDays] = useState<DayOfWeek[]>(() => {
    if (initialOptions?.byweekday) {
      const weekdays = Array.isArray(initialOptions.byweekday)
        ? initialOptions.byweekday
        : [initialOptions.byweekday];
      return weekdays.map(weekday => {
        if (typeof weekday === 'number') {
          const dayCodes: DayOfWeek[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
          return dayCodes[weekday];
        } else if (weekday instanceof Weekday) {
          return weekday.toString().slice(0, 2).toUpperCase() as DayOfWeek;
        } else {
          console.warn('Unexpected type in byweekday:', weekday);
          return null;
        }
      }).filter(Boolean) as DayOfWeek[];
    }
    return [];
  });

  const [monthlyDays, setMonthlyDays] = useState<number[]>(() => {
    if (initialOptions?.bymonthday) {
      return Array.isArray(initialOptions.bymonthday) ? initialOptions.bymonthday : [initialOptions.bymonthday];
    }
    return [];
  });

  // Update when initialOptions change
  useEffect(() => {
    if (initialOptions) {
      // Similar initialization logic as above
      // Update state only if initialOptions have changed
    }
  }, [initialOptions]);

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

  const handleFrequencyChange = (value: FrequencyType) => {
    setFrequency(value);
    handleSave();
  };

  const handleIntervalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInterval(parseInt(e.target.value) || 1);
    handleSave();
  };

  const handleWeeklyDayToggle = (day: DayOfWeek) => {
    setWeeklyDays(prev => {
      const newDays = prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day];
      return newDays;
    });
    handleSave();
  };

  const handleMonthlyDayToggle = (day: number) => {
    setMonthlyDays(prev => {
      const newDays = prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day];
      return newDays;
    });
    handleSave();
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