'use client'

import React, { useState, useEffect } from 'react';
import { init, tx, id } from '@instantdb/react';
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { format, addHours, addDays, setHours, setMinutes, parse } from 'date-fns';

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4' //kepler.local
const db = init({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});

const AddEventForm = ({ selectedDate, onClose, defaultStartTime = '10:00' }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    startTime: defaultStartTime,
    endTime: '',
    isAllDay: true,
  });

  useEffect(() => {
    if (selectedDate) {
      const formattedDate = format(selectedDate, "yyyy-MM-dd");
      const startDateTime = parse(defaultStartTime, 'HH:mm', new Date());
      const endDateTime = addHours(startDateTime, 1);
      
      setFormData(prevState => ({
        ...prevState,
        startDate: formattedDate,
        endDate: formattedDate,
        startTime: format(startDateTime, 'HH:mm'),
        endTime: format(endDateTime, 'HH:mm'),
      }));
    }
  }, [selectedDate, defaultStartTime]);

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
      startDateObj = parse(`${formData.startDate} 00:00:00`, 'yyyy-MM-dd HH:mm:ss', new Date());
      endDateObj = addDays(parse(`${formData.endDate} 00:00:00`, 'yyyy-MM-dd HH:mm:ss', new Date()), 1);
    } else {
      startDateObj = parse(`${formData.startDate} ${formData.startTime}`, 'yyyy-MM-dd HH:mm', new Date());
      endDateObj = parse(`${formData.startDate} ${formData.endTime}`, 'yyyy-MM-dd HH:mm', new Date());
    }

    const newEvent = {
      title: formData.title,
      description: formData.description,
      startDate: startDateObj.toISOString(),
      endDate: endDateObj.toISOString(),
      isAllDay: formData.isAllDay,
      year: startDateObj.getFullYear(),
      month: startDateObj.getMonth() + 1,
      dayOfMonth: startDateObj.getDate(),
    };

    // Add the event to the database
    db.transact([
      tx.calendarItems[id()].update(newEvent)
    ]);

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
        <Button type="submit">Add Event</Button>
      </div>
    </form>
  );
};

export default AddEventForm;