#!/usr/bin/env node
// Applies any migration in db/migrations/ that the database has not had yet.
//
// The app does this itself when it starts. This is for a database the app is not running against: a fresh one
// about to be imported into, or one being prepared by hand.
//
//   DATABASE_URL=postgres://… node scripts/db/migrate.mjs

import pg from 'pg';
import { applyMigrations, fromPgClient } from '../../db/migrate.mjs';

if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL to the Postgres database to migrate.');
    process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
    const ran = await applyMigrations(fromPgClient(client));
    console.log(ran.length ? `Applied ${ran.join(', ')}` : 'Nothing to apply.');
} finally {
    await client.end();
}
