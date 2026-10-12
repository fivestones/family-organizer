'use client';

// The web app's door to the data layer. Screens import their reads and writes from here.
//
// Which database is behind it is decided by the frame the page is in: `@/lib/data-instant` binds InstantDB, and
// the page on PowerSync binds the signed-in person's local database.
export * from '@family-organizer/data';
