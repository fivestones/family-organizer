'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { CloudOff, Loader2 } from 'lucide-react';
import { createPowerSyncBackend } from '@family-organizer/data/powersync';
import { SessionManager, type SessionSnapshot } from '@family-organizer/data/session/manager';
import type { InstallationConfig } from '@family-organizer/data/session/platform';
import CountdownSettings from '@/components/CountdownSettings';
import CurrencySettings from '@/components/CurrencySettings';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/toaster';
import { principalKey, setDataBackend, useFamilyMembers, type Principal } from '@/lib/data';
import { createWebPlatform, missingBrowserFeatures, type StorageMode } from '@/lib/powersync/web-platform';
import { cn } from '@/lib/utils';
import { ChoreDayScreen } from './ChoreDayScreen';
import { PersonSwitcher } from './PersonSwitcher';
import { RefusalList } from './RefusalList';
import { SyncBadge } from './SyncBadge';

// The app on PowerSync, as far as it has been built: a day's chores and two of the settings panels, with real
// sessions, a local database for each person, and sync (docs/powersync-migration.md, Phase 2).

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

function SignedIn({ manager, snapshot, storageMode }: { manager: SessionManager; snapshot: SessionSnapshot; storageMode: StorageMode }) {
    const device = snapshot.device!;
    const { principal } = device;
    const [view, setView] = useState<'chores' | 'settings'>('chores');
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

    return (
        <div className="flex h-full flex-col">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b bg-background/95 px-4 py-2.5 backdrop-blur sm:px-6">
                <div className="flex min-w-0 items-baseline gap-2">
                    <h1 className="truncate text-lg font-bold tracking-tight">Family Organizer</h1>
                    <span className="hidden rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-sky-800 sm:inline">Sync preview</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <SyncBadge db={device.db} />
                    <PersonSwitcher manager={manager} principal={principal} steppedIn={snapshot.steppedIn} />
                </div>
            </header>

            <main className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-5 sm:px-6">
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

                    <nav className="inline-flex rounded-lg border bg-muted p-1 text-sm" aria-label="Sections">
                        {(['chores', 'settings'] as const).map((name) => (
                            <button
                                key={name}
                                type="button"
                                data-testid={`tab-${name}`}
                                aria-current={view === name}
                                onClick={() => setView(name)}
                                className={cn('rounded-md px-3 py-1.5 font-medium capitalize transition-colors', view === name ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                            >
                                {name}
                            </button>
                        ))}
                    </nav>

                    {view === 'chores' ? (
                        <ChoreDayScreen principal={principal} />
                    ) : principal.type === 'parent' ? (
                        <div className="space-y-4" data-testid="settings">
                            <CurrencySettings />
                            <CountdownSettings />
                        </div>
                    ) : (
                        <Notice>Settings are a parent’s to change. Sign in as a parent to see them.</Notice>
                    )}
                </div>
            </main>
        </div>
    );
}

function Ready({ manager, storageMode }: { manager: SessionManager; storageMode: StorageMode }) {
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
        setDataBackend(createPowerSyncBackend(device));
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
    return <SignedIn key={personKey} manager={manager} snapshot={snapshot} storageMode={storageMode} />;
}

export default function PowerSyncApp() {
    const [started, setStarted] = useState<Started | null>(null);
    useEffect(() => {
        let cancelled = false;
        void start().then((result) => !cancelled && setStarted(result));
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div className="h-full bg-background text-foreground" data-testid="powersync-app" data-phase={started?.phase ?? 'starting'}>
            {!started ? (
                <Centered>
                    <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
                    <p>Starting…</p>
                </Centered>
            ) : started.phase === 'ready' ? (
                <Ready manager={started.manager} storageMode={started.storageMode} />
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
        </div>
    );
}
