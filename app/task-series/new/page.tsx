// app/task-series/new/page.tsx
'use client';

import React from 'react';
import db from '@/lib/db';
import TaskSeriesEditor from '@/components/task-series/TaskSeriesEditor';

export default function NewTaskSeriesPage() {
    return (
        <TaskSeriesEditor
            db={db}
            initialSeriesId={null} // tells editor: "this is a new series"
        />
    );
}
