import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Initialize Client
const s3 = new S3Client({
    region: 'us-east-1',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
});

export async function GET(request: NextRequest, { params }: { params: { filename: string } }) {
    // 1. SECURITY CHECK (Placeholder)
    // In a real app, check your session cookie here:
    // const session = cookies().get('session_id');
    // if (!session) return new NextResponse('Unauthorized', { status: 401 });

    const filename = params.filename;

    try {
        const command = new GetObjectCommand({
            Bucket: process.env.S3_BUCKET_NAME,
            Key: filename,
        });

        // 2. GENERATE TEMPORARY PASS
        // Valid for only 60 seconds because the browser uses it immediately.
        const signedUrl = await getSignedUrl(s3, command, { expiresIn: 60 });

        // 3. REDIRECT
        // 307 = Temporary Redirect (forces browser to fetch new link every time)
        return NextResponse.redirect(signedUrl, { status: 307 });
    } catch (error) {
        console.error('Error generating redirect:', error);
        return new NextResponse('File not found', { status: 404 });
    }
}
