import React, { useState, useEffect } from 'react';
import styles from '../styles/Calendar.module.css';
import { format, addDays, startOfWeek, getMonth, getDate, parseISO, addWeeks, differenceInDays } from 'date-fns';
import { init, tx } from '@instantdb/react';
import NepaliDate from 'nepali-date-converter';
import AddEventForm from './AddEvent';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import localFont from 'next/font/local';

const APP_ID = 'df733414-7ccd-45bd-85f3-ffd0b3da8812'; //kepler.local
const db = init({
    appId: APP_ID,
    apiURI: 'http://localhost:8888',
    websocketURI: 'ws://localhost:8888/runtime/session',
});

const ebGaramond = localFont({
    src: '../public/fonts/EBGaramond-Regular.ttf',
    weight: '400',
    display: 'swap',
});

const Calendar = ({ currentDate = new Date(), numWeeks = 5, displayBS = true }) => {
    // TODO: add displayInNepali = false, displayInRoman = true, can both be true and it will show them both
    // add displayOfficialNepaliMonthNames = false, when false will give the short month names everybody uses
    // and displayMonthNumber = false, to display the month number as well as the name.
    const [calendarItems, setCalendarItems] = useState([]);
    const [selectedDate, setSelectedDate] = useState(null);
    const [selectedEvent, setSelectedEvent] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

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

    // Create an array for the query conditions
    const conditions = [];

    // Handle the start year
    if (startYear === endYear) {
        // If start and end year are the same, only add relevant months
        const months = [];
        for (let month = startMonth; month <= endMonth; month++) {
            months.push(month);
        }
        conditions.push({ year: startYear, month: { in: months } });
    } else {
        // There parts of multiple years
        // Add months for the start year
        const startYearMonths = [];
        for (let month = startMonth; month <= 12; month++) {
            startYearMonths.push(month);
        }
        conditions.push({ year: startYear, month: { in: startYearMonths } });

        // Add full years in between
        for (let year = startYear + 1; year < endYear; year++) {
            conditions.push({ year: year });
        }

        // Add months for the end year
        const endYearMonths = [];
        for (let month = 1; month <= endMonth; month++) {
            endYearMonths.push(month);
        }
        conditions.push({ year: endYear, month: { in: endYearMonths } });
    }

    const handleDayClick = (day) => {
        setSelectedDate(day);
        setSelectedEvent(null);
        setIsModalOpen(true);
    };

    const handleEventClick = (e, calendarEvent) => {
        e.stopPropagation();
        setSelectedDate(parseISO(calendarEvent.startDate));
        setSelectedEvent(calendarEvent);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedDate(null);
        setSelectedEvent(null);
    };

    // Code to allow dragging items from one day to another
    const onDragEnd = (result) => {
        const { destination, source, draggableId } = result;

        if (!destination) {
            return;
        }

        if (destination.droppableId === source.droppableId && destination.index === source.index) {
            return;
        }

        const event = calendarItems.find((item) => item.id === draggableId);

        const sourceDate = parseISO(source.droppableId);
        const destinationDate = parseISO(destination.droppableId);
        const daysDifference = differenceInDays(destinationDate, sourceDate);

        let newStartDate, newEndDate;

        if (event.isAllDay) {
            newStartDate = format(addDays(parseISO(event.startDate), daysDifference), 'yyyy-MM-dd');
            newEndDate = format(addDays(parseISO(event.endDate), daysDifference), 'yyyy-MM-dd');
        } else {
            newStartDate = addDays(parseISO(event.startDate), daysDifference).toISOString();
            newEndDate = addDays(parseISO(event.endDate), daysDifference).toISOString();
        }

        const updatedItems = calendarItems.map((item) => (item.id === event.id ? { ...item, startDate: newStartDate, endDate: newEndDate } : item));
        setCalendarItems(updatedItems);

        db.transact([
            tx.calendarItems[event.id].update({
                startDate: newStartDate,
                endDate: newEndDate,
                year: destinationDate.getFullYear(),
                month: destinationDate.getMonth() + 1,
                dayOfMonth: destinationDate.getDate(),
            }),
        ]);
    };

    // Build the query for the date range
    const query = {
        calendarItems: {
            $: {
                where: {
                    or: conditions,
                },
            },
        },
    };

    // show the built query in the console
    //  console.log(JSON.stringify(query, null, 2)); // I like this one better. It is all visible as text instead of having to open up sections like the line below
    //   console.dir(query, { depth: null, colors: true });

    // Fetch data using the query
    //   var { isLoading, error, data } = db.useQuery( query );
    var { isLoading, error, data } = db.useQuery(query);

    useEffect(() => {
        if (!isLoading && !error) {
            setCalendarItems(data.calendarItems);
        }
    }, [isLoading, data]);

    // console.log(calendarItems);

    // Convert Gregorian date to Nepali date
    const toNepaliDate = (date) => {
        const nepaliDate = new NepaliDate(date);
        return {
            year: nepaliDate.getYear(),
            month: nepaliDate.getMonth() + 1, // +1 because NepaliDate months are 0-indexed
            day: nepaliDate.getDate(),
        };
    };

    // Nepali month names
    const nepaliMonthsFormalRoman = ['Baisakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];

    const nepaliMonthsFormalDevanagari = [
        'वैशाख',
        'ज्येष्ठ',
        'आषाढ़',
        'श्रावण',
        'भाद्रपद',
        'आश्विन',
        'कार्तिक',
        'मार्गशीर्ष',
        'पौष',
        'माघ',
        'फाल्गुण',
        'चैत्र',
    ];

    const nepaliMonthsCommonRoman = ['Baisakh', 'Jeth', 'Asar', 'Saun', 'Bhadau', 'Asoj', 'Kattik', 'Mangsir', 'Poush', 'Magh', 'Phagun', 'Chait'];

    const nepaliMonthsCommonDevanagari = ['वैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज', 'कात्तिक', 'मंसिर', 'पुष', 'माघ', 'फागुन', 'चैत'];

    // Days of the week headers
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Chunk days into weeks for table rows
    const weeks = [];
    for (let i = 0; i < days.length; i += 7) {
        weeks.push(days.slice(i, i + 7));
    }

    let lastMonth = null; // To keep track of the last displayed month
    let lastNepaliMonth = null; // To keep track of the last displayed Nepali month
    let isYearSet = false; // Flag to check if the year has been displayed
    let isNepaliYearSet = false; // Flag to check if the Nepali year has been displayed
    let displayNepaliMonthName = false; //set to false, since we don't usually want to display it for any given day. We'll set it to true for days where it is the first day of the Nepali month
    let shouldDisplayBothYears = false;
    let shouldDisplayYear = false;
    let shouldDisplayNepaliYear = true;

    return (
        <DragDropContext onDragEnd={onDragEnd}>
            <table className={styles.calendarTable}>
                <thead className={ebGaramond.className}>
                    <tr>
                        {daysOfWeek.map((day, index) => (
                            <th key={index} className={styles.headerCell}>
                                {day}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {weeks.map((week, weekIndex) => (
                        <tr key={weekIndex}>
                            {week.map((day, dayIndex) => {
                                const nepaliDate = new NepaliDate(day);
                                const currentMonth = format(day, 'MMMM');
                                const currentNepaliMonth = nepaliMonthsFormalRoman[nepaliDate.getMonth()];
                                const isFirstDayOfMonth = getDate(day) === 1; // Check if it's the first day of the month
                                const isFirstWeekOfMonthButNotFirstDay =
                                    getDate(day) === 2 ||
                                    getDate(day) === 3 ||
                                    getDate(day) === 4 ||
                                    getDate(day) === 5 ||
                                    getDate(day) === 6 ||
                                    getDate(day) === 7;
                                const isFirstDayOfYear = getDate(day) === 1 && getMonth(day) === 0; // Check if it's the first day of the year
                                const year = format(day, 'yyyy'); // Get the year in YYYY format
                                const nepaliYear = nepaliDate.format('YYYY'); // Get the Nepali year in YYYY format
                                shouldDisplayBothYears = false;
                                const dateStr = format(day, 'yyyy-MM-dd');

                                //   console.log(day);
                                //   console.log(nepaliDate.format('dd D of MMMM, YYYY'));
                                const isFirstDayOfNepaliMonth = nepaliDate.getDate() === 1;
                                const isFirstWeekOfNepaliMonthButNotFirstDay =
                                    nepaliDate.getDate() === 2 ||
                                    nepaliDate.getDate() === 3 ||
                                    nepaliDate.getDate() === 4 ||
                                    nepaliDate.getDate() === 5 ||
                                    nepaliDate.getDate() === 6 ||
                                    nepaliDate.getDate() === 7;
                                const isFirstDayOfNepaliYear = nepaliDate.getDate() === 1 && nepaliDate.getMonth() === 0;
                                //   console.log("nepaliDate.getMonth: " + nepaliDate.getMonth())

                                // Determine if we should display the year in this cell
                                shouldDisplayYear = (!isYearSet && dayIndex === 0 && weekIndex === 0) || isFirstDayOfYear;
                                if (shouldDisplayYear) {
                                    isYearSet = true; // Set the flag to true after displaying the year
                                }

                                // Determine if we should display the Nepali year in this cell
                                shouldDisplayNepaliYear = displayBS && ((dayIndex === 0 && weekIndex === 0) || isFirstDayOfNepaliYear);
                                if (shouldDisplayNepaliYear) {
                                    // console.log("displaying nepali year for " + nepaliDate.format('YYYY/MM/DD'))
                                    // isNepaliYearSet = true;
                                }

                                if (shouldDisplayYear && shouldDisplayNepaliYear) {
                                    shouldDisplayBothYears = true;
                                    shouldDisplayYear = false;
                                    shouldDisplayNepaliYear = false;
                                }

                                // Determine if it is the first day of the first month--and display both AD and BS Months
                                const displayBothMonths = displayBS && !lastMonth;
                                if (displayBothMonths) {
                                    lastMonth = day;
                                    lastNepaliMonth = nepaliDate;
                                }

                                // Determine if we should display the month in this cell
                                const displayMonthName = !lastMonth || getMonth(day) !== getMonth(lastMonth);
                                if (displayMonthName) {
                                    lastMonth = day; // Update lastMonth
                                }

                                // Determine if we should display the Nepali month in this cell
                                if (displayBS) {
                                    var displayNepaliMonthName = false;
                                    if (nepaliDate.getMonth() !== lastNepaliMonth.getMonth()) {
                                        displayNepaliMonthName = true; // We started a new Nepali month, so display the month name
                                    } else if (lastNepaliMonth || nepaliDate.getMonth() === lastNepaliMonth.getMonth()) {
                                        displayNepaliMonthName = false; // Make sure not to show the Nepali month if we displayed it yesterday
                                    }
                                    if (displayNepaliMonthName) {
                                        lastNepaliMonth = nepaliDate; // Update which month was the last month labeled
                                    }
                                }

                                // Filter events for the current day
                                const dayItems = calendarItems.filter((item) => {
                                    if (item.isAllDay) {
                                        // For all-day events, compare only the date part
                                        return item.startDate <= dateStr && dateStr < item.endDate;
                                    } else {
                                        // For timed events, use the regular comparison
                                        return format(parseISO(item.startDate), 'yyyy-MM-dd') === dateStr;
                                    }
                                });
                                //   console.log(dayItems);

                                return (
                                    <Droppable droppableId={dateStr} key={dateStr}>
                                        {(provided, snapshot) => (
                                            <td
                                                ref={provided.innerRef}
                                                {...provided.droppableProps}
                                                className={`${styles.dayCell} ${isFirstDayOfYear ? styles.firstDayOfYear : ''} ${
                                                    isFirstDayOfMonth ? styles.firstDayOfMonth : ''
                                                } ${isFirstWeekOfMonthButNotFirstDay ? styles.firstWeekOfMonth : ''} ${
                                                    displayBS && isFirstDayOfNepaliYear ? styles.firstDayOfNepaliYear : ''
                                                } ${displayBS && isFirstDayOfNepaliMonth ? styles.firstDayOfNepaliMonth : ''} ${
                                                    displayBS && isFirstWeekOfNepaliMonthButNotFirstDay ? styles.firstWeekOfNepaliMonth : ''
                                                }`}
                                                onClick={() => handleDayClick(day)}
                                            >
                                                {shouldDisplayYear && <div className={styles.yearNumber}>{year}</div>}
                                                {shouldDisplayNepaliYear && <div className={styles.nepaliYearNumber}>{nepaliYear}</div>}
                                                {shouldDisplayBothYears && (
                                                    <div className={styles.yearNumber}>
                                                        {year} / {nepaliYear}
                                                    </div>
                                                )}
                                                {displayBothMonths && (
                                                    <span className={styles.displayBothMonths}>
                                                        {currentMonth} /{' '}
                                                        {nepaliMonthsCommonDevanagari[nepaliDate.getMonth()] +
                                                            ' (' +
                                                            nepaliMonthsCommonRoman[nepaliDate.getMonth()] +
                                                            ')'}
                                                        {/* {currentMonth} / {nepaliDate.format('MMMM', 'np') + " (" + nepaliDate.format('MMMM') + ")"} */}
                                                    </span>
                                                )}
                                                {displayMonthName && <div className={styles.monthName}>{currentMonth}</div>}
                                                {displayNepaliMonthName && (
                                                    <div className={styles.nepaliMonthName}>
                                                        {nepaliMonthsCommonDevanagari[nepaliDate.getMonth()] +
                                                            ' (' +
                                                            nepaliMonthsCommonRoman[nepaliDate.getMonth()] +
                                                            ')'}
                                                        {/* {nepaliDate.format('MMMM', 'np') + " (" + nepaliDate.format('MMMM') + ")"} could use currentNepaliMonth to make use of the nepaliMonths array (and get short common month names) */}
                                                    </div>
                                                )}
                                                <div className={styles.dayNumber}>
                                                    {format(day, 'd')} {displayBS ? ' / ' + nepaliDate.format('D', 'np') : ''}
                                                </div>
                                                {dayItems.map((item, index) => (
                                                    <Draggable key={item.id} draggableId={item.id} index={index}>
                                                        {(provided, snapshot) => (
                                                            <div
                                                                ref={provided.innerRef}
                                                                {...provided.draggableProps}
                                                                {...provided.dragHandleProps}
                                                                className={`${styles.calendarItem} ${styles.event} ${styles.circled}`}
                                                                onClick={(e) => handleEventClick(e, item)}
                                                            >
                                                                {item.title}
                                                            </div>
                                                        )}
                                                    </Draggable>
                                                ))}
                                                {provided.placeholder}
                                            </td>
                                        )}
                                    </Droppable>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>

            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                <DialogContent>
                    <AddEventForm selectedDate={selectedDate} selectedEvent={selectedEvent} onClose={handleCloseModal} />
                </DialogContent>
            </Dialog>
        </DragDropContext>
    );
};

export default Calendar;
