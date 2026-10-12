import type { Principal } from '../session/principal';
import { isWritableTable, policyFor, type WritableTable } from './tables';
import type { RefusalReason, Row, Verdict } from './types';
import { readValue, sameValue } from './values';

export { isWritableTable, POLICY, policyFor, type WritableTable } from './tables';
export type { ColumnKind, ColumnRule, RefusalReason, Row, TablePolicy, Verdict } from './types';
export { isUuid, readValue, sameValue } from './values';

/** One write as a device sends it: an operation on one row of one table, with the columns it carries. */
export interface DeviceOperation {
    op: 'PUT' | 'PATCH' | 'DELETE';
    table: string;
    id: string;
    data?: Record<string, unknown> | null;
}

/** A device's write, checked for shape: a table that may be written, a row key, and values in the server's form. */
export interface CheckedOperation {
    op: 'PUT' | 'PATCH' | 'DELETE';
    table: WritableTable;
    id: string;
    key: Readonly<Record<string, string>>;
    values: Readonly<Record<string, unknown>>;
}

export type Checked = { valid: true; operation: CheckedOperation } | { valid: false; reason: RefusalReason };

/** The key columns a device's one text id stands for, or `null` when it is not an id of that table's. */
export function keyOf(table: WritableTable, id: string): Record<string, string> | null {
    const policy = policyFor(table);
    const parts = policy.key.length === 1 ? [id] : id.split('.');
    if (parts.length !== policy.key.length) return null;
    const key: Record<string, string> = {};
    for (let index = 0; index < policy.key.length; index += 1) {
        const column = policy.key[index];
        const part = parts[index];
        const rule = column === undefined ? undefined : policy.columns[column];
        if (column === undefined || !rule || part === undefined || part === '' || part.length > 200) return null;
        // Each part of a key is of its column's kind: an id must look like one, a day must be a day.
        const read = readValue(rule, part);
        if (!read.valid || typeof read.value !== 'string') return null;
        key[column] = read.value;
    }
    return key;
}

/**
 * Checks the shape of a write before anything is done with it: the table must be one a device may write, the id
 * one of its ids, every column one a device may send, and every value of its column's kind. Nothing a device
 * names is ever used as a name; it is only ever looked up here.
 */
export function checkOperation(operation: DeviceOperation): Checked {
    const invalid: Checked = { valid: false, reason: 'invalid' };
    if (!operation || typeof operation.table !== 'string' || !isWritableTable(operation.table)) return invalid;
    if (operation.op !== 'PUT' && operation.op !== 'PATCH' && operation.op !== 'DELETE') return invalid;
    if (typeof operation.id !== 'string') return invalid;
    const table = operation.table;
    const policy = policyFor(table);
    const key = keyOf(table, operation.id);
    if (!key) return invalid;

    const values: Record<string, unknown> = {};
    if (operation.op !== 'DELETE') {
        const data = operation.data ?? {};
        if (typeof data !== 'object' || Array.isArray(data)) return invalid;
        for (const [column, raw] of Object.entries(data)) {
            // The id is the row's key and travels separately.
            if (column === 'id' && !policy.key.includes('id')) continue;
            const rule = policy.columns[column];
            if (!rule) return invalid;
            const read = readValue(rule, raw);
            if (!read.valid) return invalid;
            // A key column in the data must agree with the id it came with.
            if (policy.key.includes(column) && read.value !== key[column]) return invalid;
            if (!policy.key.includes(column)) values[column] = read.value;
        }
    }
    return { valid: true, operation: { op: operation.op, table, id: operation.id, key, values } };
}

export type Judged =
    /** Nothing to do: a change to a row that is gone, or one that changes nothing. */
    | { action: 'skip' }
    | { action: 'insert'; row: Row }
    | { action: 'update'; changed: readonly string[]; row: Row }
    | { action: 'delete' }
    | { action: 'refuse'; reason: RefusalReason };

/**
 * Decides what a write really is, from the row as it stands, and whether this person may make it.
 *
 * What the device called the write is only a hint. A `PUT` for a row that exists is an update of what differs,
 * and is judged as one; a change to a row that has gone does nothing.
 */
export function judge(principal: Principal, operation: CheckedOperation, current: Row | null): Judged {
    const policy = policyFor(operation.table);
    const refuse = (verdict: Verdict): Judged | null => (verdict ? { action: 'refuse', reason: verdict } : null);

    if (operation.op === 'DELETE') {
        if (!current) return { action: 'skip' };
        return refuse(policy.delete(principal, current)) ?? { action: 'delete' };
    }
    if (!current) {
        if (operation.op === 'PATCH') return { action: 'skip' };
        const row = { ...operation.key, ...operation.values };
        return refuse(policy.insert(principal, row)) ?? { action: 'insert', row };
    }
    const changed = Object.keys(operation.values).filter((column) => !sameValue(operation.values[column], current[column]));
    if (changed.length === 0) return { action: 'skip' };
    const row = { ...current, ...operation.values };
    return refuse(policy.update(principal, current, row, changed)) ?? { action: 'update', changed, row };
}

/**
 * A row as a device holds it, in the server's form, so the rules can be asked about it on the device. Columns the
 * rules know are read by their kind; anything else, such as whom a refusal belongs to, is passed through.
 */
export function toServerForm(table: WritableTable, deviceRow: Readonly<Record<string, unknown>>): Row {
    const policy = policyFor(table);
    const row: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(deviceRow)) {
        const rule = policy.columns[column];
        const read = rule ? readValue(rule, value) : null;
        row[column] = read?.valid ? read.value : value;
    }
    // A device knows a row with one key column by `id`, whatever the column is called.
    const keyColumn = policy.key.length === 1 ? policy.key[0] : undefined;
    if (keyColumn && keyColumn !== 'id' && row[keyColumn] === undefined) row[keyColumn] = deviceRow.id;
    return row;
}
