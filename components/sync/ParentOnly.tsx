'use client';

import { ShieldAlert } from 'lucide-react';
import { useIsParent } from './session';

/** Shows what it holds to a parent, and to anyone else that the page is a parent's. */
export function ParentOnly({ children }: { children: React.ReactNode }) {
    if (useIsParent()) return <>{children}</>;
    return (
        <div className="flex h-[60vh] flex-col items-center justify-center space-y-4 px-4 text-center" data-testid="parent-only">
            <ShieldAlert className="h-16 w-16 text-destructive/50" aria-hidden />
            <h2 className="text-2xl font-bold">Access Restricted</h2>
            <p className="max-w-md text-muted-foreground">This area is for parents. Sign in as a parent from the button at the top right to see it.</p>
        </div>
    );
}
