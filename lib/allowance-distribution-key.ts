import { v5 as uuidv5 } from 'uuid';

// What makes an allowance payout the same payout however often it is asked for: the member, the period and the
// currency give its key, and the key gives the ids of its ledger row and its history entry.

const DISTRIBUTION_TRANSACTION_NAMESPACE = '4b2ecb70-5267-45af-867f-c3297ad0de68';
const DISTRIBUTION_HISTORY_NAMESPACE = '532f561b-00b2-41c6-a89c-6cc0dc856370';

/** The UTC day of a date, `YYYY-MM-DD`. */
export function toDateKey(value: Date | string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error('Allowance payout period contains an invalid date.');
    }

    const year = parsed.getUTCFullYear();
    const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const day = String(parsed.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function normalizeCurrency(currency: string): string {
    const normalized = String(currency || '').trim().toUpperCase();
    if (!normalized) {
        throw new Error('Allowance payout currency is required.');
    }
    return normalized;
}

export function createAllowanceDistributionKey(memberId: string, periodStartDate: Date | string, periodEndDate: Date | string, currency: string): string {
    return `allowance:${memberId}:${toDateKey(periodStartDate)}:${toDateKey(periodEndDate)}:${normalizeCurrency(currency)}`;
}

export function createAllowanceDistributionTransactionId(memberId: string, periodStartDate: Date | string, periodEndDate: Date | string, currency: string): string {
    return uuidv5(createAllowanceDistributionKey(memberId, periodStartDate, periodEndDate, currency), DISTRIBUTION_TRANSACTION_NAMESPACE);
}

export function createAllowanceDistributionHistoryId(transactionId: string): string {
    return uuidv5(transactionId, DISTRIBUTION_HISTORY_NAMESPACE);
}
