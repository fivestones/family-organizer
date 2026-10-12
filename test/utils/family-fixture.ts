import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { hashPinServer } from '@/lib/server/pin';
import { SESSION_TOKEN_HEADER } from '@/lib/server/request-session';
import type { TestDatabase } from './postgres';

// An invented family for tests of the server on Postgres: a parent with a PIN, a kid with none, a kid with one,
// two chores and who they are assigned to.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const DANA = id(1); // parent, PIN 2468
export const ELI = id(2); // kid, no PIN
export const FAY = id(3); // kid, PIN 1357
export const DISHES = id(10); // everyone's, daily
export const LAUNDRY = id(11); // up for grabs
export const PINS = { [DANA]: '2468', [FAY]: '1357' } as const;

export async function seedFamily({ sql }: TestDatabase): Promise<void> {
    await sql.query(
        `INSERT INTO family_members (id, name, role, sort_order, pin_hash) VALUES
            ($1, 'Dana', 'parent', 0, $4), ($2, 'Eli', 'child', 1, NULL), ($3, 'Fay', 'child', 2, $5)`,
        [DANA, ELI, FAY, hashPinServer(PINS[DANA]), hashPinServer(PINS[FAY])]
    );
    await sql.query(
        `INSERT INTO chores (id, title, start_date, rrule, is_up_for_grabs) VALUES
            ($1, 'Dishes', '2026-01-01', 'FREQ=DAILY', false), ($2, 'Laundry', '2026-01-01', 'FREQ=DAILY', true)`,
        [DISHES, LAUNDRY]
    );
    await sql.query(
        `INSERT INTO chore_assignees (chore_id, family_member_id, position) VALUES
            ($1, $3, 0), ($1, $4, 1), ($2, $3, 0), ($2, $4, 1)`,
        [DISHES, LAUNDRY, ELI, FAY]
    );
}

const DEVICE_KEY = 'test-device-key';

/** A request from an activated device, under a session when a token is given. */
export function deviceRequest(url: string, init: { method?: string; body?: unknown; sessionToken?: string | null; activated?: boolean } = {}): NextRequest {
    process.env.DEVICE_ACCESS_KEY = DEVICE_KEY;
    const headers: Record<string, string> = {};
    if (init.activated !== false) headers.cookie = `activation_token=${createHash('sha256').update(DEVICE_KEY).digest('hex')}`;
    if (init.sessionToken) headers[SESSION_TOKEN_HEADER] = init.sessionToken;
    return new NextRequest(`http://localhost:3000${url}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers,
        body: init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : JSON.stringify(init.body),
    });
}
