import FamilyAllowanceView from '@/components/sync/money/FamilyAllowanceView';

/** Money: each member's envelopes, with deposits, withdrawals, transfers and their history. */
export default function Page() {
    return (
        <div className="space-y-4 p-4">
            <FamilyAllowanceView />
        </div>
    );
}
