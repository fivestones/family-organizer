import { currentDevice } from '../powersync/current';
import { askServer, waitUntilSent } from '../powersync/server';
import type { FinanceRequest, FinanceResult } from './types';

// Money is changed by asking the server, as the signed-in person. It needs a connection; what it changes arrives
// on this device, and every other, by sync.

/** Asks the server to carry out one change to money. Rejects with its reason when it will not, or when it cannot be reached. */
export async function requestFinance<Result extends FinanceResult = FinanceResult>(request: FinanceRequest): Promise<Result> {
    const answer = await askServer<{ result: Result }>(currentDevice(), '/api/finance/mutations', { method: 'POST', body: request });
    return answer.result;
}

/**
 * Makes sure a member has an envelope for money to go into, and answers with it. Asked for someone added a moment
 * ago, it waits until they have reached the server. Asked twice, the server makes one.
 */
export async function ensureFirstEnvelope(memberId: string): Promise<string> {
    await waitUntilSent(currentDevice());
    return requestFinance<string>({ operation: 'create-initial', familyMemberId: memberId });
}
