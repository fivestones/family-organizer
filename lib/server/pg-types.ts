// How values come back from Postgres. The driver's defaults turn a day into a JavaScript Date at local midnight,
// which is a different day in half the world's time zones, and hand back a 64-bit count as a string. The app's
// types say a day is `YYYY-MM-DD` and an instant an ISO 8601 string, so that is what the server reads too.
//
// The same table serves the real driver and the in-process Postgres the tests use, so the two cannot disagree.

const DAY = 1082;
const DAY_ARRAY = 1182;
const INSTANT = 1184;
const BIG_INTEGER = 20;

/** Postgres writes `2026-01-04 19:05:00.123+00`. */
function toIsoInstant(value: string): string {
    return new Date(value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).toISOString();
}

export const POSTGRES_TYPE_PARSERS: Record<number, (value: string) => unknown> = {
    [DAY]: (value) => value,
    [DAY_ARRAY]: (value) => (value === '{}' ? [] : value.slice(1, -1).split(',')),
    [INSTANT]: toIsoInstant,
    // Transaction numbers and row counts. Neither comes near the limit of a double.
    [BIG_INTEGER]: (value) => Number(value),
};
