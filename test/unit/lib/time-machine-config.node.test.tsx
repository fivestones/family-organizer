import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimeMachineBootstrap } from '@/components/debug/TimeMachineBootstrap';
import { isTimeMachineEnabled } from '@/lib/time-machine-config';

describe('time machine production gate', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('is enabled outside production for local development and e2e', () => {
        expect(isTimeMachineEnabled({ NODE_ENV: 'development' })).toBe(true);
        expect(isTimeMachineEnabled({ NODE_ENV: 'test' })).toBe(true);
    });

    it('does not emit the Date patch in production by default', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_ENABLE_TIME_MACHINE', '');

        expect(isTimeMachineEnabled()).toBe(false);
        expect(renderToStaticMarkup(<TimeMachineBootstrap />)).toBe('');
    });

    it('supports an explicit production opt-in', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_ENABLE_TIME_MACHINE', 'true');

        expect(isTimeMachineEnabled()).toBe(true);
        expect(renderToStaticMarkup(<TimeMachineBootstrap />)).toContain('debug_time_offset');
    });
});
