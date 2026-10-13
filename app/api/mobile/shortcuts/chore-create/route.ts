import { NextRequest, NextResponse } from 'next/server';
import { createTodayAnytimeShortcutChore } from '@/lib/mobile-shortcut-chore-service';
import {
    authorizeMobileShortcutToken,
    MOBILE_SHORTCUT_CHORE_CAPABILITY,
    MOBILE_SHORTCUT_TOKEN_HEADER,
} from '@/lib/mobile-shortcut-tokens';
import { getDb } from '@/lib/server/db';
import { servesFromPostgres } from '@/lib/server/installation';
import { checkShortcutToken, createShortcutChore, SHORTCUT_CHORE_CAPABILITY, SHORTCUT_TOKEN_HEADER } from '@/lib/server/shortcuts';

export const dynamic = 'force-dynamic';

type ShortcutCreateChoreBody = {
    assigneeFamilyMemberId?: string;
    title?: string;
};

function noStoreJson(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function statusForCreateError(message: string) {
    if (message === 'Title is required') return 400;
    if (message === 'assigneeFamilyMemberId is required') return 400;
    if (message === 'Assignee not found') return 404;
    return 500;
}

export async function POST(request: NextRequest) {
    if (await servesFromPostgres()) return postToPostgres(request);

    const auth = await authorizeMobileShortcutToken({
        token: request.headers.get(MOBILE_SHORTCUT_TOKEN_HEADER),
        capability: MOBILE_SHORTCUT_CHORE_CAPABILITY,
    });
    if (!auth.ok) {
        const reason = 'reason' in auth ? auth.reason : 'invalid';
        return noStoreJson({ error: 'Unauthorized shortcut', reason }, 401);
    }

    let body: ShortcutCreateChoreBody = {};
    try {
        body = (await request.json()) as ShortcutCreateChoreBody;
    } catch {
        return noStoreJson({ error: 'Invalid request body' }, 400);
    }

    try {
        const created = await createTodayAnytimeShortcutChore({
            title: String(body.title || ''),
            assigneeFamilyMemberId: String(body.assigneeFamilyMemberId || ''),
        });
        return noStoreJson(created);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create chore';
        return noStoreJson({ error: message }, statusForCreateError(message));
    }
}

async function postToPostgres(request: NextRequest) {
    const db = getDb();
    const auth = await checkShortcutToken(db, request.headers.get(SHORTCUT_TOKEN_HEADER), SHORTCUT_CHORE_CAPABILITY);
    if (!auth.ok) return noStoreJson({ error: 'Unauthorized shortcut', reason: auth.reason }, 401);
    const body = (await request.json().catch(() => null)) as ShortcutCreateChoreBody | null;
    if (!body) return noStoreJson({ error: 'Invalid request body' }, 400);
    const installation = await db.selectFrom('installation').select('writes_frozen').executeTakeFirstOrThrow();
    if (installation.writes_frozen) return noStoreJson({ error: 'Changes are paused for a moment. Try again shortly.' }, 503);
    try {
        return noStoreJson(await createShortcutChore(db, { title: String(body.title || ''), assigneeFamilyMemberId: String(body.assigneeFamilyMemberId || '') }));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create chore';
        const status = statusForCreateError(message);
        if (status === 500) console.error('Failed to create a chore for a shortcut', error);
        return noStoreJson({ error: status === 500 ? 'Failed to create chore' : message }, status);
    }
}
