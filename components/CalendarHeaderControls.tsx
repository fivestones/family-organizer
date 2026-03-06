'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
    CALENDAR_COMMAND_EVENT,
    CALENDAR_DAY_HEIGHT_DEFAULT,
    CALENDAR_DAY_HEIGHT_MAX,
    CALENDAR_DAY_HEIGHT_MIN,
    CALENDAR_DAY_HEIGHT_STORAGE_KEY,
    CALENDAR_STATE_EVENT,
    CALENDAR_VISIBLE_WEEKS_MAX,
    CALENDAR_VISIBLE_WEEKS_MIN,
    type CalendarCommandDetail,
    type CalendarStateDetail,
} from '@/lib/calendar-controls';

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const dispatchCalendarCommand = (detail: CalendarCommandDetail) => {
    window.dispatchEvent(new CustomEvent<CalendarCommandDetail>(CALENDAR_COMMAND_EVENT, { detail }));
};

export default function CalendarHeaderControls() {
    const pathname = usePathname();
    const isCalendarRoute = useMemo(() => pathname?.startsWith('/calendar') ?? false, [pathname]);
    const [dayHeight, setDayHeight] = useState(CALENDAR_DAY_HEIGHT_DEFAULT);
    const [visibleWeeks, setVisibleWeeks] = useState(6);

    useEffect(() => {
        if (!isCalendarRoute) return;

        const stored = window.localStorage.getItem(CALENDAR_DAY_HEIGHT_STORAGE_KEY);
        if (!stored) return;

        const parsed = Number(stored);
        if (!Number.isFinite(parsed)) return;

        setDayHeight(clampNumber(Math.round(parsed), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX));
    }, [isCalendarRoute]);

    useEffect(() => {
        if (!isCalendarRoute) return;

        const onCalendarState = (event: Event) => {
            const detail = (event as CustomEvent<CalendarStateDetail>).detail;
            if (!detail) return;
            setDayHeight(clampNumber(Math.round(detail.dayHeight), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX));
            setVisibleWeeks(clampNumber(Math.round(detail.visibleWeeks), CALENDAR_VISIBLE_WEEKS_MIN, CALENDAR_VISIBLE_WEEKS_MAX));
        };

        window.addEventListener(CALENDAR_STATE_EVENT, onCalendarState);
        dispatchCalendarCommand({ type: 'requestState' });

        return () => {
            window.removeEventListener(CALENDAR_STATE_EVENT, onCalendarState);
        };
    }, [isCalendarRoute]);

    if (!isCalendarRoute) {
        return null;
    }

    return (
        <div className="flex items-center gap-2">
            <Popover>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                        <SlidersHorizontal className="h-4 w-4" />
                        Settings
                    </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72">
                    <div className="grid gap-4">
                        <div className="space-y-1">
                            <h4 className="text-sm font-semibold leading-none">Calendar Settings</h4>
                            <p className="text-xs text-muted-foreground">Adjust day height or weeks visible.</p>
                        </div>

                        <div className="grid gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <Label htmlFor="calendar-day-height-header">Day Height</Label>
                                <span className="text-xs text-muted-foreground">{dayHeight}px</span>
                            </div>
                            <input
                                id="calendar-day-height-header"
                                type="range"
                                min={CALENDAR_DAY_HEIGHT_MIN}
                                max={CALENDAR_DAY_HEIGHT_MAX}
                                step={2}
                                value={dayHeight}
                                onChange={(event) => {
                                    const next = clampNumber(Number(event.target.value), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX);
                                    setDayHeight(next);
                                    dispatchCalendarCommand({ type: 'setDayHeight', dayHeight: next });
                                }}
                            />
                        </div>

                        <div className="grid gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <Label htmlFor="calendar-weeks-visible-header">Weeks Visible</Label>
                                <span className="text-xs text-muted-foreground">{visibleWeeks}</span>
                            </div>
                            <input
                                id="calendar-weeks-visible-header"
                                type="range"
                                min={CALENDAR_VISIBLE_WEEKS_MIN}
                                max={CALENDAR_VISIBLE_WEEKS_MAX}
                                step={1}
                                value={visibleWeeks}
                                onChange={(event) => {
                                    const next = clampNumber(
                                        Number(event.target.value),
                                        CALENDAR_VISIBLE_WEEKS_MIN,
                                        CALENDAR_VISIBLE_WEEKS_MAX
                                    );
                                    setVisibleWeeks(next);
                                    dispatchCalendarCommand({ type: 'setVisibleWeeks', visibleWeeks: next });
                                }}
                            />
                            <p className="text-xs text-muted-foreground">Approx. days visible: {visibleWeeks * 7}</p>
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            <Button variant="outline" size="sm" onClick={() => dispatchCalendarCommand({ type: 'scrollToday' })}>
                Today
            </Button>

            <Button variant="default" size="icon" aria-label="Add event" onClick={() => dispatchCalendarCommand({ type: 'quickAdd' })}>
                <Plus className="h-4 w-4" />
            </Button>
        </div>
    );
}
