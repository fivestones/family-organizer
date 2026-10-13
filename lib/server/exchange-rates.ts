import 'server-only';

import type { AppDatabase } from './db';

// The last exchange rates fetched, kept so a total can be shown in one currency. Any device may ask for them to
// be refreshed; the provider is asked at most once every two hours, and once at a time.

const BASE_CURRENCY = 'USD';
const FRESH_FOR_MS = 2 * 60 * 60 * 1000;

/** The deployment has no key for the rate provider. */
export class ExchangeRatesNotConfiguredError extends Error {}

export interface ExchangeRates {
    base: typeof BASE_CURRENCY;
    rates: Record<string, number>;
    /** When the rates were fetched, in seconds since 1970. */
    timestamp: number;
    source: 'cache' | 'provider';
}

interface RefreshOptions {
    fetchImpl?: typeof fetch;
    now?: Date;
}

async function refresh(db: AppDatabase, options: RefreshOptions): Promise<ExchangeRates> {
    const now = options.now ?? new Date();
    const kept = await db.selectFrom('exchange_rates').select(['target_currency', 'rate', 'fetched_at']).where('base_currency', '=', BASE_CURRENCY).execute();
    const keptAt = kept.reduce((newest, row) => Math.max(newest, new Date(row.fetched_at).getTime()), 0);
    if (kept.length > 0 && now.getTime() - keptAt < FRESH_FOR_MS) {
        return { base: BASE_CURRENCY, rates: Object.fromEntries(kept.map((row) => [row.target_currency, row.rate])), timestamp: Math.floor(keptAt / 1000), source: 'cache' };
    }

    const appId = process.env.OPEN_EXCHANGE_RATES_APP_ID;
    if (!appId) throw new ExchangeRatesNotConfiguredError('Exchange-rate provider is not configured.');
    const url = new URL('https://openexchangerates.org/api/latest.json');
    url.searchParams.set('app_id', appId);
    url.searchParams.set('base', BASE_CURRENCY);
    const response = await (options.fetchImpl ?? fetch)(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Exchange-rate provider failed (${response.status}).`);
    const payload = await response.json();
    if (!payload?.rates || typeof payload.rates !== 'object') throw new Error('Exchange-rate provider returned invalid data.');

    const fetchedAt = Number.isFinite(Number(payload.timestamp)) ? new Date(Number(payload.timestamp) * 1000) : now;
    const rates: Record<string, number> = {};
    for (const [code, raw] of Object.entries(payload.rates)) {
        const currency = code.trim().toUpperCase();
        const rate = Number(raw);
        if (currency && Number.isFinite(rate) && rate > 0) rates[currency] = rate;
    }
    if (Object.keys(rates).length === 0) throw new Error('Exchange-rate provider returned no usable rates.');

    await db
        .insertInto('exchange_rates')
        .values(Object.entries(rates).map(([currency, rate]) => ({ base_currency: BASE_CURRENCY, target_currency: currency, rate, fetched_at: fetchedAt })))
        .onConflict((conflict) => conflict.columns(['base_currency', 'target_currency']).doUpdateSet((row) => ({ rate: row.ref('excluded.rate'), fetched_at: row.ref('excluded.fetched_at') })))
        .execute();
    return { base: BASE_CURRENCY, rates, timestamp: Math.floor(fetchedAt.getTime() / 1000), source: 'provider' };
}

let inFlight: Promise<ExchangeRates> | null = null;

/** The current rates: those kept if they are fresh, and otherwise fetched and kept. Several askers share one fetch. */
export function refreshExchangeRates(db: AppDatabase, options: RefreshOptions = {}): Promise<ExchangeRates> {
    inFlight ??= refresh(db, options).finally(() => {
        inFlight = null;
    });
    return inFlight;
}
