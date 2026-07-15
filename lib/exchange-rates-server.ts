import 'server-only';

import { v5 as uuidv5 } from 'uuid';

import { getInstantAdminDb } from '@/lib/instant-admin';

const BASE_CURRENCY = 'USD';
const EXCHANGE_RATE_CACHE_DURATION_MS = 2 * 60 * 60 * 1000;
const EXCHANGE_RATE_NAMESPACE = 'ec9d05f0-f8d2-405c-bae9-6b44bb4291b2';

export class ExchangeRateConfigurationError extends Error {}

interface ExchangeRateRow {
    id: string;
    baseCurrency?: string;
    targetCurrency?: string;
    rate?: number;
    lastFetchedTimestamp?: Date | string;
    pairKey?: string;
}

function normalizeCurrency(value: string) {
    return String(value || '').trim().toUpperCase();
}

function pairKey(baseCurrency: string, targetCurrency: string) {
    return `${normalizeCurrency(baseCurrency)}:${normalizeCurrency(targetCurrency)}`;
}

function deterministicRateId(key: string) {
    return uuidv5(key, EXCHANGE_RATE_NAMESPACE);
}

function readProviderAppId() {
    const appId = process.env.OPEN_EXCHANGE_RATES_APP_ID;
    if (!appId) {
        throw new ExchangeRateConfigurationError('Exchange-rate provider is not configured.');
    }
    return appId;
}

function rowsToRates(rows: ExchangeRateRow[]) {
    const rates: Record<string, number> = {};
    for (const row of rows) {
        if (normalizeCurrency(row.baseCurrency || '') !== BASE_CURRENCY) continue;
        const targetCurrency = normalizeCurrency(row.targetCurrency || '');
        const rate = Number(row.rate);
        if (!targetCurrency || !Number.isFinite(rate) || rate <= 0) continue;
        rates[targetCurrency] = rate;
    }
    return rates;
}

function newestTimestamp(rows: ExchangeRateRow[]) {
    return rows.reduce((newest, row) => {
        const timestamp = new Date(row.lastFetchedTimestamp || 0).getTime();
        return Number.isFinite(timestamp) ? Math.max(newest, timestamp) : newest;
    }, 0);
}

type RefreshOptions = {
    db?: ReturnType<typeof getInstantAdminDb>;
    fetchImpl?: typeof fetch;
    now?: Date;
};

let refreshInFlight: Promise<Awaited<ReturnType<typeof performServerExchangeRateRefresh>>> | null = null;

async function performServerExchangeRateRefresh(options?: RefreshOptions) {
    const db = options?.db || getInstantAdminDb();
    const fetchImpl = options?.fetchImpl || fetch;
    const now = options?.now || new Date();
    const data = await db.query({
        exchangeRates: {
            $: { where: { baseCurrency: BASE_CURRENCY } },
        },
    });
    const existingRows = (data.exchangeRates || []) as ExchangeRateRow[];
    const cachedRates = rowsToRates(existingRows);
    const cachedAt = newestTimestamp(existingRows);

    if (Object.keys(cachedRates).length > 0 && now.getTime() - cachedAt < EXCHANGE_RATE_CACHE_DURATION_MS) {
        return {
            base: BASE_CURRENCY,
            rates: cachedRates,
            timestamp: Math.floor(cachedAt / 1000),
            source: 'cache' as const,
        };
    }

    const providerUrl = new URL('https://openexchangerates.org/api/latest.json');
    providerUrl.searchParams.set('app_id', readProviderAppId());
    providerUrl.searchParams.set('base', BASE_CURRENCY);
    const response = await fetchImpl(providerUrl, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Exchange-rate provider failed (${response.status}).`);
    }
    const payload = await response.json();
    if (!payload?.rates || typeof payload.rates !== 'object') {
        throw new Error('Exchange-rate provider returned invalid data.');
    }

    const fetchedAt = Number.isFinite(Number(payload.timestamp))
        ? new Date(Number(payload.timestamp) * 1000)
        : now;
    const rates = Object.fromEntries(
        Object.entries(payload.rates)
            .map(([currency, rawRate]) => [normalizeCurrency(currency), Number(rawRate)] as const)
            .filter(([currency, rate]) => Boolean(currency) && Number.isFinite(rate) && rate > 0)
    );
    if (Object.keys(rates).length === 0) {
        throw new Error('Exchange-rate provider returned no usable rates.');
    }

    const existingByPair = new Map(existingRows.map((row) => [pairKey(row.baseCurrency || '', row.targetCurrency || ''), row]));
    const transactions = Object.entries(rates).map(([targetCurrency, rate]) => {
        const key = pairKey(BASE_CURRENCY, targetCurrency);
        const existing = existingByPair.get(key);
        const rowId = existing?.id || deterministicRateId(key);
        return db.tx.exchangeRates[rowId].update({
            baseCurrency: BASE_CURRENCY,
            targetCurrency,
            pairKey: key,
            rate,
            lastFetchedTimestamp: fetchedAt.toISOString(),
        });
    });
    await db.transact(transactions);

    return {
        base: BASE_CURRENCY,
        rates,
        timestamp: Math.floor(fetchedAt.getTime() / 1000),
        source: 'provider' as const,
    };
}

export function refreshServerExchangeRates(options?: RefreshOptions) {
    if (!refreshInFlight) {
        refreshInFlight = performServerExchangeRateRefresh(options).finally(() => {
            refreshInFlight = null;
        });
    }
    return refreshInFlight;
}
