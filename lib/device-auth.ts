export const DEVICE_AUTH_COOKIE_NAME = 'family_device_auth';
export const DEVICE_AUTH_COOKIE_VALUE = 'true';

export function hasValidDeviceAuthCookie(value: string | null | undefined): boolean {
    return value === DEVICE_AUTH_COOKIE_VALUE;
}

