import { policyFor, sameValue, type RefusalReason, type Row, type WritableTable } from '../policy';
import type { Device } from './device';
import { TRANSACTION_TABLE } from './schema';
import type { Writer } from './sql';

/** A write this person may not make. The same rules refuse it on the server; here they answer at once. */
export class WriteRefusedError extends Error {
    constructor(readonly reason: RefusalReason, readonly table: string) {
        super(`This change is not allowed (${reason}).`);
        this.name = 'WriteRefusedError';
    }
}

/**
 * Runs one mutation as one local transaction, and names it. The name and a random id are written with it and
 * travel with its upload: the id is how the server knows a transaction it has already applied, and the name is
 * what a refusal says was refused.
 */
export function mutate<Result>(device: Device, name: string, write: (writer: Writer) => Promise<Result>): Promise<Result> {
    return device.db.writeTransaction(async (transaction) => {
        let wrote = false;
        const writer: Writer = {
            getAll: (sql, parameters) => transaction.getAll(sql, parameters),
            execute: (sql, parameters) => {
                wrote = true;
                return transaction.execute(sql, parameters);
            },
        };
        const result = await write(writer);
        // A mutation that found nothing to change has made no transaction to name.
        if (wrote) await transaction.execute(`INSERT INTO ${TRANSACTION_TABLE} (id, mutation) VALUES (?, ?)`, [device.createId(), name]);
        return result;
    });
}

// The rules are asked about rows in the server's form: see `toServerForm`.

export function ensureInsert(device: Device, table: WritableTable, next: Row): void {
    const verdict = policyFor(table).insert(device.principal, next);
    if (verdict) throw new WriteRefusedError(verdict, table);
}

/** Returns the names of the columns that really change. */
export function ensureUpdate(device: Device, table: WritableTable, current: Row, changes: Row): string[] {
    const changed = Object.keys(changes).filter((column) => !sameValue(changes[column], current[column]));
    const verdict = changed.length ? policyFor(table).update(device.principal, current, { ...current, ...changes }, changed) : null;
    if (verdict) throw new WriteRefusedError(verdict, table);
    return changed;
}

export function ensureDelete(device: Device, table: WritableTable, current: Row): void {
    const verdict = policyFor(table).delete(device.principal, current);
    if (verdict) throw new WriteRefusedError(verdict, table);
}
