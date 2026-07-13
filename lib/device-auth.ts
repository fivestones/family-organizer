export const DEVICE_AUTH_COOKIE_NAME = 'activation_token';
export const DEVICE_AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 400; // ~400 days

/** SHA-256 hex digest. Uses crypto.subtle so it works in both Edge and Node runtimes. */
export async function sha256hex(text: string): Promise<string> {
    const encoded = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

const COMMON_COUNTRY_CODE_SECOND_LEVEL_DOMAINS = new Set([
    'ac',
    'co',
    'com',
    'edu',
    'gov',
    'net',
    'org',
]);

function normalizeHostname(hostname: string): string {
    const value = hostname.trim().toLowerCase();
    if (value.startsWith('[')) {
        const closingBracket = value.indexOf(']');
        return closingBracket === -1 ? value : value.slice(1, closingBracket);
    }

    const colonCount = (value.match(/:/g) ?? []).length;
    return colonCount === 1 ? value.slice(0, value.lastIndexOf(':')) : value;
}

function isIpLiteral(hostname: string): boolean {
    if (hostname.includes(':')) return true;

    const octets = hostname.split('.');
    return octets.length === 4
        && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

/**
 * Returns the shared parent domain for subdomain deployments so the activation
 * cookie is visible to all sibling subdomains (SSO).
 *
 * Examples:
 *   fam.domain.com   → '.domain.com'
 *   app.domain.co.uk → '.domain.co.uk'
 *   family-org.com   → undefined   (no explicit domain — cookie scoped to exact host)
 *   192.168.1.20     → undefined
 *   localhost        → undefined
 *
 * The caller should omit the `domain` cookie attribute when this returns undefined.
 */
export function getParentDomain(hostname: string): string | undefined {
    const host = normalizeHostname(hostname);
    if (!host || host === 'localhost' || host.endsWith('.localhost') || isIpLiteral(host)) return undefined;

    const parts = host.split('.').filter(Boolean);
    const tld = parts.at(-1) ?? '';
    const secondLevel = parts.at(-2) ?? '';
    const usesCommonCountryCodeSuffix = tld.length === 2
        && COMMON_COUNTRY_CODE_SECOND_LEVEL_DOMAINS.has(secondLevel);
    const registrableDomainParts = usesCommonCountryCodeSuffix ? 3 : 2;

    if (parts.length <= registrableDomainParts) return undefined;
    return `.${parts.slice(-registrableDomainParts).join('.')}`;
}

export function getDeviceAuthCookieOptions(hostname?: string) {
    const configuredDomain = process.env.DEVICE_AUTH_COOKIE_DOMAIN?.trim();
    const domain = configuredDomain
        ? configuredDomain.startsWith('.') ? configuredDomain : `.${configuredDomain}`
        : hostname ? getParentDomain(hostname) : undefined;
    return {
        maxAge: DEVICE_AUTH_COOKIE_MAX_AGE_SECONDS,
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax' as const,
        ...(domain !== undefined ? { domain } : {}),
    };
}
