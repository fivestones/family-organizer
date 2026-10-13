import { RRule } from 'rrule';

// Whether an event the calendar import holds falls in the window a run looks at. An event is given as the parser
// gives it: its start and end, whether it is a day's event, and its rule and dates as iCalendar writes them.

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDateValue(value: string) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return new Date(`${value}T00:00:00.000Z`);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
}

function normalizeRruleString(value: unknown) {
    return String(value || '').trim().replace(/^RRULE:/i, '');
}

function parseRecurrenceDateToken(token: string) {
    const trimmed = String(token || '').trim();
    if (!trimmed) return null;

    const dateOnlyMatch = trimmed.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    if (dateOnlyMatch) {
        return parseDateValue(`${dateOnlyMatch[1]}-${dateOnlyMatch[2]}-${dateOnlyMatch[3]}`);
    }

    const utcDateTimeMatch = trimmed.match(/^(\d{8}T\d{6}Z)$/i);
    if (utcDateTimeMatch) {
        const compact = utcDateTimeMatch[1].toUpperCase();
        return parseDateValue(
            `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}.000Z`
        );
    }

    const compactDateTimeMatch = trimmed.match(/^(\d{8}T\d{6})$/i);
    if (compactDateTimeMatch) {
        const compact = compactDateTimeMatch[1];
        return parseDateValue(
            `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}`
        );
    }

    return parseDateValue(trimmed);
}

function splitDateTokens(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value.split(',').map((entry) => entry.trim()).filter(Boolean);
    }
    return [];
}

function collectRecurrenceLineTokens(lines: unknown, prefix: 'RDATE' | 'EXDATE'): string[] {
    if (!Array.isArray(lines)) return [];

    const tokens: string[] = [];
    for (const line of lines) {
        if (typeof line !== 'string') continue;
        const trimmed = line.trim();
        if (!trimmed || !trimmed.toUpperCase().startsWith(prefix)) continue;

        const separatorIndex = trimmed.indexOf(':');
        if (separatorIndex < 0) continue;

        tokens.push(
            ...trimmed
                .slice(separatorIndex + 1)
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean)
        );
    }

    return tokens;
}

function buildRecurringOccurrenceStarts(item: any, rangeStart: Date, rangeEnd: Date) {
    const normalizedRule = normalizeRruleString(item?.rrule);
    const start = parseDateValue(item?.startDate);
    const end = parseDateValue(item?.endDate);
    if (!start || !end || !normalizedRule) return [];

    const durationMs = Math.max(0, end.getTime() - start.getTime());
    const searchStart = new Date(rangeStart.getTime() - Math.min(durationMs, 366 * DAY_MS));

    try {
        const ruleOptions = RRule.parseString(normalizedRule);
        const recurrenceDtStart = item?.isAllDay
            ? new Date(Date.UTC(
                start.getUTCFullYear(),
                start.getUTCMonth(),
                start.getUTCDate(),
                start.getUTCHours(),
                start.getUTCMinutes(),
                start.getUTCSeconds(),
                start.getUTCMilliseconds()
            ))
            : start;
        const rule = new RRule({
            ...ruleOptions,
            dtstart: recurrenceDtStart,
        });
        return rule.between(searchStart, rangeEnd, true);
    } catch {
        return [];
    }
}

function recurringCalendarItemIntersectsWindow(item: any, rangeStart: Date, rangeEnd: Date) {
    const start = parseDateValue(item?.startDate);
    const end = parseDateValue(item?.endDate);
    if (!start || !end) return false;

    const durationMs = Math.max(0, end.getTime() - start.getTime());
    const exdateTokens = [
        ...splitDateTokens(item?.exdates),
        ...collectRecurrenceLineTokens(item?.recurrenceLines, 'EXDATE'),
    ];
    const rdateTokens = [
        ...splitDateTokens(item?.rdates),
        ...collectRecurrenceLineTokens(item?.recurrenceLines, 'RDATE'),
    ];
    const excludedDayKeys = new Set<string>();
    const excludedExactTimes = new Set<number>();

    for (const token of exdateTokens) {
        const parsed = parseRecurrenceDateToken(token);
        if (!parsed) continue;
        excludedDayKeys.add(parsed.toISOString().slice(0, 10));
        excludedExactTimes.add(parsed.getTime());
    }

    const occurrenceStarts = [
        ...buildRecurringOccurrenceStarts(item, rangeStart, rangeEnd),
        ...(rdateTokens.map(parseRecurrenceDateToken).filter(Boolean) as Date[]),
    ];
    const seenOccurrenceKeys = new Set<string>();

    for (const occurrenceStart of occurrenceStarts) {
        const occurrenceKey = item?.isAllDay
            ? occurrenceStart.toISOString().slice(0, 10)
            : occurrenceStart.toISOString();
        if (seenOccurrenceKeys.has(occurrenceKey)) continue;
        seenOccurrenceKeys.add(occurrenceKey);

        if (item?.isAllDay) {
            if (excludedDayKeys.has(occurrenceKey)) continue;
        } else if (excludedExactTimes.has(occurrenceStart.getTime())) {
            continue;
        }

        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
        if (occurrenceStart < rangeEnd && occurrenceEnd > rangeStart) {
            return true;
        }
    }

    return false;
}

export function calendarItemIntersectsWindow(item: any, rangeStart: Date, rangeEnd: Date) {
    const start = parseDateValue(item.startDate);
    const end = parseDateValue(item.endDate);
    if (!start || !end) return false;
    if (start < rangeEnd && end > rangeStart) return true;
    if (String(item?.recurringEventId || '').trim()) return false;
    if (!normalizeRruleString(item?.rrule) && splitDateTokens(item?.rdates).length === 0 && collectRecurrenceLineTokens(item?.recurrenceLines, 'RDATE').length === 0) {
        return false;
    }
    return recurringCalendarItemIntersectsWindow(item, rangeStart, rangeEnd);
}
