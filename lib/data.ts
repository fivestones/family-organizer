// lib/data.ts
'use client';

// The web app's door to the data layer. It binds the implementation once, then re-exports the layer's API.
// Screens import their reads and writes from here.
import { id, tx } from '@instantdb/react';
import { createInstantBackend, setDataBackend } from '@family-organizer/data';
import { db } from '@/lib/db';

setDataBackend(createInstantBackend({ db: db as any, tx, id }));

export * from '@family-organizer/data';
