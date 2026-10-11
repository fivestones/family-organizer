'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { id, tx } from '@instantdb/react';
import { FastForward, ListChecks, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import {
    getRoutineChoreIds,
    getRoutineOverrunPolicy,
    isChoreHiddenFromDayList,
    sortRoutines,
    type SharedChoreLike,
    type SharedRoutineLike,
} from '@family-organizer/shared-core';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { db } from '@/lib/db';
import { buildRoutineDeleteTransactions, buildRoutineSaveTransactions, type RoutineDraft } from '@/lib/routine-mutations';
import RoutineEditor from './RoutineEditor';
import { sumRoutineDurationSecs } from './routine-draft';

type RoutineChore = SharedChoreLike & { estimatedDurationSecs?: number | null };

function formatTotal(secs: number): string | null {
    if (secs <= 0) return null;
    const minutes = Math.round(secs / 60);
    if (minutes < 60) return `${Math.max(1, minutes)} min`;
    const hours = Math.floor(minutes / 60);
    return minutes % 60 === 0 ? `${hours} hr` : `${hours} hr ${minutes % 60} min`;
}

export default function RoutineManager() {
    const { toast } = useToast();
    const { data, isLoading, error } = (db.useQuery as any)({
        routines: { steps: { chore: {} } },
        chores: { assignees: {}, routineSteps: {} },
        familyMembers: { $: { order: { order: 'asc' } } },
    }) as { data?: any; isLoading: boolean; error?: { message?: string } | null };

    /** `'new'`, or the id of the routine being edited. */
    const [editing, setEditing] = useState<string | null>(null);
    const [deleting, setDeleting] = useState<SharedRoutineLike | null>(null);

    const routines = useMemo(() => sortRoutines((data?.routines as SharedRoutineLike[]) || []), [data?.routines]);
    const chores = useMemo(() => ((data?.chores as RoutineChore[]) || []), [data?.chores]);
    const familyMembers = useMemo(() => (data?.familyMembers as Array<{ id: string; name?: string | null }>) || [], [data?.familyMembers]);
    const choresById = useMemo(() => new Map(chores.map((chore) => [chore.id, chore])), [chores]);
    const memberNames = useMemo(() => new Map(familyMembers.map((member) => [member.id, member.name || 'Unknown'])), [familyMembers]);
    const editingRoutine = editing && editing !== 'new' ? routines.find((routine) => routine.id === editing) ?? null : null;

    const saveRoutine = async (draft: RoutineDraft) => {
        const { transactions, createdChoreIds } = buildRoutineSaveTransactions({ tx, createId: id, draft, routines, chores });
        await db.transact(transactions);
        setEditing(null);
        toast({
            title: draft.id ? 'Routine saved' : 'Routine created',
            description:
                createdChoreIds.length > 0
                    ? `${createdChoreIds.length} new chore${createdChoreIds.length === 1 ? ' was' : 's were'} created for its steps.`
                    : undefined,
        });
    };

    const deleteRoutine = async () => {
        if (!deleting) return;
        try {
            await db.transact(buildRoutineDeleteTransactions(tx, deleting));
            toast({ title: 'Routine deleted', description: 'Its chores are still in the chore list.' });
        } catch (deleteError: any) {
            toast({ title: 'Delete failed', description: deleteError?.message || 'The routine could not be deleted.', variant: 'destructive' });
        } finally {
            setDeleting(null);
        }
    };

    return (
        <div className="mx-auto max-w-5xl space-y-6 p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Routines</h1>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                        A routine is a named, ordered run of chores &mdash; morning, after school, bedtime. Start one from the
                        countdown and it carries you from step to step.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button asChild variant="outline">
                        <Link href="/countdown">
                            <Play className="mr-2 h-4 w-4" /> Countdown
                        </Link>
                    </Button>
                    <Button onClick={() => setEditing('new')}>
                        <Plus className="mr-2 h-4 w-4" /> New routine
                    </Button>
                </div>
            </div>

            {isLoading ? (
                <p className="text-sm text-muted-foreground">Loading routines…</p>
            ) : error ? (
                <p className="text-sm text-destructive">Could not load routines: {error.message}</p>
            ) : routines.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-6 py-14 text-center">
                    <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
                        <ListChecks className="h-7 w-7" />
                    </div>
                    <div>
                        <h2 className="text-base font-semibold">No routines yet</h2>
                        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                            Build one from chores you already have, or type the steps and let the chores be created for you.
                        </p>
                    </div>
                    <Button onClick={() => setEditing('new')}>
                        <Plus className="mr-2 h-4 w-4" /> New routine
                    </Button>
                </div>
            ) : (
                <ul className="grid gap-4 md:grid-cols-2">
                    {routines.map((routine) => {
                        const stepChores = getRoutineChoreIds(routine)
                            .map((choreId) => choresById.get(choreId))
                            .filter((chore): chore is RoutineChore => !!chore);
                        const people = Array.from(
                            new Set(stepChores.flatMap((chore) => (chore.assignees || []).map((assignee) => memberNames.get(assignee.id)))),
                        ).filter(Boolean);
                        const total = formatTotal(sumRoutineDurationSecs(stepChores));
                        const folded = stepChores.filter(isChoreHiddenFromDayList).length;
                        return (
                            <li
                                key={routine.id}
                                data-testid="routine-card"
                                className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
                            >
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <h2 className="truncate text-lg font-semibold tracking-tight">{routine.name || 'Untitled routine'}</h2>
                                        <p className="mt-0.5 text-sm text-muted-foreground">
                                            {[
                                                `${stepChores.length} step${stepChores.length === 1 ? '' : 's'}`,
                                                total,
                                                people.length > 0 ? people.join(', ') : null,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ')}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 gap-1">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={`Edit ${routine.name}`}
                                            onClick={() => setEditing(routine.id)}
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="text-muted-foreground hover:text-destructive"
                                            aria-label={`Delete ${routine.name}`}
                                            onClick={() => setDeleting(routine)}
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>

                                <ol className="space-y-1.5">
                                    {stepChores.slice(0, 6).map((chore, index) => (
                                        <li key={chore.id} className="flex items-center gap-2.5 text-sm">
                                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                                                {index + 1}
                                            </span>
                                            <span className="min-w-0 flex-1 truncate">{chore.title}</span>
                                        </li>
                                    ))}
                                    {stepChores.length > 6 && (
                                        <li className="pl-[30px] text-xs text-muted-foreground">and {stepChores.length - 6} more</li>
                                    )}
                                </ol>

                                <div className="mt-auto flex flex-wrap gap-2 text-xs">
                                    {getRoutineOverrunPolicy(routine) === 'advance' && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-800">
                                            <FastForward className="h-3 w-3" /> Moves on at zero
                                        </span>
                                    )}
                                    {folded > 0 && (
                                        <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                                            {folded === stepChores.length ? 'One row in the day list' : `${folded} folded into one row`}
                                        </span>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}

            <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{editingRoutine ? `Edit ${editingRoutine.name}` : 'New routine'}</DialogTitle>
                        <DialogDescription>Steps run in order. Each one is a real chore, so XP and allowance work as usual.</DialogDescription>
                    </DialogHeader>
                    {editing !== null && (
                        <RoutineEditor
                            key={editing}
                            routine={editingRoutine}
                            chores={chores}
                            familyMembers={familyMembers}
                            onSave={saveRoutine}
                            onCancel={() => setEditing(null)}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete {deleting?.name || 'this routine'}?</AlertDialogTitle>
                        <AlertDialogDescription>
                            The routine goes; its chores stay. Any that were folded into it return to the day list by themselves.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Keep it</AlertDialogCancel>
                        <AlertDialogAction onClick={deleteRoutine}>Delete routine</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
