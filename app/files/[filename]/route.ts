import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { getDeviceAuthContextFromNextRequest } from '@/lib/device-auth-server';

function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not configured`);
    }
    return value;
}

function getSignerClient() {
    const endpoint = getRequiredEnv('NEXT_PUBLIC_S3_ENDPOINT');
    const accessKeyId = getRequiredEnv('S3_ACCESS_KEY_ID');
    const secretAccessKey = getRequiredEnv('S3_SECRET_ACCESS_KEY');

    return new S3Client({
        region: 'us-east-1',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
    });
}

// Update the type definition for the second argument
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ filename: string }> } // Type as Promise
) {
    const deviceAuth = getDeviceAuthContextFromNextRequest(request);
    if (!deviceAuth.authorized) {
        return new NextResponse('Unauthorized device', { status: 401 });
    }

    // 1. AWAIT the params (Fix for Next.js 15+)
    const { filename } = await params;

    // Safety check
    if (!filename) {
        return new NextResponse('Filename missing', { status: 400 });
    }

    try {
        const s3Signer = getSignerClient();
        const command = new GetObjectCommand({
            Bucket: getRequiredEnv('S3_BUCKET_NAME'),
            Key: filename,
        });

        // Generate the URL using the signer client (pointing to localhost)
        const signedUrl = await getSignedUrl(s3Signer, command, { expiresIn: 3600 });

        // 307 Redirect: Browser goes directly to MinIO (fam.yapnf.com:9000)
        return NextResponse.redirect(signedUrl, { status: 307 });
    } catch (error) {
        console.error('Error generating redirect:', error);
        return new NextResponse('File unavailable', { status: 404 });
    }
}
