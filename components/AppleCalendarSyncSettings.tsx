'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';

interface SyncCalendarRow {
    id?: string;
    remoteCalendarId: string;
    displayName: string;
    isEnabled?: boolean;
}

interface SyncStatus {
    configured: boolean;
    account: null | {
        id: string;
        status?: string;
        username?: string;
        accountLabel?: string;
        lastAttemptedSyncAt?: string;
        lastSuccessfulSyncAt?: string;
        lastErrorAt?: string;
        lastErrorMessage?: string;
    };
    calendars: SyncCalendarRow[];
    lastRun: null | {
        status?: string;
        errorMessage?: string;
        startedAt?: string;
        finishedAt?: string;
    };
    polling: null | {
        due?: boolean;
        lastSuccessfulPollAt?: string;
        nextPollAt?: string;
        nextPollInMs?: number;
        pollIntervalMs?: number;
        pollReason?: string;
        quietStreak?: number;
        failureStreak?: number;
    };
}

function formatRelativeDate(value: string | undefined | null) {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    const diffMs = date.getTime() - Date.now();
    const absMs = Math.abs(diffMs);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    if (absMs < 60_000) return rtf.format(Math.round(diffMs / 1000), 'second');
    if (absMs < 3_600_000) return rtf.format(Math.round(diffMs / 60_000), 'minute');
    if (absMs < 86_400_000) return rtf.format(Math.round(diffMs / 3_600_000), 'hour');
    return rtf.format(Math.round(diffMs / 86_400_000), 'day');
}

function formatDateWithRelative(value: string | undefined | null) {
    if (!value) return 'Never';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Unknown';
    return `${date.toLocaleString()} (${formatRelativeDate(value)})`;
}

function formatDurationMs(value: number | undefined | null) {
    if (!value || value <= 0) return 'Right away';
    if (value < 60_000) return `${Math.round(value / 1000)}s`;
    if (value < 3_600_000) return `${Math.round(value / 60_000)}m`;
    if (value < 86_400_000) return `${Math.round(value / 3_600_000)}h`;
    return `${Math.round(value / 86_400_000)}d`;
}

function pollReasonLabel(value: string | undefined) {
    switch (value) {
        case 'recent_changes':
            return 'Active polling after recent changes';
        case 'idle_backoff':
            return 'Light backoff while calendars stay quiet';
        case 'idle_backoff_deep':
            return 'Deep backoff while calendars stay quiet';
        case 'error_backoff':
            return 'Retry backoff after recent errors';
        case 'first_run':
            return 'Waiting for the first poll';
        case 'manual':
            return 'Manual sync requested';
        case 'repair':
            return 'Repair scan requested';
        default:
            return 'Standard polling cadence';
    }
}

async function parseJson(response: Response) {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(body?.error || `Request failed (${response.status})`);
    }
    return body;
}

export default function AppleCalendarSyncSettings() {
    const { toast } = useToast();
    const [status, setStatus] = useState<SyncStatus | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPending, startTransition] = useTransition();
    const [form, setForm] = useState({
        username: '',
        appSpecificPassword: '',
        accountLabel: 'Apple Calendar',
        selectedCalendarIds: [] as string[],
    });

    const selectedCount = form.selectedCalendarIds.length;
    const calendars = status?.calendars || [];

    async function loadStatus() {
        setIsLoading(true);
        try {
            const nextStatus = await parseJson(await fetch('/api/calendar-sync/apple/status', { cache: 'no-store' }));
            setStatus(nextStatus);
            setForm((current) => ({
                ...current,
                username: nextStatus?.account?.username || current.username,
                accountLabel: nextStatus?.account?.accountLabel || current.accountLabel,
                selectedCalendarIds: (nextStatus?.calendars || []).filter((calendar: SyncCalendarRow) => calendar.isEnabled).map((calendar: SyncCalendarRow) => calendar.remoteCalendarId),
            }));
        } catch (error: any) {
            toast({
                title: 'Unable to load Apple Calendar sync',
                description: error?.message || 'Please try again.',
                variant: 'destructive',
            });
        } finally {
            setIsLoading(false);
        }
    }

    useEffect(() => {
        void loadStatus();
    }, []);

    const syncSummary = useMemo(() => {
        if (!status?.configured) {
            return {
                tone: 'bg-slate-100 text-slate-700',
                label: 'Not connected',
                body: 'Connect Apple Calendar to start importing events.',
            };
        }
        if (isPending) {
            return {
                tone: 'bg-amber-100 text-amber-700',
                label: 'Working',
                body: 'Refreshing status or running a sync now.',
            };
        }
        if (status?.lastRun?.status === 'running') {
            return {
                tone: 'bg-sky-100 text-sky-700',
                label: 'Sync in progress',
                body: 'The server is currently processing Apple calendar changes.',
            };
        }
        if (status?.lastRun?.status === 'failed' || status?.account?.lastErrorMessage) {
            return {
                tone: 'bg-rose-100 text-rose-700',
                label: 'Needs attention',
                body: status?.account?.lastErrorMessage || status?.lastRun?.errorMessage || 'The most recent sync failed.',
            };
        }
        if (status?.polling?.pollReason === 'error_backoff') {
            return {
                tone: 'bg-amber-100 text-amber-700',
                label: 'Retry backoff',
                body: 'Polling is active, but the server is spacing checks out after recent errors.',
            };
        }
        if (status?.polling?.pollReason?.startsWith('idle_backoff')) {
            return {
                tone: 'bg-emerald-100 text-emerald-700',
                label: 'Healthy',
                body: 'Polling is healthy and backing off because Apple calendars have been quiet.',
            };
        }
        return {
            tone: 'bg-emerald-100 text-emerald-700',
            label: 'Healthy',
            body: 'Polling is healthy and ready to pick up new Apple changes quickly.',
        };
    }, [
        isPending,
        status?.account?.lastErrorMessage,
        status?.configured,
        status?.lastRun?.errorMessage,
        status?.lastRun?.status,
        status?.polling?.pollReason,
    ]);

    async function handleConnect() {
        startTransition(async () => {
            try {
                await parseJson(
                    await fetch('/api/calendar-sync/apple/connect', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            username: form.username,
                            appSpecificPassword: form.appSpecificPassword,
                            accountLabel: form.accountLabel,
                        }),
                    })
                );
                setForm((current) => ({ ...current, appSpecificPassword: '' }));
                await loadStatus();
                toast({ title: 'Apple Calendar connected' });
            } catch (error: any) {
                toast({
                    title: 'Connection failed',
                    description: error?.message || 'Please check your Apple ID and app-specific password.',
                    variant: 'destructive',
                });
            }
        });
    }

    async function handleSaveCalendars() {
        if (!status?.account?.id) return;
        startTransition(async () => {
            try {
                await parseJson(
                    await fetch('/api/calendar-sync/apple/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            accountId: status.account?.id,
                            selectedCalendarIds: form.selectedCalendarIds,
                            enabled: true,
                        }),
                    })
                );
                await loadStatus();
                toast({ title: 'Calendar selection saved' });
            } catch (error: any) {
                toast({
                    title: 'Could not save calendars',
                    description: error?.message || 'Please try again.',
                    variant: 'destructive',
                });
            }
        });
    }

    async function handleRunSync() {
        if (!status?.account?.id) return;
        startTransition(async () => {
            try {
                await parseJson(
                    await fetch('/api/calendar-sync/apple/run', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            accountId: status.account.id,
                            trigger: 'manual',
                        }),
                    })
                );
                await loadStatus();
                toast({ title: 'Apple Calendar sync started' });
            } catch (error: any) {
                toast({
                    title: 'Sync failed',
                    description: error?.message || 'Please try again.',
                    variant: 'destructive',
                });
            }
        });
    }

    return (
        <Card className="border-orange-200 bg-gradient-to-br from-orange-50 via-white to-amber-50">
            <CardHeader>
                <CardTitle>Apple Calendar Sync</CardTitle>
                <CardDescription>
                    Import Apple Calendar events into Family Organizer. Imported events stay read-only here and refresh from the server sync.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label htmlFor="apple-calendar-username">Apple ID Email</Label>
                        <Input
                            id="apple-calendar-username"
                            autoCapitalize="none"
                            autoCorrect="off"
                            value={form.username}
                            onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
                            placeholder="parent@example.com"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="apple-calendar-password">App-Specific Password</Label>
                        <Input
                            id="apple-calendar-password"
                            type="password"
                            autoCapitalize="none"
                            autoCorrect="off"
                            value={form.appSpecificPassword}
                            onChange={(event) => setForm((current) => ({ ...current, appSpecificPassword: event.target.value }))}
                            placeholder="xxxx-xxxx-xxxx-xxxx"
                        />
                    </div>
                </div>

                <div className="flex flex-wrap gap-3">
                    <Button type="button" variant="outline" onClick={() => void loadStatus()} disabled={isLoading || isPending}>
                        {isLoading ? 'Refreshing...' : 'Refresh'}
                    </Button>
                    <Button type="button" onClick={() => void handleConnect()} disabled={isPending}>
                        {status?.configured ? 'Reconnect Apple Calendar' : 'Connect Apple Calendar'}
                    </Button>
                    <Button type="button" variant="secondary" onClick={() => void handleRunSync()} disabled={isPending || !status?.account?.id}>
                        Sync Now
                    </Button>
                </div>

                <div className="rounded-xl border border-orange-200 bg-white/80 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <p className="text-sm font-semibold text-slate-900">
                                {status?.configured ? `Connected as ${status?.account?.username || 'Apple account'}` : 'Not connected yet'}
                            </p>
                            <p className="mt-1 text-sm text-slate-600">{syncSummary.body}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <div className={`rounded-full px-3 py-1 text-xs font-semibold ${syncSummary.tone}`}>
                                {syncSummary.label}
                            </div>
                            <div className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700">
                                {selectedCount} calendar{selectedCount === 1 ? '' : 's'} selected
                            </div>
                        </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Last successful sync</p>
                            <p className="mt-2 text-sm font-medium text-slate-900">{formatDateWithRelative(status?.account?.lastSuccessfulSyncAt)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Last successful check</p>
                            <p className="mt-2 text-sm font-medium text-slate-900">{formatDateWithRelative(status?.polling?.lastSuccessfulPollAt)}</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Next poll</p>
                            <p className="mt-2 text-sm font-medium text-slate-900">
                                {status?.configured ? formatDateWithRelative(status?.polling?.nextPollAt) : 'Waiting for connection'}
                            </p>
                            {status?.polling?.nextPollInMs != null ? (
                                <p className="mt-1 text-xs text-slate-500">About {formatDurationMs(status.polling.nextPollInMs)}</p>
                            ) : null}
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Polling mode</p>
                            <p className="mt-2 text-sm font-medium text-slate-900">{pollReasonLabel(status?.polling?.pollReason)}</p>
                            {status?.polling?.pollIntervalMs ? (
                                <p className="mt-1 text-xs text-slate-500">Current interval: {formatDurationMs(status.polling.pollIntervalMs)}</p>
                            ) : null}
                        </div>
                    </div>
                    {status?.lastRun ? (
                        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Last run</p>
                            <p className="mt-2 text-sm font-medium capitalize text-slate-900">
                                {status.lastRun.status || 'Unknown'}
                                {status.lastRun.finishedAt ? ` • ${formatDateWithRelative(status.lastRun.finishedAt)}` : ''}
                            </p>
                            {status?.account?.lastErrorAt ? (
                                <p className="mt-1 text-xs text-slate-500">Last error seen {formatDateWithRelative(status.account.lastErrorAt)}</p>
                            ) : null}
                        </div>
                    ) : null}
                    {status?.lastRun?.errorMessage ? (
                        <p className="mt-3 text-sm font-medium text-rose-600">{status.lastRun.errorMessage}</p>
                    ) : null}
                </div>

                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900">Imported Calendars</h3>
                        <Button type="button" variant="outline" onClick={() => void handleSaveCalendars()} disabled={isPending || !status?.account?.id}>
                            Save Calendars
                        </Button>
                    </div>
                    <div className="grid gap-3">
                        {calendars.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-600">
                                Connect Apple Calendar first to discover calendars you can import.
                            </div>
                        ) : (
                            calendars.map((calendar) => {
                                const checked = form.selectedCalendarIds.includes(calendar.remoteCalendarId);
                                return (
                                    <label
                                        key={calendar.id || calendar.remoteCalendarId}
                                        className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
                                    >
                                        <Checkbox
                                            checked={checked}
                                            onCheckedChange={(nextChecked) => {
                                                setForm((current) => ({
                                                    ...current,
                                                    selectedCalendarIds: nextChecked
                                                        ? [...current.selectedCalendarIds, calendar.remoteCalendarId]
                                                        : current.selectedCalendarIds.filter((item) => item !== calendar.remoteCalendarId),
                                                }));
                                            }}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <p className="font-medium text-slate-900">{calendar.displayName}</p>
                                            <p className="text-sm text-slate-500">{checked ? 'Imported into Family Organizer' : 'Not imported yet'}</p>
                                        </div>
                                    </label>
                                );
                            })
                        )}
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
