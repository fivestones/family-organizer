import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DATABASE_COLUMNS } from '@/db/types';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// db/types.ts is what the server's queries are typed against, and it is written by hand. This holds it to the
// schema the migrations actually produce, so a column added in SQL and forgotten in the types, or the other way
// about, fails here.

let database: TestDatabase;
beforeAll(async () => {
    database = await createTestDatabase();
});
afterAll(() => database.close());

describe('the database types', () => {
    it('name exactly the tables the migrations create', async () => {
        const { rows } = await database.sql.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`);
        expect(Object.keys(DATABASE_COLUMNS).sort()).toEqual(rows.map((row) => row.table_name).sort());
    });

    it.each(Object.entries(DATABASE_COLUMNS))('name exactly the columns of %s', async (table, columns) => {
        const { rows } = await database.sql.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]);
        expect(Object.keys(columns).sort()).toEqual(rows.map((row) => row.column_name).sort());
    });

    it('read a day as a day, an instant as an ISO string and a count as a number', async () => {
        const { rows } = await database.sql.query<Record<string, unknown>>(
            `SELECT DATE '2026-03-09' AS day, ARRAY[DATE '2026-03-09', DATE '2026-03-10'] AS days, '{}'::date[] AS none,
                    TIMESTAMPTZ '2026-03-09 05:06:07.089+00' AS instant, TIMESTAMPTZ '2026-03-09 10:51:07+05:45' AS elsewhere, 42::bigint AS count`
        );
        expect(rows[0]).toEqual({
            day: '2026-03-09',
            days: ['2026-03-09', '2026-03-10'],
            none: [],
            instant: '2026-03-09T05:06:07.089Z',
            elsewhere: '2026-03-09T05:06:07.000Z',
            count: 42,
        });
    });
});
