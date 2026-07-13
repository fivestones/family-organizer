import { beforeEach, describe, expect, it, vi } from 'vitest';

const actionMocks = vi.hoisted(() => ({
    cookies: vi.fn(),
    revalidatePath: vi.fn(),
    S3Client: vi.fn(),
    ListObjectsV2Command: vi.fn(),
    createPresignedPost: vi.fn(),
    requireFamilyMemberToken: vi.fn(),
}));

vi.mock('next/headers', () => ({
    cookies: actionMocks.cookies,
}));

vi.mock('next/cache', () => ({
    revalidatePath: actionMocks.revalidatePath,
}));

vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: actionMocks.S3Client,
    ListObjectsV2Command: actionMocks.ListObjectsV2Command,
}));

vi.mock('@aws-sdk/s3-presigned-post', () => ({
    createPresignedPost: actionMocks.createPresignedPost,
}));

vi.mock('@/lib/request-family-member', () => ({
    requireFamilyMemberToken: actionMocks.requireFamilyMemberToken,
}));

// SHA-256('test-device-key')
const EXPECTED_TOKEN = 'dbf8307f327810a7080ea7a691ee058251dbc4b4eb030adce9d1a880cb07fcd6';

describe('app/actions server auth + file actions', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();

        process.env.DEVICE_ACCESS_KEY = 'test-device-key';
        process.env.S3_ENDPOINT = 'https://internal-s3.example.test';
        process.env.NEXT_PUBLIC_S3_ENDPOINT = 'https://public-s3.example.test';
        process.env.S3_ACCESS_KEY_ID = 'akid';
        process.env.S3_SECRET_ACCESS_KEY = 'secret';
        process.env.S3_BUCKET_NAME = 'family-files';

        actionMocks.S3Client.mockImplementation(function MockS3Client() {
            (this as any).send = vi.fn().mockResolvedValue({
                Contents: [
                    { Key: 'a.png', LastModified: new Date('2025-01-01T00:00:00Z'), Size: 123 },
                    { Key: 'b.png', LastModified: new Date('2025-01-02T00:00:00Z'), Size: 456 },
                ],
            });
        });
        actionMocks.ListObjectsV2Command.mockImplementation(function MockListObjectsV2Command(input) {
            (this as any).input = input;
        });
        actionMocks.createPresignedPost.mockResolvedValue({
            url: 'https://public-s3.example.test/family-files',
            fields: { key: 'abc-file.png', policy: 'x' },
        });
        actionMocks.requireFamilyMemberToken.mockResolvedValue({
            ok: true,
            instantUser: { familyMemberId: 'parent-1' },
            familyMember: { id: 'parent-1', role: 'parent' },
        });
    });

    function setDeviceCookie(value: string | undefined) {
        actionMocks.cookies.mockResolvedValue({
            get: (name: string) => {
                if (name !== 'activation_token' || value === undefined) return undefined;
                return { name, value };
            },
        });
    }

    it('hashPin requires a valid device cookie', async () => {
        setDeviceCookie(undefined);
        const { hashPin } = await import('@/app/actions');

        await expect(hashPin('1234', 'parent-token')).rejects.toThrow('Unauthorized device');
    });

    it('hashPin returns sha256 when authorized', async () => {
        setDeviceCookie(EXPECTED_TOKEN);
        const { hashPin } = await import('@/app/actions');

        await expect(hashPin('1234', 'parent-token')).resolves.toBe('03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');
        expect(actionMocks.requireFamilyMemberToken).toHaveBeenCalledWith('parent-token', { requireParent: true });
    });

    it('getPresignedUploadUrl validates inputs before signing', async () => {
        setDeviceCookie(EXPECTED_TOKEN);
        const { getPresignedUploadUrl } = await import('@/app/actions');

        await expect(getPresignedUploadUrl('', 'photo.png', 'member-token')).rejects.toThrow('Invalid content type');
        await expect(getPresignedUploadUrl('image/png', '', 'member-token')).rejects.toThrow('Invalid file name');
        await expect(getPresignedUploadUrl('text/html', 'page.html', 'member-token')).rejects.toThrow('Invalid content type');
        expect(actionMocks.createPresignedPost).not.toHaveBeenCalled();
    });

    it('getPresignedUploadUrl requires device auth', async () => {
        setDeviceCookie(undefined);
        const { getPresignedUploadUrl } = await import('@/app/actions');

        await expect(getPresignedUploadUrl('image/png', 'photo.png', 'member-token')).rejects.toThrow('Unauthorized device');
    });

    it('getPresignedUploadUrl returns signed upload data for authorized devices', async () => {
        setDeviceCookie(EXPECTED_TOKEN);
        const { getPresignedUploadUrl } = await import('@/app/actions');

        const result = await getPresignedUploadUrl('image/png', '../family photos/My Photo.png', 'member-token');

        expect(result.url).toBe('https://public-s3.example.test/family-files');
        expect(result.fields).toEqual({ key: 'abc-file.png', policy: 'x' });
        expect(result.key).toMatch(/-My-Photo\.png$/);
        expect(actionMocks.requireFamilyMemberToken).toHaveBeenCalledWith('member-token', undefined);
        expect(actionMocks.createPresignedPost).toHaveBeenCalled();
        expect(actionMocks.createPresignedPost).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({
                Bucket: 'family-files',
                Conditions: expect.arrayContaining([
                    ['content-length-range', 0, 10485760],
                    ['eq', '$Content-Type', 'image/png'],
                ]),
                Fields: { 'Content-Type': 'image/png' },
            })
        );
    });

    it('getPresignedUploadUrl wraps signer failures with a stable error message', async () => {
        setDeviceCookie(EXPECTED_TOKEN);
        actionMocks.createPresignedPost.mockRejectedValueOnce(new Error('signer exploded'));
        const { getPresignedUploadUrl } = await import('@/app/actions');

        await expect(getPresignedUploadUrl('image/png', 'photo.png', 'member-token')).rejects.toThrow('Failed to generate upload signature');
    });

    it('getFiles requires device auth', async () => {
        setDeviceCookie(undefined);
        const { getFiles } = await import('@/app/actions');

        await expect(getFiles('parent-token')).rejects.toThrow('Unauthorized device');
    });

    it('getFiles lists server-side file metadata for authorized devices', async () => {
        setDeviceCookie(EXPECTED_TOKEN);
        const { getFiles } = await import('@/app/actions');

        const result = await getFiles('parent-token');

        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ key: 'a.png', size: 123 });
        expect(actionMocks.ListObjectsV2Command).toHaveBeenCalledWith({ Bucket: 'family-files' });
        expect(actionMocks.requireFamilyMemberToken).toHaveBeenCalledWith('parent-token', { requireParent: true });
    });

    it('refreshFiles revalidates the home route when authorized', async () => {
        setDeviceCookie(EXPECTED_TOKEN);
        const { refreshFiles } = await import('@/app/actions');

        await refreshFiles('parent-token');
        expect(actionMocks.revalidatePath).toHaveBeenCalledWith('/files');
    });

    it('refreshFiles requires device auth', async () => {
        setDeviceCookie(undefined);
        const { refreshFiles } = await import('@/app/actions');

        await expect(refreshFiles('parent-token')).rejects.toThrow('Unauthorized device');
        expect(actionMocks.revalidatePath).not.toHaveBeenCalled();
    });

    it('parent-only file actions reject a non-parent member token', async () => {
        setDeviceCookie(EXPECTED_TOKEN);
        actionMocks.requireFamilyMemberToken.mockResolvedValueOnce({
            ok: false,
            status: 403,
            error: 'Parent access required',
        });
        const { getFiles } = await import('@/app/actions');

        await expect(getFiles('kid-token')).rejects.toThrow('Parent access required');
    });
});
