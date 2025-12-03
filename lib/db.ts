// lib/db.ts
'use client';

import { init } from '@instantdb/react';
import schema from '@/instant.schema';

const APP_ID = process.env.NEXT_PUBLIC_INSTANT_APP_ID || 'df733414-7ccd-45bd-85f3-ffd0b3da8812';

if (!APP_ID) {
    throw new Error('NEXT_PUBLIC_INSTANT_APP_ID is not defined');
}

// --- Helper to calculate URLs dynamically ---
function getConnectionConfig() {
    // 1. Priority: Use Environment Variables (Production setup)
    if (process.env.NEXT_PUBLIC_INSTANT_API_URI && process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI) {
        return {
            apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI,
            websocketURI: process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI,
        };
    }

    // 2. Development: Dynamic detection
    // We check if 'window' is defined to ensure this doesn't crash during Server-Side Rendering
    if (typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        // If you are on iPhone visiting 192.168.1.5:3000,
        // this sets the DB to 192.168.1.5:8888 automatically.
        return {
            apiURI: `http://${hostname}:8888`,
            websocketURI: `ws://${hostname}:8888/runtime/session`,
        };
    }

    // 3. Fallback (Server-Side Rendering default)
    return {
        apiURI: 'http://localhost:8888',
        websocketURI: 'ws://localhost:8888/runtime/session',
    };
}

const config = getConnectionConfig();

const db = init({
    appId: APP_ID,
    schema, // gives us typed queries / tx
    apiURI: config.apiURI,
    websocketURI: config.websocketURI,
});

export default db;
