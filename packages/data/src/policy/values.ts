import type { ColumnKind, ColumnRule } from './types';

// Reading a value a device sent. A device holds everything as SQLite does, so a boolean arrives as 0 or 1 and a
// JSON document as text. Each value is checked against its column's kind and brought to the one form the server
// reads that kind in, so that a value from a device and a value from Postgres can be compared.

export type Read = { valid: true; value: unknown } | { valid: false };

const INVALID: Read = { valid: false };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

function isDay(value: unknown): value is string {
    if (typeof value !== 'string') return false;
    const match = DAY.exec(value);
    if (!match) return false;
    // The day must exist: no thirtieth of February.
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toISOString().slice(0, 10) === value;
}

function parseJson(text: string): Read {
    try {
        return { valid: true, value: JSON.parse(text) };
    } catch {
        return INVALID;
    }
}

const readers: Record<ColumnKind, (value: unknown) => Read> = {
    text: (value) => (typeof value === 'string' ? { valid: true, value } : INVALID),
    uuid: (value) => (isUuid(value) ? { valid: true, value: value.toLowerCase() } : INVALID),
    boolean: (value) => (value === true || value === 1 ? { valid: true, value: true } : value === false || value === 0 ? { valid: true, value: false } : INVALID),
    integer: (value) => (typeof value === 'number' && Number.isInteger(value) ? { valid: true, value } : INVALID),
    number: (value) => (typeof value === 'number' && Number.isFinite(value) ? { valid: true, value } : INVALID),
    day: (value) => (isDay(value) ? { valid: true, value } : INVALID),
    instant: (value) => {
        if (typeof value !== 'string') return INVALID;
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? INVALID : { valid: true, value: date.toISOString() };
    },
    // Postgres reads a time back with its seconds, so that is the form it is compared in.
    time: (value) => {
        const match = typeof value === 'string' ? TIME.exec(value) : null;
        return match ? { valid: true, value: `${match[1]}:${match[2]}:${match[3] ?? '00'}` } : INVALID;
    },
    // A document always travels as JSON text, even one that is itself a string.
    json: (value) => (typeof value === 'string' ? parseJson(value) : INVALID),
    days: (value) => {
        const parsed = typeof value === 'string' ? parseJson(value) : INVALID;
        if (!parsed.valid || !Array.isArray(parsed.value) || !parsed.value.every(isDay)) return INVALID;
        return { valid: true, value: parsed.value };
    },
};

/** A value from a device, in the server's form, or not valid for the column. Empty is always allowed here; whether a column may be empty is the database's to say. */
export function readValue(rule: ColumnRule, value: unknown): Read {
    if (value === null || value === undefined) return { valid: true, value: null };
    const read = readers[rule.kind](value);
    if (read.valid && rule.oneOf && !rule.oneOf.includes(read.value as string)) return INVALID;
    return read;
}

/** Whether two values in the server's form are the same value. */
export function sameValue(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (left == null || right == null) return left == null && right == null;
    if (typeof left !== 'object' || typeof right !== 'object') return false;
    if (Array.isArray(left) !== Array.isArray(right)) return false;
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}
