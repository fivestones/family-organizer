import type { Principal } from '@family-organizer/data';
import { setCurrentDevice } from '@family-organizer/data/powersync/current';
import { AppSchema } from '@family-organizer/data/powersync/schema';
import { createSession } from '@/lib/server/sessions';
import { applyUpload, type UploadOutcome } from '@/lib/server/upload';
import { openTestDevice, type TestDevice, type TestServer } from './device';
import type { TestDatabase } from './postgres';

// For tests of an area of the data layer written on PowerSync: a real Postgres as the server, real local
// databases as devices, and a hand-cranked sync between them. A test changes something on a device with the real
// mutation, sends what it queued to the real upload route, and delivers what the server then holds.

/** The columns that make a row's id on a device, where that is not a column called `id`. */
const KEY: Record<string, readonly string[]> = {
    settings: ['name'],
    dashboard_configs: ['family_member_id'],
    chore_assignees: ['chore_id', 'family_member_id'],
    routine_marker_statuses: ['marker_key', 'date'],
    history_event_members: ['history_event_id', 'family_member_id'],
    envelope_balances: ['envelope_id', 'currency'],
    exchange_rates: ['base_currency', 'target_currency'],
    message_thread_members: ['thread_id', 'family_member_id'],
    message_reactions: ['message_id', 'family_member_id', 'emoji'],
    message_acknowledgements: ['message_id', 'family_member_id', 'kind'],
    calendar_item_members: ['calendar_item_id', 'family_member_id'],
    calendar_item_tags: ['calendar_item_id', 'tag_id'],
};

const deviceValue = (value: unknown): unknown => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'object') return JSON.stringify(value);
    return value;
};

/** Puts on a device what the server holds in these tables, as sync would: every row, in the device's form. */
export async function deliver(server: TestDatabase, device: TestDevice, tables: readonly string[] = AppSchema.tables.map((table) => table.name)): Promise<void> {
    for (const name of tables) {
        const table = AppSchema.tables.find((candidate) => candidate.name === name);
        if (!table || name === 'local_transactions') continue;
        const columns = table.columns.map((column) => column.name);
        const key = KEY[name] ?? ['id'];
        const held = (await server.sql.query<Record<string, unknown>>(`SELECT * FROM ${name}`)).rows;
        await device.device.db.execute(`DELETE FROM ${name}`);
        await device.receive(
            name,
            held.map((row) => ({ id: key.map((column) => String(row[column])).join('.'), ...Object.fromEntries(columns.filter((column) => column in row).map((column) => [column, deviceValue(row[column])])) }))
        );
    }
}

export interface Household {
    /** Opens a device signed in as someone, holding everything the server holds, and makes it the one mutations act on. */
    deviceFor(principal: Principal, options?: { now?: string; server?: TestServer }): Promise<TestDevice>;
    /** Makes a device the one hooks and mutations act on, as the app's frame does when the person changes. */
    use(device: TestDevice): void;
    /** Sends everything a device has queued to the upload route as that device's person, then delivers what the server holds. */
    sync(device: TestDevice): Promise<UploadOutcome[]>;
    close(): Promise<void>;
}

export function household(server: () => TestDatabase): Household {
    const devices: TestDevice[] = [];
    return {
        async deviceFor(principal, options = {}) {
            const device = await openTestDevice(principal, options);
            devices.push(device);
            await deliver(server(), device);
            setCurrentDevice(device.device);
            return device;
        },
        use(device) {
            setCurrentDevice(device.device);
        },
        async sync(device) {
            const { session } = await createSession(server().db, device.device.principal);
            const outcomes: UploadOutcome[] = [];
            for (const body of await device.takeUploads()) outcomes.push((await applyUpload(server().db, session, body)).outcome);
            await deliver(server(), device);
            return outcomes;
        },
        async close() {
            setCurrentDevice(null);
            await Promise.all(devices.splice(0).map((device) => device.close()));
        },
    };
}
