import { describe, expect, it } from 'vitest';

describe('apple caldav ics normalization', () => {
    it('indexes timed events by the event timezone instead of the server local timezone', async () => {
        const { parseCalendarResource } = await import('@/lib/apple-caldav/ics');
        const result = parseCalendarResource({
            accountId: 'acct_1',
            calendarId: 'cal_1',
            calendarName: 'Home',
            href: 'https://example.com/event.ics',
            etag: 'etag-1',
            ics: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:tz-test
DTSTART;TZID=America/New_York:20260310T233000
DTEND;TZID=America/New_York:20260311T003000
SUMMARY:Late night
END:VEVENT
END:VCALENDAR`,
            rangeStart: new Date('2026-03-01T00:00:00.000Z'),
            rangeEnd: new Date('2026-03-31T23:59:59.999Z'),
            fallbackTimeZone: 'UTC',
        });

        expect(result).toHaveLength(1);
        expect(result[0].year).toBe(2026);
        expect(result[0].month).toBe(3);
        expect(result[0].dayOfMonth).toBe(10);
        expect(result[0].timeZone).toBe('America/New_York');
    });
});
