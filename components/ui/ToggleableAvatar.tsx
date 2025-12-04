// components/ui/ToggleableAvatar.tsx
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom'; // +++ Import createPortal +++
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Toggle } from '@/components/ui/toggle';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

// --- Helper: Generate random number in range ---
const random = (min: number, max: number) => Math.floor(Math.random() * (max - min)) + min;

// --- Types ---
type SparkleConfig = {
    id: string;
    top: string;
    left: string;
    size: string;
    delay: string;
    rotation: string;
};

// --- 1. The "Josh Comeau" Style Star SVG ---
const Star = ({ className }: { className?: string }) => (
    <svg viewBox="0 0 68 68" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
        <path
            d="M26.5 25.5C19.0043 33.3697 0 34 0 34C0 34 19.1013 35.3684 26.5 43.5C33.234 50.901 34 68 34 68C34 68 36.9884 50.7065 44.5 43.5C51.6431 36.647 68 34 68 34C68 34 51.6947 32.0939 44.5 25.5C36.5605 18.2235 34 0 34 0C34 0 33.6591 17.9837 26.5 25.5Z"
            fill="currentColor"
        />
    </svg>
);

// --- 2. Sparkle Component ---
// Updated to use a wrapper for rotation so it doesn't conflict with the animation transform
const Sparkle = ({ data }: { data: SparkleConfig }) => (
    <div
        className="absolute pointer-events-none"
        style={{
            top: data.top,
            left: data.left,
            zIndex: 20,
            transform: `rotate(${data.rotation})`, // Random static rotation applied to wrapper
        }}
    >
        <div
            className="animate-sparkle"
            style={{
                animationDelay: data.delay,
                width: data.size,
                height: data.size,
            }}
        >
            <Star className="text-yellow-400 w-full h-full" />
        </div>
    </div>
);

const ToggleableAvatar = ({ name, photoUrls, isComplete, onToggle, isDisabled = false, completerName = '', choreTitle = '' }) => {
    const { toast } = useToast();
    // State now holds the array of sparkle data instead of just a boolean
    const [sparkles, setSparkles] = useState<SparkleConfig[]>([]);

    // +++ New State for Portal Positioning +++
    const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, height: 0 });
    const buttonRef = useRef<HTMLButtonElement>(null); // Ref to measure the avatar button

    // We use this ref to track if the completion was triggered by a user click.
    // This prevents sparkles from showing when navigating to a day where the task is already complete.
    const wasToggledRef = useRef(false);

    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase();

    const photoUrl64 = photoUrls?.[64];

    // Function to generate random sparkles
    const generateSparkles = () => {
        const count = random(4, 7); // Generate between 4 and 7 sparkles
        const newSparkles: SparkleConfig[] = [];
        const now = Date.now();

        for (let i = 0; i < count; i++) {
            // Random position roughly around the border ring (-40% to 120% range relative to container)
            const top = random(-40, 120) + '%';
            const left = random(-40, 120) + '%';
            // Random size between 12px and 28px
            const size = random(12, 28) + 'px';
            // Random delay up to 800ms so they don't all pop at once
            const delay = random(0, 800) + 'ms';
            // Random rotation for variety
            const rotation = random(0, 360) + 'deg';

            newSparkles.push({
                id: `sparkle-${now}-${i}`,
                top,
                left,
                size,
                delay,
                rotation,
            });
        }
        return newSparkles;
    };

    // +++ Effect to handle the temporary sparkle state +++
    useEffect(() => {
        // Only trigger sparkles if complete, not disabled, AND the user just toggled it.
        if (isComplete && !isDisabled && wasToggledRef.current) {
            // 1. Capture current position for the Portal
            if (buttonRef.current) {
                const rect = buttonRef.current.getBoundingClientRect();
                setCoords({
                    top: rect.top,
                    left: rect.left,
                    width: rect.width,
                    height: rect.height,
                });
            }

            // 2. Generate random sparkles and set state
            setSparkles(generateSparkles());

            // 2. Clear sparkles after 2.5 seconds
            const timer = setTimeout(() => {
                setSparkles([]);
            }, 2500);

            // Reset the toggle ref so it doesn't fire again on re-renders/navigation
            wasToggledRef.current = false;

            return () => clearTimeout(timer);
        } else if (!isComplete) {
            // If toggled off (or loaded as incomplete), clear immediately
            setSparkles([]);
        }
    }, [isComplete, isDisabled]);

    const handleToggle = (pressed: boolean) => {
        if (isDisabled) {
            // +++ Show toast if disabled +++
            toast({
                title: 'Already Completed',
                description: `${choreTitle} was completed by ${completerName}.`,
            });
        } else {
            // +++ Call original onToggle only if not disabled +++
            // Record that this action came from the user
            wasToggledRef.current = pressed;
            onToggle(pressed);
        }
    };

    return (
        <>
            {/* Inject custom keyframes for the "Grow, Rotate, Shrink" effect */}
            <style jsx global>{`
                @keyframes sparkle-spin {
                    0% {
                        transform: scale(0) rotate(0deg);
                        opacity: 0;
                    }
                    50% {
                        transform: scale(1) rotate(180deg);
                        opacity: 1;
                    }
                    100% {
                        transform: scale(0) rotate(360deg);
                        opacity: 0;
                    }
                }
                .animate-sparkle {
                    // Changed 'forwards' to 'both' to ensure opacity:0 applies during the animation-delay
                    animation: sparkle-spin 1000ms linear both;
                }
            `}</style>

            <Toggle
                ref={buttonRef} // +++ Attach Ref here +++
                pressed={isComplete && !isDisabled} // Visually unpress if disabled, even if technically complete by user
                // +++ Use the new handler +++
                onPressedChange={handleToggle}
                // +++ Apply disabled styles conditionally +++
                className={cn(
                    'p-0 data-[state=on]:bg-transparent data-[state=off]:bg-transparent group relative', // Added 'group' and 'relative'
                    isDisabled && 'opacity-50 cursor-not-allowed'
                )}
                // +++ Disable the underlying button semantics +++
                disabled={isDisabled}
            >
                {/* --- Sparkles Portal --- */}
                {/* By moving this to a Portal, we break out of the overflow:hidden/scroll containers of the list */}
                {sparkles.length > 0 &&
                    typeof document !== 'undefined' &&
                    createPortal(
                        <div
                            className="fixed z-[9999] pointer-events-none overflow-visible"
                            style={{
                                top: coords.top,
                                left: coords.left,
                                width: coords.width,
                                height: coords.height,
                            }}
                        >
                            {sparkles.map((sparkle) => (
                                <Sparkle key={sparkle.id} data={sparkle} />
                            ))}
                        </div>,
                        document.body
                    )}

                <div
                    className={cn(
                        'rounded-full p-1 border-2 transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] relative z-10', // +++ Added 'relative' and z-10 +++
                        // Style based on completion only if NOT disabled
                        !isDisabled && isComplete
                            ? 'border-green-500 bg-green-500 shadow-[0_0_15px_rgba(34,197,94,0.6)] scale-110' // Complete: Fill gap, Glow, and Pop
                            : isDisabled
                            ? 'border-gray-400 bg-transparent' // Disabled: Gray border, transparent gap
                            : 'border-amber-500 bg-transparent' // Incomplete: Amber border, transparent gap
                    )}
                >
                    <Avatar className="h-11 w-11 relative z-20">
                        {photoUrl64 ? <AvatarImage src={'uploads/' + photoUrl64} alt={name} /> : <AvatarFallback>{initials}</AvatarFallback>}
                    </Avatar>
                </div>
            </Toggle>
        </>
    );
};

export default ToggleableAvatar;
