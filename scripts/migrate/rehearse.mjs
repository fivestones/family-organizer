#!/usr/bin/env node
// Rehearses an import with nothing installed: the export is loaded into a Postgres that lives only inside this
// process, checked against the export, and thrown away. Nothing is written anywhere, and no value is printed.
//
//   node scripts/migrate/rehearse.mjs [export-dir]
//
// It is the quick way to find out whether an export will import cleanly, before there is a database to import it
// into. The real import is scripts/migrate/import.mjs, and it is checked with scripts/migrate/verify.mjs.

import { PGlite } from '@electric-sql/pglite';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { applyMigrations } from '../../db/migrate.mjs';
import { describeImport, loadTables, readExport, unknownIn } from './import.mjs';
import { buildRows } from './mapping.mjs';
import { loadTimingResolver, readEntity, verifyImport } from './verify.mjs';

async function main() {
    const root = process.cwd();
    const exportsRoot = path.join(root, '.migration', 'exports');
    const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(exportsRoot, readdirSync(exportsRoot).sort().at(-1));

    const built = buildRows(readExport(exportDir));
    const report = describeImport(built, path.relative(root, exportDir));
    const db = new PGlite();
    let result;
    try {
        await applyMigrations(db);
        await loadTables(db, built.tables);
        result = await verifyImport(db, (entity) => readEntity(exportDir, entity), await loadTimingResolver(root));
    } finally {
        await db.close();
    }

    console.log(`Rehearsed ${report.exportDir}`);
    for (const [table, rows] of Object.entries(report.rows)) console.log(`  ${table.padEnd(28)} ${String(rows).padStart(6)} rows`);
    console.log('\nHeld back, not loaded');
    if (!Object.keys(report.heldBack).length) console.log('  nothing');
    for (const [entity, reasons] of Object.entries(report.heldBack)) for (const [reason, rows] of Object.entries(reasons)) console.log(`  ${entity}: ${rows} — ${reason}`);
    console.log('\nConversions that changed how a value is held');
    if (!Object.keys(report.conversions).length) console.log('  none');
    for (const [note, rows] of Object.entries(report.conversions)) console.log(`  ${String(rows).padStart(5)}  ${note}`);
    if (Object.keys(report.storedButNotMapped).length) {
        console.log('\nStored but neither mapped nor deliberately left behind');
        for (const [entity, names] of Object.entries(report.storedButNotMapped)) console.log(`  ${entity}: ${Object.entries(names).map(([name, rows]) => `${name} (${rows})`).join(', ')}`);
    }

    console.log('\nChecks');
    let failed = 0;
    for (const { name, compared, wrong } of result.checks) {
        if (wrong.length) failed += 1;
        console.log(`  ${wrong.length ? 'FAIL' : 'ok  '}  ${name} (${compared} compared${wrong.length ? `, ${wrong.length} wrong: ${wrong.slice(0, 3).join(', ')}` : ''})`);
    }
    console.log(failed ? `\n${failed} check${failed === 1 ? '' : 's'} failed.` : '\nEvery check passed.');
    const unknown = unknownIn(built);
    if (unknown.length) console.log('\nThe export holds something this version does not know, listed above. The import will stop until it is mapped, listed as left behind, or you pass --leave-unknown-behind.');
    const held = Object.values(built.heldBack).reduce((sum, rows) => sum + rows.length, 0);
    if (!failed && !unknown.length) console.log(held ? `This export will import. ${held} row${held === 1 ? '' : 's'} will be held back, for the reasons above, and kept in a file beside the import's report.` : 'This export will import, whole.');
    if (failed || unknown.length) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
