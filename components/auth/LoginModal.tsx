'use client';

import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, ArrowLeft } from 'lucide-react';
import db from '@/lib/db';
import { useAuth } from '@/components/AuthProvider';
// +++ CHANGED: Import hashPin from server actions +++
import { hashPin } from '@/app/actions';
import { useToast } from '@/components/ui/use-toast';

interface LoginModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function LoginModal({ isOpen, onClose }: LoginModalProps) {
    const { login } = useAuth();
    const { toast } = useToast();
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
    const [pin, setPin] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);

    // Fetch members with necessary fields
    const { data, isLoading } = db.useQuery({
        familyMembers: {
            $: { order: { order: 'asc' } },
        },
    });

    // Reset state when modal opens/closes
    useEffect(() => {
        if (isOpen) {
            setSelectedMemberId(null);
            setPin('');
            setIsVerifying(false);
        }
    }, [isOpen]);

    const handleMemberSelect = (id: string) => {
        setSelectedMemberId(id);
        setPin(''); // Clear any previous PIN attempt
    };

    const handlePinSubmit = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();
        if (!selectedMemberId || !pin) return;

        const member = data?.familyMembers.find((m: any) => m.id === selectedMemberId);
        if (!member) return;

        setIsVerifying(true);

        try {
            // Check if member has a PIN set
            if (!member.pinHash) {
                // If no PIN set, allow login immediately (Setup phase behavior)
                // Or you might want to block this. For now, assuming friendly access:
                login({
                    id: member.id,
                    name: member.name,
                    role: member.role,
                    photoUrls: member.photoUrls,
                });
                toast({ title: `Welcome back, ${member.name}!` });
                onClose();
                return;
            }

            const hashedInput = await hashPin(pin);
            if (hashedInput === member.pinHash) {
                login({
                    id: member.id,
                    name: member.name,
                    role: member.role,
                    photoUrls: member.photoUrls,
                });
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

    const selectedMemberData = data?.familyMembers.find((m: any) => m.id === selectedMemberId);

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>{selectedMemberId ? `Welcome, ${selectedMemberData?.name}` : 'Who are you?'}</DialogTitle>
                    <DialogDescription>{selectedMemberId ? 'Enter your PIN to continue.' : 'Select your profile to log in.'}</DialogDescription>
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
                                {data?.familyMembers.map((member: any) => (
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
                                            placeholder="PIN"
                                            autoFocus
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                        />
                                    </div>
                                    <div className="flex justify-between items-center px-4">
                                        <Button type="button" variant="ghost" onClick={() => setSelectedMemberId(null)}>
                                            <ArrowLeft className="mr-2 h-4 w-4" /> Back
                                        </Button>
                                        <Button type="submit" disabled={isVerifying || !pin}>
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
