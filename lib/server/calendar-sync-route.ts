import 'server-only';

import type { NextRequest } from 'next/server';
import { isParent } from '@family-organizer/data/session/principal';
import { getCalendarSyncCronSecret } from '@/lib/apple-caldav/config';
import { connectCalendarAccount, getCalendarSyncStatus, runCalendarSync, updateCalendarSyncSettings } from './calendar-sync';
import { getDb, isPostgresConfigured, type AppDatabase } from './db';
import { jsonError, jsonOk, requireSession } from './request-session';

// The calendar import's routes, served from Postgres. Two kinds of asker may use them: the scheduled job, which
// proves itself with a secret of its own, and a parent, signed in on an activated device.

type Asker = { ok: true; db: AppDatabase; by: 'cron' | 'parent' } | { ok: false; response: Response };

async function whoIsAsking(request: NextRequest): Promise<Asker> {
    const secret = getCalendarSyncCronSecret();
    if (secret && (request.headers.get('authorization') === `Bearer ${secret}` || request.headers.get('x-calendar-sync-secret') === secret)) {
        if (!isPostgresConfigured()) return { ok: false, response: jsonError(503, 'postgres_not_configured', 'This deployment has no Postgres database') };
        return { ok: true, db: getDb(), by: 'cron' };
    }
    const context = await requireSession(request);
    if (!context.ok) return context;
    if (!isParent(context.session.principal)) return { ok: false, response: jsonError(403, 'parent_required', 'Parent access required') };
    return { ok: true, db: context.db, by: 'parent' };
}

const failed = (error: unknown, fallback: string) => {
    console.error(`[calendar-sync] ${fallback}`, error);
    return jsonError(500, 'calendar_sync_failed', error instanceof Error && error.message ? error.message : fallback);
};

export async function statusOnPostgres(request: NextRequest) {
    const asker = await whoIsAsking(request);
    if (!asker.ok) return asker.response;
    return jsonOk(await getCalendarSyncStatus(asker.db));
}

export async function calendarsOnPostgres(request: NextRequest) {
    const asker = await whoIsAsking(request);
    if (!asker.ok) return asker.response;
    const status = await getCalendarSyncStatus(asker.db);
    return jsonOk({ accountId: status.account?.id ?? null, calendars: status.calendars });
}

export async function connectOnPostgres(request: NextRequest) {
    const asker = await whoIsAsking(request);
    if (!asker.ok) return asker.response;
    const body = (await request.json().catch(() => null)) as { username?: unknown; appSpecificPassword?: unknown; accountLabel?: unknown } | null;
    const username = typeof body?.username === 'string' ? body.username.trim() : '';
    const appSpecificPassword = typeof body?.appSpecificPassword === 'string' ? body.appSpecificPassword.trim() : '';
    if (!username || !appSpecificPassword) return jsonError(400, 'invalid_body', 'username and appSpecificPassword are required');
    try {
        const connected = await connectCalendarAccount(asker.db, { username, appSpecificPassword, accountLabel: typeof body?.accountLabel === 'string' ? body.accountLabel.trim() : '' });
        return jsonOk({ ok: true, ...connected });
    } catch (error) {
        return failed(error, 'Failed to connect Apple Calendar');
    }
}

export async function settingsOnPostgres(request: NextRequest) {
    const asker = await whoIsAsking(request);
    if (!asker.ok) return asker.response;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
    if (!accountId) return jsonError(400, 'invalid_body', 'accountId is required');
    try {
        await updateCalendarSyncSettings(asker.db, {
            accountId,
            selectedCalendarIds: Array.isArray(body?.selectedCalendarIds) ? body.selectedCalendarIds.map(String) : [],
            enabled: body?.enabled !== false,
            syncWindowPastDays: Number(body?.syncWindowPastDays || 0) || undefined,
            syncWindowFutureDays: Number(body?.syncWindowFutureDays || 0) || undefined,
        });
        return jsonOk({ ok: true });
    } catch (error) {
        if (error instanceof Error && error.message === 'Calendar sync account not found') return jsonError(404, 'account_not_found', error.message);
        return failed(error, 'Failed to update Apple Calendar sync settings');
    }
}

export async function runOnPostgres(request: NextRequest) {
    const asker = await whoIsAsking(request);
    if (!asker.ok) return asker.response;
    const body = (await request.json().catch(() => null)) as { accountId?: unknown; trigger?: unknown } | null;
    const installation = await asker.db.selectFrom('installation').select('writes_frozen').executeTakeFirstOrThrow();
    if (installation.writes_frozen) return jsonError(503, 'writes_frozen', 'Changes are paused for a moment. Try again shortly.', { 'Retry-After': '30' });
    try {
        const result = await runCalendarSync(asker.db, {
            accountId: typeof body?.accountId === 'string' && body.accountId ? body.accountId : undefined,
            trigger: typeof body?.trigger === 'string' && body.trigger ? body.trigger : asker.by === 'cron' ? 'cron' : 'manual',
        });
        if (result.skipped && result.reason === 'already_running') return Response.json(result, { status: 409, headers: { 'Cache-Control': 'no-store' } });
        return jsonOk(result);
    } catch (error) {
        return failed(error, 'Failed to run Apple Calendar sync');
    }
}
