const CACHE_VERSION = 'family-organizer-v2';
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const OFFLINE_URL = '/offline.html';

const APP_SHELL_URLS = [
    OFFLINE_URL,
    '/manifest.json',
    '/icon-192x192.png',
    '/icon-512x512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(APP_SHELL_CACHE)
            .then((cache) => cache.addAll(APP_SHELL_URLS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(keys.filter((key) => !key.startsWith(CACHE_VERSION)).map((key) => caches.delete(key)));
            await self.clients.claim();
        })()
    );
});

function isSameOriginGet(request) {
    return request.method === 'GET' && new URL(request.url).origin === self.location.origin;
}

// The page the app runs on when the deployment is on PowerSync, and where its local database's worker files live.
const POWERSYNC_PAGE = '/sync';
const POWERSYNC_ASSETS = '/@powersync/';

function isStaticAsset(pathname) {
    return pathname.startsWith('/_next/static/') || pathname.startsWith(POWERSYNC_ASSETS) || APP_SHELL_URLS.includes(pathname);
}

// Never answered from here: the server's own routes, and the sync service, which shares the app's address.
function isLive(pathname) {
    return pathname.startsWith('/api/') || pathname.startsWith('/powersync/');
}

function isCacheableResponse(response) {
    return response.ok && response.type === 'basic' && !response.redirected;
}

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (!isSameOriginGet(request)) return;

    const url = new URL(request.url);
    if (isLive(url.pathname)) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            (async () => {
                try {
                    const networkResponse = await fetch(request);
                    if (isCacheableResponse(networkResponse)) {
                        const cache = await caches.open(RUNTIME_CACHE);
                        cache.put(request, networkResponse.clone()).catch(() => {});
                    }
                    return networkResponse;
                } catch {
                    const cachedPage = await caches.match(request);
                    if (cachedPage) return cachedPage;
                    // On a deployment on PowerSync the home page leads to the one page that runs there, and the
                    // server is not here to say so.
                    if (url.pathname === '/' && (await caches.match(POWERSYNC_PAGE))) return Response.redirect(POWERSYNC_PAGE, 302);
                    const offlineFallback = await caches.match(OFFLINE_URL);
                    return (
                        offlineFallback ||
                        new Response('Offline', {
                            status: 503,
                            headers: { 'content-type': 'text/plain' },
                        })
                    );
                }
            })()
        );
        return;
    }

    if (isStaticAsset(url.pathname)) {
        event.respondWith(
            (async () => {
                const cached = await caches.match(request);
                if (cached) {
                    event.waitUntil(
                        fetch(request)
                            .then(async (resp) => {
                                if (!isCacheableResponse(resp)) return;
                                const cache = await caches.open(RUNTIME_CACHE);
                                await cache.put(request, resp.clone());
                            })
                            .catch(() => {})
                    );
                    return cached;
                }

                const networkResponse = await fetch(request);
                if (isCacheableResponse(networkResponse)) {
                    const cache = await caches.open(RUNTIME_CACHE);
                    cache.put(request, networkResponse.clone()).catch(() => {});
                }
                return networkResponse;
            })()
        );
    }
});

// A page asks for what it needs to start with no network to be kept now, without waiting to be asked for it
// again: itself, and the files it has loaded. Without this a first visit would cache nothing, since the page and
// its files were fetched before this worker was in charge of it.
self.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || message.type !== 'keep' || !Array.isArray(message.urls)) return;
    event.waitUntil(
        (async () => {
            const cache = await caches.open(RUNTIME_CACHE);
            await Promise.all(
                message.urls
                    .filter((value) => typeof value === 'string' && new URL(value, self.location.origin).origin === self.location.origin)
                    .map(async (value) => {
                        try {
                            const response = await fetch(value, { cache: 'reload', credentials: 'same-origin' });
                            if (isCacheableResponse(response)) await cache.put(new URL(value, self.location.origin).pathname, response);
                        } catch {
                            // Kept the next time it is fetched.
                        }
                    })
            );
            event.source?.postMessage({ type: 'kept' });
        })()
    );
});
