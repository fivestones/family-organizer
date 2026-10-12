'use client';

// The app's frame on InstantDB: the session and auth providers, the header, and the gate that waits for someone
// to be signed in. Importing the data binding here is what points the data layer at InstantDB, before anything
// inside reads from it.
import '@/lib/data-instant';

import Link from 'next/link';
import { AuthProvider } from '@/components/AuthProvider';
import { FamilyAppGate } from '@/components/auth/FamilyAppGate';
import { UserMenu } from '@/components/auth/UserMenu';
import CalendarHeaderControls from '@/components/CalendarHeaderControls';
import DashboardRouteViewPill from '@/components/dashboard/DashboardRouteViewPill';
import DebugTimeWidget from '@/components/debug/DebugTimeWidget';
import DashboardEditButton from '@/components/freeform-dashboard/DashboardEditButton';
import { InstantFamilySessionProvider } from '@/components/InstantFamilySessionProvider';
import { MainNav } from '@/components/MainNav';
import { MessageNotificationBridge } from '@/components/messages/MessageNotificationBridge';
import NavbarDate from '@/components/NavbarDate';
import { PwaServiceWorkerRegistration } from '@/components/PwaServiceWorkerRegistration';
import { SyncStatusBadge } from '@/components/SyncStatusBadge';
import { ThemedHeader, ThemedMain } from '@/components/ThemedAppShell';
import { Toaster } from '@/components/ui/toaster';
import { DashboardThemeProvider } from '@/lib/freeform-dashboard/DashboardThemeContext';

export default function InstantAppShell({ children }: { children: React.ReactNode }) {
    return (
        <InstantFamilySessionProvider>
            <AuthProvider>
                <DashboardThemeProvider>
                    {/* +++ Global Header +++ */}
                    <ThemedHeader>
                        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-6">
                            <Link href="/" className="shrink-0 whitespace-nowrap text-lg font-bold tracking-tight transition-opacity hover:opacity-80 sm:text-xl">
                                Family Organizer
                            </Link>
                            <MainNav className="min-w-0 flex-1" />
                        </div>
                        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                            <CalendarHeaderControls />
                            <DashboardRouteViewPill />
                            <DashboardEditButton />
                            <SyncStatusBadge />
                            <NavbarDate />
                            <UserMenu />
                        </div>
                    </ThemedHeader>

                    {/* +++ Main Content +++ */}
                    <ThemedMain>
                        <FamilyAppGate>{children}</FamilyAppGate>
                    </ThemedMain>

                    <Toaster />
                    <DebugTimeWidget />
                    <MessageNotificationBridge />
                    <PwaServiceWorkerRegistration />
                </DashboardThemeProvider>
            </AuthProvider>
        </InstantFamilySessionProvider>
    );
}
