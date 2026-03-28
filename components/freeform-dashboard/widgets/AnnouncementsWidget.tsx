'use client';

import React, { useMemo } from 'react';
import { Megaphone, ExternalLink } from 'lucide-react';
import { db } from '@/lib/db';
import { registerFreeformWidget } from '@/lib/freeform-dashboard/freeform-widget-registry';
import type { FreeformWidgetProps } from '@/lib/freeform-dashboard/types';
import { useWidgetScale } from '@/lib/freeform-dashboard/widget-scale';
import { AttachmentCollection } from '@/components/attachments/AttachmentCollection';
import {
    checkAnnouncementExpiry,
    getActiveAnnouncements,
} from '@/lib/announcement-utils';

function AnnouncementsWidget({ width, height, todayUtc }: FreeformWidgetProps) {
    const { s, sv } = useWidgetScale();

    const { data } = db.useQuery({
        announcements: {
            attachments: {},
        },
    });

    const allAnnouncements = useMemo(
        () => (data?.announcements ?? []) as any[],
        [data?.announcements],
    );

    // Lazy expiry check
    useMemo(() => {
        if (allAnnouncements.length > 0) {
            checkAnnouncementExpiry(
                allAnnouncements,
                new Date(),
                db.tx as any,
                (txs) => db.transact(txs),
            );
        }
    }, [allAnnouncements]);

    const active = useMemo(
        () => getActiveAnnouncements(allAnnouncements),
        [allAnnouncements],
    );

    if (active.length === 0) {
        return (
            <div
                className="flex h-full items-center justify-center text-slate-400"
                style={{ fontSize: sv(13), padding: s(16) }}
            >
                No announcements
            </div>
        );
    }

    return (
        <div
            className="flex h-full flex-col overflow-hidden"
            style={{ padding: s(16) }}
        >
            <div
                className="font-semibold uppercase tracking-wider text-slate-400"
                style={{ fontSize: sv(11), marginBottom: s(12) }}
            >
                Announcements
            </div>

            <div className="flex-1 overflow-y-auto min-h-0 space-y-3">
                {active.map((ann) => (
                    <div
                        key={ann.id}
                        className="rounded-lg border border-amber-100 bg-amber-50/50"
                        style={{ padding: s(12) }}
                    >
                        <div
                            className="font-medium text-slate-900 flex items-center"
                            style={{
                                fontSize: sv(14),
                                gap: s(6),
                                marginBottom: s(4),
                            }}
                        >
                            <Megaphone
                                className="text-amber-500 flex-shrink-0"
                                style={{
                                    width: sv(14),
                                    height: sv(14),
                                }}
                            />
                            {ann.title}
                        </div>

                        {ann.richTextContent && (
                            <div
                                className="prose prose-sm max-w-none text-slate-600"
                                style={{ fontSize: sv(13) }}
                                dangerouslySetInnerHTML={{
                                    __html: ann.richTextContent,
                                }}
                            />
                        )}

                        {ann.linkUrl && (
                            <a
                                href={ann.linkUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center text-blue-600 hover:underline"
                                style={{
                                    gap: s(4),
                                    marginTop: s(4),
                                    fontSize: sv(11),
                                }}
                            >
                                <ExternalLink
                                    style={{
                                        width: sv(11),
                                        height: sv(11),
                                    }}
                                />
                                Link
                            </a>
                        )}

                        {ann.attachments?.length > 0 && (
                            <div style={{ marginTop: s(8) }}>
                                <AttachmentCollection
                                    attachments={ann.attachments}
                                    variant="compact"
                                />
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

registerFreeformWidget({
    meta: {
        type: 'announcements',
        label: 'Announcements',
        icon: Megaphone,
        description:
            'Displays active family announcements with rich text and attachments',
        minWidth: 200,
        minHeight: 120,
        defaultWidth: 400,
        defaultHeight: 300,
        allowMultiple: false,
    },
    component: AnnouncementsWidget,
});

export default AnnouncementsWidget;
