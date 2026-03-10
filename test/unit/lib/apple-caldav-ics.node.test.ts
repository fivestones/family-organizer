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

    it('uses a per-import unique uid while preserving the raw Apple uid in xProps', async () => {
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
UID:shared-apple-uid
DTSTART:20260310T120000Z
DTEND:20260310T130000Z
SUMMARY:Imported event
END:VEVENT
END:VCALENDAR`,
            rangeStart: new Date('2026-03-01T00:00:00.000Z'),
            rangeEnd: new Date('2026-03-31T23:59:59.999Z'),
            fallbackTimeZone: 'UTC',
        });

        expect(result).toHaveLength(1);
        expect(result[0].sourceExternalId).toBe('apple:acct_1:cal_1:shared-apple-uid:single');
        expect(result[0].uid).toBe(result[0].sourceExternalId);
        expect(result[0].xProps?.appleUid).toBe('shared-apple-uid');
    });

    it('strips RRULE data from materialized recurring occurrences so the UI does not expand them again', async () => {
        const { parseCalendarResource } = await import('@/lib/apple-caldav/ics');
        const result = parseCalendarResource({
            accountId: 'acct_1',
            calendarId: 'cal_1',
            calendarName: 'Home',
            href: 'https://example.com/weekly.ics',
            etag: 'etag-weekly',
            ics: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:weekly-study
DTSTART:20260310T120000Z
DTEND:20260310T130000Z
RRULE:FREQ=WEEKLY;COUNT=3
SUMMARY:Bible study
END:VEVENT
END:VCALENDAR`,
            rangeStart: new Date('2026-03-01T00:00:00.000Z'),
            rangeEnd: new Date('2026-03-31T23:59:59.999Z'),
            fallbackTimeZone: 'UTC',
        });

        expect(result).toHaveLength(3);
        for (const occurrence of result) {
            expect(occurrence.rrule).toBe('');
            expect(occurrence.rdates).toEqual([]);
            expect(occurrence.exdates).toEqual([]);
            expect(occurrence.recurrenceLines).toEqual([]);
            expect(occurrence.recurringEventId).toBe('apple:acct_1:cal_1:weekly-study');
            expect(occurrence.recurrenceId).not.toBe('');
        }
    });
});
