import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Principal } from '@family-organizer/data';
import { createPowerSyncChoresBackend, readChoreDay, toChoreDay } from '@family-organizer/data/powersync/chores';
import { toFamilyMember } from '@family-organizer/data/powersync/family';
import { WriteRefusedError } from '@family-organizer/data/powersync/mutate';
import type { ClientDatabase } from '@family-organizer/data/powersync/schema';
import { createPowerSyncSettingsBackend } from '@family-organizer/data/powersync/settings';
import { createPowerSyncUnitsBackend } from '@family-organizer/data/powersync/units';
import { createSession } from '@/lib/server/sessions';
import { applyUpload, type UploadOutcome } from '@/lib/server/upload';
import { openTestDevice, type TestDevice } from '@/test/utils/device';
import { DANA, DISHES, ELI, FAY, LAUNDRY, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// The data layer on a device, and what the server makes of what it uploads. Each device here is PowerSync's own
// SQLite, never connected: a test hands it what sync would have delivered, runs the real mutations, and carries
// what they queue to the real upload route on a real Postgres.

const DAY = '2026-03-09';
const NOON = '2026-03-09T12:00:00.000Z';
const ONE = '2026-03-09T13:00:00.000Z';
const parent: Principal = { type: 'parent', familyMemberId: DANA };
const eli: Principal = { type: 'kid', familyMemberId: ELI };
const fay: Principal = { type: 'kid', familyMemberId: FAY };

let server: TestDatabase;
const devices: TestDevice[] = [];
beforeEach(async () => {
    server = await createTestDatabase();
    await seedFamily(server);
});
afterEach(async () => {
    await Promise.all(devices.splice(0).map((device) => device.close()));
    await server.close();
});

/** A device signed in as someone, holding what the family stream would have sent it. */
async function deviceFor(principal: Principal, now = NOON): Promise<TestDevice> {
    const device = await openTestDevice(principal, { now });
    devices.push(device);
    await device.receive('family_members', [
        { id: DANA, name: 'Dana', role: 'parent', sort_order: 0, has_pin: 1, message_quiet_hours_start: '21:30:00.000', view_show_task_details: 1 },
        { id: ELI, name: 'Eli', role: 'child', sort_order: 1, has_pin: 0 },
        { id: FAY, name: 'Fay', role: 'child', sort_order: 2, has_pin: 1 },
    ]);
    await device.receive('chores', [
        { id: DISHES, title: 'Dishes', start_date: '2026-01-01', rrule: 'FREQ=DAILY', exdates: '["2026-03-01"]', is_up_for_grabs: 0, is_joint: 1, sort_order: 1, timing_mode: 'after_marker', timing_marker_key: 'dinner', timing_event: 'completed', timing_fallback_time: '18:30:00.000', created_at: '2026-01-01T00:00:00.000Z' },
        { id: LAUNDRY, title: 'Laundry', start_date: '2026-01-01', rrule: 'FREQ=DAILY', exdates: '[]', is_up_for_grabs: 1, is_joint: 0, sort_order: 2, timing_mode: 'anytime', created_at: '2026-01-01T00:00:00.000Z' },
    ]);
    await device.receive('chore_assignees', [
        { id: `${DISHES}.${FAY}`, chore_id: DISHES, family_member_id: FAY, position: 0 },
        { id: `${DISHES}.${ELI}`, chore_id: DISHES, family_member_id: ELI, position: 1 },
        { id: `${LAUNDRY}.${ELI}`, chore_id: LAUNDRY, family_member_id: ELI, position: 0 },
    ]);
    return device;
}

/** Sends everything a device has queued to the upload route, as that device's person, and returns the answers. */
async function upload(device: TestDevice) {
    const { session } = await createSession(server.db, device.device.principal);
    const outcomes: UploadOutcome[] = [];
    for (const body of await device.takeUploads()) outcomes.push((await applyUpload(server.db, session, body)).outcome);
    return outcomes;
}

const onServer = async <Row = Record<string, any>>(text: string, params: unknown[] = []) => (await server.sql.query<Row>(text, params as any[])).rows;
const chores = (device: TestDevice) => createPowerSyncChoresBackend(device.device);

describe('completing a chore', () => {
    it('is saved on the device at once, with its history entry, as one transaction to send', async () => {
        const device = await deviceFor(eli);

        const result = await chores(device).completeChore({ choreId: DISHES, memberId: ELI, day: DAY });

        expect(result.status).toBe('completed');
        expect(await device.rows(`SELECT chore_id, completed_by, marked_by, date_due, completed_at, not_done, allowance_awarded FROM chore_completions`)).toEqual([
            { chore_id: DISHES, completed_by: ELI, marked_by: null, date_due: DAY, completed_at: NOON, not_done: 0, allowance_awarded: 0 },
        ]);
        expect(await device.rows(`SELECT action_type, summary, actor_id, chore_id, scheduled_for, metadata FROM history_events`)).toEqual([
            { action_type: 'chore_marked_done', summary: 'Completed "Dishes"', actor_id: ELI, chore_id: DISHES, scheduled_for: DAY, metadata: JSON.stringify({ choreTitle: 'Dishes', completed: true, dateDue: DAY }) },
        ]);
        const [transaction, ...others] = await device.takeUploads();
        expect(others).toEqual([]);
        expect(transaction.mutation).toBe('completeChore');
        expect(transaction.uploadId).toMatch(/^[0-9a-f-]{36}$/);
        expect(transaction.operations.map((operation) => `${operation.op} ${operation.table}`)).toEqual(['PUT chore_completions', 'PUT history_events', 'PUT history_event_members']);
    });

    it('is accepted by the server as the kid\'s own', async () => {
        const device = await deviceFor(eli);
        await chores(device).completeChore({ choreId: DISHES, memberId: ELI, day: DAY });

        expect(await upload(device)).toEqual([{ ok: true }]);
        expect(await onServer(`SELECT completed_by, marked_by, date_due, completed_at FROM chore_completions`)).toEqual([{ completed_by: ELI, marked_by: null, date_due: DAY, completed_at: NOON }]);
        expect(await onServer(`SELECT e.actor_id, m.family_member_id FROM history_events e JOIN history_event_members m ON m.history_event_id = e.id`)).toEqual([{ actor_id: ELI, family_member_id: ELI }]);
    });

    it('does nothing when it is already done', async () => {
        const device = await deviceFor(eli);
        await chores(device).completeChore({ choreId: DISHES, memberId: ELI, day: DAY });
        await device.takeUploads();

        expect(await chores(device).completeChore({ choreId: DISHES, memberId: ELI, day: DAY })).toEqual({ status: 'unchanged' });
        expect(await device.takeUploads()).toEqual([]);
    });

    it('records who pressed the button when a parent ticks a kid\'s chore', async () => {
        const device = await deviceFor(parent);
        await chores(device).completeChore({ choreId: DISHES, memberId: ELI, day: DAY, markedBy: DANA });

        expect(await upload(device)).toEqual([{ ok: true }]);
        expect(await onServer(`SELECT completed_by, marked_by FROM chore_completions`)).toEqual([{ completed_by: ELI, marked_by: DANA }]);
        expect(await onServer(`SELECT actor_id FROM history_events`)).toEqual([{ actor_id: DANA }]);
    });

    it('is refused on the device, at once, when a kid tries it for someone else', async () => {
        const device = await deviceFor(eli);

        await expect(chores(device).completeChore({ choreId: DISHES, memberId: FAY, day: DAY, markedBy: ELI })).rejects.toMatchObject({ name: 'WriteRefusedError', reason: 'not_yours' });
        expect(await device.rows(`SELECT 1 FROM chore_completions`)).toEqual([]);
        expect(await device.rows(`SELECT 1 FROM history_events`)).toEqual([]);
        expect(await device.takeUploads()).toEqual([]);
    });

    it('is refused for the shared kid session, which is nobody', async () => {
        const device = await deviceFor({ type: 'kid', familyMemberId: null });
        await expect(chores(device).completeChore({ choreId: DISHES, memberId: ELI, day: DAY })).rejects.toBeInstanceOf(WriteRefusedError);
    });
});

describe('un-ticking a chore', () => {
    it('clears it, writes history, and sends only what changed', async () => {
        const device = await deviceFor(eli);
        const done = await chores(device).completeChore({ choreId: DISHES, memberId: ELI, day: DAY });
        await upload(device);
        device.setNow(ONE);

        const result = await chores(device).reopenChore({ choreId: DISHES, memberId: ELI, day: DAY });

        expect(result).toEqual({ status: 'reopened', completionId: (done as { completionId: string }).completionId });
        const [transaction] = await device.takeUploads();
        expect(transaction.mutation).toBe('reopenChore');
        expect(transaction.operations[0]).toMatchObject({ op: 'PATCH', table: 'chore_completions', data: { completed_at: null } });
        expect(Object.keys(transaction.operations[0].data ?? {})).toEqual(['completed_at']);
        const { session } = await createSession(server.db, eli);
        expect((await applyUpload(server.db, session, transaction)).outcome).toEqual({ ok: true });
        expect(await onServer(`SELECT completed_at FROM chore_completions`)).toEqual([{ completed_at: null }]);
        expect((await onServer(`SELECT action_type FROM history_events ORDER BY occurred_at`)).map((row) => row.action_type)).toEqual(['chore_marked_done', 'chore_marked_undone']);
    });

    it('does nothing to a chore that was not done', async () => {
        const device = await deviceFor(eli);
        expect(await chores(device).reopenChore({ choreId: DISHES, memberId: ELI, day: DAY })).toEqual({ status: 'unchanged' });
        expect(await device.takeUploads()).toEqual([]);
    });
});

describe('a chore that is up for grabs', () => {
    it('says who has it when the device already knows someone has done it', async () => {
        const first = await deviceFor(eli);
        const { completionId } = (await chores(first).completeChore({ choreId: LAUNDRY, memberId: ELI, day: DAY })) as { completionId: string };
        const second = await deviceFor(fay);
        await second.receive('chore_completions', [{ id: completionId, chore_id: LAUNDRY, completed_by: ELI, date_due: DAY, completed_at: NOON, not_done: 0, allowance_awarded: 0 }]);

        expect(await chores(second).completeChore({ choreId: LAUNDRY, memberId: FAY, day: DAY })).toEqual({ status: 'claimed', claimedBy: ELI });
        expect(await second.takeUploads()).toEqual([]);
    });

    it('goes to whoever reaches the server first when two claim it without knowing of each other', async () => {
        const eliDevice = await deviceFor(eli);
        const fayDevice = await deviceFor(fay, ONE);
        const eliClaim = await chores(eliDevice).completeChore({ choreId: LAUNDRY, memberId: ELI, day: DAY });
        const fayClaim = await chores(fayDevice).completeChore({ choreId: LAUNDRY, memberId: FAY, day: DAY });
        // Each device believes it has it, and both worked out the same id for it.
        expect([eliClaim.status, fayClaim.status]).toEqual(['completed', 'completed']);
        expect((eliClaim as { completionId: string }).completionId).toBe((fayClaim as { completionId: string }).completionId);

        expect(await upload(eliDevice)).toEqual([{ ok: true }]);
        expect(await upload(fayDevice)).toEqual([{ ok: false, reason: 'already_claimed', table: 'chore_completions', rowId: (fayClaim as { completionId: string }).completionId }]);

        expect(await onServer(`SELECT completed_by FROM chore_completions`)).toEqual([{ completed_by: ELI }]);
        expect(await onServer(`SELECT family_member_id, mutation, reason FROM write_refusals`)).toEqual([{ family_member_id: FAY, mutation: 'completeChore', reason: 'already_claimed' }]);
    });

    it('can be taken by someone else once it has been un-ticked', async () => {
        const eliDevice = await deviceFor(eli);
        const { completionId } = (await chores(eliDevice).completeChore({ choreId: LAUNDRY, memberId: ELI, day: DAY })) as { completionId: string };
        await chores(eliDevice).reopenChore({ choreId: LAUNDRY, memberId: ELI, day: DAY });
        await upload(eliDevice);
        const fayDevice = await deviceFor(fay, ONE);
        await fayDevice.receive('chore_completions', [{ id: completionId, chore_id: LAUNDRY, completed_by: ELI, date_due: DAY, completed_at: null, not_done: 0, allowance_awarded: 0 }]);

        expect(await chores(fayDevice).completeChore({ choreId: LAUNDRY, memberId: FAY, day: DAY })).toEqual({ status: 'completed', completionId });
        expect(await upload(fayDevice)).toEqual([{ ok: true }]);
        expect(await onServer(`SELECT id, completed_by, completed_at FROM chore_completions`)).toEqual([{ id: completionId, completed_by: FAY, completed_at: ONE }]);
    });
});

describe('reading a day\'s chores', () => {
    it('gives every chore in order, with its assignees in theirs and its timing in one shape', async () => {
        const device = await deviceFor(eli);
        await chores(device).completeChore({ choreId: DISHES, memberId: ELI, day: DAY });

        const day = toChoreDay(DAY, await readChoreDay(device.device.db, DAY));

        expect(day.chores.map((chore) => chore.title)).toEqual(['Dishes', 'Laundry']);
        expect(day.chores[0]).toMatchObject({
            id: DISHES, startDate: '2026-01-01', rrule: 'FREQ=DAILY', exdates: ['2026-03-01'], isJoint: true, isUpForGrabs: false,
            assigneeIds: [FAY, ELI],
            timing: { mode: 'after_marker', markerKey: 'dinner', event: 'completed', fallbackTime: '18:30' },
        });
        expect(day.chores[1]).toMatchObject({ isUpForGrabs: true, exdates: [], timing: { mode: 'anytime' }, assigneeIds: [ELI] });
        expect(day.completions).toMatchObject([{ choreId: DISHES, completedBy: ELI, dateDue: DAY, completedAt: NOON, notDone: false, allowanceAwarded: false }]);
    });

    it('gives only the completions of the day asked for', async () => {
        const device = await deviceFor(eli);
        await chores(device).completeChore({ choreId: DISHES, memberId: ELI, day: DAY });
        expect(toChoreDay('2026-03-10', await readChoreDay(device.device.db, '2026-03-10')).completions).toEqual([]);
    });
});

describe('the family roster on a device', () => {
    it('reads each member in the app\'s own form', async () => {
        const device = await deviceFor(eli);
        const rows = await device.rows<ClientDatabase['family_members']>(`SELECT * FROM family_members ORDER BY sort_order`);
        const [dana, eliRow] = rows.map(toFamilyMember);

        expect(dana).toMatchObject({ id: DANA, name: 'Dana', role: 'parent', sortOrder: 0, hasPin: true, messageQuietHoursStart: '21:30', viewShowTaskDetails: true, allowancePayoutDelayDays: 0 });
        expect(eliRow).toMatchObject({ role: 'child', hasPin: false, viewShowTaskDetails: null, photoUrls: null });
        expect(Object.keys(dana)).not.toContain('pinHash');
    });
});

describe('settings on a device', () => {
    it('are saved, changed and cleared by a parent, and reach the server as JSON', async () => {
        const device = await deviceFor(parent);
        const settings = createPowerSyncSettingsBackend(device.device);

        await settings.saveStoredSetting('dashboardTheme', 'dark');
        await settings.saveStoredSetting('enabledCurrencies', ['USD', 'STARS']);
        expect(await device.rows(`SELECT id, value FROM settings ORDER BY id`)).toEqual([{ id: 'dashboardTheme', value: '"dark"' }, { id: 'enabledCurrencies', value: '["USD","STARS"]' }]);
        expect(await upload(device)).toEqual([{ ok: true }, { ok: true }]);
        expect(await onServer(`SELECT name, value FROM settings ORDER BY name`)).toEqual([{ name: 'dashboardTheme', value: 'dark' }, { name: 'enabledCurrencies', value: ['USD', 'STARS'] }]);

        await settings.saveStoredSetting('dashboardTheme', 'light');
        await settings.deleteStoredSetting('enabledCurrencies');
        const sent = await device.takeUploads();
        expect(sent.map((transaction) => [transaction.mutation, transaction.operations[0].op])).toEqual([['saveSetting', 'PATCH'], ['clearSetting', 'DELETE']]);
    });

    it('send nothing when saved as they already are, or cleared when not set', async () => {
        const device = await deviceFor(parent);
        const settings = createPowerSyncSettingsBackend(device.device);
        await settings.saveStoredSetting('dashboardTheme', 'dark');
        await device.takeUploads();

        await settings.saveStoredSetting('dashboardTheme', 'dark');
        await settings.deleteStoredSetting('neverSet');
        expect(await device.takeUploads()).toEqual([]);
    });

    it('cannot be changed by a kid, who is told on the spot', async () => {
        const device = await deviceFor(eli);
        const settings = createPowerSyncSettingsBackend(device.device);
        await expect(settings.saveStoredSetting('dashboardTheme', 'dark')).rejects.toMatchObject({ reason: 'not_allowed' });
        expect(await device.rows(`SELECT 1 FROM settings`)).toEqual([]);
    });
});

describe('units on a device', () => {
    const stars = { code: 'STARS', name: 'Stars', symbol: '★', isMonetary: false, symbolPlacement: 'after' as const, symbolSpacing: true, decimalPlaces: 0 };

    it('are defined by a parent, once per code', async () => {
        const device = await deviceFor(parent);
        const units = createPowerSyncUnitsBackend(device.device);

        const unitId = await units.defineUnit(stars);
        await expect(units.defineUnit({ ...stars, name: 'More stars' })).rejects.toThrow(/already exists/);

        expect(await upload(device)).toEqual([{ ok: true }]);
        expect(await onServer(`SELECT id, code, is_monetary, symbol_placement, symbol_spacing, decimal_places FROM unit_definitions`)).toEqual([
            { id: unitId, code: 'STARS', is_monetary: false, symbol_placement: 'after', symbol_spacing: true, decimal_places: 0 },
        ]);
    });

    it('cannot be defined by a kid', async () => {
        const device = await deviceFor(eli);
        await expect(createPowerSyncUnitsBackend(device.device).defineUnit(stars)).rejects.toMatchObject({ reason: 'not_allowed' });
    });
});
