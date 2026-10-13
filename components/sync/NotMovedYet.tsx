'use client';

import Link from 'next/link';
import { Hammer } from 'lucide-react';

/** A page that has not been built on PowerSync yet. Its place in the navigation is kept so nothing moves when it is. */
export function NotMovedYet() {
    return (
        <div className="flex h-[60vh] flex-col items-center justify-center space-y-4 px-4 text-center" data-testid="not-moved-yet">
            <Hammer className="h-14 w-14 text-muted-foreground/60" aria-hidden />
            <h2 className="text-2xl font-bold">This page is on its way</h2>
            <p className="max-w-md text-muted-foreground">It has not been moved to the new app yet. Everything already here keeps working.</p>
            <Link href="/chores" className="font-medium text-sky-700 hover:underline">
                Go to today’s chores
            </Link>
        </div>
    );
}
