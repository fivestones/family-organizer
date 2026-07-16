import { NextRequest, NextResponse } from 'next/server';

import type { FinanceMutationRequest } from '@/lib/finance-mutation-client';
import { executeServerFinanceMutation, FinanceMutationError } from '@/lib/finance-mutation-server';
import { requireRequestFamilyMember } from '@/lib/request-family-member';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    const authContext = await requireRequestFamilyMember(request);
    if ('error' in authContext) {
        return NextResponse.json({ error: authContext.error }, { status: authContext.status });
    }

    try {
        const body = (await request.json()) as FinanceMutationRequest;
        const result = await executeServerFinanceMutation(body, authContext);
        return NextResponse.json({ result }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
        console.error('Finance mutation failed:', error);
        const status = error instanceof FinanceMutationError ? error.status : 400;
        const message = error instanceof Error ? error.message : 'Finance change failed.';
        return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
    }
}
