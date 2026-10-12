import { DummyDriver, Kysely, SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler, type Compilable } from 'kysely';
import type { ClientDatabase } from './schema';

/**
 * Builds typed SQL for the device's tables. It never runs anything itself: a statement built here is run by
 * PowerSync, inside the read or write transaction it belongs to, so that every query of one read sees one moment.
 */
export const sqlFor = new Kysely<ClientDatabase>({
    dialect: {
        createAdapter: () => new SqliteAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (db) => new SqliteIntrospector(db),
        createQueryCompiler: () => new SqliteQueryCompiler(),
    },
});

/** What a read is given: PowerSync's database, or one of its transactions. */
export interface Reader {
    getAll<Row>(sql: string, parameters?: any[]): Promise<Row[]>;
}

/** What a write is given: one of PowerSync's write transactions. */
export interface Writer extends Reader {
    execute(sql: string, parameters?: any[]): Promise<unknown>;
}

export function all<Row>(reader: Reader, query: Compilable<Row>): Promise<Row[]> {
    const { sql, parameters } = query.compile();
    return reader.getAll<Row>(sql, [...parameters]);
}

export async function first<Row>(reader: Reader, query: Compilable<Row>): Promise<Row | null> {
    return (await all(reader, query))[0] ?? null;
}

export async function run(writer: Writer, query: Compilable<unknown>): Promise<void> {
    const { sql, parameters } = query.compile();
    await writer.execute(sql, [...parameters]);
}

// How values sit in SQLite, and how they come back out.
export const asFlag = (value: boolean): number => (value ? 1 : 0);
export const flag = (value: number | null): boolean => value === 1;
export const optionalFlag = (value: number | null): boolean | null => (value === null ? null : value === 1);

/** A JSON document a device holds as text. Anything that does not parse is treated as not there. */
export function fromJson(text: string | null): unknown {
    if (text === null || text === '') return null;
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

export const asRecord = (value: unknown): Record<string, unknown> | null => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/** A time of day reaches a device as `HH:MM:SS.mmm`. The app uses `HH:MM`. */
export const toMinutes = (time: string | null): string | null => (time ? time.slice(0, 5) : null);
