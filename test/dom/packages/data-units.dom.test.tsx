// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createInstantBackend, defineUnit, setDataBackend, useUnitDefinitions } from '@family-organizer/data';
import { createFakeInstant } from '../../utils/fake-instant';

function bind(initial: Parameters<typeof createFakeInstant>[0] = {}) {
    const fake = createFakeInstant(initial);
    setDataBackend(createInstantBackend(fake.client));
    return fake;
}

describe('unit definitions, over Instant', () => {
    it('reads each unit with every field present, leaving what was never set as null', () => {
        bind({
            unitDefinitions: [
                { id: 'u1', code: 'USD', name: 'US Dollar', symbol: '$', isMonetary: true, symbolPlacement: 'before', symbolSpacing: false, decimalPlaces: 2 },
                { id: 'u2', code: 'STARS', name: 'Stars', symbol: '★', isMonetary: false },
            ],
        });

        const { result } = renderHook(() => useUnitDefinitions());

        expect(result.current.isLoading).toBe(false);
        expect(result.current.data).toEqual([
            { id: 'u1', code: 'USD', name: 'US Dollar', symbol: '$', isMonetary: true, symbolPlacement: 'before', symbolSpacing: false, decimalPlaces: 2 },
            { id: 'u2', code: 'STARS', name: 'Stars', symbol: '★', isMonetary: false, symbolPlacement: null, symbolSpacing: null, decimalPlaces: null },
        ]);
    });

    it('treats an old row that never said whether it is money the way the formatters treat an undefined unit', () => {
        bind({
            unitDefinitions: [
                { id: 'u1', code: 'NPR', name: 'Rupee', symbol: 'रु' },
                { id: 'u2', code: 'XP', name: 'Experience', symbol: 'xp' },
            ],
        });

        const { result } = renderHook(() => useUnitDefinitions());

        expect(result.current.data.map((unit) => [unit.code, unit.isMonetary])).toEqual([
            ['NPR', true],
            ['XP', false],
        ]);
    });

    it('asks for the units in code order', () => {
        const fake = bind();
        renderHook(() => useUnitDefinitions());
        expect(fake.queries[0]).toEqual({ unitDefinitions: { $: { order: { code: 'asc' } } } });
    });

    it('keeps the same array until a unit changes', () => {
        bind({ unitDefinitions: [{ id: 'u1', code: 'USD', name: 'US Dollar', symbol: '$', isMonetary: true }] });
        const { result, rerender } = renderHook(() => useUnitDefinitions());
        const first = result.current.data;
        rerender();
        expect(result.current.data).toBe(first);
    });

    it('defines a unit, resolves to its id, and shows it to a screen that is listing units', async () => {
        const fake = bind();
        const { result } = renderHook(() => useUnitDefinitions());
        expect(result.current.data).toEqual([]);

        let unitId = '';
        await act(async () => {
            unitId = await defineUnit({ code: 'HR', name: 'Hours', symbol: 'h', isMonetary: false, symbolPlacement: 'after', symbolSpacing: true, decimalPlaces: 1 });
        });

        expect(unitId).toBe('generated-1');
        expect(fake.rows('unitDefinitions')).toEqual([
            { id: 'generated-1', code: 'HR', name: 'Hours', symbol: 'h', isMonetary: false, symbolPlacement: 'after', symbolSpacing: true, decimalPlaces: 1 },
        ]);
        await waitFor(() => expect(result.current.data.map((unit) => unit.code)).toEqual(['HR']));
    });

    it('holds the read back while it is disabled', () => {
        const fake = bind({ unitDefinitions: [{ id: 'u1', code: 'USD', name: 'US Dollar', symbol: '$', isMonetary: true }] });

        const { result } = renderHook(() => useUnitDefinitions({ enabled: false }));

        expect(fake.queries).toEqual([null]);
        expect(result.current.data).toEqual([]);
        expect(result.current.isLoading).toBe(true);
    });
});
