import 'server-only';

import { init } from '@instantdb/admin';
import { createHash } from 'crypto';

function getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not configured`);
    }
    return value;
}

function getInstantAppId(): string {
    return process.env.INSTANT_APP_ID || getRequiredEnv('NEXT_PUBLIC_INSTANT_APP_ID');
}

function getKidPrincipalAuthId(): string {
    return process.env.INSTANT_KID_AUTH_ID || process.env.INSTANT_FAMILY_AUTH_ID || 'family-organizer-kid';
}

function sanitizeEmailLocalPart(value: string): string {
    const cleaned = value
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._-]+|[._-]+$/g, '');

    return cleaned || 'family-organizer-shared-device';
}

function getParentPrincipalAuthId(): string {
    return process.env.INSTANT_PARENT_AUTH_ID || 'family-organizer-parent';
}

export function getKidPrincipalAuthEmail(): string {
    if (process.env.INSTANT_KID_AUTH_EMAIL) {
        return process.env.INSTANT_KID_AUTH_EMAIL;
    }

    return `${sanitizeEmailLocalPart(getKidPrincipalAuthId())}@family-organizer.local`;
}

export function getParentPrincipalAuthEmail(): string {
    if (process.env.INSTANT_PARENT_AUTH_EMAIL) {
        return process.env.INSTANT_PARENT_AUTH_EMAIL;
    }

    return `${sanitizeEmailLocalPart(getParentPrincipalAuthId())}@family-organizer.local`;
}

export function isInstantFamilyAuthConfigured(): boolean {
    return Boolean((process.env.INSTANT_APP_ID || process.env.NEXT_PUBLIC_INSTANT_APP_ID) && process.env.INSTANT_APP_ADMIN_TOKEN);
}

export function getInstantAdminDb() {
    return init({
        appId: getInstantAppId(),
        adminToken: getRequiredEnv('INSTANT_APP_ADMIN_TOKEN'),
    });
}

type PrincipalType = 'kid' | 'parent';

function getPrincipalEmail(type: PrincipalType) {
    return type === 'kid' ? getKidPrincipalAuthEmail() : getParentPrincipalAuthEmail();
}

async function ensurePrincipalUserType(type: PrincipalType) {
    const adminDb = getInstantAdminDb();
    const email = getPrincipalEmail(type);
    const user = await adminDb.auth.getUser({ email });

    await adminDb.transact([adminDb.tx.$users[user.id].update({ type })]);
}

export async function mintPrincipalToken(type: PrincipalType) {
    const adminDb = getInstantAdminDb();
    const email = getPrincipalEmail(type);
    const token = await adminDb.auth.createToken({ email });

    await ensurePrincipalUserType(type);

    return token;
}

export function hashPinServer(pin: string): string {
    return createHash('sha256').update(pin).digest('hex');
}

export async function getFamilyMemberById(memberId: string) {
    const adminDb = getInstantAdminDb();
    const data = await adminDb.query({ familyMembers: {} });
    return (data.familyMembers || []).find((member: any) => member.id === memberId) || null;
}
