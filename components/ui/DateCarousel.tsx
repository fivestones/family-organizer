import React, { useState, useEffect } from 'react';
import { format, addDays, subDays } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DateCarouselProps {
  onDateSelect: (date: Date) => void;
  initialDate?: Date; // Mark initialDate as optional
}

const DateCarousel: React.FC<DateCarouselProps> = ({ onDateSelect, initialDate }) => {
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    const date = initialDate || new Date();
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  });

  const [dateRange, setDateRange] = useState<Date[]>([]);

  useEffect(() => {
    const generateDateRange = () => {
      const range = [];
      for (let i = -3; i <= 3; i++) {
        range.push(addDays(selectedDate, i));
      }
      setDateRange(range);
    };

    generateDateRange();
  }, [selectedDate]);

  const handleDateClick = (date: Date) => {
    const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    setSelectedDate(utcDate);
    onDateSelect(utcDate);
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    const newDate = direction === 'prev' ? subDays(selectedDate, 1) : addDays(selectedDate, 1);
    const utcNewDate = new Date(Date.UTC(newDate.getFullYear(), newDate.getMonth(), newDate.getDate()));
    setSelectedDate(utcNewDate);
    onDateSelect(utcNewDate);
  };

  return (
    <div className="flex items-center justify-center space-x-2 p-4">
      <Button variant="outline" size="icon" onClick={() => handleNavigate('prev')}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex space-x-2 overflow-x-auto">
        {dateRange.map((date) => {
          const isSelected = date.getTime() === selectedDate.getTime();
          const isToday = date.toDateString() === new Date().toDateString();
          return (
            <div
              key={date.toISOString()}
              className={`flex flex-col items-center justify-center w-20 h-24 rounded-lg cursor-pointer transition-all duration-200 ${
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-lg transform scale-105'
                  : 'bg-background hover:bg-secondary'
              }`}
              onClick={() => handleDateClick(date)}
            >
              <div className={`text-sm ${isToday ? 'font-bold' : ''}`}>
                {format(date, 'EEE')}
              </div>
              <div className={`text-2xl ${isToday ? 'font-bold' : ''}`}>
                {format(date, 'd')}
              </div>
            </div>
          );
        })}
      </div>
      <Button variant="outline" size="icon" onClick={() => handleNavigate('next')}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default DateCarousel;