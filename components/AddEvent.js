'use client'

import React, { useState, useEffect } from 'react';
import { init, tx, id } from '@instantdb/react'
import { format, addDays, startOfWeek, getDate, getMonth } from 'date-fns';
import { Button } from "../components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4' //kepler.local
const db = init({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});

const AddEventForm = ({ selectedDate, onClose }) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
  });

  useEffect(() => {
    if (selectedDate) {
      const formattedDate = format(selectedDate, "yyyy-MM-dd'T'HH:mm");
      setFormData(prevState => ({
        ...prevState,
        startDate: formattedDate,
        endDate: formattedDate,
      }));
    }
  }, [selectedDate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prevState => ({
      ...prevState,
      [name]: value
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const startDateObj = new Date(formData.startDate);
    
    const newEvent = {
      ...formData,
      year: startDateObj.getFullYear(),
      month: startDateObj.getMonth() + 1, // getMonth() returns 0-11
      dayOfMonth: startDateObj.getDate(),
    };

    // Add the event to the database
    db.transact([
        tx.calendarItems[id()].update(newEvent)
    ]);

    // Close the modal
    onClose();

    // // Reset the form
    // setFormData({
    //   title: '',
    //   description: '',
    //   startDate: '',
    //   endDate: '',
    // });
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
      <div>
        <Label htmlFor="startDate">Start Date</Label>
        <Input
          type="datetime-local"
          id="startDate"
          name="startDate"
          value={formData.startDate}
          onChange={handleChange}
          required
        />
      </div>
      <div>
        <Label htmlFor="endDate">End Date</Label>
        <Input
          type="datetime-local"
          id="endDate"
          name="endDate"
          value={formData.endDate}
          onChange={handleChange}
          required
        />
      </div>
      <div className="flex justify-end space-x-2">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit">Add Event</Button>
      </div>
    </form>
  );
};

export default AddEventForm;