import 'server-only';

import { createPrivateKey, createSign, type KeyObject } from 'crypto';
import { principalKey, type Principal } from '@family-organizer/data/session/principal';

// The short-lived token a device shows the PowerSync service (docs/powersync-migration.md, "Identity and sessions").
//
// The app signs it with the private half of a key pair; the service is given the public half. What a device is
// sent follows from the two claims the sync streams read: whether it is a parent, and which family member it is.

/** Who the token is for; the service's configuration names the same audience. */
export const SYNC_TOKEN_AUDIENCE = 'family-organizer';
/** PowerSync recommends between five minutes and an hour. The device asks for another before this one runs out. */
export const SYNC_TOKEN_LIFETIME_SECONDS = 10 * 60;

let cachedKey: { source: string; key: KeyObject } | null = null;

export function isSyncTokenConfigured(): boolean {
    return Boolean(process.env.POWERSYNC_JWT_PRIVATE_KEY && process.env.POWERSYNC_JWT_KID);
}

function signingKey(): KeyObject {
    const source = process.env.POWERSYNC_JWT_PRIVATE_KEY;
    if (!source) throw new Error('POWERSYNC_JWT_PRIVATE_KEY is not set.');
    if (cachedKey?.source !== source) cachedKey = { source, key: createPrivateKey(Buffer.from(source, 'base64').toString('utf8')) };
    return cachedKey.key;
}

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function signSyncToken(principal: Principal, now = new Date()): { token: string; expiresAt: string } {
    const kid = process.env.POWERSYNC_JWT_KID;
    if (!kid) throw new Error('POWERSYNC_JWT_KID is not set.');
    const issuedAt = Math.floor(now.getTime() / 1000);
    const expiresAt = issuedAt + SYNC_TOKEN_LIFETIME_SECONDS;
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT', kid })}.${encode({
        // One name per principal: the service confirms what a device has uploaded per subject.
        sub: principalKey(principal),
        aud: SYNC_TOKEN_AUDIENCE,
        iat: issuedAt,
        exp: expiresAt,
        type: principal.type,
        family_member_id: principal.familyMemberId,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(signingKey()).toString('base64url');
    return { token: `${unsigned}.${signature}`, expiresAt: new Date(expiresAt * 1000).toISOString() };
}
