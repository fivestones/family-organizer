import { NextRequest, NextResponse } from 'next/server';

import type { FinanceRequest } from '@family-organizer/data/finance/types';
import type { FinanceMutationRequest } from '@/lib/finance-mutation-client';
import { executeServerFinanceMutation, FinanceMutationError } from '@/lib/finance-mutation-server';
import { requireRequestFamilyMember } from '@/lib/request-family-member';
import { executeFinanceRequest, FinanceError } from '@/lib/server/finance';
import { askedUnderSession, jsonError, jsonOk, requireSession } from '@/lib/server/request-session';

export const dynamic = 'force-dynamic';

/**
 * Every change to money. A client on PowerSync asks under the app's own session and is served from Postgres; one
 * still on InstantDB asks with an Instant token and is served as before.
 */
export async function POST(request: NextRequest) {
    if (askedUnderSession(request)) return postUnderSession(request);

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

async function postUnderSession(request: NextRequest) {
    const context = await requireSession(request);
    if (!context.ok) return context.response;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonError(400, 'invalid_body', 'Invalid request body');
    }

    try {
        return jsonOk({ result: await executeFinanceRequest(context.db, context.session.principal, body as FinanceRequest) });
    } catch (error) {
        if (error instanceof FinanceError) return jsonError(error.status, 'finance_refused', error.message);
        console.error('Finance request failed:', error);
        return jsonError(500, 'finance_failed', 'Finance change failed.');
    }
}
