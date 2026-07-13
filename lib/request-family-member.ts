import 'server-only';

import type { NextRequest } from 'next/server';
import { getDeviceAuthContextFromNextRequest } from '@/lib/device-auth-server';
import { getFamilyMemberById, getInstantAdminDb } from '@/lib/instant-admin';

export const INSTANT_AUTH_TOKEN_HEADER = 'x-instant-auth-token';

export type RequestFamilyMemberContext =
    | {
          ok: true;
          deviceAuth: ReturnType<typeof getDeviceAuthContextFromNextRequest>;
          instantUser: any;
          familyMember: any;
      }
    | {
          ok: false;
          status: number;
          error: string;
          reason?: string;
      };

export type FamilyMemberTokenContext =
    | {
          ok: true;
          instantUser: any;
          familyMember: any;
      }
    | {
          ok: false;
          status: number;
          error: string;
      };

async function resolveFamilyMemberContext(
    instantUser: any,
    options?: { requireParent?: boolean }
): Promise<FamilyMemberTokenContext> {
    if (!instantUser) {
        return {
            ok: false,
            status: 401,
            error: 'Family member auth required',
        };
    }

    const familyMemberId =
        typeof instantUser.familyMemberId === 'string' && instantUser.familyMemberId
            ? instantUser.familyMemberId
            : null;
    if (!familyMemberId) {
        return {
            ok: false,
            status: 403,
            error: 'This auth session is not linked to a family member',
        };
    }

    const familyMember = await getFamilyMemberById(familyMemberId);
    if (!familyMember) {
        return {
            ok: false,
            status: 404,
            error: 'Family member not found',
        };
    }

    if (options?.requireParent && familyMember.role !== 'parent') {
        return {
            ok: false,
            status: 403,
            error: 'Parent access required',
        };
    }

    return {
        ok: true,
        instantUser,
        familyMember,
    };
}

export async function requireFamilyMemberToken(
    token: string | null | undefined,
    options?: { requireParent?: boolean }
): Promise<FamilyMemberTokenContext> {
    const normalizedToken = typeof token === 'string' ? token.trim() : '';
    if (!normalizedToken) {
        return {
            ok: false,
            status: 401,
            error: 'Family member auth required',
        };
    }

    try {
        const instantUser = await getInstantAdminDb().auth.verifyToken(normalizedToken as any);
        return resolveFamilyMemberContext(instantUser, options);
    } catch {
        return {
            ok: false,
            status: 401,
            error: 'Family member auth required',
        };
    }
}

async function getInstantUserFromRequest(request: NextRequest) {
    const adminDb = getInstantAdminDb();
    const headerToken = request.headers.get(INSTANT_AUTH_TOKEN_HEADER) || '';

    if (headerToken) {
        try {
            return await adminDb.auth.verifyToken(headerToken as any);
        } catch {
            return null;
        }
    }

    try {
        return await adminDb.auth.getUserFromRequest(request);
    } catch {
        return null;
    }
}

export async function requireRequestFamilyMember(request: NextRequest, options?: { requireParent?: boolean }): Promise<RequestFamilyMemberContext> {
    const deviceAuth = getDeviceAuthContextFromNextRequest(request);
    if (!deviceAuth.authorized) {
        const reason = 'reason' in deviceAuth ? deviceAuth.reason : 'unknown';
        return {
            ok: false,
            status: 401,
            error: 'Unauthorized device',
            reason,
        };
    }

    const instantUser = await getInstantUserFromRequest(request);
    const memberContext = await resolveFamilyMemberContext(instantUser, options);
    if ('error' in memberContext) return memberContext;

    return {
        ok: true,
        deviceAuth,
        instantUser: memberContext.instantUser,
        familyMember: memberContext.familyMember,
    };
}
