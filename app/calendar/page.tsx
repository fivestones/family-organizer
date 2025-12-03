'use client';

import React from 'react';
import Calendar from '@/components/Calendar';

export default function CalendarPage() {
    return (
        <div>
            {/* Use the Calendar component */}
            <Calendar currentDate={new Date()} numWeeks={10} displayBS={true} />
        </div>
    );
}
