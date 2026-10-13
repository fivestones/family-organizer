import { currentDevice } from '../powersync/current';
import { useLiveRead } from '../powersync/live';
import type { ClientDatabase } from '../powersync/schema';
import { all, sqlFor, type Reader } from '../powersync/sql';
import type { QueryResult, ReadOptions } from '../query-result';
import type { Envelope, ExchangeRate, LedgerEntry } from './types';

// Money as a device reads it: from its own database, like everything else. Nothing here asks the server.

type EnvelopeRow = ClientDatabase['allowance_envelopes'];
type BalanceRow = Pick<ClientDatabase['envelope_balances'], 'envelope_id' | 'currency' | 'amount'>;
type EntryRow = ClientDatabase['allowance_transactions'];
type RateRow = ClientDatabase['exchange_rates'];

interface RawEnvelopes {
    envelopes: EnvelopeRow[];
    balances: BalanceRow[];
    defaults: Array<{ default_envelope_id: string | null }>;
}

const NO_ENVELOPES: Envelope[] = [];
const NO_ENTRIES: LedgerEntry[] = [];
const NO_RATES: ExchangeRate[] = [];

/** Envelopes in use, with what each holds, at one moment. One member's, or with no member given everyone's. */
export async function readEnvelopes(reader: Reader, memberId?: string | null): Promise<RawEnvelopes> {
    const inUse = sqlFor.selectFrom('allowance_envelopes').selectAll().where('archived_at', 'is', null);
    return {
        envelopes: await all<EnvelopeRow>(reader, (memberId ? inUse.where('family_member_id', '=', memberId) : inUse).orderBy('name').orderBy('id')),
        balances: await all<BalanceRow>(reader, sqlFor.selectFrom('envelope_balances').select(['envelope_id', 'currency', 'amount'])),
        defaults: await all(reader, sqlFor.selectFrom('family_members').select('default_envelope_id').where('default_envelope_id', 'is not', null)),
    };
}

export function toEnvelopes(raw: RawEnvelopes): Envelope[] {
    const defaults = new Set(raw.defaults.map((row) => row.default_envelope_id));
    const held = new Map<string, Record<string, number>>();
    for (const row of raw.balances) {
        if (!row.envelope_id || !row.currency || row.amount === null) continue;
        const balances = held.get(row.envelope_id) ?? {};
        balances[row.currency] = row.amount;
        held.set(row.envelope_id, balances);
    }
    return raw.envelopes.map((row) => ({
        id: row.id,
        familyMemberId: row.family_member_id,
        name: row.name ?? '',
        description: row.description,
        goalAmount: row.goal_amount,
        goalCurrency: row.goal_currency,
        balances: held.get(row.id) ?? {},
        isDefault: defaults.has(row.id),
    }));
}

/** Live. A member's envelopes that are in use, with what each holds. With no member, every member's. */
export function useEnvelopes(memberId?: string | null, options?: ReadOptions): QueryResult<Envelope[]> {
    return useLiveRead(currentDevice().db, ['allowance_envelopes', 'envelope_balances', 'family_members'], (reader) => readEnvelopes(reader, memberId), toEnvelopes, NO_ENVELOPES, [memberId ?? ''], options);
}

/** What an envelope is called and whose it is, for every envelope there has ever been: the ledger names archived ones too. */
export interface EnvelopeName {
    id: string;
    name: string;
    familyMemberId: string | null;
    isArchived: boolean;
}

const NO_NAMES: EnvelopeName[] = [];

/** Live. Every envelope, archived or not, by name and owner, for showing what a ledger entry was about. */
export function useEnvelopeNames(options?: ReadOptions): QueryResult<EnvelopeName[]> {
    return useLiveRead(
        currentDevice().db,
        ['allowance_envelopes'],
        (reader) => all(reader, sqlFor.selectFrom('allowance_envelopes').select(['id', 'name', 'family_member_id', 'archived_at']).orderBy('id')),
        (rows) => rows.map((row) => ({ id: row.id, name: row.name ?? '', familyMemberId: row.family_member_id, isArchived: row.archived_at !== null })),
        NO_NAMES,
        [],
        options
    );
}

function toEntry(row: EntryRow): LedgerEntry {
    return {
        id: row.id,
        envelopeId: row.envelope_id ?? '',
        sourceEnvelopeId: row.source_envelope_id,
        destinationEnvelopeId: row.destination_envelope_id,
        type: row.transaction_type ?? '',
        amount: row.amount ?? 0,
        currency: row.currency ?? '',
        description: row.description ?? '',
        createdBy: row.created_by,
        createdAt: row.created_at ?? '',
    };
}

export interface LedgerFilter {
    /** Only what happened to these envelopes. Left out, everything. */
    envelopeIds?: readonly string[];
    /** The newest so many. Left out, all of them. */
    limit?: number;
}

/** The ledger, newest first. */
export async function readLedger(reader: Reader, filter: LedgerFilter = {}): Promise<EntryRow[]> {
    if (filter.envelopeIds && filter.envelopeIds.length === 0) return [];
    let query = sqlFor.selectFrom('allowance_transactions').selectAll().orderBy('created_at', 'desc').orderBy('id');
    if (filter.envelopeIds) query = query.where('envelope_id', 'in', [...filter.envelopeIds]);
    if (filter.limit) query = query.limit(filter.limit);
    return all<EntryRow>(reader, query);
}

/** Live. What has happened to some envelopes, or to all of them, newest first. */
export function useLedger(filter: LedgerFilter = {}, options?: ReadOptions): QueryResult<LedgerEntry[]> {
    const key = `${filter.envelopeIds ? [...filter.envelopeIds].sort().join(',') : '*'}|${filter.limit ?? ''}`;
    return useLiveRead(currentDevice().db, ['allowance_transactions'], (reader) => readLedger(reader, filter), (rows) => rows.map(toEntry), NO_ENTRIES, [key], options);
}

/** Live. The exchange rates last fetched. */
export function useExchangeRates(options?: ReadOptions): QueryResult<ExchangeRate[]> {
    return useLiveRead(
        currentDevice().db,
        ['exchange_rates'],
        (reader) => all<RateRow>(reader, sqlFor.selectFrom('exchange_rates').selectAll().orderBy('base_currency').orderBy('target_currency')),
        (rows) => rows.filter((row) => row.base_currency && row.target_currency && row.rate !== null).map((row) => ({ baseCurrency: row.base_currency!, targetCurrency: row.target_currency!, rate: row.rate!, fetchedAt: row.fetched_at ?? '' })),
        NO_RATES,
        [],
        options
    );
}
