import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { POLICY } from '@family-organizer/data/policy';
import { AppSchema, TRANSACTION_TABLE } from '@family-organizer/data/powersync/schema';

// The device's schema is written by hand, and what a device is sent is decided in powersync/sync-config.yaml.
// A column in one and not the other is a value that never arrives, or one that arrives and is thrown away.

const config = parse(readFileSync(path.join(process.cwd(), 'powersync/sync-config.yaml'), 'utf8'));
const queries: string[] = Object.values<{ query?: string; queries?: string[] }>(config.streams).flatMap((stream) => [...(stream.queries ?? []), ...(stream.query ? [stream.query] : [])]);

/** The columns each stream query sends, by table, less the id every synced row has. */
const sent = new Map<string, Set<string>>();
for (const query of queries) {
    const match = /^SELECT\s+([\s\S]+?)\s+FROM\s+([a-z_]+)/i.exec(query.trim());
    if (!match) throw new Error(`Could not read the stream query: ${query}`);
    const columns = match[1].split(',').map((part) => part.trim().split(/\s+AS\s+/i).pop()!.trim());
    const table = sent.get(match[2]) ?? new Set<string>();
    for (const name of columns) if (name !== 'id') table.add(name);
    sent.set(match[2], table);
}

const deviceTables = new Map(AppSchema.tables.map((table) => [table.name, table]));

describe('the device schema', () => {
    it('has a table for each one a stream sends, and one more that names transactions', () => {
        expect(Array.from(deviceTables.keys()).sort()).toEqual([...Array.from(sent.keys()), TRANSACTION_TABLE].sort());
    });

    it.each(Array.from(sent.keys()))('holds exactly the columns sent for %s', (table) => {
        expect(deviceTables.get(table)!.columns.map((column) => column.name).sort()).toEqual(Array.from(sent.get(table)!).sort());
    });

    it('can hold every column a device may write', () => {
        for (const [table, policy] of Object.entries(POLICY)) {
            const held = new Set(['id', ...deviceTables.get(table)!.columns.map((column) => column.name)]);
            // A key column that is not `id` reaches the device as its id: a setting's name.
            const writable = Object.keys(policy.columns).filter((column) => !(policy.key.length === 1 && policy.key[0] === column));
            expect(writable.filter((column) => !held.has(column))).toEqual([]);
        }
    });

    it('keeps nothing of the table that names transactions', () => {
        expect(deviceTables.get(TRANSACTION_TABLE)!.insertOnly).toBe(true);
    });
});
