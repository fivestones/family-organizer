'use client';

import CountdownSettings from '@/components/CountdownSettings';
import CurrencySettings from '@/components/CurrencySettings';
import DashboardThemeSelector from '@/components/freeform-dashboard/DashboardThemeSelector';
import FamilyMembersList from './family/FamilyMembersList';
import { ParentOnly } from './ParentOnly';

/** Everything a parent sets up for the household, in the order the old page has it. */
export function SettingsPage() {
    return (
        <ParentOnly>
            <div className="container mx-auto max-w-7xl p-8" data-testid="settings">
                <h1 className="mb-8 text-3xl font-bold">Settings</h1>

                <div id="family-member-settings" className="mb-8 scroll-mt-24">
                    <FamilyMembersList alwaysEditMode />
                </div>

                <div className="mb-8">
                    <DashboardThemeSelector />
                </div>

                <CurrencySettings />

                <div className="mt-8">
                    <CountdownSettings />
                </div>
            </div>
        </ParentOnly>
    );
}
