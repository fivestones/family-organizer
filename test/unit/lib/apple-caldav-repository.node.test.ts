import { describe, expect, it } from 'vitest';

describe('apple caldav repository helpers', () => {
    it('only treats imported rows inside the sync window as deletion candidates', async () => {
        const { calendarItemIntersectsWindow } = await import('@/lib/apple-caldav/repository');
        const rangeStart = new Date('2026-03-01T00:00:00.000Z');
        const rangeEnd = new Date('2026-03-31T23:59:59.999Z');

        expect(
            calendarItemIntersectsWindow(
                { startDate: '2026-03-10T13:00:00.000Z', endDate: '2026-03-10T14:00:00.000Z' },
                rangeStart,
                rangeEnd
            )
        ).toBe(true);

        expect(
            calendarItemIntersectsWindow(
                { startDate: '2027-05-10T13:00:00.000Z', endDate: '2027-05-10T14:00:00.000Z' },
                rangeStart,
                rangeEnd
            )
        ).toBe(false);
    });
});
