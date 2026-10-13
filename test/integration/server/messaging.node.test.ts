import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '@family-organizer/data';
import { POST as postBootstrap } from '@/app/api/messages/bootstrap/route';
import { POST as postMessage } from '@/app/api/messages/messages/route';
import { POST as postReaction } from '@/app/api/messages/messages/[messageId]/reactions/route';
import { GET as getServerTime } from '@/app/api/messages/server-time/route';
import { DELETE as stopWatching, POST as startWatching } from '@/app/api/messages/threads/[threadId]/watch/route';
import { MessageServiceError } from '@/lib/message-errors';
import * as messaging from '@/lib/server/messaging';
import { createSession } from '@/lib/server/sessions';
import { DANA, deviceRequest, ELI, FAY, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// Messages on Postgres: everything said and every change to a thread is asked of the server, and what must be
// so — one thread for two people, a person in a thread once, a message sent once — the database keeps.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const GUS = id(4);
const NOON = new Date('2026-03-09T12:00:00.000Z');
const minutesLater = (minutes: number) => new Date(NOON.getTime() + minutes * 60_000);

let database: TestDatabase;
let dana: messaging.MessagingActor;
let eli: messaging.MessagingActor;
let fay: messaging.MessagingActor;
let family: string;
let parents: string;

beforeEach(async () => {
    database = await createTestDatabase();
    await seedFamily(database);
    ({ familyThreadId: family, parentsOnlyThreadId: parents } = await messaging.ensureStandingThreads(database.db));
    // One at a time: the in-process Postgres is a single connection.
    dana = await messaging.messagingActor(database.db, { type: 'parent', familyMemberId: DANA });
    eli = await messaging.messagingActor(database.db, { type: 'kid', familyMemberId: ELI });
    fay = await messaging.messagingActor(database.db, { type: 'kid', familyMemberId: FAY });
});
afterEach(() => database.close());

const rows = async <T = Record<string, any>>(text: string, params: unknown[] = []) => (await database.sql.query<T>(text, params as any[])).rows;
const peopleIn = async (threadId: string) => (await rows(`SELECT m.name FROM message_thread_members t JOIN family_members m ON m.id = t.family_member_id WHERE t.thread_id = $1 ORDER BY m.sort_order`, [threadId])).map((row) => row.name);
const say = (who: messaging.MessagingActor, threadId: string, body: string, more: Record<string, unknown> = {}, at = NOON) => messaging.sendMessage(database.db, who, { threadId, body, ...more }, at);

/** Expects to be turned down with a status, and returns what was said. */
async function refused(promise: Promise<unknown>, status: number): Promise<string> {
    const error = await promise.then(
        () => null,
        (thrown) => thrown
    );
    expect(error).toBeInstanceOf(MessageServiceError);
    expect((error as MessageServiceError).status).toBe(status);
    return (error as MessageServiceError).message;
}

describe('the two threads every family has', () => {
    it('are made once, with everyone in one and the parents in the other', async () => {
        expect(await messaging.ensureStandingThreads(database.db)).toEqual({ familyThreadId: messaging.FAMILY_THREAD_ID, parentsOnlyThreadId: messaging.PARENTS_THREAD_ID });
        expect(await rows(`SELECT thread_key, title, visibility, created_by FROM message_threads ORDER BY thread_key`)).toEqual([
            { thread_key: 'family', title: 'Family', visibility: 'family', created_by: DANA },
            { thread_key: 'parents_only', title: 'Parents', visibility: 'parents_only', created_by: DANA },
        ]);
        expect([await peopleIn(family), await peopleIn(parents)]).toEqual([['Dana', 'Eli', 'Fay'], ['Dana']]);
    });

    it('take in whoever joins the family, as they join, and follow a change of role', async () => {
        await database.sql.query(`INSERT INTO family_members (id, name, role, sort_order) VALUES ($1, 'Gus', 'parent', 3)`, [GUS]);
        expect([await peopleIn(family), await peopleIn(parents)]).toEqual([['Dana', 'Eli', 'Fay', 'Gus'], ['Dana', 'Gus']]);

        // Gus had been looking in on a thread of the kids'. No longer a parent, he is out of it and of the parents' thread.
        const { threadId } = await messaging.createThread(database.db, eli, { threadType: 'direct', participantIds: [FAY] });
        await messaging.watchThread(database.db, { id: GUS, name: 'Gus', isParent: true }, { threadId });
        await database.sql.query(`UPDATE family_members SET role = 'child' WHERE id = $1`, [GUS]);
        expect([await peopleIn(family), await peopleIn(parents), await peopleIn(threadId)]).toEqual([['Dana', 'Eli', 'Fay', 'Gus'], ['Dana'], ['Eli', 'Fay']]);

        await database.sql.query(`UPDATE family_members SET role = 'parent' WHERE id = $1`, [ELI]);
        expect(await peopleIn(parents)).toEqual(['Dana', 'Eli']);
    });

    it('are kept under the ids a family brought with it', async () => {
        await database.sql.exec(`DELETE FROM message_threads; INSERT INTO message_threads (id, thread_type, visibility, thread_key, title) VALUES ('${id(77)}', 'family', 'family', 'family', 'Family')`);

        expect((await messaging.ensureStandingThreads(database.db)).familyThreadId).toBe(id(77));
        expect(await messaging.createThread(database.db, eli, { threadType: 'family' })).toEqual({ threadId: id(77), created: false });
        expect(await peopleIn(id(77))).toEqual(['Dana', 'Eli', 'Fay']);
    });
});

describe('opening a conversation', () => {
    it('gives two people one thread between them, whoever asks and however often', async () => {
        const first = await messaging.createThread(database.db, eli, { threadType: 'direct', participantIds: [FAY] });
        const again = await messaging.createThread(database.db, fay, { threadType: 'direct', participantIds: [ELI, FAY] });

        expect(first.created).toBe(true);
        expect(again).toEqual({ threadId: first.threadId, created: false });
        expect(await rows(`SELECT thread_key, title, visibility, created_by FROM message_threads WHERE id = $1`, [first.threadId])).toEqual([
            { thread_key: `direct:${ELI}:${FAY}`, title: 'Eli & Fay', visibility: 'members', created_by: ELI },
        ]);
        expect(await peopleIn(first.threadId)).toEqual(['Eli', 'Fay']);
    });

    it('makes a group with whoever was named, the one who made it its owner', async () => {
        const { threadId } = await messaging.createThread(database.db, dana, { threadType: 'group', participantIds: [ELI, FAY, id(999), 'nobody'], title: '  Camping   trip ' });

        expect(await rows(`SELECT title, thread_type FROM message_threads WHERE id = $1`, [threadId])).toEqual([{ title: 'Camping trip', thread_type: 'group' }]);
        expect(await rows(`SELECT family_member_id, member_role FROM message_thread_members WHERE thread_id = $1 ORDER BY 1`, [threadId])).toEqual([
            { family_member_id: DANA, member_role: 'owner' },
            { family_member_id: ELI, member_role: 'member' },
            { family_member_id: FAY, member_role: 'member' },
        ]);
    });

    it('gives a chore one discussion, with the parents if nobody else was named', async () => {
        const about = { threadType: 'linked' as const, linkedDomain: 'chores' as const, linkedEntityId: id(10) };
        const first = await messaging.createThread(database.db, eli, about);

        expect(await messaging.createThread(database.db, fay, about)).toEqual({ threadId: first.threadId, created: false });
        expect(await rows(`SELECT thread_key, title, linked_domain, linked_entity_id FROM message_threads WHERE id = $1`, [first.threadId])).toEqual([
            { thread_key: `linked:chores:${id(10)}`, title: 'Discussion', linked_domain: 'chores', linked_entity_id: id(10) },
        ]);
        expect(await peopleIn(first.threadId)).toEqual(['Dana', 'Eli']);
    });

    it('is refused when it is not a conversation anyone could have', async () => {
        expect(await refused(messaging.createThread(database.db, eli, { threadType: 'parents_only' }), 403)).toBe('Only parents can create or open parent-only threads');
        expect(await refused(messaging.createThread(database.db, eli, { threadType: 'direct', participantIds: [] }), 400)).toBe('Direct messages require exactly two participants');
        expect(await refused(messaging.createThread(database.db, eli, { threadType: 'direct', participantIds: [FAY, DANA] }), 400)).toBe('Direct messages require exactly two participants');
        expect(await refused(messaging.createThread(database.db, eli, { threadType: 'group', participantIds: [] }), 400)).toBe('Group conversations require at least two participants');
        await refused(messaging.createThread(database.db, eli, { threadType: 'linked', linkedDomain: 'gossip' as any, linkedEntityId: id(10) }), 400);
        await refused(messaging.createThread(database.db, eli, { threadType: 'whisper' as any }), 400);
        expect(await messaging.createThread(database.db, dana, { threadType: 'parents_only' })).toEqual({ threadId: parents, created: false });
    });
});

describe('saying something', () => {
    it('writes the message and what its thread now shows, at the server\'s time', async () => {
        const sent = await say(eli, family, '  Dinner   at six?  ', { clientTimestamp: '2031-01-01T00:00:00.000Z' });

        expect(sent).toMatchObject({ threadId: family, createdAt: NOON.toISOString(), alreadySent: false });
        expect(await rows(`SELECT thread_id, author_id, body, importance, is_system, created_at, editable_until, deleted_at FROM messages`)).toEqual([
            { thread_id: family, author_id: ELI, body: 'Dinner   at six?', importance: 'normal', is_system: false, created_at: NOON.toISOString(), editable_until: minutesLater(5).toISOString(), deleted_at: null },
        ]);
        expect(await rows(`SELECT latest_message_at, latest_message_author_id, latest_message_preview FROM message_threads WHERE id = $1`, [family])).toEqual([
            { latest_message_at: NOON.toISOString(), latest_message_author_id: ELI, latest_message_preview: 'Dinner at six?' },
        ]);
    });

    it('sends a message once, however many times its request arrives', async () => {
        const first = await say(eli, family, 'On my way', { clientNonce: 'eli-0001' });
        const again = await say(eli, family, 'On my way', { clientNonce: 'eli-0001' }, minutesLater(1));

        expect(again).toEqual({ ...first, alreadySent: true });
        expect(await rows(`SELECT count(*)::integer AS n FROM messages`)).toEqual([{ n: 1 }]);
        expect(await rows(`SELECT latest_message_at FROM message_threads WHERE id = $1`, [family])).toEqual([{ latest_message_at: NOON.toISOString() }]);
        // The same word from someone else, or in another thread, is another message.
        expect((await say(fay, family, 'Me too', { clientNonce: 'eli-0001' })).alreadySent).toBe(false);
    });

    it('carries files, and answers a message of its own thread', async () => {
        const first = await say(dana, family, 'Menu for tonight');
        const photo = { id: id(430), name: 'menu.jpg', type: 'image/jpeg', url: 'messages/menu.jpg', kind: 'image', sizeBytes: 1024, width: 200, height: 100.4, waveformPeaks: null };
        const reply = await say(eli, family, '', { attachments: [photo], replyToMessageId: first.messageId }, minutesLater(1));

        expect(await rows(`SELECT message_id, name, url, size_bytes, width, height FROM message_attachments`)).toEqual([{ message_id: reply.messageId, name: 'menu.jpg', url: 'messages/menu.jpg', size_bytes: 1024, width: 200, height: 100 }]);
        expect(await rows(`SELECT reply_to_id FROM messages WHERE id = $1`, [reply.messageId])).toEqual([{ reply_to_id: first.messageId }]);
        expect(await rows(`SELECT latest_message_preview FROM message_threads WHERE id = $1`, [family])).toEqual([{ latest_message_preview: 'Attachment: menu.jpg' }]);

        expect(await refused(say(fay, family, 'Mine', { attachments: [photo] }), 409)).toBe('One of those files has already been sent');
        const { threadId: other } = await messaging.createThread(database.db, eli, { threadType: 'direct', participantIds: [FAY] });
        await refused(say(eli, other, 'About that', { replyToMessageId: first.messageId }), 404);
    });

    it('records a parent\'s announcement to the family in its history', async () => {
        const sent = await say(dana, family, 'School is closed tomorrow', { importance: 'announcement' });

        expect(await rows(`SELECT domain, action_type, summary, actor_id, message_thread_id, message_id, metadata FROM history_events`)).toEqual([
            { domain: 'messages', action_type: 'message_announcement', summary: 'Dana posted an announcement in Family', actor_id: DANA, message_thread_id: family, message_id: sent.messageId, metadata: { importance: 'announcement', threadType: 'family' } },
        ]);
    });

    it('is refused from outside the thread, with nothing to say, or with an importance that is a parent\'s', async () => {
        expect(await refused(say(eli, parents, 'Hello?'), 403)).toBe('You are not a member of this thread');
        expect(await refused(say(eli, family, '   '), 400)).toBe('Message body or attachment is required');
        expect(await refused(say(eli, family, 'Listen up', { importance: 'announcement' }), 403)).toBe('Only parents can send announcements or acknowledgement requests');
        await refused(say(eli, family, 'Hm', { importance: 'shouting' }), 400);
        await refused(say(eli, family, 'Hm', { attachments: [{ id: 'not-an-id', name: 'x', type: 'y', url: 'z' }] }), 400);
        expect(await refused(say(eli, id(999), 'Anyone?'), 404)).toBe('Thread not found');
        expect(await refused(say(eli, 'not-an-id', 'Anyone?'), 404)).toBe('Thread not found');
        expect(await rows(`SELECT 1 FROM messages`)).toEqual([]);
    });
});

describe('a message, once sent', () => {
    it('can be reworded by its author for five minutes, and by nobody else', async () => {
        const { messageId } = await say(eli, family, 'Diner at six');

        await messaging.editMessage(database.db, eli, { messageId, body: ' Dinner at six ' }, minutesLater(4));
        expect(await rows(`SELECT body, edited_at FROM messages`)).toEqual([{ body: 'Dinner at six', edited_at: minutesLater(4).toISOString() }]);

        expect(await refused(messaging.editMessage(database.db, fay, { messageId, body: 'Never' }, minutesLater(4)), 403)).toBe('Only the author can edit this message');
        expect(await refused(messaging.editMessage(database.db, dana, { messageId, body: 'Never' }, minutesLater(4)), 403)).toBe('Only the author can edit this message');
        expect(await refused(messaging.editMessage(database.db, eli, { messageId, body: 'Too late' }, minutesLater(6)), 409)).toBe('This message can no longer be edited');
        await refused(messaging.editMessage(database.db, eli, { messageId, body: '  ' }, minutesLater(4)), 400);
        await refused(messaging.editMessage(database.db, eli, { messageId: id(999), body: 'What' }), 404);
    });

    it('can be taken back by its author for five minutes and by a parent at any time, and keeps its place', async () => {
        const mine = await say(eli, family, 'Oops');
        const late = await say(eli, family, 'Too late for me', {}, minutesLater(1));

        expect(await refused(messaging.removeMessage(database.db, fay, { messageId: mine.messageId }, minutesLater(2)), 403)).toBe('You cannot remove this message');
        await messaging.removeMessage(database.db, eli, { messageId: mine.messageId }, minutesLater(2));
        expect(await refused(messaging.removeMessage(database.db, eli, { messageId: late.messageId }, minutesLater(30)), 409)).toBe('This message can no longer be removed');
        await messaging.removeMessage(database.db, dana, { messageId: late.messageId, reason: 'Not kind' }, minutesLater(30));

        expect(await rows(`SELECT body, deleted_at, removed_by, removed_reason FROM messages ORDER BY created_at`)).toEqual([
            { body: '', deleted_at: minutesLater(2).toISOString(), removed_by: ELI, removed_reason: 'Deleted by author' },
            { body: '', deleted_at: minutesLater(30).toISOString(), removed_by: DANA, removed_reason: 'Not kind' },
        ]);
        expect(await refused(messaging.editMessage(database.db, eli, { messageId: mine.messageId, body: 'Back again' }, minutesLater(3)), 409)).toBe('This message can no longer be edited');
    });

    it('takes an emoji from each person once, and gives it back when asked again', async () => {
        const { messageId } = await say(dana, family, 'Pancakes on Saturday');

        expect(await messaging.toggleReaction(database.db, eli, { messageId, emoji: '🥞' })).toEqual({ active: true });
        expect(await messaging.toggleReaction(database.db, fay, { messageId, emoji: '🥞' })).toEqual({ active: true });
        expect(await messaging.toggleReaction(database.db, eli, { messageId, emoji: '👍' })).toEqual({ active: true });
        expect(await messaging.toggleReaction(database.db, eli, { messageId, emoji: '🥞' })).toEqual({ active: false });

        expect(await rows(`SELECT family_member_id, emoji FROM message_reactions ORDER BY 1, 2`)).toEqual([
            { family_member_id: ELI, emoji: '👍' },
            { family_member_id: FAY, emoji: '🥞' },
        ]);
        await refused(messaging.toggleReaction(database.db, eli, { messageId, emoji: ' ' }), 400);
    });

    it('is seen or acknowledged by each person once, and only from inside its thread', async () => {
        const { messageId } = await say(dana, family, 'Be home by five', { importance: 'needs_ack' });
        const inParents = await say(dana, parents, 'Between us');

        await messaging.acknowledgeMessage(database.db, eli, { messageId, kind: 'acknowledged' }, NOON);
        await messaging.acknowledgeMessage(database.db, eli, { messageId, kind: 'acknowledged' }, minutesLater(3));
        await messaging.acknowledgeMessage(database.db, eli, { messageId, kind: 'seen' }, NOON);

        expect(await rows(`SELECT family_member_id, kind, created_at FROM message_acknowledgements ORDER BY kind`)).toEqual([
            { family_member_id: ELI, kind: 'acknowledged', created_at: NOON.toISOString() },
            { family_member_id: ELI, kind: 'seen', created_at: NOON.toISOString() },
        ]);
        await refused(messaging.acknowledgeMessage(database.db, eli, { messageId, kind: 'ignored' as any }), 400);
        expect(await refused(messaging.acknowledgeMessage(database.db, eli, { messageId: inParents.messageId, kind: 'seen' }), 403)).toBe('You are not a member of this thread');
        expect(await refused(messaging.toggleReaction(database.db, eli, { messageId: inParents.messageId, emoji: '👀' }), 403)).toBe('You are not a member of this thread');
    });
});

describe('how someone keeps a thread', () => {
    const seat = async (threadId: string, memberId: string) => (await rows(`SELECT member_role, notification_level, is_archived, pinned_at, last_read_at, last_read_message_id FROM message_thread_members WHERE thread_id = $1 AND family_member_id = $2`, [threadId, memberId]))[0] ?? null;

    it('remembers how far they have read, at a message of that thread', async () => {
        const { messageId } = await say(dana, family, 'Good morning');
        const elsewhere = await say(dana, parents, 'Between us');
        await messaging.updateThreadPreferences(database.db, eli, { threadId: family, isArchived: true });

        expect(await messaging.markThreadRead(database.db, eli, { threadId: family, lastReadMessageId: messageId }, minutesLater(1))).toEqual({ threadId: family, lastReadAt: minutesLater(1).toISOString(), lastReadMessageId: messageId });
        expect(await seat(family, ELI)).toMatchObject({ is_archived: false, last_read_at: minutesLater(1).toISOString(), last_read_message_id: messageId });

        expect(await refused(messaging.markThreadRead(database.db, eli, { threadId: family, lastReadMessageId: elsewhere.messageId }), 404)).toBe('That message is not in this thread');
        expect(await refused(messaging.markThreadRead(database.db, eli, { threadId: parents, lastReadMessageId: elsewhere.messageId }), 403)).toBe('You are not a member of this thread');
        expect((await seat(family, ELI)).last_read_message_id).toBe(messageId);
    });

    it('pins it, puts it away and quiets it, changing only what was asked', async () => {
        await messaging.updateThreadPreferences(database.db, eli, { threadId: family, isPinned: true, notificationLevel: 'mentions' }, NOON);
        await messaging.updateThreadPreferences(database.db, eli, { threadId: family, isPinned: true, isArchived: true }, minutesLater(9));

        expect(await seat(family, ELI)).toMatchObject({ notification_level: 'mentions', is_archived: true, pinned_at: NOON.toISOString() });
        expect(await seat(family, FAY)).toMatchObject({ notification_level: 'all', is_archived: false, pinned_at: null });

        await messaging.updateThreadPreferences(database.db, eli, { threadId: family, isPinned: false });
        expect(await seat(family, ELI)).toMatchObject({ notification_level: 'mentions', is_archived: true, pinned_at: null });
        await refused(messaging.updateThreadPreferences(database.db, eli, { threadId: family, notificationLevel: 'sirens' as any }), 400);
        await refused(messaging.updateThreadPreferences(database.db, eli, { threadId: parents, isPinned: true }), 403);
    });

    it('lets a parent look in on a thread and leave again, and a member put theirs away', async () => {
        const { threadId } = await messaging.createThread(database.db, eli, { threadType: 'direct', participantIds: [FAY] });

        expect(await refused(messaging.watchThread(database.db, fay, { threadId: parents }), 403)).toBe('Only parents can watch other threads');
        await messaging.watchThread(database.db, dana, { threadId });
        await messaging.watchThread(database.db, dana, { threadId });
        expect(await seat(threadId, DANA)).toMatchObject({ member_role: 'watcher', notification_level: 'watch' });

        await messaging.stopWatchingThread(database.db, dana, { threadId });
        await messaging.stopWatchingThread(database.db, dana, { threadId });
        expect(await seat(threadId, DANA)).toBeNull();

        // Someone who belongs to the thread does not leave it by this door: it is put away.
        await messaging.stopWatchingThread(database.db, eli, { threadId });
        expect(await seat(threadId, ELI)).toMatchObject({ member_role: 'member', is_archived: true });
    });

    it('records the phone to notify, for whoever signed in on it last', async () => {
        expect(await messaging.registerPushDevice(database.db, eli, { token: ' abc123 ', platform: 'ios' })).toEqual({ token: 'abc123', platform: 'ios', isEnabled: true });
        await messaging.registerPushDevice(database.db, fay, { token: 'abc123', platform: 'ios', isEnabled: false }, minutesLater(5));

        expect(await rows(`SELECT family_member_id, platform, is_enabled, last_seen_at FROM push_devices`)).toEqual([{ family_member_id: FAY, platform: 'ios', is_enabled: false, last_seen_at: minutesLater(5).toISOString() }]);
        await refused(messaging.registerPushDevice(database.db, eli, { token: '', platform: 'ios' }), 400);
    });
});

describe('the routes', () => {
    const token = async (principal: Principal) => (await createSession(database.db, principal)).token;
    const withThread = (threadId: string) => ({ params: Promise.resolve({ threadId }) });

    it('serve a request made under the app\'s own session from Postgres, as that session\'s person', async () => {
        const eliToken = await token({ type: 'kid', familyMemberId: ELI });

        expect(await (await postBootstrap(deviceRequest('/api/messages/bootstrap', { sessionToken: eliToken, body: {} }))).json()).toEqual({ familyThreadId: family, parentsOnlyThreadId: parents });
        const sent = await postMessage(deviceRequest('/api/messages/messages', { sessionToken: eliToken, body: { threadId: family, body: 'Hello from the route' } }));
        expect(sent.status).toBe(200);
        const { messageId } = await sent.json();
        expect(await rows(`SELECT id, author_id, body FROM messages`)).toEqual([{ id: messageId, author_id: ELI, body: 'Hello from the route' }]);

        const reacted = await postReaction(deviceRequest(`/api/messages/messages/${messageId}/reactions`, { sessionToken: eliToken, body: { emoji: '👋' } }), { params: Promise.resolve({ messageId }) });
        expect(await reacted.json()).toEqual({ active: true });

        const time = await getServerTime(deviceRequest('/api/messages/server-time', { sessionToken: eliToken }));
        expect(Number.isNaN(Date.parse((await time.json()).serverNow))).toBe(false);
    });

    it('turn a refusal into its answer, and turn away nobody in particular, a kid at a parent\'s door, and everyone while writes are frozen', async () => {
        const eliToken = await token({ type: 'kid', familyMemberId: ELI });
        const danaToken = await token({ type: 'parent', familyMemberId: DANA });
        const sharedToken = await token({ type: 'kid', familyMemberId: null });

        const outside = await postMessage(deviceRequest('/api/messages/messages', { sessionToken: eliToken, body: { threadId: parents, body: 'Let me in' } }));
        expect([outside.status, await outside.json()]).toEqual([403, { error: 'You are not a member of this thread', code: 'message_refused' }]);
        const nobody = await postMessage(deviceRequest('/api/messages/messages', { sessionToken: sharedToken, body: { threadId: family, body: 'Who am I' } }));
        expect([nobody.status, (await nobody.json()).error]).toEqual([403, 'Sign in as yourself to use messages']);
        expect((await postMessage(deviceRequest('/api/messages/messages', { sessionToken: 'no-such-session', body: {} }))).status).toBe(401);

        const { threadId } = await messaging.createThread(database.db, eli, { threadType: 'direct', participantIds: [FAY] });
        expect((await startWatching(deviceRequest(`/api/messages/threads/${threadId}/watch`, { sessionToken: eliToken, body: {} }), withThread(threadId))).status).toBe(403);
        expect((await startWatching(deviceRequest(`/api/messages/threads/${threadId}/watch`, { sessionToken: danaToken, body: {} }), withThread(threadId))).status).toBe(200);
        expect(await peopleIn(threadId)).toEqual(['Dana', 'Eli', 'Fay']);
        expect((await stopWatching(deviceRequest(`/api/messages/threads/${threadId}/watch`, { sessionToken: danaToken, method: 'DELETE' }), withThread(threadId))).status).toBe(200);
        expect(await peopleIn(threadId)).toEqual(['Eli', 'Fay']);

        await database.sql.exec(`UPDATE installation SET writes_frozen = true`);
        const frozen = await postMessage(deviceRequest('/api/messages/messages', { sessionToken: eliToken, body: { threadId: family, body: 'Now?' } }));
        expect(frozen.status).toBe(503);
        expect(await rows(`SELECT 1 FROM messages`)).toEqual([]);
    });
});
