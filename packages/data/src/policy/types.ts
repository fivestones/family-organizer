import type { Principal } from '../session/principal';

/**
 * How a value is held in a column, which decides how one that arrives from a device is checked and read.
 * A device holds every value as SQLite does: a boolean as 0 or 1, a JSON document and a list of days as JSON text.
 */
export type ColumnKind = 'text' | 'uuid' | 'boolean' | 'integer' | 'number' | 'day' | 'instant' | 'time' | 'json' | 'days';

export interface ColumnRule {
    kind: ColumnKind;
    /** For text that may only be one of a few words. */
    oneOf?: readonly string[];
}

/** A row, by column name, with every value in the form the server reads it from Postgres. */
export type Row = Readonly<Record<string, unknown>>;

/**
 * Why a write was refused. The words are for code; what a person is shown is chosen where it is shown.
 *
 * - `not_allowed`: this person may not make this kind of change to this table at all.
 * - `not_yours`: the row belongs to someone else, or names someone else where it must name them.
 * - `column_not_allowed`: they may change the row, but not that part of it.
 * - `already_claimed`: someone else has already completed it.
 * - `invalid`: the write is malformed: an unknown table or column, or a value of the wrong kind.
 * - `conflict`: the database would not take it, because of something another device did first.
 */
export type RefusalReason = 'not_allowed' | 'not_yours' | 'column_not_allowed' | 'already_claimed' | 'invalid' | 'conflict';

/** `null` allows the write. */
export type Verdict = RefusalReason | null;

export interface TablePolicy {
    /**
     * The columns that identify a row. A device knows a row by one text id: for a single key column that is its
     * value, and for two it is the pair joined by a full stop.
     */
    key: readonly string[];
    /** Every column a device may send. A column that is not here cannot be written from a device by anyone. */
    columns: Readonly<Record<string, ColumnRule>>;
    insert(principal: Principal, next: Row): Verdict;
    /** `changed` names the columns whose value in `next` differs from `current`. */
    update(principal: Principal, current: Row, next: Row, changed: readonly string[]): Verdict;
    delete(principal: Principal, current: Row): Verdict;
}
