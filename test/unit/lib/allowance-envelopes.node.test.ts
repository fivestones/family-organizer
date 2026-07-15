import { describe, expect, it } from 'vitest';

import { filterActiveAllowanceEnvelopes, isActiveAllowanceEnvelope } from '@/lib/allowance-envelopes';

describe('active allowance envelopes', () => {
    it('keeps missing/null archive timestamps and excludes archived rows', () => {
        const active = { id: 'active' };
        const explicitActive = { id: 'explicit-active', archivedAt: null };
        const archived = { id: 'archived', archivedAt: '2026-07-15T12:00:00.000Z' };

        expect(isActiveAllowanceEnvelope(active)).toBe(true);
        expect(isActiveAllowanceEnvelope(archived)).toBe(false);
        expect(filterActiveAllowanceEnvelopes([active, explicitActive, archived])).toEqual([active, explicitActive]);
    });
});
