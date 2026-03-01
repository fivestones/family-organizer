'use client';

import React from 'react';
import CurrencySettings from '@/components/CurrencySettings';
import { ParentGate } from '@/components/auth/ParentGate'; // +++ Added
import { db } from '@/lib/db';

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
