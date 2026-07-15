import { tx } from '@instantdb/react';
import { v5 as uuidv5 } from 'uuid';

import type { Envelope } from '@/lib/currency-utils';
import { getAllowanceTransactionAuditFields } from '@/lib/currency-utils';
import { buildHistoryEventTransactions } from '@/lib/history-events';

const DISTRIBUTION_TRANSACTION_NAMESPACE = '4b2ecb70-5267-45af-867f-c3297ad0de68';
const DISTRIBUTION_HISTORY_NAMESPACE = '532f561b-00b2-41c6-a89c-6cc0dc856370';
const DEFAULT_ENVELOPE_NAMESPACE = '382a139c-d654-49e5-8d6e-281b0aa070af';

export interface AllowancePayoutPeriodInput {
    id: string;
    periodStartDate: Date | string;
    periodEndDate: Date | string;
    amount: number;
    completionsToMark: string[];
    description?: string;
}

export interface ExecuteAtomicAllowancePayoutInput {
    db: any;
    memberId: string;
    memberName?: string | null;
    primaryCurrency: string;
    periods: AllowancePayoutPeriodInput[];
    memberEnvelopes?: Envelope[];
}

export interface AtomicAllowancePayoutResult {
    processedPeriodIds: string[];
    skippedPeriodIds: string[];
    amountsByCurrency: Record<string, number>;
    envelopeId: string | null;
}

function toDateKey(value: Date | string) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error('Allowance payout period contains an invalid date.');
    }

    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const day = String(parsed.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeCurrency(currency: string) {
    const normalized = String(currency || '').trim().toUpperCase();
    if (!normalized) {
        throw new Error('Allowance payout currency is required.');
    }
    return normalized;
}

function normalizeBalances(balances: Envelope['balances'] | null | undefined) {
    const normalized: Record<string, number> = {};
    for (const [currency, rawAmount] of Object.entries(balances || {})) {
        const amount = Number(rawAmount);
        if (!Number.isFinite(amount)) continue;
        const normalizedCurrency = normalizeCurrency(currency);
        normalized[normalizedCurrency] = (normalized[normalizedCurrency] || 0) + amount;
    }
    return normalized;
}

export function createAllowanceDistributionKey(
    memberId: string,
    periodStartDate: Date | string,
    periodEndDate: Date | string,
    currency: string
) {
    return `allowance:${memberId}:${toDateKey(periodStartDate)}:${toDateKey(periodEndDate)}:${normalizeCurrency(currency)}`;
}

export function createAllowanceDistributionTransactionId(
    memberId: string,
    periodStartDate: Date | string,
    periodEndDate: Date | string,
    currency: string
) {
    return uuidv5(
        createAllowanceDistributionKey(memberId, periodStartDate, periodEndDate, currency),
        DISTRIBUTION_TRANSACTION_NAMESPACE
    );
}

function createAllowanceDistributionHistoryId(transactionId: string) {
    return uuidv5(transactionId, DISTRIBUTION_HISTORY_NAMESPACE);
}

function createDefaultEnvelopeId(memberId: string) {
    return uuidv5(memberId, DEFAULT_ENVELOPE_NAMESPACE);
}

function chooseEnvelope(envelopes: Envelope[]) {
    return (
        envelopes.find((envelope) => envelope.isDefault) ||
        envelopes.find((envelope) => envelope.name === 'Savings') ||
        envelopes[0] ||
        null
    );
}

function formatAmount(amount: number, currency: string) {
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Math.abs(amount));
    } catch (_error) {
        return `${Math.abs(amount).toLocaleString()} ${currency}`;
    }
}

export async function executeAtomicAllowancePayout({
    db,
    memberId,
    memberName,
    primaryCurrency,
    periods,
    memberEnvelopes = [],
}: ExecuteAtomicAllowancePayoutInput): Promise<AtomicAllowancePayoutResult> {
    if (!memberId) throw new Error('Allowance payout member is required.');
    if (periods.length === 0) throw new Error('At least one allowance period is required.');

    const currency = normalizeCurrency(primaryCurrency);
    const seenDistributionKeys = new Set<string>();
    const preparedPeriods = periods.map((period) => {
        if (!period.id) throw new Error('Allowance payout period ID is required.');
        if (!Number.isFinite(period.amount)) throw new Error('Allowance payout amount must be a finite number.');

        const periodStartKey = toDateKey(period.periodStartDate);
        const periodEndKey = toDateKey(period.periodEndDate);
        const distributionKey = createAllowanceDistributionKey(memberId, periodStartKey, periodEndKey, currency);
        const transactionId = createAllowanceDistributionTransactionId(memberId, periodStartKey, periodEndKey, currency);
        if (seenDistributionKeys.has(distributionKey)) {
            throw new Error(`Allowance payout contains the same period more than once: ${periodStartKey} to ${periodEndKey}.`);
        }
        seenDistributionKeys.add(distributionKey);

        return {
            ...period,
            periodStartKey,
            periodEndKey,
            distributionKey,
            transactionId,
            completionsToMark: Array.from(new Set(period.completionsToMark.filter(Boolean))),
        };
    });

    let envelopes = memberEnvelopes;
    let existingTransactionIds = new Set<string>();
    if (typeof db.queryOnce === 'function') {
        const response = await db.queryOnce({
            familyMembers: {
                $: { where: { id: memberId } },
                allowanceEnvelopes: {},
            },
            allowanceTransactions: {
                $: { where: { id: { $in: preparedPeriods.map((period) => period.transactionId) } } },
            },
        });
        const familyMember = response.data?.familyMembers?.[0];
        if (!familyMember) {
            throw new Error('Allowance payout member could not be found.');
        }
        envelopes = familyMember?.allowanceEnvelopes || [];
        existingTransactionIds = new Set(
            (response.data?.allowanceTransactions || []).map((transaction: { id: string }) => transaction.id)
        );
    }

    const pendingPeriods = preparedPeriods.filter((period) => !existingTransactionIds.has(period.transactionId));
    const skippedPeriodIds = preparedPeriods
        .filter((period) => existingTransactionIds.has(period.transactionId))
        .map((period) => period.id);

    if (pendingPeriods.length === 0) {
        return {
            processedPeriodIds: [],
            skippedPeriodIds,
            amountsByCurrency: {},
            envelopeId: chooseEnvelope(envelopes)?.id || null,
        };
    }

    const auditFields = await getAllowanceTransactionAuditFields();
    const now = new Date().toISOString();
    let envelope = chooseEnvelope(envelopes);
    const envelopeId = envelope?.id || createDefaultEnvelopeId(memberId);
    const balances = normalizeBalances(envelope?.balances);
    const totalAmount = pendingPeriods.reduce((sum, period) => sum + period.amount, 0);
    const nextBalance = (balances[currency] || 0) + totalAmount;

    if (nextBalance < 0) {
        throw new Error(`Insufficient funds. Available: ${balances[currency] || 0} ${currency}.`);
    }
    if (Math.abs(nextBalance) < Number.EPSILON) {
        delete balances[currency];
    } else {
        balances[currency] = nextBalance;
    }

    const transactions: any[] = [];
    if (!envelope) {
        transactions.push(
            tx.allowanceEnvelopes[envelopeId].update({
                name: 'Savings',
                balances,
                isDefault: true,
                goalAmount: null,
                goalCurrency: null,
            }),
            tx.familyMembers[memberId].link({ allowanceEnvelopes: envelopeId })
        );
        envelope = { id: envelopeId, name: 'Savings', balances, isDefault: true };
    } else {
        transactions.push(
            tx.allowanceEnvelopes[envelopeId].update({
                balances,
                ...(!envelope.isDefault ? { isDefault: true } : {}),
            })
        );
    }

    const completionIds = new Set<string>();
    for (const period of pendingPeriods) {
        const transactionType = period.amount < 0 ? 'allowance-withdrawal' : 'allowance-distribution';
        const description = period.description || `Allowance distribution for period ending ${period.periodEndKey}`;
        transactions.push(
            tx.allowanceTransactions[period.transactionId].update({
                ...auditFields,
                amount: period.amount,
                currency,
                description,
                distributionKey: period.distributionKey,
                transactionType,
                createdAt: now,
                updatedAt: now,
            }),
            tx.allowanceEnvelopes[envelopeId].link({ transactions: period.transactionId })
        );

        const history = buildHistoryEventTransactions({
            tx,
            createId: () => createAllowanceDistributionHistoryId(period.transactionId),
            occurredAt: now,
            domain: 'finance',
            actionType: transactionType,
            summary: `${period.amount < 0 ? 'Withdrew' : 'Deposited'} ${formatAmount(period.amount, currency)} ${
                memberName ? `for ${memberName}` : 'for allowance'
            }`,
            source: 'manual',
            actorFamilyMemberId: auditFields.createdByFamilyMemberId,
            affectedFamilyMemberIds: [memberId],
            allowanceTransactionId: period.transactionId,
            metadata: {
                distributionKey: period.distributionKey,
                envelopeId,
                periodId: period.id,
                periodStartDate: period.periodStartKey,
                periodEndDate: period.periodEndKey,
                amount: period.amount,
                currency,
            },
        });
        transactions.push(...history.transactions);
        period.completionsToMark.forEach((completionId) => completionIds.add(completionId));
    }

    for (const completionId of Array.from(completionIds)) {
        transactions.push(tx.choreCompletions[completionId].update({ allowanceAwarded: true }));
    }

    await db.transact(transactions);

    return {
        processedPeriodIds: pendingPeriods.map((period) => period.id),
        skippedPeriodIds,
        amountsByCurrency: { [currency]: totalAmount },
        envelopeId,
    };
}
