import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresDialect } from 'kysely';
import { applyMigrations } from '@/db/migrate.mjs';
import type { Database } from '@/db/types';
import { setDbForTests, type AppDatabase } from '@/lib/server/db';
import { POSTGRES_TYPE_PARSERS } from '@/lib/server/pg-types';

// A real Postgres, in process, with the app's migrations applied and the server's own query builder on top.
// It is one connection: whatever takes it holds it until it lets go, as a pool of one would. Two transactions
// cannot run side by side here, so anything that needs a race runs against the Postgres in the compose profile.

export interface TestDatabase {
    /** What the server's code is given. */
    db: AppDatabase;
    /** The database itself, for a test to set a scene or look at a result with plain SQL. */
    sql: PGlite;
    close(): Promise<void>;
}

const command = (text: string) => text.trimStart().split(/\s+/, 1)[0].toUpperCase();

export async function createTestDatabase(): Promise<TestDatabase> {
    const pglite = new PGlite({ parsers: POSTGRES_TYPE_PARSERS });
    await applyMigrations(pglite);

    let held: Promise<void> = Promise.resolve();
    // The same object every time: the query builder keeps what it knows about a connection by its identity.
    let letGo: () => void = () => {};
    const client = {
        async query(text: string, values: unknown[] = []) {
            const result = await pglite.query(text, values as any[]);
            return { command: command(text), rowCount: result.affectedRows ?? result.rows.length, rows: result.rows };
        },
        release() {
            letGo();
        },
    };
    const pool = {
        async connect() {
            const previous = held;
            held = new Promise<void>((resolve) => (letGo = resolve));
            await previous;
            return client;
        },
        async end() {},
    };

    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool: pool as any }) });
    setDbForTests(db);
    return {
        db,
        sql: pglite,
        async close() {
            setDbForTests(null);
            await db.destroy();
            await pglite.close();
        },
    };
}
