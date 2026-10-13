'use client';

import { ChoreDayScreen } from './ChoreDayScreen';
import { useSession } from './session';

export function ChoresPage() {
    const { principal } = useSession();
    return (
        <div className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-6">
            <ChoreDayScreen principal={principal} />
        </div>
    );
}
