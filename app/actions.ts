'use server';

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

// --- CONFIGURATION ---

// 1. Internal Client (for Server-side operations like ListObjects)
// Uses the Docker network alias (http://minio:9000)
const s3Internal = new S3Client({
    region: 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
});

// 2. Signing Client (for Browser-facing URLs)
// Uses the Public Hostname (http://localhost:9000)
const PUBLIC_ENDPOINT = process.env.NEXT_PUBLIC_S3_ENDPOINT || 'http://localhost:9000';

const s3Signer = new S3Client({
    region: 'us-east-1',
    endpoint: PUBLIC_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME!;

export interface S3File {
    key: string;
    lastModified: Date;
    size: number;
}

// 1. Get List of Files (SIMPLIFIED)
export async function getFiles(): Promise<S3File[]> {
    try {
        // Use s3Internal because this happens strictly on the server
        const { Contents } = await s3Internal.send(
            new ListObjectsV2Command({
                Bucket: BUCKET_NAME,
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
    const Key = `${randomUUID()}-${fileName}`;

    try {
        // Use s3Signer so the URL points to localhost:9000, not minio:9000
        const { url, fields } = await createPresignedPost(s3Signer, {
            Bucket: BUCKET_NAME,
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
    revalidatePath('/');
}
