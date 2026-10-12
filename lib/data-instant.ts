'use client';

// Points the data layer at InstantDB. Imported once, by the app's Instant frame, before anything reads from the
// layer. It is deleted, with the rest of the Instant implementation, when the app has moved to PowerSync.
import { id, tx } from '@instantdb/react';
import { createInstantBackend, setDataBackend } from '@family-organizer/data';
import { db } from '@/lib/db';

setDataBackend(createInstantBackend({ db: db as any, tx, id }));
