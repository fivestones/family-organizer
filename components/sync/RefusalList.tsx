'use client';

import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { dismissRefusal, useFamilyMembers, useRefusals, type Refusal } from '@/lib/data';

const WHAT: Record<string, string> = {
    completeChore: 'Marking a chore done',
    reopenChore: 'Un-ticking a chore',
    saveSetting: 'Saving a setting',
    clearSetting: 'Clearing a setting',
    defineUnit: 'Adding a unit',
};

const WHY: Record<Refusal['reason'], string> = {
    already_claimed: 'someone else had already done it',
    not_yours: 'it belongs to someone else',
    not_allowed: 'that needs a parent',
    column_not_allowed: 'that part of it needs a parent',
    conflict: 'it had already changed on another device',
    invalid: 'it could not be saved',
};

/**
 * Changes this device showed as done that the server then refused. The device has already put itself right; this
 * is how the person who made the change finds out, whenever they next look.
 */
export function RefusalList() {
    const { data: refusals } = useRefusals();
    const { data: members } = useFamilyMembers();
    if (refusals.length === 0) return null;
    const nameOf = (memberId: string | null) => members.find((member) => member.id === memberId)?.name ?? null;

    return (
        <section aria-label="Changes that did not go through" className="space-y-2" data-testid="refusals">
            {refusals.map((refusal) => {
                const who = nameOf(refusal.familyMemberId);
                return (
                    <div key={refusal.id} className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                        <p className="min-w-0 flex-1">
                            <span className="font-medium">{WHAT[refusal.mutation ?? ''] ?? 'A change'} did not go through</span>
                            {who ? ` for ${who}` : ''}: {WHY[refusal.reason]}.
                        </p>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="-my-1 h-8 shrink-0 px-2 text-amber-900 hover:bg-amber-100"
                            onClick={() => void dismissRefusal(refusal.id).catch(() => undefined)}
                        >
                            <X className="h-4 w-4" aria-hidden />
                            <span className="sr-only">Dismiss</span>
                        </Button>
                    </div>
                );
            })}
        </section>
    );
}
