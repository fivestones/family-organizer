import { Info } from 'lucide-react';

export function PendingAllowancePolicyNotice() {
    return (
        <div
            role="note"
            className="mb-6 flex gap-3 rounded-xl border border-blue-200 bg-blue-50/80 px-4 py-3 text-sm text-blue-950 shadow-sm dark:border-blue-800 dark:bg-blue-950/35 dark:text-blue-100"
        >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" aria-hidden="true" />
            <div>
                <p className="font-semibold">Pending periods use the current chore schedule</p>
                <p className="mt-0.5 text-blue-800 dark:text-blue-200">
                    Changes to chore weights, rotations, assignments, or excluded dates can recalculate an undistributed period. Review or edit the
                    amount before confirming; once distributed, its ledger entries are fixed and are not rewritten by later schedule edits.
                </p>
            </div>
        </div>
    );
}
