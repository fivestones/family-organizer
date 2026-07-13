import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const avatarRouteMocks = vi.hoisted(() => ({
    requireRequestFamilyMember: vi.fn(),
    S3Client: vi.fn(),
    PutObjectCommand: vi.fn(),
    DeleteObjectsCommand: vi.fn(),
}));

vi.mock('@/lib/request-family-member', () => ({
    requireRequestFamilyMember: avatarRouteMocks.requireRequestFamilyMember,
}));

vi.mock('@aws-sdk/client-s3', () => ({
    S3Client: avatarRouteMocks.S3Client,
    PutObjectCommand: avatarRouteMocks.PutObjectCommand,
    DeleteObjectsCommand: avatarRouteMocks.DeleteObjectsCommand,
}));

import { POST } from '@/app/api/avatar-variants/route';

describe('POST /api/avatar-variants authorization', () => {
    beforeEach(() => {
        avatarRouteMocks.requireRequestFamilyMember.mockResolvedValue({
            ok: false,
            status: 403,
            error: 'Parent access required',
        });
    });

    it('requires an authenticated parent before parsing or writing the upload', async () => {
        const request = new NextRequest('http://localhost:3000/api/avatar-variants', {
            method: 'POST',
        });
        const formDataSpy = vi.spyOn(request, 'formData');

        const response = await POST(request);

        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: 'Parent access required' });
        expect(avatarRouteMocks.requireRequestFamilyMember).toHaveBeenCalledWith(request, { requireParent: true });
        expect(formDataSpy).not.toHaveBeenCalled();
        expect(avatarRouteMocks.S3Client).not.toHaveBeenCalled();
    });
});
