import 'server-only';

import { init } from '@instantdb/admin';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const PIN_HASH_PREFIX = 'scrypt$v1';
const PIN_SCRYPT_KEY_LENGTH = 32;
const PIN_SCRYPT_OPTIONS = {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
} as const;

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

function getFamilyMemberAuthEmail(memberId: string) {
    const normalizedMemberId = sanitizeEmailLocalPart(memberId);
    return `${normalizedMemberId}@family-organizer.member.local`;
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

type FamilyMemberRecord = {
    id: string;
    name?: string | null;
    role?: string | null;
    pinHash?: string | null;
    photoUrls?: Record<string, string> | null;
};

function getPrincipalEmail(type: PrincipalType) {
    return type === 'kid' ? getKidPrincipalAuthEmail() : getParentPrincipalAuthEmail();
}

async function ensurePrincipalUserType(type: PrincipalType) {
    const adminDb = getInstantAdminDb();
    const email = getPrincipalEmail(type);
    const user = await adminDb.auth.getUser({ email });

    await adminDb.transact([
        adminDb.tx.$users[user.id].update({
            type,
            // Keep shared principals explicitly identity-less. Instant auth
            // refs preserve null values, which cannot be compared reliably in
            // permission CEL; an empty string remains safely comparable.
            familyMemberId: '',
        }),
    ]);
}

export async function mintPrincipalToken(type: PrincipalType) {
    const adminDb = getInstantAdminDb();
    const email = getPrincipalEmail(type);
    const token = await adminDb.auth.createToken({ email });

    await ensurePrincipalUserType(type);

    return token;
}

async function queryFamilyMembers() {
    const adminDb = getInstantAdminDb();
    const data = await adminDb.query({ familyMembers: {} });
    return (data.familyMembers as FamilyMemberRecord[]) || [];
}

function safeEqualHex(leftHex: string, rightHex: string) {
    if (!/^[0-9a-f]+$/i.test(leftHex) || !/^[0-9a-f]+$/i.test(rightHex)) return false;
    const left = Buffer.from(leftHex, 'hex');
    const right = Buffer.from(rightHex, 'hex');
    return left.length === right.length && timingSafeEqual(left, right);
}

export function hashPinServer(pin: string): string {
    const salt = randomBytes(16);
    const derivedKey = scryptSync(pin.trim(), salt, PIN_SCRYPT_KEY_LENGTH, PIN_SCRYPT_OPTIONS);
    return `${PIN_HASH_PREFIX}$${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

export function verifyPinHashServer(pin: string, storedHash: string) {
    const normalizedPin = pin.trim();
    const [algorithm, version, saltHex, expectedHex, ...extra] = storedHash.split('$');
    if (algorithm === 'scrypt' && version === 'v1' && saltHex && expectedHex && extra.length === 0) {
        if (!/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{64}$/i.test(expectedHex)) {
            return { valid: false, needsUpgrade: false };
        }
        const actual = scryptSync(normalizedPin, Buffer.from(saltHex, 'hex'), PIN_SCRYPT_KEY_LENGTH, PIN_SCRYPT_OPTIONS);
        return {
            valid: safeEqualHex(actual.toString('hex'), expectedHex),
            needsUpgrade: false,
        };
    }

    const legacyHash = createHash('sha256').update(normalizedPin).digest('hex');
    const valid = /^[0-9a-f]{64}$/i.test(storedHash) && safeEqualHex(legacyHash, storedHash);
    return { valid, needsUpgrade: valid };
}

export async function getFamilyMemberById(memberId: string) {
    const familyMembers = await queryFamilyMembers();
    return familyMembers.find((member: any) => member.id === memberId) || null;
}

export async function listFamilyMemberRoster() {
    const familyMembers = await queryFamilyMembers();
    return familyMembers
        .map((member: any) => ({
            id: member.id,
            name: member.name || 'Unknown',
            role: member.role || 'child',
            photoUrls: member.photoUrls || null,
            hasPin: Boolean(member.pinHash),
        }))
        .sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

export async function verifyFamilyMemberCredentials(memberId: string, pin: string | null | undefined) {
    const member = (await getFamilyMemberById(memberId)) as FamilyMemberRecord | null;
    if (!member) {
        throw new Error('Family member not found');
    }

    if (member.pinHash) {
        const providedPin = typeof pin === 'string' ? pin.trim() : '';
        if (!providedPin) {
            throw new Error('PIN is required');
        }

        const verification = verifyPinHashServer(providedPin, member.pinHash);
        if (!verification.valid) {
            throw new Error('Incorrect PIN');
        }

        if (verification.needsUpgrade) {
            const adminDb = getInstantAdminDb();
            await adminDb.transact([
                adminDb.tx.familyMembers[member.id].update({
                    pinHash: hashPinServer(providedPin),
                }),
            ]);
        }
    }

    return member;
}

export async function mintFamilyMemberToken(memberId: string) {
    const adminDb = getInstantAdminDb();
    const member = (await getFamilyMemberById(memberId)) as FamilyMemberRecord | null;
    if (!member) {
        throw new Error('Family member not found');
    }

    const email = getFamilyMemberAuthEmail(member.id);
    const token = await adminDb.auth.createToken({ email });
    const user = await adminDb.auth.getUser({ email });
    const principalType = member.role === 'parent' ? 'parent' : 'kid';

    await adminDb.transact([
        adminDb.tx.$users[user.id].update({
            familyMemberId: member.id,
            imageURL:
                typeof member.photoUrls?.['320'] === 'string'
                    ? member.photoUrls['320']
                    : typeof member.photoUrls?.['64'] === 'string'
                    ? member.photoUrls['64']
                    : null,
            role: member.role || 'child',
            type: principalType,
        }),
    ]);

    return {
        token,
        principalType,
        member,
        user,
    };
}
