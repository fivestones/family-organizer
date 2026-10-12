// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createInstantBackend, setDataBackend, useFamilyMember, useFamilyMembers } from '@family-organizer/data';
import { createFakeInstant } from '../../utils/fake-instant';

function bind(initial: Parameters<typeof createFakeInstant>[0] = {}) {
    const fake = createFakeInstant(initial);
    setDataBackend(createInstantBackend(fake.client));
    return fake;
}

const parent = {
    id: 'm-parent',
    name: 'Sam',
    role: 'parent',
    order: 0,
    email: 'sam@example.com',
    color: '#336699',
    photoUrls: { '64': 'sam-64.png', '320': 'sam-320.png' },
    pinHash: 'scrypt$v1$aa$bb',
    allowanceStartDate: Date.UTC(2026, 0, 2, 3, 4, 5),
    messageQuietHoursEnabled: true,
    messageQuietHoursStart: '21:00',
};
const kid = { id: 'm-kid', name: 'Ada', order: 1, allowanceAmount: 5, allowanceCurrency: 'USD', allowanceStartDate: '2026-02-03T00:00:00.000Z' };

describe('the family roster, over Instant', () => {
    it('asks for the family in its own order', () => {
        const fake = bind();
        renderHook(() => useFamilyMembers());
        expect(fake.queries[0]).toEqual({ familyMembers: { $: { order: { order: 'asc' } } } });
    });

    it('gives every member every field, with null for what was never set', () => {
        bind({ familyMembers: [parent, kid] });

        const [sam, ada] = renderHook(() => useFamilyMembers()).result.current.data;

        expect(sam).toEqual({
            id: 'm-parent',
            name: 'Sam',
            role: 'parent',
            email: 'sam@example.com',
            color: '#336699',
            photoUrls: { '64': 'sam-64.png', '320': 'sam-320.png' },
            sortOrder: 0,
            hasPin: true,
            allowanceAmount: null,
            allowanceCurrency: null,
            allowanceRrule: null,
            allowanceStartDate: '2026-01-02T03:04:05.000Z',
            allowancePayoutDelayDays: null,
            allowanceConfig: null,
            lastDisplayCurrency: null,
            viewShowChoreDescriptions: null,
            viewShowTaskDetails: null,
            messageQuietHoursEnabled: true,
            messageQuietHoursStart: '21:00',
            messageQuietHoursEnd: null,
            messageDigestMode: null,
            messageDigestWindowMinutes: null,
        });
        expect(ada.role).toBe('child');
        expect(ada.hasPin).toBe(false);
        expect(ada.sortOrder).toBe(1);
        expect(ada.allowanceAmount).toBe(5);
        expect(ada.allowanceStartDate).toBe('2026-02-03T00:00:00.000Z');
    });

    it('never hands the PIN hash to a screen', () => {
        bind({ familyMembers: [parent] });
        const [sam] = renderHook(() => useFamilyMembers()).result.current.data;
        expect(Object.keys(sam)).not.toContain('pinHash');
        expect(JSON.stringify(sam)).not.toContain('scrypt');
    });

    it('keeps the same roster array until a member changes', () => {
        bind({ familyMembers: [parent, kid] });
        const { result, rerender } = renderHook(() => useFamilyMembers());
        const first = result.current.data;
        rerender();
        expect(result.current.data).toBe(first);
    });

    it('finds one member by id, and gives null for no id or an unknown one', () => {
        bind({ familyMembers: [parent, kid] });
        expect(renderHook(() => useFamilyMember('m-kid')).result.current.data?.name).toBe('Ada');
        expect(renderHook(() => useFamilyMember(null)).result.current.data).toBeNull();
        expect(renderHook(() => useFamilyMember('nobody')).result.current.data).toBeNull();
    });

    it('holds the read back while it is disabled', () => {
        const fake = bind({ familyMembers: [parent] });
        const { result } = renderHook(() => useFamilyMembers({ enabled: false }));
        expect(fake.queries).toEqual([null]);
        expect(result.current.data).toEqual([]);
        expect(result.current.isLoading).toBe(true);
    });
});
