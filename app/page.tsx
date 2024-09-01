'use client'

import { init, tx, id } from '@instantdb/react'
import Image from "next/image";
import React, { useState, useEffect } from 'react';
import Calendar from '../components/Calendar';
import AddEventForm from '../components/AddEvent';

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4' //kepler.local
const db = init({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});


function App() {
 
  return (
    <div>
      {/* <div style={styles.header}>Family Calendar</div> */}
      {/* Use the Calendar component */}
      <Calendar currentDate={new Date()} numWeeks={10} displayBS={false}/>
      <div>Calendar Items</div>
      {/* Initialization Button */}
      {/* <button onClick={initializeCalendarItems}>
        Initialize Calendar Items
      </button> */}
    </div>
  )
}

function initializeCalendarItems() {
  // db.transact([
  //   // Hadassah's Special Time
  //   tx.calendarItems[id()].update({
  //     title: "Hadassah's Really very Special Time",
  //     startDate: '2024-08-28T00:00:00Z', // Assuming full-day event
  //     endDate: '2024-08-28T23:59:59Z',
  //     description: "Hadassah's very Special Time",
  //   }),

  //   // Judah's Birthday Party
  //   tx.calendarItems[id()].update({
  //     title: "Judah's Birthday Party",
  //     startDate: '2024-09-16T10:15:00Z', // Kathmandu is UTC+5:45, hence 4 PM local is 10:15 AM UTC
  //     endDate: '2024-09-16T11:15:00Z',
  //     description: "Judah's Birthday Party",
  //   }),

  //   // Sabbath
  //   tx.calendarItems[id()].update({
  //     title: "Sabbath",
  //     startDate: "2024-08-30T19:00:00", // Local time, no time zone offset
  //     endDate: "2024-08-31T19:00:00",
  //     description: "Sabbath",
  //   }),
  // ])

  db.transact([
    // Hadassah's Special Time
    tx.calendarItems[id()].update({
      title: "Does this work?",
      description: "trying to insert a number",
      numeral: 5,
    }),
  ])
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