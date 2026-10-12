import type { QueryResult, ReadOptions } from '../query-result';
import type { Refusal } from './types';

/** What an implementation must provide about sync itself. */
export interface SyncBackend {
    /** Live. Refusals this device has been sent and nobody has dismissed, newest first. */
    useRefusals(options?: ReadOptions): QueryResult<readonly Refusal[]>;
    /** Marks a refusal as seen, everywhere. */
    dismissRefusal(refusalId: string): Promise<void>;
}
