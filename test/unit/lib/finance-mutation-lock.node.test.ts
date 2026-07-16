import { describe, expect, it } from 'vitest';

import { withFinanceMutationLocks } from '@/lib/finance-mutation-lock';

describe('finance mutation locks', () => {
    it('serializes operations that touch the same envelope', async () => {
        const events: string[] = [];
        let releaseFirst!: () => void;
        let signalFirstStarted!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const firstStarted = new Promise<void>((resolve) => {
            signalFirstStarted = resolve;
        });

        const first = withFinanceMutationLocks(['env-1'], async () => {
            events.push('first-start');
            signalFirstStarted();
            await firstGate;
            events.push('first-end');
        });
        const second = withFinanceMutationLocks(['env-1'], async () => {
            events.push('second-start');
        });

        await firstStarted;
        expect(events).toEqual(['first-start']);
        releaseFirst();
        await Promise.all([first, second]);
        expect(events).toEqual(['first-start', 'first-end', 'second-start']);
    });

    it('does not block disjoint envelopes', async () => {
        const events: string[] = [];
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });

        const first = withFinanceMutationLocks(['env-a'], async () => {
            events.push('a');
            await firstGate;
        });
        const second = withFinanceMutationLocks(['env-b'], async () => {
            events.push('b');
        });

        await second;
        expect(events).toEqual(['a', 'b']);
        releaseFirst();
        await first;
    });
});
