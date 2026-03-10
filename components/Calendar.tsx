'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from '../styles/Calendar.module.css';
import {
    addDays,
    addMonths,
    addWeeks,
    differenceInCalendarMonths,
    differenceInDays,
    endOfMonth,
    endOfWeek,
    format,
    getDate,
    getMonth,
    parseISO,
    startOfMonth,
    startOfWeek,
} from 'date-fns';
import { id, tx } from '@instantdb/react';
import NepaliDate from 'nepali-date-converter';
import { RRule } from 'rrule';
import AddEventForm from './AddEvent';
import CalendarWeekSpanOverlay, { getWeekSpanReservedHeightData } from './CalendarWeekSpanOverlay';
import YearCalendarView from './YearCalendarView';
import MiniInfiniteCalendarView from './MiniInfiniteCalendarView';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import localFont from 'next/font/local';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { DroppableDayCell } from './DroppableDayCell'; // Import new component
// Import the component and the interface
import { DraggableCalendarEvent, CalendarItem } from './DraggableCalendarEvent';
import { RecurrenceScopeDialog, type RecurrenceEditScope, type RecurrenceSeriesScopeMode } from './RecurrenceScopeDialog';
import { db } from '@/lib/db';
import { getAssignedMembersForChoreOnDate, type Chore } from '@/lib/chore-utils';
import { cn } from '@/lib/utils';
import {
    CALENDAR_COMMAND_EVENT,
    CALENDAR_DAY_HEIGHT_DEFAULT,
    CALENDAR_DAY_HEIGHT_MAX,
    CALENDAR_DAY_HEIGHT_MIN,
    CALENDAR_DAY_HEIGHT_STORAGE_KEY,
    CALENDAR_MINI_VISIBLE_WEEKS,
    CALENDAR_SHOW_CHORES_STORAGE_KEY,
    CALENDAR_STATE_EVENT,
    CALENDAR_VISIBLE_WEEKS_MAX,
    CALENDAR_VISIBLE_WEEKS_MIN,
    CALENDAR_VIEW_MODE_STORAGE_KEY,
    CALENDAR_YEAR_FONT_SCALE_DEFAULT,
    CALENDAR_YEAR_FONT_SCALE_STORAGE_KEY,
    CALENDAR_YEAR_MONTH_BASIS_STORAGE_KEY,
    clampCalendarYearFontScale,
    type CalendarViewMode,
    type CalendarYearMonthBasis,
    type CalendarCommandDetail,
    type CalendarStateDetail,
} from '@/lib/calendar-controls';
import {
    NEPALI_MONTHS_COMMON_DEVANAGARI,
    NEPALI_MONTHS_COMMON_ROMAN,
    toDevanagariDigits,
} from '@/lib/calendar-display';
import {
    buildYearCalendarMonthDescriptors,
    calculateYearCalendarLayout,
} from '@/lib/calendar-year-layout';
import { buildMemberColorMap } from '@/lib/family-member-colors';

const ebGaramond = localFont({
    src: '../public/fonts/EBGaramond-Regular.ttf',
    weight: '400',
    display: 'swap',
});

type CalendarVariant = 'default' | 'miniInfinite';

interface CalendarProps {
    currentDate?: Date;
    numWeeks?: number;
    displayBS?: boolean;
    variant?: CalendarVariant;
    className?: string;
    style?: React.CSSProperties;
    showGregorianDays?: boolean;
    showBsDays?: boolean;
    showChores?: boolean;
    everyoneSelected?: boolean;
    selectedMemberIds?: string[];
    selectedChoreIds?: string[];
    dayHeight?: number;
    eventFontScale?: number;
    commandBusEnabled?: boolean;
}

interface MonthLabel {
    key: string;
    gregorianMonth: string;
    gregorianYear: string;
    nepaliMonth: string;
    nepaliYearDevanagari: string;
}

interface PendingScrollAdjust {
    prevScrollTop: number;
    prevScrollHeight: number;
    anchorSelector?: string | null;
    anchorOffset?: number | null;
}

type RecurrenceDragForcedScope = Exclude<RecurrenceEditScope, 'cancel'>;

interface DragRecurrenceIndicatorState {
    x: number;
    y: number;
    label: string;
    hotkeyLabel: string;
}

interface CalendarWeekSpanSegment {
    segmentKey: string;
    item: CalendarItem;
    startCol: number;
    endCol: number;
    continuesBefore: boolean;
    continuesAfter: boolean;
}

interface CalendarMemberWithColor {
    id?: string | null;
    name?: string | null;
    color?: string | null;
}

const WEEK_STARTS_ON = 0;
const WEEKS_PER_LOAD = 8;
const MONTH_MEMORY_CAP = 240;
const MEMORY_CAP_WEEKS = Math.round((MONTH_MEMORY_CAP * 365.2425) / 12 / 7);
const MONTH_FADE_MS = 260;
const EDGE_TRIGGER_PX = 220;
const EDGE_LOAD_COOLDOWN_MS = 220;
const MONTH_BOX_HORIZONTAL_PADDING = 16;
const MONTH_BOX_VERTICAL_PADDING = 10;

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const shouldRetryLegacyCalendarMutation = (error: unknown) => {
    const message = String((error as any)?.message || '').toLowerCase();
    return message.includes('permission denied') || message.includes('mutation failed') || message.includes('attrs');
};

const getCalendarItemStartTime = (item: CalendarItem) => {
    const parsed = parseISO(item.startDate);
    return Number.isNaN(parsed.getTime()) ? Number.POSITIVE_INFINITY : parsed.getTime();
};

const getCalendarItemEndTime = (item: CalendarItem) => {
    const parsed = parseISO(item.endDate);
    return Number.isNaN(parsed.getTime()) ? Number.POSITIVE_INFINITY : parsed.getTime();
};

const getCalendarItemDisplayPriority = (item: CalendarItem) => {
    const isChore = item.calendarItemKind === 'chore';
    const isAllDay = item.isAllDay;

    if (!isChore && isAllDay) return 0;
    if (!isChore) return 1;
    if (isAllDay) return 2;
    return 3;
};

const compareCalendarItemsByStartTime = (left: CalendarItem, right: CalendarItem) => {
    const priorityDiff = getCalendarItemDisplayPriority(left) - getCalendarItemDisplayPriority(right);
    if (priorityDiff !== 0) return priorityDiff;

    const startDiff = getCalendarItemStartTime(left) - getCalendarItemStartTime(right);
    if (startDiff !== 0) return startDiff;

    const endDiff = getCalendarItemEndTime(left) - getCalendarItemEndTime(right);
    if (endDiff !== 0) return endDiff;

    return String(left.title || '').localeCompare(String(right.title || ''));
};

const getUtcDateFromDateKey = (dateKey: string) => {
    const parsed = new Date(`${dateKey}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const toDayStart = (value: Date) => parseISO(`${format(value, 'yyyy-MM-dd')}T00:00:00`);

const getInclusiveEndDayStart = (exclusiveEnd: Date) => {
    const inclusiveEnd = new Date(exclusiveEnd.getTime() - 1);
    return toDayStart(inclusiveEnd);
};

const assignWeekSpanLanes = (segments: CalendarWeekSpanSegment[]) => {
    const sortedSegments = [...segments].sort((left, right) => {
        const startDiff = left.startCol - right.startCol;
        if (startDiff !== 0) return startDiff;

        const widthDiff = right.endCol - left.endCol;
        if (widthDiff !== 0) return widthDiff;

        return compareCalendarItemsByStartTime(left.item, right.item);
    });

    const laneEndColumns: number[] = [];
    const lanes: CalendarWeekSpanSegment[][] = [];
    for (const segment of sortedSegments) {
        let laneIndex = 0;
        while (laneIndex < laneEndColumns.length && laneEndColumns[laneIndex] >= segment.startCol) {
            laneIndex += 1;
        }

        laneEndColumns[laneIndex] = segment.endCol;
        if (!lanes[laneIndex]) {
            lanes[laneIndex] = [];
        }
        lanes[laneIndex].push(segment);
    }

    return lanes;
};

const normalizeRruleString = (value: string) => String(value || '').trim().replace(/^RRULE:/i, '');
const getRecurringSeriesLinkKeys = (masterEvent: CalendarItem | null | undefined) => {
    const keys: string[] = [];
    const pushKey = (value: unknown) => {
        const next = String(value || '').trim();
        if (!next || keys.includes(next)) return;
        keys.push(next);
    };

    pushKey(masterEvent?.id);
    pushKey((masterEvent as any)?.sourceExternalId);

    return keys;
};

const isRecurringChildOfMaster = (item: CalendarItem | null | undefined, masterEvent: CalendarItem | null | undefined) => {
    const parentId = String(item?.recurringEventId || '').trim();
    if (!parentId) return false;
    return getRecurringSeriesLinkKeys(masterEvent).includes(parentId);
};
const RRULE_WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const RRULE_WEEKDAY_TOKEN_PATTERN = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/i;

const parseRecurrenceDateToken = (token: string): Date | null => {
    const trimmed = token.trim();
    if (!trimmed) return null;

    const compactDate = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compactDate) {
        const [, year, month, day] = compactDate;
        const parsed = parseISO(`${year}-${month}-${day}`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const compactUtcDateTime = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (compactUtcDateTime) {
        const [, year, month, day, hours, minutes, seconds] = compactUtcDateTime;
        const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds)));
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const compactLocalDateTime = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    if (compactLocalDateTime) {
        const [, year, month, day, hours, minutes, seconds] = compactLocalDateTime;
        const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const isoParsed = parseISO(trimmed);
    if (!Number.isNaN(isoParsed.getTime())) {
        return isoParsed;
    }

    const nativeParsed = new Date(trimmed);
    return Number.isNaN(nativeParsed.getTime()) ? null : nativeParsed;
};

const splitDateTokens = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value
            .map((entry) => String(entry || '').trim())
            .filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean);
    }

    return [];
};

const collectRecurrenceLineTokens = (lines: unknown, prefix: 'RDATE' | 'EXDATE'): string[] => {
    if (!Array.isArray(lines)) return [];

    const tokens: string[] = [];
    for (const line of lines) {
        if (typeof line !== 'string') continue;
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (!trimmed.toUpperCase().startsWith(prefix)) continue;

        const separatorIndex = trimmed.indexOf(':');
        if (separatorIndex < 0) continue;

        const valuePart = trimmed.slice(separatorIndex + 1);
        tokens.push(
            ...valuePart
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean)
        );
    }

    return tokens;
};

type RecurrenceExceptionMode = 'date' | 'range';

interface StoredRecurrenceExceptionRow {
    mode: RecurrenceExceptionMode;
    date: string;
    rangeStart: string;
    rangeEnd: string;
}

const parseDateOnlyToken = (token: string): string | null => {
    const trimmed = token.trim();
    if (!trimmed) return null;

    const hyphenDateMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    if (hyphenDateMatch) {
        const parsed = parseISO(`${hyphenDateMatch[1]}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : hyphenDateMatch[1];
    }

    const compactDateMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})/);
    if (compactDateMatch) {
        const normalized = `${compactDateMatch[1]}-${compactDateMatch[2]}-${compactDateMatch[3]}`;
        const parsed = parseISO(`${normalized}T00:00:00`);
        return Number.isNaN(parsed.getTime()) ? null : normalized;
    }

    const parsed = parseISO(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return format(parsed, 'yyyy-MM-dd');
};

const formatIcsDateTimeUtc = (value: Date) => {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    const hours = String(value.getUTCHours()).padStart(2, '0');
    const minutes = String(value.getUTCMinutes()).padStart(2, '0');
    const seconds = String(value.getUTCSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
};

const capRruleBeforeOccurrence = (rruleValue: string, occurrenceStart: Date, isAllDay: boolean) => {
    const normalized = normalizeRruleString(rruleValue);
    if (!normalized) return '';

    const rawParts = normalized
        .replace(/^RRULE:/i, '')
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean);

    if (rawParts.length === 0) return normalized;

    const withoutEndParts = rawParts.filter((entry) => {
        const upper = entry.toUpperCase();
        return !upper.startsWith('COUNT=') && !upper.startsWith('UNTIL=');
    });

    if (withoutEndParts.length === 0) return normalized;

    const untilDate = isAllDay ? addDays(new Date(occurrenceStart), -1) : new Date(occurrenceStart.getTime() - 1000);
    const untilToken = isAllDay ? format(untilDate, 'yyyyMMdd') : formatIcsDateTimeUtc(untilDate);

    return `RRULE:${[...withoutEndParts, `UNTIL=${untilToken}`].join(';')}`;
};

const normalizeRecurrenceTokens = (tokens: string[]) => {
    const deduped = Array.from(new Set(tokens.map((entry) => String(entry || '').trim()).filter(Boolean)));
    return deduped.sort((left, right) => {
        const leftDate = parseRecurrenceDateToken(left);
        const rightDate = parseRecurrenceDateToken(right);
        if (leftDate && rightDate) {
            const diff = leftDate.getTime() - rightDate.getTime();
            if (diff !== 0) return diff;
        }
        if (leftDate && !rightDate) return -1;
        if (!leftDate && rightDate) return 1;
        return left.localeCompare(right);
    });
};

const partitionRecurrenceTokensByBoundary = (tokens: string[], boundary: Date, isAllDay: boolean) => {
    const before: string[] = [];
    const onOrAfter: string[] = [];
    const boundaryTime = isAllDay ? parseISO(`${format(boundary, 'yyyy-MM-dd')}T00:00:00`).getTime() : boundary.getTime();

    for (const token of normalizeRecurrenceTokens(tokens)) {
        const parsed = parseRecurrenceDateToken(token);
        if (!parsed) {
            before.push(token);
            continue;
        }
        const tokenTime = isAllDay ? parseISO(`${format(parsed, 'yyyy-MM-dd')}T00:00:00`).getTime() : parsed.getTime();
        if (tokenTime < boundaryTime) {
            before.push(token);
        } else {
            onOrAfter.push(token);
        }
    }

    return {
        before: normalizeRecurrenceTokens(before),
        onOrAfter: normalizeRecurrenceTokens(onOrAfter),
    };
};

const buildRecurrenceLines = (rrule: string, rdates: string[], exdates: string[]) => {
    const lines: string[] = [];
    if (rrule) lines.push(rrule);
    if (rdates.length > 0) lines.push(`RDATE:${rdates.join(',')}`);
    if (exdates.length > 0) lines.push(`EXDATE:${exdates.join(',')}`);
    return lines;
};

const shiftWeekdayCode = (code: string, deltaDays: number) => {
    const index = RRULE_WEEKDAY_CODES.indexOf(code as (typeof RRULE_WEEKDAY_CODES)[number]);
    if (index < 0) return code;
    const normalizedDelta = ((deltaDays % 7) + 7) % 7;
    return RRULE_WEEKDAY_CODES[(index + normalizedDelta) % RRULE_WEEKDAY_CODES.length];
};

const getOrdinalWithinMonth = (value: Date, preferLast: boolean) => {
    if (preferLast) {
        const nextWeekSameWeekday = addDays(value, 7);
        if (nextWeekSameWeekday.getMonth() !== value.getMonth()) {
            return -1;
        }
    }

    return Math.ceil(value.getDate() / 7);
};

const wrapMonthNumber = (value: number) => ((((value - 1) % 12) + 12) % 12) + 1;

const shiftMonthDayValue = (rawValue: number, dayDelta: number, destinationDate: Date) => {
    if (!Number.isFinite(rawValue)) {
        return rawValue;
    }
    if (rawValue === -1) {
        return destinationDate.getDate();
    }
    return Math.min(31, Math.max(1, Math.trunc(rawValue + dayDelta)));
};

const shiftRecurrenceTokenByDays = (token: string, dayDelta: number, preferDateOnly: boolean) => {
    const parsed = parseRecurrenceDateToken(token);
    if (!parsed || dayDelta === 0) {
        return token;
    }

    const shifted = addDays(parsed, dayDelta);
    if (/^\d{8}$/.test(token.trim())) {
        return format(shifted, 'yyyyMMdd');
    }
    if (/^\d{8}T\d{6}Z$/i.test(token.trim())) {
        return formatIcsDateTimeUtc(shifted);
    }
    if (/^\d{8}T\d{6}$/i.test(token.trim())) {
        return format(shifted, "yyyyMMdd'T'HHmmss");
    }
    if (preferDateOnly || /^\d{4}-\d{2}-\d{2}$/.test(token.trim())) {
        return format(shifted, 'yyyy-MM-dd');
    }
    if (token.includes('T') || token.includes('Z')) {
        return shifted.toISOString();
    }
    return format(shifted, 'yyyy-MM-dd');
};

const shiftStoredRecurrenceRowsByDays = (rows: StoredRecurrenceExceptionRow[], dayDelta: number) => {
    if (dayDelta === 0) return rows;
    return rows.map((row) => ({
        ...row,
        date: shiftRecurrenceTokenByDays(row.date, dayDelta, true),
        rangeStart: shiftRecurrenceTokenByDays(row.rangeStart, dayDelta, true),
        rangeEnd: shiftRecurrenceTokenByDays(row.rangeEnd, dayDelta, true),
    }));
};

const shiftRruleForSeriesMove = (rruleValue: string, sourceStart: Date, destinationStart: Date) => {
    const normalized = normalizeRruleString(rruleValue);
    if (!normalized) return '';

    const rawParts = normalized
        .replace(/^RRULE:/i, '')
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (rawParts.length === 0) {
        return normalized;
    }

    const partMap = new Map<string, string>();
    for (const part of rawParts) {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex < 0) continue;
        const key = part.slice(0, separatorIndex).trim().toUpperCase();
        const value = part.slice(separatorIndex + 1).trim();
        if (!key || !value) continue;
        partMap.set(key, value);
    }

    const weekdayDelta = destinationStart.getDay() - sourceStart.getDay();
    const dayOfMonthDelta = destinationStart.getDate() - sourceStart.getDate();
    const monthDelta = differenceInCalendarMonths(destinationStart, sourceStart);
    const freq = String(partMap.get('FREQ') || '').toUpperCase();
    const bydayValue = partMap.get('BYDAY');
    const bysetposValue = partMap.get('BYSETPOS');
    const bymonthdayValue = partMap.get('BYMONTHDAY');
    const bymonthValue = partMap.get('BYMONTH');

    if (bydayValue) {
        const tokens = bydayValue
            .split(',')
            .map((entry) => entry.trim().toUpperCase())
            .filter(Boolean);
        const parsedTokens = tokens
            .map((token) => {
                const match = token.match(RRULE_WEEKDAY_TOKEN_PATTERN);
                if (!match) return null;
                return { ordinal: match[1] || '', weekday: match[2].toUpperCase() };
            })
            .filter(Boolean) as Array<{ ordinal: string; weekday: string }>;

        if (parsedTokens.length === tokens.length && tokens.length > 0) {
            if ((freq === 'MONTHLY' || freq === 'YEARLY') && (bysetposValue || parsedTokens.some((entry) => entry.ordinal))) {
                const destinationWeekday = RRULE_WEEKDAY_CODES[destinationStart.getDay()];
                if (bysetposValue) {
                    const parsedBysetpos = Number(bysetposValue);
                    const nextOrdinal = getOrdinalWithinMonth(destinationStart, parsedBysetpos === -1);
                    partMap.set('BYDAY', destinationWeekday);
                    partMap.set('BYSETPOS', String(nextOrdinal));
                } else {
                    const sourceOrdinal = Number(parsedTokens[0]?.ordinal || '1');
                    const nextOrdinal = getOrdinalWithinMonth(destinationStart, sourceOrdinal === -1);
                    partMap.set('BYDAY', `${nextOrdinal === -1 ? '-1' : String(nextOrdinal)}${destinationWeekday}`);
                }
            } else if (weekdayDelta !== 0) {
                partMap.set(
                    'BYDAY',
                    parsedTokens.map((entry) => `${entry.ordinal}${shiftWeekdayCode(entry.weekday, weekdayDelta)}`).join(',')
                );
            }
        }
    }

    if (bymonthdayValue && (freq === 'MONTHLY' || freq === 'YEARLY')) {
        const shiftedMonthDays = bymonthdayValue
            .split(',')
            .map((entry) => Number(entry.trim()))
            .filter((entry) => Number.isFinite(entry))
            .map((entry) => shiftMonthDayValue(entry, dayOfMonthDelta, destinationStart))
            .filter((entry, index, all) => all.indexOf(entry) === index)
            .sort((left, right) => {
                if (left === -1) return 1;
                if (right === -1) return -1;
                return left - right;
            });
        if (shiftedMonthDays.length > 0) {
            partMap.set('BYMONTHDAY', shiftedMonthDays.join(','));
        }
    }

    if (bymonthValue && monthDelta !== 0) {
        const shiftedMonths = bymonthValue
            .split(',')
            .map((entry) => Number(entry.trim()))
            .filter((entry) => Number.isFinite(entry))
            .map((entry) => wrapMonthNumber(entry + monthDelta))
            .filter((entry, index, all) => all.indexOf(entry) === index)
            .sort((left, right) => left - right);
        if (shiftedMonths.length > 0) {
            partMap.set('BYMONTH', shiftedMonths.join(','));
        }
    }

    const rebuiltParts = rawParts.map((part) => {
        const separatorIndex = part.indexOf('=');
        if (separatorIndex < 0) return part;
        const key = part.slice(0, separatorIndex).trim().toUpperCase();
        const nextValue = partMap.get(key);
        return nextValue ? `${key}=${nextValue}` : part;
    });

    return `RRULE:${rebuiltParts.join(';')}`;
};

const normalizeStoredRecurrenceExceptionRows = (value: unknown): StoredRecurrenceExceptionRow[] => {
    if (!Array.isArray(value)) return [];

    const rows: StoredRecurrenceExceptionRow[] = [];
    for (const row of value) {
        if (!row || typeof row !== 'object') continue;
        const source = row as Record<string, unknown>;
        const mode = String(source.mode || '').toLowerCase();

        if (mode === 'range') {
            const start = parseDateOnlyToken(String(source.rangeStart || source.start || ''));
            const end = parseDateOnlyToken(String(source.rangeEnd || source.end || ''));
            if (!start || !end) continue;
            const [rangeStart, rangeEnd] = start.localeCompare(end) <= 0 ? [start, end] : [end, start];
            rows.push({
                mode: 'range',
                date: rangeStart,
                rangeStart,
                rangeEnd,
            });
            continue;
        }

        const date = parseDateOnlyToken(String(source.date || source.rangeStart || source.start || ''));
        if (!date) continue;
        rows.push({
            mode: 'date',
            date,
            rangeStart: date,
            rangeEnd: date,
        });
    }

    return rows;
};

const splitRecurrenceRowsAtBoundary = (rows: StoredRecurrenceExceptionRow[], boundaryDateOnly: string) => {
    const before: StoredRecurrenceExceptionRow[] = [];
    const onOrAfter: StoredRecurrenceExceptionRow[] = [];

    for (const row of rows) {
        if (row.mode === 'date') {
            if (row.date.localeCompare(boundaryDateOnly) < 0) {
                before.push(row);
            } else {
                onOrAfter.push(row);
            }
            continue;
        }

        const start = row.rangeStart;
        const end = row.rangeEnd;
        if (end.localeCompare(boundaryDateOnly) < 0) {
            before.push(row);
            continue;
        }
        if (start.localeCompare(boundaryDateOnly) >= 0) {
            onOrAfter.push(row);
            continue;
        }

        const boundaryDate = parseISO(`${boundaryDateOnly}T00:00:00`);
        if (Number.isNaN(boundaryDate.getTime())) continue;
        const dayBeforeBoundary = format(addDays(boundaryDate, -1), 'yyyy-MM-dd');

        before.push({
            mode: 'range',
            date: start,
            rangeStart: start,
            rangeEnd: dayBeforeBoundary,
        });
        onOrAfter.push({
            mode: 'range',
            date: boundaryDateOnly,
            rangeStart: boundaryDateOnly,
            rangeEnd: end,
        });
    }

    return { before, onOrAfter };
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (value == null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const valuesEqual = (left: unknown, right: unknown) => {
    if (left === right) return true;

    if (left == null || right == null) {
        return left == null && right == null;
    }

    if (Array.isArray(left) || Array.isArray(right)) {
        if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
            return false;
        }

        const leftAreIdObjects = left.every((entry) => isPlainObject(entry) && typeof entry.id === 'string');
        const rightAreIdObjects = right.every((entry) => isPlainObject(entry) && typeof entry.id === 'string');
        if (leftAreIdObjects && rightAreIdObjects) {
            const leftById = new Map(left.map((entry) => [String((entry as { id: string }).id), entry] as const));
            return right.every((entry) => {
                const match = leftById.get(String((entry as { id: string }).id));
                return match !== undefined && valuesEqual(match, entry);
            });
        }

        return right.every((entry, index) => valuesEqual(left[index], entry));
    }

    if (isPlainObject(left) && isPlainObject(right)) {
        return Object.entries(right).every(([key, value]) => valuesEqual(left[key], value));
    }

    return false;
};

const mergeCalendarItemsWithOptimistic = (
    serverItems: CalendarItem[],
    optimisticItemsById: Record<string, Partial<CalendarItem> & { id: string }>
) => {
    const mergedById = new Map<string, CalendarItem>();

    for (const item of serverItems) {
        mergedById.set(item.id, item);
    }

    for (const [id, optimisticItem] of Object.entries(optimisticItemsById)) {
        const existing = mergedById.get(id);
        mergedById.set(id, existing ? ({ ...existing, ...optimisticItem } as CalendarItem) : (optimisticItem as CalendarItem));
    }

    return Array.from(mergedById.values());
};

const resolveMemberColors = <T extends CalendarMemberWithColor>(
    members: T[] | undefined,
    memberColorsById: Record<string, string>
): T[] => {
    if (!Array.isArray(members) || members.length === 0) {
        return [];
    }

    return members.map((member) => {
        const memberId = typeof member?.id === 'string' ? member.id.trim() : '';
        if (!memberId) {
            return member;
        }

        const resolvedColor = memberColorsById[memberId] || member.color || null;
        if (resolvedColor === member.color) {
            return member;
        }

        return {
            ...member,
            color: resolvedColor,
        };
    });
};

const applyResolvedMemberColorsToCalendarItems = (
    items: CalendarItem[],
    memberColorsById: Record<string, string>
) =>
    items.map((item) => ({
        ...item,
        pertainsTo: resolveMemberColors(item.pertainsTo, memberColorsById),
    }));

const getCalendarItemSelectionKey = (item: Pick<CalendarItem, 'id' | 'startDate'> & { recurrenceId?: string; __displayDate?: string }) => {
    const occurrenceToken =
        (typeof item.recurrenceId === 'string' && item.recurrenceId.trim()) ||
        (typeof item.__displayDate === 'string' && item.__displayDate.trim()) ||
        String(item.startDate || '').trim();
    return `${String(item.id || '').trim()}::${occurrenceToken}`;
};

const optimisticItemSatisfiedByServer = (
    serverItem: CalendarItem | undefined,
    optimisticItem: Partial<CalendarItem> & { id: string }
) => {
    if (!serverItem) return false;

    const optimisticTimestamp =
        [optimisticItem.updatedAt, optimisticItem.lastModified, optimisticItem.dtStamp]
            .map((value) => (typeof value === 'string' ? value.trim() : ''))
            .find(Boolean) || '';
    if (optimisticTimestamp) {
        const serverTimestamps = new Set(
            [serverItem.updatedAt, serverItem.lastModified, serverItem.dtStamp]
                .map((value) => (typeof value === 'string' ? value.trim() : ''))
                .filter(Boolean)
        );
        if (serverTimestamps.has(optimisticTimestamp)) {
            return true;
        }
    }

    return Object.entries(optimisticItem).every(([key, value]) => {
        if (key === 'id') return true;
        return valuesEqual((serverItem as any)[key], value);
    });
};

const Calendar = ({
    currentDate = new Date(),
    numWeeks = 5,
    displayBS = true,
    variant = 'default',
    className,
    style,
    showGregorianDays,
    showBsDays,
    showChores: controlledShowChores,
    everyoneSelected: controlledEveryoneSelected,
    selectedMemberIds: controlledSelectedMemberIds,
    selectedChoreIds: controlledSelectedChoreIds,
    dayHeight: controlledDayHeight,
    eventFontScale: controlledEventFontScale,
    commandBusEnabled,
}: CalendarProps) => {
    // TODO: add displayInNepali = false, displayInRoman = true, can both be true and it will show them both
    // add displayOfficialNepaliMonthNames = false, when false will give the short month names everybody uses
    // and displayMonthNumber = false, to display the month number as well as the name.
    const isMiniInfinite = variant === 'miniInfinite';
    const commandsEnabled = commandBusEnabled ?? !isMiniInfinite;
    const effectiveCurrentDate = useMemo(
        () => new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate()),
        [currentDate]
    );
    const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
    const [optimisticItemsById, setOptimisticItemsById] = useState<Record<string, Partial<CalendarItem> & { id: string }>>({});
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);
    const [selectedEvent, setSelectedEvent] = useState<CalendarItem | null>(null);
    const [selectedEventKey, setSelectedEventKey] = useState<string | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [everyoneSelected, setEveryoneSelected] = useState(true);
    const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
    const [memberFilterConfigured, setMemberFilterConfigured] = useState(false);
    const [recurrenceScopeDialogOpen, setRecurrenceScopeDialogOpen] = useState(false);
    const [recurrenceScopeDialogAction, setRecurrenceScopeDialogAction] = useState<'edit' | 'drag' | 'delete'>('drag');
    const [recurrenceScopeDialogMode, setRecurrenceScopeDialogMode] = useState<RecurrenceSeriesScopeMode>('following');
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [dragRecurrenceIndicator, setDragRecurrenceIndicator] = useState<DragRecurrenceIndicatorState | null>(null);
    const [showChores, setShowChores] = useState<boolean>(() => {
        if (typeof window === 'undefined' || !commandsEnabled) {
            return false;
        }

        return window.localStorage.getItem(CALENDAR_SHOW_CHORES_STORAGE_KEY) === 'true';
    });
    const [viewMode, setViewMode] = useState<CalendarViewMode>(() => {
        if (typeof window === 'undefined' || isMiniInfinite) {
            return 'monthly';
        }

        const stored = window.localStorage.getItem(CALENDAR_VIEW_MODE_STORAGE_KEY);
        return stored === 'year' ? 'year' : 'monthly';
    });
    const [yearMonthBasis, setYearMonthBasis] = useState<CalendarYearMonthBasis>(() => {
        if (typeof window === 'undefined' || !commandsEnabled) {
            return 'gregorian';
        }

        const stored = window.localStorage.getItem(CALENDAR_YEAR_MONTH_BASIS_STORAGE_KEY);
        return stored === 'bs' ? 'bs' : 'gregorian';
    });
    const [yearFontScale, setYearFontScale] = useState<number>(() => {
        if (typeof window === 'undefined' || !commandsEnabled) {
            return CALENDAR_YEAR_FONT_SCALE_DEFAULT;
        }

        const stored = Number(window.localStorage.getItem(CALENDAR_YEAR_FONT_SCALE_STORAGE_KEY));
        return Number.isFinite(stored) ? clampCalendarYearFontScale(stored) : CALENDAR_YEAR_FONT_SCALE_DEFAULT;
    });
    const [selectedChoreIds, setSelectedChoreIds] = useState<string[]>([]);
    const [choreFilterConfigured, setChoreFilterConfigured] = useState(false);
    const [dayCellHeight, setDayCellHeight] = useState<number>(() => {
        if (typeof window === 'undefined' || !commandsEnabled) {
            return CALENDAR_DAY_HEIGHT_DEFAULT;
        }

        const stored = window.localStorage.getItem(CALENDAR_DAY_HEIGHT_STORAGE_KEY);
        if (!stored) {
            return CALENDAR_DAY_HEIGHT_DEFAULT;
        }

        const parsed = Number(stored);
        if (!Number.isFinite(parsed)) {
            return CALENDAR_DAY_HEIGHT_DEFAULT;
        }

        return clampNumber(Math.round(parsed), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX);
    });

    const initialWeeksPerSide = Math.max(6, numWeeks);
    const [rangeStart, setRangeStart] = useState<Date>(() =>
        startOfWeek(addWeeks(effectiveCurrentDate, -initialWeeksPerSide), { weekStartsOn: WEEK_STARTS_ON })
    );
    const [rangeEnd, setRangeEnd] = useState<Date>(() =>
        endOfWeek(addWeeks(effectiveCurrentDate, initialWeeksPerSide), { weekStartsOn: WEEK_STARTS_ON })
    );
    const [yearViewportStartOffset, setYearViewportStartOffset] = useState(0);
    const [yearRangeStartOffset, setYearRangeStartOffset] = useState(-12);
    const [yearRangeEndOffset, setYearRangeEndOffset] = useState(23);
    const [scrollContainerHeight, setScrollContainerHeight] = useState<number | null>(null);
    const [scrollContainerWidth, setScrollContainerWidth] = useState<number | null>(null);
    const [yearShiftAnimation, setYearShiftAnimation] = useState<{ key: number; direction: 'left' | 'right' } | null>(null);
    const [dayNumberStickyTop, setDayNumberStickyTop] = useState(0);
    const stickyMonthTop = 2;
    const [monthBoxSize, setMonthBoxSize] = useState<{ width: number; height: number } | null>(null);
    const [activeMonthLabel, setActiveMonthLabel] = useState<MonthLabel>(() => {
        // @ts-ignore - package has no strict Date typing
        const nepaliDate = new NepaliDate(effectiveCurrentDate);
        const nepaliMonth = nepaliDate.getMonth();
        const nepaliYear = String(nepaliDate.getYear());
        return {
            key: `${format(effectiveCurrentDate, 'yyyy-MM')}-${nepaliDate.getYear()}-${nepaliMonth}`,
            gregorianMonth: format(effectiveCurrentDate, 'MMMM'),
            gregorianYear: format(effectiveCurrentDate, 'yyyy'),
            nepaliMonth: `${NEPALI_MONTHS_COMMON_DEVANAGARI[nepaliMonth]} (${NEPALI_MONTHS_COMMON_ROMAN[nepaliMonth]})`,
            nepaliYearDevanagari: toDevanagariDigits(nepaliYear),
        };
    });
    const [previousMonthLabel, setPreviousMonthLabel] = useState<MonthLabel | null>(null);
    const [isMonthTransitioning, setIsMonthTransitioning] = useState(false);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const headerRef = useRef<HTMLTableSectionElement>(null);
    const pendingTopScrollAdjustRef = useRef<PendingScrollAdjust | null>(null);
    const expandLockRef = useRef(false);
    const monthFadeTimerRef = useRef<number | null>(null);
    const monthLabelRef = useRef<MonthLabel>(activeMonthLabel);
    const scrollRafRef = useRef<number | null>(null);
    const lastScrollTopRef = useRef<number | null>(null);
    const lastTopLoadAtRef = useRef(0);
    const lastBottomLoadAtRef = useRef(0);
    const yearShiftLockRef = useRef(false);
    const yearShiftAnimationKeyRef = useRef(0);
    // const lastTopTriggerScrollTopRef = useRef<number>(Number.POSITIVE_INFINITY);
    // const lastBottomTriggerScrollTopRef = useRef<number>(Number.NEGATIVE_INFINITY);
    const activeMonthMeasureRef = useRef<HTMLDivElement>(null);
    const previousMonthMeasureRef = useRef<HTMLDivElement>(null);
    const initialCurrentDateStrRef = useRef(
        format(effectiveCurrentDate, 'yyyy-MM-dd')
    );
    const pendingScrollToDateRef = useRef<string | null>(initialCurrentDateStrRef.current);
    const pendingScrollBehaviorRef = useRef<ScrollBehavior>('auto');
    const pendingYearScrollToMonthOffsetRef = useRef<number | null>(0);
    const recurrenceScopeResolverRef = useRef<((scope: RecurrenceEditScope) => void) | null>(null);

    const sanitizeControlledIds = useCallback(
        (value: string[] | undefined) =>
            Array.from(
                new Set(
                    (Array.isArray(value) ? value : [])
                        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
                        .map((entry) => entry.trim())
                )
            ),
        []
    );

    const effectiveShowBsDays = Boolean(showBsDays ?? displayBS);
    const effectiveShowGregorianDays = Boolean((showGregorianDays ?? true) || !effectiveShowBsDays);
    const effectiveYearFontScale =
        controlledEventFontScale == null ? yearFontScale : clampCalendarYearFontScale(controlledEventFontScale);
    const effectiveDayCellHeight = useMemo(() => {
        if (isMiniInfinite) {
            if (!scrollContainerHeight) {
                return 36;
            }

            const usableHeight = Math.max(1, scrollContainerHeight - 10);
            return Math.max(28, Math.floor(usableHeight / CALENDAR_MINI_VISIBLE_WEEKS));
        }

        return controlledDayHeight == null
            ? dayCellHeight
            : clampNumber(Math.round(controlledDayHeight), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX);
    }, [controlledDayHeight, dayCellHeight, isMiniInfinite, scrollContainerHeight]);
    const memberFilterControlled = controlledEveryoneSelected !== undefined || controlledSelectedMemberIds !== undefined;
    const choreFilterControlled = controlledSelectedChoreIds !== undefined;
    const effectiveShowChores = typeof controlledShowChores === 'boolean' ? controlledShowChores : showChores;
    const effectiveEveryoneSelected =
        typeof controlledEveryoneSelected === 'boolean' ? controlledEveryoneSelected : everyoneSelected;
    const effectiveSelectedMemberIds = memberFilterControlled
        ? sanitizeControlledIds(controlledSelectedMemberIds)
        : selectedMemberIds;
    const effectiveSelectedChoreIds = choreFilterControlled ? sanitizeControlledIds(controlledSelectedChoreIds) : selectedChoreIds;
    const effectiveMemberFilterConfigured = memberFilterControlled ? true : memberFilterConfigured;
    const effectiveChoreFilterConfigured = choreFilterControlled ? true : choreFilterConfigured;

    const buildMonthLabel = useCallback((date: Date): MonthLabel => {
        // @ts-ignore - package has no strict Date typing
        const nepaliDate = new NepaliDate(date);
        const nepaliMonth = nepaliDate.getMonth();
        const nepaliYear = String(nepaliDate.getYear());
        return {
            key: `${format(date, 'yyyy-MM')}-${nepaliDate.getYear()}-${nepaliMonth}`,
            gregorianMonth: format(date, 'MMMM'),
            gregorianYear: format(date, 'yyyy'),
            nepaliMonth: `${NEPALI_MONTHS_COMMON_DEVANAGARI[nepaliMonth]} (${NEPALI_MONTHS_COMMON_ROMAN[nepaliMonth]})`,
            nepaliYearDevanagari: toDevanagariDigits(nepaliYear),
        };
    }, []);

    const renderMonthLabel = useCallback((label: MonthLabel) => {
        return (
            <div className={styles.stickyMonthLabel}>
                <div className={`${styles.stickyMonthLine} ${styles.stickyMonthMonthLine}`}>
                    <span>{label.gregorianMonth}</span>
                    <span className={styles.stickyMonthNepali}>{label.nepaliMonth}</span>
                </div>
                <div className={`${styles.stickyMonthLine} ${styles.stickyMonthYearLine}`}>
                    <span>{label.gregorianYear}</span>
                    <span className={styles.stickyMonthYearNepali}>{label.nepaliYearDevanagari}</span>
                </div>
            </div>
        );
    }, []);

    useEffect(() => {
        if (isMiniInfinite && viewMode !== 'monthly') {
            setViewMode('monthly');
        }
    }, [isMiniInfinite, viewMode]);

    const lastAppliedCurrentDateRef = useRef(initialCurrentDateStrRef.current);
    useEffect(() => {
        const nextDateStr = format(effectiveCurrentDate, 'yyyy-MM-dd');
        if (lastAppliedCurrentDateRef.current === nextDateStr) {
            return;
        }

        lastAppliedCurrentDateRef.current = nextDateStr;
        pendingTopScrollAdjustRef.current = null;
        pendingScrollBehaviorRef.current = 'auto';
        pendingScrollToDateRef.current = nextDateStr;
        setActiveMonthLabel(buildMonthLabel(effectiveCurrentDate));
        monthLabelRef.current = buildMonthLabel(effectiveCurrentDate);
        setPreviousMonthLabel(null);
        setIsMonthTransitioning(false);
        setRangeStart(startOfWeek(addWeeks(effectiveCurrentDate, -initialWeeksPerSide), { weekStartsOn: WEEK_STARTS_ON }));
        setRangeEnd(endOfWeek(addWeeks(effectiveCurrentDate, initialWeeksPerSide), { weekStartsOn: WEEK_STARTS_ON }));
    }, [buildMonthLabel, effectiveCurrentDate, initialWeeksPerSide]);

    const scrollToDateStr = useCallback((dateStr: string, behavior: ScrollBehavior = 'smooth') => {
        const container = scrollContainerRef.current;
        if (!container) return false;

        const targetCell = container.querySelector<HTMLElement>(`[data-calendar-cell-date="${dateStr}"]`);
        if (!targetCell) return false;

        const headerHeight = isMiniInfinite ? 0 : headerRef.current?.getBoundingClientRect().height ?? 0;
        const targetTop = Math.max(0, targetCell.offsetTop - headerHeight - (isMiniInfinite ? 2 : 8));
        if (typeof container.scrollTo === 'function') {
            container.scrollTo({ top: targetTop, behavior });
        } else {
            container.scrollTop = targetTop;
        }
        return true;
    }, [isMiniInfinite]);

    const recalculateMonthBoxSize = useCallback(() => {
        const activeRect = activeMonthMeasureRef.current?.getBoundingClientRect();
        const previousRect = previousMonthMeasureRef.current?.getBoundingClientRect();

        const baseWidth = Math.ceil(Math.max(activeRect?.width ?? 0, previousRect?.width ?? 0));
        const baseHeight = Math.ceil(Math.max(activeRect?.height ?? 0, previousRect?.height ?? 0));

        if (baseWidth === 0 || baseHeight === 0) {
            return;
        }

        const nextSize = {
            width: baseWidth + MONTH_BOX_HORIZONTAL_PADDING,
            height: baseHeight + MONTH_BOX_VERTICAL_PADDING,
        };

        setMonthBoxSize((previousSize) => {
            if (previousSize && previousSize.width === nextSize.width && previousSize.height === nextSize.height) {
            return previousSize;
            }
            return nextSize;
        });
    }, []);

    const scrollToMonthOffset = useCallback((monthOffset: number, behavior: ScrollBehavior = 'smooth') => {
        const container = scrollContainerRef.current;
        if (!container) return false;

        const targetMonth = container.querySelector<HTMLElement>(`[data-calendar-month-offset="${monthOffset}"]`);
        if (!targetMonth) return false;

        const targetTop = Math.max(0, targetMonth.offsetTop - 4);
        if (typeof container.scrollTo === 'function') {
            container.scrollTo({ top: targetTop, behavior });
        } else {
            container.scrollTop = targetTop;
        }
        return true;
    }, []);

    const yearMonths = useMemo(
        () =>
            buildYearCalendarMonthDescriptors({
                currentDate: effectiveCurrentDate,
                basis: yearMonthBasis,
                startOffset: yearRangeStartOffset,
                endOffset: yearRangeEndOffset,
            }),
        [effectiveCurrentDate, yearMonthBasis, yearRangeEndOffset, yearRangeStartOffset]
    );

    const yearLeadingBufferMonth = useMemo(
        () =>
            buildYearCalendarMonthDescriptors({
                currentDate: effectiveCurrentDate,
                basis: yearMonthBasis,
                startOffset: yearRangeStartOffset - 1,
                endOffset: yearRangeStartOffset - 1,
            })[0] ?? null,
        [effectiveCurrentDate, yearMonthBasis, yearRangeStartOffset]
    );

    const yearTrailingBufferMonth = useMemo(
        () =>
            buildYearCalendarMonthDescriptors({
                currentDate: effectiveCurrentDate,
                basis: yearMonthBasis,
                startOffset: yearRangeEndOffset + 1,
                endOffset: yearRangeEndOffset + 1,
            })[0] ?? null,
        [effectiveCurrentDate, yearMonthBasis, yearRangeEndOffset]
    );

    const yearLayoutReferenceMonths = useMemo(
        () =>
            buildYearCalendarMonthDescriptors({
                currentDate: effectiveCurrentDate,
                basis: yearMonthBasis,
                startOffset: 0,
                endOffset: 11,
            }),
        [effectiveCurrentDate, yearMonthBasis]
    );

    const yearLayout = useMemo(
        () =>
            calculateYearCalendarLayout({
                containerWidth: scrollContainerWidth ?? 0,
                containerHeight: scrollContainerHeight ?? 0,
                visibleMonths: yearLayoutReferenceMonths,
            }),
        [scrollContainerHeight, scrollContainerWidth, yearLayoutReferenceMonths]
    );

    const activeRangeStart = useMemo(() => {
        if (viewMode === 'year') {
            return yearLeadingBufferMonth?.gridStart ?? yearMonths[0]?.gridStart ?? startOfMonth(effectiveCurrentDate);
        }
        return rangeStart;
    }, [effectiveCurrentDate, rangeStart, viewMode, yearLeadingBufferMonth, yearMonths]);

    const activeRangeEnd = useMemo(() => {
        if (viewMode === 'year') {
            return (
                yearTrailingBufferMonth?.gridEnd ??
                yearMonths[yearMonths.length - 1]?.gridEnd ??
                endOfWeek(effectiveCurrentDate, { weekStartsOn: WEEK_STARTS_ON })
            );
        }
        return rangeEnd;
    }, [effectiveCurrentDate, rangeEnd, viewMode, yearMonths, yearTrailingBufferMonth]);

    const days = useMemo(() => {
        const generatedDays: Date[] = [];
        let cursor = activeRangeStart;
        while (cursor.getTime() <= activeRangeEnd.getTime()) {
            generatedDays.push(cursor);
            cursor = addDays(cursor, 1);
        }
        return generatedDays;
    }, [activeRangeEnd, activeRangeStart]);

    const weeks = useMemo(() => {
        const generatedWeeks: Date[][] = [];
        for (let i = 0; i < days.length; i += 7) {
            generatedWeeks.push(days.slice(i, i + 7));
        }
        return generatedWeeks;
    }, [days]);

    const monthConditions = useMemo(() => {
        const bufferedStart = startOfMonth(addMonths(activeRangeStart, -1));
        const bufferedEnd = endOfMonth(addMonths(activeRangeEnd, 1));
        const monthsByYear = new Map<number, number[]>();
        let monthCursor = new Date(bufferedStart);

        while (monthCursor.getTime() <= bufferedEnd.getTime()) {
            const year = monthCursor.getFullYear();
            const month = monthCursor.getMonth() + 1;
            const existing = monthsByYear.get(year) || [];
            if (!existing.includes(month)) {
                existing.push(month);
                monthsByYear.set(year, existing);
            }
            monthCursor = addMonths(monthCursor, 1);
        }

        return Array.from(monthsByYear.entries()).map(([year, months]) => ({
            year,
            month: { $in: months },
        }));
    }, [activeRangeEnd, activeRangeStart]);
    const recurrenceReferenceMonthConditions = useMemo(() => {
        const bufferedStart = startOfMonth(addMonths(activeRangeStart, -1));
        const bufferedEnd = endOfMonth(addMonths(activeRangeEnd, 1));
        const conditions: Array<{ recurrenceId: { $like: string } }> = [];
        const seenPatterns = new Set<string>();
        let monthCursor = new Date(bufferedStart);

        while (monthCursor.getTime() <= bufferedEnd.getTime()) {
            const patterns = [`${format(monthCursor, 'yyyy-MM')}%`, `${format(monthCursor, 'yyyyMM')}%`];
            for (const pattern of patterns) {
                if (seenPatterns.has(pattern)) continue;
                seenPatterns.add(pattern);
                conditions.push({ recurrenceId: { $like: pattern } });
            }
            monthCursor = addMonths(monthCursor, 1);
        }

        return conditions;
    }, [activeRangeEnd, activeRangeStart]);

    const capRangeByMemory = useCallback((start: Date, end: Date, direction: 'up' | 'down') => {
        let cappedStart = start;
        let cappedEnd = end;

        if (direction === 'down') {
            const minimumStart = startOfWeek(addWeeks(cappedEnd, -MEMORY_CAP_WEEKS), { weekStartsOn: WEEK_STARTS_ON });
            if (cappedStart.getTime() < minimumStart.getTime()) {
                cappedStart = minimumStart;
            }
        } else {
            const maximumEnd = endOfWeek(addWeeks(cappedStart, MEMORY_CAP_WEEKS), { weekStartsOn: WEEK_STARTS_ON });
            if (cappedEnd.getTime() > maximumEnd.getTime()) {
                cappedEnd = maximumEnd;
            }
        }

        return { cappedStart, cappedEnd };
    }, []);

    const captureTopScrollAnchor = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        let anchorSelector: string | null = null;
        let anchorOffset: number | null = null;

        const headerHeight = isMiniInfinite ? 0 : headerRef.current?.getBoundingClientRect().height ?? 0;
        const containerTop = container.getBoundingClientRect().top;
        const scanLine = containerTop + headerHeight;

        const dayMarkers = Array.from(container.querySelectorAll<HTMLElement>('[data-calendar-cell-date]'));
        for (const marker of dayMarkers) {
            const rect = marker.getBoundingClientRect();
            if (rect.bottom > scanLine) {
                const anchorDate = marker.dataset.calendarCellDate ?? null;
                anchorSelector = anchorDate ? `[data-calendar-cell-date="${anchorDate}"]` : null;
                anchorOffset = rect.top - containerTop;
                break;
            }
        }

        pendingTopScrollAdjustRef.current = {
            prevScrollTop: container.scrollTop,
            prevScrollHeight: container.scrollHeight,
            anchorSelector,
            anchorOffset,
        };
    }, [isMiniInfinite]);

    const expandRange = useCallback(
        (direction: 'up' | 'down') => {
            if (expandLockRef.current) {
                return;
            }

            expandLockRef.current = true;

            let nextStart = rangeStart;
            let nextEnd = rangeEnd;

            if (direction === 'up') {
                nextStart = startOfWeek(addWeeks(rangeStart, -WEEKS_PER_LOAD), { weekStartsOn: WEEK_STARTS_ON });
            } else {
                nextEnd = endOfWeek(addWeeks(rangeEnd, WEEKS_PER_LOAD), { weekStartsOn: WEEK_STARTS_ON });
            }

            const { cappedStart, cappedEnd } = capRangeByMemory(nextStart, nextEnd, direction);
            const topChanged = cappedStart.getTime() !== rangeStart.getTime();

            if (topChanged) {
                captureTopScrollAnchor();
            }

            setRangeStart(cappedStart);
            setRangeEnd(cappedEnd);

            window.requestAnimationFrame(() => {
                expandLockRef.current = false;
            });
        },
        [rangeStart, rangeEnd, capRangeByMemory, captureTopScrollAnchor]
    );

    const expandYearRange = useCallback(
        (direction: 'up' | 'down') => {
            if (expandLockRef.current) {
                return;
            }

            const container = scrollContainerRef.current;
            if (!container) {
                return;
            }

            expandLockRef.current = true;

            if (direction === 'up') {
                pendingTopScrollAdjustRef.current = {
                    prevScrollTop: container.scrollTop,
                    prevScrollHeight: container.scrollHeight,
                };
                setYearRangeStartOffset((previous) => previous - 12);
            } else {
                setYearRangeEndOffset((previous) => previous + 12);
            }

            window.requestAnimationFrame(() => {
                expandLockRef.current = false;
            });
        },
        []
    );

    const selectCalendarEvent = useCallback((calendarEvent: CalendarItem) => {
        setSelectedDate(parseISO(calendarEvent.startDate));
        setSelectedEvent(calendarEvent);
        setSelectedEventKey(getCalendarItemSelectionKey(calendarEvent));
    }, []);

    const clearCalendarSelection = useCallback(() => {
        setSelectedEvent(null);
        setSelectedEventKey(null);
    }, []);

    const handleDayClick = () => {
        clearCalendarSelection();
    };

    const handleDayDoubleClick = (day: Date) => {
        setSelectedDate(day);
        clearCalendarSelection();
        setIsModalOpen(true);
    };

    const handleEventClick = (e: React.MouseEvent, calendarEvent: CalendarItem) => {
        e.stopPropagation();
        selectCalendarEvent(calendarEvent);
    };

    const handleEventDoubleClick = (e: React.MouseEvent, calendarEvent: CalendarItem) => {
        e.stopPropagation();
        selectCalendarEvent(calendarEvent);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setSelectedDate(null);
        clearCalendarSelection();
    };

    const requestRecurrenceScope = useCallback((action: 'edit' | 'drag' | 'delete', scopeMode: RecurrenceSeriesScopeMode = 'following') => {
        return new Promise<RecurrenceEditScope>((resolve) => {
            recurrenceScopeResolverRef.current = resolve;
            setRecurrenceScopeDialogAction(action);
            setRecurrenceScopeDialogMode(scopeMode);
            setRecurrenceScopeDialogOpen(true);
        });
    }, []);

    const resolveRecurrenceScope = useCallback((scope: RecurrenceEditScope) => {
        setRecurrenceScopeDialogOpen(false);
        const resolver = recurrenceScopeResolverRef.current;
        recurrenceScopeResolverRef.current = null;
        resolver?.(scope);
    }, []);

    const isOriginalSeriesOccurrence = useCallback((item: CalendarItem, masterEvent: CalendarItem) => {
        const occurrenceReferenceToken =
            typeof item.recurrenceId === 'string' && item.recurrenceId.trim() ? item.recurrenceId : item.startDate;
        const occurrenceReferenceDate =
            parseRecurrenceDateToken(String(occurrenceReferenceToken || '')) || parseRecurrenceDateToken(String(item.startDate || ''));
        const masterStartDate = parseRecurrenceDateToken(String(masterEvent.startDate || ''));
        if (!occurrenceReferenceDate || !masterStartDate) return false;

        if (item.isAllDay || masterEvent.isAllDay) {
            return format(occurrenceReferenceDate, 'yyyy-MM-dd') === format(masterStartDate, 'yyyy-MM-dd');
        }

        return occurrenceReferenceDate.getTime() === masterStartDate.getTime();
    }, []);

    const handleDeleteByScope = useCallback(
        async (scope: RecurrenceEditScope) => {
            if (!selectedEvent) return;

            const masterEvent = (((selectedEvent as any).__masterEvent as CalendarItem | undefined) || selectedEvent) as CalendarItem;
            const masterRrule = normalizeRruleString(String(masterEvent?.rrule || ''));
            const masterId = String(masterEvent?.id || selectedEvent.id);
            const masterLinkKeys = getRecurringSeriesLinkKeys(masterEvent);
            const hasRecurringContext = Boolean(masterRrule || String(selectedEvent.recurringEventId || '').trim());

            if (!hasRecurringContext) {
                await db.transact([tx.calendarItems[selectedEvent.id].delete()]);
                clearCalendarSelection();
                return;
            }

            const referenceTokenRaw = String((selectedEvent as any).recurrenceId || selectedEvent.startDate || '').trim();
            const referenceDate = parseRecurrenceDateToken(referenceTokenRaw) || parseRecurrenceDateToken(String(selectedEvent.startDate || ''));
            if (!referenceDate) {
                window.alert('Unable to identify the recurrence instance for deletion.');
                return;
            }
            const referenceToken = selectedEvent.isAllDay ? format(referenceDate, 'yyyy-MM-dd') : referenceDate.toISOString();
            const boundaryDateOnly = format(referenceDate, 'yyyy-MM-dd');

            if (!masterRrule) {
                if (scope !== 'single') {
                    window.alert('Unable to delete following events because the recurrence series was not found.');
                    return;
                }

                await db.transact([tx.calendarItems[selectedEvent.id].delete()]);
                clearCalendarSelection();
                return;
            }

            const masterExdates = normalizeRecurrenceTokens([
                ...(Array.isArray(masterEvent.exdates) ? masterEvent.exdates.map((entry) => String(entry)) : []),
                ...collectRecurrenceLineTokens(masterEvent.recurrenceLines, 'EXDATE'),
            ]);
            const masterRdates = normalizeRecurrenceTokens([
                ...(Array.isArray(masterEvent.rdates) ? masterEvent.rdates.map((entry) => String(entry)) : []),
                ...collectRecurrenceLineTokens(masterEvent.recurrenceLines, 'RDATE'),
            ]);
            const masterSequence = typeof masterEvent.sequence === 'number' ? masterEvent.sequence : 0;
            const masterXProps =
                masterEvent.xProps && typeof masterEvent.xProps === 'object' && !Array.isArray(masterEvent.xProps)
                    ? { ...(masterEvent.xProps as Record<string, unknown>) }
                    : {};

            const txOps: any[] = [];
            const selectedIsOverride =
                selectedEvent.id !== masterId &&
                isRecurringChildOfMaster(selectedEvent, masterEvent) &&
                !normalizeRruleString(String(selectedEvent.rrule || ''));

            const collectRelatedOverrideIds = (boundaryTime?: number) => {
                const overrideIds = new Set<string>();
                for (const candidate of calendarItems) {
                    const parentId = String(candidate.recurringEventId || '').trim();
                    if (!parentId || !masterLinkKeys.includes(parentId)) continue;

                    if (boundaryTime == null) {
                        overrideIds.add(candidate.id);
                        continue;
                    }

                    const recurrenceRefToken =
                        typeof candidate.recurrenceId === 'string' && candidate.recurrenceId.trim()
                            ? candidate.recurrenceId
                            : candidate.startDate;
                    const recurrenceRefDate = parseRecurrenceDateToken(String(recurrenceRefToken || ''));
                    if (!recurrenceRefDate) continue;
                    const recurrenceTime = candidate.isAllDay
                        ? parseISO(`${format(recurrenceRefDate, 'yyyy-MM-dd')}T00:00:00`).getTime()
                        : recurrenceRefDate.getTime();
                    if (recurrenceTime >= boundaryTime) {
                        overrideIds.add(candidate.id);
                    }
                }

                if (selectedIsOverride) {
                    overrideIds.add(selectedEvent.id);
                }

                return overrideIds;
            };

            if (scope === 'single') {
                const nextExdates = normalizeRecurrenceTokens([...masterExdates, referenceToken]);
                const nextExceptionRows = normalizeStoredRecurrenceExceptionRows((masterXProps as any)?.recurrenceExceptionRows);
                if (
                    !nextExceptionRows.some((row) =>
                        row.mode === 'date'
                            ? row.date === boundaryDateOnly
                            : row.rangeStart.localeCompare(boundaryDateOnly) <= 0 && row.rangeEnd.localeCompare(boundaryDateOnly) >= 0
                    )
                ) {
                    nextExceptionRows.push({
                        mode: 'date',
                        date: boundaryDateOnly,
                        rangeStart: boundaryDateOnly,
                        rangeEnd: boundaryDateOnly,
                    });
                }

                txOps.push(
                    tx.calendarItems[masterId].update({
                        exdates: nextExdates,
                        recurrenceLines: buildRecurrenceLines(masterRrule, masterRdates, nextExdates),
                        updatedAt: new Date().toISOString(),
                        dtStamp: new Date().toISOString(),
                        lastModified: new Date().toISOString(),
                        sequence: masterSequence + 1,
                        xProps: {
                            ...masterXProps,
                            recurrenceExceptionRows: nextExceptionRows,
                        },
                    })
                );
                if (selectedIsOverride) {
                    txOps.push(tx.calendarItems[selectedEvent.id].delete());
                }
            } else if (scope === 'all') {
                txOps.push(tx.calendarItems[masterId].delete());
                for (const overrideId of Array.from(collectRelatedOverrideIds())) {
                    txOps.push(tx.calendarItems[overrideId].delete());
                }
            } else {
                const boundaryTime = selectedEvent.isAllDay
                    ? parseISO(`${boundaryDateOnly}T00:00:00`).getTime()
                    : referenceDate.getTime();
                const masterStartReferenceDate = parseRecurrenceDateToken(String(masterEvent.startDate || ''));
                const masterStartTime = masterStartReferenceDate
                    ? selectedEvent.isAllDay
                        ? parseISO(`${format(masterStartReferenceDate, 'yyyy-MM-dd')}T00:00:00`).getTime()
                        : masterStartReferenceDate.getTime()
                    : Number.NaN;
                const deletingFromFirstOccurrence = Number.isFinite(masterStartTime) && boundaryTime <= masterStartTime;

                if (deletingFromFirstOccurrence) {
                    txOps.push(tx.calendarItems[masterId].delete());
                } else {
                    const cappedMasterRrule = capRruleBeforeOccurrence(masterRrule, referenceDate, selectedEvent.isAllDay);
                    const splitExdates = partitionRecurrenceTokensByBoundary(masterExdates, referenceDate, selectedEvent.isAllDay);
                    const splitRdates = partitionRecurrenceTokensByBoundary(masterRdates, referenceDate, selectedEvent.isAllDay);
                    const splitExceptionRows = splitRecurrenceRowsAtBoundary(
                        normalizeStoredRecurrenceExceptionRows((masterXProps as any)?.recurrenceExceptionRows),
                        boundaryDateOnly
                    );
                    const splitRdateRows = splitRecurrenceRowsAtBoundary(
                        normalizeStoredRecurrenceExceptionRows((masterXProps as any)?.recurrenceRdateRows),
                        boundaryDateOnly
                    );
                    const patchedMasterXProps = { ...masterXProps };
                    if (splitExceptionRows.before.length > 0) {
                        patchedMasterXProps.recurrenceExceptionRows = splitExceptionRows.before;
                    } else {
                        delete patchedMasterXProps.recurrenceExceptionRows;
                    }
                    if (splitRdateRows.before.length > 0) {
                        patchedMasterXProps.recurrenceRdateRows = splitRdateRows.before;
                    } else {
                        delete patchedMasterXProps.recurrenceRdateRows;
                    }

                    txOps.push(
                        tx.calendarItems[masterId].update({
                            rrule: cappedMasterRrule,
                            rdates: splitRdates.before,
                            exdates: splitExdates.before,
                            recurrenceLines: buildRecurrenceLines(cappedMasterRrule, splitRdates.before, splitExdates.before),
                            updatedAt: new Date().toISOString(),
                            dtStamp: new Date().toISOString(),
                            lastModified: new Date().toISOString(),
                            sequence: masterSequence + 1,
                            xProps: patchedMasterXProps,
                        })
                    );
                }

                const overrideIds = deletingFromFirstOccurrence ? collectRelatedOverrideIds() : collectRelatedOverrideIds(boundaryTime);
                for (const overrideId of Array.from(overrideIds)) {
                    txOps.push(tx.calendarItems[overrideId].delete());
                }
            }

            try {
                await db.transact(txOps);
                clearCalendarSelection();
            } catch (error) {
                console.error('Unable to delete recurring event:', error);
                window.alert('Unable to delete event. Please try again.');
            }
        },
        [calendarItems, clearCalendarSelection, selectedEvent]
    );

    const handleDeleteSelectedEvent = useCallback(async () => {
        if (!selectedEvent) return;

        const masterEvent = (((selectedEvent as any).__masterEvent as CalendarItem | undefined) || selectedEvent) as CalendarItem;
        const masterRrule = normalizeRruleString(String(masterEvent?.rrule || ''));
        const isRecurringContext = Boolean(masterRrule || String(selectedEvent.recurringEventId || '').trim());

        if (!isRecurringContext) {
            setDeleteConfirmOpen(true);
            return;
        }

        const scope = await requestRecurrenceScope(
            'delete',
            selectedEvent && masterEvent && isOriginalSeriesOccurrence(selectedEvent, masterEvent) ? 'all' : 'following'
        );
        if (scope === 'cancel') return;
        await handleDeleteByScope(scope);
    }, [handleDeleteByScope, isOriginalSeriesOccurrence, requestRecurrenceScope, selectedEvent]);

    const isEventSelected = useCallback(
        (item: CalendarItem) => (selectedEventKey ? getCalendarItemSelectionKey(item) === selectedEventKey : false),
        [selectedEventKey]
    );

    useEffect(() => {
        if (!selectedEventKey || isModalOpen) return;

        const handleWindowKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Delete' && event.key !== 'Backspace') {
                return;
            }

            const target = event.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    target.tagName === 'SELECT' ||
                    target.isContentEditable)
            ) {
                return;
            }

            event.preventDefault();
            void handleDeleteSelectedEvent();
        };

        window.addEventListener('keydown', handleWindowKeyDown);
        return () => window.removeEventListener('keydown', handleWindowKeyDown);
    }, [handleDeleteSelectedEvent, isModalOpen, selectedEventKey]);

    const getForcedRecurrenceScopeFromInput = useCallback(
        (input: { altKey?: boolean; shiftKey?: boolean } | null | undefined, item: CalendarItem, masterEvent: CalendarItem): RecurrenceDragForcedScope | null => {
            if (input?.altKey) {
                return 'single';
            }
            if (input?.shiftKey) {
                return isOriginalSeriesOccurrence(item, masterEvent) ? 'all' : 'following';
            }
            return null;
        },
        [isOriginalSeriesOccurrence]
    );

    const syncDragRecurrenceIndicator = useCallback(
        (
            input: { altKey?: boolean; shiftKey?: boolean; clientX?: number; clientY?: number } | null | undefined,
            item: CalendarItem | null | undefined
        ) => {
            if (!item) {
                setDragRecurrenceIndicator(null);
                return null;
            }

            const masterEvent = (((item as any).__masterEvent as CalendarItem | undefined) || item) as CalendarItem;
            const masterRrule = normalizeRruleString(String(masterEvent.rrule || ''));
            const hasRecurringContext = Boolean(masterRrule || String(item.recurringEventId || '').trim());
            if (!hasRecurringContext) {
                setDragRecurrenceIndicator(null);
                return null;
            }

            const forcedScope = getForcedRecurrenceScopeFromInput(input, item, masterEvent);
            if (!forcedScope) {
                setDragRecurrenceIndicator(null);
                return null;
            }

            const indicatorLabel =
                forcedScope === 'single' ? 'Only this event' : forcedScope === 'all' ? 'All events' : 'This and following events';
            const hotkeyLabel = forcedScope === 'single' ? 'Alt' : 'Shift';
            setDragRecurrenceIndicator({
                x: Number(input?.clientX ?? 0),
                y: Number(input?.clientY ?? 0),
                label: indicatorLabel,
                hotkeyLabel,
            });
            return forcedScope;
        },
        [getForcedRecurrenceScopeFromInput]
    );

    useEffect(() => {
        return () => {
            if (recurrenceScopeResolverRef.current) {
                recurrenceScopeResolverRef.current('cancel');
                recurrenceScopeResolverRef.current = null;
            }
        };
    }, []);

    const applyOptimisticCalendarItem = useCallback(
        (item: CalendarItem) => {
            const previousItem = calendarItems.find((existing) => existing.id === item.id) || null;
            setOptimisticItemsById((prev) => ({ ...prev, [item.id]: item }));
            setCalendarItems((prev) => {
                const index = prev.findIndex((existing) => existing.id === item.id);
                if (index === -1) {
                    return [...prev, item];
                }

                const next = [...prev];
                next[index] = { ...next[index], ...item };
                return next;
            });

            return () => {
                setOptimisticItemsById((prev) => {
                    if (!prev[item.id]) return prev;
                    const next = { ...prev };
                    delete next[item.id];
                    return next;
                });
                setCalendarItems((prev) => {
                    const index = prev.findIndex((existing) => existing.id === item.id);
                    if (index === -1) {
                        return prev;
                    }

                    if (previousItem) {
                        const next = [...prev];
                        next[index] = previousItem;
                        return next;
                    }

                    return prev.filter((existing) => existing.id !== item.id);
                });
            };
        },
        [calendarItems]
    );

    const setDayHeight = useCallback((nextHeight: number) => {
        const clampedHeight = clampNumber(Math.round(nextHeight), CALENDAR_DAY_HEIGHT_MIN, CALENDAR_DAY_HEIGHT_MAX);
        setDayCellHeight(clampedHeight);
    }, []);

    const visibleWeeksEstimate = useMemo(() => {
        if (isMiniInfinite) {
            return CALENDAR_MINI_VISIBLE_WEEKS;
        }
        if (!scrollContainerHeight) {
            return 6;
        }
        const headerHeight = isMiniInfinite ? 0 : Math.max(0, dayNumberStickyTop - 2);
        const usableHeight = Math.max(1, scrollContainerHeight - headerHeight);
        return clampNumber(Math.round(usableHeight / effectiveDayCellHeight), CALENDAR_VISIBLE_WEEKS_MIN, CALENDAR_VISIBLE_WEEKS_MAX);
    }, [effectiveDayCellHeight, isMiniInfinite, scrollContainerHeight, dayNumberStickyTop]);

    const applyVisibleWeeks = useCallback(
        (nextVisibleWeeks: number) => {
            if (isMiniInfinite) {
                return;
            }
            const requestedWeeks = clampNumber(
                Math.round(nextVisibleWeeks),
                CALENDAR_VISIBLE_WEEKS_MIN,
                CALENDAR_VISIBLE_WEEKS_MAX
            );
            const container = scrollContainerRef.current;
            const headerHeight = isMiniInfinite
                ? 0
                : headerRef.current?.getBoundingClientRect().height ?? Math.max(0, dayNumberStickyTop - 2);
            const viewportHeight = container?.clientHeight ?? scrollContainerHeight ?? 0;
            const usableHeight = Math.max(1, viewportHeight - headerHeight);
            setDayHeight(usableHeight / requestedWeeks);
        },
        [dayNumberStickyTop, isMiniInfinite, scrollContainerHeight, setDayHeight]
    );

    const handleTodayClick = useCallback(() => {
        const today = new Date();
        const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const todayStr = format(normalizedToday, 'yyyy-MM-dd');

        if (viewMode === 'year') {
            yearShiftLockRef.current = false;
            yearShiftAnimationKeyRef.current = 0;
            setYearShiftAnimation(null);
            setYearViewportStartOffset(0);
            if (scrollToMonthOffset(0, 'smooth')) {
                return;
            }

            pendingTopScrollAdjustRef.current = null;
            pendingScrollBehaviorRef.current = 'smooth';
            pendingYearScrollToMonthOffsetRef.current = 0;
            setYearRangeStartOffset(-12);
            setYearRangeEndOffset(23);
            return;
        }

        if (scrollToDateStr(todayStr, 'smooth')) {
            return;
        }

        pendingTopScrollAdjustRef.current = null;
        pendingScrollBehaviorRef.current = 'smooth';
        pendingScrollToDateRef.current = todayStr;
        setRangeStart(startOfWeek(addWeeks(normalizedToday, -initialWeeksPerSide), { weekStartsOn: WEEK_STARTS_ON }));
        setRangeEnd(endOfWeek(addWeeks(normalizedToday, initialWeeksPerSide), { weekStartsOn: WEEK_STARTS_ON }));
    }, [initialWeeksPerSide, scrollToDateStr, scrollToMonthOffset, viewMode]);

    const shiftYearViewport = useCallback(
        (direction: 'left' | 'right') => {
            if (yearShiftLockRef.current) {
                return;
            }

            yearShiftLockRef.current = true;
            pendingTopScrollAdjustRef.current = null;
            yearShiftAnimationKeyRef.current += 1;
            setYearShiftAnimation({
                key: yearShiftAnimationKeyRef.current,
                direction,
            });
        },
        []
    );

    const handleYearShiftAnimationComplete = useCallback(
        (shift: { key: number; direction: 'left' | 'right' }) => {
            const delta = shift.direction === 'left' ? 1 : -1;

            pendingTopScrollAdjustRef.current = null;
            setYearViewportStartOffset((previous) => previous + delta);
            setYearRangeStartOffset((previous) => previous + delta);
            setYearRangeEndOffset((previous) => previous + delta);
            setYearShiftAnimation((current) => (current?.key === shift.key ? null : current));
            yearShiftLockRef.current = false;
        },
        []
    );

    const handleQuickAddClick = useCallback(() => {
        const today = new Date();
        const normalizedToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        setSelectedDate(normalizedToday);
        setSelectedEvent(null);
        setIsModalOpen(true);
    }, []);

    // Code to allow dragging items from one day to another
    useEffect(() => {
        const cleanup = monitorForElements({
            onDragStart: ({ source, location }) => {
                if (source.data.type !== 'calendar-event') {
                    setDragRecurrenceIndicator(null);
                    return;
                }

                syncDragRecurrenceIndicator(location.current.input, source.data.event as CalendarItem);
            },
            onDrag: ({ source, location }) => {
                if (source.data.type !== 'calendar-event') {
                    setDragRecurrenceIndicator(null);
                    return;
                }

                syncDragRecurrenceIndicator(location.current.input, source.data.event as CalendarItem);
            },
            onDrop: (args) => {
                void (async () => {
                setDragRecurrenceIndicator(null);
                const { source, location } = args;
                const destination = location.current.dropTargets[0];

                const sourceData = source.data;
                const destData = destination?.data;

                if (!destination || sourceData.type !== 'calendar-event' || destData?.type !== 'calendar-day') {
                    return;
                }

                const event = sourceData.event as CalendarItem;
                const destinationDateStr = destData.dateStr as string;
                const masterEvent = (((event as any).__masterEvent as CalendarItem | undefined) || event) as CalendarItem;
                const masterRrule = normalizeRruleString(String(masterEvent.rrule || ''));

                const sourceDisplayDate =
                    typeof event.__displayDate === 'string' && event.__displayDate.trim().length > 0
                        ? event.__displayDate
                        : event.isAllDay
                            ? event.startDate
                            : format(parseISO(event.startDate), 'yyyy-MM-dd');
                const sourceDate = parseISO(sourceDisplayDate);
                const destinationDate = parseISO(destinationDateStr);
                const daysDifference = differenceInDays(destinationDate, sourceDate);

                if (daysDifference === 0) {
                    return;
                }

                let newStartDate, newEndDate;

                if (event.isAllDay) {
                    newStartDate = format(addDays(parseISO(event.startDate), daysDifference), 'yyyy-MM-dd');
                    newEndDate = format(addDays(parseISO(event.endDate), daysDifference), 'yyyy-MM-dd');
                } else {
                    newStartDate = addDays(parseISO(event.startDate), daysDifference).toISOString();
                    newEndDate = addDays(parseISO(event.endDate), daysDifference).toISOString();
                }
                const nowIso = new Date().toISOString();
                const legacyPayload = {
                    startDate: newStartDate,
                    endDate: newEndDate,
                    year: destinationDate.getFullYear(),
                    month: destinationDate.getMonth() + 1,
                    dayOfMonth: destinationDate.getDate(),
                };
                const doSimpleMove = (targetEvent: CalendarItem) => {
                    const nextSequence = typeof targetEvent.sequence === 'number' ? targetEvent.sequence + 1 : 1;
                    const fullPayload = {
                        ...legacyPayload,
                        updatedAt: nowIso,
                        lastModified: nowIso,
                        dtStamp: nowIso,
                        sequence: nextSequence,
                    };
                    const rollbackOptimisticMove = applyOptimisticCalendarItem({
                        ...targetEvent,
                        ...fullPayload,
                        id: targetEvent.id,
                    } as CalendarItem);

                    void (async () => {
                        try {
                            await db.transact([tx.calendarItems[targetEvent.id].update(fullPayload)]);
                        } catch (error) {
                            if (shouldRetryLegacyCalendarMutation(error)) {
                                try {
                                    await db.transact([tx.calendarItems[targetEvent.id].update(legacyPayload)]);
                                    return;
                                } catch (fallbackError) {
                                    console.error('Calendar move failed after legacy fallback:', fallbackError);
                                }
                            } else {
                                console.error('Calendar move failed:', error);
                            }

                            rollbackOptimisticMove();
                        }
                    })();
                };

                if (!masterRrule) {
                    doSimpleMove(event);
                    return;
                }

                const forcedRecurrenceScope = getForcedRecurrenceScopeFromInput(location.current.input, event, masterEvent);
                const recurrenceScope =
                    forcedRecurrenceScope ??
                    (await requestRecurrenceScope('drag', isOriginalSeriesOccurrence(event, masterEvent) ? 'all' : 'following'));
                if (recurrenceScope === 'cancel') {
                    return;
                }

                const sourceStartForRecurrence = parseISO(event.startDate);
                if (Number.isNaN(sourceStartForRecurrence.getTime())) {
                    return;
                }
                const destinationStartForRecurrence = parseISO(String(newStartDate));
                const recurrenceReferenceToken = event.isAllDay
                    ? format(sourceStartForRecurrence, 'yyyy-MM-dd')
                    : sourceStartForRecurrence.toISOString();
                const boundaryDateOnly = format(sourceStartForRecurrence, 'yyyy-MM-dd');

                const baseRdateTokens = normalizeRecurrenceTokens([
                    ...splitDateTokens(masterEvent.rdates),
                    ...collectRecurrenceLineTokens(masterEvent.recurrenceLines, 'RDATE'),
                ]);
                const baseExdateTokens = normalizeRecurrenceTokens([
                    ...splitDateTokens(masterEvent.exdates),
                    ...collectRecurrenceLineTokens(masterEvent.recurrenceLines, 'EXDATE'),
                ]);
                const masterSequence = typeof masterEvent.sequence === 'number' ? masterEvent.sequence : 0;

                const rollbackOptimisticHandlers: Array<() => void> = [];
                const registerRollback = (rollback: (() => void) | void) => {
                    if (typeof rollback === 'function') {
                        rollbackOptimisticHandlers.push(rollback);
                    }
                };
                const rollbackAll = () => {
                    while (rollbackOptimisticHandlers.length > 0) {
                        const rollback = rollbackOptimisticHandlers.pop();
                        try {
                            rollback?.();
                        } catch (error) {
                            console.error('Unable to rollback optimistic calendar update:', error);
                        }
                    }
                };

                if (recurrenceScope === 'single') {
                    // If the event is already an exception override, just move it in place.
                    // The master's exdates already exclude the original occurrence.
                    if (String(event.recurringEventId || '').trim()) {
                        const overridePatch: Record<string, any> = {
                            ...legacyPayload,
                            updatedAt: nowIso,
                            lastModified: nowIso,
                            dtStamp: nowIso,
                            sequence: typeof event.sequence === 'number' ? event.sequence + 1 : 1,
                        };

                        registerRollback(
                            applyOptimisticCalendarItem({
                                ...event,
                                ...overridePatch,
                                id: event.id,
                            } as CalendarItem)
                        );

                        void (async () => {
                            try {
                                await db.transact([tx.calendarItems[event.id].update(overridePatch)]);
                            } catch (error) {
                                console.error('Calendar recurring override move failed:', error);
                                rollbackAll();
                            }
                        })();
                        return;
                    }

                    const nextMasterExdates = normalizeRecurrenceTokens([...baseExdateTokens, recurrenceReferenceToken]);
                    const nextMasterPatch: Record<string, any> = {
                        exdates: nextMasterExdates,
                        recurrenceLines: buildRecurrenceLines(masterRrule, baseRdateTokens, nextMasterExdates),
                        updatedAt: nowIso,
                        lastModified: nowIso,
                        dtStamp: nowIso,
                        sequence: masterSequence + 1,
                    };

                    const overrideId = id();
                    const overrideMembers = Array.isArray(event.pertainsTo)
                        ? event.pertainsTo
                        : Array.isArray(masterEvent.pertainsTo)
                          ? masterEvent.pertainsTo
                          : [];
                    const overridePayload: Record<string, any> = {
                        ...legacyPayload,
                        title: String(event.title || masterEvent.title || ''),
                        description: String(event.description || masterEvent.description || ''),
                        isAllDay: event.isAllDay,
                        startDate: newStartDate,
                        endDate: newEndDate,
                        uid: `${String(masterEvent.uid || masterEvent.id)}-${recurrenceReferenceToken}`,
                        sequence: 0,
                        status: String(event.status || masterEvent.status || 'confirmed'),
                        createdAt: nowIso,
                        updatedAt: nowIso,
                        dtStamp: nowIso,
                        lastModified: nowIso,
                        location: String(event.location || masterEvent.location || ''),
                        timeZone: String(event.timeZone || masterEvent.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
                        rrule: '',
                        rdates: [],
                        exdates: [],
                        recurrenceLines: [],
                        recurrenceId: recurrenceReferenceToken,
                        recurringEventId: String(masterEvent.id),
                        recurrenceIdRange: '',
                        alarms: event.alarms || masterEvent.alarms || [],
                        eventType: String(event.eventType || masterEvent.eventType || 'default'),
                        visibility: String(event.visibility || masterEvent.visibility || 'default'),
                        transparency: String(event.transparency || masterEvent.transparency || (event.isAllDay ? 'transparent' : 'opaque')),
                        ...(typeof event.travelDurationBeforeMinutes === 'number'
                            ? { travelDurationBeforeMinutes: event.travelDurationBeforeMinutes }
                            : typeof masterEvent.travelDurationBeforeMinutes === 'number'
                              ? { travelDurationBeforeMinutes: masterEvent.travelDurationBeforeMinutes }
                              : {}),
                        ...(typeof event.travelDurationAfterMinutes === 'number'
                            ? { travelDurationAfterMinutes: event.travelDurationAfterMinutes }
                            : typeof masterEvent.travelDurationAfterMinutes === 'number'
                              ? { travelDurationAfterMinutes: masterEvent.travelDurationAfterMinutes }
                              : {}),
                    };

                    registerRollback(
                        applyOptimisticCalendarItem({
                            ...masterEvent,
                            ...nextMasterPatch,
                            id: masterEvent.id,
                        } as CalendarItem)
                    );
                    registerRollback(
                        applyOptimisticCalendarItem({
                            ...(event as any),
                            ...overridePayload,
                            id: overrideId,
                            pertainsTo: overrideMembers,
                        } as CalendarItem)
                    );

                    const txOps: any[] = [tx.calendarItems[masterEvent.id].update(nextMasterPatch), tx.calendarItems[overrideId].update(overridePayload)];
                    for (const member of overrideMembers) {
                        if (member?.id) {
                            txOps.push(tx.calendarItems[overrideId].link({ pertainsTo: member.id }));
                        }
                    }

                    void (async () => {
                        try {
                            await db.transact(txOps);
                        } catch (error) {
                            console.error('Calendar recurring single move failed:', error);
                            rollbackAll();
                        }
                    })();
                    return;
                }

                if (recurrenceScope === 'all') {
                    if (Number.isNaN(destinationStartForRecurrence.getTime())) {
                        doSimpleMove(masterEvent);
                        return;
                    }

                    const shiftedRrule = shiftRruleForSeriesMove(masterRrule, sourceStartForRecurrence, destinationStartForRecurrence);
                    const shiftedRdates = normalizeRecurrenceTokens(
                        baseRdateTokens.map((token) => shiftRecurrenceTokenByDays(token, daysDifference, event.isAllDay))
                    );
                    const shiftedExdates = normalizeRecurrenceTokens(
                        baseExdateTokens.map((token) => shiftRecurrenceTokenByDays(token, daysDifference, event.isAllDay))
                    );
                    const masterXProps =
                        masterEvent.xProps && typeof masterEvent.xProps === 'object' && !Array.isArray(masterEvent.xProps)
                            ? { ...(masterEvent.xProps as Record<string, unknown>) }
                            : {};
                    const shiftedExceptionRows = shiftStoredRecurrenceRowsByDays(
                        normalizeStoredRecurrenceExceptionRows((masterXProps as any)?.recurrenceExceptionRows),
                        daysDifference
                    );
                    const shiftedRdateRows = shiftStoredRecurrenceRowsByDays(
                        normalizeStoredRecurrenceExceptionRows((masterXProps as any)?.recurrenceRdateRows),
                        daysDifference
                    );
                    if (shiftedExceptionRows.length > 0) {
                        masterXProps.recurrenceExceptionRows = shiftedExceptionRows;
                    } else {
                        delete masterXProps.recurrenceExceptionRows;
                    }
                    if (shiftedRdateRows.length > 0) {
                        masterXProps.recurrenceRdateRows = shiftedRdateRows;
                    } else {
                        delete masterXProps.recurrenceRdateRows;
                    }

                    // Compute master's shifted dates from master's own position
                    // (not the dragged event's, which may be an override on a different date).
                    const masterStartParsed = parseISO(masterEvent.startDate);
                    const masterEndParsed = parseISO(masterEvent.endDate);
                    const masterShiftedStart = masterEvent.isAllDay
                        ? format(addDays(masterStartParsed, daysDifference), 'yyyy-MM-dd')
                        : addDays(masterStartParsed, daysDifference).toISOString();
                    const masterShiftedEnd = masterEvent.isAllDay
                        ? format(addDays(masterEndParsed, daysDifference), 'yyyy-MM-dd')
                        : addDays(masterEndParsed, daysDifference).toISOString();
                    const masterShiftedAnchor = addDays(masterStartParsed, daysDifference);

                    const nextMasterPatch: Record<string, any> = {
                        startDate: masterShiftedStart,
                        endDate: masterShiftedEnd,
                        year: masterShiftedAnchor.getFullYear(),
                        month: masterShiftedAnchor.getMonth() + 1,
                        dayOfMonth: masterShiftedAnchor.getDate(),
                        rrule: shiftedRrule,
                        rdates: shiftedRdates,
                        exdates: shiftedExdates,
                        recurrenceLines: buildRecurrenceLines(shiftedRrule, shiftedRdates, shiftedExdates),
                        updatedAt: nowIso,
                        lastModified: nowIso,
                        dtStamp: nowIso,
                        sequence: masterSequence + 1,
                        xProps: masterXProps,
                    };

                    registerRollback(
                        applyOptimisticCalendarItem({
                            ...masterEvent,
                            ...nextMasterPatch,
                            id: masterEvent.id,
                        } as CalendarItem)
                    );

                    const txOps: any[] = [tx.calendarItems[masterEvent.id].update(nextMasterPatch)];
                    const relatedOverrides = calendarItems.filter((candidate) => {
                        return isRecurringChildOfMaster(candidate, masterEvent) && !normalizeRruleString(String(candidate.rrule || ''));
                    });
                    for (const overrideItem of relatedOverrides) {
                        const overrideStartDate = parseISO(String(overrideItem.startDate));
                        const overrideEndDate = parseISO(String(overrideItem.endDate));
                        if (Number.isNaN(overrideStartDate.getTime()) || Number.isNaN(overrideEndDate.getTime())) {
                            continue;
                        }

                        const shiftedOverrideStart = overrideItem.isAllDay
                            ? format(addDays(overrideStartDate, daysDifference), 'yyyy-MM-dd')
                            : addDays(overrideStartDate, daysDifference).toISOString();
                        const shiftedOverrideEnd = overrideItem.isAllDay
                            ? format(addDays(overrideEndDate, daysDifference), 'yyyy-MM-dd')
                            : addDays(overrideEndDate, daysDifference).toISOString();
                        const overrideDayAnchor = parseISO(
                            overrideItem.isAllDay ? `${shiftedOverrideStart}T00:00:00` : shiftedOverrideStart
                        );
                        if (Number.isNaN(overrideDayAnchor.getTime())) {
                            continue;
                        }

                        const nextOverridePatch: Record<string, any> = {
                            startDate: shiftedOverrideStart,
                            endDate: shiftedOverrideEnd,
                            year: overrideDayAnchor.getFullYear(),
                            month: overrideDayAnchor.getMonth() + 1,
                            dayOfMonth: overrideDayAnchor.getDate(),
                            recurrenceId: shiftRecurrenceTokenByDays(
                                String(overrideItem.recurrenceId || overrideItem.startDate || ''),
                                daysDifference,
                                overrideItem.isAllDay
                            ),
                            updatedAt: nowIso,
                            lastModified: nowIso,
                            dtStamp: nowIso,
                            sequence: typeof overrideItem.sequence === 'number' ? overrideItem.sequence + 1 : 1,
                        };

                        registerRollback(
                            applyOptimisticCalendarItem({
                                ...overrideItem,
                                ...nextOverridePatch,
                                id: overrideItem.id,
                            } as CalendarItem)
                        );
                        txOps.push(tx.calendarItems[overrideItem.id].update(nextOverridePatch));
                    }

                    void (async () => {
                        try {
                            await db.transact(txOps);
                        } catch (error) {
                            console.error('Calendar recurring series move failed:', error);
                            rollbackAll();
                        }
                    })();
                    return;
                }

                const masterStart = parseISO(masterEvent.startDate);
                const isFirstOccurrence = !Number.isNaN(masterStart.getTime()) && masterStart.getTime() === sourceStartForRecurrence.getTime();

                if (isFirstOccurrence) {
                    doSimpleMove(masterEvent);
                    return;
                }

                const cappedMasterRrule = capRruleBeforeOccurrence(masterRrule, sourceStartForRecurrence, event.isAllDay);
                const oldSeriesRdates = partitionRecurrenceTokensByBoundary(baseRdateTokens, sourceStartForRecurrence, event.isAllDay);
                const oldSeriesExdates = partitionRecurrenceTokensByBoundary(baseExdateTokens, sourceStartForRecurrence, event.isAllDay);
                const masterXProps =
                    masterEvent.xProps && typeof masterEvent.xProps === 'object' && !Array.isArray(masterEvent.xProps)
                        ? { ...(masterEvent.xProps as Record<string, unknown>) }
                        : {};
                const oldExceptionRowsSplit = splitRecurrenceRowsAtBoundary(
                    normalizeStoredRecurrenceExceptionRows((masterXProps as any)?.recurrenceExceptionRows),
                    boundaryDateOnly
                );
                const oldRdateRowsSplit = splitRecurrenceRowsAtBoundary(
                    normalizeStoredRecurrenceExceptionRows((masterXProps as any)?.recurrenceRdateRows),
                    boundaryDateOnly
                );
                const oldSeriesXProps = { ...masterXProps };
                const newSeriesXProps = { ...masterXProps };
                if (oldExceptionRowsSplit.before.length > 0) {
                    oldSeriesXProps.recurrenceExceptionRows = oldExceptionRowsSplit.before;
                } else {
                    delete oldSeriesXProps.recurrenceExceptionRows;
                }
                if (oldExceptionRowsSplit.onOrAfter.length > 0) {
                    newSeriesXProps.recurrenceExceptionRows = oldExceptionRowsSplit.onOrAfter;
                } else {
                    delete newSeriesXProps.recurrenceExceptionRows;
                }
                if (oldRdateRowsSplit.before.length > 0) {
                    oldSeriesXProps.recurrenceRdateRows = oldRdateRowsSplit.before;
                } else {
                    delete oldSeriesXProps.recurrenceRdateRows;
                }
                if (oldRdateRowsSplit.onOrAfter.length > 0) {
                    newSeriesXProps.recurrenceRdateRows = oldRdateRowsSplit.onOrAfter;
                } else {
                    delete newSeriesXProps.recurrenceRdateRows;
                }

                const oldSeriesPatch: Record<string, any> = {
                    rrule: cappedMasterRrule,
                    rdates: oldSeriesRdates.before,
                    exdates: oldSeriesExdates.before,
                    recurrenceLines: buildRecurrenceLines(cappedMasterRrule, oldSeriesRdates.before, oldSeriesExdates.before),
                    updatedAt: nowIso,
                    lastModified: nowIso,
                    dtStamp: nowIso,
                    sequence: masterSequence + 1,
                    xProps: oldSeriesXProps,
                };

                const newSeriesId = id();
                const newSeriesMembers = Array.isArray(masterEvent.pertainsTo) ? masterEvent.pertainsTo : [];
                const shiftedSplitRrule = shiftRruleForSeriesMove(masterRrule, sourceStartForRecurrence, destinationStartForRecurrence);
                const shiftedSplitRdates = normalizeRecurrenceTokens(
                    oldSeriesRdates.onOrAfter.map((token) => shiftRecurrenceTokenByDays(token, daysDifference, event.isAllDay))
                );
                const shiftedSplitExdates = normalizeRecurrenceTokens(
                    oldSeriesExdates.onOrAfter.map((token) => shiftRecurrenceTokenByDays(token, daysDifference, event.isAllDay))
                );
                const shiftedSplitExceptionRows = shiftStoredRecurrenceRowsByDays(oldExceptionRowsSplit.onOrAfter, daysDifference);
                const shiftedSplitRdateRows = shiftStoredRecurrenceRowsByDays(oldRdateRowsSplit.onOrAfter, daysDifference);
                if (shiftedSplitExceptionRows.length > 0) {
                    newSeriesXProps.recurrenceExceptionRows = shiftedSplitExceptionRows;
                } else {
                    delete newSeriesXProps.recurrenceExceptionRows;
                }
                if (shiftedSplitRdateRows.length > 0) {
                    newSeriesXProps.recurrenceRdateRows = shiftedSplitRdateRows;
                } else {
                    delete newSeriesXProps.recurrenceRdateRows;
                }
                const newSeriesPayload: Record<string, any> = {
                    ...legacyPayload,
                    title: String(event.title || masterEvent.title || ''),
                    description: String(event.description || masterEvent.description || ''),
                    isAllDay: event.isAllDay,
                    startDate: newStartDate,
                    endDate: newEndDate,
                    uid: `${String(masterEvent.uid || masterEvent.id)}-split-${newSeriesId}`,
                    sequence: 0,
                    status: String(event.status || masterEvent.status || 'confirmed'),
                    createdAt: nowIso,
                    updatedAt: nowIso,
                    dtStamp: nowIso,
                    lastModified: nowIso,
                    location: String(event.location || masterEvent.location || ''),
                    timeZone: String(event.timeZone || masterEvent.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'),
                    rrule: shiftedSplitRrule,
                    rdates: shiftedSplitRdates,
                    exdates: shiftedSplitExdates,
                    recurrenceLines: buildRecurrenceLines(shiftedSplitRrule, shiftedSplitRdates, shiftedSplitExdates),
                    recurrenceId: '',
                    recurringEventId: '',
                    recurrenceIdRange: '',
                    alarms: event.alarms || masterEvent.alarms || [],
                    eventType: String(event.eventType || masterEvent.eventType || 'default'),
                    visibility: String(event.visibility || masterEvent.visibility || 'default'),
                    transparency: String(event.transparency || masterEvent.transparency || (event.isAllDay ? 'transparent' : 'opaque')),
                    xProps: newSeriesXProps,
                    ...(typeof event.travelDurationBeforeMinutes === 'number'
                        ? { travelDurationBeforeMinutes: event.travelDurationBeforeMinutes }
                        : typeof masterEvent.travelDurationBeforeMinutes === 'number'
                          ? { travelDurationBeforeMinutes: masterEvent.travelDurationBeforeMinutes }
                          : {}),
                    ...(typeof event.travelDurationAfterMinutes === 'number'
                        ? { travelDurationAfterMinutes: event.travelDurationAfterMinutes }
                        : typeof masterEvent.travelDurationAfterMinutes === 'number'
                          ? { travelDurationAfterMinutes: masterEvent.travelDurationAfterMinutes }
                          : {}),
                };

                const boundaryTime = event.isAllDay
                    ? parseISO(`${boundaryDateOnly}T00:00:00`).getTime()
                    : sourceStartForRecurrence.getTime();
                const overridesToMove = calendarItems.filter((candidate) => {
                    if (!isRecurringChildOfMaster(candidate, masterEvent)) return false;
                    const recurrenceRefToken =
                        typeof candidate.recurrenceId === 'string' && candidate.recurrenceId.trim()
                            ? candidate.recurrenceId
                            : candidate.startDate;
                    const recurrenceRefDate = parseRecurrenceDateToken(String(recurrenceRefToken || ''));
                    if (!recurrenceRefDate) return false;
                    const recurrenceTime = candidate.isAllDay
                        ? parseISO(`${format(recurrenceRefDate, 'yyyy-MM-dd')}T00:00:00`).getTime()
                        : recurrenceRefDate.getTime();
                    return recurrenceTime >= boundaryTime;
                });

                registerRollback(
                    applyOptimisticCalendarItem({
                        ...masterEvent,
                        ...oldSeriesPatch,
                        id: masterEvent.id,
                    } as CalendarItem)
                );
                registerRollback(
                    applyOptimisticCalendarItem({
                        ...masterEvent,
                        ...newSeriesPayload,
                        id: newSeriesId,
                        pertainsTo: newSeriesMembers,
                    } as CalendarItem)
                );

                const txOps: any[] = [tx.calendarItems[masterEvent.id].update(oldSeriesPatch), tx.calendarItems[newSeriesId].update(newSeriesPayload)];
                for (const member of newSeriesMembers) {
                    if (member?.id) {
                        txOps.push(tx.calendarItems[newSeriesId].link({ pertainsTo: member.id }));
                    }
                }
                for (const override of overridesToMove) {
                    const overrideStartDate = parseISO(String(override.startDate));
                    const overrideEndDate = parseISO(String(override.endDate));
                    const shiftedOverrideStart =
                        !Number.isNaN(overrideStartDate.getTime()) && !Number.isNaN(overrideEndDate.getTime())
                            ? override.isAllDay
                                ? format(addDays(overrideStartDate, daysDifference), 'yyyy-MM-dd')
                                : addDays(overrideStartDate, daysDifference).toISOString()
                            : override.startDate;
                    const shiftedOverrideEnd =
                        !Number.isNaN(overrideStartDate.getTime()) && !Number.isNaN(overrideEndDate.getTime())
                            ? override.isAllDay
                                ? format(addDays(overrideEndDate, daysDifference), 'yyyy-MM-dd')
                                : addDays(overrideEndDate, daysDifference).toISOString()
                            : override.endDate;
                    const shiftedOverrideAnchor = parseISO(
                        override.isAllDay ? `${shiftedOverrideStart}T00:00:00` : shiftedOverrideStart
                    );
                    const overridePatch = {
                        startDate: shiftedOverrideStart,
                        endDate: shiftedOverrideEnd,
                        year: Number.isNaN(shiftedOverrideAnchor.getTime()) ? override.year : shiftedOverrideAnchor.getFullYear(),
                        month: Number.isNaN(shiftedOverrideAnchor.getTime()) ? override.month : shiftedOverrideAnchor.getMonth() + 1,
                        dayOfMonth: Number.isNaN(shiftedOverrideAnchor.getTime()) ? override.dayOfMonth : shiftedOverrideAnchor.getDate(),
                        recurrenceId: shiftRecurrenceTokenByDays(
                            String(override.recurrenceId || override.startDate || ''),
                            daysDifference,
                            override.isAllDay
                        ),
                        recurringEventId: newSeriesId,
                        updatedAt: nowIso,
                        lastModified: nowIso,
                        dtStamp: nowIso,
                        sequence: typeof override.sequence === 'number' ? override.sequence + 1 : 1,
                    };
                    registerRollback(
                        applyOptimisticCalendarItem({
                            ...override,
                            ...overridePatch,
                            id: override.id,
                        } as CalendarItem)
                    );
                    txOps.push(tx.calendarItems[override.id].update(overridePatch));
                }

                void (async () => {
                    try {
                        await db.transact(txOps);
                    } catch (error) {
                        console.error('Calendar recurring split move failed:', error);
                        rollbackAll();
                    }
                })();
                })();
            },
        });

        return cleanup;
    }, [applyOptimisticCalendarItem, calendarItems, getForcedRecurrenceScopeFromInput, isOriginalSeriesOccurrence, requestRecurrenceScope, syncDragRecurrenceIndicator]);

    useLayoutEffect(() => {
        const pendingAdjust = pendingTopScrollAdjustRef.current;
        const container = scrollContainerRef.current;
        if (!pendingAdjust || !container) return;

        let adjusted = false;

        // 1. Try to anchor to the exact physical element we tracked
        if (pendingAdjust.anchorSelector) {
            const anchorElement = container.querySelector<HTMLElement>(pendingAdjust.anchorSelector);
            if (anchorElement) {
                const containerTop = container.getBoundingClientRect().top;
                const currentOffset = anchorElement.getBoundingClientRect().top - containerTop;
                const shift = currentOffset - pendingAdjust.anchorOffset;

                if (shift !== 0) {
                    container.scrollTop += shift;
                    adjusted = true;
                }
            }
        }

        // 2. Fallback to the old logic if the anchor element vanished (unlikely)
        if (!adjusted && pendingAdjust.prevScrollHeight) {
            const deltaHeight = container.scrollHeight - pendingAdjust.prevScrollHeight;
            container.scrollTop = Math.max(0, pendingAdjust.prevScrollTop + deltaHeight);
        }

        pendingTopScrollAdjustRef.current = null;
    }, [rangeStart, rangeEnd, yearRangeStartOffset, yearRangeEndOffset]);

    useLayoutEffect(() => {
        const syncContainerHeight = () => {
            const container = scrollContainerRef.current;
            if (!container) return;

            if (isMiniInfinite) {
                setScrollContainerHeight(Math.max(0, Math.floor(container.clientHeight)));
                setScrollContainerWidth(Math.max(0, Math.floor(container.clientWidth)));
                setDayNumberStickyTop(0);
                return;
            }

            const rect = container.getBoundingClientRect();
            const remaining = window.innerHeight - rect.top - 8;
            setScrollContainerHeight(Math.max(360, Math.floor(remaining)));
            setScrollContainerWidth(Math.max(0, Math.floor(rect.width)));
            const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
            setDayNumberStickyTop(Math.max(0, Math.ceil(headerHeight) + 2));
        };

        syncContainerHeight();
        if (isMiniInfinite && typeof ResizeObserver !== 'undefined') {
            const container = scrollContainerRef.current;
            if (!container) return;
            const observer = new ResizeObserver(() => {
                syncContainerHeight();
            });
            observer.observe(container);
            return () => observer.disconnect();
        }

        window.addEventListener('resize', syncContainerHeight);
        return () => window.removeEventListener('resize', syncContainerHeight);
    }, [isMiniInfinite, viewMode]);

    useLayoutEffect(() => {
        recalculateMonthBoxSize();
    }, [activeMonthLabel, previousMonthLabel, recalculateMonthBoxSize]);

    useEffect(() => {
        window.addEventListener('resize', recalculateMonthBoxSize);
        return () => window.removeEventListener('resize', recalculateMonthBoxSize);
    }, [recalculateMonthBoxSize]);

    useEffect(() => {
        if (isMiniInfinite || viewMode !== 'year') return;
        yearShiftLockRef.current = false;
        yearShiftAnimationKeyRef.current = 0;
        setYearViewportStartOffset(0);
        setYearRangeStartOffset(-12);
        setYearRangeEndOffset(23);
        setYearShiftAnimation(null);
        pendingYearScrollToMonthOffsetRef.current = 0;
    }, [isMiniInfinite, viewMode, yearMonthBasis]);

    const transitionToMonth = useCallback((nextMonth: MonthLabel) => {
        const current = monthLabelRef.current;
        if (current.key === nextMonth.key) {
            return;
        }

        setPreviousMonthLabel(current);
        setActiveMonthLabel(nextMonth);
        setIsMonthTransitioning(true);

        if (monthFadeTimerRef.current !== null) {
            window.clearTimeout(monthFadeTimerRef.current);
        }

        monthFadeTimerRef.current = window.setTimeout(() => {
            setPreviousMonthLabel(null);
            setIsMonthTransitioning(false);
            monthFadeTimerRef.current = null;
        }, MONTH_FADE_MS);

        monthLabelRef.current = nextMonth;
    }, []);

    const updateVisibleMonthFromScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const headerHeight = headerRef.current?.getBoundingClientRect().height ?? 0;
        const containerTop = container.getBoundingClientRect().top;
        const scanLine = containerTop + headerHeight + 8;
        const dayMarkers = Array.from(container.querySelectorAll<HTMLElement>('[data-calendar-cell-date]'));

        if (dayMarkers.length === 0) return;

        let activeMarker: HTMLElement | null = null;
        for (const marker of dayMarkers) {
            const rect = marker.getBoundingClientRect();
            if (rect.bottom >= scanLine) {
                activeMarker = marker;
                break;
            }
        }

        if (!activeMarker) {
            activeMarker = dayMarkers[dayMarkers.length - 1];
        }

        const dateStr = activeMarker.dataset.calendarCellDate;
        if (!dateStr) return;

        const visibleDate = parseISO(dateStr);
        if (Number.isNaN(visibleDate.getTime())) return;

        transitionToMonth(buildMonthLabel(visibleDate));
    }, [buildMonthLabel, transitionToMonth]);

    const expandRangeRef = useRef(expandRange);
    useEffect(() => {
        expandRangeRef.current = expandRange;
    }, [expandRange]);

    const expandYearRangeRef = useRef(expandYearRange);
    useEffect(() => {
        expandYearRangeRef.current = expandYearRange;
    }, [expandYearRange]);

    const updateVisibleMonthFromScrollRef = useRef(updateVisibleMonthFromScroll);
    useEffect(() => {
        updateVisibleMonthFromScrollRef.current = updateVisibleMonthFromScroll;
    }, [updateVisibleMonthFromScroll]);

    useEffect(() => {
        if (viewMode !== 'monthly') return;

        const container = scrollContainerRef.current;
        if (!container) return;

        const onScroll = () => {
            if (scrollRafRef.current !== null) return;
            scrollRafRef.current = window.requestAnimationFrame(() => {
                scrollRafRef.current = null;

                if (!isMiniInfinite) {
                    updateVisibleMonthFromScrollRef.current();
                }

                const activeContainer = scrollContainerRef.current;
                if (!activeContainer) return;

                const now = Date.now();
                const scrollTop = activeContainer.scrollTop;
                const previousScrollTop = lastScrollTopRef.current;
                const scrollDelta = previousScrollTop === null ? 0 : scrollTop - previousScrollTop;
                lastScrollTopRef.current = scrollTop;

                const nearTop = activeContainer.scrollTop <= EDGE_TRIGGER_PX;
                const nearBottom =
                    activeContainer.scrollHeight - activeContainer.clientHeight - activeContainer.scrollTop <= EDGE_TRIGGER_PX;

                if (nearTop && scrollDelta < 0) {
                    const cooldownElapsed = now - lastTopLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                    if (cooldownElapsed) {
                        lastTopLoadAtRef.current = now;
                        expandRangeRef.current('up');
                    }
                }

                if (nearBottom && scrollDelta > 0) {
                    const cooldownElapsed = now - lastBottomLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                    if (cooldownElapsed) {
                        lastBottomLoadAtRef.current = now;
                        expandRangeRef.current('down');
                    }
                }
            });
        };

        const onWheel = (event: WheelEvent) => {
            const activeContainer = scrollContainerRef.current;
            if (!activeContainer) return;

            const now = Date.now();
            const nearTop = activeContainer.scrollTop <= EDGE_TRIGGER_PX;
            const nearBottom = activeContainer.scrollHeight - activeContainer.clientHeight - activeContainer.scrollTop <= EDGE_TRIGGER_PX;

            if (event.deltaY < 0 && nearTop) {
                const cooldownElapsed = now - lastTopLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                if (cooldownElapsed) {
                    lastTopLoadAtRef.current = now;
                    expandRangeRef.current('up');
                }
            }

            if (event.deltaY > 0 && nearBottom) {
                const cooldownElapsed = now - lastBottomLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                if (cooldownElapsed) {
                    lastBottomLoadAtRef.current = now;
                    expandRangeRef.current('down');
                }
            }
        };

        if (!isMiniInfinite) {
            updateVisibleMonthFromScrollRef.current();
        }
        lastScrollTopRef.current = container.scrollTop;
        container.addEventListener('scroll', onScroll, { passive: true });
        container.addEventListener('wheel', onWheel, { passive: true });

        return () => {
            container.removeEventListener('scroll', onScroll);
            container.removeEventListener('wheel', onWheel);
            if (scrollRafRef.current !== null) {
                window.cancelAnimationFrame(scrollRafRef.current);
                scrollRafRef.current = null;
            }
        };
    }, [isMiniInfinite, viewMode]);

    useEffect(() => {
        if (viewMode !== 'year') return;

        const container = scrollContainerRef.current;
        if (!container) return;

        const onScroll = () => {
            if (scrollRafRef.current !== null) return;
            scrollRafRef.current = window.requestAnimationFrame(() => {
                scrollRafRef.current = null;

                const activeContainer = scrollContainerRef.current;
                if (!activeContainer) return;

                const now = Date.now();
                const scrollTop = activeContainer.scrollTop;
                const previousScrollTop = lastScrollTopRef.current;
                const scrollDelta = previousScrollTop === null ? 0 : scrollTop - previousScrollTop;
                lastScrollTopRef.current = scrollTop;

                const nearTop = activeContainer.scrollTop <= EDGE_TRIGGER_PX;
                const nearBottom =
                    activeContainer.scrollHeight - activeContainer.clientHeight - activeContainer.scrollTop <= EDGE_TRIGGER_PX;

                if (nearTop && scrollDelta < 0) {
                    const cooldownElapsed = now - lastTopLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                    if (cooldownElapsed) {
                        lastTopLoadAtRef.current = now;
                        expandYearRangeRef.current('up');
                    }
                }

                if (nearBottom && scrollDelta > 0) {
                    const cooldownElapsed = now - lastBottomLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                    if (cooldownElapsed) {
                        lastBottomLoadAtRef.current = now;
                        expandYearRangeRef.current('down');
                    }
                }
            });
        };

        const onWheel = (event: WheelEvent) => {
            const activeContainer = scrollContainerRef.current;
            if (!activeContainer) return;

            const now = Date.now();
            const nearTop = activeContainer.scrollTop <= EDGE_TRIGGER_PX;
            const nearBottom = activeContainer.scrollHeight - activeContainer.clientHeight - activeContainer.scrollTop <= EDGE_TRIGGER_PX;

            if (event.deltaY < 0 && nearTop) {
                const cooldownElapsed = now - lastTopLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                if (cooldownElapsed) {
                    lastTopLoadAtRef.current = now;
                    expandYearRangeRef.current('up');
                }
            }

            if (event.deltaY > 0 && nearBottom) {
                const cooldownElapsed = now - lastBottomLoadAtRef.current >= EDGE_LOAD_COOLDOWN_MS;
                if (cooldownElapsed) {
                    lastBottomLoadAtRef.current = now;
                    expandYearRangeRef.current('down');
                }
            }
        };

        lastScrollTopRef.current = container.scrollTop;
        container.addEventListener('scroll', onScroll, { passive: true });
        container.addEventListener('wheel', onWheel, { passive: true });

        return () => {
            container.removeEventListener('scroll', onScroll);
            container.removeEventListener('wheel', onWheel);
            if (scrollRafRef.current !== null) {
                window.cancelAnimationFrame(scrollRafRef.current);
                scrollRafRef.current = null;
            }
        };
    }, [viewMode]);

    useEffect(() => {
        if (isMiniInfinite || viewMode !== 'monthly') return;
        updateVisibleMonthFromScroll();
    }, [isMiniInfinite, viewMode, weeks.length, updateVisibleMonthFromScroll]);

    useEffect(() => {
        if (typeof window === 'undefined' || !commandsEnabled) return;
        window.localStorage.setItem(CALENDAR_DAY_HEIGHT_STORAGE_KEY, String(dayCellHeight));
    }, [commandsEnabled, dayCellHeight]);

    useEffect(() => {
        if (typeof window === 'undefined' || !commandsEnabled) return;
        window.localStorage.setItem(CALENDAR_SHOW_CHORES_STORAGE_KEY, effectiveShowChores ? 'true' : 'false');
    }, [commandsEnabled, effectiveShowChores]);

    useEffect(() => {
        if (typeof window === 'undefined' || !commandsEnabled) return;
        window.localStorage.setItem(CALENDAR_VIEW_MODE_STORAGE_KEY, viewMode);
    }, [commandsEnabled, viewMode]);

    useEffect(() => {
        if (typeof window === 'undefined' || !commandsEnabled) return;
        window.localStorage.setItem(CALENDAR_YEAR_MONTH_BASIS_STORAGE_KEY, yearMonthBasis);
    }, [commandsEnabled, yearMonthBasis]);

    useEffect(() => {
        if (typeof window === 'undefined' || !commandsEnabled) return;
        window.localStorage.setItem(CALENDAR_YEAR_FONT_SCALE_STORAGE_KEY, String(yearFontScale));
    }, [commandsEnabled, yearFontScale]);

    useEffect(() => {
        if (!commandsEnabled) return;
        const detail: CalendarStateDetail = {
            dayHeight: effectiveDayCellHeight,
            visibleWeeks: visibleWeeksEstimate,
            showChores: effectiveShowChores,
            viewMode,
            yearMonthBasis,
            yearFontScale: effectiveYearFontScale,
            choreFilter: {
                configured: effectiveChoreFilterConfigured,
                selectedChoreIds: effectiveSelectedChoreIds,
            },
            memberFilter: {
                everyoneSelected: effectiveEveryoneSelected,
                selectedMemberIds: effectiveSelectedMemberIds,
            },
        };
        window.dispatchEvent(new CustomEvent<CalendarStateDetail>(CALENDAR_STATE_EVENT, { detail }));
    }, [
        commandsEnabled,
        effectiveChoreFilterConfigured,
        effectiveDayCellHeight,
        effectiveEveryoneSelected,
        effectiveSelectedChoreIds,
        effectiveSelectedMemberIds,
        effectiveShowChores,
        viewMode,
        visibleWeeksEstimate,
        effectiveYearFontScale,
        yearMonthBasis,
    ]);

    useEffect(() => {
        if (!commandsEnabled) return;
        const onCalendarCommand = (event: Event) => {
            const detail = (event as CustomEvent<CalendarCommandDetail>).detail;
            if (!detail) return;

            if (detail.type === 'setDayHeight') {
                setDayHeight(detail.dayHeight);
                return;
            }

            if (detail.type === 'setVisibleWeeks') {
                applyVisibleWeeks(detail.visibleWeeks);
                return;
            }

            if (detail.type === 'setShowChores') {
                setShowChores(Boolean(detail.showChores));
                return;
            }

            if (detail.type === 'setViewMode') {
                setViewMode(detail.viewMode === 'year' ? 'year' : 'monthly');
                return;
            }

            if (detail.type === 'setYearMonthBasis') {
                setYearMonthBasis(detail.yearMonthBasis === 'bs' ? 'bs' : 'gregorian');
                return;
            }

            if (detail.type === 'setYearFontScale') {
                setYearFontScale(clampCalendarYearFontScale(detail.yearFontScale));
                return;
            }

            if (detail.type === 'shiftYearView') {
                shiftYearViewport(detail.direction === 'right' ? 'right' : 'left');
                return;
            }

            if (detail.type === 'setChoreFilter') {
                const sanitizedChoreIds = Array.from(
                    new Set(
                        (Array.isArray(detail.selectedChoreIds) ? detail.selectedChoreIds : [])
                            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                            .map((value) => value.trim())
                    )
                );
                setSelectedChoreIds(sanitizedChoreIds);
                setChoreFilterConfigured(true);
                return;
            }

            if (detail.type === 'setMemberFilter') {
                const sanitizedMemberIds = Array.from(
                    new Set(
                        (Array.isArray(detail.selectedMemberIds) ? detail.selectedMemberIds : [])
                            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
                            .map((value) => value.trim())
                    )
                );
                setEveryoneSelected(Boolean(detail.everyoneSelected));
                setSelectedMemberIds(sanitizedMemberIds);
                setMemberFilterConfigured(true);
                return;
            }

            if (detail.type === 'scrollToday') {
                handleTodayClick();
                return;
            }

            if (detail.type === 'quickAdd') {
                handleQuickAddClick();
                return;
            }

            if (detail.type === 'requestState') {
                    const stateDetail: CalendarStateDetail = {
                    dayHeight: effectiveDayCellHeight,
                    visibleWeeks: visibleWeeksEstimate,
                    showChores: effectiveShowChores,
                    viewMode,
                    yearMonthBasis,
                    yearFontScale: effectiveYearFontScale,
                    choreFilter: {
                        configured: effectiveChoreFilterConfigured,
                        selectedChoreIds: effectiveSelectedChoreIds,
                    },
                    memberFilter: {
                        everyoneSelected: effectiveEveryoneSelected,
                        selectedMemberIds: effectiveSelectedMemberIds,
                    },
                };
                window.dispatchEvent(new CustomEvent<CalendarStateDetail>(CALENDAR_STATE_EVENT, { detail: stateDetail }));
            }
        };

        window.addEventListener(CALENDAR_COMMAND_EVENT, onCalendarCommand);
        return () => {
            window.removeEventListener(CALENDAR_COMMAND_EVENT, onCalendarCommand);
        };
    }, [
        applyVisibleWeeks,
        commandsEnabled,
        effectiveChoreFilterConfigured,
        effectiveDayCellHeight,
        effectiveEveryoneSelected,
        effectiveSelectedChoreIds,
        effectiveSelectedMemberIds,
        effectiveShowChores,
        handleQuickAddClick,
        handleTodayClick,
        setDayHeight,
        shiftYearViewport,
        visibleWeeksEstimate,
        viewMode,
        effectiveYearFontScale,
        yearMonthBasis,
    ]);

    useEffect(() => {
        if (viewMode !== 'monthly') return;
        const pendingDate = pendingScrollToDateRef.current;
        if (!pendingDate || scrollContainerHeight === null) return;

        if (scrollToDateStr(pendingDate, pendingScrollBehaviorRef.current)) {
            pendingScrollToDateRef.current = null;
            pendingScrollBehaviorRef.current = 'smooth';
        }
    }, [scrollContainerHeight, viewMode, weeks.length, scrollToDateStr]);

    useEffect(() => {
        if (viewMode !== 'year') return;
        const pendingMonthOffset = pendingYearScrollToMonthOffsetRef.current;
        if (pendingMonthOffset == null || scrollContainerHeight === null || scrollContainerWidth === null) return;

        if (scrollToMonthOffset(pendingMonthOffset, pendingScrollBehaviorRef.current)) {
            pendingYearScrollToMonthOffsetRef.current = null;
            pendingScrollBehaviorRef.current = 'smooth';
        }
    }, [
        scrollContainerHeight,
        scrollContainerWidth,
        scrollToMonthOffset,
        viewMode,
        yearLayout.columns,
        yearRangeEndOffset,
        yearRangeStartOffset,
        yearViewportStartOffset,
    ]);

    useEffect(() => {
        monthLabelRef.current = activeMonthLabel;
    }, [activeMonthLabel]);

    useEffect(() => {
        return () => {
            if (monthFadeTimerRef.current !== null) {
                window.clearTimeout(monthFadeTimerRef.current);
            }
        };
    }, []);

    const query = useMemo(
        () => ({
            calendarItems: {
                pertainsTo: {},
                $: {
                    where: {
                        or: [...monthConditions, { rrule: { $isNull: false } }, ...recurrenceReferenceMonthConditions],
                    },
                },
            },
            chores: {
                assignees: {},
                assignments: {
                    familyMember: {},
                },
            },
            familyMembers: {},
        }),
        [monthConditions, recurrenceReferenceMonthConditions]
    );

    const queryResult = (db as any).useQuery(query) as any;
    const { isLoading, error, data } = queryResult;
    const chores = useMemo(() => ((data?.chores as Chore[]) || []), [data?.chores]);
    const familyMembers = useMemo(
        () =>
            (((data?.familyMembers as CalendarMemberWithColor[]) || []).filter(
                (member) => typeof member?.id === 'string' && member.id.trim().length > 0
            )),
        [data?.familyMembers]
    );
    const memberColorsById = useMemo(() => buildMemberColorMap(familyMembers), [familyMembers]);

    useEffect(() => {
        if (!isLoading && !error && data) {
            setCalendarItems(
                applyResolvedMemberColorsToCalendarItems(
                    mergeCalendarItemsWithOptimistic(data.calendarItems as CalendarItem[], optimisticItemsById),
                    memberColorsById
                )
            );
        }
    }, [isLoading, data, error, optimisticItemsById, memberColorsById]);

    useEffect(() => {
        if (!data || isLoading || error) return;

        const serverItems = (data.calendarItems || []) as CalendarItem[];
        setOptimisticItemsById((prev) => {
            let changed = false;
            const next = { ...prev };

            for (const [id, optimisticItem] of Object.entries(prev)) {
                const serverItem = serverItems.find((item) => item.id === id);
                if (optimisticItemSatisfiedByServer(serverItem, optimisticItem)) {
                    delete next[id];
                    changed = true;
                }
            }

            return changed ? next : prev;
        });
    }, [data, isLoading, error]);

    const { dayItemsByDate, denseDayItemsByDate, weekSpanLanesByWeek } = useMemo(() => {
        const byDate = new Map<string, CalendarItem[]>();
        const denseByDate = new Map<string, CalendarItem[]>();
        const weekSpanSegmentsByWeek = new Map<string, CalendarWeekSpanSegment[]>();
        const rangeStartTime = activeRangeStart.getTime();
        const rangeEndTime = activeRangeEnd.getTime();
        const rangeStartDay = toDayStart(activeRangeStart);
        const rangeEndDay = toDayStart(activeRangeEnd);
        const recurrenceOverrideDayKeysByMasterId = new Map<string, Set<string>>();
        const selectedMemberIdSet = new Set(effectiveSelectedMemberIds);
        const selectedChoreIdSet = new Set(effectiveSelectedChoreIds);

        const matchesMemberFilter = (item: CalendarItem) => {
            const pertainsToIds = (Array.isArray(item.pertainsTo) ? item.pertainsTo : [])
                .map((member) => member?.id)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
                .map((id) => id.trim());
            const isEveryoneEvent = pertainsToIds.length === 0;

            if (!effectiveMemberFilterConfigured && effectiveEveryoneSelected && selectedMemberIdSet.size === 0) {
                return true;
            }

            if (effectiveEveryoneSelected) {
                if (selectedMemberIdSet.size === 0) {
                    return isEveryoneEvent;
                }
                if (isEveryoneEvent) {
                    return true;
                }
                return pertainsToIds.some((id) => selectedMemberIdSet.has(id));
            }

            if (selectedMemberIdSet.size === 0) return false;
            if (isEveryoneEvent) return false;
            return pertainsToIds.some((id) => selectedMemberIdSet.has(id));
        };

        const matchesChoreMemberFilter = (assignedMembers: Array<{ id: string; name?: string; color?: string | null }>) => {
            const assignedIds = assignedMembers
                .map((member) => member?.id)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
                .map((id) => id.trim());

            if (assignedIds.length === 0) {
                return false;
            }

            if (!effectiveMemberFilterConfigured && effectiveEveryoneSelected && selectedMemberIdSet.size === 0) {
                return true;
            }

            if (selectedMemberIdSet.size === 0) {
                return false;
            }

            return assignedIds.some((id) => selectedMemberIdSet.has(id));
        };

        const matchesChoreIdFilter = (choreId: string) => {
            const normalizedId = String(choreId || '').trim();
            if (!normalizedId) {
                return false;
            }

            if (!effectiveChoreFilterConfigured && selectedChoreIdSet.size === 0) {
                return true;
            }

            if (selectedChoreIdSet.size === 0) {
                return false;
            }

            return selectedChoreIdSet.has(normalizedId);
        };

        const calendarItemsForView = calendarItems.filter(matchesMemberFilter);
        const calendarItemsById = new Map(calendarItems.map((item) => [item.id, item] as const));
        const calendarItemsBySourceExternalId = new Map(
            calendarItems
                .filter((item) => typeof item.sourceExternalId === 'string' && item.sourceExternalId.trim())
                .map((item) => [String(item.sourceExternalId).trim(), item] as const)
        );
        if (!effectiveEveryoneSelected && selectedMemberIdSet.size === 0) {
            return {
                dayItemsByDate: byDate,
                denseDayItemsByDate: denseByDate,
                weekSpanLanesByWeek: new Map<string, CalendarWeekSpanSegment[][]>(),
            };
        }

        const pushByDate = (dateKey: string, item: CalendarItem) => {
            const existing = byDate.get(dateKey);
            if (existing) {
                existing.push(item);
            } else {
                byDate.set(dateKey, [item]);
            }
        };

        const pushDenseByDate = (dateKey: string, item: CalendarItem) => {
            const existing = denseByDate.get(dateKey);
            if (existing) {
                existing.push(item);
            } else {
                denseByDate.set(dateKey, [item]);
            }
        };

        const pushWeekSpanSegment = (weekKey: string, segment: CalendarWeekSpanSegment) => {
            const existing = weekSpanSegmentsByWeek.get(weekKey);
            if (existing) {
                existing.push(segment);
            } else {
                weekSpanSegmentsByWeek.set(weekKey, [segment]);
            }
        };

        for (const item of calendarItemsForView) {
            const masterId = typeof item.recurringEventId === 'string' ? item.recurringEventId.trim() : '';
            if (!masterId) continue;
            if (normalizeRruleString(String(item.rrule || ''))) continue;

            const recurrenceReference = typeof item.recurrenceId === 'string' ? item.recurrenceId.trim() : '';
            if (!recurrenceReference) continue;
            const referenceDate = parseRecurrenceDateToken(recurrenceReference);
            if (!referenceDate || Number.isNaN(referenceDate.getTime())) continue;

            const dayKey = format(referenceDate, 'yyyy-MM-dd');
            const existing = recurrenceOverrideDayKeysByMasterId.get(masterId);
            if (existing) {
                existing.add(dayKey);
            } else {
                recurrenceOverrideDayKeysByMasterId.set(masterId, new Set([dayKey]));
            }
        }

        const expandRecurringItemForRange = (item: CalendarItem): CalendarItem[] => {
            if (!item.rrule) {
                return [item];
            }

            const start = parseISO(item.startDate);
            const exclusiveEnd = parseISO(item.endDate);
            if (Number.isNaN(start.getTime()) || Number.isNaN(exclusiveEnd.getTime()) || exclusiveEnd.getTime() <= start.getTime()) {
                return [item];
            }

            const normalizedRule = normalizeRruleString(item.rrule);
            if (!normalizedRule) {
                return [item];
            }

            try {
                const ruleOptions = RRule.parseString(normalizedRule);
                const recurrenceDtStart = item.isAllDay
                    ? new Date(
                          Date.UTC(
                              start.getFullYear(),
                              start.getMonth(),
                              start.getDate(),
                              start.getHours(),
                              start.getMinutes(),
                              start.getSeconds(),
                              start.getMilliseconds()
                          )
                      )
                    : start;
                const recurrenceRule = new RRule({
                    ...ruleOptions,
                    dtstart: recurrenceDtStart,
                });

                const durationMs = Math.max(0, exclusiveEnd.getTime() - start.getTime());
                const allDaySpanDays = item.isAllDay ? Math.max(1, differenceInDays(exclusiveEnd, start)) : 1;
                const searchStart =
                    item.isAllDay && allDaySpanDays > 1 ? addDays(activeRangeStart, -(allDaySpanDays - 1)) : activeRangeStart;

                const generatedStarts = recurrenceRule.between(searchStart, activeRangeEnd, true);
                const rdateTokens = [...splitDateTokens(item.rdates), ...collectRecurrenceLineTokens(item.recurrenceLines, 'RDATE')];
                const rdateStarts = rdateTokens.map((token) => parseRecurrenceDateToken(token)).filter(Boolean) as Date[];

                const exdateTokens = [...splitDateTokens(item.exdates), ...collectRecurrenceLineTokens(item.recurrenceLines, 'EXDATE')];
                const excludedDayKeys = new Set<string>();
                const excludedExactTimes = new Set<number>();
                for (const token of exdateTokens) {
                    const parsed = parseRecurrenceDateToken(token);
                    if (!parsed) continue;
                    excludedDayKeys.add(format(parsed, 'yyyy-MM-dd'));
                    excludedExactTimes.add(parsed.getTime());
                }

                const sourceExternalId = typeof item.sourceExternalId === 'string' ? item.sourceExternalId.trim() : '';
                const overrideDayKeys = recurrenceOverrideDayKeysByMasterId.get(item.id) || (sourceExternalId ? recurrenceOverrideDayKeysByMasterId.get(sourceExternalId) : undefined);
                const seenOccurrenceKeys = new Set<string>();
                const uniqueStartsByKey = new Map<string, Date>();
                for (const rawStart of [start, ...generatedStarts, ...rdateStarts]) {
                    if (Number.isNaN(rawStart.getTime())) continue;
                    const normalizedStart = item.isAllDay ? parseISO(format(rawStart, 'yyyy-MM-dd')) : rawStart;
                    if (Number.isNaN(normalizedStart.getTime())) continue;
                    const startKey = item.isAllDay ? format(normalizedStart, 'yyyy-MM-dd') : normalizedStart.toISOString();
                    if (!uniqueStartsByKey.has(startKey)) {
                        uniqueStartsByKey.set(startKey, normalizedStart);
                    }
                }
                const starts = Array.from(uniqueStartsByKey.values()).sort((left, right) => left.getTime() - right.getTime());

                const occurrenceItems: CalendarItem[] = [];
                for (const occurrenceStart of starts) {
                    const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
                    const dayKey = format(occurrenceStart, 'yyyy-MM-dd');
                    const dedupeKey = item.isAllDay ? dayKey : occurrenceStart.toISOString();
                    if (seenOccurrenceKeys.has(dedupeKey)) continue;
                    seenOccurrenceKeys.add(dedupeKey);

                    if (item.isAllDay) {
                        const overlapsRange = occurrenceEnd.getTime() > rangeStartTime && occurrenceStart.getTime() <= rangeEndTime;
                        if (!overlapsRange) continue;
                        if (excludedDayKeys.has(dayKey)) continue;
                    } else {
                        const startsInRange = occurrenceStart.getTime() >= rangeStartTime && occurrenceStart.getTime() <= rangeEndTime;
                        if (!startsInRange) continue;
                        if (excludedExactTimes.has(occurrenceStart.getTime()) || excludedDayKeys.has(dayKey)) continue;
                    }

                    if (overrideDayKeys?.has(dayKey)) continue;

                    occurrenceItems.push({
                        ...item,
                        startDate: item.isAllDay ? format(occurrenceStart, 'yyyy-MM-dd') : occurrenceStart.toISOString(),
                        endDate: item.isAllDay ? format(occurrenceEnd, 'yyyy-MM-dd') : occurrenceEnd.toISOString(),
                        __masterEvent: item,
                        __isRecurrenceInstance: occurrenceStart.getTime() !== start.getTime(),
                    });
                }

                return occurrenceItems;
            } catch (error) {
                return [item];
            }
        };

        for (const baseItem of calendarItemsForView) {
            const masterId = typeof baseItem.recurringEventId === 'string' ? baseItem.recurringEventId.trim() : '';
            const masterForOverride = masterId ? (calendarItemsById.get(masterId) || calendarItemsBySourceExternalId.get(masterId)) : undefined;
            const sourceItem = masterForOverride ? ({ ...baseItem, __masterEvent: masterForOverride } as CalendarItem) : baseItem;
            const itemsToRender = expandRecurringItemForRange(sourceItem);
            for (const item of itemsToRender) {
                const start = parseISO(item.startDate);
                const exclusiveEnd = parseISO(item.endDate);
                if (Number.isNaN(start.getTime()) || Number.isNaN(exclusiveEnd.getTime())) {
                    continue;
                }

                const startDay = toDayStart(start);
                const endDay = getInclusiveEndDayStart(exclusiveEnd);
                const isMultiDay = endDay.getTime() > startDay.getTime();

                if (isMultiDay) {
                    const visibleStartDay = startDay.getTime() < rangeStartDay.getTime() ? rangeStartDay : startDay;
                    const visibleEndDay = endDay.getTime() > rangeEndDay.getTime() ? rangeEndDay : endDay;
                    if (visibleEndDay.getTime() < visibleStartDay.getTime()) {
                        continue;
                    }

                    for (let denseDay = visibleStartDay; denseDay.getTime() <= visibleEndDay.getTime(); denseDay = addDays(denseDay, 1)) {
                        const displayDate = format(denseDay, 'yyyy-MM-dd');
                        pushDenseByDate(displayDate, {
                            ...item,
                            __displayDate: displayDate,
                        });
                    }

                    let segmentStartDay = visibleStartDay;
                    while (segmentStartDay.getTime() <= visibleEndDay.getTime()) {
                        const weekStart = startOfWeek(segmentStartDay, { weekStartsOn: WEEK_STARTS_ON });
                        const weekEnd = addDays(weekStart, 6);
                        const segmentEndDay = visibleEndDay.getTime() < weekEnd.getTime() ? visibleEndDay : weekEnd;
                        const weekKey = format(weekStart, 'yyyy-MM-dd');
                        pushWeekSpanSegment(weekKey, {
                            segmentKey: `${item.id}-${format(segmentStartDay, 'yyyy-MM-dd')}-${format(segmentEndDay, 'yyyy-MM-dd')}`,
                            item,
                            startCol: differenceInDays(segmentStartDay, weekStart),
                            endCol: differenceInDays(segmentEndDay, weekStart),
                            continuesBefore: segmentStartDay.getTime() > startDay.getTime(),
                            continuesAfter: segmentEndDay.getTime() < endDay.getTime(),
                        });
                        segmentStartDay = addDays(segmentEndDay, 1);
                    }
                    continue;
                }

                const time = start.getTime();
                if (time >= rangeStartTime && time <= rangeEndTime) {
                    const displayDate = format(start, 'yyyy-MM-dd');
                    pushByDate(displayDate, item);
                    pushDenseByDate(displayDate, {
                        ...item,
                        __displayDate: displayDate,
                    });
                }
            }
        }

        if (effectiveShowChores) {
            for (const day of days) {
                const dateKey = format(day, 'yyyy-MM-dd');
                const utcDay = getUtcDateFromDateKey(dateKey);
                if (!utcDay) continue;

                for (const chore of chores) {
                    if (!chore?.id || !chore?.title || !chore?.startDate) continue;
                    if (!matchesChoreIdFilter(chore.id)) continue;

                    const assignedMembers = resolveMemberColors(getAssignedMembersForChoreOnDate(chore, utcDay), memberColorsById);
                    if (!matchesChoreMemberFilter(assignedMembers)) continue;

                    pushByDate(dateKey, {
                        id: `chore-${chore.id}-${dateKey}`,
                        title: chore.title,
                        description: chore.description || '',
                        startDate: dateKey,
                        endDate: format(addDays(day, 1), 'yyyy-MM-dd'),
                        isAllDay: true,
                        pertainsTo: assignedMembers,
                        calendarItemKind: 'chore',
                        sourceChoreId: chore.id,
                        isJoint: chore.isJoint ?? false,
                        isUpForGrabs: chore.isUpForGrabs ?? false,
                    });
                    pushDenseByDate(dateKey, {
                        id: `chore-${chore.id}-${dateKey}`,
                        title: chore.title,
                        description: chore.description || '',
                        startDate: dateKey,
                        endDate: format(addDays(day, 1), 'yyyy-MM-dd'),
                        isAllDay: true,
                        pertainsTo: assignedMembers,
                        calendarItemKind: 'chore',
                        sourceChoreId: chore.id,
                        isJoint: chore.isJoint ?? false,
                        isUpForGrabs: chore.isUpForGrabs ?? false,
                    });
                }
            }
        }

        byDate.forEach((dayItems, dateKey) => {
            byDate.set(dateKey, [...dayItems].sort(compareCalendarItemsByStartTime));
        });
        denseByDate.forEach((dayItems, dateKey) => {
            denseByDate.set(dateKey, [...dayItems].sort(compareCalendarItemsByStartTime));
        });

        const spanLanesByWeek = new Map<string, CalendarWeekSpanSegment[][]>();
        for (const [weekKey, segments] of Array.from(weekSpanSegmentsByWeek.entries())) {
            spanLanesByWeek.set(weekKey, assignWeekSpanLanes(segments));
        }

        return {
            dayItemsByDate: byDate,
            denseDayItemsByDate: denseByDate,
            weekSpanLanesByWeek: spanLanesByWeek,
        };
    }, [
        activeRangeEnd,
        activeRangeStart,
        calendarItems,
        effectiveChoreFilterConfigured,
        effectiveEveryoneSelected,
        effectiveMemberFilterConfigured,
        effectiveSelectedChoreIds,
        effectiveSelectedMemberIds,
        effectiveShowChores,
        chores,
        days,
        memberColorsById,
    ]);

    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const showYearView = !isMiniInfinite && viewMode === 'year';

    let isYearSet = false;
    let shouldDisplayBothYears = false;
    let shouldDisplayYear = false;
    let shouldDisplayNepaliYear = true;

    return (
        <div className={cn(isMiniInfinite && styles.miniCalendarShell, className)} style={style}>
            <RecurrenceScopeDialog
                open={recurrenceScopeDialogOpen}
                action={recurrenceScopeDialogAction}
                scopeMode={recurrenceScopeDialogMode}
                onSelect={resolveRecurrenceScope}
            />
            {dragRecurrenceIndicator ? (
                <div
                    className={styles.dragRecurrenceIndicator}
                    style={{
                        left: `${dragRecurrenceIndicator.x}px`,
                        top: `${dragRecurrenceIndicator.y}px`,
                    }}
                    data-testid="drag-recurrence-indicator"
                >
                    <span className={styles.dragRecurrenceIndicatorLabel}>{dragRecurrenceIndicator.label}</span>
                    <span className={styles.dragRecurrenceIndicatorKey}>{dragRecurrenceIndicator.hotkeyLabel}</span>
                </div>
            ) : null}
            {isMiniInfinite ? (
                <MiniInfiniteCalendarView
                    weeks={weeks}
                    dayItemsByDate={dayItemsByDate}
                    weekSpanLanesByWeek={weekSpanLanesByWeek}
                    scrollContainerRef={scrollContainerRef}
                    dayCellHeight={effectiveDayCellHeight}
                    eventFontScale={effectiveYearFontScale}
                    showGregorianDays={effectiveShowGregorianDays}
                    showBsDays={effectiveShowBsDays}
                    onDayClick={handleDayClick}
                    onDayDoubleClick={handleDayDoubleClick}
                    onEventClick={handleEventClick}
                    onEventDoubleClick={handleEventDoubleClick}
                    isEventSelected={isEventSelected}
                />
            ) : (
                <div
                    ref={scrollContainerRef}
                    data-testid="calendar-scroll-container"
                    className={styles.calendarScrollContainer}
                    style={
                        scrollContainerHeight
                            ? ({
                                  height: `${scrollContainerHeight}px`,
                                  '--calendar-day-number-top': `${dayNumberStickyTop}px`,
                                  '--calendar-day-cell-height': `${effectiveDayCellHeight}px`,
                              } as React.CSSProperties)
                            : undefined
                    }
                >
                    {showYearView ? (
                        <YearCalendarView
                            months={yearMonths}
                            leadingBufferMonth={yearLeadingBufferMonth}
                            monthBasis={yearMonthBasis}
                            dayItemsByDate={dayItemsByDate}
                            weekSpanLanesByWeek={weekSpanLanesByWeek}
                            columns={yearLayout.columns}
                            dayCellHeight={yearLayout.dayCellHeight}
                            chipScale={yearLayout.chipScale}
                            fontScale={effectiveYearFontScale}
                            shiftAnimation={yearShiftAnimation}
                            trailingBufferMonth={yearTrailingBufferMonth}
                            displayBS={effectiveShowBsDays}
                            scrollContainerRef={scrollContainerRef}
                            onShiftAnimationComplete={handleYearShiftAnimationComplete}
                            onDayClick={handleDayClick}
                            onDayDoubleClick={handleDayDoubleClick}
                            onEventClick={handleEventClick}
                            onEventDoubleClick={handleEventDoubleClick}
                            isEventSelected={isEventSelected}
                        />
                    ) : (
                        <>
                            <div className={styles.stickyMonthBox} style={{ top: `${stickyMonthTop}px` }}>
                                <div
                                    className={styles.stickyMonthFrame}
                                    style={monthBoxSize ? { width: `${monthBoxSize.width}px`, height: `${monthBoxSize.height}px` } : undefined}
                                >
                                    <div ref={activeMonthMeasureRef} className={styles.stickyMonthMeasure}>
                                        {renderMonthLabel(activeMonthLabel)}
                                    </div>
                                    {previousMonthLabel && (
                                        <div ref={previousMonthMeasureRef} className={styles.stickyMonthMeasure}>
                                            {renderMonthLabel(previousMonthLabel)}
                                        </div>
                                    )}
                                    {previousMonthLabel && (
                                        <div className={`${styles.stickyMonthText} ${isMonthTransitioning ? styles.monthFadeOut : ''}`}>
                                            {renderMonthLabel(previousMonthLabel)}
                                        </div>
                                    )}
                                    <div className={`${styles.stickyMonthText} ${isMonthTransitioning ? styles.monthFadeIn : styles.monthStatic}`}>
                                        {renderMonthLabel(activeMonthLabel)}
                                    </div>
                                </div>
                            </div>

                            <table className={styles.calendarTable}>
                                <thead ref={headerRef} className={ebGaramond.className}>
                                    <tr>
                                        {daysOfWeek.map((day, index) => (
                                            <th key={index} className={styles.headerCell}>
                                                {day}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {weeks.map((week, weekIndex) => {
                                        const weekKey = format(week[0], 'yyyy-MM-dd');
                                        const weekSpanLanes = weekSpanLanesByWeek.get(weekKey) || [];
                                        const { weekSpanReservedHeightsByCol, weekSpanReservedHeight } =
                                            getWeekSpanReservedHeightData(weekSpanLanes);
                                        const weekCellStyle =
                                            weekSpanReservedHeight > 0
                                                ? ({
                                                      height: `calc(var(--calendar-day-cell-height, 120px) + ${weekSpanReservedHeight}px)`,
                                                  } as React.CSSProperties)
                                                : undefined;

                                        return (
                                            <React.Fragment key={weekKey}>
                                                <tr>
                                                    {week.map((day, dayIndex) => {
                                                        const nepaliDate = new NepaliDate(day);
                                                        const currentMonth = format(day, 'MMMM');
                                                        const isFirstDayOfMonth = getDate(day) === 1;
                                                        const isFirstWeekOfMonthButNotFirstDay =
                                                            getDate(day) === 2 ||
                                                            getDate(day) === 3 ||
                                                            getDate(day) === 4 ||
                                                            getDate(day) === 5 ||
                                                            getDate(day) === 6 ||
                                                            getDate(day) === 7;
                                                        const isFirstDayOfYear = getDate(day) === 1 && getMonth(day) === 0;
                                                        const year = format(day, 'yyyy');
                                                        const nepaliYear = nepaliDate.format('YYYY');
                                                        shouldDisplayBothYears = false;
                                                        const dateStr = format(day, 'yyyy-MM-dd');
                                                        const dayReservedHeight = weekSpanReservedHeightsByCol[dayIndex] || 0;

                                                        const isFirstDayOfNepaliMonth = nepaliDate.getDate() === 1;
                                                        const isFirstWeekOfNepaliMonthButNotFirstDay =
                                                            nepaliDate.getDate() === 2 ||
                                                            nepaliDate.getDate() === 3 ||
                                                            nepaliDate.getDate() === 4 ||
                                                            nepaliDate.getDate() === 5 ||
                                                            nepaliDate.getDate() === 6 ||
                                                            nepaliDate.getDate() === 7;
                                                        const isFirstDayOfNepaliYear =
                                                            nepaliDate.getDate() === 1 && nepaliDate.getMonth() === 0;

                                                        shouldDisplayYear =
                                                            (!isYearSet && dayIndex === 0 && weekIndex === 0) || isFirstDayOfYear;
                                                        if (shouldDisplayYear) {
                                                            isYearSet = true;
                                                        }

                                                        shouldDisplayNepaliYear =
                                                            effectiveShowBsDays &&
                                                            ((dayIndex === 0 && weekIndex === 0) || isFirstDayOfNepaliYear);

                                                        if (shouldDisplayYear && shouldDisplayNepaliYear) {
                                                            shouldDisplayBothYears = true;
                                                            shouldDisplayYear = false;
                                                            shouldDisplayNepaliYear = false;
                                                        }

                                                        const displayMonthName = isFirstDayOfMonth;
                                                        const displayNepaliMonthName = effectiveShowBsDays && isFirstDayOfNepaliMonth;
                                                        const dayItems = dayItemsByDate.get(dateStr) || [];
                                                        const dayLabelParts = [
                                                            effectiveShowGregorianDays ? format(day, 'd') : '',
                                                            effectiveShowBsDays ? nepaliDate.format('D', 'np') : '',
                                                        ].filter(Boolean);

                                                        return (
                                                            <DroppableDayCell
                                                                key={dateStr}
                                                                day={day}
                                                                dateStr={dateStr}
                                                                onClick={handleDayClick}
                                                                onDoubleClick={handleDayDoubleClick}
                                                                style={weekCellStyle}
                                                                className={`${styles.dayCell} ${isFirstDayOfYear ? styles.firstDayOfYear : ''} ${
                                                                    isFirstDayOfMonth ? styles.firstDayOfMonth : ''
                                                                } ${isFirstWeekOfMonthButNotFirstDay ? styles.firstWeekOfMonth : ''} ${
                                                                    effectiveShowBsDays && isFirstDayOfNepaliYear ? styles.firstDayOfNepaliYear : ''
                                                                } ${effectiveShowBsDays && isFirstDayOfNepaliMonth ? styles.firstDayOfNepaliMonth : ''} ${
                                                                    effectiveShowBsDays && isFirstWeekOfNepaliMonthButNotFirstDay
                                                                        ? styles.firstWeekOfNepaliMonth
                                                                        : ''
                                                                }`}
                                                            >
                                                                {dayIndex === 0 && weekSpanLanes.length > 0 ? (
                                                                    <CalendarWeekSpanOverlay
                                                                        weekKey={weekKey}
                                                                        weekSpanLanes={weekSpanLanes}
                                                                        onEventClick={handleEventClick}
                                                                        onEventDoubleClick={handleEventDoubleClick}
                                                                        isEventSelected={isEventSelected}
                                                                    />
                                                                ) : null}
                                                                {shouldDisplayYear && <div className={styles.yearNumber}>{year}</div>}
                                                                {shouldDisplayNepaliYear && <div className={styles.nepaliYearNumber}>{nepaliYear}</div>}
                                                                {shouldDisplayBothYears && (
                                                                    <div className={styles.yearNumber}>
                                                                        {year} / {nepaliYear}
                                                                    </div>
                                                                )}
                                                                {displayMonthName && <div className={styles.monthName}>{currentMonth}</div>}
                                                                {displayNepaliMonthName && (
                                                                    <div className={styles.nepaliMonthName}>
                                                                        {NEPALI_MONTHS_COMMON_DEVANAGARI[nepaliDate.getMonth()] +
                                                                            ' (' +
                                                                            NEPALI_MONTHS_COMMON_ROMAN[nepaliDate.getMonth()] +
                                                                            ')'}
                                                                    </div>
                                                                )}
                                                                <div className={styles.dayNumber} data-calendar-date={dateStr}>
                                                                    {dayLabelParts.join(' / ')}
                                                                </div>
                                                                {dayReservedHeight > 0 ? (
                                                                    <div
                                                                        className={styles.multiDayLaneSpacer}
                                                                        style={{ height: `${dayReservedHeight}px` }}
                                                                        aria-hidden="true"
                                                                    />
                                                                ) : null}

                                                                {dayItems.length > 0 ? (
                                                                    <div
                                                                        className={`${styles.dayEventStack}${
                                                                            dayReservedHeight <= 0 ? ` ${styles.dayEventStackWithTopGap}` : ''
                                                                        }`}
                                                                    >
                                                                        {dayItems.map((item, index) => (
                                                                            <DraggableCalendarEvent
                                                                                key={`${item.id}-${item.startDate}`}
                                                                                item={item}
                                                                                index={index}
                                                                                selected={isEventSelected(item)}
                                                                                draggableEnabled={item.calendarItemKind !== 'chore'}
                                                                                onClick={
                                                                                    item.calendarItemKind === 'chore'
                                                                                        ? undefined
                                                                                        : (e) => handleEventClick(e, item)
                                                                                }
                                                                                onDoubleClick={
                                                                                    item.calendarItemKind === 'chore'
                                                                                        ? undefined
                                                                                        : (e) => handleEventDoubleClick(e, item)
                                                                                }
                                                                            />
                                                                        ))}
                                                                    </div>
                                                                ) : null}
                                                            </DroppableDayCell>
                                                        );
                                                    })}
                                                </tr>
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </>
                    )}
                </div>
            )}

            <Dialog
                open={isModalOpen}
                onOpenChange={(open) => {
                    if (open) {
                        setIsModalOpen(true);
                        return;
                    }
                    handleCloseModal();
                }}
            >
                <DialogContent>
                    <DialogTitle className="sr-only">{selectedEvent ? 'Edit calendar event' : 'Add calendar event'}</DialogTitle>
                    <AddEventForm
                        selectedDate={selectedDate}
                        selectedEvent={selectedEvent}
                        allCalendarItems={calendarItems}
                        onClose={handleCloseModal}
                        onOptimisticUpsert={applyOptimisticCalendarItem}
                    />
                </DialogContent>
            </Dialog>
            <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Event?</AlertDialogTitle>
                        <AlertDialogDescription>This will permanently delete the selected event.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault();
                                setDeleteConfirmOpen(false);
                                void handleDeleteByScope('single');
                            }}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default Calendar;
