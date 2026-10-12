#!/usr/bin/env node
// Exports every entity of the Instant app to disk, for the move to PowerSync (docs/powersync-migration.md, Phase 2).
//
// It only ever reads. The Admin SDK is wrapped so that nothing in this file can reach `transact`.
//
// The layout written is the one Instant's own backups use (`instant-cli backup download`): one NDJSON file per
// entity under entities/, each line `{ "entity": { ...attributes, ...links } }`, where a has-one link holds the
// linked id and a has-many link an array of ids. The census and the importer therefore read either source.
//
//   node scripts/migrate/export.mjs            -> .migration/exports/<timestamp>/
//   node scripts/migrate/export.mjs --out dir

import { build } from 'esbuild';
import { init } from '@instantdb/admin';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const PAGE_SIZE = 500;
// Entities the hosted app still holds that the schema file no longer declares.
const UNDECLARED_ENTITIES = ['choreManualStarts'];

function loadLocalEnv() {
    for (const filename of ['.env.local', '.env']) {
        const filepath = path.join(root, filename);
        if (!existsSync(filepath)) continue;
        for (const rawLine of readFileSync(filepath, 'utf8').split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const normalized = line.startsWith('export ') ? line.slice(7) : line;
            const separator = normalized.indexOf('=');
            if (separator === -1) continue;
            const key = normalized.slice(0, separator).trim();
            if (!key || process.env[key] != null) continue;
            let value = normalized.slice(separator + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
            process.env[key] = value;
        }
    }
}

/** The schema file is TypeScript; bundle it once so a plain Node script can read it. */
async function loadSchema() {
    const outfile = path.join(tmpdir(), `instant-schema-${process.pid}.cjs`);
    await build({ entryPoints: [path.join(root, 'instant.schema.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
    const loaded = createRequire(import.meta.url)(outfile);
    rmSync(outfile, { force: true });
    return loaded.default ?? loaded;
}

/** The links stored on an entity: those it is the forward side of. Exporting one side exports every link once. */
function forwardLinksOf(schema, entity) {
    return Object.values(schema.links)
        .filter((link) => link.forward.on === entity)
        .map((link) => ({ label: link.forward.label, hasOne: link.forward.has === 'one', target: link.reverse.on }));
}

async function exportEntity(readOnly, entity, links, outDir) {
    const file = path.join(outDir, 'entities', `${entity}.jsonl`);
    writeFileSync(file, '');
    let offset = 0;
    for (;;) {
        const shape = { $: { limit: PAGE_SIZE, offset, order: { serverCreatedAt: 'asc' } } };
        for (const link of links) shape[link.label] = { $: { fields: ['id'] } };
        const data = await readOnly.query({ [entity]: shape });
        const rows = data?.[entity] ?? [];
        const lines = rows.map((row) => {
            const record = { ...row };
            for (const link of links) {
                const linked = (Array.isArray(row[link.label]) ? row[link.label] : row[link.label] ? [row[link.label]] : []).map((target) => target.id);
                if (link.hasOne) {
                    if (linked.length) record[link.label] = linked[0];
                    else delete record[link.label];
                } else {
                    record[link.label] = linked;
                }
            }
            return JSON.stringify({ entity: record });
        });
        if (lines.length) appendFileSync(file, `${lines.join('\n')}\n`);
        offset += rows.length;
        if (rows.length < PAGE_SIZE) return offset;
    }
}

loadLocalEnv();
const appId = process.env.INSTANT_APP_ID || process.env.NEXT_PUBLIC_INSTANT_APP_ID;
const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN;
if (!appId || !adminToken) {
    console.error('INSTANT_APP_ID (or NEXT_PUBLIC_INSTANT_APP_ID) and INSTANT_APP_ADMIN_TOKEN must be set, in the environment or in .env.');
    process.exit(1);
}

const admin = init({
    appId,
    adminToken,
    ...(process.env.NEXT_PUBLIC_INSTANT_API_URI ? { apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI } : {}),
});
// The only door to the database in this script. There is deliberately no way to write through it.
const readOnly = Object.freeze({ query: (query) => admin.query(query) });

const outFlag = process.argv.indexOf('--out');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = outFlag > -1 ? path.resolve(process.argv[outFlag + 1]) : path.join(root, '.migration', 'exports', stamp);
mkdirSync(path.join(outDir, 'entities'), { recursive: true });

const schema = await loadSchema();
const declared = Object.keys(schema.entities).filter((name) => name !== '$files' && name !== '$streams');
const counts = {};
const started = Date.now();
for (const entity of declared) {
    counts[entity] = await exportEntity(readOnly, entity, forwardLinksOf(schema, entity), outDir);
    process.stdout.write(`${entity.padEnd(30)} ${String(counts[entity]).padStart(7)}\n`);
}
const undeclared = {};
for (const entity of UNDECLARED_ENTITIES) {
    try {
        undeclared[entity] = await exportEntity(readOnly, entity, [], outDir);
        process.stdout.write(`${`${entity} (undeclared)`.padEnd(30)} ${String(undeclared[entity]).padStart(7)}\n`);
    } catch (error) {
        undeclared[entity] = `not readable: ${error?.message ?? error}`;
    }
}

writeFileSync(
    path.join(outDir, 'config.json'),
    JSON.stringify({ source: 'admin-sdk export (scripts/migrate/export.mjs)', exportedAt: new Date().toISOString(), entityCounts: counts, undeclaredEntityCounts: undeclared }, null, 2)
);
const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
console.log(`\n${total} rows from ${declared.length} entities in ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(`Written to ${path.relative(root, outDir)}`);
