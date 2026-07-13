import { beforeEach, describe, expect, it, vi } from 'vitest';

const familyMemberMocks = vi.hoisted(() => ({
    verifyToken: vi.fn(),
    getFamilyMemberById: vi.fn(),
}));

vi.mock('@/lib/instant-admin', () => ({
    getInstantAdminDb: () => ({
        auth: {
            verifyToken: familyMemberMocks.verifyToken,
        },
    }),
    getFamilyMemberById: familyMemberMocks.getFamilyMemberById,
}));

vi.mock('@/lib/device-auth-server', () => ({
    getDeviceAuthContextFromNextRequest: vi.fn(),
}));

import { requireFamilyMemberToken } from '@/lib/request-family-member';

describe('requireFamilyMemberToken', () => {
    beforeEach(() => {
        familyMemberMocks.verifyToken.mockResolvedValue({ familyMemberId: 'parent-1' });
        familyMemberMocks.getFamilyMemberById.mockResolvedValue({ id: 'parent-1', role: 'parent' });
    });

    it('rejects a missing token without consulting Instant', async () => {
        await expect(requireFamilyMemberToken('')).resolves.toEqual({
            ok: false,
            status: 401,
            error: 'Family member auth required',
        });
        expect(familyMemberMocks.verifyToken).not.toHaveBeenCalled();
    });

    it('rejects an invalid Instant token', async () => {
        familyMemberMocks.verifyToken.mockRejectedValue(new Error('invalid token'));

        await expect(requireFamilyMemberToken('invalid')).resolves.toEqual({
            ok: false,
            status: 401,
            error: 'Family member auth required',
        });
    });

    it('rejects a token that is not linked to a family member', async () => {
        familyMemberMocks.verifyToken.mockResolvedValue({ id: 'instant-user-1' });

        await expect(requireFamilyMemberToken('valid-token')).resolves.toEqual({
            ok: false,
            status: 403,
            error: 'This auth session is not linked to a family member',
        });
        expect(familyMemberMocks.getFamilyMemberById).not.toHaveBeenCalled();
    });

    it('rejects a token linked to a deleted family member', async () => {
        familyMemberMocks.getFamilyMemberById.mockResolvedValue(null);

        await expect(requireFamilyMemberToken('valid-token')).resolves.toEqual({
            ok: false,
            status: 404,
            error: 'Family member not found',
        });
    });

    it('rejects a kid token at a parent-only boundary', async () => {
        familyMemberMocks.verifyToken.mockResolvedValue({ familyMemberId: 'kid-1' });
        familyMemberMocks.getFamilyMemberById.mockResolvedValue({ id: 'kid-1', role: 'child' });

        await expect(requireFamilyMemberToken('kid-token', { requireParent: true })).resolves.toEqual({
            ok: false,
            status: 403,
            error: 'Parent access required',
        });
    });

    it('returns the verified Instant user and active parent record', async () => {
        const instantUser = { id: 'instant-user-1', familyMemberId: 'parent-1' };
        const familyMember = { id: 'parent-1', role: 'parent' };
        familyMemberMocks.verifyToken.mockResolvedValue(instantUser);
        familyMemberMocks.getFamilyMemberById.mockResolvedValue(familyMember);

        await expect(requireFamilyMemberToken('  parent-token  ', { requireParent: true })).resolves.toEqual({
            ok: true,
            instantUser,
            familyMember,
        });
        expect(familyMemberMocks.verifyToken).toHaveBeenCalledWith('parent-token');
    });
});
