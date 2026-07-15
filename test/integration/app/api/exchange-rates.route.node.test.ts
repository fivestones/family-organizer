import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const routeMocks = vi.hoisted(() => {
    class ExchangeRateConfigurationError extends Error {}
    return {
        ExchangeRateConfigurationError,
        refreshServerExchangeRates: vi.fn(),
        requireRequestFamilyMember: vi.fn(),
    };
});

vi.mock('@/lib/exchange-rates-server', () => ({
    ExchangeRateConfigurationError: routeMocks.ExchangeRateConfigurationError,
    refreshServerExchangeRates: routeMocks.refreshServerExchangeRates,
}));
vi.mock('@/lib/request-family-member', () => ({ requireRequestFamilyMember: routeMocks.requireRequestFamilyMember }));

import { GET } from '@/app/api/exchange-rates/route';

describe('GET /api/exchange-rates', () => {
    beforeEach(() => {
        routeMocks.refreshServerExchangeRates.mockReset();
        routeMocks.requireRequestFamilyMember.mockReset();
    });

    it('requires a device-authorized family-member session', async () => {
        routeMocks.requireRequestFamilyMember.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized device' });
        const request = new NextRequest('http://localhost:3000/api/exchange-rates');

        const response = await GET(request);

        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({ error: 'Unauthorized device' });
        expect(routeMocks.refreshServerExchangeRates).not.toHaveBeenCalled();
    });

    it('returns server-cached provider rates without exposing credentials', async () => {
        routeMocks.requireRequestFamilyMember.mockResolvedValue({ ok: true, familyMember: { id: 'member-1' } });
        routeMocks.refreshServerExchangeRates.mockResolvedValue({
            base: 'USD',
            rates: { EUR: 0.92 },
            timestamp: 1_752_580_800,
            source: 'provider',
        });
        const request = new NextRequest('http://localhost:3000/api/exchange-rates');

        const response = await GET(request);
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(payload).toEqual({ base: 'USD', rates: { EUR: 0.92 }, timestamp: 1_752_580_800, source: 'provider' });
        expect(JSON.stringify(payload)).not.toContain('app_id');
    });

    it('returns a clear service-unavailable response when the server key is not configured', async () => {
        routeMocks.requireRequestFamilyMember.mockResolvedValue({ ok: true, familyMember: { id: 'member-1' } });
        routeMocks.refreshServerExchangeRates.mockRejectedValue(
            new routeMocks.ExchangeRateConfigurationError('Exchange-rate provider is not configured.')
        );

        const response = await GET(new NextRequest('http://localhost:3000/api/exchange-rates'));

        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ error: 'Exchange-rate provider is not configured.' });
    });
});
