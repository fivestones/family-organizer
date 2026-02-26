import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

vi.mock('server-only', () => ({}));

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
