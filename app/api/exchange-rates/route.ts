import { NextRequest, NextResponse } from 'next/server';

import { ExchangeRateConfigurationError, refreshServerExchangeRates } from '@/lib/exchange-rates-server';
import { requireRequestFamilyMember } from '@/lib/request-family-member';
import { ExchangeRatesNotConfiguredError, refreshExchangeRates } from '@/lib/server/exchange-rates';
import { askedUnderSession, jsonError, jsonOk, requireSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    if (askedUnderSession(request)) return getUnderSession(request);

    const authContext = await requireRequestFamilyMember(request);
    if ('error' in authContext) {
        return NextResponse.json({ error: authContext.error }, { status: authContext.status });
    }

    try {
        const result = await refreshServerExchangeRates();
        return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error('Failed to refresh exchange rates:', error);
        const status = error instanceof ExchangeRateConfigurationError ? 503 : 502;
        const message = error instanceof ExchangeRateConfigurationError ? error.message : 'Could not update exchange rates.';
        return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
}

async function getUnderSession(request: NextRequest) {
    const context = await requireSession(request);
    if (!context.ok) return context.response;
    try {
        return jsonOk(await refreshExchangeRates(context.db));
    } catch (error) {
        if (error instanceof ExchangeRatesNotConfiguredError) return jsonError(503, 'rates_not_configured', error.message);
        console.error('Failed to refresh exchange rates:', error);
        return jsonError(502, 'rates_unavailable', 'Could not update exchange rates.');
    }
}
