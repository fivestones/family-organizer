import type { RefusalReason } from '../policy';

/** A change the server refused. It was shown on the device as done; this is how the person who made it learns it was not. */
export interface Refusal {
    id: string;
    /** Whose change it was. `null` for the shared kid session. */
    familyMemberId: string | null;
    /** The name of the mutation that made the change, such as `completeChore`. */
    mutation: string | null;
    reason: RefusalReason;
    /** The table and row the refused write was to. */
    tableName: string | null;
    rowId: string | null;
    /** ISO 8601. */
    refusedAt: string;
}
