import React, { useState, useEffect } from 'react';
import { addDays, subDays } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DateCarouselProps {
    onDateSelect: (date: Date) => void;
    initialDate?: Date; // Mark initialDate as optional
}

const DateCarousel: React.FC<DateCarouselProps> = ({ onDateSelect, initialDate }) => {
    const [selectedDate, setSelectedDate] = useState<Date>(() => {
        const date = initialDate || new Date(); // initialDate is already UTC, new Date() is local
        if (initialDate) {
            return initialDate; // It's already the UTC date we want
        }
        // If initialDate wasn't provided, create UTC midnight for "today"
        return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    });

    const [dateRange, setDateRange] = useState<Date[]>([]);

    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    useEffect(() => {
        const generateDateRange = () => {
            const range = [];
            for (let i = -4; i <= 4; i++) {
                range.push(addDays(selectedDate, i));
            }
            setDateRange(range);
        };

        generateDateRange();
    }, [selectedDate]);

    const handleDateClick = (date: Date) => {
        // date is already normalized (UTC midnight in your scheme),
        // so just use it as-is.
        setSelectedDate(date);
        onDateSelect(date);
    };

    const handleNavigate = (direction: 'prev' | 'next') => {
        const newDate = direction === 'prev' ? subDays(selectedDate, 1) : addDays(selectedDate, 1);
        setSelectedDate(newDate);
        onDateSelect(newDate);
    };
    return (
        <div className="flex items-center justify-center space-x-2 p-4">
            <Button variant="outline" size="icon" onClick={() => handleNavigate('prev')}>
                <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex space-x-2 overflow-x-auto">
                {dateRange.map((date) => {
                    const isSelected = date.getTime() === selectedDate.getTime();
                    // Fix: UTC-aware check for "today"
                    const today = new Date();

                    const todayKey = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())).getTime();

                    const isToday = date.getTime() === todayKey;
                    return (
                        <div
                            key={date.toISOString()}
                            className={`flex flex-col items-center justify-center w-20 h-24 rounded-lg cursor-pointer transition-all duration-200 ${
                                isSelected ? 'bg-primary text-primary-foreground shadow-lg transform scale-105' : 'bg-background hover:bg-secondary'
                            }`}
                            onClick={() => handleDateClick(date)}
                        >
                            <div className={`text-sm ${isToday ? 'interBold' : ''}`}>{daysOfWeek[date.getUTCDay()]}</div>
                            <div className={`text-2xl ${isToday ? 'interBold' : ''}`}>{date.getUTCDate()}</div>
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
