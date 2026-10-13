import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addChore, removeChore, reorderChores, setChoresTiming, updateChore, type Principal } from '@family-organizer/data';
import { readChores, toChores } from '@family-organizer/data/powersync/chores';
import { household, type Household } from '@/test/utils/data-area';
import { DANA, DISHES, ELI, FAY, LAUNDRY, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// The family's chores, made and changed on a device and carried to the server by the real upload route.

const parent: Principal = { type: 'parent', familyMemberId: DANA };
const eli: Principal = { type: 'kid', familyMemberId: ELI };

let server: TestDatabase;
let home: Household;
beforeEach(async () => {
    server = await createTestDatabase();
    await seedFamily(server);
    home = household(() => server);
});
afterEach(async () => {
    await home.close();
    await server.close();
});

const onServer = async <Row = Record<string, any>>(text: string, params: unknown[] = []) => (await server.sql.query<Row>(text, params as any[])).rows;
const assigneesOf = (choreId: string) => onServer(`SELECT family_member_id, position FROM chore_assignees WHERE chore_id = $1 ORDER BY position`, [choreId]);

describe('a chore', () => {
    it('is added after the others, with who it is for and when in the day it is due', async () => {
        const device = await home.deviceFor(parent);

        const id = await addChore({
            title: '  Feed the cat ',
            startDate: '2026-03-09',
            rrule: 'RRULE:FREQ=DAILY',
            isUpForGrabs: true,
            rewardType: 'fixed',
            rewardAmount: 0.5,
            rewardCurrency: 'USD',
            timing: { mode: 'before_marker', markerKey: 'breakfast', event: 'started', fallbackTime: '07:30' },
            assigneeIds: [FAY, ELI, FAY],
        });

        const read = toChores(await readChores(device.device.db)).find((chore) => chore.id === id)!;
        expect(read).toMatchObject({ title: 'Feed the cat', rrule: 'FREQ=DAILY', isUpForGrabs: true, rewardAmount: 0.5, sortOrder: 1, assigneeIds: [FAY, ELI], timing: { mode: 'before_marker', markerKey: 'breakfast', event: 'started', fallbackTime: '07:30' } });
        expect(await home.sync(device)).toEqual([{ ok: true }]);
        expect(await onServer(`SELECT title, start_date, rrule, is_up_for_grabs, reward_type, timing_mode, timing_marker_key, timing_event, timing_fallback_time, sort_order FROM chores WHERE id = $1`, [id])).toEqual([
            { title: 'Feed the cat', start_date: '2026-03-09', rrule: 'FREQ=DAILY', is_up_for_grabs: true, reward_type: 'fixed', timing_mode: 'before_marker', timing_marker_key: 'breakfast', timing_event: 'started', timing_fallback_time: '07:30:00', sort_order: 1 },
        ]);
        expect(await assigneesOf(id)).toEqual([{ family_member_id: FAY, position: 0 }, { family_member_id: ELI, position: 1 }]);
    });

    it('is changed by sending only what changed, and a new timing clears what the old one used', async () => {
        const device = await home.deviceFor(parent);
        await updateChore(DISHES, { timing: { mode: 'between_times', startTime: '17:00', endTime: '19:00' }, title: 'Dishes' });
        await home.sync(device);
        await updateChore(DISHES, { title: 'Evening dishes', timing: { mode: 'named_window', windowKey: 'evening' }, assigneeIds: [FAY, DANA] });

        const [upload] = await device.takeUploads();
        expect(upload.operations).toEqual([
            { op: 'PATCH', table: 'chores', id: DISHES, data: { title: 'Evening dishes', timing_mode: 'named_window', timing_window_key: 'evening', timing_start_time: null, timing_end_time: null } },
            { op: 'DELETE', table: 'chore_assignees', id: `${DISHES}.${ELI}`, data: null },
            { op: 'PATCH', table: 'chore_assignees', id: `${DISHES}.${FAY}`, data: { position: 0 } },
            { op: 'PUT', table: 'chore_assignees', id: `${DISHES}.${DANA}`, data: { chore_id: DISHES, family_member_id: DANA, position: 1 } },
        ]);
        await expect(updateChore('00000000-0000-4000-8000-000000000999', { title: 'Nothing' })).rejects.toThrow('no longer exists');
        await expect(updateChore(DISHES, { title: '  ' })).rejects.toThrow('needs a title');
    });

    it('takes a window\'s chores to any time at once, is reordered, and is removed with its assignments', async () => {
        const device = await home.deviceFor(parent);
        await updateChore(DISHES, { timing: { mode: 'named_window', windowKey: 'evening' } });
        await updateChore(LAUNDRY, { timing: { mode: 'named_window', windowKey: 'evening' } });

        await setChoresTiming([DISHES, LAUNDRY], { mode: 'anytime' });
        await reorderChores([LAUNDRY, DISHES]);
        await removeChore(DISHES);

        expect(await home.sync(device)).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: true }]);
        expect(await onServer(`SELECT title, timing_mode, timing_window_key, sort_order FROM chores ORDER BY sort_order`)).toEqual([{ title: 'Laundry', timing_mode: 'anytime', timing_window_key: null, sort_order: 0 }]);
        expect(await onServer(`SELECT count(*)::integer AS n FROM chore_assignees WHERE chore_id = $1`, [DISHES])).toEqual([{ n: 0 }]);
    });

    it('is a parent\'s to make, change and remove', async () => {
        const device = await home.deviceFor(eli);
        await expect(addChore({ title: 'Nap', startDate: '2026-03-09' })).rejects.toMatchObject({ reason: 'not_allowed' });
        await expect(updateChore(DISHES, { title: 'Nothing' })).rejects.toMatchObject({ reason: 'not_allowed' });
        await expect(removeChore(DISHES)).rejects.toMatchObject({ reason: 'not_allowed' });
        expect(await device.takeUploads()).toEqual([]);
    });
});
