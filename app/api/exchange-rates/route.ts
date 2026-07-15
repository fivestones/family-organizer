import { NextRequest, NextResponse } from 'next/server';

import { ExchangeRateConfigurationError, refreshServerExchangeRates } from '@/lib/exchange-rates-server';
import { requireRequestFamilyMember } from '@/lib/request-family-member';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
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
