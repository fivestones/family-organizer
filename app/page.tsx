'use client'

import { init, tx, id } from '@instantdb/react'
import Image from "next/image";
import React, { useState, useEffect } from 'react';
import Calendar from '../components/Calendar';
import AddEventForm from '../components/AddEvent';
import FamilyChoreTracker from '@/components/ChoresTracker';

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4' //kepler.local
const db = init({
  appId: APP_ID,
  apiURI: "http://localhost:8888",
  websocketURI: "ws://localhost:8888/runtime/session",
});


function App() {
 
  return (
    <div>
      {/* Use the Calendar component */}
      <Calendar currentDate={new Date()} numWeeks={10} displayBS={true}/>

      <FamilyChoreTracker />
    </div>
  )
}

type calendarItem = {
  id: string
  title: string
  startDate: string
  endDate: string
  description: string
  location: string
  attendees: string
}


export default App