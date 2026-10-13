import 'server-only';

import { createHash, randomBytes, randomUUID } from 'crypto';
import { HOUSEHOLD_SCHEDULE_SETTINGS_NAME, getFamilyDayDateUTC, parseSharedScheduleSettings } from '@family-organizer/shared-core';
import type { AppDatabase } from './db';

// iOS Shortcuts. A parent issues a token on their phone; a shortcut holding it may list the family and add a
// chore for today, and nothing else. Only the token's hash is kept.

export const SHORTCUT_TOKEN_HEADER = 'x-family-shortcut-token';
export const SHORTCUT_CHORE_CAPABILITY = 'shortcut_chore_quick_create_v1';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export type ShortcutTokenCheck = { ok: true; parentFamilyMemberId: string } | { ok: false; reason: 'missing' | 'invalid' | 'revoked' | 'capability_mismatch' };

/** Whether a token may do what a shortcut is asking to, noting that it was used. */
export async function checkShortcutToken(db: AppDatabase, rawToken: string | null | undefined, capability: string, now: Date = new Date()): Promise<ShortcutTokenCheck> {
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    if (!token) return { ok: false, reason: 'missing' };
    const record = await db.selectFrom('shortcut_tokens').select(['id', 'capability', 'revoked_at', 'parent_family_member_id']).where('token_hash', '=', hashToken(token)).executeTakeFirst();
    if (!record) return { ok: false, reason: 'invalid' };
    if (record.revoked_at) return { ok: false, reason: 'revoked' };
    if (record.capability !== capability) return { ok: false, reason: 'capability_mismatch' };
    await db.updateTable('shortcut_tokens').set({ last_used_at: now }).where('id', '=', record.id).execute();
    return { ok: true, parentFamilyMemberId: record.parent_family_member_id };
}

/** Issues a token under a label. One issued before under the same label, by the same parent, stops working. */
export async function issueShortcutToken(
    db: AppDatabase,
    input: { capability: string; label: string; parentFamilyMemberId: string; issuedPlatform?: string | null; issuedDeviceName?: string | null },
    now: Date = new Date()
): Promise<{ token: string; tokenId: string; label: string; parentFamilyMemberId: string }> {
    const token = `fost_${randomBytes(24).toString('base64url')}`;
    const tokenId = randomUUID();
    await db.transaction().execute(async (trx) => {
        await trx
            .updateTable('shortcut_tokens')
            .set({ revoked_at: now })
            .where('capability', '=', input.capability)
            .where('label', '=', input.label)
            .where('parent_family_member_id', '=', input.parentFamilyMemberId)
            .where('revoked_at', 'is', null)
            .execute();
        await trx
            .insertInto('shortcut_tokens')
            .values({
                id: tokenId,
                token_hash: hashToken(token),
                capability: input.capability,
                label: input.label,
                parent_family_member_id: input.parentFamilyMemberId,
                issued_platform: input.issuedPlatform ?? null,
                issued_device_name: input.issuedDeviceName ?? null,
                created_at: now,
            })
            .execute();
    });
    return { token, tokenId, label: input.label, parentFamilyMemberId: input.parentFamilyMemberId };
}

/** The family as a shortcut's picker shows it. Two people of one name are told apart by role, and then by id. */
export async function listShortcutFamilyMembers(db: AppDatabase) {
    const members = await db.selectFrom('family_members').select(['id', 'name', 'role', 'photo_urls']).orderBy('name').orderBy('id').execute();
    const count = (key: (member: (typeof members)[number]) => string) => {
        const counts = new Map<string, number>();
        for (const member of members) counts.set(key(member), (counts.get(key(member)) ?? 0) + 1);
        return (member: (typeof members)[number]) => counts.get(key(member)) ?? 0;
    };
    const sameName = count((member) => member.name);
    const sameNameAndRole = count((member) => `${member.name}\n${member.role}`);
    return members.map((member) => ({
        id: member.id,
        label: sameName(member) <= 1 ? member.name : sameNameAndRole(member) <= 1 ? `${member.name} (${member.role})` : `${member.name} (${member.role} • ${member.id.slice(-4)})`,
        name: member.name,
        role: member.role,
        photoUrls: (member.photo_urls as Record<string, string> | null) ?? null,
    }));
}

/** A chore for one person, today, at any time: what a shortcut adds. Its messages are what a shortcut shows. */
export async function createShortcutChore(db: AppDatabase, input: { title: string; assigneeFamilyMemberId: string }, now: Date = new Date()) {
    const title = String(input.title ?? '').trim();
    if (!title) throw new Error('Title is required');
    const assigneeId = String(input.assigneeFamilyMemberId ?? '').trim();
    if (!assigneeId) throw new Error('assigneeFamilyMemberId is required');
    if (!/^[0-9a-f-]{36}$/i.test(assigneeId)) throw new Error('Assignee not found');

    return db.transaction().execute(async (trx) => {
        const assignee = await trx.selectFrom('family_members').select('id').where('id', '=', assigneeId).executeTakeFirst();
        if (!assignee) throw new Error('Assignee not found');
        const schedule = await trx.selectFrom('settings').select('value').where('name', '=', HOUSEHOLD_SCHEDULE_SETTINGS_NAME).executeTakeFirst();
        // The family's day turns over when the household says it does, not at midnight.
        const dateKey = getFamilyDayDateUTC(now, parseSharedScheduleSettings(schedule?.value ?? null)).toISOString().slice(0, 10);
        const last = await trx.selectFrom('chores').select((expression) => expression.fn.max('sort_order').as('last')).executeTakeFirst();
        const choreId = randomUUID();
        await trx.insertInto('chores').values({ id: choreId, title, description: '', start_date: dateKey, sort_order: (last?.last ?? -1) + 1, weight: 0, created_at: now }).execute();
        await trx.insertInto('chore_assignees').values({ chore_id: choreId, family_member_id: assignee.id, position: 0 }).execute();
        return { choreId, title, assigneeFamilyMemberId: assignee.id, dateKey };
    });
}
