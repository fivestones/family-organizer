'use client';

import React, { useMemo } from 'react';
import { List } from 'lucide-react';
import { db } from '@/lib/db';
import { registerFreeformWidget } from '@/lib/freeform-dashboard/freeform-widget-registry';
import type { FreeformWidgetProps } from '@/lib/freeform-dashboard/types';
import { buildCalendarPreviews } from '@/lib/dashboard-utils';
import type { DashboardCalendarItem } from '@/lib/dashboard-utils';
import { useWidgetScale } from '@/lib/freeform-dashboard/widget-scale';

function FamilyAgendaWidget({ width, height, todayUtc }: FreeformWidgetProps) {
    const { s, sv } = useWidgetScale();

    const ITEM_HEIGHT = s(44);
    const HEADER_HEIGHT = s(32);
    const padding = s(12);

    const { data } = db.useQuery({
        calendarItems: { pertainsTo: {} },
    });

    const maxItems = Math.max(1, Math.floor((height - HEADER_HEIGHT - padding * 2) / ITEM_HEIGHT));

    const previews = useMemo(() => {
        if (!data?.calendarItems) return [];
        return buildCalendarPreviews(
            data.calendarItems as DashboardCalendarItem[],
            todayUtc,
            null,
            maxItems
        );
    }, [data, todayUtc, maxItems]);

    const dotSize = s(8);

    return (
        <div className="flex h-full flex-col" style={{ padding }}>
            <div className="font-semibold uppercase tracking-wider text-slate-400" style={{ marginBottom: s(8), fontSize: sv(12) }}>
                Upcoming
            </div>

            {previews.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-slate-400" style={{ fontSize: sv(12) }}>
                    No upcoming events
                </div>
            ) : (
                <div className="flex flex-col" style={{ gap: s(4) }}>
                    {previews.map((item) => (
                        <div
                            key={item.id}
                            className="flex items-start rounded-lg hover:bg-slate-50"
                            style={{ gap: s(8), padding: `${s(6)}px ${s(8)}px`, minHeight: ITEM_HEIGHT - s(4) }}
                        >
                            <div
                                className={`shrink-0 rounded-full ${
                                    item.isFamilyWide ? 'bg-blue-400' : 'bg-violet-400'
                                }`}
                                style={{ width: dotSize, height: dotSize, marginTop: s(6) }}
                            />
                            <div className="min-w-0 flex-1">
                                <div className="truncate font-medium text-slate-800" style={{ fontSize: sv(12) }}>{item.title}</div>
                                <div className="text-slate-500" style={{ fontSize: sv(10) }}>{item.timeLabel}</div>
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
