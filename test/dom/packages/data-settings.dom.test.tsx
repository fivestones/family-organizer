// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    clearSetting,
    createInstantBackend,
    saveSetting,
    setDataBackend,
    useSetting,
    useStoredSettings,
} from '@family-organizer/data';
import { DEFAULT_COUNTDOWN_SETTINGS, getDefaultScheduleSettings } from '@family-organizer/shared-core';
import { createFakeInstant } from '../../utils/fake-instant';

function bind(initial: Parameters<typeof createFakeInstant>[0] = {}) {
    const fake = createFakeInstant(initial);
    setDataBackend(createInstantBackend(fake.client));
    return fake;
}

describe('settings, over Instant', () => {
    beforeEach(() => {
        bind();
    });

    it('gives each setting its default when the family has never saved it', () => {
        expect(renderHook(() => useSetting('enabledCurrencies')).result.current.data).toEqual(['USD']);
        expect(renderHook(() => useSetting('familyPhoto')).result.current.data).toBeNull();
        expect(renderHook(() => useSetting('dashboardTheme')).result.current.data).toBe('light');
        expect(renderHook(() => useSetting('countdown')).result.current.data).toEqual(DEFAULT_COUNTDOWN_SETTINGS);
        expect(renderHook(() => useSetting('householdSchedule')).result.current.data).toEqual(getDefaultScheduleSettings());
    });

    it('reads what Instant holds: JSON for most settings, the bare word for the theme', () => {
        bind({
            settings: [
                { id: 's1', name: 'enabledCurrencies', value: '["USD","NPR"]' },
                { id: 's2', name: 'dashboard_theme', value: 'dark' },
                { id: 's3', name: 'familyPhotoUrls', value: '{"64":"a.png","320":"b.png","1200":"c.png","stray":1}' },
            ],
        });

        expect(renderHook(() => useSetting('enabledCurrencies')).result.current.data).toEqual(['USD', 'NPR']);
        expect(renderHook(() => useSetting('dashboardTheme')).result.current.data).toBe('dark');
        expect(renderHook(() => useSetting('familyPhoto')).result.current.data).toEqual({ '64': 'a.png', '320': 'b.png', '1200': 'c.png' });
    });

    it('falls back to the default when what is stored cannot be used', () => {
        bind({
            settings: [
                { id: 's1', name: 'enabledCurrencies', value: '{"not":"a list"}' },
                { id: 's2', name: 'dashboard_theme', value: 'neon' },
                { id: 's3', name: 'countdownSettings', value: '{broken' },
            ],
        });

        expect(renderHook(() => useSetting('enabledCurrencies')).result.current.data).toEqual(['USD']);
        expect(renderHook(() => useSetting('dashboardTheme')).result.current.data).toBe('light');
        expect(renderHook(() => useSetting('countdown')).result.current.data).toEqual(DEFAULT_COUNTDOWN_SETTINGS);
    });

    it('takes the first row when a name was stored twice', () => {
        bind({
            settings: [
                { id: 'first', name: 'enabledCurrencies', value: '["NPR"]' },
                { id: 'second', name: 'enabledCurrencies', value: '["USD"]' },
            ],
        });

        expect(renderHook(() => useSetting('enabledCurrencies')).result.current.data).toEqual(['NPR']);
    });

    it('keeps the same value object until the stored value changes', () => {
        bind({ settings: [{ id: 's1', name: 'enabledCurrencies', value: '["USD"]' }] });
        const { result, rerender } = renderHook(() => useSetting('enabledCurrencies'));
        const first = result.current.data;
        rerender();
        expect(result.current.data).toBe(first);
    });

    it('updates a screen that is showing a setting when it is saved', async () => {
        const { result } = renderHook(() => useSetting('enabledCurrencies'));
        expect(result.current.data).toEqual(['USD']);

        await act(() => saveSetting('enabledCurrencies', ['USD', 'NPR']));

        await waitFor(() => expect(result.current.data).toEqual(['USD', 'NPR']));
    });

    it('creates the row on the first save and reuses it afterwards', async () => {
        const fake = bind();

        await saveSetting('enabledCurrencies', ['NPR']);
        await saveSetting('enabledCurrencies', ['NPR', 'USD']);

        expect(fake.rows('settings')).toEqual([{ id: 'generated-1', name: 'enabledCurrencies', value: '["NPR","USD"]' }]);
    });

    it('saves over the row a screen has already read, without asking the server for it first', async () => {
        const fake = bind({ settings: [{ id: 'existing', name: 'householdSchedulingSettings', value: '{}' }] });
        renderHook(() => useSetting('householdSchedule'));

        const schedule = { ...getDefaultScheduleSettings(), dayBoundaryTime: '04:30' };
        await saveSetting('householdSchedule', schedule);

        expect(fake.oneOffQueries).toEqual([]);
        expect(fake.rows('settings')).toHaveLength(1);
        expect(fake.rows('settings')[0].id).toBe('existing');
        expect(JSON.parse(fake.rows('settings')[0].value as string).dayBoundaryTime).toBe('04:30');
    });

    it('saves a setting that has never been saved while offline, as the panels always could', async () => {
        const fake = bind();
        // A screen showing the setting has seen that nothing is stored.
        renderHook(() => useSetting('enabledCurrencies'));
        fake.setOffline(true);

        await saveSetting('enabledCurrencies', ['NPR']);

        expect(fake.oneOffQueries).toEqual([]);
        expect(fake.rows('settings')).toEqual([{ id: 'generated-1', name: 'enabledCurrencies', value: '["NPR"]' }]);
    });

    it('still saves offline when no screen has read the setting yet', async () => {
        const fake = bind();
        fake.setOffline(true);

        await saveSetting('dashboardTheme', 'dark');

        expect(fake.rows('settings')).toEqual([{ id: 'generated-1', name: 'dashboard_theme', value: 'dark' }]);
    });

    it('makes one row when an unset setting is saved twice at once', async () => {
        const fake = bind();

        await Promise.all([saveSetting('enabledCurrencies', ['USD']), saveSetting('enabledCurrencies', ['USD', 'NPR'])]);

        expect(fake.rows('settings')).toEqual([{ id: 'generated-1', name: 'enabledCurrencies', value: '["USD","NPR"]' }]);
    });

    it('follows the row when another device has deleted the setting and saved it again', async () => {
        const fake = bind({ settings: [{ id: 'old', name: 'familyPhotoUrls', value: '{"64":"old.png"}' }] });
        const { result } = renderHook(() => useSetting('familyPhoto'));
        expect(result.current.data).toEqual({ '64': 'old.png' });

        act(() => fake.replaceRows('settings', [{ id: 'new', name: 'familyPhotoUrls', value: '{"64":"theirs.png"}' }]));
        await waitFor(() => expect(result.current.data).toEqual({ '64': 'theirs.png' }));
        await act(() => saveSetting('familyPhoto', { '64': 'mine.png' }));

        expect(fake.rows('settings')).toEqual([{ id: 'new', name: 'familyPhotoUrls', value: '{"64":"mine.png"}' }]);
    });

    it('creates the setting afresh after another device has deleted it', async () => {
        const fake = bind({ settings: [{ id: 'old', name: 'familyPhotoUrls', value: '{"64":"old.png"}' }] });
        const { result } = renderHook(() => useSetting('familyPhoto'));

        act(() => fake.replaceRows('settings', []));
        await waitFor(() => expect(result.current.data).toBeNull());
        await act(() => clearSetting('familyPhoto'));
        expect(fake.transactions).toEqual([]);

        await act(() => saveSetting('familyPhoto', { '64': 'mine.png' }));
        expect(fake.rows('settings')).toEqual([{ id: 'generated-1', name: 'familyPhotoUrls', value: '{"64":"mine.png"}' }]);
    });

    it('stores the theme as the bare word and everything else as JSON', async () => {
        const fake = bind();

        await saveSetting('dashboardTheme', 'dark');
        await saveSetting('familyPhoto', { '64': 'a.png' });

        expect(fake.rows('settings').map((row) => row.value)).toEqual(['dark', '{"64":"a.png"}']);
    });

    it('clears a setting by removing its row, and does nothing when there is none', async () => {
        const fake = bind({ settings: [{ id: 's1', name: 'familyPhotoUrls', value: '{"64":"a.png"}' }] });

        await clearSetting('familyPhoto');
        expect(fake.rows('settings')).toEqual([]);

        const transactionsSoFar = fake.transactions.length;
        await clearSetting('familyPhoto');
        expect(fake.transactions.length).toBe(transactionsSoFar);
    });

    it('holds a read back while it is disabled', () => {
        const fake = bind({ settings: [{ id: 's1', name: 'enabledCurrencies', value: '["NPR"]' }] });

        const { result } = renderHook(() => useSetting('enabledCurrencies', { enabled: false }));

        expect(fake.queries).toEqual([null]);
        expect(result.current.isLoading).toBe(true);
        expect(result.current.data).toEqual(['USD']);
    });

    it('lists every stored setting with its value parsed', () => {
        bind({
            settings: [
                { id: 's1', name: 'enabledCurrencies', value: '["USD"]' },
                { id: 's2', name: 'dashboard_theme', value: 'dark' },
            ],
        });

        expect(renderHook(() => useStoredSettings()).result.current.data).toEqual([
            { name: 'enabledCurrencies', value: ['USD'] },
            { name: 'dashboard_theme', value: 'dark' },
        ]);
    });
});
