import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// 1. PUBLIC ENDPOINT: This is what the BROWSER uses to reach MinIO.
// We force this for signing so the signature matches the browser's request.
const PUBLIC_ENDPOINT = process.env.NEXT_PUBLIC_S3_ENDPOINT || 'http://localhost:9000';

// Initialize a specific client just for signing URLs
const s3Signer = new S3Client({
    region: 'us-east-1',
    endpoint: PUBLIC_ENDPOINT, // <--- Key Fix: Sign for localhost, not minio
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
});

// Update the type definition for the second argument
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> } // Type as Promise
) {
    // 1. AWAIT the params (Fix for Next.js 15+)
    const { filename } = await params;

    // Safety check
    if (!filename) {
        return new NextResponse('Filename missing', { status: 400 });
    }

    try {
        const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: filename,
        });

        // Generate the URL using the signer client (pointing to localhost)
        const signedUrl = await getSignedUrl(s3Signer, command, { expiresIn: 3600 });

        // 307 Redirect: Browser goes directly to MinIO (localhost:9000)
        return NextResponse.redirect(signedUrl, { status: 307 });
    } catch (error) {
        console.error('Error generating redirect:', error);
        return new NextResponse('File not found', { status: 404 });
    }
}
