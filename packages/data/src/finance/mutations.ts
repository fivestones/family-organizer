import { currentDevice } from '../powersync/current';
import { recordHistory } from '../powersync/history';
import { mutate } from '../powersync/mutate';
import { readRow, updateRow } from '../powersync/rows';
import { askServer, waitUntilSent } from '../powersync/server';
import { first, sqlFor } from '../powersync/sql';
import type { ExchangeRate, FinanceRequest, FinanceResult } from './types';

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

/**
 * Asks the server for current exchange rates. It fetches them if what it has is old, and what it keeps reaches
 * every device by sync; the answer is given here too, for a screen that is waiting on it.
 */
export async function refreshExchangeRates(): Promise<{ base: string; rates: Record<string, number>; source: 'cache' | 'provider' }> {
    return askServer(currentDevice(), '/api/exchange-rates');
}

// ---- What a device may change about an envelope itself: what it is called, and what is being saved for ----

const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

export interface EnvelopeChanges {
    name?: string;
    description?: string | null;
    /** A goal is an amount of a currency. `null` for the amount removes the goal. */
    goalAmount?: number | null;
    goalCurrency?: string | null;
}

/** Changes an envelope's name, description or goal, with an entry in the family's history. A parent may for anyone, a kid for their own. */
export async function updateEnvelope(envelopeId: string, changes: EnvelopeChanges): Promise<void> {
    const device = currentDevice();
    const columns: Record<string, unknown> = {};
    if (changes.name !== undefined) {
        const name = typeof changes.name === 'string' ? changes.name.trim() : '';
        if (!name) throw new Error('Envelope name cannot be empty.');
        columns.name = name;
    }
    if (changes.description !== undefined) columns.description = changes.description?.trim() || null;
    if (changes.goalAmount !== undefined) {
        if (changes.goalAmount !== null && !(Number.isFinite(changes.goalAmount) && changes.goalAmount > 0)) throw new Error('Goal amount must be positive if set.');
        columns.goal_amount = changes.goalAmount;
        if (changes.goalAmount === null) columns.goal_currency = null;
    }
    if (changes.goalCurrency !== undefined && columns.goal_currency === undefined) columns.goal_currency = changes.goalCurrency?.trim().toUpperCase() || null;

    return mutate(device, 'updateEnvelope', async (writer) => {
        const changed = await updateRow(device, writer, 'allowance_envelopes', envelopeId, columns);
        if (changed === null) throw new Error('That envelope no longer exists.');
        if (changed.length === 0) return;
        const envelope = (await readRow(writer, 'allowance_envelopes', envelopeId))!;
        const ownerId = typeof envelope.family_member_id === 'string' ? envelope.family_member_id : null;
        const owner = ownerId ? await first(writer, sqlFor.selectFrom('family_members').select('name').where('id', '=', ownerId)) : null;
        await recordHistory(device, writer, {
            domain: 'finance',
            actionType: 'envelope_updated',
            summary: owner?.name ? `Updated ${possessive(owner.name)} ${envelope.name}` : `Updated envelope "${envelope.name}"`,
            affectedMemberIds: [ownerId],
            metadata: { envelopeId, envelopeName: envelope.name, goalAmount: envelope.goal_amount ?? null, goalCurrency: envelope.goal_currency ?? null, memberId: ownerId, memberName: owner?.name ?? null },
        });
    });
}

/**
 * Chooses which of a member's envelopes their money goes into when nobody says. It works with no connection; the
 * server holds the choice to an envelope of the member's own that is still in use.
 */
export async function setDefaultEnvelope(memberId: string, envelopeId: string): Promise<void> {
    const device = currentDevice();
    return mutate(device, 'setDefaultEnvelope', async (writer) => {
        const envelope = await first(writer, sqlFor.selectFrom('allowance_envelopes').select(['family_member_id', 'archived_at']).where('id', '=', envelopeId));
        if (!envelope || envelope.archived_at !== null || envelope.family_member_id !== memberId) throw new Error('A default envelope is one of the member\'s own that is still in use.');
        if ((await updateRow(device, writer, 'family_members', memberId, { default_envelope_id: envelopeId })) === null) throw new Error('That family member no longer exists.');
    });
}

/** The rate between two currencies from those last fetched, through their common base if need be, or `null`. */
export function findExchangeRate(rates: readonly ExchangeRate[], from: string, to: string): { rate: number; fetchedAt: string } | null {
    const [source, target] = [from.trim().toUpperCase(), to.trim().toUpperCase()];
    if (!source || !target) return null;
    if (source === target) return { rate: 1, fetchedAt: '' };
    const direct = rates.find((rate) => rate.baseCurrency === source && rate.targetCurrency === target);
    if (direct) return { rate: direct.rate, fetchedAt: direct.fetchedAt };
    const inverse = rates.find((rate) => rate.baseCurrency === target && rate.targetCurrency === source);
    if (inverse && inverse.rate > 0) return { rate: 1 / inverse.rate, fetchedAt: inverse.fetchedAt };
    // Both priced in a third currency: the rates the provider gives are all against one base.
    for (const leg of rates) {
        if (leg.targetCurrency !== source || leg.rate <= 0) continue;
        const other = rates.find((rate) => rate.baseCurrency === leg.baseCurrency && rate.targetCurrency === target);
        if (other) return { rate: other.rate / leg.rate, fetchedAt: leg.fetchedAt < other.fetchedAt ? leg.fetchedAt : other.fetchedAt };
    }
    return null;
}

