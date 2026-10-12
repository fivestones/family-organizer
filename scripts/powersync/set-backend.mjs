#!/usr/bin/env node
// Says which backend this installation's clients are to use, or shows what it says now.
//
//   DATABASE_URL=postgres://… node scripts/powersync/set-backend.mjs               show
//   DATABASE_URL=postgres://… node scripts/powersync/set-backend.mjs powersync     switch to PowerSync
//   DATABASE_URL=postgres://… node scripts/powersync/set-backend.mjs instant       switch back
//
// Every client is told the answer when it starts (GET /api/client-config). Inside the app's container DATABASE_URL
// is already set: `docker compose exec family-organizer node scripts/powersync/set-backend.mjs powersync`.

import pg from 'pg';

const wanted = process.argv[2];
if (wanted !== undefined && wanted !== 'instant' && wanted !== 'powersync') {
    console.error('Usage: node scripts/powersync/set-backend.mjs [instant|powersync]');
    process.exit(1);
}
if (!process.env.DATABASE_URL) {
    console.error('Set DATABASE_URL to the installation\'s Postgres database.');
    process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
    if (wanted) await client.query('UPDATE installation SET backend = $1', [wanted]);
    const { rows } = await client.query('SELECT backend, data_generation, writes_frozen FROM installation');
    console.log(`backend: ${rows[0].backend} · data generation: ${rows[0].data_generation} · writes frozen: ${rows[0].writes_frozen}`);
} finally {
    await client.end();
}
