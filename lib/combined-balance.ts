import { formatBalances, getExchangeRate, type CachedExchangeRate, type UnitDefinition } from '@/lib/currency-utils';

/**
 * A member's balances as one figure in a chosen currency.
 *
 * A unit is not always convertible: it may be non-monetary (stars), or a
 * currency somebody typed in that has no exchange rate at all. Such a balance
 * is never dropped and never waited for — it is left out of the total and
 * listed apart, so the figure on screen is always complete and always arrives.
 */
export interface CombinedBalance {
    /** Everything that could be converted, in the display currency. */
    combinedTotal: number;
    /** One line per monetary balance, for the breakdown. */
    lines: string[];
    /** Balances left out of the total: non-monetary units, and money with no usable rate. */
    separateBalances: Record<string, number>;
    /** Pairs whose rate is missing or stale, as `FROM>TO`. Worth one background refresh. */
    pairsNeedingRefresh: string[];
}

export interface CalculateCombinedBalanceInput {
    db: any;
    totalBalances: Readonly<Record<string, number>>;
    displayCurrency: string;
    unitDefinitions: UnitDefinition[];
    cachedRates: CachedExchangeRate[];
    /** Lets a newer calculation cancel this one; a cancelled calculation returns null. */
    signal?: AbortSignal;
}

export async function calculateCombinedBalance(input: CalculateCombinedBalanceInput): Promise<CombinedBalance | null> {
    const { db, totalBalances, displayCurrency, unitDefinitions, cachedRates, signal } = input;
    const unitsByCode = new Map(unitDefinitions.map((definition) => [definition.code.toUpperCase(), definition]));
    const result: CombinedBalance = { combinedTotal: 0, lines: [], separateBalances: {}, pairsNeedingRefresh: [] };

    for (const [code, amount] of Object.entries(totalBalances)) {
        if (signal?.aborted) return null;
        if (amount === 0) continue;

        // An undefined unit is taken for money when it looks like a currency code.
        const isMonetary = unitsByCode.get(code.toUpperCase())?.isMonetary ?? code.length === 3;
        if (!isMonetary) {
            result.separateBalances[code] = amount;
            continue;
        }

        const rate = await getExchangeRate(db, code, displayCurrency, cachedRates);
        if (signal?.aborted) return null;
        if (rate.needsApiFetch) result.pairsNeedingRefresh.push(`${code}>${displayCurrency}`);

        const original = formatBalances({ [code]: amount }, unitDefinitions);
        if (rate.rate === null) {
            result.separateBalances[code] = amount;
            result.lines.push(`${original} (rate to ${displayCurrency} unavailable)`);
            continue;
        }

        const converted = amount * rate.rate;
        result.combinedTotal += converted;
        result.lines.push(
            `${formatBalances({ [displayCurrency]: converted }, unitDefinitions)} ${
                rate.source === 'identity' ? `already in ${displayCurrency}` : `from ${original}`
            }`
        );
    }

    return result;
}

/** How long to wait before asking the rate service about the same pair again. */
export const RATE_REFRESH_RETRY_MS = 10 * 60 * 1000;

/**
 * Which of the pairs needing a refresh have not been asked for recently, and
 * note that they are being asked for now. A unit the rate service has never
 * heard of would otherwise be requested again on every recalculation.
 */
export function claimRateRefresh(
    pairsNeedingRefresh: readonly string[],
    lastAttemptMs: Map<string, number>,
    nowMs: number = Date.now()
): string[] {
    const due = pairsNeedingRefresh.filter((pair) => nowMs - (lastAttemptMs.get(pair) ?? -Infinity) >= RATE_REFRESH_RETRY_MS);
    for (const pair of due) lastAttemptMs.set(pair, nowMs);
    return due;
}
