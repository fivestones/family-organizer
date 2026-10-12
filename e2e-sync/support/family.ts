import { randomBytes, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// The invented family the browser tests run against, put straight into the test stack's Postgres.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const DANA = id(1); // parent, PIN 2468
export const ELI = id(2); // kid, no PIN
export const FAY = id(3); // kid, PIN 1357
export const DISHES = id(10);
export const LAUNDRY = id(11); // up for grabs
export const DEVICE_KEY = 'sync-e2e-device-key';

const databaseUrl = /^DATABASE_URL=(.+)$/m.exec(readFileSync(path.join(process.cwd(), '.migration', 'sync-test', 'env'), 'utf8'))![1];

/** A PIN hashed as the server hashes one. */
function hashPin(pin: string): string {
    const salt = randomBytes(16);
    const key = scryptSync(pin, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    return `scrypt$v1$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function query<Row extends pg.QueryResultRow = Record<string, any>>(text: string, values: unknown[] = []): Promise<Row[]> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        return (await client.query<Row>(text, values)).rows;
    } finally {
        await client.end();
    }
}

/** Puts the family back as it starts, and the deployment on PowerSync. */
export async function resetFamily(): Promise<void> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        for (const table of ['write_refusals', 'sync_uploads', 'auth_sessions', 'history_event_members', 'history_events', 'chore_completions', 'chore_assignees', 'chores', 'family_members', 'unit_definitions', 'settings']) {
            await client.query(`DELETE FROM ${table}`);
        }
        await client.query(`UPDATE installation SET backend = 'powersync', writes_frozen = false`);
        await client.query(
            `INSERT INTO family_members (id, name, role, sort_order, color, pin_hash) VALUES
                ($1, 'Dana', 'parent', 0, '#0f766e', $4), ($2, 'Eli', 'child', 1, '#2563eb', NULL), ($3, 'Fay', 'child', 2, '#c026d3', $5)`,
            [DANA, ELI, FAY, hashPin('2468'), hashPin('1357')]
        );
        await client.query(
            `INSERT INTO chores (id, title, start_date, rrule, is_up_for_grabs, is_joint, sort_order) VALUES
                ($1, 'Dishes', '2026-01-01', 'FREQ=DAILY', false, true, 1), ($2, 'Laundry', '2026-01-01', 'FREQ=DAILY', true, false, 2)`,
            [DISHES, LAUNDRY]
        );
        await client.query(
            `INSERT INTO chore_assignees (chore_id, family_member_id, position) VALUES ($1, $3, 0), ($1, $4, 1), ($2, $3, 0), ($2, $4, 1)`,
            [DISHES, LAUNDRY, ELI, FAY]
        );
    } finally {
        await client.end();
    }
}
