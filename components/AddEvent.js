'use client'

import React, { useState, useEffect } from 'react';
import { init, tx, id } from '@instantdb/react';
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { format, addHours, addDays, parse, parseISO } from 'date-fns';

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4' //kepler.local
const db = init({
  appId: APP_ID,
  apiURI: "http://localhost:8888",
  websocketURI: "ws://localhost:8888/runtime/session",
});

const AddEventForm = ({ selectedDate, selectedEvent, onClose, defaultStartTime = '10:00' }) => {
  const [formData, setFormData] = useState({
    id: '',
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    startTime: defaultStartTime,
    endTime: '',
    isAllDay: true,
  });

  useEffect(() => {
    if (selectedEvent) {
      console.log("Populating form with selected event:", selectedEvent);
      // Editing an existing event
      const startDate = selectedEvent.isAllDay ? selectedEvent.startDate : format(parseISO(selectedEvent.startDate), 'yyyy-MM-dd');
      const endDate = selectedEvent.isAllDay ? selectedEvent.endDate : format(parseISO(selectedEvent.endDate), 'yyyy-MM-dd');
      const startTime = selectedEvent.isAllDay ? defaultStartTime : format(parseISO(selectedEvent.startDate), 'HH:mm');
      const endTime = selectedEvent.isAllDay ? format(addHours(parse(defaultStartTime, 'HH:mm', new Date()), 1), 'HH:mm') : format(parseISO(selectedEvent.endDate), 'HH:mm');

      setFormData({
        id: selectedEvent.id,
        title: selectedEvent.title,
        description: selectedEvent.description || '',
        startDate,
        endDate,
        startTime,
        endTime,
        isAllDay: selectedEvent.isAllDay,
      });
    } else if (selectedDate) {
      console.log("Setting up form for new event on:", selectedDate);
      // Adding a new event
      const formattedDate = format(selectedDate, "yyyy-MM-dd");
      const startDateTime = parse(defaultStartTime, 'HH:mm', new Date());
      const endDateTime = addHours(startDateTime, 1);
      
      setFormData(prevState => ({
        ...prevState,
        id: '',
        title: '',
        description: '',
        startDate: formattedDate,
        endDate: formattedDate,
        startTime: format(startDateTime, 'HH:mm'),
        endTime: format(endDateTime, 'HH:mm'),
        isAllDay: true,
      }));
    }
  }, [selectedDate, selectedEvent, defaultStartTime]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevState => {
      const newState = { ...prevState, [name]: value };
      
      if (name === 'startTime' && !prevState.isAllDay) {
        const startDateTime = parse(value, 'HH:mm', new Date());
        const timeDiff = parse(prevState.endTime, 'HH:mm', new Date()) - parse(prevState.startTime, 'HH:mm', new Date());
        const newEndTime = addHours(startDateTime, timeDiff / (60 * 60 * 1000));
        newState.endTime = format(newEndTime, 'HH:mm');
      }
      
      return newState;
    });
  };

  const handleAllDayToggle = (checked) => {
    setFormData(prevState => ({
      ...prevState,
      isAllDay: checked,
      endDate: checked ? prevState.startDate : prevState.endDate,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    let startDateObj, endDateObj;

    if (formData.isAllDay) {
      // For all-day events, use floating time (no timezone)
      startDateObj = parseISO(`${formData.startDate}T00:00:00`);
      endDateObj = parseISO(`${formData.endDate}T00:00:00`);
      endDateObj = addDays(endDateObj, 1); // End date is exclusive
    } else {
      // For timed events, use the user's local timezone
      startDateObj = parseISO(`${formData.startDate}T${formData.startTime}:00`);
      endDateObj = parseISO(`${formData.startDate}T${formData.endTime}:00`);
    }

    const eventData = {
      title: formData.title,
      description: formData.description,
      startDate: formData.isAllDay ? format(startDateObj, "yyyy-MM-dd") : startDateObj.toISOString(),
      endDate: formData.isAllDay ? format(endDateObj, "yyyy-MM-dd") : endDateObj.toISOString(),
      isAllDay: formData.isAllDay,
      year: startDateObj.getFullYear(),
      month: startDateObj.getMonth() + 1,
      dayOfMonth: startDateObj.getDate(),
    };

    // Add or update the event in the database
    if (formData.id) {
      // Updating existing event
      db.transact([
        tx.calendarItems[formData.id].update(eventData)
      ]);
    } else {
      // Adding new event
      db.transact([
        tx.calendarItems[id()].update(eventData)
      ]);
    }

    // Close the modal
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label htmlFor="title">Title</Label>
        <Input
          type="text"
          id="title"
          name="title"
          value={formData.title}
          onChange={handleChange}
          required
        />
      </div>
      <div>
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          name="description"
          value={formData.description}
          onChange={handleChange}
        />
      </div>
      <div className="flex items-center space-x-2">
        <Switch
          id="isAllDay"
          checked={formData.isAllDay}
          onCheckedChange={handleAllDayToggle}
        />
        <Label htmlFor="isAllDay">All-day event</Label>
      </div>
      <div>
        <Label htmlFor="startDate">Start Date</Label>
        <Input
          type="date"
          id="startDate"
          name="startDate"
          value={formData.startDate}
          onChange={handleChange}
          required
        />
      </div>
      {!formData.isAllDay && (
        <div>
          <Label htmlFor="startTime">Start Time</Label>
          <Input
            type="time"
            id="startTime"
            name="startTime"
            value={formData.startTime}
            onChange={handleChange}
            required
          />
        </div>
      )}
      {formData.isAllDay ? (
        <div>
          <Label htmlFor="endDate">End Date</Label>
          <Input
            type="date"
            id="endDate"
            name="endDate"
            value={formData.endDate}
            onChange={handleChange}
            min={formData.startDate}
            required
          />
        </div>
      ) : (
        <div>
          <Label htmlFor="endTime">End Time</Label>
          <Input
            type="time"
            id="endTime"
            name="endTime"
            value={formData.endTime}
            onChange={handleChange}
            min={formData.startTime}
            required
          />
        </div>
      )}
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit">{formData.id ? 'Update' : 'Add'} Event</Button>
      </div>
    </form>
  );
};

export default AddEventForm;