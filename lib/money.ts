import type { Envelope, ExchangeRate } from '@family-organizer/data';
import { findExchangeRate } from '@family-organizer/data';
import { formatBalances, type UnitDefinition } from '@/lib/money-format';

// Sums over money, for the screens of the app on PowerSync. Each takes what a screen has already read — envelopes,
// unit definitions, the exchange rates last fetched — and works it out there and then. None of them asks anything
// of a database or a network: getting fresher rates is asked of the server, apart, by whoever notices they are old.

/** How long an exchange rate is taken at its word before the server is asked for a newer one. */
export const RATE_FRESH_FOR_MS = 2 * 60 * 60 * 1000;
/** How long to wait before asking for the same pair again. */
export const RATE_REFRESH_RETRY_MS = 10 * 60 * 1000;

const isMonetary = (code: string, units: ReadonlyMap<string, UnitDefinition>): boolean => units.get(code.toUpperCase())?.isMonetary ?? code.length === 3;
const byCode = (unitDefinitions: readonly UnitDefinition[]) => new Map(unitDefinitions.map((definition) => [definition.code.toUpperCase(), definition]));

function codesIn(envelopes: ReadonlyArray<Pick<Envelope, 'balances'>>, unitDefinitions: readonly UnitDefinition[]): Set<string> {
    const codes = new Set(unitDefinitions.map((definition) => definition.code.toUpperCase()));
    for (const envelope of envelopes) for (const code of Object.keys(envelope.balances ?? {})) codes.add(code.toUpperCase());
    return codes;
}

/** Every currency in use, defined or held, that is money and not a count of something. */
export function monetaryCurrencies(envelopes: ReadonlyArray<Pick<Envelope, 'balances'>>, unitDefinitions: readonly UnitDefinition[]): string[] {
    const units = byCode(unitDefinitions);
    return Array.from(codesIn(envelopes, unitDefinitions))
        .filter((code) => isMonetary(code, units))
        .sort();
}

/** Every currency and unit in use, defined or held, with the dollar always among them. */
export function applicableCurrencyCodes(envelopes: ReadonlyArray<Pick<Envelope, 'balances'>>, unitDefinitions: readonly UnitDefinition[]): string[] {
    return Array.from(codesIn(envelopes, unitDefinitions).add('USD')).sort();
}

/** What a set of envelopes holds in all, by currency. */
export function totalBalances(envelopes: ReadonlyArray<Pick<Envelope, 'balances'>>): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const envelope of envelopes) for (const [currency, amount] of Object.entries(envelope.balances ?? {})) totals[currency] = (totals[currency] ?? 0) + amount;
    return totals;
}

export interface CombinedBalance {
    /** Everything that could be converted, in the display currency. */
    combinedTotal: number;
    /** One line for each monetary balance, for the breakdown. */
    lines: string[];
    /** Balances left out of the total: units that are not money, and money with no usable rate. */
    separateBalances: Record<string, number>;
    /** Pairs whose rate is missing or old, as `FROM>TO`. Worth asking the server about once. */
    pairsNeedingRefresh: string[];
}

/**
 * A member's balances as one figure in a chosen currency. A balance that cannot be converted — stars, or money
 * nobody has a rate for — is never dropped: it is left out of the total and listed apart.
 */
export function combineBalances(input: { totalBalances: Readonly<Record<string, number>>; displayCurrency: string; unitDefinitions: readonly UnitDefinition[]; rates: readonly ExchangeRate[]; now?: Date }): CombinedBalance {
    const { displayCurrency, unitDefinitions, rates } = input;
    const now = (input.now ?? new Date()).getTime();
    const units = byCode(unitDefinitions);
    const definitions = [...unitDefinitions];
    const result: CombinedBalance = { combinedTotal: 0, lines: [], separateBalances: {}, pairsNeedingRefresh: [] };

    for (const [code, amount] of Object.entries(input.totalBalances)) {
        if (amount === 0) continue;
        if (!isMonetary(code, units)) {
            result.separateBalances[code] = amount;
            continue;
        }
        const same = code.toUpperCase() === displayCurrency.toUpperCase();
        const found = findExchangeRate(rates, code, displayCurrency);
        const old = !same && (!found || !found.fetchedAt || now - new Date(found.fetchedAt).getTime() > RATE_FRESH_FOR_MS);
        if (old) result.pairsNeedingRefresh.push(`${code}>${displayCurrency}`);

        const original = formatBalances({ [code]: amount }, definitions);
        if (!found) {
            result.separateBalances[code] = amount;
            result.lines.push(`${original} (rate to ${displayCurrency} unavailable)`);
            continue;
        }
        const converted = amount * found.rate;
        result.combinedTotal += converted;
        result.lines.push(`${formatBalances({ [displayCurrency]: converted }, definitions)} ${same ? `already in ${displayCurrency}` : `from ${original}`}`);
    }
    return result;
}

/** Which of the pairs needing a refresh have not been asked about lately, noting that they are being asked about now. */
export function claimRateRefresh(pairsNeedingRefresh: readonly string[], lastAttemptMs: Map<string, number>, nowMs: number = Date.now()): string[] {
    const due = pairsNeedingRefresh.filter((pair) => nowMs - (lastAttemptMs.get(pair) ?? -Infinity) >= RATE_REFRESH_RETRY_MS);
    for (const pair of due) lastAttemptMs.set(pair, nowMs);
    return due;
}

export interface GoalProgress {
    totalValueInGoalCurrency: number | null;
    /** How far towards the goal, as a percentage. May pass a hundred. */
    percentage: number | null;
    errors: string[];
}

/** How far an envelope is towards its goal, counting whatever of its money can be turned into the goal's currency. */
export function goalProgress(envelope: Pick<Envelope, 'balances' | 'goalAmount' | 'goalCurrency'>, unitDefinitions: readonly UnitDefinition[], rates: readonly ExchangeRate[]): GoalProgress {
    const result: GoalProgress = { totalValueInGoalCurrency: null, percentage: null, errors: [] };
    if (!envelope.goalAmount || envelope.goalAmount <= 0 || !envelope.goalCurrency) {
        result.errors.push('Envelope does not have a valid savings goal set.');
        return result;
    }
    const units = byCode(unitDefinitions);
    let total = 0;
    for (const [code, amount] of Object.entries(envelope.balances ?? {})) {
        if (amount === 0 || !isMonetary(code, units)) continue;
        const found = findExchangeRate(rates, code, envelope.goalCurrency);
        if (found) total += amount * found.rate;
        else result.errors.push(`Could not find exchange rate from ${code} to ${envelope.goalCurrency}.`);
    }
    result.totalValueInGoalCurrency = total;
    result.percentage = (total / envelope.goalAmount) * 100;
    return result;
}
