import 'server-only';

export const APPLE_CALDAV_BASE_URL = 'https://caldav.icloud.com';
export const APPLE_CALDAV_PROVIDER = 'apple-caldav';
export const DEFAULT_SYNC_WINDOW_PAST_DAYS = 90;
export const DEFAULT_SYNC_WINDOW_FUTURE_DAYS = 365;
export const DEFAULT_REPAIR_SCAN_INTERVAL_HOURS = 24;
export const DEFAULT_SYNC_LOCK_TTL_MS = 20 * 60 * 1000;

function parsePositiveInt(value: string | undefined, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
}

export function getCalendarSyncCronSecret() {
    return process.env.CALENDAR_SYNC_CRON_SECRET || '';
}

export function getCalendarSyncEncryptionSecret() {
    const value = process.env.CALDAV_CREDENTIAL_ENCRYPTION_KEY || '';
    if (!value) {
        throw new Error('CALDAV_CREDENTIAL_ENCRYPTION_KEY is not configured');
    }
    return value;
}

export function getCalendarSyncKeyVersion() {
    return process.env.CALDAV_CREDENTIAL_ENCRYPTION_KEY_VERSION || 'v1';
}

export function getDefaultSyncWindowPastDays() {
    return parsePositiveInt(process.env.APPLE_CALDAV_SYNC_WINDOW_PAST_DAYS, DEFAULT_SYNC_WINDOW_PAST_DAYS);
}

export function getDefaultSyncWindowFutureDays() {
    return parsePositiveInt(process.env.APPLE_CALDAV_SYNC_WINDOW_FUTURE_DAYS, DEFAULT_SYNC_WINDOW_FUTURE_DAYS);
}

export function getDefaultRepairScanIntervalHours() {
    return parsePositiveInt(process.env.APPLE_CALDAV_REPAIR_SCAN_INTERVAL_HOURS, DEFAULT_REPAIR_SCAN_INTERVAL_HOURS);
}

export function getCalendarSyncLockTtlMs() {
    return parsePositiveInt(process.env.APPLE_CALDAV_LOCK_TTL_MINUTES, DEFAULT_SYNC_LOCK_TTL_MS / 60000) * 60 * 1000;
}

export function getCalendarSyncWindow(now = new Date(), pastDays = getDefaultSyncWindowPastDays(), futureDays = getDefaultSyncWindowFutureDays()) {
    const rangeStart = new Date(now);
    rangeStart.setUTCDate(rangeStart.getUTCDate() - pastDays);
    rangeStart.setUTCHours(0, 0, 0, 0);

    const rangeEnd = new Date(now);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + futureDays);
    rangeEnd.setUTCHours(23, 59, 59, 999);

    return {
        rangeStart,
        rangeEnd,
        rangeStartIso: rangeStart.toISOString(),
        rangeEndIso: rangeEnd.toISOString(),
    };
}
