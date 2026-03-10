import 'server-only';

import ICAL from 'ical.js';
import { RRule } from 'rrule';

function formatYmd(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function buildIsoLike(value: any) {
    if (!value) return '';
    if (typeof value.toJSDate === 'function') {
        return value.toJSDate().toISOString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    return String(value);
}

function recurrenceKey(value: any) {
    if (!value) return '';
    if (typeof value.toString === 'function') return value.toString();
    return buildIsoLike(value);
}

function timeZoneOf(event: any, fallback: string) {
    return event?.startDate?.zone?.tzid || event?.component?.getFirstPropertyValue('tzid') || fallback || 'UTC';
}

function buildParticipant(value: any) {
    if (!value) return null;
    const params = typeof value.getParameter === 'function' ? value : null;
    const raw = typeof value.getFirstValue === 'function' ? value.getFirstValue() : '';
    const address = typeof raw === 'string' ? raw.replace(/^mailto:/i, '') : '';
    return {
        calendarUserAddress: raw || '',
        email: address,
        name: params?.getParameter('cn') || '',
        partstat: params?.getParameter('partstat') || '',
        role: params?.getParameter('role') || '',
        rsvp: params?.getParameter('rsvp') || '',
    };
}

function buildAlarm(alarmComponent: any) {
    if (!alarmComponent) return null;
    return {
        action: alarmComponent.getFirstPropertyValue('action') || '',
        description: alarmComponent.getFirstPropertyValue('description') || '',
        trigger: buildIsoLike(alarmComponent.getFirstPropertyValue('trigger')),
    };
}

function toDateRange(event: any, occurrenceDate: Date | null) {
    const startValue = occurrenceDate || event.startDate?.toJSDate?.() || null;
    if (!startValue) return null;
    const durationMs = Math.max(0, (event.endDate?.toJSDate?.()?.getTime?.() || startValue.getTime()) - (event.startDate?.toJSDate?.()?.getTime?.() || startValue.getTime()));
    const endValue = new Date(startValue.getTime() + durationMs);
    const isAllDay = !!event.startDate?.isDate;

    if (isAllDay) {
        return {
            isAllDay: true,
            startDate: formatYmd(startValue),
            endDate: formatYmd(endValue),
            year: startValue.getFullYear(),
            month: startValue.getMonth() + 1,
            dayOfMonth: startValue.getDate(),
        };
    }

    return {
        isAllDay: false,
        startDate: startValue.toISOString(),
        endDate: endValue.toISOString(),
        year: startValue.getFullYear(),
        month: startValue.getMonth() + 1,
        dayOfMonth: startValue.getDate(),
    };
}

function eventToNormalized(event: any, options: {
    accountId: string;
    calendarId: string;
    calendarName: string;
    href: string;
    etag: string;
    ctag?: string;
    occurrenceDate?: Date | null;
    fallbackTimeZone?: string;
    sourceExternalId: string;
    recurringEventId?: string;
}) {
    const range = toDateRange(event, options.occurrenceDate || null);
    if (!range) return null;
    const recurrenceIdValue = event.recurrenceId ? recurrenceKey(event.recurrenceId) : '';
    const rrule = event.component.getFirstPropertyValue('rrule');
    const exdateProps = event.component.getAllProperties('exdate') || [];
    const rdateProps = event.component.getAllProperties('rdate') || [];
    const organizerProp = event.component.getFirstProperty('organizer');
    const attendeeProps = event.component.getAllProperties('attendee') || [];
    const alarms = (event.component.getAllSubcomponents('valarm') || []).map(buildAlarm).filter(Boolean);

    const normalizedRrule = rrule ? `RRULE:${rrule.toString()}` : '';
    const exdates = exdateProps.flatMap((prop: any) => (prop.getValues?.() || []).map(recurrenceKey)).filter(Boolean);
    const rdates = rdateProps.flatMap((prop: any) => (prop.getValues?.() || []).map(recurrenceKey)).filter(Boolean);
    const recurrenceLines = [
        ...(normalizedRrule ? [normalizedRrule] : []),
        ...(rdates.length ? [`RDATE:${rdates.join(',')}`] : []),
        ...(exdates.length ? [`EXDATE:${exdates.join(',')}`] : []),
    ];

    return {
        ...range,
        title: event.summary || 'Untitled event',
        description: event.description || '',
        uid: event.uid || '',
        status: String(event.component.getFirstPropertyValue('status') || 'confirmed').toLowerCase(),
        sequence: Number(event.component.getFirstPropertyValue('sequence') || 0),
        dtStamp: buildIsoLike(event.component.getFirstPropertyValue('dtstamp')),
        createdAt: buildIsoLike(event.component.getFirstPropertyValue('created')),
        lastModified: buildIsoLike(event.component.getFirstPropertyValue('last-modified')),
        location: event.location || '',
        url: event.url || '',
        timeZone: timeZoneOf(event, options.fallbackTimeZone || 'UTC'),
        organizer: buildParticipant(organizerProp),
        attendees: attendeeProps.map(buildParticipant).filter(Boolean),
        alarms,
        rrule: normalizedRrule,
        rdates,
        exdates,
        recurrenceLines,
        recurrenceId: recurrenceIdValue,
        recurringEventId: options.recurringEventId || '',
        recurrenceIdRange: '',
        eventType: 'default',
        visibility: 'default',
        transparency: event.component.getFirstPropertyValue('transp') === 'TRANSPARENT' ? 'transparent' : range.isAllDay ? 'transparent' : 'opaque',
        xProps: {
            categories: event.component.getFirstPropertyValue('categories') || [],
            class: event.component.getFirstPropertyValue('class') || '',
        },
        sourceExternalId: options.sourceExternalId,
        sourceRemoteUrl: options.href,
        sourceRemoteEtag: options.etag,
        sourceRemoteCtag: options.ctag || '',
        sourceCalendarId: options.calendarId,
        sourceCalendarName: options.calendarName,
        sourceAccountKey: options.accountId,
        sourceType: 'apple-caldav',
        sourceSyncStatus: String(event.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED' ? 'cancelled' : 'active',
        sourceReadOnly: true,
    };
}

function buildOccurrenceSourceExternalId(accountId: string, calendarId: string, uid: string, recurrenceId: string) {
    return `apple:${accountId}:${calendarId}:${uid}:${recurrenceId || 'single'}`;
}

export function parseCalendarResource(input: {
    accountId: string;
    calendarId: string;
    calendarName: string;
    href: string;
    etag: string;
    ctag?: string;
    ics: string;
    rangeStart: Date;
    rangeEnd: Date;
    fallbackTimeZone?: string;
}) {
    const component = new ICAL.Component(ICAL.parse(input.ics));
    const vevents = component.getAllSubcomponents('vevent') || [];
    const grouped = new Map<string, any[]>();

    for (const subcomponent of vevents) {
        const event = new ICAL.Event(subcomponent);
        const uid = event.uid || input.href;
        const list = grouped.get(uid) || [];
        list.push(event);
        grouped.set(uid, list);
    }

    const normalized = [];

    for (const [uid, entries] of Array.from(grouped.entries())) {
        const master = entries.find((event) => !event.recurrenceId) || entries[0];
        const overrides = new Map<string, any>();
        for (const entry of entries) {
            if (!entry.recurrenceId) continue;
            overrides.set(recurrenceKey(entry.recurrenceId), entry);
        }

        if (!master.isRecurring()) {
            const singleSourceKey = buildOccurrenceSourceExternalId(input.accountId, input.calendarId, uid, '');
            const single = eventToNormalized(master, {
                accountId: input.accountId,
                calendarId: input.calendarId,
                calendarName: input.calendarName,
                href: input.href,
                etag: input.etag,
                ctag: input.ctag,
                fallbackTimeZone: input.fallbackTimeZone,
                sourceExternalId: singleSourceKey,
            });
            if (single) normalized.push(single);
            continue;
        }

        const iterator = master.iterator();
        const exdateSet = new Set((master.component.getAllProperties('exdate') || []).flatMap((prop: any) => (prop.getValues?.() || []).map(recurrenceKey)));
        const until = input.rangeEnd.getTime();

        while (true) {
            const next = iterator.next();
            if (!next) break;
            const occurrenceDate = next.toJSDate();
            if (occurrenceDate.getTime() > until) break;
            if (occurrenceDate.getTime() < input.rangeStart.getTime()) continue;

            const key = recurrenceKey(next);
            if (exdateSet.has(key)) continue;

            const override = overrides.get(key) || null;
            const sourceExternalId = buildOccurrenceSourceExternalId(input.accountId, input.calendarId, uid, key);
            const normalizedEvent = eventToNormalized(override || master, {
                accountId: input.accountId,
                calendarId: input.calendarId,
                calendarName: input.calendarName,
                href: input.href,
                etag: input.etag,
                ctag: input.ctag,
                occurrenceDate: override ? null : occurrenceDate,
                fallbackTimeZone: input.fallbackTimeZone,
                sourceExternalId,
                recurringEventId: `apple:${input.accountId}:${input.calendarId}:${uid}`,
            });

            if (normalizedEvent) {
                normalizedEvent.recurrenceId = key;
                normalized.push(normalizedEvent);
            }
        }

        for (const [key, override] of Array.from(overrides.entries())) {
            if (normalized.some((entry: any) => entry.sourceExternalId === buildOccurrenceSourceExternalId(input.accountId, input.calendarId, uid, key))) {
                continue;
            }
            const normalizedOverride = eventToNormalized(override, {
                accountId: input.accountId,
                calendarId: input.calendarId,
                calendarName: input.calendarName,
                href: input.href,
                etag: input.etag,
                ctag: input.ctag,
                fallbackTimeZone: input.fallbackTimeZone,
                sourceExternalId: buildOccurrenceSourceExternalId(input.accountId, input.calendarId, uid, key),
                recurringEventId: `apple:${input.accountId}:${input.calendarId}:${uid}`,
            });
            if (normalizedOverride) normalized.push(normalizedOverride);
        }
    }

    return normalized;
}

export function hashNormalizedEvent(value: Record<string, unknown>) {
    return JSON.stringify(value);
}
