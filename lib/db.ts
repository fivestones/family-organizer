// lib/db.ts
'use client';

import { init } from '@instantdb/react';
import schema from '@/instant.schema';

const APP_ID = process.env.NEXT_PUBLIC_INSTANT_APP_ID || 'df733414-7ccd-45bd-85f3-ffd0b3da8812';

if (!APP_ID) {
    throw new Error('NEXT_PUBLIC_INSTANT_APP_ID is not defined');
}

const db = init({
    appId: APP_ID,
    schema, // gives us typed queries / tx
    apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI || 'http://localhost:8888',
    websocketURI: process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI || 'ws://localhost:8888/runtime/session',
});

export default db;
