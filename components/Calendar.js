// import Image from "next/image";
import React, { useState, useEffect } from 'react';
import styles from '../styles/Calendar.module.css';
import { format, addDays, startOfWeek, isSameMonth, getMonth, getDate, getYear } from 'date-fns';
import { init } from '@instantdb/react';

//Other things to add:
// thicker/bold line border between months
// Put the day in the corner

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4' //kepler.local
const db = init({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});


const Calendar = ({ currentDate = new Date(), numWeeks = 5 }) => {
  const [calendarItems, setCalendarItems] = useState([]);
  
  // Calculate the start date of the calendar
  const startDate = startOfWeek(currentDate, { weekStartsOn: 0 }); // Sunday start

  // Generate an array of dates to cover the specified number of weeks
  const totalDays = numWeeks * 7;
  const days = [];
  let day = startDate;
  for (let i = 0; i < totalDays; i++) {
    days.push(day);
    day = addDays(day, 1);
  }

  const endDate = days[days.length - 1];

  // Determine years and months spanned by the calendar
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  const startMonth = startDate.getMonth() + 1; // +1 because months are 0-indexed
  const endMonth = endDate.getMonth() + 1;

  // Create an array of months in the range
  const months = [];
  for (let month = startMonth; month <= endMonth; month++) {
    months.push({ month });
  }

  // Create an array of years in the range
  const years = [];
  for (let year = startYear; year <= endYear; year++) {
    years.push(year);
  }

  // Build the query for the date range
  const query = {
    calendarItems: {
    $: {
        where: {
            year: { in: years },
            or: months,
        },
    },
    },
  };

  // show the built query in the console
//   console.log(JSON.stringify(query, null, 2)); // I like this one better. It is all visible as text instead of having to open up sections like the line below
//   console.dir(query, { depth: null, colors: true });

  // Fetch data using the query
  var { isLoading, error, data } = db.useQuery( query );
  
  
  useEffect(() => {
    if (!isLoading && !error) {
        setCalendarItems(data.calendarItems);
    }  
  }, [isLoading, data]);

  // Days of the week headers
  const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Chunk days into weeks for table rows
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  let lastMonth = null; // To keep track of the last displayed month
  let isYearSet = false; // Flag to check if the year has been displayed

  return (
    <table className={styles.calendarTable}>
      <thead>
        <tr>
          {daysOfWeek.map((day, index) => (
            <th key={index} className={styles.headerCell}>{day}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week, weekIndex) => (
          <tr key={weekIndex}>
            {week.map((day, dayIndex) => {
              const currentMonth = format(day, 'MMMM');
              const isFirstDayOfMonth = getDate(day) === 1; // Check if it's the first day of the month
              const isFirstDayOfYear = getDate(day) === 1 && getMonth(day) === 0; // Check if it's the first day of the year
              const year = format(day, 'yyyy'); // Get the year in YYYY format

              // Determine if we should display the year in this cell
              const shouldDisplayYear = (!isYearSet && dayIndex === 0 && weekIndex === 0 || isFirstDayOfYear);
              if (shouldDisplayYear) {
                isYearSet = true; // Set the flag to true after displaying the year
              }

              // Determine if we should display the month in this cell
              const displayMonthName = !lastMonth || getMonth(day) !== getMonth(lastMonth);
              if (displayMonthName) {
                lastMonth = day; // Update lastMonth
              }

              // Filter events for the current day
              const dayItems = calendarItems.filter(item =>
                format(new Date(item.startDate), 'yyyy-MM-dd') === format(day, 'yyyy-MM-dd')
              );

              return (
                <td key={dayIndex} className={`${styles.dayCell} ${isFirstDayOfYear ? styles.firstDayOfYear : ''} ${isFirstDayOfMonth ? styles.firstDayOfMonth : ''}`}>
                  {shouldDisplayYear && (
                    <div className={styles.yearNumber}>
                      {year}
                    </div>
                  )}
                  {displayMonthName && (
                    <div className={styles.monthName}>
                      {currentMonth}
                    </div>
                  )}
                  <div className={styles.dayNumber}>{format(day, 'd')}</div>
                  {dayItems.map(item => (
                    <div key={item.id} className={`${styles.calendarItem} ${styles.event} ${styles.circled}`}>
                      {item.title}
                    </div>
                  ))}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default Calendar;