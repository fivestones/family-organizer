// app/task-series/page.tsx
'use client';

import React from 'react';
import db from '@/lib/db';
import TaskSeriesManager from '@/components/task-series/TaskSeriesManager';

export default function TaskSeriesPage() {
    return <TaskSeriesManager db={db} />;
}
