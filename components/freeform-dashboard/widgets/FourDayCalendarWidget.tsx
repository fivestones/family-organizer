'use client';

import React, { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { db } from '@/lib/db';
import { registerFreeformWidget } from '@/lib/freeform-dashboard/freeform-widget-registry';
import type { FreeformWidgetProps } from '@/lib/freeform-dashboard/types';
import { addUtcDays } from '@/lib/dashboard-utils';

interface CalendarEvent {
    id: string;
    title: string;
    startDate: Date;
    endDate: Date;
    isAllDay: boolean;
    dayIndex: number;
    startHour: number;
    durationHours: number;
}

const HOURS_START = 6;
const HOURS_END = 22;
const HOUR_HEIGHT = 40;

function FourDayCalendarWidget({ width, height, todayUtc }: FreeformWidgetProps) {
    const rangeEnd = addUtcDays(todayUtc, 4);

    const { data } = db.useQuery({
        calendarItems: {},
    });

    const days = useMemo(() => {
        const result: Date[] = [];
        for (let i = 0; i < 4; i++) {
            result.push(addUtcDays(todayUtc, i));
        }
        return result;
    }, [todayUtc]);

    const events: CalendarEvent[] = useMemo(() => {
        if (!data?.calendarItems) return [];

        return (data.calendarItems as any[])
            .map((item: any) => {
                const start = new Date(item.startDate);
                const end = new Date(item.endDate);
                const dayIndex = days.findIndex(
                    (d) =>
                        start.getFullYear() === d.getUTCFullYear() &&
                        start.getMonth() === d.getUTCMonth() &&
                        start.getDate() === d.getUTCDate()
                );
                if (dayIndex === -1) return null;

                const startHour = start.getHours() + start.getMinutes() / 60;
                const durationHours = Math.max(0.5, (end.getTime() - start.getTime()) / 3600000);

                return {
                    id: item.id,
                    title: item.title,
                    startDate: start,
                    endDate: end,
                    isAllDay: item.isAllDay,
                    dayIndex,
                    startHour,
                    durationHours,
                };
            })
            .filter((e): e is CalendarEvent => e !== null);
    }, [data, days]);

    // Current time indicator
    const now = new Date();
    const nowHour = now.getHours() + now.getMinutes() / 60;
    const isNowVisible = nowHour >= HOURS_START && nowHour <= HOURS_END;
    const nowOffset = (nowHour - HOURS_START) * HOUR_HEIGHT;

    const headerHeight = 32;
    const dayColumnWidth = Math.floor((width - 40) / 4); // 40px for hour labels

    // How many hours can we show?
    const visibleHours = Math.min(HOURS_END - HOURS_START, Math.floor((height - headerHeight) / HOUR_HEIGHT));

    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* Day headers */}
            <div className="flex shrink-0 border-b border-slate-100" style={{ height: headerHeight }}>
                <div className="w-10 shrink-0" />
                {days.map((day, i) => {
                    const isToday = i === 0;
                    const label = day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
                    return (
                        <div
                            key={i}
                            className={`flex items-center justify-center text-xs font-medium ${isToday ? 'text-blue-600' : 'text-slate-500'}`}
                            style={{ width: dayColumnWidth }}
                        >
                            {label}
                        </div>
                    );
                })}
            </div>

            {/* Time grid */}
            <div className="relative flex-1 overflow-hidden">
                {/* Hour lines */}
                {Array.from({ length: visibleHours }, (_, i) => {
                    const hour = HOURS_START + i;
                    const label = hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`;
                    return (
                        <div
                            key={hour}
                            className="absolute left-0 right-0 flex items-start border-t border-slate-100"
                            style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                        >
                            <span className="w-10 shrink-0 pr-1 text-right text-[10px] text-slate-400">{label}</span>
                        </div>
                    );
                })}

                {/* Events */}
                {events
                    .filter((e) => !e.isAllDay)
                    .map((event) => {
                        const top = (event.startHour - HOURS_START) * HOUR_HEIGHT;
                        const eventHeight = Math.max(20, event.durationHours * HOUR_HEIGHT);
                        const left = 40 + event.dayIndex * dayColumnWidth + 2;
                        const eventWidth = dayColumnWidth - 4;

                        if (top < 0 || top > visibleHours * HOUR_HEIGHT) return null;

                        return (
                            <div
                                key={event.id}
                                className="absolute overflow-hidden rounded bg-blue-100 px-1 py-0.5 text-[10px] leading-tight text-blue-700"
                                style={{ top, left, width: eventWidth, height: eventHeight }}
                                title={event.title}
                            >
                                {event.title}
                            </div>
                        );
                    })}

                {/* Now line */}
                {isNowVisible && (
                    <div
                        className="pointer-events-none absolute left-10 right-0 flex items-center"
                        style={{ top: nowOffset }}
                    >
                        <div className="h-2 w-2 rounded-full bg-red-500" />
                        <div className="h-px flex-1 bg-red-500" />
                    </div>
                )}
            </div>
        </div>
    );
}

registerFreeformWidget({
    meta: {
        type: 'four-day-calendar',
        label: '4-Day Calendar',
        icon: CalendarDays,
        description: 'Hourly calendar view spanning the next 4 days with a now indicator',
        minWidth: 400,
        minHeight: 300,
        defaultWidth: 500,
        defaultHeight: 350,
        allowMultiple: false,
    },
    component: FourDayCalendarWidget,
});

export default FourDayCalendarWidget;
