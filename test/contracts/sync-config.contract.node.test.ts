import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { applyMigrations } from '@/db/migrate.mjs';

// What reaches a device is decided in two places that have to agree: the `powersync` publication, which the
// migrations maintain, and the streams in powersync/sync-config.yaml. This holds them together, and holds the
// configuration to the schema, so a renamed column or a forgotten table fails here and not on a device.

const config = parse(readFileSync(path.join(process.cwd(), 'powersync/sync-config.yaml'), 'utf8'));
const queries: string[] = Object.values<{ query?: string; queries?: string[] }>(config.streams).flatMap((stream) => [...(stream.queries ?? []), ...(stream.query ? [stream.query] : [])]);
const tableOf = (query: string) => query.match(/\bFROM\s+([a-z_]+)/i)?.[1] ?? '';

let db: PGlite;
beforeAll(async () => {
    db = new PGlite();
    await applyMigrations(db);
});

describe('the sync configuration', () => {
    it('uses the edition and timestamp precision the app is written against', () => {
        expect(config.config).toEqual({ edition: 3, timestamp_max_precision: 'milliseconds' });
    });

    it.each(queries)('runs against the schema and yields an id: %s', async (query) => {
        // What a token claims is PowerSync's to supply. Any value will do to check the query against the schema.
        const runnable = query.replace(/auth\.parameter\('[a-z_]+'\)/g, 'NULL');
        const result = await db.query(`SELECT * FROM (${runnable}) AS synced LIMIT 0`);
        expect(result.fields.map((field) => field.name)).toContain('id');
    });

    it('names every column, so nothing is sent because someone forgot it was there', () => {
        expect(queries.filter((query) => /\*/.test(query))).toEqual([]);
    });

    it('never sends a PIN hash', () => {
        expect(queries.filter((query) => /pin_hash/i.test(query))).toEqual([]);
    });

    it('filters only by what a token is known to carry', () => {
        const claims = queries.flatMap((query) => Array.from(query.matchAll(/auth\.parameter\('([a-z_]+)'\)/g), (match) => match[1]));
        expect(Array.from(new Set(claims)).sort()).toEqual(['family_member_id', 'type']);
    });

    it('reads exactly the tables that are published to PowerSync', async () => {
        const published = (await db.query<{ tablename: string }>(`SELECT tablename FROM pg_publication_tables WHERE pubname = 'powersync'`)).rows.map((row) => row.tablename);
        expect(Array.from(new Set(queries.map(tableOf))).sort()).toEqual(published.sort());
    });
});
