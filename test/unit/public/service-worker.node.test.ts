import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type ServiceWorkerHandler = (event: any) => void;

const source = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8');

function loadServiceWorker() {
    const handlers = new Map<string, ServiceWorkerHandler>();
    const cache = {
        addAll: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
    };
    const caches = {
        open: vi.fn(async () => cache),
        keys: vi.fn(async () => [] as string[]),
        delete: vi.fn(async () => true),
        match: vi.fn(async () => undefined),
    };
    const fetch = vi.fn();
    const self = {
        location: { origin: 'https://family.example.com' },
        addEventListener: vi.fn((type: string, handler: ServiceWorkerHandler) => handlers.set(type, handler)),
        skipWaiting: vi.fn(async () => undefined),
        clients: { claim: vi.fn(async () => undefined) },
    };

    vm.runInNewContext(source, { URL, Response, caches, fetch, self });

    return { cache, caches, fetch, handlers };
}

function makeFetchEvent(pathname: string, mode = 'cors') {
    let responsePromise: Promise<unknown> | undefined;
    const waits: Promise<unknown>[] = [];
    const event = {
        request: {
            method: 'GET',
            mode,
            url: `https://family.example.com${pathname}`,
        },
        respondWith: vi.fn((promise: Promise<unknown>) => {
            responsePromise = promise;
        }),
        waitUntil: vi.fn((promise: Promise<unknown>) => waits.push(promise)),
    };

    return {
        event,
        getResponsePromise: () => responsePromise,
        waits,
    };
}

function mockResponse(overrides: Partial<{ ok: boolean; type: string; redirected: boolean }> = {}) {
    const response = {
        ok: true,
        type: 'basic',
        redirected: false,
        clone: vi.fn(),
        ...overrides,
    };
    response.clone.mockReturnValue(response);
    return response;
}

describe('public service worker cache policy', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    it('never intercepts signed file routes just because the filename has an asset extension', () => {
        const { handlers } = loadServiceWorker();
        const { event } = makeFetchEvent('/files/family-photo.png');

        handlers.get('fetch')?.(event);

        expect(event.respondWith).not.toHaveBeenCalled();
    });

    it.each([
        ['an error response', { ok: false }],
        ['a redirected response', { redirected: true }],
        ['a non-basic response', { type: 'cors' }],
    ])('does not cache %s', async (_label, overrides) => {
        const { cache, caches, fetch, handlers } = loadServiceWorker();
        const response = mockResponse(overrides);
        fetch.mockResolvedValue(response);
        caches.match.mockResolvedValue(undefined);
        const { event, getResponsePromise } = makeFetchEvent('/_next/static/chunks/app.js');

        handlers.get('fetch')?.(event);
        await getResponsePromise();

        expect(cache.put).not.toHaveBeenCalled();
    });

    it('caches a successful same-origin static response', async () => {
        const { cache, caches, fetch, handlers } = loadServiceWorker();
        const response = mockResponse();
        fetch.mockResolvedValue(response);
        caches.match.mockResolvedValue(undefined);
        const { event, getResponsePromise } = makeFetchEvent('/_next/static/chunks/app.js');

        handlers.get('fetch')?.(event);
        await getResponsePromise();

        expect(cache.put).toHaveBeenCalledWith(event.request, response);
    });
});
