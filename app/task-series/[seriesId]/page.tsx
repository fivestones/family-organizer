// app/task-series/[seriesId]/page.tsx
'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import db from '@/lib/db';
import TaskSeriesEditor from '@/components/task-series/TaskSeriesEditor';

export default function TaskSeriesDetailPage() {
    const params = useParams();
    const seriesId = params?.seriesId as string | undefined;

    if (!seriesId) {
        return <div className="p-4 text-sm text-red-600">Missing series id.</div>;
    }

    return <TaskSeriesEditor db={db} initialSeriesId={seriesId} />;
}
