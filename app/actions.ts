'use server';

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { randomUUID, createHash } from 'crypto';
import { DEVICE_AUTH_COOKIE_NAME, hasValidDeviceAuthCookie } from '@/lib/device-auth';

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
    if (!hasValidDeviceAuthCookie(cookieValue)) {
        throw new Error('Unauthorized device');
    }
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

export interface S3File {
    key: string;
    lastModified: Date;
    size: number;
}

// 1. Get List of Files (SIMPLIFIED)
export async function getFiles(): Promise<S3File[]> {
    await requireDeviceAuth();

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
export async function getPresignedUploadUrl(contentType: string, fileName: string) {
    await requireDeviceAuth();

    if (!contentType || contentType.length > 255) {
        throw new Error('Invalid content type');
    }
    if (!fileName || fileName.length > 255) {
        throw new Error('Invalid file name');
    }

    const Key = `${randomUUID()}-${fileName}`;

    try {
        const { s3Signer, bucketName } = getS3Clients();
        // Use s3Signer so the URL points to the public endpoint, not the internal one
        const { url, fields } = await createPresignedPost(s3Signer, {
            Bucket: bucketName,
            Key,
            Conditions: [
                ['content-length-range', 0, 10485760], // Max 10MB
                ['starts-with', '$Content-Type', contentType],
            ],
            Fields: { 'Content-Type': contentType },
            Expires: 600,
        });

        return { url, fields, key: Key };
    } catch (error) {
        console.error('Error creating presigned URL:', error);
        throw new Error('Failed to generate upload signature');
    }
}

export async function refreshFiles() {
    await requireDeviceAuth();
    revalidatePath('/');
}

// 3. Auth Helper (Server Side)
// Replaces client-side crypto.subtle to allow login over HTTP (non-secure context)
export async function hashPin(pin: string): Promise<string> {
    await requireDeviceAuth();
    return createHash('sha256').update(pin).digest('hex');
}
