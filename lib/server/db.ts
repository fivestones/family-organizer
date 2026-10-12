import 'server-only';

import { Kysely, PostgresDialect, sql, type RawBuilder } from 'kysely';
import pg from 'pg';
import type { Database } from '@/db/types';
import { POSTGRES_TYPE_PARSERS } from './pg-types';

// The server's one connection to Postgres (docs/powersync-migration.md, "The server on Postgres").
//
// A deployment with no DATABASE_URL has no Postgres and runs on InstantDB, as every deployment did before the move
// to PowerSync began. Code that needs the database asks `isPostgresConfigured()` first, or lets `getDb()` throw.

export type AppDatabase = Kysely<Database>;

const cache = globalThis as typeof globalThis & { __familyOrganizerDb?: AppDatabase };

export function isPostgresConfigured(): boolean {
    return Boolean(cache.__familyOrganizerDb) || Boolean(process.env.DATABASE_URL);
}

export function getDb(): AppDatabase {
    if (cache.__familyOrganizerDb) return cache.__familyOrganizerDb;
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set, so this deployment has no Postgres database.');
    const pool = new pg.Pool({
        connectionString,
        max: 10,
        types: { getTypeParser: (oid: number, format?: string) => POSTGRES_TYPE_PARSERS[oid] ?? pg.types.getTypeParser(oid, format as 'text') },
    });
    // Kept on globalThis so a development reload reuses the pool instead of opening another.
    cache.__familyOrganizerDb = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    return cache.__familyOrganizerDb;
}

/** Tests bind a database of their own; `null` unbinds it. */
export function setDbForTests(db: AppDatabase | null): void {
    if (db) cache.__familyOrganizerDb = db;
    else delete cache.__familyOrganizerDb;
}

/**
 * A JSON document as a query value. The driver would send a string as text and an array as a Postgres array, so a
 * document always travels as JSON text and is cast.
 */
export function jsonb(value: unknown): RawBuilder<unknown> {
    return sql`${JSON.stringify(value ?? null)}::jsonb`;
}
