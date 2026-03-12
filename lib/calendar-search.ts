import { format, parseISO } from 'date-fns';
import {
    type CalendarFilterDateRange,
    type CalendarPersistentFilters,
    type CalendarTagExpression,
    createEmptyCalendarTagExpression,
} from '@/lib/calendar-controls';

export interface SearchableCalendarTagLike {
    id?: string | null;
    name?: string | null;
}

export interface SearchableCalendarItemLike {
    id?: string | null;
    title?: string | null;
    description?: string | null;
    location?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    isAllDay?: boolean | null;
    tags?: SearchableCalendarTagLike[] | null;
    recurrenceId?: string | null;
    __displayDate?: string | null;
    [key: string]: unknown;
}

export interface CalendarAgendaSection<T extends SearchableCalendarItemLike = SearchableCalendarItemLike> {
    dateKey: string;
    items: T[];
}

const normalizeToken = (value: unknown) => String(value || '').trim();

const normalizeLowerText = (value: unknown) =>
    normalizeToken(value)
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();

const parseCalendarDateValue = (value: string | null | undefined) => {
    const normalized = normalizeToken(value);
    if (!normalized) return null;
    const parsed = parseISO(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDayKey = (value: Date) => format(value, 'yyyy-MM-dd');

export const buildCalendarOccurrenceKey = (
    item: Pick<SearchableCalendarItemLike, 'id' | 'startDate' | 'recurrenceId' | '__displayDate'>
) => {
    const occurrenceToken =
        normalizeToken(item.recurrenceId) || normalizeToken(item.__displayDate) || normalizeToken(item.startDate);
    return `${normalizeToken(item.id)}::${occurrenceToken}`;
};

export const getCalendarOccurrenceDateKey = (item: Pick<SearchableCalendarItemLike, 'startDate' | '__displayDate'>) => {
    const displayKey = normalizeToken(item.__displayDate);
    if (displayKey) return displayKey;
    const start = parseCalendarDateValue(item.startDate);
    return start ? toDayKey(start) : normalizeToken(item.startDate);
};

export const buildCalendarSearchableText = (item: SearchableCalendarItemLike) => {
    const tagNames = Array.isArray(item.tags) ? item.tags.map((tag) => normalizeToken(tag?.name)).filter(Boolean) : [];
    return normalizeLowerText([item.title, item.description, item.location, tagNames.join(' ')].filter(Boolean).join(' '));
};

export const normalizeCalendarSearchQuery = (value: string) => normalizeLowerText(value);

export const calendarItemMatchesTextQuery = (item: SearchableCalendarItemLike, query: string) => {
    const normalizedQuery = normalizeCalendarSearchQuery(query);
    if (!normalizedQuery) return true;
    return buildCalendarSearchableText(item).includes(normalizedQuery);
};

export const getCalendarItemTagIds = (item: SearchableCalendarItemLike) =>
    Array.from(
        new Set(
            (Array.isArray(item.tags) ? item.tags : [])
                .map((tag) => normalizeToken(tag?.id))
                .filter(Boolean)
        )
    );

export const normalizeCalendarTagExpression = (
    expression?: Partial<CalendarTagExpression> | null
): CalendarTagExpression => {
    const fallback = createEmptyCalendarTagExpression();
    const anyOf = Array.isArray(expression?.anyOf)
        ? expression.anyOf
              .map((group) =>
                  Array.from(
                      new Set((Array.isArray(group) ? group : []).map((value) => normalizeToken(value)).filter(Boolean))
                  )
              )
              .filter((group) => group.length > 0)
        : fallback.anyOf;
    const exclude = Array.from(
        new Set((Array.isArray(expression?.exclude) ? expression?.exclude : []).map((value) => normalizeToken(value)).filter(Boolean))
    );

    return {
        anyOf,
        exclude,
    };
};

export const createFlatOrTagExpression = (tagIds: string[]): CalendarTagExpression => ({
    anyOf: Array.from(
        new Set(tagIds.map((value) => normalizeToken(value)).filter(Boolean))
    ).map((value) => [value]),
    exclude: [],
});

export const flattenCalendarTagExpressionIds = (expression?: CalendarTagExpression | null) => {
    const normalized = normalizeCalendarTagExpression(expression);
    return Array.from(new Set([...normalized.exclude, ...normalized.anyOf.flat()]));
};

export const calendarItemMatchesTagExpression = (
    item: SearchableCalendarItemLike,
    expression?: CalendarTagExpression | null
) => {
    const normalizedExpression = normalizeCalendarTagExpression(expression);
    const itemTagIds = new Set(getCalendarItemTagIds(item));

    if (normalizedExpression.exclude.some((tagId) => itemTagIds.has(tagId))) {
        return false;
    }

    if (normalizedExpression.anyOf.length === 0) {
        return true;
    }

    return normalizedExpression.anyOf.some((group) => group.every((tagId) => itemTagIds.has(tagId)));
};

export const isCalendarDateRangeFilterActive = (dateRange?: CalendarFilterDateRange | null) => {
    const mode = dateRange?.mode || 'any';
    if (mode === 'any') return false;
    if (mode === 'before') return normalizeToken(dateRange?.endDate || dateRange?.startDate).length > 0;
    if (mode === 'after') return normalizeToken(dateRange?.startDate || dateRange?.endDate).length > 0;
    return normalizeToken(dateRange?.startDate).length > 0 || normalizeToken(dateRange?.endDate).length > 0;
};

export const getCalendarItemInclusiveDaySpan = (
    item: Pick<SearchableCalendarItemLike, 'startDate' | 'endDate' | 'isAllDay'>
) => {
    const start = parseCalendarDateValue(item.startDate);
    const end = parseCalendarDateValue(item.endDate);
    if (!start || !end) return null;

    const startDay = toDayKey(start);
    if (item.isAllDay) {
        const inclusiveEnd = new Date(end.getTime() - 1);
        return {
            startDay,
            endDay: toDayKey(inclusiveEnd),
        };
    }

    return {
        startDay,
        endDay: toDayKey(end),
    };
};

export const calendarItemOverlapsDateRange = (
    item: Pick<SearchableCalendarItemLike, 'startDate' | 'endDate' | 'isAllDay'>,
    dateRange?: CalendarFilterDateRange | null
) => {
    if (!isCalendarDateRangeFilterActive(dateRange)) {
        return true;
    }

    const span = getCalendarItemInclusiveDaySpan(item);
    if (!span) return false;

    const mode = dateRange?.mode || 'any';
    if (mode === 'before') {
        const boundary = normalizeToken(dateRange?.endDate || dateRange?.startDate);
        return !boundary || span.startDay <= boundary;
    }

    if (mode === 'after') {
        const boundary = normalizeToken(dateRange?.startDate || dateRange?.endDate);
        return !boundary || span.endDay >= boundary;
    }

    const startBoundary = normalizeToken(dateRange?.startDate);
    const endBoundary = normalizeToken(dateRange?.endDate);
    const effectiveStart = startBoundary || endBoundary;
    const effectiveEnd = endBoundary || startBoundary;
    if (!effectiveStart && !effectiveEnd) return true;
    return span.startDay <= effectiveEnd && span.endDay >= effectiveStart;
};

export const calendarItemMatchesPersistentFilters = (
    item: SearchableCalendarItemLike,
    filters: CalendarPersistentFilters
) =>
    calendarItemMatchesTextQuery(item, filters.textQuery) &&
    calendarItemOverlapsDateRange(item, filters.dateRange) &&
    calendarItemMatchesTagExpression(item, filters.tagExpression);

export const buildCalendarAgendaSections = <T extends SearchableCalendarItemLike>(
    itemsByDate: Map<string, T[]>,
    options?: {
        textQuery?: string;
    }
): CalendarAgendaSection<T>[] => {
    const normalizedQuery = normalizeCalendarSearchQuery(options?.textQuery || '');
    return Array.from(itemsByDate.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([dateKey, items]) => ({
            dateKey,
            items: normalizedQuery ? items.filter((item) => calendarItemMatchesTextQuery(item, normalizedQuery)) : items,
        }))
        .filter((section) => section.items.length > 0);
};

export const getClosestCalendarHitMinute = (
    item: Pick<SearchableCalendarItemLike, 'startDate' | 'endDate' | 'isAllDay'>,
    dayKey: string
) => {
    if (item.isAllDay) return null;
    const start = parseCalendarDateValue(item.startDate);
    const end = parseCalendarDateValue(item.endDate);
    if (!start || !end) return null;

    const dayStart = parseCalendarDateValue(`${dayKey}T00:00:00`);
    if (!dayStart) return null;

    const dayStartMs = dayStart.getTime();
    const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;
    const segmentStartMs = Math.max(start.getTime(), dayStartMs);
    const segmentEndMs = Math.min(end.getTime(), dayEndMs);
    if (segmentEndMs <= segmentStartMs) return null;

    return Math.max(0, Math.floor((segmentStartMs - dayStartMs) / 60000));
};
