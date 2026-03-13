'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import FamilyChoreTracker from '@/components/ChoresTracker';

export default function TasksPage() {
    const searchParams = useSearchParams();

    return (
        <FamilyChoreTracker
            pageMode="tasks"
            initialSelectedMember={searchParams.get('member')}
            initialSelectedDate={searchParams.get('date')}
            focusedChoreId={searchParams.get('choreId')}
        />
    );
}
