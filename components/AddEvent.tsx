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
    description?: string | null;
    startDate: string;
    endDate: string;
    isAllDay: boolean;
    pertainsTo?: FamilyMember[];
    alarms?: CalendarAlarm[] | null;
    createdAt?: string;
    dtStamp?: string;
    eventType?: string;
    exdates?: string[];
    lastModified?: string;
    location?: string;
    recurrenceId?: string;
    recurrenceIdRange?: string;
    recurrenceLines?: string[];
    recurringEventId?: string;
    rdates?: string[];
    rrule?: string;
    sequence?: number;
    status?: string;
    timeZone?: string;
    transparency?: string;
    travelDurationAfterMinutes?: number;
    travelDurationBeforeMinutes?: number;
    uid?: string;
    updatedAt?: string;
    visibility?: string;
    [key: string]: any;
}

interface CalendarAlarm {
    action?: string;
    triggerAt?: string;
    triggerOffsetMinutesBeforeStart?: number;
    triggerOffsetSeconds?: number;
    triggerType?: string;
    repeatCount?: number;
    repeatDurationMinutes?: number;
    repeatUntilAcknowledged?: boolean;
    [key: string]: any;
}

interface AddEventFormProps {
    selectedDate: Date | null;
    selectedEvent: CalendarItem | null;
    onClose: () => void;
    defaultStartTime?: string;
    onOptimisticUpsert?: (item: CalendarItem) => (() => void) | void;
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
    status: string;
    location: string;
    timeZone: string;
    rrule: string;
    rdatesCsv: string;
    exdatesCsv: string;
    recurrenceId: string;
    recurringEventId: string;
    recurrenceIdRange: string;
    travelDurationBeforeMinutes: string;
    travelDurationAfterMinutes: string;
    alarmEnabled: boolean;
    alarmAction: string;
    alarmTriggerMode: string;
    alarmTriggerMinutesBefore: string;
    alarmTriggerAt: string;
    alarmRepeatCount: string;
    alarmRepeatDurationMinutes: string;
    alarmRepeatUntilAcknowledged: boolean;
}

const DEFAULT_EVENT_STATUS = 'confirmed';
const DEFAULT_ALARM_ACTION = 'display';
const DEFAULT_ALARM_TRIGGER_MODE = 'relative';

const MEMBER_GRID_MAX_HEIGHT_PX = 176; // Tailwind max-h-44
const MEMBER_GRID_GAP_PX = 8; // Tailwind gap-2
const MEMBER_GRID_ROW_HEIGHT_PX = 40;
const MEMBER_GRID_CHROME_WIDTH_PX = 56; // checkbox + internal padding + spacing
const MEMBER_GRID_TEXT_FONT = "500 14px ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial";

function getLocalTimeZone(): string {
    try {
        const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
        return resolved || 'UTC';
    } catch {
        return 'UTC';
    }
}

function normalizeRrule(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.toUpperCase().startsWith('RRULE:') ? trimmed : `RRULE:${trimmed}`;
}

function parseCsvList(value: string): string[] {
    return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function parseOptionalInt(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    return Math.trunc(parsed);
}

function toDatetimeLocalValue(value?: string): string {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    const hour = String(parsed.getHours()).padStart(2, '0');
    const minute = String(parsed.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${minute}`;
}

function buildRecurrenceLines(rrule: string, rdates: string[], exdates: string[]): string[] {
    const lines: string[] = [];
    if (rrule) lines.push(rrule);
    if (rdates.length > 0) lines.push(`RDATE:${rdates.join(',')}`);
    if (exdates.length > 0) lines.push(`EXDATE:${exdates.join(',')}`);
    return lines;
}

function shouldRetryLegacyCalendarMutation(error: unknown): boolean {
    const message = String((error as any)?.message || '').toLowerCase();
    return message.includes('permission denied') || message.includes('mutation failed') || message.includes('attrs');
}

function deriveAlarmDefaults(selectedEvent: CalendarItem | null) {
    const firstAlarm = Array.isArray(selectedEvent?.alarms) ? selectedEvent?.alarms?.[0] : null;
    if (!firstAlarm) {
        return {
            alarmEnabled: false,
            alarmAction: DEFAULT_ALARM_ACTION,
            alarmTriggerMode: DEFAULT_ALARM_TRIGGER_MODE,
            alarmTriggerMinutesBefore: '15',
            alarmTriggerAt: '',
            alarmRepeatCount: '',
            alarmRepeatDurationMinutes: '',
            alarmRepeatUntilAcknowledged: false,
        };
    }

    const normalizedAction = String(firstAlarm.action || DEFAULT_ALARM_ACTION).toLowerCase();
    const triggerOffsetMinutes =
        typeof firstAlarm.triggerOffsetMinutesBeforeStart === 'number'
            ? firstAlarm.triggerOffsetMinutesBeforeStart
            : typeof firstAlarm.triggerOffsetSeconds === 'number'
              ? Math.round(firstAlarm.triggerOffsetSeconds / 60)
              : 15;
    const absoluteTrigger = firstAlarm.triggerAt ? toDatetimeLocalValue(firstAlarm.triggerAt) : '';
    const triggerMode = firstAlarm.triggerAt || String(firstAlarm.triggerType || '').toLowerCase() === 'absolute' ? 'absolute' : 'relative';
    const repeatUntilAcknowledged = Boolean(firstAlarm.repeatUntilAcknowledged);

    return {
        alarmEnabled: true,
        alarmAction: repeatUntilAcknowledged
            ? 'audioUntilAck'
            : normalizedAction === 'audio'
              ? 'audio'
              : normalizedAction === 'display'
                ? 'display'
                : normalizedAction,
        alarmTriggerMode: triggerMode,
        alarmTriggerMinutesBefore: String(Math.max(0, triggerOffsetMinutes)),
        alarmTriggerAt: absoluteTrigger,
        alarmRepeatCount: firstAlarm.repeatCount != null ? String(firstAlarm.repeatCount) : '',
        alarmRepeatDurationMinutes: firstAlarm.repeatDurationMinutes != null ? String(firstAlarm.repeatDurationMinutes) : '',
        alarmRepeatUntilAcknowledged: repeatUntilAcknowledged,
    };
}

const AddEventForm = ({ selectedDate, selectedEvent, onClose, defaultStartTime = '10:00', onOptimisticUpsert }: AddEventFormProps) => {
    const [formData, setFormData] = useState<EventFormData>({
        id: '',
        title: '',
        description: '',
        startDate: '',
        endDate: '',
        startTime: defaultStartTime,
        endTime: '',
        isAllDay: true,
        status: DEFAULT_EVENT_STATUS,
        location: '',
        timeZone: getLocalTimeZone(),
        rrule: '',
        rdatesCsv: '',
        exdatesCsv: '',
        recurrenceId: '',
        recurringEventId: '',
        recurrenceIdRange: '',
        travelDurationBeforeMinutes: '',
        travelDurationAfterMinutes: '',
        alarmEnabled: false,
        alarmAction: DEFAULT_ALARM_ACTION,
        alarmTriggerMode: DEFAULT_ALARM_TRIGGER_MODE,
        alarmTriggerMinutesBefore: '15',
        alarmTriggerAt: '',
        alarmRepeatCount: '',
        alarmRepeatDurationMinutes: '',
        alarmRepeatUntilAcknowledged: false,
    });
    const titleInputRef = useRef<HTMLInputElement>(null);
    const submitLockRef = useRef(false);
    const isMountedRef = useRef(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
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
        return () => {
            isMountedRef.current = false;
        };
    }, []);

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
            const exclusiveEndDate = selectedEvent.isAllDay ? parseISO(selectedEvent.endDate) : null;
            const endDate =
                selectedEvent.isAllDay && exclusiveEndDate && !Number.isNaN(exclusiveEndDate.getTime())
                    ? format(addDays(exclusiveEndDate, -1), 'yyyy-MM-dd')
                    : selectedEvent.isAllDay
                      ? selectedEvent.startDate
                      : format(parseISO(selectedEvent.endDate), 'yyyy-MM-dd');
            const startTime = selectedEvent.isAllDay ? defaultStartTime : format(parseISO(selectedEvent.startDate), 'HH:mm');
            const endTime = selectedEvent.isAllDay
                ? format(addHours(parse(defaultStartTime, 'HH:mm', new Date()), 1), 'HH:mm')
                : format(parseISO(selectedEvent.endDate), 'HH:mm');
            const alarmDefaults = deriveAlarmDefaults(selectedEvent);

            setFormData({
                id: selectedEvent.id,
                title: selectedEvent.title,
                description: selectedEvent.description || '',
                startDate,
                endDate,
                startTime,
                endTime,
                isAllDay: selectedEvent.isAllDay,
                status: String(selectedEvent.status || DEFAULT_EVENT_STATUS),
                location: String(selectedEvent.location || ''),
                timeZone: String(selectedEvent.timeZone || getLocalTimeZone()),
                rrule: String(selectedEvent.rrule || ''),
                rdatesCsv: Array.isArray(selectedEvent.rdates) ? selectedEvent.rdates.join(', ') : '',
                exdatesCsv: Array.isArray(selectedEvent.exdates) ? selectedEvent.exdates.join(', ') : '',
                recurrenceId: String(selectedEvent.recurrenceId || ''),
                recurringEventId: String(selectedEvent.recurringEventId || ''),
                recurrenceIdRange: String(selectedEvent.recurrenceIdRange || ''),
                travelDurationBeforeMinutes:
                    typeof selectedEvent.travelDurationBeforeMinutes === 'number' ? String(selectedEvent.travelDurationBeforeMinutes) : '',
                travelDurationAfterMinutes:
                    typeof selectedEvent.travelDurationAfterMinutes === 'number' ? String(selectedEvent.travelDurationAfterMinutes) : '',
                ...alarmDefaults,
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
                status: DEFAULT_EVENT_STATUS,
                location: '',
                timeZone: getLocalTimeZone(),
                rrule: '',
                rdatesCsv: '',
                exdatesCsv: '',
                recurrenceId: '',
                recurringEventId: '',
                recurrenceIdRange: '',
                travelDurationBeforeMinutes: '',
                travelDurationAfterMinutes: '',
                alarmEnabled: false,
                alarmAction: DEFAULT_ALARM_ACTION,
                alarmTriggerMode: DEFAULT_ALARM_TRIGGER_MODE,
                alarmTriggerMinutesBefore: '15',
                alarmTriggerAt: '',
                alarmRepeatCount: '',
                alarmRepeatDurationMinutes: '',
                alarmRepeatUntilAcknowledged: false,
            }));
            setSelectedFamilyMemberIds([]);
        }
    }, [selectedDate, selectedEvent, defaultStartTime]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData((prevState) => {
            const newState = { ...prevState, [name]: value } as EventFormData;

            if (name === 'startTime' && !prevState.isAllDay) {
                const startDateTime = parse(value, 'HH:mm', new Date());
                const timeDiff = parse(prevState.endTime, 'HH:mm', new Date()).getTime() - parse(prevState.startTime, 'HH:mm', new Date()).getTime();
                const newEndTime = addHours(startDateTime, timeDiff / (60 * 60 * 1000));
                newState.endTime = format(newEndTime, 'HH:mm');
            }

            if (name === 'alarmAction' && value === 'audioUntilAck') {
                newState.alarmRepeatUntilAcknowledged = true;
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

    const handleBooleanFieldChange = (name: keyof EventFormData, checked: boolean) => {
        setFormData((prevState) => ({ ...prevState, [name]: checked }));
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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitLockRef.current) return;
        submitLockRef.current = true;
        setIsSubmitting(true);
        const abortSubmit = () => {
            submitLockRef.current = false;
            if (isMountedRef.current) {
                setIsSubmitting(false);
            }
        };
        let startDateObj, endDateObj;

        if (formData.isAllDay) {
            // For all-day events, use floating time (no timezone)
            startDateObj = parseISO(`${formData.startDate}T00:00:00`);
            endDateObj = parseISO(`${formData.endDate}T00:00:00`);
            endDateObj = addDays(endDateObj, 1); // End date is exclusive
        } else {
            // For timed events, use the user's local timezone
            startDateObj = parseISO(`${formData.startDate}T${formData.startTime}:00`);
            endDateObj = parseISO(`${formData.endDate}T${formData.endTime}:00`);
        }

        if (Number.isNaN(startDateObj.getTime()) || Number.isNaN(endDateObj.getTime()) || endDateObj.getTime() <= startDateObj.getTime()) {
            abortSubmit();
            window.alert('Please provide a valid start/end date range.');
            return;
        }

        const eventId = formData.id || id();
        const nowIso = new Date().toISOString();
        const normalizedStatus = formData.status.trim().toLowerCase() || DEFAULT_EVENT_STATUS;
        const normalizedRrule = normalizeRrule(formData.rrule);
        const rdates = parseCsvList(formData.rdatesCsv);
        const exdates = parseCsvList(formData.exdatesCsv);
        const recurrenceLines = buildRecurrenceLines(normalizedRrule, rdates, exdates);
        const sequenceBase = typeof selectedEvent?.sequence === 'number' ? selectedEvent.sequence : 0;
        const travelDurationBeforeMinutes = parseOptionalInt(formData.travelDurationBeforeMinutes);
        const travelDurationAfterMinutes = parseOptionalInt(formData.travelDurationAfterMinutes);
        const alarmTriggerAtIso = formData.alarmTriggerAt ? new Date(formData.alarmTriggerAt).toISOString() : '';
        const alarmAction = formData.alarmAction === 'audioUntilAck' ? 'audio' : formData.alarmAction;
        const alarmRepeatCount = parseOptionalInt(formData.alarmRepeatCount);
        const alarmRepeatDurationMinutes = parseOptionalInt(formData.alarmRepeatDurationMinutes);
        const alarmDefinitions = formData.alarmEnabled
            ? [
                  {
                      action: String(alarmAction || DEFAULT_ALARM_ACTION).toUpperCase(),
                      triggerType: formData.alarmTriggerMode,
                      triggerAt: formData.alarmTriggerMode === 'absolute' ? alarmTriggerAtIso : '',
                      triggerOffsetMinutesBeforeStart:
                          formData.alarmTriggerMode === 'relative' ? Math.max(0, parseOptionalInt(formData.alarmTriggerMinutesBefore) ?? 15) : 0,
                      repeatCount: alarmRepeatCount ?? 0,
                      repeatDurationMinutes: alarmRepeatDurationMinutes ?? 0,
                      repeatUntilAcknowledged:
                          Boolean(formData.alarmRepeatUntilAcknowledged) || formData.alarmAction === 'audioUntilAck',
                  },
              ]
            : [];

        const legacyEventData = {
            title: formData.title,
            description: formData.description,
            startDate: formData.isAllDay ? format(startDateObj, 'yyyy-MM-dd') : startDateObj.toISOString(),
            endDate: formData.isAllDay ? format(endDateObj, 'yyyy-MM-dd') : endDateObj.toISOString(),
            isAllDay: formData.isAllDay,
            year: startDateObj.getFullYear(),
            month: startDateObj.getMonth() + 1,
            dayOfMonth: startDateObj.getDate(),
        };

        const extendedEventPatch = {
            uid: selectedEvent?.uid || eventId,
            sequence: formData.id ? sequenceBase + 1 : sequenceBase,
            status: normalizedStatus,
            createdAt: selectedEvent?.createdAt || nowIso,
            updatedAt: nowIso,
            dtStamp: nowIso,
            lastModified: nowIso,
            location: formData.location.trim(),
            timeZone: formData.timeZone.trim() || getLocalTimeZone(),
            rrule: normalizedRrule,
            rdates,
            exdates,
            recurrenceLines,
            recurrenceId: formData.recurrenceId.trim(),
            recurringEventId: formData.recurringEventId.trim(),
            recurrenceIdRange: formData.recurrenceIdRange.trim(),
            alarms: alarmDefinitions,
            eventType: String(selectedEvent?.eventType || 'default'),
            visibility: String(selectedEvent?.visibility || 'default'),
            transparency: String(selectedEvent?.transparency || (formData.isAllDay ? 'transparent' : 'opaque')),
            ...(travelDurationBeforeMinutes != null ? { travelDurationBeforeMinutes } : {}),
            ...(travelDurationAfterMinutes != null ? { travelDurationAfterMinutes } : {}),
        };
        const eventData = {
            ...legacyEventData,
            ...extendedEventPatch,
        };

        const previousMemberIds = new Set((selectedEvent?.pertainsTo || []).map((member) => member.id));
        const nextMemberIds = new Set(selectedFamilyMemberIds);
        const buildTxOps = (payload: Record<string, any>) => {
            const txOps: any[] = [tx.calendarItems[eventId].update(payload)];

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

            return txOps;
        };

        const optimisticPertainsTo = Array.from(nextMemberIds).map((memberId) => ({
            id: memberId,
            name: selectedFamilyMembersById.get(memberId)?.name || null,
        }));
        const rollbackOptimistic = onOptimisticUpsert?.({
            id: eventId,
            ...eventData,
            pertainsTo: optimisticPertainsTo,
        });
        onClose();

        try {
            await db.transact(buildTxOps(legacyEventData));
            void Promise.resolve(db.transact([tx.calendarItems[eventId].update(extendedEventPatch)])).catch((error) => {
                if (!shouldRetryLegacyCalendarMutation(error)) {
                    console.error('Unable to persist extended calendar metadata:', error);
                }
            });
        } catch (error) {
            if (typeof rollbackOptimistic === 'function') rollbackOptimistic();
            console.error('Unable to save event:', error);
            window.alert('Unable to save event. Please try again.');
            abortSubmit();
            return;
        }
        submitLockRef.current = false;
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
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <Label htmlFor="status">Status</Label>
                    <select
                        id="status"
                        name="status"
                        value={formData.status}
                        onChange={handleChange}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                        <option value="confirmed">Confirmed</option>
                        <option value="tentative">Tentative</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>
                <div>
                    <Label htmlFor="timeZone">Time Zone</Label>
                    <Input id="timeZone" name="timeZone" value={formData.timeZone} onChange={handleChange} placeholder="America/New_York" />
                </div>
            </div>
            <div>
                <Label htmlFor="location">Location</Label>
                <Input id="location" name="location" value={formData.location} onChange={handleChange} placeholder="Address, room, or meeting URL" />
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
            <div>
                <Label htmlFor="endDate">{formData.isAllDay ? 'End Date' : 'End Date (for multi-day support)'}</Label>
                <Input type="date" id="endDate" name="endDate" value={formData.endDate} onChange={handleChange} min={formData.startDate} required />
            </div>
            {!formData.isAllDay && (
                <div>
                    <Label htmlFor="endTime">End Time</Label>
                    <Input type="time" id="endTime" name="endTime" value={formData.endTime} onChange={handleChange} min={formData.startTime} required />
                </div>
            )}
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Label htmlFor="rrule">Recurrence</Label>
                    <p className="text-xs text-muted-foreground">RRULE, EXDATE, RDATE, and RECURRENCE-ID for sync-safe recurrence.</p>
                </div>
                <div>
                    <Label htmlFor="rrule">RRULE</Label>
                    <Input
                        id="rrule"
                        name="rrule"
                        value={formData.rrule}
                        onChange={handleChange}
                        placeholder="FREQ=WEEKLY;BYDAY=MO,WE,FR"
                    />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="rdatesCsv">RDATEs (comma-separated)</Label>
                        <Input
                            id="rdatesCsv"
                            name="rdatesCsv"
                            value={formData.rdatesCsv}
                            onChange={handleChange}
                            placeholder="2026-04-01T09:00:00Z, 2026-04-15T09:00:00Z"
                        />
                    </div>
                    <div>
                        <Label htmlFor="exdatesCsv">EXDATEs (comma-separated)</Label>
                        <Input
                            id="exdatesCsv"
                            name="exdatesCsv"
                            value={formData.exdatesCsv}
                            onChange={handleChange}
                            placeholder="2026-04-08T09:00:00Z"
                        />
                    </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="recurrenceId">RECURRENCE-ID</Label>
                        <Input
                            id="recurrenceId"
                            name="recurrenceId"
                            value={formData.recurrenceId}
                            onChange={handleChange}
                            placeholder="2026-04-08T09:00:00Z"
                        />
                    </div>
                    <div>
                        <Label htmlFor="recurrenceIdRange">RECURRENCE-ID RANGE</Label>
                        <Input
                            id="recurrenceIdRange"
                            name="recurrenceIdRange"
                            value={formData.recurrenceIdRange}
                            onChange={handleChange}
                            placeholder="THISANDFUTURE"
                        />
                    </div>
                </div>
                <div>
                    <Label htmlFor="recurringEventId">Recurring Event ID (parent/master)</Label>
                    <Input
                        id="recurringEventId"
                        name="recurringEventId"
                        value={formData.recurringEventId}
                        onChange={handleChange}
                        placeholder="Master event id for recurrence exception rows"
                    />
                </div>
            </div>
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Label>Alarms & Travel</Label>
                    <p className="text-xs text-muted-foreground">Supports display/audio alarms and audio-until-ack behavior metadata.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="travelDurationBeforeMinutes">Travel Before (minutes)</Label>
                        <Input
                            id="travelDurationBeforeMinutes"
                            name="travelDurationBeforeMinutes"
                            value={formData.travelDurationBeforeMinutes}
                            onChange={handleChange}
                            inputMode="numeric"
                            placeholder="15"
                        />
                    </div>
                    <div>
                        <Label htmlFor="travelDurationAfterMinutes">Travel After (minutes)</Label>
                        <Input
                            id="travelDurationAfterMinutes"
                            name="travelDurationAfterMinutes"
                            value={formData.travelDurationAfterMinutes}
                            onChange={handleChange}
                            inputMode="numeric"
                            placeholder="0"
                        />
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <Switch
                        id="alarmEnabled"
                        checked={formData.alarmEnabled}
                        onCheckedChange={(checked) => handleBooleanFieldChange('alarmEnabled', checked)}
                    />
                    <Label htmlFor="alarmEnabled">Enable alarm</Label>
                </div>
                {formData.alarmEnabled && (
                    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                                <Label htmlFor="alarmAction">Alarm Action</Label>
                                <select
                                    id="alarmAction"
                                    name="alarmAction"
                                    value={formData.alarmAction}
                                    onChange={handleChange}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                >
                                    <option value="display">Display</option>
                                    <option value="audio">Audio</option>
                                    <option value="audioUntilAck">Audio Until Acknowledged</option>
                                </select>
                            </div>
                            <div>
                                <Label htmlFor="alarmTriggerMode">Trigger Mode</Label>
                                <select
                                    id="alarmTriggerMode"
                                    name="alarmTriggerMode"
                                    value={formData.alarmTriggerMode}
                                    onChange={handleChange}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                >
                                    <option value="relative">Relative to start</option>
                                    <option value="absolute">Absolute datetime</option>
                                </select>
                            </div>
                        </div>
                        {formData.alarmTriggerMode === 'absolute' ? (
                            <div>
                                <Label htmlFor="alarmTriggerAt">Trigger At</Label>
                                <Input
                                    type="datetime-local"
                                    id="alarmTriggerAt"
                                    name="alarmTriggerAt"
                                    value={formData.alarmTriggerAt}
                                    onChange={handleChange}
                                />
                            </div>
                        ) : (
                            <div>
                                <Label htmlFor="alarmTriggerMinutesBefore">Minutes Before Start</Label>
                                <Input
                                    id="alarmTriggerMinutesBefore"
                                    name="alarmTriggerMinutesBefore"
                                    value={formData.alarmTriggerMinutesBefore}
                                    onChange={handleChange}
                                    inputMode="numeric"
                                    placeholder="15"
                                />
                            </div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                                <Label htmlFor="alarmRepeatCount">Repeat Count</Label>
                                <Input
                                    id="alarmRepeatCount"
                                    name="alarmRepeatCount"
                                    value={formData.alarmRepeatCount}
                                    onChange={handleChange}
                                    inputMode="numeric"
                                    placeholder="0"
                                />
                            </div>
                            <div>
                                <Label htmlFor="alarmRepeatDurationMinutes">Repeat Duration (minutes)</Label>
                                <Input
                                    id="alarmRepeatDurationMinutes"
                                    name="alarmRepeatDurationMinutes"
                                    value={formData.alarmRepeatDurationMinutes}
                                    onChange={handleChange}
                                    inputMode="numeric"
                                    placeholder="5"
                                />
                            </div>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Switch
                                id="alarmRepeatUntilAcknowledged"
                                checked={formData.alarmRepeatUntilAcknowledged}
                                onCheckedChange={(checked) => handleBooleanFieldChange('alarmRepeatUntilAcknowledged', checked)}
                            />
                            <Label htmlFor="alarmRepeatUntilAcknowledged">Continue audio until acknowledged</Label>
                        </div>
                    </div>
                )}
            </div>
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
                <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
                    Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Saving...' : formData.id ? 'Update' : 'Add'} Event
                </Button>
            </div>
        </form>
    );
};

export default AddEventForm;
