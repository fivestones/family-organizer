// components/auth/LoginModal.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, ArrowLeft } from 'lucide-react';
import { db } from '@/lib/db';
import { useAuth } from '@/components/AuthProvider';
import { useInstantPrincipal } from '@/components/InstantFamilySessionProvider';
import { hashPin } from '@/app/actions';
import { useToast } from '@/components/ui/use-toast';

interface LoginModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
    const { login } = useAuth();
    const { ensureKidPrincipal, elevateParentPrincipal, canUseCachedParentPrincipal } = useInstantPrincipal();
    const { toast } = useToast();
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
    const [pin, setPin] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);

    // +++ NEW: Force cleanup of pointer-events on Body +++
    // This implements the fix found on GitHub to prevent the app from freezing
    // when the modal unmounts or closes.
    useEffect(() => {
        if (isOpen) {
            // Optional: Remove the lock immediately while open (if Overlay handles clicks)
            // This mirrors the solution you found:
            const timer = setTimeout(() => {
                document.body.style.pointerEvents = '';
            }, 0);
            return () => clearTimeout(timer);
        } else {
            // Ensure interactions are enabled when closed
            document.body.style.pointerEvents = 'auto';
        }

        // IMPORTANT: Cleanup on unmount
        // This catches the case where ParentGate unmounts this component immediately after login
        return () => {
            document.body.style.pointerEvents = 'auto';
        };
    }, [isOpen]);

    // Fetch members with necessary fields
    const { data, isLoading } = db.useQuery({
        familyMembers: {
            $: { order: { order: 'asc' } },
        },
    });
    const familyMembers = (data?.familyMembers as any[]) || [];

    // Reset state when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setSelectedMemberId(null);
            setPin('');
            setIsVerifying(false);
            setRememberMe(false);
        }
    }, [isOpen]);

    const handleMemberSelect = (id: string) => {
        setSelectedMemberId(id);
        setPin(''); // Clear any previous PIN attempt
        setRememberMe(false);
    };

    const handlePinSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!selectedMemberId) return;

        const member = familyMembers.find((m: any) => m.id === selectedMemberId);
        if (!member) return;

        setIsVerifying(true);

        try {
            const isParentMember = member.role === 'parent';

            if (isParentMember) {
                const canReuseParent = canUseCachedParentPrincipal;
                if (!canReuseParent && !pin) {
                    toast({ title: 'PIN is required', variant: 'destructive' });
                    return;
                }

                await elevateParentPrincipal({
                    familyMemberId: member.id,
                    pin: pin,
                });

                login(
                    {
                        id: member.id,
                        name: member.name,
                        role: member.role,
                        photoUrls: member.photoUrls,
                    },
                    rememberMe
                );
                toast({ title: `Welcome back, ${member.name}!` });
                onClose();
                return;
            }

            await ensureKidPrincipal();

            // Check if member has a PIN set
            if (!member.pinHash) {
                // If no PIN set, login immediately
                login(
                    {
                        id: member.id,
                        name: member.name,
                        role: member.role,
                        photoUrls: member.photoUrls,
                    },
                    rememberMe
                );
                toast({ title: `Welcome back, ${member.name}!` });
                onClose();
                return;
            }

            const hashedInput = await hashPin(pin);
            if (hashedInput === member.pinHash) {
                login(
                    {
                        id: member.id,
                        name: member.name,
                        role: member.role,
                        photoUrls: member.photoUrls,
                    },
                    rememberMe
                );
                toast({ title: `Welcome back, ${member.name}!` });
                onClose();
            } else {
                toast({
                    title: 'Incorrect PIN',
                    variant: 'destructive',
                });
                setPin('');
            }
        } catch (error) {
            console.error('Login error', error);
            toast({ title: 'Error logging in', variant: 'destructive' });
        } finally {
            setIsVerifying(false);
        }
    };

    const selectedMemberData = familyMembers.find((m: any) => m.id === selectedMemberId);
    const isParentSelection = selectedMemberData?.role === 'parent';
    const parentPinCanBeSkipped = Boolean(isParentSelection && canUseCachedParentPrincipal);
    const loginButtonDisabled = isVerifying || (!pin && !parentPinCanBeSkipped);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{selectedMemberId ? `Welcome, ${selectedMemberData?.name}` : 'Who are you?'}</DialogTitle>
                    <DialogDescription>
                        {selectedMemberId
                            ? parentPinCanBeSkipped
                                ? 'Parent mode is already unlocked on this device.'
                                : 'Enter your PIN to continue.'
                            : 'Select your profile to log in.'}
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex justify-center p-8">
                        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="py-4">
                        {!selectedMemberId ? (
                            // Grid of avatars
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                {familyMembers.map((member: any) => (
                                    <button
                                        key={member.id}
                                        onClick={() => handleMemberSelect(member.id)}
                                        className="flex flex-col items-center p-4 rounded-lg hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
                                    >
                                        <Avatar className="h-20 w-20 mb-2 border-2 border-transparent hover:border-primary">
                                            <AvatarImage src={member.photoUrls?.['320'] ? `uploads/${member.photoUrls['320']}` : undefined} />
                                            <AvatarFallback className="text-xl">{member.name.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                        <span className="text-sm font-medium text-center">{member.name}</span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            // PIN Entry
                            <div className="space-y-4">
                                <div className="flex justify-center mb-4">
                                    <Avatar className="h-24 w-24">
                                        <AvatarImage
                                            src={selectedMemberData?.photoUrls?.['320'] ? `uploads/${selectedMemberData.photoUrls['320']}` : undefined}
                                        />
                                        <AvatarFallback className="text-2xl">{selectedMemberData?.name.charAt(0)}</AvatarFallback>
                                    </Avatar>
                                </div>

                                <form onSubmit={handlePinSubmit} className="space-y-4">
                                    <div className="flex justify-center">
                                        <Input
                                            type="password"
                                            value={pin}
                                            onChange={(e) => setPin(e.target.value)}
                                            className="text-center text-2xl tracking-widest w-40"
                                            maxLength={6}
                                            placeholder={parentPinCanBeSkipped ? 'PIN (optional)' : 'PIN'}
                                            autoFocus
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                        />
                                    </div>

                                    <div className="flex items-center justify-center space-x-2">
                                        <Checkbox id="remember" checked={rememberMe} onCheckedChange={(checked) => setRememberMe(checked as boolean)} />
                                        <Label
                                            htmlFor="remember"
                                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                                        >
                                            Remember me on this device
                                        </Label>
                                    </div>

                                    <div className="flex justify-between items-center px-4">
                                        <Button type="button" variant="ghost" onClick={() => setSelectedMemberId(null)}>
                                            <ArrowLeft className="mr-2 h-4 w-4" /> Back
                                        </Button>
                                        <Button type="submit" disabled={loginButtonDisabled}>
                                            {isVerifying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Log In
                                        </Button>
                                    </div>
                                </form>
                            </div>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
