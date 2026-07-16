'use server';

import { S3Client, DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { randomUUID, createHash } from 'crypto';
import { DEVICE_AUTH_COOKIE_NAME } from '@/lib/device-auth';
import { finalizeUploadedAttachment, type AttachmentFinalizeInput } from '@/lib/attachment-finalizer';
import { getInstantAdminDb, hashPinServer } from '@/lib/instant-admin';
import { requireFamilyMemberToken } from '@/lib/request-family-member';
import {
    planTaskUploadOrphanSweep,
    TASK_UPLOAD_OBJECT_PREFIXES,
    TASK_UPLOAD_SWEEP_GRACE_PERIOD_HOURS,
    type TaskUploadObject,
} from '@/lib/task-attachment-orphan-sweep';

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const AVATAR_SIZES = ['64', '320', '1200'] as const;
type AvatarSize = (typeof AVATAR_SIZES)[number];

type AvatarUploadScope = 'profile-photo' | 'family-photo';
export type ManagedUploadScope = 'general' | 'task-attachment' | 'task-update' | 'task-response';
const MANAGED_UPLOAD_SCOPES = new Set<ManagedUploadScope>(['general', 'task-attachment', 'task-update', 'task-response']);

function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not configured`);
    }
    return value;
}

async function requireDeviceAuth() {
    const cookieStore = await cookies();
    const cookieValue = cookieStore.get(DEVICE_AUTH_COOKIE_NAME)?.value;
    const secretKey = process.env.DEVICE_ACCESS_KEY;
    if (!secretKey || !cookieValue) {
        throw new Error('Unauthorized device');
    }
    const expectedToken = createHash('sha256').update(secretKey).digest('hex');
    if (cookieValue !== expectedToken) {
        throw new Error('Unauthorized device');
    }
}

async function requireActionFamilyMember(
    instantAuthToken: string | null | undefined,
    options?: { requireParent?: boolean }
) {
    await requireDeviceAuth();
    const context = await requireFamilyMemberToken(instantAuthToken, options);
    if ('error' in context) {
        throw new Error(context.error);
    }
    return context;
}

function getS3Clients() {
    const s3Endpoint = getRequiredEnv('S3_ENDPOINT');
    const publicEndpoint = getRequiredEnv('NEXT_PUBLIC_S3_ENDPOINT');
    const accessKeyId = getRequiredEnv('S3_ACCESS_KEY_ID');
    const secretAccessKey = getRequiredEnv('S3_SECRET_ACCESS_KEY');
    const bucketName = getRequiredEnv('S3_BUCKET_NAME');

    const s3Internal = new S3Client({
        region: 'us-east-1',
        endpoint: s3Endpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
    });

    const s3Signer = new S3Client({
        region: 'us-east-1',
        endpoint: publicEndpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
    });

    return { s3Internal, s3Signer, bucketName };
}

function sanitizePathSegment(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

function sanitizeUploadFileName(value: string): string {
    const baseName = value.split(/[\\/]/).pop()?.trim() || '';
    return baseName
        .normalize('NFKC')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/[^a-zA-Z0-9._ -]+/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^\.+/, '')
        .slice(0, 180);
}

function isAllowedUploadContentType(contentType: string): boolean {
    if (
        contentType.startsWith('image/')
        || contentType.startsWith('video/')
        || contentType.startsWith('audio/')
    ) {
        return contentType !== 'image/svg+xml';
    }

    return new Set([
        'application/epub+zip',
        'application/json',
        'application/msword',
        'application/octet-stream',
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/zip',
        'text/csv',
        'text/plain',
    ]).has(contentType);
}

async function createPresignedPostForKey(input: { key: string; contentType: string }) {
    const contentType = input.contentType.trim();
    if (!contentType || contentType.length > 255) {
        throw new Error('Invalid content type');
    }

    const { s3Signer, bucketName } = getS3Clients();
    const { url, fields } = await createPresignedPost(s3Signer, {
        Bucket: bucketName,
        Key: input.key,
        Conditions: [
            ['content-length-range', 0, MAX_UPLOAD_SIZE_BYTES],
            ['eq', '$Content-Type', contentType],
        ],
        Fields: { 'Content-Type': contentType },
        Expires: 600,
    });

    return { url, fields, key: input.key };
}

export interface S3File {
    key: string;
    lastModified: Date;
    size: number;
}

export interface TaskUploadSweepResult {
    gracePeriodHours: number;
    managedObjects: number;
    managedBytes: number;
    referencedObjects: number;
    referencedBytes: number;
    graceProtectedObjects: number;
    graceProtectedBytes: number;
    orphanedObjects: number;
    orphanedBytes: number;
    deletedObjects: number;
    deletedBytes: number;
}

async function listTaskUploadObjects(s3Internal: S3Client, bucketName: string): Promise<TaskUploadObject[]> {
    const objects: TaskUploadObject[] = [];

    for (const prefix of TASK_UPLOAD_OBJECT_PREFIXES) {
        let continuationToken: string | undefined;
        const seenTokens = new Set<string>();

        do {
            const page = await s3Internal.send(
                new ListObjectsV2Command({
                    Bucket: bucketName,
                    Prefix: prefix,
                    ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
                })
            );

            for (const object of page.Contents || []) {
                if (!object.Key) continue;
                objects.push({
                    key: object.Key,
                    lastModified: object.LastModified,
                    size: object.Size || 0,
                });
            }

            if (!page.IsTruncated) break;
            const nextToken = page.NextContinuationToken;
            if (!nextToken || seenTokens.has(nextToken)) {
                throw new Error(`Could not finish listing task uploads under ${prefix}`);
            }
            seenTokens.add(nextToken);
            continuationToken = nextToken;
        } while (continuationToken);
    }

    return objects;
}

async function queryTaskUploadReferences(): Promise<unknown[]> {
    const adminDb = getInstantAdminDb();
    const result = await adminDb.query({
        historyEventAttachments: {},
        taskAttachments: {},
        taskUpdateAttachments: {},
        taskResponseFieldValues: {},
    });

    const historyAttachments = (result.historyEventAttachments || []) as Array<{ url?: unknown; thumbnailUrl?: unknown }>;
    const taskAttachments = (result.taskAttachments || []) as Array<{ url?: unknown; thumbnailUrl?: unknown }>;
    const taskUpdateAttachments = (result.taskUpdateAttachments || []) as Array<{ url?: unknown; thumbnailUrl?: unknown }>;
    const responseValues = (result.taskResponseFieldValues || []) as Array<{ fileUrl?: unknown; thumbnailUrl?: unknown }>;

    return [
        ...historyAttachments.flatMap((attachment) => [attachment.url, attachment.thumbnailUrl]),
        ...taskAttachments.flatMap((attachment) => [attachment.url, attachment.thumbnailUrl]),
        ...taskUpdateAttachments.flatMap((attachment) => [attachment.url, attachment.thumbnailUrl]),
        ...responseValues.flatMap((value) => [value.fileUrl, value.thumbnailUrl]),
    ];
}

async function deleteS3ObjectsWithClient(s3Internal: S3Client, bucketName: string, keys: string[]) {
    let deleted = 0;
    for (let start = 0; start < keys.length; start += 1000) {
        const chunk = keys.slice(start, start + 1000);
        await s3Internal.send(
            new DeleteObjectsCommand({
                Bucket: bucketName,
                Delete: {
                    Objects: chunk.map((Key) => ({ Key })),
                    Quiet: true,
                },
            })
        );
        deleted += chunk.length;
    }
    return deleted;
}

// 1. Get List of Files (SIMPLIFIED)
export async function getFiles(instantAuthToken: string): Promise<S3File[]> {
    await requireActionFamilyMember(instantAuthToken, { requireParent: true });

    try {
        const { s3Internal, bucketName } = getS3Clients();
        // Use s3Internal because this happens strictly on the server
        const { Contents } = await s3Internal.send(
            new ListObjectsV2Command({
                Bucket: bucketName,
            })
        );

        if (!Contents) return [];

        // No signing needed! We just return the metadata.
        // The frontend will construct the URL itself.
        return Contents.map((file) => ({
            key: file.Key!,
            lastModified: file.LastModified!,
            size: file.Size!,
        }));
    } catch (error) {
        console.error('Error fetching files:', error);
        return [];
    }
}

// 2. Generate Upload Signature (UNCHANGED)
// We still want direct uploads for performance.
export async function getPresignedUploadUrl(
    contentType: string,
    fileName: string,
    instantAuthToken: string,
    scope: ManagedUploadScope = 'general'
) {
    await requireActionFamilyMember(instantAuthToken);

    const normalizedContentType = contentType.trim().toLowerCase();
    if (!normalizedContentType || normalizedContentType.length > 255 || !isAllowedUploadContentType(normalizedContentType)) {
        throw new Error('Invalid content type');
    }
    if (!fileName || fileName.length > 255) {
        throw new Error('Invalid file name');
    }
    if (!MANAGED_UPLOAD_SCOPES.has(scope)) {
        throw new Error('Invalid upload scope');
    }

    const sanitizedFileName = sanitizeUploadFileName(fileName);
    if (!sanitizedFileName) {
        throw new Error('Invalid file name');
    }
    const fileKey = `${randomUUID()}-${sanitizedFileName}`;
    const Key = scope === 'general' ? fileKey : `${scope}/${fileKey}`;

    try {
        const { s3Signer, bucketName } = getS3Clients();
        // Use s3Signer so the URL points to the public endpoint, not the internal one
        const { url, fields } = await createPresignedPost(s3Signer, {
            Bucket: bucketName,
            Key,
            Conditions: [
                ['content-length-range', 0, MAX_UPLOAD_SIZE_BYTES],
                ['eq', '$Content-Type', normalizedContentType],
            ],
            Fields: { 'Content-Type': normalizedContentType },
            Expires: 600,
        });

        return { url, fields, key: Key };
    } catch (error) {
        console.error('Error creating presigned URL:', error);
        throw new Error('Failed to generate upload signature');
    }
}

export async function finalizeUploadedAttachmentAction(input: AttachmentFinalizeInput, instantAuthToken: string) {
    await requireActionFamilyMember(instantAuthToken);
    return finalizeUploadedAttachment(input);
}

export async function getAvatarVariantUploadUrls(
    input: { scope: AvatarUploadScope; memberId?: string | null },
    instantAuthToken: string
) {
    await requireActionFamilyMember(instantAuthToken, { requireParent: true });

    const scope = input.scope;
    if (scope !== 'profile-photo' && scope !== 'family-photo') {
        throw new Error('Invalid scope');
    }

    const version = randomUUID();
    const basePath =
        scope === 'profile-photo'
            ? (() => {
                  const normalizedMemberId = sanitizePathSegment(input.memberId || '');
                  if (!normalizedMemberId) {
                      throw new Error('Invalid member id');
                  }
                  return `profile-photo/member-${normalizedMemberId}/${version}`;
              })()
            : `family-photo/all/${version}`;

    const uploads = await Promise.all(
        AVATAR_SIZES.map(async (size) => {
            const presigned = await createPresignedPostForKey({
                key: `${basePath}/${size}.png`,
                contentType: 'image/png',
            });
            return {
                size,
                url: presigned.url,
                fields: presigned.fields,
                key: presigned.key,
            };
        })
    );

    const photoUrls = uploads.reduce<Record<AvatarSize, string>>(
        (acc, upload) => {
            acc[upload.size] = upload.key;
            return acc;
        },
        {
            '64': '',
            '320': '',
            '1200': '',
        }
    );

    return { uploads, photoUrls };
}

export async function deleteS3Objects(keys: string[], instantAuthToken: string) {
    await requireActionFamilyMember(instantAuthToken, { requireParent: true });

    const uniqueKeys = Array.from(
        new Set(
            (Array.isArray(keys) ? keys : [])
                .map((key) => (typeof key === 'string' ? key.trim() : ''))
                .filter((key) => key.length > 0 && key.length <= 1024)
        )
    );

    if (uniqueKeys.length === 0) {
        return { deleted: 0 };
    }

    const { s3Internal, bucketName } = getS3Clients();
    try {
        const deleted = await deleteS3ObjectsWithClient(s3Internal, bucketName, uniqueKeys);
        return { deleted };
    } catch (error) {
        console.error('Error deleting S3 objects:', error);
        throw new Error('Failed to delete files');
    }
}

export async function sweepOrphanedTaskUploads(
    input: { execute?: boolean },
    instantAuthToken: string
): Promise<TaskUploadSweepResult> {
    await requireActionFamilyMember(instantAuthToken, { requireParent: true });

    const execute = input?.execute === true;
    const { s3Internal, bucketName } = getS3Clients();
    const objects = await listTaskUploadObjects(s3Internal, bucketName);
    let references = await queryTaskUploadReferences();
    let plan = planTaskUploadOrphanSweep({ objects, referencedValues: references });

    // An execute request always performs a fresh scan. Re-read Instant once more
    // immediately before deletion so a reference added during the S3 listing is
    // protected too; the 24-hour object grace period protects uploads in flight.
    if (execute && plan.orphanedObjects.length > 0) {
        references = await queryTaskUploadReferences();
        plan = planTaskUploadOrphanSweep({ objects, referencedValues: references });
    }

    const deletedObjects = execute
        ? await deleteS3ObjectsWithClient(
              s3Internal,
              bucketName,
              plan.orphanedObjects.map((object) => object.key)
          )
        : 0;

    if (deletedObjects > 0) {
        revalidatePath('/files');
    }

    return {
        gracePeriodHours: TASK_UPLOAD_SWEEP_GRACE_PERIOD_HOURS,
        managedObjects: plan.managedObjects,
        managedBytes: plan.managedBytes,
        referencedObjects: plan.referencedObjects,
        referencedBytes: plan.referencedBytes,
        graceProtectedObjects: plan.graceProtectedObjects,
        graceProtectedBytes: plan.graceProtectedBytes,
        orphanedObjects: plan.orphanedObjects.length,
        orphanedBytes: plan.orphanedBytes,
        deletedObjects,
        deletedBytes: deletedObjects > 0 ? plan.orphanedBytes : 0,
    };
}

export async function refreshFiles(instantAuthToken: string) {
    await requireActionFamilyMember(instantAuthToken, { requireParent: true });
    revalidatePath('/files');
}

// 3. Auth Helper (Server Side)
// Replaces client-side crypto.subtle to allow login over HTTP (non-secure context)
export async function hashPin(pin: string, instantAuthToken: string): Promise<string> {
    await requireActionFamilyMember(instantAuthToken, { requireParent: true });
    return hashPinServer(pin);
}
