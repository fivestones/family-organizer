import { describe, expect, it } from 'vitest';

import { resolveOneLink } from '@/lib/instant-links';

describe('resolveOneLink', () => {
    it('normalizes object, array, empty, and missing Instant has-one link shapes', () => {
        const linked = { id: 'linked' };

        expect(resolveOneLink(linked)).toBe(linked);
        expect(resolveOneLink([linked])).toBe(linked);
        expect(resolveOneLink([])).toBeNull();
        expect(resolveOneLink(null)).toBeNull();
        expect(resolveOneLink(undefined)).toBeNull();
    });
});
