import 'server-only';

import type { FinanceMutationRequest } from '@/lib/finance-mutation-client';
import { withFinanceMutationLocks } from '@/lib/finance-mutation-lock';
import { getInstantAdminDb } from '@/lib/instant-admin';
import { filterActiveAllowanceEnvelopes } from '@/lib/allowance-envelopes';
import {
    createAdditionalEnvelope,
    createInitialSavingsEnvelope,
    deleteEnvelope,
    depositToSpecificEnvelope,
    transferFunds,
    transferFundsToPerson,
    withdrawFromEnvelope,
    setDefaultEnvelope,
    type Envelope,
} from '@/lib/currency-utils';

type FinanceActor = {
    instantUser: { id?: string | null };
    familyMember: { id: string; role?: string | null };
};

export class FinanceMutationError extends Error {
    constructor(
        message: string,
        public readonly status = 400
    ) {
        super(message);
        this.name = 'FinanceMutationError';
    }
}

function requireString(value: unknown, label: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) throw new FinanceMutationError(`${label} is required.`);
    return normalized;
}

function requireFiniteNumber(value: unknown, label: string): number {
    const amount = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(amount)) throw new FinanceMutationError(`${label} must be a finite number.`);
    return amount;
}

function linkedMemberId(envelope: Envelope): string | null {
    const member = Array.isArray(envelope.familyMember) ? envelope.familyMember[0] : envelope.familyMember;
    return member?.id || null;
}

function assertCanActForMember(actor: FinanceActor, familyMemberId: string) {
    if (actor.familyMember.role !== 'parent' && actor.familyMember.id !== familyMemberId) {
        throw new FinanceMutationError('You can only change your own envelopes.', 403);
    }
}

async function loadActiveEnvelopes(adminDb: any, envelopeIds: readonly string[]): Promise<Envelope[]> {
    const uniqueIds = Array.from(new Set(envelopeIds.map((id) => requireString(id, 'Envelope ID'))));
    const data = await adminDb.query({
        allowanceEnvelopes: {
            $: { where: { id: { $in: uniqueIds } } },
            familyMember: {},
        },
    });
    const envelopes = filterActiveAllowanceEnvelopes((data?.allowanceEnvelopes || []) as Envelope[]);
    const envelopesById = new Map(envelopes.map((envelope) => [envelope.id, envelope]));
    for (const envelopeId of uniqueIds) {
        if (!envelopesById.has(envelopeId)) throw new FinanceMutationError('Active envelope not found.', 404);
    }
    return uniqueIds.map((envelopeId) => envelopesById.get(envelopeId)!);
}

function makeCurrencyDb(adminDb: any, actor: FinanceActor) {
    return {
        __allowanceAuditFields: {
            createdBy: requireString(actor.instantUser.id, 'Instant user ID'),
            createdByFamilyMemberId: actor.familyMember.id,
        },
        queryOnce: (query: any) => adminDb.query(query),
        transact: (transactions: any[]) => adminDb.transact(transactions),
    };
}

export async function executeServerFinanceMutation(request: FinanceMutationRequest, actor: FinanceActor): Promise<string | null> {
    const adminDb = getInstantAdminDb() as any;
    const currencyDb = makeCurrencyDb(adminDb, actor);

    if (request.operation === 'create-initial' || request.operation === 'create-envelope') {
        const familyMemberId = requireString(request.familyMemberId, 'Family member ID');
        assertCanActForMember(actor, familyMemberId);
        return withFinanceMutationLocks([`member:${familyMemberId}`], async () => {
            if (request.operation === 'create-initial') {
                return createInitialSavingsEnvelope(currencyDb, familyMemberId);
            }
            const existingData = await adminDb.query({
                familyMembers: {
                    $: { where: { id: familyMemberId } },
                    allowanceEnvelopes: { familyMember: {} },
                },
            });
            const existingEnvelopes = filterActiveAllowanceEnvelopes(
                (existingData?.familyMembers?.[0]?.allowanceEnvelopes || []) as Envelope[]
            );
            const envelopeId = await createAdditionalEnvelope(
                currencyDb,
                familyMemberId,
                requireString(request.name, 'Envelope name'),
                Boolean(request.isDefault),
                request.goalAmount == null ? null : requireFiniteNumber(request.goalAmount, 'Goal amount'),
                request.goalCurrency || null,
                request.description || null
            );
            if (request.isDefault) {
                await setDefaultEnvelope(
                    currencyDb,
                    [...existingEnvelopes, { id: envelopeId, name: request.name.trim(), balances: {}, isDefault: true }],
                    envelopeId
                );
            }
            return envelopeId;
        });
    }

    if (request.operation === 'archive' && actor.familyMember.role !== 'parent') {
        throw new FinanceMutationError('Parent access required.', 403);
    }

    const involvedEnvelopeIds =
        request.operation === 'deposit' || request.operation === 'withdraw'
            ? [request.envelopeId]
            : request.operation === 'archive'
              ? [request.envelopeId, request.transferToEnvelopeId, ...(request.newDefaultEnvelopeId ? [request.newDefaultEnvelopeId] : [])]
              : [request.sourceEnvelopeId, request.destinationEnvelopeId];

    return withFinanceMutationLocks(involvedEnvelopeIds, async () => {
        const envelopes = await loadActiveEnvelopes(adminDb, involvedEnvelopeIds);
        const byId = new Map(envelopes.map((envelope) => [envelope.id, envelope]));

        if (request.operation === 'deposit' || request.operation === 'withdraw') {
            const envelope = byId.get(request.envelopeId)!;
            const ownerId = linkedMemberId(envelope);
            if (!ownerId) throw new FinanceMutationError('Envelope owner not found.', 409);
            assertCanActForMember(actor, ownerId);
            const amount = requireFiniteNumber(request.amount, 'Amount');
            const currency = requireString(request.currency, 'Currency');
            if (request.operation === 'deposit') {
                await depositToSpecificEnvelope(currencyDb, envelope.id, envelope.balances || {}, amount, currency, request.description || 'Deposit');
            } else {
                await withdrawFromEnvelope(currencyDb, envelope, amount, currency, request.description || 'Withdrawal');
            }
            return null;
        }

        if (request.operation === 'archive') {
            const source = byId.get(request.envelopeId)!;
            const target = byId.get(request.transferToEnvelopeId)!;
            const ownerId = linkedMemberId(source);
            if (!ownerId || linkedMemberId(target) !== ownerId) {
                throw new FinanceMutationError('Archived funds must move to an envelope owned by the same member.', 409);
            }
            if (request.newDefaultEnvelopeId && linkedMemberId(byId.get(request.newDefaultEnvelopeId)!) !== ownerId) {
                throw new FinanceMutationError('The new default envelope must belong to the same member.', 409);
            }
            const memberData = await adminDb.query({
                familyMembers: {
                    $: { where: { id: ownerId } },
                    allowanceEnvelopes: { familyMember: {} },
                },
            });
            const memberEnvelopes = filterActiveAllowanceEnvelopes((memberData?.familyMembers?.[0]?.allowanceEnvelopes || []) as Envelope[]);
            await deleteEnvelope(currencyDb, memberEnvelopes, source.id, target.id, request.newDefaultEnvelopeId || null);
            return null;
        }

        const source = byId.get(request.sourceEnvelopeId)!;
        const destination = byId.get(request.destinationEnvelopeId)!;
        const sourceOwnerId = linkedMemberId(source);
        const destinationOwnerId = linkedMemberId(destination);
        if (!sourceOwnerId || !destinationOwnerId) throw new FinanceMutationError('Envelope owner not found.', 409);
        assertCanActForMember(actor, sourceOwnerId);
        const amount = requireFiniteNumber(request.amount, 'Amount');
        const currency = requireString(request.currency, 'Currency');

        if (request.operation === 'transfer') {
            if (sourceOwnerId !== destinationOwnerId) {
                throw new FinanceMutationError('Envelope transfers must stay within one family member.', 409);
            }
            await transferFunds(currencyDb, source, destination, amount, currency);
        } else {
            await transferFundsToPerson(currencyDb, source, destination, amount, currency, request.description);
        }
        return null;
    });
}
