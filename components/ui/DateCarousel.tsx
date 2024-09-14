import React, { useState, useEffect } from 'react';
import { format, addDays, subDays } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

const DateCarousel = ({ onDateSelect, initialDate }) => {
  const [selectedDate, setSelectedDate] = useState(() => {
    const date = initialDate || new Date();
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  });
  const [dateRange, setDateRange] = useState([]);

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

  const handleDateClick = (date) => {
    const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    setSelectedDate(utcDate);
    onDateSelect(utcDate);
  };

  const handleNavigate = (direction) => {
    const newDate = direction === 'prev' ? subDays(selectedDate, 1) : addDays(selectedDate, 1);
    const utcNewDate = new Date(Date.UTC(newDate.getUTCFullYear(), newDate.getUTCMonth(), newDate.getUTCDate()));
    setSelectedDate(utcNewDate);
    onDateSelect(utcNewDate);
  };

  return (
    <div className="flex items-center justify-center space-x-2 p-4">
      <Button variant="outline" size="icon" onClick={() => handleNavigate('prev')}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <div className="flex space-x-2 overflow-x-auto">
        {dateRange.map((date, index) => {
          const isSelected = date.getTime() === selectedDate.getTime();
          const isToday = date.toDateString() === new Date().toDateString();
          return (
            <div
              key={date.toISOString()}
              className={`flex flex-col items-center justify-center w-20 h-24 rounded-lg cursor-pointer transition-all duration-200 ${
                isSelected
                  ? 'bg-primary text-primary-foreground shadow-lg transform scale-105'
                  : 'bg-background hover:bg-secondary'
              } ${index === 3 ? 'border-b-8 border-primary' : ''}`}
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