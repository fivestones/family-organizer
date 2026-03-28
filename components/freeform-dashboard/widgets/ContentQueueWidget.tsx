'use client';

import React, { useMemo } from 'react';
import { BookOpen, ExternalLink, Play } from 'lucide-react';
import { db } from '@/lib/db';
import { registerFreeformWidget } from '@/lib/freeform-dashboard/freeform-widget-registry';
import type { FreeformWidgetProps } from '@/lib/freeform-dashboard/types';
import { useWidgetScale } from '@/lib/freeform-dashboard/widget-scale';
import { AttachmentCollection } from '@/components/attachments/AttachmentCollection';
import { checkAndAdvanceCategory, getQueuedItems } from '@/lib/content-queue';

function ContentQueueWidget({ config, width, height, todayUtc }: FreeformWidgetProps) {
    const { s, sv } = useWidgetScale();
    const categorySlug = (config.categorySlug as string) || '';

    const { data } = db.useQuery({
        contentCategories: {
            $: { where: { slug: categorySlug } },
            items: {
                attachments: {},
            },
        },
    });

    const category = useMemo(
        () => (data?.contentCategories ?? [])[0] as any | undefined,
        [data?.contentCategories],
    );

    const items = useMemo(() => (category?.items ?? []) as any[], [category]);

    // Lazy auto-advance on render
    useMemo(() => {
        if (category && items.length > 0) {
            checkAndAdvanceCategory(
                items,
                category,
                new Date(),
                db.tx as any,
                (txs) => db.transact(txs),
            );
        }
    }, [category, items]);

    const liveItem = useMemo(
        () => items.find((i: any) => i.status === 'live') ?? null,
        [items],
    );

    const queuedItems = useMemo(() => getQueuedItems(items), [items]);

    function makeLive() {
        if (queuedItems.length === 0 || !category) return;
        const next = queuedItems[0];
        const duration = next.durationMs ?? category.defaultDurationMs;
        const now = new Date();
        const liveUntil = new Date(now.getTime() + duration).toISOString();
        db.transact(
            (db.tx as any).contentQueueItems[next.id].update({
                status: 'live',
                liveAt: now.toISOString(),
                liveUntil,
                updatedAt: now.toISOString(),
            }),
        );
    }

    if (!categorySlug) {
        return (
            <div
                className="flex h-full items-center justify-center text-slate-400"
                style={{ fontSize: sv(13), padding: s(16) }}
            >
                Configure a category in widget settings
            </div>
        );
    }

    if (!category) {
        return (
            <div
                className="flex h-full items-center justify-center text-slate-400"
                style={{ fontSize: sv(13), padding: s(16) }}
            >
                Category &ldquo;{categorySlug}&rdquo; not found
            </div>
        );
    }

    if (!liveItem) {
        return (
            <div className="flex h-full flex-col" style={{ padding: s(16) }}>
                <div
                    className="font-semibold uppercase tracking-wider text-slate-400"
                    style={{ fontSize: sv(11), marginBottom: s(8) }}
                >
                    {category.name}
                </div>
                <div
                    className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400"
                    style={{ fontSize: sv(13) }}
                >
                    {queuedItems.length > 0 ? (
                        <>
                            <span>
                                {queuedItems.length} item{queuedItems.length !== 1 ? 's' : ''} queued
                            </span>
                            <button
                                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-white hover:bg-blue-700 transition-colors"
                                style={{ fontSize: sv(12) }}
                                onClick={makeLive}
                            >
                                <Play style={{ width: sv(12), height: sv(12) }} />
                                Make Live
                            </button>
                        </>
                    ) : (
                        <span>No current content</span>
                    )}
                </div>
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
                style={{ fontSize: sv(11), marginBottom: s(8) }}
            >
                {category.name}
            </div>

            <div
                className="font-semibold text-slate-900"
                style={{ fontSize: sv(16), marginBottom: s(8) }}
            >
                {liveItem.title}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
                {liveItem.richTextContent && (
                    <div
                        className="prose prose-sm max-w-none text-slate-700"
                        style={{ fontSize: sv(13) }}
                        dangerouslySetInnerHTML={{
                            __html: liveItem.richTextContent,
                        }}
                    />
                )}

                {liveItem.attachments?.length > 0 && (
                    <div style={{ marginTop: s(8) }}>
                        <AttachmentCollection
                            attachments={liveItem.attachments}
                            variant="compact"
                        />
                    </div>
                )}

                {liveItem.linkUrl && (
                    <a
                        href={liveItem.linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center text-blue-600 hover:underline"
                        style={{
                            gap: s(4),
                            marginTop: s(8),
                            fontSize: sv(12),
                        }}
                    >
                        <ExternalLink style={{ width: sv(12), height: sv(12) }} />
                        Open link
                    </a>
                )}
            </div>

            {liveItem.liveUntil && (
                <div
                    className="text-slate-400 pt-1 border-t border-slate-100"
                    style={{ fontSize: sv(10), marginTop: s(8) }}
                >
                    Until{' '}
                    {new Date(liveItem.liveUntil).toLocaleDateString()}
                </div>
            )}
        </div>
    );
}

registerFreeformWidget({
    meta: {
        type: 'content-queue',
        label: 'Content Queue',
        icon: BookOpen,
        description:
            'Displays the current live item from a rotating content queue (e.g., Hymn of the Week)',
        minWidth: 200,
        minHeight: 150,
        defaultWidth: 400,
        defaultHeight: 350,
        allowMultiple: true,
        configFields: [
            {
                key: 'categorySlug',
                label: 'Content Category',
                type: 'content-category',
                required: true,
            },
        ],
    },
    component: ContentQueueWidget,
});

export default ContentQueueWidget;
