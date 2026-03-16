'use client';

import React, { useMemo } from 'react';
import AppleCalendarSyncSettings from '@/components/AppleCalendarSyncSettings';
import CurrencySettings from '@/components/CurrencySettings';
import GradeTypeSettings from '@/components/GradeTypeSettings';
import FamilyMembersList from '@/components/FamilyMembersList';
import { ParentGate } from '@/components/auth/ParentGate';
import { db } from '@/lib/db';

export default function SettingsPage() {
    const { data } = db.useQuery({
        familyMembers: {
            $: { order: { order: 'asc' } },
        },
    });

    const familyMembers = useMemo(() => (data?.familyMembers as any[]) || [], [data?.familyMembers]);

    return (
        <ParentGate>
            <div className="container mx-auto max-w-7xl p-8">
                <h1 className="text-3xl font-bold mb-8">Settings</h1>

                <div id="family-member-settings" className="mb-8 scroll-mt-24">
                    <FamilyMembersList
                        familyMembers={familyMembers}
                        db={db}
                        alwaysEditMode
                    />
                </div>

                <CurrencySettings db={db} />

                <div className="mt-8">
                    <GradeTypeSettings />
                </div>

                <div className="mt-8">
                    <AppleCalendarSyncSettings />
                </div>
            </div>
        </ParentGate>
    );
}
