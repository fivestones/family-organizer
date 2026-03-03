'use client';

import React, { useMemo } from 'react';
import CurrencySettings from '@/components/CurrencySettings';
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
            <div className="container mx-auto p-8">
                <h1 className="text-3xl font-bold mb-8">Settings</h1>

                <div className="mb-8 max-w-md">
                    <FamilyMembersList
                        familyMembers={familyMembers}
                        db={db}
                        alwaysEditMode
                    />
                </div>

                <CurrencySettings db={db} />
            </div>
        </ParentGate>
    );
}
