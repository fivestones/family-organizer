import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Principal } from '@family-organizer/data';
import { createSession, drainSession } from '@/lib/server/sessions';
import { DANA, ELI, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// The file actions asked under one of the app's own sessions: who may ask is known from Postgres, and so is
// which files something still points at.

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), revalidatePath: vi.fn(), S3Client: vi.fn(), s3Send: vi.fn(), ListObjectsV2Command: vi.fn(), DeleteObjectsCommand: vi.fn(), requireFamilyMemberToken: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: mocks.cookies }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@aws-sdk/client-s3', () => ({ S3Client: mocks.S3Client, ListObjectsV2Command: mocks.ListObjectsV2Command, DeleteObjectsCommand: mocks.DeleteObjectsCommand }));
vi.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost: vi.fn() }));
vi.mock('@/lib/request-family-member', () => ({ requireFamilyMemberToken: mocks.requireFamilyMemberToken }));

// SHA-256('test-device-key')
const DEVICE_COOKIE = 'dbf8307f327810a7080ea7a691ee058251dbc4b4eb030adce9d1a880cb07fcd6';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OLD = new Date('2026-01-01T00:00:00Z');

let database: TestDatabase;
beforeEach(async () => {
    vi.clearAllMocks();
    Object.assign(process.env, { DEVICE_ACCESS_KEY: 'test-device-key', S3_ENDPOINT: 'https://internal-s3.example.test', NEXT_PUBLIC_S3_ENDPOINT: 'https://public-s3.example.test', S3_ACCESS_KEY_ID: 'akid', S3_SECRET_ACCESS_KEY: 'secret', S3_BUCKET_NAME: 'family-files' });
    mocks.cookies.mockResolvedValue({ get: () => ({ value: DEVICE_COOKIE }) });
    mocks.S3Client.mockImplementation(function MockS3Client(this: { send: unknown }) {
        this.send = mocks.s3Send;
    });
    mocks.ListObjectsV2Command.mockImplementation(function Command(this: { input: unknown }, input: unknown) {
        this.input = input;
    });
    mocks.DeleteObjectsCommand.mockImplementation(function Command(this: { input: unknown }, input: unknown) {
        this.input = input;
    });
    mocks.requireFamilyMemberToken.mockResolvedValue({ ok: false, status: 401, error: 'Family member auth required' });
    database = await createTestDatabase();
    await seedFamily(database);
});
afterEach(() => database.close());

const token = async (principal: Principal) => (await createSession(database.db, principal)).token;

describe('the file actions under a session', () => {
    it('are a parent\'s, known from Postgres without asking InstantDB', async () => {
        mocks.s3Send.mockResolvedValue({ Contents: [{ Key: 'a.png', LastModified: OLD, Size: 123 }] });
        const { getFiles } = await import('@/app/actions');

        expect((await getFiles(await token({ type: 'parent', familyMemberId: DANA }))).map((file) => file.key)).toEqual(['a.png']);
        expect(mocks.requireFamilyMemberToken).not.toHaveBeenCalled();

        await expect(getFiles(await token({ type: 'kid', familyMemberId: ELI }))).rejects.toThrow('Parent access required');
        await expect(getFiles(await token({ type: 'kid', familyMemberId: null }))).rejects.toThrow('not linked to a family member');
        const signedOut = await createSession(database.db, { type: 'parent', familyMemberId: DANA });
        await drainSession(database.db, signedOut.session.id);
        await expect(getFiles(signedOut.token)).rejects.toThrow('can only finish sending');

        // A token that is no session of ours is InstantDB's to judge.
        await expect(getFiles('an-instant-token')).rejects.toThrow('Family member auth required');
        expect(mocks.requireFamilyMemberToken).toHaveBeenCalledWith('an-instant-token', { requireParent: true });
    });

    it('sweep away only what nothing in Postgres points at', async () => {
        await database.sql.exec(`
            INSERT INTO task_series (id, name) VALUES ('${id(100)}', 'Reading');
            INSERT INTO tasks (id, task_series_id, title, sort_order) VALUES ('${id(101)}', '${id(100)}', 'Chapter one', 1);
            INSERT INTO task_attachments (id, task_id, name, type, url) VALUES ('${id(110)}', '${id(101)}', 'sheet.pdf', 'application/pdf', 'task-attachment/referenced.pdf');
            INSERT INTO task_updates (id, task_id, from_state, to_state, scheduled_for) VALUES ('${id(120)}', '${id(101)}', 'not_started', 'needs_review', '2026-03-09');
            INSERT INTO task_update_attachments (id, update_id, name, type, url, thumbnail_url) VALUES ('${id(121)}', '${id(120)}', 'photo.jpg', 'image/jpeg', '/files/task-update%2Freferenced.jpg', 'task-update/thumb.jpg');
            INSERT INTO task_response_fields (id, task_id, type, label) VALUES ('${id(130)}', '${id(101)}', 'file', 'Your work');
            INSERT INTO task_response_field_values (id, update_id, field_id, file_url) VALUES ('${id(131)}', '${id(120)}', '${id(130)}', 'task-response/answer.txt');
            INSERT INTO history_events (id, occurred_at, domain, action_type, summary) VALUES ('${id(140)}', now(), 'tasks', 'task_note', 'A note');
            INSERT INTO history_event_attachments (id, history_event_id, name, type, url) VALUES ('${id(141)}', '${id(140)}', 'note.txt', 'text/plain', 'task-response/history-only.txt');
        `);
        const held: Record<string, string[]> = {
            'task-attachment/': ['task-attachment/referenced.pdf', 'task-attachment/orphan.pdf'],
            'task-update/': ['task-update/referenced.jpg', 'task-update/thumb.jpg'],
            'task-response/': ['task-response/answer.txt', 'task-response/history-only.txt', 'task-response/orphan.txt'],
        };
        mocks.s3Send.mockImplementation(async (command: { input?: { Prefix?: string; Delete?: unknown } }) => {
            if (command.input?.Delete) return {};
            return { Contents: (held[command.input?.Prefix ?? ''] ?? []).map((Key) => ({ Key, LastModified: OLD, Size: 100 })) };
        });
        const { sweepOrphanedTaskUploads } = await import('@/app/actions');

        const result = await sweepOrphanedTaskUploads({ execute: true }, await token({ type: 'parent', familyMemberId: DANA }));

        expect(result).toMatchObject({ managedObjects: 7, referencedObjects: 5, orphanedObjects: 2, deletedObjects: 2 });
        expect(mocks.DeleteObjectsCommand).toHaveBeenCalledWith({ Bucket: 'family-files', Delete: { Objects: [{ Key: 'task-attachment/orphan.pdf' }, { Key: 'task-response/orphan.txt' }], Quiet: true } });
    });
});
