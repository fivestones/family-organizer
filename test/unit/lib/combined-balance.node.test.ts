import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freezeTime } from '@/test/utils/fake-clock';
import { RATE_REFRESH_RETRY_MS, calculateCombinedBalance, claimRateRefresh } from '@/lib/combined-balance';
import type { CachedExchangeRate, UnitDefinition } from '@/lib/currency-utils';

const NOW = new Date('2026-03-31T10:00:00Z');

const UNITS = [
    { id: 'usd', code: 'USD', symbol: '$', isMonetary: true },
    { id: 'npr', code: 'NPR', symbol: 'रु', isMonetary: true },
    { id: 'stars', code: 'STARS', symbol: '⭐', isMonetary: false },
] as unknown as UnitDefinition[];

function rate(targetCurrency: string, value: number, fetchedAt = NOW): CachedExchangeRate {
    return { id: `usd-${targetCurrency}`, baseCurrency: 'USD', targetCurrency, rate: value, lastFetchedTimestamp: fetchedAt };
}

function combine(totalBalances: Record<string, number>, cachedRates: CachedExchangeRate[] = [], overrides: Record<string, unknown> = {}) {
    return calculateCombinedBalance({
        db: {},
        totalBalances,
        displayCurrency: 'USD',
        unitDefinitions: UNITS,
        cachedRates,
        ...overrides,
    });
}

describe('combined balance', () => {
    beforeEach(() => {
        freezeTime(NOW);
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('adds up convertible money in the display currency', async () => {
        const result = await combine({ USD: 10, NPR: 1300 }, [rate('NPR', 130)]);

        expect(result?.combinedTotal).toBeCloseTo(20);
        expect(result?.separateBalances).toEqual({});
        expect(result?.pairsNeedingRefresh).toEqual([]);
        expect(result?.lines).toHaveLength(2);
        expect(result?.lines[0]).toContain('already in USD');
    });

    it('keeps non-monetary units apart from the total', async () => {
        const result = await combine({ USD: 10, STARS: 5 });
        expect(result).toMatchObject({ combinedTotal: 10, separateBalances: { STARS: 5 }, pairsNeedingRefresh: [] });
    });

    it('resolves with an undefined currency left apart instead of waiting for a rate that will never come', async () => {
        // "XYZ" has no unit definition and no exchange rate anywhere.
        const result = await combine({ USD: 10, XYZ: 40 });

        expect(result?.combinedTotal).toBe(10);
        expect(result?.separateBalances).toEqual({ XYZ: 40 });
        expect(result?.lines.some((line) => line.includes('rate to USD unavailable'))).toBe(true);
        expect(result?.pairsNeedingRefresh).toEqual(['XYZ>USD']);
    });

    it('treats an undefined unit that does not look like a currency code as non-monetary', async () => {
        const result = await combine({ ROBUX: 40 });
        expect(result).toMatchObject({ combinedTotal: 0, separateBalances: { ROBUX: 40 }, pairsNeedingRefresh: [] });
    });

    it('uses a stale rate now and asks for a fresh one', async () => {
        const lastWeek = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000);
        const result = await combine({ NPR: 1300 }, [rate('NPR', 130, lastWeek)]);

        expect(result?.combinedTotal).toBeCloseTo(10);
        expect(result?.separateBalances).toEqual({});
        expect(result?.pairsNeedingRefresh).toEqual(['NPR>USD']);
    });

    it('ignores zero balances', async () => {
        const result = await combine({ USD: 0, XYZ: 0, STARS: 0 });
        expect(result).toEqual({ combinedTotal: 0, lines: [], separateBalances: {}, pairsNeedingRefresh: [] });
    });

    it('returns nothing once a newer calculation has cancelled it', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await combine({ USD: 10 }, [], { signal: controller.signal })).toBeNull();
    });

    describe('background rate refresh', () => {
        it('asks about a pair once, then leaves it alone for a while', () => {
            const attempts = new Map<string, number>();
            const t0 = NOW.getTime();

            expect(claimRateRefresh(['XYZ>USD'], attempts, t0)).toEqual(['XYZ>USD']);
            // The rate service does not know XYZ, so the next recalculation still wants it.
            expect(claimRateRefresh(['XYZ>USD'], attempts, t0 + 1000)).toEqual([]);
            expect(claimRateRefresh(['XYZ>USD'], attempts, t0 + RATE_REFRESH_RETRY_MS)).toEqual(['XYZ>USD']);
        });

        it('still asks about a pair it has not tried', () => {
            const attempts = new Map<string, number>();
            const t0 = NOW.getTime();
            claimRateRefresh(['XYZ>USD'], attempts, t0);

            expect(claimRateRefresh(['XYZ>USD', 'NPR>USD'], attempts, t0 + 1000)).toEqual(['NPR>USD']);
        });

        it('asks for nothing when every rate is fresh', () => {
            expect(claimRateRefresh([], new Map())).toEqual([]);
        });
    });
});
