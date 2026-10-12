// Applies the SQL files in db/migrations/, in name order, each once.
//
//   DATABASE_URL=postgres://… node scripts/db/migrate.mjs
//
// `db` is anything with `query(text, params)` and `exec(text)`: a `pg` client through `fromPgClient`, or PGlite as it
// is. A migration runs inside a transaction with the row that records it, so a file is applied wholly or not at all.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Any constant will do; it only has to be the same for every runner pointed at one database.
const MIGRATION_LOCK = 4_815_162_342;

/** Gives a `pg` client the two methods the scripts use. A statement with no parameters may hold several commands. */
export function fromPgClient(client) {
    return {
        query: (text, params = []) => client.query(text, params),
        exec: (text) => client.query(text),
    };
}

export function listMigrations(dir = MIGRATIONS_DIR) {
    return readdirSync(dir)
        .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
        .sort()
        .map((file) => ({ version: file.replace(/\.sql$/, ''), file: path.join(dir, file) }));
}

/** Returns the versions it applied, in order. Safe to call on every start. */
export async function applyMigrations(db, { dir = MIGRATIONS_DIR } = {}) {
    await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    // Two app containers starting together must not both apply the same file.
    await db.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    try {
        const { rows } = await db.query('SELECT version FROM schema_migrations');
        const applied = new Set(rows.map((row) => row.version));
        const ran = [];
        for (const migration of listMigrations(dir)) {
            if (applied.has(migration.version)) continue;
            await db.exec('BEGIN');
            try {
                await db.exec(readFileSync(migration.file, 'utf8'));
                await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version]);
                await db.exec('COMMIT');
            } catch (error) {
                await db.exec('ROLLBACK');
                throw new Error(`Migration ${migration.version} failed: ${error.message}`, { cause: error });
            }
            ran.push(migration.version);
        }
        return ran;
    } finally {
        await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    }
}
