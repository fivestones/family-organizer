'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { tx, id } from '@instantdb/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { format, addHours, addDays, parse, parseISO } from 'date-fns';
import { db } from '@/lib/db';

interface FamilyMember {
    id: string;
    name?: string | null;
}

interface CalendarItem {
    id: string;
    title: string;
    description?: string;
    startDate: string;
    endDate: string;
    isAllDay: boolean;
    pertainsTo?: FamilyMember[];
    [key: string]: any;
}

interface AddEventFormProps {
    selectedDate: Date | null;
    selectedEvent: CalendarItem | null;
    onClose: () => void;
    defaultStartTime?: string;
}

// RENAMED: Changed from FormData to EventFormData to avoid conflict with built-in Browser FormData
interface EventFormData {
    id: string;
    title: string;
    description: string;
    startDate: string;
    endDate: string;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
}

const MEMBER_GRID_MAX_HEIGHT_PX = 176; // Tailwind max-h-44
const MEMBER_GRID_GAP_PX = 8; // Tailwind gap-2
const MEMBER_GRID_ROW_HEIGHT_PX = 40;
const MEMBER_GRID_CHROME_WIDTH_PX = 56; // checkbox + internal padding + spacing
const MEMBER_GRID_TEXT_FONT = "500 14px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial";

const AddEventForm = ({ selectedDate, selectedEvent, onClose, defaultStartTime = '10:00' }: AddEventFormProps) => {
    const [formData, setFormData] = useState<EventFormData>({
        id: '',
        title: '',
        description: '',
        startDate: '',
        endDate: '',
        startTime: defaultStartTime,
        endTime: '',
        isAllDay: true,
    });
    const titleInputRef = useRef<HTMLInputElement>(null);
    const [selectedFamilyMemberIds, setSelectedFamilyMemberIds] = useState<string[]>([]);
    const memberGridRef = useRef<HTMLDivElement>(null);
    const [memberGridWidth, setMemberGridWidth] = useState(0);
    const familyMembersQuery = db.useQuery({
        familyMembers: {
            $: {
                order: {
                    order: 'asc',
                },
            },
        },
    });
    const familyMembers = ((familyMembersQuery.data?.familyMembers as FamilyMember[]) || []).filter((member) => Boolean(member?.id));

    const selectedFamilyMembersById = useMemo(() => {
        const byId = new Map<string, FamilyMember>();
        for (const member of familyMembers) {
            byId.set(member.id, member);
        }

        for (const member of selectedEvent?.pertainsTo || []) {
            if (!byId.has(member.id)) {
                byId.set(member.id, member);
            }
        }

        return byId;
    }, [familyMembers, selectedEvent]);

    useEffect(() => {
        const gridElement = memberGridRef.current;
        if (!gridElement) return;

        const updateWidth = () => {
            setMemberGridWidth(gridElement.clientWidth);
        };

        updateWidth();
        const raf = window.requestAnimationFrame(updateWidth);

        if (typeof ResizeObserver !== 'undefined') {
            const observer = new ResizeObserver(updateWidth);
            observer.observe(gridElement);

            return () => {
                window.cancelAnimationFrame(raf);
                observer.disconnect();
            };
        }

        window.addEventListener('resize', updateWidth);
        return () => {
            window.cancelAnimationFrame(raf);
            window.removeEventListener('resize', updateWidth);
        };
    }, [familyMembers.length]);

    const useThreeColumnMemberGrid = useMemo(() => {
        if (familyMembers.length < 3 || memberGridWidth <= 0 || typeof document === 'undefined') {
            return false;
        }

        const visibleRowsAtTwoWide = Math.max(1, Math.floor(MEMBER_GRID_MAX_HEIGHT_PX / MEMBER_GRID_ROW_HEIGHT_PX));
        const twoWideWouldScroll = Math.ceil(familyMembers.length / 2) > visibleRowsAtTwoWide;
        if (!twoWideWouldScroll) {
            return false;
        }

        const estimatedColumnWidth = (memberGridWidth - MEMBER_GRID_GAP_PX * 2) / 3;
        const maxTextWidth = estimatedColumnWidth - MEMBER_GRID_CHROME_WIDTH_PX;
        if (!Number.isFinite(maxTextWidth) || maxTextWidth <= 0) {
            return false;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
            return false;
        }
        context.font = MEMBER_GRID_TEXT_FONT;

        return familyMembers.every((member) => {
            const label = member.name || 'Unnamed member';
            return context.measureText(label).width <= maxTextWidth;
        });
    }, [familyMembers, memberGridWidth]);

    useEffect(() => {
        if (!selectedDate || selectedEvent) {
            return;
        }

        const raf = window.requestAnimationFrame(() => {
            titleInputRef.current?.focus();
        });

        return () => {
            window.cancelAnimationFrame(raf);
        };
    }, [selectedDate, selectedEvent]);

    useEffect(() => {
        if (selectedEvent) {
            const startDate = selectedEvent.isAllDay ? selectedEvent.startDate : format(parseISO(selectedEvent.startDate), 'yyyy-MM-dd');
            const endDate = selectedEvent.isAllDay ? selectedEvent.endDate : format(parseISO(selectedEvent.endDate), 'yyyy-MM-dd');
            const startTime = selectedEvent.isAllDay ? defaultStartTime : format(parseISO(selectedEvent.startDate), 'HH:mm');
            const endTime = selectedEvent.isAllDay
                ? format(addHours(parse(defaultStartTime, 'HH:mm', new Date()), 1), 'HH:mm')
                : format(parseISO(selectedEvent.endDate), 'HH:mm');

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
            setSelectedFamilyMemberIds((selectedEvent.pertainsTo || []).map((member) => member.id));
        } else if (selectedDate) {
            const formattedDate = format(selectedDate, 'yyyy-MM-dd');
            const startDateTime = parse(defaultStartTime, 'HH:mm', new Date());
            const endDateTime = addHours(startDateTime, 1);

            setFormData((prevState) => ({
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
            setSelectedFamilyMemberIds([]);
        }
    }, [selectedDate, selectedEvent, defaultStartTime]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        setFormData((prevState) => {
            const newState = { ...prevState, [name]: value };

            if (name === 'startTime' && !prevState.isAllDay) {
                const startDateTime = parse(value, 'HH:mm', new Date());
                const timeDiff = parse(prevState.endTime, 'HH:mm', new Date()).getTime() - parse(prevState.startTime, 'HH:mm', new Date()).getTime();
                const newEndTime = addHours(startDateTime, timeDiff / (60 * 60 * 1000));
                newState.endTime = format(newEndTime, 'HH:mm');
            }

            return newState;
        });
    };

    const handleAllDayToggle = (checked: boolean) => {
        setFormData((prevState) => ({
            ...prevState,
            isAllDay: checked,
            endDate: checked ? prevState.startDate : prevState.endDate,
        }));
    };

    const handleFamilyMemberToggle = (memberId: string, checked: boolean | 'indeterminate') => {
        if (checked === 'indeterminate') {
            return;
        }

        setSelectedFamilyMemberIds((previous) => {
            if (checked) {
                return previous.includes(memberId) ? previous : [...previous, memberId];
            }
            return previous.filter((id) => id !== memberId);
        });
    };

    const handleSubmit = (e: React.FormEvent) => {
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
            startDate: formData.isAllDay ? format(startDateObj, 'yyyy-MM-dd') : startDateObj.toISOString(),
            endDate: formData.isAllDay ? format(endDateObj, 'yyyy-MM-dd') : endDateObj.toISOString(),
            isAllDay: formData.isAllDay,
            year: startDateObj.getFullYear(),
            month: startDateObj.getMonth() + 1,
            dayOfMonth: startDateObj.getDate(),
        };

        const eventId = formData.id || id();
        const previousMemberIds = new Set((selectedEvent?.pertainsTo || []).map((member) => member.id));
        const nextMemberIds = new Set(selectedFamilyMemberIds);
        const txOps: any[] = [tx.calendarItems[eventId].update(eventData)];

        for (const memberId of Array.from(previousMemberIds)) {
            if (!nextMemberIds.has(memberId)) {
                txOps.push(tx.calendarItems[eventId].unlink({ pertainsTo: memberId }));
            }
        }

        for (const memberId of Array.from(nextMemberIds)) {
            if (!previousMemberIds.has(memberId)) {
                txOps.push(tx.calendarItems[eventId].link({ pertainsTo: memberId }));
            }
        }

        db.transact(txOps);
        onClose();
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <Label htmlFor="title">Title</Label>
                <Input ref={titleInputRef} type="text" id="title" name="title" value={formData.title} onChange={handleChange} required />
            </div>
            <div>
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" name="description" value={formData.description} onChange={handleChange} />
            </div>
            <div className="flex items-center space-x-2">
                <Switch id="isAllDay" checked={formData.isAllDay} onCheckedChange={handleAllDayToggle} />
                <Label htmlFor="isAllDay">All-day event</Label>
            </div>
            <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input type="date" id="startDate" name="startDate" value={formData.startDate} onChange={handleChange} required />
            </div>
            {!formData.isAllDay && (
                <div>
                    <Label htmlFor="startTime">Start Time</Label>
                    <Input type="time" id="startTime" name="startTime" value={formData.startTime} onChange={handleChange} required />
                </div>
            )}
            {formData.isAllDay ? (
                <div>
                    <Label htmlFor="endDate">End Date</Label>
                    <Input type="date" id="endDate" name="endDate" value={formData.endDate} onChange={handleChange} min={formData.startDate} required />
                </div>
            ) : (
                <div>
                    <Label htmlFor="endTime">End Time</Label>
                    <Input type="time" id="endTime" name="endTime" value={formData.endTime} onChange={handleChange} min={formData.startTime} required />
                </div>
            )}
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Label>Pertains To</Label>
                    <p className="text-xs text-muted-foreground">Leave unselected to apply to everyone</p>
                </div>
                {familyMembersQuery.isLoading ? (
                    <p className="text-xs text-muted-foreground">Loading family members...</p>
                ) : familyMembersQuery.error ? (
                    <p className="text-xs text-destructive">Could not load family members.</p>
                ) : familyMembers.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No family members available yet.</p>
                ) : (
                    <div
                        ref={memberGridRef}
                        className={`grid max-h-44 grid-cols-1 gap-2 overflow-y-auto pr-1 ${useThreeColumnMemberGrid ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}
                    >
                        {familyMembers.map((member) => {
                            const isChecked = selectedFamilyMemberIds.includes(member.id);
                            return (
                                <label
                                    key={member.id}
                                    htmlFor={`event-member-${member.id}`}
                                    className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                                        isChecked ? 'border-primary/40 bg-primary/10' : 'border-slate-200 bg-white hover:bg-slate-100'
                                    }`}
                                >
                                    <Checkbox
                                        id={`event-member-${member.id}`}
                                        checked={isChecked}
                                        onCheckedChange={(checked) => handleFamilyMemberToggle(member.id, checked)}
                                    />
                                    <span className="min-w-0 truncate">{member.name || 'Unnamed member'}</span>
                                </label>
                            );
                        })}
                    </div>
                )}

                <div className="flex flex-wrap gap-2">
                    {selectedFamilyMemberIds.length === 0 ? (
                        <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                            Everyone
                        </span>
                    ) : (
                        selectedFamilyMemberIds.map((memberId) => (
                            <span key={memberId} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-medium text-slate-700">
                                {selectedFamilyMembersById.get(memberId)?.name || 'Unknown member'}
                            </span>
                        ))
                    )}
                </div>
            </div>
            <div className="flex justify-end space-x-2">
                <Button type="button" variant="outline" onClick={onClose}>
                    Cancel
                </Button>
                <Button type="submit">{formData.id ? 'Update' : 'Add'} Event</Button>
            </div>
        </form>
    );
};

export default AddEventForm;
