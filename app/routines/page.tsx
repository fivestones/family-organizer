'use client';

import React from 'react';
import RoutineManager from '@/components/routines/RoutineManager';
import { ParentGate } from '@/components/auth/ParentGate';

export default function RoutinesPage() {
    return (
        <ParentGate>
            <RoutineManager />
        </ParentGate>
    );
}
