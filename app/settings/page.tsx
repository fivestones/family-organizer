'use client';

import React from 'react';
import { init } from '@instantdb/react';
import CurrencySettings from '@/components/CurrencySettings';
import { ParentGate } from '@/components/auth/ParentGate'; // +++ Added

const APP_ID = 'df733414-7ccd-45bd-85f3-ffd0b3da8812';
const db = init({
    appId: APP_ID,
    apiURI: 'http://localhost:8888',
    websocketURI: 'ws://localhost:8888/runtime/session',
});

export default function SettingsPage() {
    return (
        <ParentGate>
            <div className="container mx-auto p-8">
                <h1 className="text-3xl font-bold mb-8">Settings</h1>
                <CurrencySettings db={db} />
            </div>
        </ParentGate>
    );
}
