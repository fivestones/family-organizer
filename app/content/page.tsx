'use client';

import React, { useState } from 'react';
import { BookOpen, Megaphone, Scale } from 'lucide-react';
import { ParentGate } from '@/components/auth/ParentGate';
import { ContentCategoryManager } from '@/components/content/ContentCategoryManager';
import { AnnouncementManager } from '@/components/content/AnnouncementManager';
import { FamilyRulesManager } from '@/components/content/FamilyRulesManager';
import { cn } from '@/lib/utils';

type Tab = 'content' | 'announcements' | 'rules';

const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    {
        id: 'content',
        label: 'Content Queues',
        icon: <BookOpen className="h-4 w-4" />,
    },
    {
        id: 'announcements',
        label: 'Announcements',
        icon: <Megaphone className="h-4 w-4" />,
    },
    {
        id: 'rules',
        label: 'Family Rules',
        icon: <Scale className="h-4 w-4" />,
    },
];

export default function ContentPage() {
    const [activeTab, setActiveTab] = useState<Tab>('content');

    return (
        <ParentGate>
            <div className="container mx-auto max-w-5xl p-8">
                <h1 className="text-3xl font-bold mb-6">
                    Content &amp; Culture
                </h1>

                {/* Tab navigation */}
                <div className="flex gap-1 border-b border-slate-200 mb-6">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            onClick={() => setActiveTab(tab.id)}
                            className={cn(
                                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                                activeTab === tab.id
                                    ? 'border-blue-500 text-blue-600'
                                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                            )}
                        >
                            {tab.icon}
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Tab content */}
                {activeTab === 'content' && <ContentCategoryManager />}
                {activeTab === 'announcements' && <AnnouncementManager />}
                {activeTab === 'rules' && <FamilyRulesManager />}
            </div>
        </ParentGate>
    );
}
