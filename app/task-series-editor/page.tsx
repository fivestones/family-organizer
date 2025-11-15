// app/task-series-editor/page.tsx
'use client';

import React from 'react';
import TaskSeriesEditor from '@/components/task-series/TaskSeriesEditor'; // Adjust path as necessary
import { init } from '@instantdb/react';
import type { AppSchema } from '@/instant.schema'; // Adjust path

// Initialize DB connection - this could also be done in a central db.ts and imported
const APP_ID = process.env.NEXT_PUBLIC_INSTANT_APP_ID || 'df733414-7ccd-45bd-85f3-ffd0b3da8812';

if (!APP_ID) {
    throw new Error('NEXT_PUBLIC_INSTANT_APP_ID is not defined');
}

const db = init({
    appId: APP_ID,
    apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI || 'http://localhost:8888',
    websocketURI: process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI || 'ws://localhost:8888/runtime/session',
});

// This page component will likely evolve to handle routing parameters
// e.g., /app/task-series-editor/[seriesId] for editing
// or /app/task-series-editor/new?familyMemberId=... for creating for a specific member

export default function TaskSeriesEditorPage() {
    // For now, let's simulate how props might be passed.
    // In a real scenario, these would come from route params, query params, or parent component state.
    const seriesIdFromParams = null; // Example: router.query.seriesId as string | undefined;
    const familyMemberIdFromParams = null; // Example: router.query.familyMemberId as string | undefined;

    const handleClose = () => {
        // Logic to navigate away or close a modal, depending on context
        console.log('TaskSeriesEditor indicated close/finish');
        // Example: router.push('/some-other-page');
    };

    return <TaskSeriesEditor db={db} initialSeriesId={seriesIdFromParams} initialFamilyMemberId={familyMemberIdFromParams} onClose={handleClose} />;
}
