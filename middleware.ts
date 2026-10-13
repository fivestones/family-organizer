// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { DEVICE_AUTH_COOKIE_NAME, sha256hex, getDeviceAuthCookieOptions, isSelfAuthenticatingApiPath } from '@/lib/device-auth';

// 2. Paths that are always allowed (e.g., static assets, manifest)
// You might want to allow manifest.json so the PWA is recognized,
// but blocking it until auth is also fine.
const PUBLIC_FILE_EXTENSIONS = ['.ico', '.png', '.jpg', '.jpeg', '.svg', '.css', '.js', '.mjs', '.ttf', '.woff', '.woff2'];
const PUBLIC_ALLOWLIST_PATHS = [
    '/manifest.json',
    '/manifest.webmanifest',
    '/offline.html',
    '/activate',
    '/api/health',
    '/api/device-activate',
];
const PUBLIC_ALLOWLIST_PREFIXES = ['/api/mobile/'];

const POWERSYNC_HOME = '/sync';
const isPowerSyncPage = (pathname: string) => pathname === POWERSYNC_HOME || pathname.startsWith(`${POWERSYNC_HOME}/`);
/** A page of the app, as opposed to an API route or one of the files a page loads. */
const isAppPage = (pathname: string) => !pathname.startsWith('/api/') && !pathname.startsWith('/_next/') && !pathname.startsWith('/@powersync/') && !/\.[a-z0-9]+$/i.test(pathname);

export async function middleware(request: NextRequest) {
    // 1. Read the key INSIDE the function to ensure we get the runtime value
    const SECRET_KEY = process.env.DEVICE_ACCESS_KEY;

    const { pathname, searchParams } = request.nextUrl;

    // --- A. PASS: Check if the request is for a static asset ---
    // We generally allow static files to pass so we don't break browser defaults,
    // but you can block these too if you want extreme strictness.
    if (
        PUBLIC_ALLOWLIST_PATHS.includes(pathname) ||
        PUBLIC_ALLOWLIST_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
        isSelfAuthenticatingApiPath(pathname) ||
        PUBLIC_FILE_EXTENSIONS.some((ext) => pathname.endsWith(ext))
    ) {
        return NextResponse.next();
    }

    if (SECRET_KEY) {
        const expectedToken = await sha256hex(SECRET_KEY);
        // Prefer the Host header so the real public hostname is used even behind a reverse proxy
        const hostname = request.headers.get('host') ?? request.nextUrl.hostname;

        // --- B. PASS: Check if device is already authenticated ---
        const deviceCookie = request.cookies.get(DEVICE_AUTH_COOKIE_NAME);
        if (deviceCookie && deviceCookie.value === expectedToken) {
            // On a deployment whose clients are on PowerSync, every page is shown from the app built on it, which
            // lives under /sync, at the address the old page had. The old pages need InstantDB and are not reached.
            if (process.env.DATA_BACKEND === 'powersync' && isAppPage(pathname) && !isPowerSyncPage(pathname)) {
                return NextResponse.rewrite(new URL(`${POWERSYNC_HOME}${pathname === '/' ? '' : pathname}`, request.url));
            }
            return NextResponse.next();
        }

        // --- C. ACTIVATE: Check if this is the Magic Link ---
        // URL Pattern: https://your-site.com/?activate=SUPER_SECRET_KEY
        const activationKey = searchParams.get('activate');

        if (activationKey === SECRET_KEY) {
            // 1. Create a response that redirects to the home page (removing the query param)
            const response = NextResponse.redirect(new URL('/', request.url));

            // 2. Stamp the "Badge" (Set the long-lived cookie)
            response.cookies.set(DEVICE_AUTH_COOKIE_NAME, expectedToken, getDeviceAuthCookieOptions(hostname));
            return response;
        }
    }

    // --- D. BLOCK: Deny everything else ---
    // If they aren't authorized and aren't providing the key,
    // rewrite the URL to a 404 page or return a raw 404/403.

    // Option 2: Return a raw JSON error (Good for APIs)
    if (pathname.startsWith('/api')) {
        return new NextResponse(JSON.stringify({ error: 'Unauthorized Device' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
        });
    }

    // Option 3: Hard 404 for the main page.
    // This effectively makes the server "ghost" the user.
    return new NextResponse('Not Found', { status: 404 });
}

// Configure which paths this middleware runs on
export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
