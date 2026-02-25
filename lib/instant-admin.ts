import 'server-only';

import { init } from '@instantdb/admin';

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

export function getFamilyInstantAuthId(): string {
    return process.env.INSTANT_FAMILY_AUTH_ID || 'family-organizer-shared-device';
}

function sanitizeEmailLocalPart(value: string): string {
    const cleaned = value
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[._-]+|[._-]+$/g, '');

    return cleaned || 'family-organizer-shared-device';
}

export function getFamilyInstantAuthEmail(): string {
    if (process.env.INSTANT_FAMILY_AUTH_EMAIL) {
        return process.env.INSTANT_FAMILY_AUTH_EMAIL;
    }

    return `${sanitizeEmailLocalPart(getFamilyInstantAuthId())}@family-organizer.local`;
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
