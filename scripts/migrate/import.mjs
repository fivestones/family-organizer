#!/usr/bin/env node
// Loads an export of the Instant app into Postgres, through scripts/migrate/mapping.mjs.
//
// It reads an export made by scripts/migrate/export.mjs or an unzipped Instant backup; the two share a layout. It
// writes only to the database DATABASE_URL names, in one transaction, so a failed import leaves nothing behind. Rows
// the new schema cannot hold are not dropped: they are written under held-back/ beside the report, with the reason.
//
//   DATABASE_URL=postgres://… node scripts/migrate/import.mjs                  the newest export
//   DATABASE_URL=postgres://… node scripts/migrate/import.mjs <export-dir>
//   … --replace     empty the tables first; without it, tables that already hold rows stop the import
//
// The report holds counts and reasons, never a stored value. The held-back files hold the family's data and stay
// under .migration/, which git and Docker ignore.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyMigrations, fromPgClient } from '../../db/migrate.mjs';
import { buildRows, COLUMNS, JSON_COLUMNS, TABLES } from './mapping.mjs';

/** Every row of an entity, as the export holds it. An entity with no file has no rows. */
export function readExport(exportDir) {
    const cache = new Map();
    const rowsOf = (entity) => {
        if (!cache.has(entity)) {
            const file = path.join(exportDir, 'entities', `${entity}.jsonl`);
            const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
            cache.set(entity, lines.map((line) => JSON.parse(line).entity));
        }
        return cache.get(entity);
    };
    /** Every entity the export has a file for, so that one nobody reads is noticed. */
    rowsOf.entities = () => (existsSync(path.join(exportDir, 'entities')) ? readdirSync(path.join(exportDir, 'entities')) : []).filter((name) => name.endsWith('.jsonl')).map((name) => name.slice(0, -'.jsonl'.length));
    return rowsOf;
}

/** Writes the built rows, table by table in foreign-key order, inside one transaction. */
export async function loadTables(db, tables, { replace = false } = {}) {
    await db.exec('BEGIN');
    try {
        // A member names their default envelope and the envelope names its member, so neither can be checked until both are in.
        await db.exec('SET CONSTRAINTS ALL DEFERRED');
        if (replace) await db.exec(`TRUNCATE ${[...TABLES].reverse().join(', ')} CASCADE`);
        for (const table of TABLES) {
            const { rows: existing } = await db.query(`SELECT 1 FROM ${table} LIMIT 1`);
            if (existing.length) throw new Error(`${table} already holds rows. Import into an empty database, or pass --replace.`);
        }
        for (const table of TABLES) {
            const rows = tables[table] ?? [];
            if (!rows.length) continue;
            const columns = COLUMNS[table];
            const jsonColumns = new Set(JSON_COLUMNS[table] ?? []);
            // A JSON document travels as text under a name of its own and is cast on the way in, so a document that
            // is itself a string or a number arrives as JSON and is not taken for the column's own input.
            const prepared = rows.map((row) =>
                Object.fromEntries(
                    columns.map((column) =>
                        jsonColumns.has(column) ? [`${column}__json`, row[column] == null ? null : JSON.stringify(row[column])] : [column, row[column] ?? null]
                    )
                )
            );
            // One statement per table: Postgres converts each value to its column's type, and a row that refers to
            // another row of the same table, as a chore may, is checked only once all of them are in.
            await db.query(
                `INSERT INTO ${table} (${columns.join(', ')})
                 SELECT ${columns.map((column) => (jsonColumns.has(column) ? `(item.value ->> '${column}__json')::jsonb` : `typed.${column}`)).join(', ')}
                 FROM json_array_elements($1::json) AS item(value)
                 CROSS JOIN LATERAL json_populate_record(null::${table}, item.value) AS typed`,
                [JSON.stringify(prepared)]
            );
        }
        await db.exec('COMMIT');
    } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
    }
}

/** What the import did, in counts and reasons only. */
export function describeImport(built, exportDir) {
    const reasons = {};
    for (const [entity, held] of Object.entries(built.heldBack)) {
        reasons[entity] = {};
        for (const { reason } of held) reasons[entity][reason] = (reasons[entity][reason] ?? 0) + 1;
    }
    return {
        exportDir,
        rows: Object.fromEntries(TABLES.map((table) => [table, built.tables[table].length])),
        heldBack: reasons,
        conversions: built.notes,
        storedButNotMapped: built.unmapped,
    };
}

async function main() {
    const root = process.cwd();
    const args = process.argv.slice(2);
    const replace = args.includes('--replace');
    const exportsRoot = path.join(root, '.migration', 'exports');
    const given = args.find((arg) => !arg.startsWith('--'));
    const exportDir = given ? path.resolve(given) : path.join(exportsRoot, readdirSync(exportsRoot).sort().at(-1));
    if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL to the Postgres database to import into.');

    const built = buildRows(readExport(exportDir));
    const report = describeImport(built, path.relative(root, exportDir));

    const { default: pg } = await import('pg');
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        const db = fromPgClient(client);
        report.migrationsApplied = await applyMigrations(db);
        await loadTables(db, built.tables, { replace });
    } finally {
        await client.end();
    }

    const outDir = path.join(root, '.migration', 'imports', new Date().toISOString().replace(/[:.]/g, '-'));
    mkdirSync(path.join(outDir, 'held-back'), { recursive: true });
    for (const [entity, held] of Object.entries(built.heldBack)) {
        writeFileSync(path.join(outDir, 'held-back', `${entity}.jsonl`), held.map((item) => JSON.stringify(item)).join('\n') + '\n');
    }
    writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));

    console.log(`Imported ${report.exportDir}`);
    for (const [table, rows] of Object.entries(report.rows)) console.log(`  ${table.padEnd(20)} ${String(rows).padStart(6)} rows`);
    console.log('\nHeld back, not loaded');
    const held = Object.entries(report.heldBack);
    if (!held.length) console.log('  nothing');
    for (const [entity, reasons] of held) for (const [reason, rows] of Object.entries(reasons)) console.log(`  ${entity}: ${rows} — ${reason}`);
    console.log('\nConversions that changed how a value is held');
    if (!Object.keys(report.conversions).length) console.log('  none');
    for (const [note, rows] of Object.entries(report.conversions)) console.log(`  ${String(rows).padStart(5)}  ${note}`);
    if (Object.keys(report.storedButNotMapped).length) {
        console.log('\nStored but neither mapped nor deliberately left behind');
        for (const [entity, names] of Object.entries(report.storedButNotMapped)) console.log(`  ${entity}: ${Object.entries(names).map(([name, rows]) => `${name} (${rows})`).join(', ')}`);
    }
    console.log(`\nReport and held-back rows: ${path.relative(root, outDir)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
