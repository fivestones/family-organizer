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
    additionalAmountsByCurrency?: Record<string, number>;
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
    const seenPeriodKeys = new Set<string>();
    const preparedPeriods = periods.map((period) => {
        if (!period.id) throw new Error('Allowance payout period ID is required.');
        if (!Number.isFinite(period.amount)) throw new Error('Allowance payout amount must be a finite number.');

        const periodStartKey = toDateKey(period.periodStartDate);
        const periodEndKey = toDateKey(period.periodEndDate);
        const periodKey = `${memberId}:${periodStartKey}:${periodEndKey}`;
        if (seenPeriodKeys.has(periodKey)) {
            throw new Error(`Allowance payout contains the same period more than once: ${periodStartKey} to ${periodEndKey}.`);
        }
        seenPeriodKeys.add(periodKey);

        const amountsByCurrency: Record<string, number> = { [currency]: period.amount };
        for (const [additionalCurrency, rawAmount] of Object.entries(period.additionalAmountsByCurrency || {})) {
            const normalizedAdditionalCurrency = normalizeCurrency(additionalCurrency);
            const amount = Number(rawAmount);
            if (!Number.isFinite(amount)) {
                throw new Error(`Allowance payout amount for ${normalizedAdditionalCurrency} must be a finite number.`);
            }
            amountsByCurrency[normalizedAdditionalCurrency] = (amountsByCurrency[normalizedAdditionalCurrency] || 0) + amount;
        }

        let payouts = Object.entries(amountsByCurrency)
            .filter(([, amount]) => amount !== 0)
            .map(([payoutCurrency, amount]) => ({
                amount,
                currency: payoutCurrency,
                distributionKey: createAllowanceDistributionKey(memberId, periodStartKey, periodEndKey, payoutCurrency),
                transactionId: createAllowanceDistributionTransactionId(memberId, periodStartKey, periodEndKey, payoutCurrency),
            }));
        if (payouts.length === 0) {
            payouts = [
                {
                    amount: 0,
                    currency,
                    distributionKey: createAllowanceDistributionKey(memberId, periodStartKey, periodEndKey, currency),
                    transactionId: createAllowanceDistributionTransactionId(memberId, periodStartKey, periodEndKey, currency),
                },
            ];
        }

        return {
            ...period,
            periodStartKey,
            periodEndKey,
            payouts,
            completionsToMark: Array.from(new Set(period.completionsToMark.filter(Boolean))),
        };
    });
    const expectedTransactionIds = preparedPeriods.flatMap((period) => period.payouts.map((payout) => payout.transactionId));

    let envelopes = memberEnvelopes;
    let existingTransactionIds = new Set<string>();
    if (typeof db.queryOnce === 'function') {
        const response = await db.queryOnce({
            familyMembers: {
                $: { where: { id: memberId } },
                allowanceEnvelopes: {},
            },
            allowanceTransactions: {
                $: { where: { id: { $in: expectedTransactionIds } } },
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

    const pendingPeriods = preparedPeriods
        .map((period) => ({
            ...period,
            payouts: period.payouts.filter((payout) => !existingTransactionIds.has(payout.transactionId)),
        }))
        .filter((period) => period.payouts.length > 0);
    const skippedPeriodIds = preparedPeriods
        .filter((period) => period.payouts.every((payout) => existingTransactionIds.has(payout.transactionId)))
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
    const amountsByCurrency: Record<string, number> = {};
    for (const payout of pendingPeriods.flatMap((period) => period.payouts)) {
        amountsByCurrency[payout.currency] = (amountsByCurrency[payout.currency] || 0) + payout.amount;
    }
    for (const [payoutCurrency, totalAmount] of Object.entries(amountsByCurrency)) {
        const nextBalance = (balances[payoutCurrency] || 0) + totalAmount;
        if (nextBalance < 0) {
            throw new Error(`Insufficient funds. Available: ${balances[payoutCurrency] || 0} ${payoutCurrency}.`);
        }
        if (Math.abs(nextBalance) < Number.EPSILON) {
            delete balances[payoutCurrency];
        } else {
            balances[payoutCurrency] = nextBalance;
        }
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
        const description = period.description || `Allowance distribution for period ending ${period.periodEndKey}`;
        for (const payout of period.payouts) {
            const transactionType = payout.amount < 0 ? 'allowance-withdrawal' : 'allowance-distribution';
            transactions.push(
                tx.allowanceTransactions[payout.transactionId].update({
                    ...auditFields,
                    amount: payout.amount,
                    currency: payout.currency,
                    description,
                    distributionKey: payout.distributionKey,
                    transactionType,
                    createdAt: now,
                    updatedAt: now,
                }),
                tx.allowanceEnvelopes[envelopeId].link({ transactions: payout.transactionId })
            );

            const history = buildHistoryEventTransactions({
                tx,
                createId: () => createAllowanceDistributionHistoryId(payout.transactionId),
                occurredAt: now,
                domain: 'finance',
                actionType: transactionType,
                summary: `${payout.amount < 0 ? 'Withdrew' : 'Deposited'} ${formatAmount(payout.amount, payout.currency)} ${
                    memberName ? `for ${memberName}` : 'for allowance'
                }`,
                source: 'manual',
                actorFamilyMemberId: auditFields.createdByFamilyMemberId,
                affectedFamilyMemberIds: [memberId],
                allowanceTransactionId: payout.transactionId,
                metadata: {
                    distributionKey: payout.distributionKey,
                    envelopeId,
                    periodId: period.id,
                    periodStartDate: period.periodStartKey,
                    periodEndDate: period.periodEndKey,
                    amount: payout.amount,
                    currency: payout.currency,
                },
            });
            transactions.push(...history.transactions);
        }
        period.completionsToMark.forEach((completionId) => completionIds.add(completionId));
    }

    for (const completionId of Array.from(completionIds)) {
        transactions.push(tx.choreCompletions[completionId].update({ allowanceAwarded: true }));
    }

    await db.transact(transactions);

    return {
        processedPeriodIds: pendingPeriods.map((period) => period.id),
        skippedPeriodIds,
        amountsByCurrency,
        envelopeId,
    };
}
