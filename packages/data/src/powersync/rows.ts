import { policyFor, toServerForm, type ColumnKind, type Row, type WritableTable } from '../policy';
import type { Device } from './device';
import { ensureDelete, ensureInsert, ensureUpdate } from './mutate';
import type { Writer } from './sql';

// Writing one row of a table a device may write. A mutation says what the row is in the app's own terms — a real
// boolean, a document, a list — and these ask the write rules about it, as the server will, and then put it in the
// form the device's database keeps. A table's name here is always one of the write rules' own, never a value.

const asText: ReadonlySet<ColumnKind> = new Set<ColumnKind>(['json', 'days', 'uuids', 'texts']);

function deviceValue(kind: ColumnKind | undefined, value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (kind === 'boolean') return value ? 1 : 0;
    if (kind && asText.has(kind)) return JSON.stringify(value);
    return value;
}

/** The one text id a device knows a row by: its key, or the parts of its key joined by full stops. */
export function rowId(table: WritableTable, row: Row): string {
    return policyFor(table)
        .key.map((column) => String(row[column]))
        .join('.');
}

/** The columns of a row as the device stores them. A table with one key column keeps that key as the row's id alone. */
function deviceColumns(table: WritableTable, row: Row): Array<[string, unknown]> {
    const policy = policyFor(table);
    const loneKey = policy.key.length === 1 ? policy.key[0] : null;
    return Object.entries(row)
        .filter(([column]) => column !== loneKey && column in policy.columns)
        .map(([column, value]) => [column, deviceValue(policy.columns[column]?.kind, value)]);
}

/** The row a device holds under an id, as the write rules read it, or `null`. */
export async function readRow(writer: Pick<Writer, 'getAll'>, table: WritableTable, id: string): Promise<Row | null> {
    const [held] = await writer.getAll<Record<string, unknown>>(`SELECT * FROM ${table} WHERE id = ?`, [id]);
    return held ? toServerForm(table, held) : null;
}

/** Adds a row. Returns the id the device knows it by. */
export async function insertRow(device: Device, writer: Writer, table: WritableTable, row: Row): Promise<string> {
    ensureInsert(device, table, row);
    const id = rowId(table, row);
    const columns = deviceColumns(table, row);
    await writer.execute(`INSERT INTO ${table} (id${columns.map(([column]) => `, ${column}`).join('')}) VALUES (?${columns.map(() => ', ?').join('')})`, [id, ...columns.map(([, value]) => value)]);
    return id;
}

/**
 * Changes a row. Only what really differs is written, so only that is sent. Returns the columns that changed, or
 * `null` when there is no such row.
 */
export async function updateRow(device: Device, writer: Writer, table: WritableTable, id: string, changes: Row): Promise<string[] | null> {
    const current = await readRow(writer, table, id);
    if (!current) return null;
    const changed = ensureUpdate(device, table, current, changes);
    if (changed.length === 0) return changed;
    const columns = deviceColumns(table, Object.fromEntries(changed.map((column) => [column, changes[column]])));
    if (columns.length > 0) await writer.execute(`UPDATE ${table} SET ${columns.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`, [...columns.map(([, value]) => value), id]);
    return changed;
}

/** Removes a row. Returns whether there was one. */
export async function deleteRow(device: Device, writer: Writer, table: WritableTable, id: string): Promise<boolean> {
    const current = await readRow(writer, table, id);
    if (!current) return false;
    ensureDelete(device, table, current);
    await writer.execute(`DELETE FROM ${table} WHERE id = ?`, [id]);
    return true;
}
