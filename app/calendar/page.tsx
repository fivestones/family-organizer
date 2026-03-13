'use client';

import React from 'react';
import Calendar from '@/components/Calendar';

export default function CalendarPage() {
    return (
        <div className="h-full min-h-0">
            <Calendar currentDate={new Date()} numWeeks={10} displayBS={true} className="h-full min-h-0" />
        </div>
    );
}
