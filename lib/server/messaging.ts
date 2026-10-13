import 'server-only';

import { randomUUID } from 'crypto';
import { sql, type Transaction } from 'kysely';
import type { Principal } from '@family-organizer/data/session/principal';
import type { Database } from '@/db/types';
import { HISTORY_MESSAGE_EDIT_WINDOW_MS } from '@/lib/history-events';
import { MessageServiceError } from '@/lib/message-errors';
import {
    LINKED_THREAD_DOMAINS,
    MESSAGE_IMPORTANCE_LEVELS,
    MESSAGE_NOTIFICATION_LEVELS,
    type AcknowledgeMessageRequest,
    type CreateThreadRequest,
    type EditMessageRequest,
    type LinkedThreadDomain,
    type MarkReadRequest,
    type MessageImportance,
    type MessageNotificationLevel,
    type SendMessageRequest,
    type ThreadPreferencesRequest,
    type ToggleReactionRequest,
    type UploadedMessageAttachment,
} from '@/lib/messaging-types';
import { jsonb, type AppDatabase } from './db';
import { recordHistory } from './history';

// Messages (docs/powersync-migration.md, "The server on Postgres").
//
// A device reads threads and messages from its own database and writes none of them: everything said, and every
// change to who is in a thread or how they keep it, is asked of the server and written here. What must be so —
// one thread for two people, a person in a thread once, a reaction once — is a constraint in the database, so a
// request that arrives twice does once what it asks. Each answer is small: the device sees the rest as it syncs.

/** The two threads every family has. A family moved from InstantDB may hold them under other ids, by the same keys. */
export const FAMILY_THREAD_ID = '00000000-0000-4000-8000-000000000001';
export const PARENTS_THREAD_ID = '00000000-0000-4000-8000-000000000002';

type Trx = Transaction<Database>;

export interface MessagingActor {
    id: string;
    name: string;
    isParent: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY = 20_000;
const MAX_ATTACHMENTS = 20;

function refuse(status: 400 | 403 | 404 | 409, message: string): never {
    throw new MessageServiceError(status, message);
}

/** An id as it was asked for, or the answer that there is no such thing: a malformed id names nothing. */
function idOr404(value: unknown, missing: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) refuse(404, missing);
    return (value as string).toLowerCase();
}

const oneLine = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
const optionalNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const optionalInteger = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);
const optionalString = (value: unknown) => (typeof value === 'string' && value ? value : null);

/** Who a session speaks as. The shared kid session is nobody in particular, and a message is always somebody's. */
export async function messagingActor(db: AppDatabase, principal: Principal): Promise<MessagingActor> {
    if (!principal.familyMemberId) refuse(403, 'Sign in as yourself to use messages');
    const member = await db.selectFrom('family_members').select(['id', 'name', 'role']).where('id', '=', principal.familyMemberId).executeTakeFirst();
    if (!member) refuse(404, 'Family member not found');
    return { id: member!.id, name: member!.name, isParent: member!.role === 'parent' };
}

// ---- Threads ----

/**
 * Makes sure the family's thread and the parents' thread exist, with everyone who belongs in them. People added
 * afterwards are put in by the database as they are added.
 */
export async function ensureStandingThreads(db: AppDatabase): Promise<{ familyThreadId: string; parentsOnlyThreadId: string }> {
    return db.transaction().execute(async (trx) => {
        const firstParent = await trx.selectFrom('family_members').select('id').where('role', '=', 'parent').orderBy('sort_order').orderBy('id').executeTakeFirst();
        await trx
            .insertInto('message_threads')
            .values([
                { id: FAMILY_THREAD_ID, thread_type: 'family', visibility: 'family', thread_key: 'family', title: 'Family', created_by: firstParent?.id ?? null },
                { id: PARENTS_THREAD_ID, thread_type: 'parents_only', visibility: 'parents_only', thread_key: 'parents_only', title: 'Parents', created_by: firstParent?.id ?? null },
            ])
            .onConflict((conflict) => conflict.column('thread_key').doNothing())
            .execute();
        await sql`
            INSERT INTO message_thread_members (thread_id, family_member_id)
            SELECT thread.id, member.id FROM message_threads AS thread CROSS JOIN family_members AS member
            WHERE thread.thread_key = 'family' OR (thread.thread_key = 'parents_only' AND member.role = 'parent')
            ON CONFLICT DO NOTHING
        `.execute(trx);
        const threads = await trx.selectFrom('message_threads').select(['id', 'thread_key']).where('thread_key', 'in', ['family', 'parents_only']).execute();
        const idOf = (key: string) => threads.find((thread) => thread.thread_key === key)!.id;
        return { familyThreadId: idOf('family'), parentsOnlyThreadId: idOf('parents_only') };
    });
}

/**
 * Opens a conversation: the one there already is for these people or this thing, or a new one. Two people have
 * one direct thread between them and a chore has one discussion, however many times either is asked for.
 */
export async function createThread(db: AppDatabase, actor: MessagingActor, input: CreateThreadRequest): Promise<{ threadId: string; created: boolean }> {
    const type = input?.threadType;
    if (type === 'family') return { threadId: (await ensureStandingThreads(db)).familyThreadId, created: false };
    if (type === 'parents_only') {
        if (!actor.isParent) refuse(403, 'Only parents can create or open parent-only threads');
        return { threadId: (await ensureStandingThreads(db)).parentsOnlyThreadId, created: false };
    }
    if (type !== 'direct' && type !== 'group' && type !== 'linked') refuse(400, 'Unknown kind of thread');

    return db.transaction().execute(async (trx) => {
        const family = await trx.selectFrom('family_members').select(['id', 'name', 'role']).orderBy('sort_order').orderBy('id').execute();
        const nameOf = new Map(family.map((member) => [member.id, member.name]));
        const asked = Array.isArray(input.participantIds) ? input.participantIds.filter((id): id is string => typeof id === 'string').map((id) => id.toLowerCase()) : [];
        let participants = Array.from(new Set([actor.id, ...asked])).filter((id) => nameOf.has(id));

        let threadKey: string;
        let title = oneLine(input.title);
        let linkedDomain: LinkedThreadDomain | null = null;
        let linkedEntityId: string | null = null;
        if (type === 'direct') {
            if (participants.length !== 2) refuse(400, 'Direct messages require exactly two participants');
            threadKey = `direct:${participants.slice().sort().join(':')}`;
            title ||= participants.map((id) => nameOf.get(id)).join(' & ');
        } else if (type === 'linked') {
            linkedEntityId = oneLine(input.linkedEntityId) || null;
            if (!input.linkedDomain || !LINKED_THREAD_DOMAINS.includes(input.linkedDomain) || !linkedEntityId) refuse(400, 'linkedDomain and linkedEntityId are required for linked threads');
            linkedDomain = input.linkedDomain!;
            // A discussion opened by one person alone is with the parents.
            if (participants.length < 2) participants = Array.from(new Set([actor.id, ...family.filter((member) => member.role === 'parent').map((member) => member.id)]));
            if (participants.length < 2) refuse(400, 'Group conversations require at least two participants');
            threadKey = `linked:${linkedDomain}:${linkedEntityId}`;
            title ||= 'Discussion';
        } else {
            if (participants.length < 2) refuse(400, 'Group conversations require at least two participants');
            threadKey = `group:${randomUUID()}`;
            title ||= participants.map((id) => nameOf.get(id)).join(', ');
        }

        const threadId = randomUUID();
        const made = await trx
            .insertInto('message_threads')
            .values({ id: threadId, thread_type: type, visibility: 'members', thread_key: threadKey, title: title.slice(0, 200), linked_domain: linkedDomain, linked_entity_id: linkedEntityId, created_by: actor.id })
            .onConflict((conflict) => conflict.column('thread_key').doNothing())
            .returning('id')
            .executeTakeFirst();
        if (!made) {
            const existing = await trx.selectFrom('message_threads').select('id').where('thread_key', '=', threadKey).executeTakeFirstOrThrow();
            return { threadId: existing.id, created: false };
        }
        await trx
            .insertInto('message_thread_members')
            .values(participants.map((id) => ({ thread_id: threadId, family_member_id: id, member_role: id === actor.id && type === 'group' ? ('owner' as const) : ('member' as const) })))
            .execute();
        return { threadId, created: true };
    });
}

async function threadOr404(trx: Trx, threadId: unknown, lock = false) {
    const id = idOr404(threadId, 'Thread not found');
    const query = trx.selectFrom('message_threads').select(['id', 'thread_key', 'thread_type']).where('id', '=', id);
    const thread = await (lock ? query.forUpdate() : query).executeTakeFirst();
    if (!thread) refuse(404, 'Thread not found');
    return thread!;
}

async function membershipOf(trx: Trx, threadId: string, memberId: string) {
    return trx.selectFrom('message_thread_members').select(['member_role', 'is_archived', 'pinned_at']).where('thread_id', '=', threadId).where('family_member_id', '=', memberId).executeTakeFirst();
}

async function mustBeIn(trx: Trx, threadId: string, actor: MessagingActor) {
    const membership = await membershipOf(trx, threadId, actor.id);
    if (!membership) refuse(403, 'You are not a member of this thread');
    return membership!;
}

// ---- Messages ----

function checkedAttachments(value: unknown): UploadedMessageAttachment[] {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) refuse(400, 'Attachments are not a list of files');
    return (value as UploadedMessageAttachment[]).map((attachment) => {
        if (!attachment || typeof attachment.id !== 'string' || !UUID.test(attachment.id) || !oneLine(attachment.name) || !optionalString(attachment.url) || !optionalString(attachment.type)) {
            refuse(400, 'An attachment is missing its id, name, type or place');
        }
        return attachment;
    });
}

function previewOf(body: string, attachments: readonly UploadedMessageAttachment[]): string {
    const said = oneLine(body);
    if (said) return said.slice(0, 160);
    if (attachments.length === 1) return `Attachment: ${attachments[0].name}`;
    if (attachments.length > 1) return `${attachments.length} attachments`;
    return 'New message';
}

export interface SentMessage {
    messageId: string;
    threadId: string;
    createdAt: string;
    /** True when this message had been sent before, and this is the answer to its being sent again. */
    alreadySent: boolean;
}

/**
 * Says something in a thread. A message that carries its device's own word for it is sent once however many
 * times the request arrives. The time on it is the server's, which is what orders a thread the same for everyone.
 */
export async function sendMessage(db: AppDatabase, actor: MessagingActor, input: SendMessageRequest, now: Date = new Date()): Promise<SentMessage> {
    const body = typeof input?.body === 'string' ? input.body.trim() : '';
    const attachments = checkedAttachments(input?.attachments);
    if (!body && attachments.length === 0) refuse(400, 'Message body or attachment is required');
    if (body.length > MAX_BODY) refuse(400, 'That message is too long');
    const importance = (input.importance ?? 'normal') as MessageImportance;
    if (!MESSAGE_IMPORTANCE_LEVELS.includes(importance)) refuse(400, 'Unknown importance');
    if (!actor.isParent && (importance === 'announcement' || importance === 'needs_ack')) refuse(403, 'Only parents can send announcements or acknowledgement requests');
    const nonce = optionalString(input.clientNonce)?.slice(0, 200) ?? null;

    return db.transaction().execute(async (trx) => {
        // Holding the thread orders what is said in it, so the newest message it names is the newest.
        const thread = await threadOr404(trx, input.threadId, true);
        await mustBeIn(trx, thread.id, actor);

        let replyTo: string | null = null;
        if (input.replyToMessageId) {
            replyTo = idOr404(input.replyToMessageId, 'The message being answered was not found');
            const answered = await trx.selectFrom('messages').select('id').where('id', '=', replyTo).where('thread_id', '=', thread.id).executeTakeFirst();
            if (!answered) refuse(404, 'The message being answered was not found');
        }

        const messageId = randomUUID();
        const sent = await trx
            .insertInto('messages')
            .values({
                id: messageId,
                thread_id: thread.id,
                author_id: actor.id,
                body,
                importance,
                reply_to_id: replyTo,
                client_nonce: nonce,
                created_at: now,
                updated_at: now,
                editable_until: new Date(now.getTime() + HISTORY_MESSAGE_EDIT_WINDOW_MS),
            })
            .onConflict((conflict) => conflict.columns(['thread_id', 'author_id', 'client_nonce']).where('client_nonce', 'is not', null).doNothing())
            .returning('id')
            .executeTakeFirst();
        if (!sent) {
            const earlier = await trx.selectFrom('messages').select(['id', 'created_at']).where('thread_id', '=', thread.id).where('author_id', '=', actor.id).where('client_nonce', '=', nonce).executeTakeFirstOrThrow();
            return { messageId: earlier.id, threadId: thread.id, createdAt: earlier.created_at, alreadySent: true };
        }

        if (attachments.length > 0) {
            const taken = await trx.selectFrom('message_attachments').select('id').where('id', 'in', attachments.map((attachment) => attachment.id.toLowerCase())).executeTakeFirst();
            if (taken) refuse(409, 'One of those files has already been sent');
            await trx
                .insertInto('message_attachments')
                .values(
                    attachments.map((attachment) => ({
                        id: attachment.id.toLowerCase(),
                        message_id: messageId,
                        name: oneLine(attachment.name),
                        type: attachment.type,
                        url: attachment.url,
                        kind: optionalString(attachment.kind),
                        size_bytes: optionalInteger(attachment.sizeBytes),
                        width: optionalInteger(attachment.width),
                        height: optionalInteger(attachment.height),
                        duration_sec: optionalNumber(attachment.durationSec),
                        thumbnail_url: optionalString(attachment.thumbnailUrl),
                        thumbnail_width: optionalInteger(attachment.thumbnailWidth),
                        thumbnail_height: optionalInteger(attachment.thumbnailHeight),
                        blurhash: optionalString(attachment.blurhash),
                        waveform_peaks: Array.isArray(attachment.waveformPeaks) ? jsonb(attachment.waveformPeaks) : null,
                        created_at: now,
                        updated_at: now,
                    }))
                )
                .execute();
        }
        await trx
            .updateTable('message_threads')
            .set({ latest_message_at: now, latest_message_author_id: actor.id, latest_message_preview: previewOf(body, attachments), updated_at: now })
            .where('id', '=', thread.id)
            .execute();

        if (actor.isParent && importance === 'announcement' && thread.thread_key === 'family') {
            await recordHistory(trx, {
                occurredAt: now,
                domain: 'messages',
                actionType: 'message_announcement',
                summary: `${actor.name} posted an announcement in Family`,
                source: 'manual',
                actorId: actor.id,
                messageThreadId: thread.id,
                messageId,
                metadata: { importance, threadType: thread.thread_type },
            });
        }
        return { messageId, threadId: thread.id, createdAt: now.toISOString(), alreadySent: false };
    });
}

async function messageOr404(trx: Trx, messageId: unknown) {
    const id = idOr404(messageId, 'Message not found');
    const message = await trx.selectFrom('messages').select(['id', 'thread_id', 'author_id', 'editable_until', 'deleted_at']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!message) refuse(404, 'Message not found');
    return message!;
}

const stillEditable = (message: { editable_until: string | null }, now: Date) => message.editable_until !== null && now.getTime() <= new Date(message.editable_until).getTime();

/** Rewords a message, which its author may do for a few minutes after sending it. */
export async function editMessage(db: AppDatabase, actor: MessagingActor, input: EditMessageRequest, now: Date = new Date()): Promise<{ messageId: string }> {
    return db.transaction().execute(async (trx) => {
        const message = await messageOr404(trx, input?.messageId);
        if (message.author_id !== actor.id) refuse(403, 'Only the author can edit this message');
        if (message.deleted_at !== null || !stillEditable(message, now)) refuse(409, 'This message can no longer be edited');
        const body = typeof input.body === 'string' ? input.body.trim() : '';
        if (!body) refuse(400, 'Message body is required');
        if (body.length > MAX_BODY) refuse(400, 'That message is too long');
        await trx.updateTable('messages').set({ body, edited_at: now, updated_at: now }).where('id', '=', message.id).execute();
        return { messageId: message.id };
    });
}

/** Takes a message back: its author for a few minutes, a parent at any time. Its place in the thread stays. */
export async function removeMessage(db: AppDatabase, actor: MessagingActor, input: { messageId: string; reason?: string | null }, now: Date = new Date()): Promise<{ messageId: string }> {
    return db.transaction().execute(async (trx) => {
        const message = await messageOr404(trx, input?.messageId);
        if (message.author_id !== actor.id && !actor.isParent) refuse(403, 'You cannot remove this message');
        if (!actor.isParent && !stillEditable(message, now)) refuse(409, 'This message can no longer be removed');
        if (message.deleted_at !== null) return { messageId: message.id };
        const reason = oneLine(input.reason).slice(0, 200) || (actor.isParent ? 'Removed by parent' : 'Deleted by author');
        await trx.updateTable('messages').set({ body: '', deleted_at: now, removed_by: actor.id, removed_reason: reason, updated_at: now }).where('id', '=', message.id).execute();
        return { messageId: message.id };
    });
}

/** Gives a message an emoji, or takes back the one already given. */
export async function toggleReaction(db: AppDatabase, actor: MessagingActor, input: ToggleReactionRequest, now: Date = new Date()): Promise<{ active: boolean }> {
    return db.transaction().execute(async (trx) => {
        const message = await messageOr404(trx, input?.messageId);
        await mustBeIn(trx, message.thread_id, actor);
        const emoji = oneLine(input.emoji);
        if (!emoji || emoji.length > 32) refuse(400, 'Emoji is required');
        const mine = { message_id: message.id, family_member_id: actor.id, emoji };
        const taken = await trx.deleteFrom('message_reactions').where('message_id', '=', mine.message_id).where('family_member_id', '=', mine.family_member_id).where('emoji', '=', emoji).returning('emoji').executeTakeFirst();
        if (taken) return { active: false };
        await trx.insertInto('message_reactions').values({ ...mine, created_at: now }).execute();
        return { active: true };
    });
}

/** Records that someone has seen a message, or acknowledged one that asked to be. Once is enough. */
export async function acknowledgeMessage(db: AppDatabase, actor: MessagingActor, input: AcknowledgeMessageRequest, now: Date = new Date()): Promise<{ kind: 'seen' | 'acknowledged' }> {
    const kind = input?.kind;
    if (kind !== 'seen' && kind !== 'acknowledged') refuse(400, 'An acknowledgement says seen or acknowledged');
    return db.transaction().execute(async (trx) => {
        const message = await messageOr404(trx, input.messageId);
        await mustBeIn(trx, message.thread_id, actor);
        await trx
            .insertInto('message_acknowledgements')
            .values({ message_id: message.id, family_member_id: actor.id, kind, created_at: now })
            .onConflict((conflict) => conflict.columns(['message_id', 'family_member_id', 'kind']).doNothing())
            .execute();
        return { kind };
    });
}

// ---- How someone keeps a thread ----

/** Records how far someone has read, which also brings a thread they had put away back. */
export async function markThreadRead(db: AppDatabase, actor: MessagingActor, input: MarkReadRequest, now: Date = new Date()): Promise<{ threadId: string; lastReadAt: string; lastReadMessageId: string | null }> {
    return db.transaction().execute(async (trx) => {
        const thread = await threadOr404(trx, input?.threadId);
        await mustBeIn(trx, thread.id, actor);
        let lastRead: string | null = null;
        if (input.lastReadMessageId) {
            lastRead = idOr404(input.lastReadMessageId, 'That message is not in this thread');
            // A place in a thread is at one of its own messages.
            const inThread = await trx.selectFrom('messages').select('id').where('id', '=', lastRead).where('thread_id', '=', thread.id).executeTakeFirst();
            if (!inThread) refuse(404, 'That message is not in this thread');
        }
        await trx
            .updateTable('message_thread_members')
            .set({ is_archived: false, last_read_at: now, ...(lastRead ? { last_read_message_id: lastRead } : {}) })
            .where('thread_id', '=', thread.id)
            .where('family_member_id', '=', actor.id)
            .execute();
        return { threadId: thread.id, lastReadAt: now.toISOString(), lastReadMessageId: lastRead };
    });
}

/** Pins a thread, puts it away, or changes what it may interrupt someone for. Only what is given changes. */
export async function updateThreadPreferences(db: AppDatabase, actor: MessagingActor, input: ThreadPreferencesRequest, now: Date = new Date()): Promise<{ threadId: string }> {
    if (input?.notificationLevel != null && !MESSAGE_NOTIFICATION_LEVELS.includes(input.notificationLevel)) refuse(400, 'Unknown notification level');
    return db.transaction().execute(async (trx) => {
        const thread = await threadOr404(trx, input?.threadId);
        const membership = await mustBeIn(trx, thread.id, actor);
        const changes: { is_archived?: boolean; pinned_at?: Date | string | null; notification_level?: MessageNotificationLevel } = {};
        if (typeof input.isArchived === 'boolean') changes.is_archived = input.isArchived;
        // Pinned again, a thread keeps the time it was first pinned at, which is its place among the pinned.
        if (typeof input.isPinned === 'boolean') changes.pinned_at = input.isPinned ? (membership.pinned_at ?? now) : null;
        if (input.notificationLevel) changes.notification_level = input.notificationLevel;
        if (Object.keys(changes).length > 0) {
            await trx.updateTable('message_thread_members').set(changes).where('thread_id', '=', thread.id).where('family_member_id', '=', actor.id).execute();
        }
        return { threadId: thread.id };
    });
}

/** A parent looks in on a thread they are not part of. */
export async function watchThread(db: AppDatabase, actor: MessagingActor, input: { threadId: string }, now: Date = new Date()): Promise<{ threadId: string }> {
    if (!actor.isParent) refuse(403, 'Only parents can watch other threads');
    return db.transaction().execute(async (trx) => {
        const thread = await threadOr404(trx, input?.threadId);
        await trx
            .insertInto('message_thread_members')
            .values({ thread_id: thread.id, family_member_id: actor.id, member_role: 'watcher', notification_level: 'watch', joined_at: now })
            .onConflict((conflict) => conflict.columns(['thread_id', 'family_member_id']).doNothing())
            .execute();
        return { threadId: thread.id };
    });
}

/** A parent who was only looking in leaves; someone who belongs to the thread puts it away instead. */
export async function stopWatchingThread(db: AppDatabase, actor: MessagingActor, input: { threadId: string }): Promise<{ threadId: string }> {
    return db.transaction().execute(async (trx) => {
        const thread = await threadOr404(trx, input?.threadId);
        const membership = await membershipOf(trx, thread.id, actor.id);
        const mine = { thread: thread.id, member: actor.id };
        if (membership?.member_role === 'watcher') {
            await trx.deleteFrom('message_thread_members').where('thread_id', '=', mine.thread).where('family_member_id', '=', mine.member).execute();
        } else if (membership) {
            await trx.updateTable('message_thread_members').set({ is_archived: true }).where('thread_id', '=', mine.thread).where('family_member_id', '=', mine.member).execute();
        }
        return { threadId: thread.id };
    });
}

// ---- Where to send a notification ----

/** Records a phone that may be notified for someone. A phone belongs to whoever last signed in on it. */
export async function registerPushDevice(db: AppDatabase, actor: MessagingActor, input: { token?: unknown; platform?: unknown; isEnabled?: unknown }, now: Date = new Date()): Promise<{ token: string; platform: string; isEnabled: boolean }> {
    const token = typeof input?.token === 'string' ? input.token.trim() : '';
    const platform = typeof input?.platform === 'string' ? input.platform.trim() : '';
    if (!token || token.length > 4096 || !platform || platform.length > 40) refuse(400, 'A push device needs a token and a platform');
    const isEnabled = input.isEnabled !== false;
    await db
        .insertInto('push_devices')
        .values({ id: randomUUID(), family_member_id: actor.id, token, platform, is_enabled: isEnabled, last_seen_at: now })
        .onConflict((conflict) => conflict.column('token').doUpdateSet({ family_member_id: actor.id, platform, is_enabled: isEnabled, last_seen_at: now }))
        .execute();
    return { token, platform, isEnabled };
}
