'use client';

import { init, tx, id } from '@instantdb/react';
import Image from 'next/image';
import React, { useState, useEffect } from 'react';
import Calendar from '../components/Calendar';
import AddEventForm from '../components/AddEvent';
import FamilyChoreTracker from '@/components/ChoresTracker';

const APP_ID = 'df733414-7ccd-45bd-85f3-ffd0b3da8812'; //kepler.local
const db = init({
    appId: APP_ID,
    apiURI: 'http://localhost:8888',
    websocketURI: 'ws://localhost:8888/runtime/session',
});

function App() {
    return (
        <div>
            {/* Use the Calendar component */}
            <Calendar currentDate={new Date()} numWeeks={10} displayBS={true} />

            <FamilyChoreTracker />
        </div>
    );
}

type calendarItem = {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    description: string;
    location: string;
    attendees: string;
};

export default App;
