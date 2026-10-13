import 'server-only';

import { randomUUID } from 'crypto';
import { sql, type Transaction } from 'kysely';
import type { AllowancePayoutPeriod, AllowancePayoutResult, FinanceRequest, FinanceResult, ReconcileResult } from '@family-organizer/data/finance/types';
import { isParent, type Principal } from '@family-organizer/data/session/principal';
import type { Database } from '@/db/types';
import {
    createAllowanceDistributionHistoryId,
    createAllowanceDistributionKey,
    createAllowanceDistributionTransactionId,
    toDateKey,
} from '@/lib/allowance-distribution-key';
import type { AppDatabase } from './db';
import { recordHistory } from './history';

// Money (docs/powersync-migration.md, "Money is written only by the server").
//
// Every change to a ledger or a balance is made here and nowhere else. One request is one database transaction. It
// locks the rows it is about to read and write — members first, then envelopes, each in id order, which is the one
// order every request takes them in — checks what it finds, and writes the ledger row and the balance together.
// Two requests for one envelope wait for each other in the database, so this holds however many servers run.

/** A request that cannot be carried out, with the HTTP status that says why. The message is for the person. */
export class FinanceError extends Error {
    constructor(
        message: string,
        readonly status = 400
    ) {
        super(message);
        this.name = 'FinanceError';
    }
}

type Trx = Transaction<Database>;

interface Actor {
    memberId: string;
    isParent: boolean;
}

interface Member {
    id: string;
    name: string;
    default_envelope_id: string | null;
}

interface Envelope {
    id: string;
    family_member_id: string | null;
    name: string;
}

/** A balance that differs from its ledger by less than this is the same balance. */
const TOLERANCE = 0.001;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- What a request must be ----

function text(value: unknown, label: string): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) throw new FinanceError(`${label} is required.`);
    return trimmed;
}

function id(value: unknown, label: string): string {
    const given = text(value, label);
    if (!UUID.test(given)) throw new FinanceError(`${label} is not an id.`);
    return given.toLowerCase();
}

function positive(value: unknown, what: string): number {
    const amount = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(amount)) throw new FinanceError('Amount must be a finite number.');
    if (amount <= 0) throw new FinanceError(`${what} amount must be positive.`);
    return amount;
}

const currencyCode = (value: unknown) => text(value, 'Currency').toUpperCase();
const optionalText = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

function actorOf(principal: Principal): Actor {
    // The shared kid session is nobody in particular, and money is always somebody's.
    if (!principal.familyMemberId) throw new FinanceError('Sign in as yourself to change money.', 403);
    return { memberId: principal.familyMemberId, isParent: isParent(principal) };
}

function mustBeParent(actor: Actor) {
    if (!actor.isParent) throw new FinanceError('Parent access required.', 403);
}

function mustActFor(actor: Actor, memberId: string) {
    if (!actor.isParent && actor.memberId !== memberId) throw new FinanceError('You can only change your own envelopes.', 403);
}

// ---- How an entry in the family's history reads ----

function possessive(name: string | null | undefined): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return '';
    return /s$/i.test(trimmed) ? `${trimmed}'` : `${trimmed}'s`;
}

function envelopeLabel(envelope: Envelope, owner: Member | null): string {
    const whose = possessive(owner?.name);
    return whose ? `${whose} ${envelope.name}` : envelope.name;
}

/** An amount as a person reads it. A unit that is not a currency, such as stars, is written out. */
function amountText(amount: number, currency: string): string {
    try {
        return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Math.abs(amount));
    } catch {
        return `${Math.abs(amount).toLocaleString('en-US')} ${currency}`;
    }
}

// ---- Rows, read under a lock ----

/** Locks members without stopping anyone naming them, which every ledger row and history entry does. */
async function lockMembers(trx: Trx, ids: readonly string[]): Promise<Map<string, Member>> {
    if (ids.length === 0) return new Map();
    const rows = await trx
        .selectFrom('family_members')
        .select(['id', 'name', 'default_envelope_id'])
        .where('id', 'in', Array.from(new Set(ids)))
        .orderBy('id')
        .forNoKeyUpdate()
        .execute();
    return new Map(rows.map((row) => [row.id, row]));
}

/** Locks envelopes that are in use. One that is missing or archived is not found. */
async function lockEnvelopes(trx: Trx, ids: readonly string[]): Promise<Map<string, Envelope>> {
    const wanted = Array.from(new Set(ids));
    const rows = await trx
        .selectFrom('allowance_envelopes')
        .select(['id', 'family_member_id', 'name'])
        .where('id', 'in', wanted)
        .where('archived_at', 'is', null)
        .orderBy('id')
        .forUpdate()
        .execute();
    if (rows.length !== wanted.length) throw new FinanceError('Active envelope not found.', 404);
    return new Map(rows.map((row) => [row.id, row]));
}

/** Locks every envelope a member has in use, in the order they are offered when one must be picked. */
async function lockEnvelopesOf(trx: Trx, memberId: string): Promise<Envelope[]> {
    const rows = await trx
        .selectFrom('allowance_envelopes')
        .select(['id', 'family_member_id', 'name'])
        .where('family_member_id', '=', memberId)
        .where('archived_at', 'is', null)
        .orderBy('id')
        .forUpdate()
        .execute();
    return rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Whose envelopes these are, read without a lock: enough to know which members to lock before them. */
async function ownersOf(trx: Trx, envelopeIds: readonly string[]): Promise<string[]> {
    const rows = await trx.selectFrom('allowance_envelopes').select('family_member_id').where('id', 'in', Array.from(new Set(envelopeIds))).execute();
    return rows.map((row) => row.family_member_id).filter((owner): owner is string => owner !== null);
}

async function namesOf(trx: Trx, memberIds: ReadonlyArray<string | null>): Promise<Map<string, Member>> {
    const ids = Array.from(new Set(memberIds.filter((memberId): memberId is string => memberId !== null)));
    if (ids.length === 0) return new Map();
    const rows = await trx.selectFrom('family_members').select(['id', 'name', 'default_envelope_id']).where('id', 'in', ids).execute();
    return new Map(rows.map((row) => [row.id, row]));
}

async function balanceOf(trx: Trx, envelopeId: string, currency: string): Promise<number> {
    const row = await trx.selectFrom('envelope_balances').select('amount').where('envelope_id', '=', envelopeId).where('currency', '=', currency).executeTakeFirst();
    return row?.amount ?? 0;
}

/** An envelope holds a row for each currency it holds any of, so nothing is no row. */
async function setBalance(trx: Trx, envelopeId: string, currency: string, amount: number): Promise<void> {
    if (Math.abs(amount) < Number.EPSILON) {
        await trx.deleteFrom('envelope_balances').where('envelope_id', '=', envelopeId).where('currency', '=', currency).execute();
        return;
    }
    await trx
        .insertInto('envelope_balances')
        .values({ envelope_id: envelopeId, currency, amount })
        .onConflict((conflict) => conflict.columns(['envelope_id', 'currency']).doUpdateSet({ amount }))
        .execute();
}

interface LedgerEntry {
    id?: string;
    envelopeId: string;
    sourceEnvelopeId?: string;
    destinationEnvelopeId?: string;
    type: string;
    amount: number;
    currency: string;
    description: string;
    distributionKey?: string;
}

async function post(trx: Trx, actor: Actor, at: Date, entry: LedgerEntry): Promise<string> {
    const entryId = entry.id ?? randomUUID();
    await trx
        .insertInto('allowance_transactions')
        .values({
            id: entryId,
            envelope_id: entry.envelopeId,
            source_envelope_id: entry.sourceEnvelopeId ?? null,
            destination_envelope_id: entry.destinationEnvelopeId ?? null,
            transaction_type: entry.type,
            amount: entry.amount,
            currency: entry.currency,
            description: entry.description,
            created_by: actor.memberId,
            distribution_key: entry.distributionKey ?? null,
            created_at: at,
        })
        .execute();
    return entryId;
}

// ---- Envelopes ----

interface NewEnvelope {
    name: string;
    description: string | null;
    goalAmount: number | null;
    goalCurrency: string | null;
    isDefault: boolean;
}

/** Makes an envelope, with the ledger row every envelope begins with. The member is already locked. */
async function createEnvelope(trx: Trx, actor: Actor, at: Date, member: Member, envelope: NewEnvelope): Promise<string> {
    const envelopeId = randomUUID();
    await trx
        .insertInto('allowance_envelopes')
        .values({ id: envelopeId, family_member_id: member.id, name: envelope.name, description: envelope.description, goal_amount: envelope.goalAmount, goal_currency: envelope.goalCurrency })
        .execute();
    // A member with an envelope has a default: the first they are given, until another is chosen.
    const becomesDefault = envelope.isDefault || member.default_envelope_id === null;
    if (becomesDefault) await trx.updateTable('family_members').set({ default_envelope_id: envelopeId }).where('id', '=', member.id).execute();

    const opening = await post(trx, actor, at, { envelopeId, type: 'init', amount: 0, currency: 'USD', description: 'Envelope Created' });
    await recordHistory(trx, {
        occurredAt: at,
        domain: 'finance',
        actionType: 'envelope_created',
        summary: `Created envelope "${envelope.name}"`,
        source: 'manual',
        actorId: actor.memberId,
        affectedMemberIds: [member.id],
        allowanceTransactionId: opening,
        metadata: {
            envelopeId,
            envelopeName: envelope.name,
            isDefault: becomesDefault,
            goalAmount: envelope.goalAmount,
            goalCurrency: envelope.goalCurrency,
            ...(envelope.description ? { description: envelope.description } : {}),
        },
    });
    return envelopeId;
}

/** The envelope money goes into when nobody says: the member's default, or failing that one called Savings, or the first. */
function pickEnvelope(member: Member, envelopes: readonly Envelope[]): Envelope | null {
    return envelopes.find((envelope) => envelope.id === member.default_envelope_id) ?? envelopes.find((envelope) => envelope.name === 'Savings') ?? envelopes[0] ?? null;
}

async function lockMember(trx: Trx, memberId: string, missing: string): Promise<Member> {
    const member = (await lockMembers(trx, [memberId])).get(memberId);
    if (!member) throw new FinanceError(missing, 404);
    return member;
}

async function createInitial(trx: Trx, actor: Actor, at: Date, request: Extract<FinanceRequest, { operation: 'create-initial' }>): Promise<string> {
    const memberId = id(request.familyMemberId, 'Family member ID');
    mustActFor(actor, memberId);
    const member = await lockMember(trx, memberId, 'Family member not found.');
    // Asked for twice, by a form and by a page that both found none, it is made once.
    const existing = pickEnvelope(member, await lockEnvelopesOf(trx, memberId));
    if (existing) {
        if (member.default_envelope_id === null) await trx.updateTable('family_members').set({ default_envelope_id: existing.id }).where('id', '=', memberId).execute();
        return existing.id;
    }
    return createEnvelope(trx, actor, at, member, { name: 'Savings', description: null, goalAmount: null, goalCurrency: null, isDefault: true });
}

async function createNamed(trx: Trx, actor: Actor, at: Date, request: Extract<FinanceRequest, { operation: 'create-envelope' }>): Promise<string> {
    const memberId = id(request.familyMemberId, 'Family member ID');
    mustActFor(actor, memberId);
    const name = text(request.name, 'Envelope name');
    const goalAmount = request.goalAmount == null ? null : Number(request.goalAmount);
    const goalCurrency = optionalText(request.goalCurrency);
    if (goalAmount !== null && !(Number.isFinite(goalAmount) && goalAmount > 0)) throw new FinanceError('Goal amount must be positive if set.');
    if (goalAmount !== null && !goalCurrency) throw new FinanceError('Goal currency must be specified if goal amount is set.');
    const member = await lockMember(trx, memberId, 'Family member not found.');
    return createEnvelope(trx, actor, at, member, { name, description: optionalText(request.description), goalAmount, goalCurrency, isDefault: request.isDefault === true });
}

// ---- Money in, out and across ----

async function depositOrWithdraw(trx: Trx, actor: Actor, at: Date, request: Extract<FinanceRequest, { operation: 'deposit' | 'withdraw' }>): Promise<null> {
    const isDeposit = request.operation === 'deposit';
    const envelopeId = id(request.envelopeId, 'Envelope ID');
    const amount = positive(request.amount, isDeposit ? 'Deposit' : 'Withdrawal');
    const currency = currencyCode(request.currency);
    const description = optionalText(request.description) ?? (isDeposit ? 'Deposit' : 'Withdrawal');

    const envelope = (await lockEnvelopes(trx, [envelopeId])).get(envelopeId)!;
    if (!envelope.family_member_id) throw new FinanceError('Envelope owner not found.', 409);
    mustActFor(actor, envelope.family_member_id);
    const owner = (await namesOf(trx, [envelope.family_member_id])).get(envelope.family_member_id) ?? null;

    const held = await balanceOf(trx, envelopeId, currency);
    if (!isDeposit && held < amount) throw new FinanceError(`Insufficient ${currency} funds in ${envelope.name}. Available: ${held}, Tried: ${amount}`);
    await setBalance(trx, envelopeId, currency, isDeposit ? held + amount : held - amount);
    const entry = await post(trx, actor, at, { envelopeId, type: isDeposit ? 'deposit' : 'withdrawal', amount: isDeposit ? amount : -amount, currency, description });

    await recordHistory(trx, {
        occurredAt: at,
        domain: 'finance',
        actionType: isDeposit ? 'envelope_deposit' : 'envelope_withdrawal',
        summary: `${isDeposit ? 'Deposited' : 'Withdrew'} ${amountText(amount, currency)} ${isDeposit ? 'to' : 'from'} ${envelopeLabel(envelope, owner)}`,
        source: 'manual',
        actorId: actor.memberId,
        affectedMemberIds: [envelope.family_member_id],
        allowanceTransactionId: entry,
        metadata: { amount, currency, description, envelopeId, envelopeName: envelope.name, memberId: envelope.family_member_id, memberName: owner?.name ?? null },
    });
    return null;
}

async function transfer(trx: Trx, actor: Actor, at: Date, request: Extract<FinanceRequest, { operation: 'transfer' | 'transfer-person' }>): Promise<null> {
    const betweenPeople = request.operation === 'transfer-person';
    const sourceId = id(request.sourceEnvelopeId, 'Source envelope ID');
    const destinationId = id(request.destinationEnvelopeId, 'Destination envelope ID');
    const amount = positive(request.amount, 'Transfer');
    const currency = currencyCode(request.currency);
    if (sourceId === destinationId) throw new FinanceError('Cannot transfer funds to the same envelope.');

    const envelopes = await lockEnvelopes(trx, [sourceId, destinationId]);
    const [source, destination] = [envelopes.get(sourceId)!, envelopes.get(destinationId)!];
    if (!source.family_member_id || !destination.family_member_id) throw new FinanceError('Envelope owner not found.', 409);
    mustActFor(actor, source.family_member_id);
    if (!betweenPeople && source.family_member_id !== destination.family_member_id) {
        throw new FinanceError('Envelope transfers must stay within one family member.', 409);
    }
    const owners = await namesOf(trx, [source.family_member_id, destination.family_member_id]);
    const [sender, recipient] = [owners.get(source.family_member_id) ?? null, owners.get(destination.family_member_id) ?? null];

    const held = await balanceOf(trx, sourceId, currency);
    if (held < amount) {
        throw new FinanceError(
            betweenPeople ? `Insufficient ${currency} funds in source envelope (${source.name}). Available: ${held}, Tried: ${amount}` : `Insufficient ${currency} funds in ${source.name}.`
        );
    }
    const description = betweenPeople
        ? (optionalText(request.description) ?? `Transfer from ${sender?.name ?? 'other member'} to ${recipient?.name ?? 'other member'}`)
        : `Transfer from ${source.name} to ${destination.name}`;

    await setBalance(trx, sourceId, currency, held - amount);
    await setBalance(trx, destinationId, currency, (await balanceOf(trx, destinationId, currency)) + amount);
    // Each side of a transfer has a row of its own, and each row says where the money came from and went.
    const both = { sourceEnvelopeId: sourceId, destinationEnvelopeId: destinationId, currency, description };
    const out = await post(trx, actor, at, { ...both, envelopeId: sourceId, type: betweenPeople ? 'transfer-out-person' : 'transfer-out', amount: -amount });
    await post(trx, actor, at, { ...both, envelopeId: destinationId, type: betweenPeople ? 'transfer-in-person' : 'transfer-in', amount });

    const names = betweenPeople
        ? { sourceEnvelopeId: sourceId, sourceEnvelopeName: source.name, destinationEnvelopeId: destinationId, destinationEnvelopeName: destination.name, sourceMemberId: sender?.id ?? null, sourceMemberName: sender?.name ?? null, destinationMemberId: recipient?.id ?? null, destinationMemberName: recipient?.name ?? null }
        : { fromEnvelopeId: sourceId, fromEnvelopeName: source.name, toEnvelopeId: destinationId, toEnvelopeName: destination.name, fromMemberId: sender?.id ?? null, fromMemberName: sender?.name ?? null, toMemberId: recipient?.id ?? null, toMemberName: recipient?.name ?? null };
    await recordHistory(trx, {
        occurredAt: at,
        domain: 'finance',
        actionType: betweenPeople ? 'person_transfer' : 'envelope_transfer',
        summary: `Transferred ${amountText(amount, currency)} from ${envelopeLabel(source, sender)} to ${envelopeLabel(destination, recipient)}`,
        source: 'manual',
        actorId: actor.memberId,
        affectedMemberIds: [source.family_member_id, destination.family_member_id],
        allowanceTransactionId: out,
        metadata: { amount, currency, description, ...names },
    });
    return null;
}

async function archive(trx: Trx, actor: Actor, at: Date, request: Extract<FinanceRequest, { operation: 'archive' }>): Promise<null> {
    mustBeParent(actor);
    const envelopeId = id(request.envelopeId, 'Envelope ID');
    const targetId = id(request.transferToEnvelopeId, 'Envelope to transfer to');
    const newDefaultId = request.newDefaultEnvelopeId ? id(request.newDefaultEnvelopeId, 'New default envelope ID') : null;
    if (envelopeId === targetId) throw new FinanceError('Cannot transfer funds to the envelope being deleted.');

    const [ownerId] = await ownersOf(trx, [envelopeId]);
    if (!ownerId) throw new FinanceError('Active envelope not found.', 404);
    const member = await lockMember(trx, ownerId, 'Envelope owner not found.');
    const inUse = await lockEnvelopesOf(trx, ownerId);
    const envelope = inUse.find((candidate) => candidate.id === envelopeId);
    const target = inUse.find((candidate) => candidate.id === targetId);
    if (!envelope) throw new FinanceError('Active envelope not found.', 404);
    if (!target) throw new FinanceError('Archived funds must move to an envelope owned by the same member.', 409);
    if (newDefaultId && !inUse.some((candidate) => candidate.id === newDefaultId)) throw new FinanceError('The new default envelope must belong to the same member.', 409);
    const isDefault = member.default_envelope_id === envelopeId;
    if (isDefault && !newDefaultId) throw new FinanceError('Must specify a new default envelope when deleting the default.');
    if (isDefault && newDefaultId === envelopeId) throw new FinanceError('New default cannot be the deleted envelope.');

    // Everything moves, a debt included, so that archiving cannot change what the member has in all.
    const description = `Transfer from deleted envelope ${envelope.name} to ${target.name}`;
    const held = await trx.selectFrom('envelope_balances').select(['currency', 'amount']).where('envelope_id', '=', envelopeId).orderBy('currency').execute();
    for (const { currency, amount } of held) {
        if (amount === 0) continue;
        const both = { sourceEnvelopeId: envelopeId, destinationEnvelopeId: targetId, currency, description };
        await post(trx, actor, at, { ...both, envelopeId, type: 'transfer-out', amount: -amount });
        await post(trx, actor, at, { ...both, envelopeId: targetId, type: 'transfer-in', amount });
        await setBalance(trx, targetId, currency, (await balanceOf(trx, targetId, currency)) + amount);
    }
    await trx.deleteFrom('envelope_balances').where('envelope_id', '=', envelopeId).execute();
    // The default moves before the envelope is put away: the database will not archive a default.
    if (isDefault) await trx.updateTable('family_members').set({ default_envelope_id: newDefaultId }).where('id', '=', ownerId).execute();
    await trx.updateTable('allowance_envelopes').set({ archived_at: at }).where('id', '=', envelopeId).execute();

    await recordHistory(trx, {
        occurredAt: at,
        domain: 'finance',
        actionType: 'envelope_deleted',
        summary: `Deleted ${envelopeLabel(envelope, member)}`,
        source: 'manual',
        actorId: actor.memberId,
        affectedMemberIds: [ownerId],
        metadata: {
            deletedEnvelopeId: envelopeId,
            deletedEnvelopeName: envelope.name,
            transferToEnvelopeId: targetId,
            transferToEnvelopeName: target.name,
            newDefaultEnvelopeId: isDefault ? newDefaultId : null,
            deletedMemberId: ownerId,
            deletedMemberName: member.name,
            transferToMemberId: ownerId,
            transferToMemberName: member.name,
        },
    });
    return null;
}

// ---- A balance against its ledger ----

/**
 * Replays the ledgers of envelopes that are already locked and rewrites a balance that disagrees with its own.
 * With both written in one transaction they should never disagree; this is for a row changed by hand.
 */
async function reconcileLocked(trx: Trx, envelopes: readonly Envelope[]): Promise<ReconcileResult> {
    const result: ReconcileResult = { fixedEnvelopeIds: [], unverifiableEnvelopeIds: [] };
    if (envelopes.length === 0) return result;
    const ids = envelopes.map((envelope) => envelope.id);
    const ledger = await trx
        .selectFrom('allowance_transactions')
        .select(['envelope_id', sql<string>`upper(trim(currency))`.as('currency'), sql<number>`sum(amount)::double precision`.as('total')])
        .where('envelope_id', 'in', ids)
        .groupBy(['envelope_id', sql`upper(trim(currency))`])
        .execute();
    const balances = await trx.selectFrom('envelope_balances').select(['envelope_id', 'currency', 'amount']).where('envelope_id', 'in', ids).execute();

    for (const envelope of envelopes) {
        const fromLedger = new Map(ledger.filter((row) => row.envelope_id === envelope.id && row.currency).map((row) => [row.currency, row.total]));
        const held = new Map<string, number>();
        for (const row of balances.filter((balance) => balance.envelope_id === envelope.id)) {
            const currency = row.currency.trim().toUpperCase();
            held.set(currency, (held.get(currency) ?? 0) + row.amount);
        }
        const hasLedger = ledger.some((row) => row.envelope_id === envelope.id);
        if (!hasLedger) {
            if (Array.from(held.values()).some((amount) => Math.abs(amount) > TOLERANCE)) result.unverifiableEnvelopeIds.push(envelope.id);
            continue;
        }
        const currencies = Array.from(new Set(Array.from(fromLedger.keys()).concat(Array.from(held.keys()))));
        const agrees = currencies.every((currency) => Math.abs((held.get(currency) ?? 0) - (fromLedger.get(currency) ?? 0)) <= TOLERANCE);
        if (agrees) continue;
        await trx.deleteFrom('envelope_balances').where('envelope_id', '=', envelope.id).execute();
        for (const [currency, total] of Array.from(fromLedger)) await setBalance(trx, envelope.id, currency, total);
        result.fixedEnvelopeIds.push(envelope.id);
    }
    return result;
}

async function reconcile(trx: Trx, actor: Actor, request: Extract<FinanceRequest, { operation: 'reconcile' }>): Promise<ReconcileResult> {
    mustBeParent(actor);
    const memberId = id(request.familyMemberId, 'Family member ID');
    return reconcileLocked(trx, await lockEnvelopesOf(trx, memberId));
}

// ---- Allowance ----

interface Payout {
    amount: number;
    currency: string;
    distributionKey: string;
    entryId: string;
}

/** What each period pays, in each currency, with the key that makes paying it twice impossible. */
function preparePeriods(memberId: string, primaryCurrency: string, periods: readonly AllowancePayoutPeriod[]) {
    const seen = new Set<string>();
    return periods.map((period) => {
        if (!period || typeof period.id !== 'string' || !period.id) throw new FinanceError('Allowance payout period ID is required.');
        if (typeof period.amount !== 'number' || !Number.isFinite(period.amount)) throw new FinanceError('Allowance payout amount must be a finite number.');
        let start: string;
        let end: string;
        try {
            [start, end] = [toDateKey(period.periodStartDate), toDateKey(period.periodEndDate)];
        } catch (error) {
            throw new FinanceError(error instanceof Error ? error.message : 'Allowance payout period contains an invalid date.');
        }
        if (seen.has(`${start}:${end}`)) throw new FinanceError(`Allowance payout contains the same period more than once: ${start} to ${end}.`);
        seen.add(`${start}:${end}`);

        const amounts = new Map<string, number>([[primaryCurrency, period.amount]]);
        for (const [code, raw] of Object.entries(period.additionalAmountsByCurrency ?? {})) {
            const currency = currencyCode(code);
            const amount = Number(raw);
            if (!Number.isFinite(amount)) throw new FinanceError(`Allowance payout amount for ${currency} must be a finite number.`);
            amounts.set(currency, (amounts.get(currency) ?? 0) + amount);
        }
        const payoutIn = (currency: string, amount: number): Payout => ({
            amount,
            currency,
            distributionKey: createAllowanceDistributionKey(memberId, start, end, currency),
            entryId: createAllowanceDistributionTransactionId(memberId, start, end, currency),
        });
        const payouts = Array.from(amounts).filter(([, amount]) => amount !== 0).map(([currency, amount]) => payoutIn(currency, amount));
        // A period that pays nothing is still recorded as paid.
        if (payouts.length === 0) payouts.push(payoutIn(primaryCurrency, 0));
        const completions = Array.isArray(period.completionsToMark) ? period.completionsToMark.filter((completion) => typeof completion === 'string' && UUID.test(completion)) : [];
        return { id: period.id, start, end, description: optionalText(period.description), payouts, completions: Array.from(new Set(completions)) };
    });
}

async function payAllowance(trx: Trx, actor: Actor, at: Date, request: Extract<FinanceRequest, { operation: 'allowance-payout' }>): Promise<AllowancePayoutResult> {
    mustBeParent(actor);
    const memberId = id(request.memberId, 'Family member ID');
    const primaryCurrency = text(request.primaryCurrency, 'Allowance payout currency').toUpperCase();
    if (!Array.isArray(request.periods) || request.periods.length === 0) throw new FinanceError('At least one allowance period is required.');
    const periods = preparePeriods(memberId, primaryCurrency, request.periods);

    let member = await lockMember(trx, memberId, 'Allowance payout member could not be found.');
    const envelopes = await lockEnvelopesOf(trx, memberId);
    await reconcileLocked(trx, envelopes);

    const wanted = periods.flatMap((period) => period.payouts.map((payout) => payout.entryId));
    const paid = new Set((await trx.selectFrom('allowance_transactions').select('id').where('id', 'in', wanted).execute()).map((row) => row.id));
    const pending = periods.map((period) => ({ ...period, payouts: period.payouts.filter((payout) => !paid.has(payout.entryId)) })).filter((period) => period.payouts.length > 0);
    const skippedPeriodIds = periods.filter((period) => period.payouts.every((payout) => paid.has(payout.entryId))).map((period) => period.id);
    let envelope = pickEnvelope(member, envelopes);
    if (pending.length === 0) return { processedPeriodIds: [], skippedPeriodIds, amountsByCurrency: {}, envelopeId: envelope?.id ?? null };

    if (!envelope) {
        const envelopeId = await createEnvelope(trx, actor, at, member, { name: 'Savings', description: null, goalAmount: null, goalCurrency: null, isDefault: true });
        envelope = { id: envelopeId, family_member_id: memberId, name: 'Savings' };
        member = { ...member, default_envelope_id: envelopeId };
    } else if (member.default_envelope_id !== envelope.id) {
        // The envelope an allowance is paid into is the member's default from then on, if they had none.
        await trx.updateTable('family_members').set({ default_envelope_id: envelope.id }).where('id', '=', memberId).execute();
    }

    const amountsByCurrency: Record<string, number> = {};
    for (const payout of pending.flatMap((period) => period.payouts)) amountsByCurrency[payout.currency] = (amountsByCurrency[payout.currency] ?? 0) + payout.amount;
    for (const [currency, total] of Object.entries(amountsByCurrency)) {
        const held = await balanceOf(trx, envelope.id, currency);
        if (held + total < 0) throw new FinanceError(`Insufficient funds. Available: ${held} ${currency}.`);
        await setBalance(trx, envelope.id, currency, held + total);
    }

    for (const period of pending) {
        const description = period.description ?? `Allowance distribution for period ending ${period.end}`;
        for (const payout of period.payouts) {
            const type = payout.amount < 0 ? 'allowance-withdrawal' : 'allowance-distribution';
            await post(trx, actor, at, { id: payout.entryId, envelopeId: envelope.id, type, amount: payout.amount, currency: payout.currency, description, distributionKey: payout.distributionKey });
            await recordHistory(trx, {
                id: createAllowanceDistributionHistoryId(payout.entryId),
                occurredAt: at,
                domain: 'finance',
                actionType: type,
                summary: `${payout.amount < 0 ? 'Withdrew' : 'Deposited'} ${amountText(payout.amount, payout.currency)} for ${member.name || 'allowance'}`,
                source: 'manual',
                actorId: actor.memberId,
                affectedMemberIds: [memberId],
                allowanceTransactionId: payout.entryId,
                metadata: {
                    distributionKey: payout.distributionKey,
                    envelopeId: envelope.id,
                    periodId: period.id,
                    periodStartDate: period.start,
                    periodEndDate: period.end,
                    amount: payout.amount,
                    currency: payout.currency,
                },
            });
        }
    }

    const completions = Array.from(new Set(pending.flatMap((period) => period.completions)));
    if (completions.length > 0) await trx.updateTable('chore_completions').set({ allowance_awarded: true }).where('id', 'in', completions).execute();

    return { processedPeriodIds: pending.map((period) => period.id), skippedPeriodIds, amountsByCurrency, envelopeId: envelope.id };
}

// ---- The one way in ----

function carryOut(trx: Trx, actor: Actor, at: Date, request: FinanceRequest): Promise<FinanceResult> {
    switch (request.operation) {
        case 'create-initial':
            return createInitial(trx, actor, at, request);
        case 'create-envelope':
            return createNamed(trx, actor, at, request);
        case 'deposit':
        case 'withdraw':
            return depositOrWithdraw(trx, actor, at, request);
        case 'transfer':
        case 'transfer-person':
            return transfer(trx, actor, at, request);
        case 'archive':
            return archive(trx, actor, at, request);
        case 'allowance-payout':
            return payAllowance(trx, actor, at, request);
        case 'reconcile':
            return reconcile(trx, actor, request);
        default:
            throw new FinanceError('Unknown finance operation.');
    }
}

/** Postgres stopped one of two transactions that were waiting on each other. Nothing was written; it can be run again. */
const stoppedToLetAnotherThrough = (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && ['40P01', '40001'].includes(String((error as { code: unknown }).code));

/**
 * Carries out one request to change money, wholly or not at all, as the person a session belongs to.
 * Throws `FinanceError` for anything the request or the person is not allowed.
 */
export async function executeFinanceRequest(db: AppDatabase, principal: Principal, request: FinanceRequest, now: Date = new Date()): Promise<FinanceResult> {
    if (!request || typeof request !== 'object' || typeof request.operation !== 'string') throw new FinanceError('Not a finance request.');
    const actor = actorOf(principal);
    const installation = await db.selectFrom('installation').select('writes_frozen').executeTakeFirstOrThrow();
    if (installation.writes_frozen) throw new FinanceError('Changes are paused for a moment. Try again shortly.', 503);

    for (let attempt = 1; ; attempt += 1) {
        try {
            return await db.transaction().execute((trx) => carryOut(trx, actor, now, request));
        } catch (error) {
            if (attempt >= 3 || !stoppedToLetAnotherThrough(error)) throw error;
        }
    }
}
