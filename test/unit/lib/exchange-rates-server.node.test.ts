import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExchangeRateConfigurationError, refreshServerExchangeRates } from '@/lib/exchange-rates-server';

function createTxRoot() {
    return new Proxy(
        {},
        {
            get(_target, entity: string) {
                return new Proxy(
                    {},
                    {
                        get(_entityTarget, id: string) {
                            return {
                                update(payload: unknown) {
                                    return { op: 'update', entity, id, payload };
                                },
                            };
                        },
                    }
                );
            },
        }
    );
}

describe('server exchange-rate refresh', () => {
    const originalAppId = process.env.OPEN_EXCHANGE_RATES_APP_ID;

    afterEach(() => {
        if (originalAppId === undefined) delete process.env.OPEN_EXCHANGE_RATES_APP_ID;
        else process.env.OPEN_EXCHANGE_RATES_APP_ID = originalAppId;
    });

    it('returns a fresh Instant cache without contacting the provider', async () => {
        const fetchImpl = vi.fn();
        const db = {
            query: vi.fn().mockResolvedValue({
                exchangeRates: [
                    {
                        id: 'usd-eur',
                        baseCurrency: 'USD',
                        targetCurrency: 'EUR',
                        rate: 0.91,
                        lastFetchedTimestamp: '2026-07-15T10:00:00.000Z',
                    },
                ],
            }),
            transact: vi.fn(),
            tx: createTxRoot(),
        };

        await expect(
            refreshServerExchangeRates({ db: db as any, fetchImpl: fetchImpl as any, now: new Date('2026-07-15T11:00:00.000Z') })
        ).resolves.toEqual({
            base: 'USD',
            rates: { EUR: 0.91 },
            timestamp: Math.floor(new Date('2026-07-15T10:00:00.000Z').getTime() / 1000),
            source: 'cache',
        });
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(db.transact).not.toHaveBeenCalled();
    });

    it('fetches stale rates with a server-only key and upserts deterministic pair rows', async () => {
        process.env.OPEN_EXCHANGE_RATES_APP_ID = 'server-test-secret';
        const fetchImpl = vi.fn().mockResolvedValue(
            Response.json({
                base: 'USD',
                timestamp: 1_752_580_800,
                rates: { USD: 1, eur: 0.92, NPR: 137.2, BAD: 'not-a-number' },
            })
        );
        const db = {
            query: vi.fn().mockResolvedValue({
                exchangeRates: [
                    {
                        id: 'existing-eur',
                        baseCurrency: 'USD',
                        targetCurrency: 'EUR',
                        rate: 0.8,
                        lastFetchedTimestamp: '2026-07-14T00:00:00.000Z',
                    },
                ],
            }),
            transact: vi.fn().mockResolvedValue(undefined),
            tx: createTxRoot(),
        };

        const result = await refreshServerExchangeRates({
            db: db as any,
            fetchImpl: fetchImpl as any,
            now: new Date('2026-07-15T12:00:00.000Z'),
        });

        expect(result).toEqual({
            base: 'USD',
            rates: { USD: 1, EUR: 0.92, NPR: 137.2 },
            timestamp: 1_752_580_800,
            source: 'provider',
        });
        const requestedUrl = fetchImpl.mock.calls[0][0] as URL;
        expect(requestedUrl.origin + requestedUrl.pathname).toBe('https://openexchangerates.org/api/latest.json');
        expect(requestedUrl.searchParams.get('app_id')).toBe('server-test-secret');
        expect(requestedUrl.searchParams.get('base')).toBe('USD');
        const transactions = db.transact.mock.calls[0][0] as any[];
        expect(transactions).toContainEqual({
            op: 'update',
            entity: 'exchangeRates',
            id: 'existing-eur',
            payload: {
                baseCurrency: 'USD',
                targetCurrency: 'EUR',
                pairKey: 'USD:EUR',
                rate: 0.92,
                lastFetchedTimestamp: '2025-07-15T12:00:00.000Z',
            },
        });
        expect(transactions).toContainEqual(
            expect.objectContaining({
                op: 'update',
                entity: 'exchangeRates',
                payload: expect.objectContaining({ pairKey: 'USD:NPR', rate: 137.2 }),
            })
        );
    });

    it('fails explicitly when stale data needs a provider but the server key is missing', async () => {
        delete process.env.OPEN_EXCHANGE_RATES_APP_ID;
        const fetchImpl = vi.fn();
        const db = {
            query: vi.fn().mockResolvedValue({ exchangeRates: [] }),
            transact: vi.fn(),
            tx: createTxRoot(),
        };

        await expect(
            refreshServerExchangeRates({ db: db as any, fetchImpl: fetchImpl as any, now: new Date('2026-07-15T12:00:00.000Z') })
        ).rejects.toBeInstanceOf(ExchangeRateConfigurationError);
        expect(fetchImpl).not.toHaveBeenCalled();
        expect(db.transact).not.toHaveBeenCalled();
    });

    it('coalesces simultaneous stale-cache refreshes into one provider request', async () => {
        process.env.OPEN_EXCHANGE_RATES_APP_ID = 'server-test-secret';
        const fetchImpl = vi.fn().mockResolvedValue(
            Response.json({ base: 'USD', timestamp: 1_784_128_000, rates: { USD: 1, EUR: 0.92 } })
        );
        const db = {
            query: vi.fn().mockResolvedValue({ exchangeRates: [] }),
            transact: vi.fn().mockResolvedValue(undefined),
            tx: createTxRoot(),
        };

        const first = refreshServerExchangeRates({ db: db as any, fetchImpl: fetchImpl as any });
        const second = refreshServerExchangeRates({ db: db as any, fetchImpl: fetchImpl as any });

        expect(first).toBe(second);
        await Promise.all([first, second]);
        expect(db.query).toHaveBeenCalledTimes(1);
        expect(fetchImpl).toHaveBeenCalledTimes(1);
        expect(db.transact).toHaveBeenCalledTimes(1);
    });
});
