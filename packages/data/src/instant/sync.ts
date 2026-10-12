import type { SyncBackend } from '../sync/backend';

// InstantDB answers a write while the device is waiting, so there is never a refusal that arrives later.
const NONE = { data: [], isLoading: false, error: undefined };

export function createInstantSyncBackend(): SyncBackend {
    return { useRefusals: () => NONE, dismissRefusal: async () => undefined };
}
