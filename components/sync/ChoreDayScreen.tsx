'use client';

import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Hand } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { completeChore, reopenChore, useChoreDay, useFamilyMembers, type FamilyMember, type Principal } from '@/lib/data';
import { cn } from '@/lib/utils';
import { choresDueOn, describeDay, localDayKey, shiftDay, type ChoreForPerson, type ChoreOnDay } from './chore-day';

const refusalMessage = (error: unknown): string => {
    const reason = typeof error === 'object' && error !== null && 'reason' in error ? String((error as { reason: unknown }).reason) : '';
    if (reason === 'not_yours') return 'You can only tick your own chores.';
    if (reason === 'not_allowed') return 'Sign in as yourself to tick chores.';
    if (reason === 'already_claimed') return 'Someone else has already done this one.';
    return error instanceof Error ? error.message : 'That could not be saved.';
};

/** A day's chores, each with the people it is for. Ticking one is saved on this device at once and sent when it can be. */
export function ChoreDayScreen({ principal }: { principal: Principal }) {
    const today = localDayKey(new Date());
    const [day, setDay] = useState(today);
    const { data: choreDay, isLoading } = useChoreDay(day);
    const { data: members } = useFamilyMembers();
    const { toast } = useToast();
    const chores = useMemo(() => choresDueOn(choreDay, members), [choreDay, members]);
    const me = principal.familyMemberId;

    /** A parent may tick for anyone, a kid for themselves, and the shared session for nobody. */
    const mayTick = (member: FamilyMember) => principal.type === 'parent' || (me !== null && member.id === me);

    async function toggle(entry: ChoreOnDay, person: ChoreForPerson) {
        const input = { choreId: entry.chore.id, memberId: person.member.id, day, markedBy: me && me !== person.member.id ? me : null };
        try {
            const result = person.done ? await reopenChore(input) : await completeChore(input);
            if (result.status === 'claimed') {
                const by = members.find((member) => member.id === result.claimedBy)?.name ?? 'Someone else';
                toast({ title: 'Already done', description: `${by} has already done “${entry.chore.title}” today.` });
            }
        } catch (error) {
            toast({ title: 'Not saved', description: refusalMessage(error), variant: 'destructive' });
        }
    }

    return (
        <section className="space-y-4" data-testid="chore-day">
            <div className="flex items-center justify-between gap-2">
                <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDay(shiftDay(day, -1))}>
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0 text-center">
                    <h2 className="truncate text-lg font-semibold tracking-tight" data-testid="chore-day-title">
                        {describeDay(day, today)}
                    </h2>
                    {day !== today ? (
                        <button type="button" className="text-xs font-medium text-sky-700 hover:underline" onClick={() => setDay(today)}>
                            Back to today
                        </button>
                    ) : (
                        <p className="text-xs text-muted-foreground">{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
                    )}
                </div>
                <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDay(shiftDay(day, 1))}>
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>

            {isLoading && chores.length === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">Getting the family’s chores…</p>
            ) : chores.length === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">Nothing is due on this day.</p>
            ) : (
                <ul className="space-y-2">
                    {chores.map((entry) => (
                        <li key={entry.chore.id} data-testid="chore" data-chore-id={entry.chore.id} className="rounded-xl border bg-card px-4 py-3 shadow-sm">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                <h3 className="min-w-0 flex-1 truncate font-medium">{entry.chore.title}</h3>
                                {entry.chore.isUpForGrabs ? (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">
                                        <Hand className="h-3 w-3" aria-hidden />
                                        {entry.doneBy ? `Done by ${entry.doneBy.name}` : 'Up for grabs'}
                                    </span>
                                ) : null}
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                                {entry.people.map((person) => {
                                    const takenByOther = entry.doneBy !== null && entry.doneBy.id !== person.member.id;
                                    const disabled = !mayTick(person.member) || takenByOther;
                                    return (
                                        <button
                                            key={person.member.id}
                                            type="button"
                                            disabled={disabled}
                                            aria-pressed={person.done}
                                            data-testid="chore-person"
                                            data-member-id={person.member.id}
                                            data-done={person.done}
                                            onClick={() => void toggle(entry, person)}
                                            className={cn(
                                                'inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors',
                                                person.done ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-border bg-background text-foreground',
                                                disabled ? 'cursor-not-allowed opacity-55' : 'hover:border-emerald-400 active:scale-[0.98]'
                                            )}
                                        >
                                            <span
                                                className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white"
                                                style={{ backgroundColor: person.done ? '#059669' : person.member.color ?? '#64748b' }}
                                                aria-hidden
                                            >
                                                {person.done ? <Check className="h-3.5 w-3.5" /> : person.member.name.slice(0, 1).toUpperCase()}
                                            </span>
                                            {person.member.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
