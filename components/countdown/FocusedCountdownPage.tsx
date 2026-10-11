'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ListChecks, Maximize2, Minimize2, Timer } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getPhotoUrl } from '@/lib/photo-urls';
import { cn } from '@/lib/utils';
import RunnerPanel from './RunnerPanel';
import { getInitials } from './initials';
import { useCountdownRunner } from './useCountdownRunner';

const SELECTION_STORAGE_KEY = 'countdown_shown_members';

/** The page's own field. Every state renders on it, ring or no ring. */
const PAGE_BACKDROP = 'radial-gradient(circle at 50% 0%, hsl(232, 44%, 22%), hsl(240, 40%, 9%))';

function readStoredSelection(): string[] {
    try {
        const stored = JSON.parse(window.localStorage.getItem(SELECTION_STORAGE_KEY) || '[]');
        return Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
    } catch {
        return [];
    }
}

function storeSelection(memberIds: string[]) {
    try {
        window.localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(memberIds));
    } catch {
        // Remembering who was on screen is a convenience; the page works without it.
    }
}

function Notice({ icon, title, children }: { icon?: React.ReactNode; title: string; children?: React.ReactNode }) {
    return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            {icon}
            <div>
                <h2 className="text-xl font-semibold text-white/90">{title}</h2>
                {children && <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-white/60">{children}</p>}
            </div>
        </div>
    );
}

export default function FocusedCountdownPage() {
    const { isLoading, error, nowMs, runners, settings, currentMemberId, canManageRoutines, actions } = useCountdownRunner();
    const [chosenIds, setChosenIds] = useState<string[]>([]);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        setChosenIds(readStoredSelection());
    }, []);

    useEffect(() => {
        if (!isFullscreen) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setIsFullscreen(false);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isFullscreen]);

    // Whoever is signed in sees their own countdown first; a shared tablet with
    // nobody signed in starts on the first person with something to do.
    const shown = useMemo(() => {
        const chosen = runners.filter((runner) => chosenIds.includes(runner.member.id));
        if (chosen.length > 0) return chosen;
        const own = runners.find((runner) => runner.member.id === currentMemberId);
        return own ? [own] : runners.slice(0, 1);
    }, [runners, chosenIds, currentMemberId]);

    const toggleMember = useCallback(
        (memberId: string) => {
            const shownIds = shown.map((runner) => runner.member.id);
            const next = shownIds.includes(memberId)
                ? shownIds.filter((entry) => entry !== memberId)
                : [...shownIds, memberId];
            if (next.length === 0) return; // Someone is always on screen.
            setChosenIds(next);
            storeSelection(next);
        },
        [shown],
    );

    const isSolo = shown.length === 1;

    return (
        <div
            className={cn(
                'relative isolate flex min-h-full flex-col text-white',
                isFullscreen && 'fixed inset-0 z-50 overflow-y-auto',
            )}
            style={{ background: PAGE_BACKDROP }}
        >
            {isLoading ? (
                <Notice title="Loading the countdown…" />
            ) : error ? (
                <Notice title="The countdown could not load">{error.message}</Notice>
            ) : runners.length === 0 ? (
                <Notice icon={<Timer className="h-16 w-16 text-white/30" />} title="Nothing to count down today">
                    Chores that are due today show up here, ready to start whenever you are.
                    {canManageRoutines && (
                        <Link href="/routines" className="mt-4 block font-semibold text-white/85 underline underline-offset-4 hover:text-white">
                            Set up a routine
                        </Link>
                    )}
                </Notice>
            ) : (
                <>
                    {/* ---- Who is on screen ---- */}
                    <div
                        className={cn(
                            'z-10 flex w-full items-center justify-between gap-3 px-4 py-3',
                            isSolo && 'absolute inset-x-0 top-0',
                        )}
                    >
                        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="People on screen">
                            {runners.map((runner) => {
                                const isShown = shown.includes(runner);
                                const photoUrl = getPhotoUrl(runner.member.photoUrls, '64');
                                return (
                                    <button
                                        key={runner.member.id}
                                        type="button"
                                        aria-pressed={isShown}
                                        onClick={() => toggleMember(runner.member.id)}
                                        className={cn(
                                            'flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm font-medium backdrop-blur-sm transition-all',
                                            isShown
                                                ? 'bg-white/25 text-white shadow-lg shadow-slate-950/20'
                                                : 'bg-white/10 text-white/60 hover:bg-white/15 hover:text-white/85',
                                        )}
                                    >
                                        <Avatar className="h-6 w-6">
                                            {photoUrl && <AvatarImage src={photoUrl} alt="" />}
                                            <AvatarFallback className="bg-white/20 text-[10px] font-semibold text-white">
                                                {getInitials(runner.member.name)}
                                            </AvatarFallback>
                                        </Avatar>
                                        {runner.member.name}
                                        {runner.state.phase === 'running' && (
                                            <span className="relative flex h-2 w-2" aria-label="running">
                                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-70" />
                                                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                                            </span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                            {canManageRoutines && (
                                <Link
                                    href="/routines"
                                    className="flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2.5 text-sm font-medium text-white/75 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
                                >
                                    <ListChecks className="h-4 w-4" />
                                    <span className="hidden sm:inline">Routines</span>
                                    <span className="sr-only sm:hidden">Routines</span>
                                </Link>
                            )}
                            <button
                                type="button"
                                onClick={() => setIsFullscreen((value) => !value)}
                                aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
                                className="rounded-full bg-white/10 p-2.5 text-white/70 backdrop-blur-sm transition-colors hover:bg-white/20 hover:text-white"
                            >
                                {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
                            </button>
                        </div>
                    </div>

                    {/* ---- The countdowns ---- */}
                    {isSolo ? (
                        <RunnerPanel runner={shown[0]} nowMs={nowMs} settings={settings} actions={actions} layout="solo" />
                    ) : (
                        <div
                            className={cn(
                                'grid flex-1 auto-rows-fr gap-4 px-4 pb-6',
                                shown.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3',
                            )}
                        >
                            {shown.map((runner) => (
                                <RunnerPanel
                                    key={runner.member.id}
                                    runner={runner}
                                    nowMs={nowMs}
                                    settings={settings}
                                    actions={actions}
                                    layout="tile"
                                />
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
