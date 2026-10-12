#!/usr/bin/env node
// Starts and stops the throwaway Postgres and PowerSync service the live sync test runs against.
//
//   node scripts/powersync/test-stack.mjs up      start both, with fresh secrets, and apply the migrations
//   node scripts/powersync/test-stack.mjs down    stop both; nothing is kept
//
// The secrets and addresses are written to .migration/sync-test/env, which git ignores, for the test to read.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { applyMigrations, fromPgClient } from '../../db/migrate.mjs';

const root = process.cwd();
const directory = path.join(root, '.migration', 'sync-test');
const envFile = path.join(directory, 'env');
const postgresPort = process.env.SYNC_TEST_POSTGRES_PORT ?? '55433';
const powersyncPort = process.env.SYNC_TEST_POWERSYNC_PORT ?? '58081';
const compose = (...args) => ['compose', '-p', 'family-organizer-sync-test', '--env-file', envFile, '-f', 'docker-compose.yml', '-f', 'docker-compose.sync-test.yml', '--profile', 'powersync', ...args];
const docker = (args) => spawnSync('docker', args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] }).status === 0;

async function up() {
    mkdirSync(directory, { recursive: true });
    const secrets = execFileSync('node', ['scripts/powersync/setup-env.mjs'], { cwd: root, encoding: 'utf8' });
    const password = /^POSTGRES_PASSWORD=(.+)$/m.exec(secrets)[1];
    writeFileSync(
        envFile,
        [
            secrets.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=postgres://family_organizer:${password}@127.0.0.1:${postgresPort}/family_organizer`),
            `POWERSYNC_URL=http://127.0.0.1:${powersyncPort}`,
            '# The main compose file reads these for services this test does not start.',
            'S3_ACCESS_KEY_ID=unused', 'S3_SECRET_ACCESS_KEY=unused', 'DEVICE_ACCESS_KEY=unused', 'MINIO_PORT=0', 'MINIO_CONSOLE_PORT=0', 'NEXT_PUBLIC_S3_ENDPOINT=',
            '',
        ].join('\n')
    );
    if (!docker(compose('up', '-d', '--wait', 'fo-postgres', 'fo-powersync'))) process.exit(1);

    const databaseUrl = /^DATABASE_URL=(.+)$/m.exec(readFileSync(envFile, 'utf8'))[1];
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const ran = await applyMigrations(fromPgClient(client));
        console.log(`Migrations applied: ${ran.length}`);
    } finally {
        await client.end();
    }
    console.log(`Ready. Postgres on 127.0.0.1:${postgresPort}, PowerSync on 127.0.0.1:${powersyncPort}.`);
}

const command = process.argv[2];
if (command === 'up') await up();
else if (command === 'down') docker(compose('down', '--volumes'));
else {
    console.error('Usage: node scripts/powersync/test-stack.mjs up | down');
    process.exit(1);
}
