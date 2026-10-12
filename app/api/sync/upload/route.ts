import { NextRequest } from 'next/server';
import { jsonError, jsonOk, requireSession } from '@/lib/server/request-session';
import { applyUpload, GenerationChangedError, parseUpload, WritesFrozenError } from '@/lib/server/upload';

export const dynamic = 'force-dynamic';

/**
 * Takes one transaction a device made while it could not, or need not, wait for the server.
 *
 * A refusal is answered with 200, because it is an answer: the device must not send the transaction again. Only
 * something that may pass — the server frozen, the database out of reach — is answered with an error, and the
 * device keeps the transaction and tries later. A session signed out but still draining may upload; that is what
 * draining is for.
 */
export async function POST(request: NextRequest) {
    const context = await requireSession(request, { allowDraining: true });
    if (!context.ok) return context.response;

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return jsonError(400, 'invalid_body', 'Invalid request body');
    }
    const upload = parseUpload(body);
    if (!upload) return jsonError(400, 'invalid_body', 'Not an uploaded transaction');

    try {
        const result = await applyUpload(context.db, context.session, upload);
        return jsonOk({ ...result.outcome, replayed: result.replayed });
    } catch (error) {
        if (error instanceof WritesFrozenError) return jsonError(503, 'writes_frozen', 'Writes are paused for a moment', { 'Retry-After': '30' });
        if (error instanceof GenerationChangedError) return jsonError(409, 'generation_changed', 'The data under the app has been replaced');
        throw error;
    }
}
