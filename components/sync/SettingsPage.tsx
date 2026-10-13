'use client';

import CountdownSettings from '@/components/CountdownSettings';
import CurrencySettings from '@/components/CurrencySettings';
import { ParentOnly } from './ParentOnly';

export function SettingsPage() {
    return (
        <ParentOnly>
            <div className="container mx-auto max-w-7xl p-8" data-testid="settings">
                <h1 className="mb-8 text-3xl font-bold">Settings</h1>
                <CurrencySettings />
                <div className="mt-8">
                    <CountdownSettings />
                </div>
            </div>
        </ParentOnly>
    );
}
