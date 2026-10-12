import 'server-only';

import path from 'node:path';
import pg from 'pg';
import { applyMigrations, fromPgClient } from '@/db/migrate.mjs';

/**
 * Brings the database up to the schema this build expects, before the server answers anything. Two containers
 * starting together are safe: the runner takes an advisory lock, and the second finds nothing left to apply.
 */
export async function migrateOnStart(): Promise<void> {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        // Named from the working directory: once bundled, the runner's own location is no longer the repository's.
        const ran = await applyMigrations(fromPgClient(client), { dir: path.join(process.cwd(), 'db', 'migrations') });
        if (ran.length) console.log(`[db] applied ${ran.join(', ')}`);
    } finally {
        await client.end();
    }
}
