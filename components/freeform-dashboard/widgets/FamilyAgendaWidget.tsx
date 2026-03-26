'use client';

import React, { useMemo } from 'react';
import { List } from 'lucide-react';
import { db } from '@/lib/db';
import { registerFreeformWidget } from '@/lib/freeform-dashboard/freeform-widget-registry';
import type { FreeformWidgetProps } from '@/lib/freeform-dashboard/types';
import { buildCalendarPreviews } from '@/lib/dashboard-utils';
import type { DashboardCalendarItem } from '@/lib/dashboard-utils';

const ITEM_HEIGHT = 44;
const HEADER_HEIGHT = 32;

function FamilyAgendaWidget({ width, height, todayUtc }: FreeformWidgetProps) {
    const { data } = db.useQuery({
        calendarItems: { pertainsTo: {} },
    });

    const maxItems = Math.max(1, Math.floor((height - HEADER_HEIGHT) / ITEM_HEIGHT));

    const previews = useMemo(() => {
        if (!data?.calendarItems) return [];
        return buildCalendarPreviews(
            data.calendarItems as DashboardCalendarItem[],
            todayUtc,
            null,
            maxItems
        );
    }, [data, todayUtc, maxItems]);

    return (
        <div className="flex h-full flex-col p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Upcoming
            </div>

            {previews.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-xs text-slate-400">
                    No upcoming events
                </div>
            ) : (
                <div className="flex flex-col gap-1">
                    {previews.map((item) => (
                        <div
                            key={item.id}
                            className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                            style={{ minHeight: ITEM_HEIGHT - 4 }}
                        >
                            <div
                                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                                    item.isFamilyWide ? 'bg-blue-400' : 'bg-violet-400'
                                }`}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-slate-800">{item.title}</div>
                                <div className="text-[10px] text-slate-500">{item.timeLabel}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

registerFreeformWidget({
    meta: {
        type: 'family-agenda',
        label: 'Family Agenda',
        icon: List,
        description: 'Upcoming calendar events for the whole family',
        minWidth: 200,
        minHeight: 150,
        defaultWidth: 350,
        defaultHeight: 300,
        allowMultiple: false,
    },
    component: FamilyAgendaWidget,
});

export default FamilyAgendaWidget;
