import 'server-only';

import { XMLParser } from 'fast-xml-parser';
import { APPLE_CALDAV_BASE_URL } from '@/lib/apple-caldav/config';

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    trimValues: true,
});

function asArray(value: any) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function textOf(value: any): string {
    if (typeof value === 'string') return value.trim();
    if (value && typeof value['#text'] === 'string') return value['#text'].trim();
    return '';
}

function firstHref(multistatus: any, predicate: (response: any) => boolean): string {
    const responses = asArray(multistatus?.response);
    const match = responses.find(predicate);
    return textOf(match?.href);
}

function allResponses(multistatus: any) {
    return asArray(multistatus?.response);
}

async function caldavRequest(url: string, input: {
    method: string;
    username: string;
    password: string;
    body?: string;
    depth?: '0' | '1' | 'infinity';
    headers?: Record<string, string>;
}) {
    const response = await fetch(url, {
        method: input.method,
        headers: {
            Authorization: `Basic ${Buffer.from(`${input.username}:${input.password}`).toString('base64')}`,
            Depth: input.depth || '0',
            'Content-Type': 'application/xml; charset=utf-8',
            Prefer: 'return-minimal',
            ...(input.headers || {}),
        },
        body: input.body,
        redirect: 'follow',
        cache: 'no-store',
    });

    if (!response.ok && response.status !== 207) {
        const body = await response.text().catch(() => '');
        const error = new Error(`CalDAV request failed (${response.status})`);
        (error as any).status = response.status;
        (error as any).body = body.slice(0, 400);
        throw error;
    }

    return response;
}

function buildAbsoluteUrl(baseUrl: string, href: string) {
    try {
        return new URL(href, baseUrl).toString();
    } catch {
        return href;
    }
}

export async function discoverAppleCalendars(input: { username: string; password: string }) {
    const principalResponse = await caldavRequest(APPLE_CALDAV_BASE_URL, {
        method: 'PROPFIND',
        username: input.username,
        password: input.password,
        depth: '0',
        body: `<?xml version="1.0" encoding="utf-8" ?>
            <d:propfind xmlns:d="DAV:" xmlns:cd="urn:ietf:params:xml:ns:caldav">
              <d:prop>
                <d:current-user-principal />
              </d:prop>
            </d:propfind>`,
    });
    const principalText = await principalResponse.text();
    const principalDoc = xmlParser.parse(principalText);
    const principalUrl = buildAbsoluteUrl(principalResponse.url, firstHref(principalDoc.multistatus, () => true));

    const homeResponse = await caldavRequest(principalUrl, {
        method: 'PROPFIND',
        username: input.username,
        password: input.password,
        depth: '0',
        body: `<?xml version="1.0" encoding="utf-8" ?>
            <d:propfind xmlns:d="DAV:" xmlns:cd="urn:ietf:params:xml:ns:caldav">
              <d:prop>
                <cd:calendar-home-set />
              </d:prop>
            </d:propfind>`,
    });
    const homeText = await homeResponse.text();
    const homeDoc = xmlParser.parse(homeText);
    const homeUrl = buildAbsoluteUrl(homeResponse.url, firstHref(homeDoc.multistatus, (entry) => Boolean(entry?.propstat?.prop?.['calendar-home-set']?.href)));

    const calendarsResponse = await caldavRequest(homeUrl, {
        method: 'PROPFIND',
        username: input.username,
        password: input.password,
        depth: '1',
        body: `<?xml version="1.0" encoding="utf-8" ?>
            <d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:cd="urn:ietf:params:xml:ns:caldav" xmlns:ical="http://apple.com/ns/ical/">
              <d:prop>
                <d:displayname />
                <cs:getctag />
                <cd:supported-calendar-component-set />
                <cd:calendar-description />
                <cd:calendar-timezone />
                <ical:calendar-color />
                <d:resourcetype />
                <d:sync-token />
              </d:prop>
            </d:propfind>`,
    });
    const calendarsText = await calendarsResponse.text();
    const calendarsDoc = xmlParser.parse(calendarsText);
    const calendars = allResponses(calendarsDoc.multistatus)
        .map((entry) => {
            const prop = entry?.propstat?.prop || {};
            const resourceType = prop.resourcetype || {};
            if (!('calendar' in resourceType)) return null;
            const href = textOf(entry.href);
            return {
                remoteCalendarId: href.replace(/\/+$/, '').split('/').pop() || href,
                remoteUrl: buildAbsoluteUrl(calendarsResponse.url, href),
                displayName: textOf(prop.displayname) || 'Apple Calendar',
                color: textOf(prop['calendar-color']) || '',
                description: textOf(prop['calendar-description']) || '',
                timeZone: textOf(prop['calendar-timezone']) || '',
                ctag: textOf(prop.getctag) || '',
                syncToken: textOf(prop['sync-token']) || '',
            };
        })
        .filter(Boolean);

    return {
        principalUrl,
        calendarHomeUrl: homeUrl,
        calendars,
    };
}

export async function fetchCalendarEvents(input: {
    username: string;
    password: string;
    calendarUrl: string;
    rangeStartIso: string;
    rangeEndIso: string;
}) {
    const response = await caldavRequest(input.calendarUrl, {
        method: 'REPORT',
        username: input.username,
        password: input.password,
        depth: '1',
        body: `<?xml version="1.0" encoding="utf-8" ?>
            <c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
              <d:prop>
                <d:getetag />
                <c:calendar-data />
              </d:prop>
              <c:filter>
                <c:comp-filter name="VCALENDAR">
                  <c:comp-filter name="VEVENT">
                    <c:time-range start="${input.rangeStartIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}" end="${input.rangeEndIso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}" />
                  </c:comp-filter>
                </c:comp-filter>
              </c:filter>
            </c:calendar-query>`,
    });
    const body = await response.text();
    const parsed = xmlParser.parse(body);

    return allResponses(parsed.multistatus).map((entry) => {
        const prop = entry?.propstat?.prop || {};
        return {
            href: buildAbsoluteUrl(response.url, textOf(entry.href)),
            etag: textOf(prop.getetag) || '',
            ics: textOf(prop['calendar-data']) || '',
        };
    }).filter((entry) => entry.ics);
}
