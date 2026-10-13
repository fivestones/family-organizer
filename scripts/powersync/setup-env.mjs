#!/usr/bin/env node
// Prints the environment variables Postgres and PowerSync need, with freshly made secrets.
//
// It writes no file. Add what it prints to the deployment's .env, once, before the first
// `docker compose --profile powersync up -d`. Running it again makes new secrets; replacing the ones in use means
// every device has to fetch a new token, and the database passwords would no longer match the database.
//
//   node scripts/powersync/setup-env.mjs
//   node scripts/powersync/setup-env.mjs --staging    the whole .env for a staging copy in a folder of its own
//
// It needs nothing installed but Node, so before there is an image it can be run in a stock one:
//
//   docker run --rm -v "$PWD:/app:ro" -w /app node:24-alpine node scripts/powersync/setup-env.mjs --staging > .env

import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const kid = `family-organizer-${new Date().toISOString().slice(0, 10)}`;
const secret = () => randomBytes(24).toString('hex');
const postgresPassword = secret();

const lines = [
    '# --- Postgres and PowerSync (docs/powersync-migration.md) ---',
    '# The app database. The host name is the Postgres service in docker-compose.yml.',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `DATABASE_URL=postgres://family_organizer:${postgresPassword}@fo-postgres:5432/family_organizer`,
    '# The role PowerSync reads the app database through, and owns its own database with.',
    `POWERSYNC_DB_PASSWORD=${secret()}`,
    '# The key the app signs device tokens with. The private half stays with the app; PowerSync is given the public half.',
    `POWERSYNC_JWT_KID=${kid}`,
    `POWERSYNC_JWT_PRIVATE_KEY=${Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64')}`,
    `POWERSYNC_JWK_N=${jwk.n}`,
    `POWERSYNC_JWK_E=${jwk.e}`,
];
if (process.argv.includes('--staging')) {
    lines.unshift(
        '# --- A staging copy, in a folder of its own (docs/powersync-staging.md) ---',
        '# These two make every `docker compose` command in this folder a staging command.',
        'COMPOSE_FILE=docker-compose.yml:docker-compose.staging.yml',
        'COMPOSE_PROFILES=powersync',
        '# Where the reverse proxy finds staging on this machine: the app, and the sync service behind /powersync/.',
        'STAGING_APP_PORT=8440',
        'STAGING_POWERSYNC_PORT=8430',
        '# What a device presents, once, to be let in: https://<staging hostname>/?activate=<this>',
        `DEVICE_ACCESS_KEY=${secret()}`,
        '# File storage is not part of staging. These only stop Compose warning that they are missing.',
        'S3_ACCESS_KEY_ID=unused',
        'S3_SECRET_ACCESS_KEY=unused',
        'NEXT_PUBLIC_S3_ENDPOINT=',
        'MINIO_PORT=0',
        'MINIO_CONSOLE_PORT=0',
        ''
    );
}
console.log(lines.join('\n'));
