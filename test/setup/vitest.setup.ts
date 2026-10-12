import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

vi.mock('server-only', () => ({}));
process.env.NEXT_PUBLIC_INSTANT_APP_ID ||= '00000000-0000-0000-0000-000000000000';

// Node 25 has a `localStorage` of its own, and with no file to back it that is an empty object with no methods.
// In a browser-environment test it shadows jsdom's, so hand the tests the real one.
const browserWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (browserWindow) {
    for (const storage of ['localStorage', 'sessionStorage'] as const) {
        Object.defineProperty(globalThis, storage, { value: browserWindow[storage], configurable: true, writable: true });
    }
}

beforeEach(() => {
    if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.clear();
    }
});

afterEach(() => {
    if (typeof document !== 'undefined') {
        cleanup();
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
});
