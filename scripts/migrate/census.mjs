#!/usr/bin/env node
// Reads an export (scripts/migrate/export.mjs, or an unzipped Instant backup) and reports what the data actually
// holds, against what instant.schema.ts declares. It prints counts and attribute names only — never a stored value —
// so its output is safe to paste into the migration log. The schema design in Phase 2 is decided from this.
//
//   node scripts/migrate/census.mjs                 -> the newest export under .migration/exports/
//   node scripts/migrate/census.mjs <export-dir>

import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const exportsRoot = path.join(root, '.migration', 'exports');
const exportDir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(exportsRoot, readdirSync(exportsRoot).sort().at(-1));

async function loadSchema() {
    const outfile = path.join(tmpdir(), `instant-schema-${process.pid}.cjs`);
    await build({ entryPoints: [path.join(root, 'instant.schema.ts')], bundle: true, platform: 'node', format: 'cjs', outfile, logLevel: 'silent' });
    const loaded = createRequire(import.meta.url)(outfile);
    rmSync(outfile, { force: true });
    return loaded.default ?? loaded;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function describeString(value) {
    if (value === '') return 'empty string';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return 'instant, ISO with ms and Z';
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(value)) return 'instant, other ISO form';
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'day (YYYY-MM-DD)';
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(value)) return 'time of day';
    if (UUID.test(value)) return 'uuid';
    if (/^[[{]/.test(value)) return 'JSON text';
    return 'text';
}
function describe(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'number') {
        if (!Number.isInteger(value)) return 'number, fractional';
        return value > 9e11 && value < 5e12 ? 'number, looks like epoch ms' : 'number, integer';
    }
    if (typeof value === 'string') return describeString(value);
    return typeof value;
}

const schema = await loadSchema();
const forwardLinks = (entity) => Object.values(schema.links).filter((link) => link.forward.on === entity).map((link) => ({ label: link.forward.label, target: link.reverse.on, hasOne: link.forward.has === 'one' }));
const rowsByEntity = {};
const idsByEntity = {};
for (const file of readdirSync(path.join(exportDir, 'entities'))) {
    const entity = file.replace(/\.jsonl$/, '');
    const text = readFileSync(path.join(exportDir, 'entities', file), 'utf8');
    rowsByEntity[entity] = text.split('\n').filter(Boolean).map((line) => JSON.parse(line).entity);
    idsByEntity[entity] = new Set(rowsByEntity[entity].map((row) => row.id));
}

const report = { exportDir: path.relative(root, exportDir), entities: {} };
for (const [entity, rows] of Object.entries(rowsByEntity)) {
    const declared = schema.entities[entity]?.attrs ?? null;
    const links = forwardLinks(entity);
    const linkLabels = new Set(links.map((link) => link.label));
    const attributes = {};
    for (const row of rows) {
        for (const [name, value] of Object.entries(row)) {
            if (name === 'id' || linkLabels.has(name)) continue;
            const stats = (attributes[name] ??= { present: 0, forms: {} });
            stats.present += 1;
            const form = describe(value);
            stats.forms[form] = (stats.forms[form] ?? 0) + 1;
        }
    }
    const linkStats = {};
    for (const link of links) {
        const stats = (linkStats[link.label] = { target: link.target, rowsLinked: 0, ids: 0, dangling: 0 });
        for (const row of rows) {
            const linked = link.hasOne ? (row[link.label] ? [row[link.label]] : []) : row[link.label] ?? [];
            if (linked.length) stats.rowsLinked += 1;
            stats.ids += linked.length;
            stats.dangling += linked.filter((id) => !idsByEntity[link.target]?.has(id)).length;
        }
    }
    const unique = {};
    for (const [name, definition] of Object.entries(declared ?? {})) {
        if (!definition.config?.unique) continue;
        const seen = new Map();
        for (const row of rows) if (row[name] != null) seen.set(row[name], (seen.get(row[name]) ?? 0) + 1);
        unique[name] = { distinct: seen.size, valuesUsedMoreThanOnce: [...seen.values()].filter((count) => count > 1).length };
    }
    report.entities[entity] = {
        rows: rows.length,
        bytes: statSync(path.join(exportDir, 'entities', `${entity}.jsonl`)).size,
        declaredInSchema: Boolean(declared),
        idsThatAreNotUuids: rows.filter((row) => !UUID.test(String(row.id))).length,
        attributes,
        undeclaredAttributes: declared ? Object.keys(attributes).filter((name) => !(name in declared)) : Object.keys(attributes),
        declaredButNeverStored: declared ? Object.keys(declared).filter((name) => !(name in attributes)) : [],
        links: linkStats,
        unique,
    };
}

// A relation the schema holds twice: as a link, and as a plain attribute carrying the same id.
report.duplicatedReferences = {};
for (const [entity, info] of Object.entries(report.entities)) {
    for (const link of forwardLinks(entity).filter((candidate) => candidate.hasOne)) {
        const attribute = `${link.label}Id`;
        if (!(attribute in info.attributes)) continue;
        const rows = rowsByEntity[entity];
        report.duplicatedReferences[`${entity}.${attribute} vs ${entity}.${link.label}`] = {
            agree: rows.filter((row) => row[attribute] && row[attribute] === row[link.label]).length,
            disagree: rows.filter((row) => row[attribute] && row[link.label] && row[attribute] !== row[link.label]).length,
            onlyAttribute: rows.filter((row) => row[attribute] && !row[link.label]).length,
            onlyLink: rows.filter((row) => !row[attribute] && row[link.label]).length,
        };
    }
}
const settingNames = new Map();
for (const row of rowsByEntity.settings ?? []) settingNames.set(row.name, (settingNames.get(row.name) ?? 0) + 1);
report.checks = {
    settingsNamesStoredMoreThanOnce: [...settingNames.values()].filter((count) => count > 1).length,
    unitDefinitionsWithoutIsMonetary: (rowsByEntity.unitDefinitions ?? []).filter((row) => typeof row.isMonetary !== 'boolean').length,
    familyMemberRoles: (rowsByEntity.familyMembers ?? []).reduce((roles, row) => ({ ...roles, [row.role ?? '(none)']: (roles[row.role ?? '(none)'] ?? 0) + 1 }), {}),
    familyMembersWithPin: (rowsByEntity.familyMembers ?? []).filter((row) => Boolean(row.pinHash)).length,
};
writeFileSync(path.join(exportDir, 'census.json'), JSON.stringify(report, null, 2));

// ---- The summary ----
const entities = Object.entries(report.entities).sort((a, b) => b[1].bytes - a[1].bytes);
const totalRows = entities.reduce((sum, [, info]) => sum + info.rows, 0);
const totalBytes = entities.reduce((sum, [, info]) => sum + info.bytes, 0);
const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;
console.log(`Export: ${report.exportDir}`);
console.log(`${totalRows} rows, ${mb(totalBytes)} as JSON\n`);
console.log('Largest entities');
for (const [entity, info] of entities.slice(0, 8)) console.log(`  ${entity.padEnd(26)} ${String(info.rows).padStart(6)} rows  ${mb(info.bytes).padStart(9)}`);
console.log(`\nEntities with no rows: ${entities.filter(([, info]) => info.rows === 0).map(([entity]) => entity).sort().join(', ') || 'none'}`);
console.log(`Ids that are not UUIDs: ${entities.reduce((sum, [, info]) => sum + info.idsThatAreNotUuids, 0)}`);

console.log('\nStored but not declared in instant.schema.ts');
for (const [entity, info] of entities) if (info.undeclaredAttributes.length && info.declaredInSchema) console.log(`  ${entity}: ${info.undeclaredAttributes.map((name) => `${name} (${info.attributes[name].present})`).join(', ')}`);
console.log('\nAttributes stored in more than one form');
for (const [entity, info] of entities) {
    for (const [name, stats] of Object.entries(info.attributes)) {
        const forms = Object.entries(stats.forms).filter(([form]) => form !== 'null' && form !== 'empty string');
        if (forms.length > 1) console.log(`  ${entity}.${name}: ${forms.map(([form, count]) => `${form} ×${count}`).join(' | ')}`);
    }
}
console.log('\nAttributes holding an explicit null or an empty string in some rows');
for (const [entity, info] of entities) {
    const names = Object.entries(info.attributes).filter(([, stats]) => stats.forms.null || stats.forms['empty string']).map(([name, stats]) => `${name} (null ${stats.forms.null ?? 0}, empty ${stats.forms['empty string'] ?? 0})`);
    if (names.length) console.log(`  ${entity}: ${names.join(', ')}`);
}
console.log('\nDate-typed and date-named attributes, by stored form');
for (const [entity, info] of entities) {
    for (const [name, stats] of Object.entries(info.attributes)) {
        const declaredType = schema.entities[entity]?.attrs?.[name]?.valueType;
        if (declaredType !== 'date' && !/(At|Date|Until|Timestamp)$/.test(name)) continue;
        console.log(`  ${`${entity}.${name}`.padEnd(46)} declared ${String(declaredType).padEnd(7)} ${Object.entries(stats.forms).map(([form, count]) => `${form} ×${count}`).join(' | ')}`);
    }
}
console.log('\nLinks that point at a row that is not in the export');
let dangling = 0;
for (const [entity, info] of entities) for (const [label, stats] of Object.entries(info.links)) if (stats.dangling) { dangling += stats.dangling; console.log(`  ${entity}.${label} -> ${stats.target}: ${stats.dangling} of ${stats.ids}`); }
if (!dangling) console.log('  none');
console.log('\nA reference held twice, as a link and as an attribute');
for (const [pair, stats] of Object.entries(report.duplicatedReferences)) console.log(`  ${pair.padEnd(64)} agree ${stats.agree}, disagree ${stats.disagree}, attribute only ${stats.onlyAttribute}, link only ${stats.onlyLink}`);
console.log('\nUnique attributes with a value used more than once');
let repeated = 0;
for (const [entity, info] of entities) for (const [name, stats] of Object.entries(info.unique)) if (stats.valuesUsedMoreThanOnce) { repeated += 1; console.log(`  ${entity}.${name}: ${stats.valuesUsedMoreThanOnce}`); }
if (!repeated) console.log('  none');
console.log('\nOther checks');
console.log(`  setting names stored more than once: ${report.checks.settingsNamesStoredMoreThanOnce}`);
console.log(`  unit definitions with no isMonetary: ${report.checks.unitDefinitionsWithoutIsMonetary}`);
console.log(`  family member roles: ${JSON.stringify(report.checks.familyMemberRoles)}; with a PIN: ${report.checks.familyMembersWithPin}`);
console.log(`\nFull report: ${path.join(report.exportDir, 'census.json')}`);
