'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CloudOff, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { bindDevice } from '@family-organizer/data/powersync';
import { SessionManager, type SessionSnapshot } from '@family-organizer/data/session/manager';
import type { InstallationConfig } from '@family-organizer/data/session/platform';
import { MainNav } from '@/components/MainNav';
import NavbarDate from '@/components/NavbarDate';
import { PwaServiceWorkerRegistration } from '@/components/PwaServiceWorkerRegistration';
import { ThemedHeader, ThemedMain } from '@/components/ThemedAppShell';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/toaster';
import { principalKey, useFamilyMembers, type Principal } from '@/lib/data';
import { DashboardThemeProvider } from '@/lib/freeform-dashboard/DashboardThemeContext';
import { createWebPlatform, missingBrowserFeatures, type StorageMode } from '@/lib/powersync/web-platform';
import { cn } from '@/lib/utils';
import { PersonSwitcher } from './PersonSwitcher';
import { RefusalList } from './RefusalList';
import { SessionProvider } from './session';
import { SyncBadge } from './SyncBadge';
import { useOfflineStart } from './useOfflineStart';

// The frame of the app on PowerSync: it starts the session manager, signs this device in, points the data layer at
// the signed-in person's local database, and draws the header every page shares. A page is what it is given to
// show (docs/powersync-migration.md, "How the app gets there").

type Started =
    | { phase: 'ready'; manager: SessionManager; storageMode: StorageMode }
    | { phase: 'unsupported'; missing: string[] }
    | { phase: 'elsewhere' }
    | { phase: 'failed'; message: string };

const CONFIG_KEY = 'family-organizer.client-config';
/** How long a parent who stepped in on a shared device may leave it alone before being signed out. */
const SHARED_DEVICE_IDLE_MS = 15 * 60 * 1000;

/** What the server says this deployment runs on. The last answer is kept, so the app can start with no network. */
async function loadConfig(): Promise<(InstallationConfig & { backend: string }) | { backend: 'instant' } | null> {
    try {
        const response = await fetch('/api/client-config', { cache: 'no-store', credentials: 'same-origin' });
        if (response.ok) {
            const config = await response.json();
            window.localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
            return config;
        }
    } catch {
        // No network: fall back to what the server said last time.
    }
    try {
        const kept = window.localStorage.getItem(CONFIG_KEY);
        return kept ? JSON.parse(kept) : null;
    } catch {
        return null;
    }
}

// Started once for the page, not once per render: React runs an effect twice in development, and a database must
// not be opened twice.
let starting: Promise<Started> | null = null;
function start(): Promise<Started> {
    starting ??= (async (): Promise<Started> => {
        try {
            const missing = missingBrowserFeatures();
            if (missing.length) return { phase: 'unsupported', missing };
            const config = await loadConfig();
            if (!config) return { phase: 'failed', message: 'This device is offline and has not been set up yet. Connect it once to get started.' };
            if (config.backend !== 'powersync' || !('installationId' in config)) return { phase: 'elsewhere' };
            const web = await createWebPlatform();
            const manager = await SessionManager.start(web.platform, config);
            web.onOtherTabChanged(() => void manager.reload());
            window.addEventListener('online', () => void manager.reconnected());
            return { phase: 'ready', manager, storageMode: web.storageMode };
        } catch (error) {
            return { phase: 'failed', message: error instanceof Error ? error.message : 'The app could not start.' };
        }
    })();
    return starting;
}

function Notice({ children, tone = 'plain' }: { children: React.ReactNode; tone?: 'plain' | 'warning' }) {
    return (
        <div className={cn('rounded-xl border px-4 py-3 text-sm', tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-950' : 'bg-card text-card-foreground')}>{children}</div>
    );
}

function Centered({ children }: { children: React.ReactNode }) {
    return <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

const personName = (principal: Principal, names: ReadonlyMap<string, string>) => (principal.familyMemberId ? names.get(principal.familyMemberId) ?? 'someone' : 'the shared sign-in');

function SignedIn({ manager, snapshot, storageMode, children }: { manager: SessionManager; snapshot: SessionSnapshot; storageMode: StorageMode; children: React.ReactNode }) {
    const device = snapshot.device!;
    const { principal } = device;
    const { data: members } = useFamilyMembers();
    const names = useMemo(() => new Map(members.map((member) => [member.id, member.name])), [members]);

    // A parent who stepped in on a shared device is signed out again after a while without touching it.
    useEffect(() => {
        if (!snapshot.steppedIn) return undefined;
        let timer = window.setTimeout(() => void manager.signOut(), SHARED_DEVICE_IDLE_MS);
        const touched = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void manager.signOut(), SHARED_DEVICE_IDLE_MS);
        };
        window.addEventListener('pointerdown', touched);
        window.addEventListener('keydown', touched);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener('pointerdown', touched);
            window.removeEventListener('keydown', touched);
        };
    }, [manager, snapshot.steppedIn]);

    const notices = (
        <>
            {storageMode === 'memory' ? (
                <Notice tone="warning">This browser will not let the app keep anything. It works while you are online, and forgets everything when you close it.</Notice>
            ) : null}
            {snapshot.waiting.map((waiting) => (
                <Notice key={principalKey(waiting.principal)} tone="warning">
                    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="waiting-changes">
                        <p>
                            {waiting.count === 1 ? '1 change' : `${waiting.count} changes`} by {personName(waiting.principal, names)} {waiting.count === 1 ? 'is' : 'are'} waiting for them to sign in on this device again.
                        </p>
                        {principal.type === 'parent' ? (
                            <Button variant="outline" size="sm" onClick={() => void manager.discardWaiting(waiting.principal)}>
                                Discard
                            </Button>
                        ) : null}
                    </div>
                </Notice>
            ))}
            {snapshot.stranded.length ? (
                <Notice tone="warning">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <p>
                            {snapshot.stranded.reduce((sum, stranded) => sum + stranded.count, 0)} changes made on this device before the family’s data was replaced could not be sent. They will need to be made again.
                        </p>
                        <Button variant="outline" size="sm" onClick={() => void manager.discardStranded()}>
                            Got it
                        </Button>
                    </div>
                </Notice>
            ) : null}
            <RefusalList />
        </>
    );

    return (
        <SessionProvider manager={manager} snapshot={snapshot}>
            <DashboardThemeProvider>
                <div className="flex h-full flex-col">
                    <ThemedHeader>
                        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-6">
                            <Link href="/" className="shrink-0 whitespace-nowrap text-lg font-bold tracking-tight transition-opacity hover:opacity-80 sm:text-xl">
                                Family Organizer
                            </Link>
                            <MainNav className="min-w-0 flex-1" />
                        </div>
                        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
                            <SyncBadge db={device.db} />
                            <NavbarDate />
                            <PersonSwitcher manager={manager} principal={principal} steppedIn={snapshot.steppedIn} />
                        </div>
                    </ThemedHeader>
                    <ThemedMain>
                        {/* What the device has to say about itself sits above whichever page is open, and takes no room when there is nothing. */}
                        <div className="mx-auto w-full max-w-3xl space-y-3 px-4 empty:hidden sm:px-6 [&:not(:empty)]:pt-4" data-testid="device-notices">
                            {notices}
                        </div>
                        {children}
                    </ThemedMain>
                </div>
            </DashboardThemeProvider>
        </SessionProvider>
    );
}

function Ready({ manager, storageMode, children }: { manager: SessionManager; storageMode: StorageMode; children: React.ReactNode }) {
    const snapshot = useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
    const [problem, setProblem] = useState<string | null>(null);
    const device = snapshot.device;

    // With nobody signed in, a device takes the shared sign-in any activated device may have, which is what it
    // needs to be sent the family's roster and offer the list of people.
    useEffect(() => {
        if (device) return undefined;
        let cancelled = false;
        const attempt = () =>
            manager.signIn().then(
                () => !cancelled && setProblem(null),
                () => !cancelled && setProblem('This device is offline and nobody is signed in. It will carry on when it is back online.')
            );
        void attempt();
        window.addEventListener('online', attempt);
        return () => {
            cancelled = true;
            window.removeEventListener('online', attempt);
        };
    }, [manager, device]);

    // The data layer is pointed at this person's database before anything below reads from it, and everything
    // below is mounted afresh when the person changes.
    const personKey = useMemo(() => {
        if (!device) return null;
        bindDevice(device);
        return principalKey(device.principal);
    }, [device]);

    if (!device || !personKey) {
        return (
            <Centered>
                {problem ? <CloudOff className="h-6 w-6" aria-hidden /> : <Loader2 className="h-6 w-6 animate-spin" aria-hidden />}
                <p>{problem ?? 'Signing in…'}</p>
            </Centered>
        );
    }
    return (
        <SignedIn key={personKey} manager={manager} snapshot={snapshot} storageMode={storageMode}>
            {children}
        </SignedIn>
    );
}

export default function PowerSyncApp({ children }: { children: React.ReactNode }) {
    const [started, setStarted] = useState<Started | null>(null);
    const startsOffline = useOfflineStart();
    useEffect(() => {
        let cancelled = false;
        void start().then((result) => !cancelled && setStarted(result));
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="h-full bg-background text-foreground" data-testid="powersync-app" data-phase={started?.phase ?? 'starting'} data-starts-offline={startsOffline}>
            {!started ? (
                <Centered>
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                    <p>Starting…</p>
                </Centered>
            ) : started.phase === 'ready' ? (
                <Ready manager={started.manager} storageMode={started.storageMode}>
                    {children}
                </Ready>
            ) : started.phase === 'unsupported' ? (
                <Centered>
                    <p className="text-base font-medium text-foreground">This browser cannot run Family Organizer.</p>
                    <p>It is missing: {started.missing.join(', ')}. A current version of Safari, Firefox or Chrome has all of them.</p>
                </Centered>
            ) : started.phase === 'elsewhere' ? (
                <Centered>
                    <p>This copy of Family Organizer is not running on PowerSync.</p>
                    <a className="font-medium text-sky-700 hover:underline" href="/">
                        Go to the app
                    </a>
                </Centered>
            ) : (
                <Centered>
                    <CloudOff className="h-6 w-6" aria-hidden />
                    <p>{started.message}</p>
                </Centered>
            )}
            <Toaster />
            <PwaServiceWorkerRegistration />
        </div>
    );
}
