import 'server-only';

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

// How a family member's PIN is hashed and checked. It knows nothing about where the hash is stored.

const PIN_HASH_PREFIX = 'scrypt$v1';
const PIN_SCRYPT_KEY_LENGTH = 32;
const PIN_SCRYPT_OPTIONS = {
    N: 16_384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
} as const;

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
