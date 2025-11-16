// components/ui/ToggleableAvatar.tsx
import React from 'react';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/use-toast'; // +++ Import useToast +++
import { cn } from '@/lib/utils'; // +++ Import cn +++

const ToggleableAvatar = ({ name, photoUrls, isComplete, onToggle, isDisabled = false, completerName = '', choreTitle = '' }) => {
    // +++ Add new props +++
    const { toast } = useToast(); // +++ Get toast function +++
    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase();

    const photoUrl64 = photoUrls?.[64];

    const handleToggle = (pressed: boolean) => {
        if (isDisabled) {
            // +++ Show toast if disabled +++
            toast({
                title: 'Already Completed',
                description: `${choreTitle} was completed by ${completerName}.`,
            });
        } else {
            // +++ Call original onToggle only if not disabled +++
            onToggle(pressed);
        }
    };

    return (
        <Toggle
            pressed={isComplete && !isDisabled} // Visually unpress if disabled, even if technically complete by user
            // +++ Use the new handler +++
            onPressedChange={handleToggle}
            // +++ Apply disabled styles conditionally +++
            className={cn(
                'p-0 data-[state=on]:bg-transparent data-[state=off]:bg-transparent',
                isDisabled && 'opacity-50 cursor-not-allowed' // Dim and change cursor if disabled
            )}
            // +++ Disable the underlying button semantics +++
            disabled={isDisabled}
        >
            <div
                className={`rounded-full p-1 transition-colors duration-200 ${
                    // Style based on completion only if NOT disabled
                    !isDisabled && isComplete
                        ? 'border-2 border-green-500'
                        : // If disabled, use a neutral/gray border
                        isDisabled
                        ? 'border-2 border-gray-400'
                        : // Default border if not complete and not disabled
                          'border-2 border-amber-500'
                }`}
            >
                <Avatar className="h-11 w-11">
                    {photoUrl64 ? <AvatarImage src={'uploads/' + photoUrl64} alt={name} /> : <AvatarFallback>{initials}</AvatarFallback>}
                </Avatar>
            </div>
        </Toggle>
    );
};

export default ToggleableAvatar;
