'use client';

import React, { useMemo } from 'react';
import { MessageCircle } from 'lucide-react';
import { db } from '@/lib/db';
import { registerFreeformWidget } from '@/lib/freeform-dashboard/freeform-widget-registry';
import type { FreeformWidgetProps } from '@/lib/freeform-dashboard/types';
import { formatTimeAgo, getPhotoUrl, toInitials } from '@/lib/dashboard-utils';
import type { DashboardFamilyMember } from '@/lib/dashboard-utils';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const MESSAGE_HEIGHT = 52;
const HEADER_HEIGHT = 32;

function FamilyChatWidget({ width, height, todayUtc }: FreeformWidgetProps) {
    const { data } = db.useQuery({
        messageThreads: {
            messages: {
                $: { order: { createdAt: 'desc' }, limit: 20 },
                author: {},
            },
        },
        familyMembers: {},
    });

    const maxMessages = Math.max(1, Math.floor((height - HEADER_HEIGHT) / MESSAGE_HEIGHT));

    const messages = useMemo(() => {
        if (!data?.messageThreads) return [];

        // Find the family general thread
        const familyThread = data.messageThreads.find(
            (t) => (t as Record<string, unknown>).threadKey === 'family'
        );
        if (!familyThread?.messages) return [];

        const membersMap = new Map(
            ((data.familyMembers ?? []) as any[]).map((m) => [m.id, m])
        );

        return familyThread.messages
            .filter((m) => !(m as Record<string, unknown>).deletedAt)
            .slice(0, maxMessages)
            .map((msg) => {
                const authorId = (msg as Record<string, unknown>).authorFamilyMemberId as string | undefined;
                const author = authorId ? membersMap.get(authorId) : undefined;
                return {
                    id: msg.id,
                    body: (msg as Record<string, unknown>).body as string || '',
                    createdAt: (msg as Record<string, unknown>).createdAt as string,
                    authorName: author?.name || 'Unknown',
                    authorPhotoUrl: author ? getPhotoUrl(author as DashboardFamilyMember) : undefined,
                    authorInitials: toInitials(author?.name),
                };
            })
            .reverse(); // Show oldest first (chronological)
    }, [data, maxMessages]);

    return (
        <div className="flex h-full flex-col p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <MessageCircle size={12} />
                Family Chat
            </div>

            {messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center text-xs text-slate-400">
                    No messages yet
                </div>
            ) : (
                <div className="flex flex-col gap-1">
                    {messages.map((msg) => (
                        <div key={msg.id} className="flex items-start gap-2 py-1" style={{ minHeight: MESSAGE_HEIGHT - 8 }}>
                            <Avatar className="mt-0.5 h-6 w-6 shrink-0">
                                <AvatarImage src={msg.authorPhotoUrl} />
                                <AvatarFallback className="text-[9px]">{msg.authorInitials}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-1.5">
                                    <span className="text-xs font-medium text-slate-700">{msg.authorName}</span>
                                    <span className="text-[10px] text-slate-400">{formatTimeAgo(msg.createdAt)}</span>
                                </div>
                                <div className="line-clamp-2 text-xs leading-relaxed text-slate-600">{msg.body}</div>
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
        type: 'family-chat',
        label: 'Family Chat',
        icon: MessageCircle,
        description: 'Recent messages from the family general chat thread',
        minWidth: 250,
        minHeight: 200,
        defaultWidth: 350,
        defaultHeight: 300,
        allowMultiple: false,
    },
    component: FamilyChatWidget,
});

export default FamilyChatWidget;
