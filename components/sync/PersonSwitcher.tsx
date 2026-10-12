'use client';

import { useState } from 'react';
import { Lock, LogOut } from 'lucide-react';
import type { SessionManager } from '@family-organizer/data/session/manager';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useFamilyMembers, type FamilyMember, type Principal } from '@/lib/data';
import { cn } from '@/lib/utils';

const SIGN_IN_FAILURES: Record<string, string> = {
    incorrect_pin: 'That PIN is not right.',
    pin_required: 'Enter the PIN.',
    too_many_attempts: 'Too many tries. Wait a little and try again.',
    member_not_found: 'That person is no longer in the family.',
};

function Initial({ member, className }: { member: Pick<FamilyMember, 'name' | 'color'> | null; className?: string }) {
    return (
        <span
            className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white', className)}
            style={{ backgroundColor: member?.color ?? '#64748b' }}
            aria-hidden
        >
            {member ? member.name.slice(0, 1).toUpperCase() : '·'}
        </span>
    );
}

/**
 * Who is using this device, and the way to change it. Everyone in the family is listed, because the shared
 * session every device starts with is sent the roster. Signing in needs the server, as it always has.
 */
export function PersonSwitcher({ manager, principal, steppedIn }: { manager: SessionManager; principal: Principal; steppedIn: boolean }) {
    const { data: members } = useFamilyMembers();
    const [open, setOpen] = useState(false);
    const [chosen, setChosen] = useState<FamilyMember | null>(null);
    const [pin, setPin] = useState('');
    const [ownDevice, setOwnDevice] = useState(false);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const current = members.find((member) => member.id === principal.familyMemberId) ?? null;

    const reset = () => {
        setChosen(null);
        setPin('');
        setOwnDevice(false);
        setProblem(null);
    };

    async function signIn(member: FamilyMember, withPin: string | null) {
        setBusy(true);
        setProblem(null);
        try {
            // A parent on someone else's device is stepping in: the device goes back to that person afterwards.
            await manager.signIn({ familyMemberId: member.id, pin: withPin, sharedDevice: member.role === 'parent' && !ownDevice });
            setOpen(false);
            reset();
        } catch (error) {
            const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
            setProblem(SIGN_IN_FAILURES[code] ?? 'Could not sign in. Is this device online?');
        } finally {
            setBusy(false);
        }
    }

    const choose = (member: FamilyMember) => {
        setProblem(null);
        if (member.hasPin) setChosen(member);
        else void signIn(member, null);
    };

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                setOpen(next);
                if (!next) reset();
            }}
        >
            <DialogTrigger asChild>
                <button type="button" data-testid="person-button" className="flex items-center gap-2 rounded-full border bg-background py-1 pl-1 pr-3 text-sm font-medium shadow-sm transition-colors hover:bg-accent">
                    <Initial member={current} className="h-7 w-7 text-xs" />
                    <span className="max-w-[9rem] truncate">{current?.name ?? 'Everyone'}</span>
                </button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{chosen ? `Hello, ${chosen.name}` : 'Who is using this device?'}</DialogTitle>
                    <DialogDescription>{chosen ? 'Enter your PIN to carry on.' : 'Pick yourself to tick your chores.'}</DialogDescription>
                </DialogHeader>

                {chosen ? (
                    <form
                        className="space-y-4"
                        onSubmit={(event) => {
                            event.preventDefault();
                            void signIn(chosen, pin);
                        }}
                    >
                        <div className="space-y-2">
                            <Label htmlFor="sync-pin">PIN</Label>
                            <Input id="sync-pin" data-testid="pin-input" type="password" inputMode="numeric" autoComplete="off" autoFocus value={pin} onChange={(event) => setPin(event.target.value)} />
                        </div>
                        {chosen.role === 'parent' ? (
                            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                                <Label htmlFor="sync-own-device" className="text-sm font-normal leading-snug">
                                    This is my own device
                                    <span className="block text-xs text-muted-foreground">Leave off on a shared one: you are signed out again when you are done.</span>
                                </Label>
                                <Switch id="sync-own-device" checked={ownDevice} onCheckedChange={setOwnDevice} />
                            </div>
                        ) : null}
                        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
                        <div className="flex justify-between gap-2">
                            <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                                Back
                            </Button>
                            <Button type="submit" data-testid="pin-submit" disabled={busy || !pin}>
                                <Lock className="mr-2 h-4 w-4" aria-hidden />
                                Sign in
                            </Button>
                        </div>
                    </form>
                ) : (
                    <div className="space-y-3">
                        <ul className="grid grid-cols-2 gap-2">
                            {members.map((member) => (
                                <li key={member.id}>
                                    <button
                                        type="button"
                                        disabled={busy}
                                        data-testid="person-option"
                                        data-member-id={member.id}
                                        onClick={() => choose(member)}
                                        className={cn(
                                            'flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors hover:bg-accent',
                                            member.id === principal.familyMemberId && 'border-emerald-300 bg-emerald-50'
                                        )}
                                    >
                                        <Initial member={member} />
                                        <span className="min-w-0 flex-1 truncate font-medium">{member.name}</span>
                                        {member.hasPin ? <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-label="Has a PIN" /> : null}
                                    </button>
                                </li>
                            ))}
                        </ul>
                        {problem ? <p role="alert" className="text-sm text-destructive">{problem}</p> : null}
                        {principal.familyMemberId ? (
                            <Button
                                variant="outline"
                                className="w-full"
                                data-testid="sign-out"
                                disabled={busy}
                                onClick={() => {
                                    setOpen(false);
                                    void manager.signOut();
                                }}
                            >
                                <LogOut className="mr-2 h-4 w-4" aria-hidden />
                                {steppedIn ? 'Sign out, back to who was here' : 'Sign out'}
                            </Button>
                        ) : null}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
