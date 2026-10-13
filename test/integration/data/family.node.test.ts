import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addFamilyMember, removeFamilyMember, reorderFamilyMembers, setMemberPin, updateFamilyMember, type Principal } from '@family-organizer/data';
import { WriteRefusedError } from '@family-organizer/data/powersync/mutate';
import { OfflineError, ServerRefusedError } from '@family-organizer/data/powersync/server';
import { household, type Household } from '@/test/utils/data-area';
import { DANA, DISHES, ELI, FAY, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// Who is in the family, changed on a device and carried to the server by the real upload route.

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
const family = () => onServer(`SELECT name, role, sort_order FROM family_members ORDER BY sort_order`);

describe('adding someone', () => {
    it('puts them after everyone else, on the device at once and on the server when sent', async () => {
        const device = await home.deviceFor(parent);

        const id = await addFamilyMember({ name: '  Gus ', role: 'child', email: ' gus@example.com ', color: '#22c55e', photoUrls: { '64': 'avatars/gus-64.png' } });

        expect(await device.rows(`SELECT name, role, email, color, photo_urls, sort_order FROM family_members WHERE id = ?`, [id])).toEqual([
            { name: 'Gus', role: 'child', email: 'gus@example.com', color: '#22c55e', photo_urls: '{"64":"avatars/gus-64.png"}', sort_order: 3 },
        ]);
        expect(await home.sync(device)).toEqual([{ ok: true }]);
        expect(await onServer(`SELECT name, role, email, photo_urls, sort_order, has_pin, allowance_payout_delay_days FROM family_members WHERE id = $1`, [id])).toEqual([
            { name: 'Gus', role: 'child', email: 'gus@example.com', photo_urls: { '64': 'avatars/gus-64.png' }, sort_order: 3, has_pin: false, allowance_payout_delay_days: 0 },
        ]);
    });

    it('is a parent\'s to do, and needs a name and a role', async () => {
        await home.deviceFor(parent);
        await expect(addFamilyMember({ name: '   ', role: 'child' })).rejects.toThrow('needs a name');
        await expect(addFamilyMember({ name: 'Gus', role: 'uncle' as any })).rejects.toThrow('a parent or a child');

        const kids = await home.deviceFor(eli);
        await expect(addFamilyMember({ name: 'Gus', role: 'child' })).rejects.toBeInstanceOf(WriteRefusedError);
        expect(await kids.takeUploads()).toEqual([]);
    });
});

describe('changing someone', () => {
    it('sends only what changed, and lets a kid change their own preferences and nothing else', async () => {
        const device = await home.deviceFor(parent);
        await updateFamilyMember(ELI, { name: 'Elijah', color: '#0ea5e9', allowanceAmount: 5, allowanceCurrency: 'USD', allowanceConfig: { rounding: 'none' } });
        await updateFamilyMember(ELI, { name: 'Elijah' });

        const uploads = await device.takeUploads();
        expect(uploads.map((upload) => [upload.mutation, upload.operations])).toEqual([
            ['updateFamilyMember', [{ op: 'PATCH', table: 'family_members', id: ELI, data: { name: 'Elijah', color: '#0ea5e9', allowance_amount: 5, allowance_currency: 'USD', allowance_config: '{"rounding":"none"}' } }]],
        ]);

        const kids = await home.deviceFor(eli);
        await updateFamilyMember(ELI, { viewShowChoreDescriptions: true, messageQuietHoursStart: '21:30', lastDisplayCurrency: 'NPR' });
        await expect(updateFamilyMember(ELI, { role: 'parent' })).rejects.toMatchObject({ reason: 'column_not_allowed' });
        await expect(updateFamilyMember(FAY, { viewShowChoreDescriptions: true })).rejects.toMatchObject({ reason: 'not_yours' });
        await expect(updateFamilyMember('00000000-0000-4000-8000-000000000999', { lastDisplayCurrency: 'USD' })).rejects.toThrow('no longer exists');
        expect(await home.sync(kids)).toEqual([{ ok: true }]);
        expect(await onServer(`SELECT view_show_chore_descriptions, message_quiet_hours_start, last_display_currency, role FROM family_members WHERE id = $1`, [ELI])).toEqual([
            { view_show_chore_descriptions: true, message_quiet_hours_start: '21:30:00', last_display_currency: 'NPR', role: 'child' },
        ]);
    });

    it('puts the family in a new order', async () => {
        const device = await home.deviceFor(parent);
        await reorderFamilyMembers([FAY, DANA, FAY, 'nobody']);

        await home.sync(device);
        expect(await family()).toEqual([
            { name: 'Fay', role: 'child', sort_order: 0 },
            { name: 'Dana', role: 'parent', sort_order: 1 },
            { name: 'Eli', role: 'child', sort_order: 2 },
        ]);
        // Fay moved and so did Dana; Eli, already last, was not written at all.
        await reorderFamilyMembers([FAY, DANA, ELI]);
        expect(await device.takeUploads()).toEqual([]);
    });
});

describe('removing someone', () => {
    it('takes them and their chores\' places away, closes the gap, and leaves the rest to the server', async () => {
        const device = await home.deviceFor(parent);
        await removeFamilyMember(ELI);

        expect(await device.rows(`SELECT name, sort_order FROM family_members ORDER BY sort_order`)).toEqual([{ name: 'Dana', sort_order: 0 }, { name: 'Fay', sort_order: 1 }]);
        expect(await device.rows(`SELECT count(*) AS n FROM chore_assignees WHERE family_member_id = ?`, [ELI])).toEqual([{ n: 0 }]);
        expect(await home.sync(device)).toEqual([{ ok: true }]);
        expect(await family()).toEqual([{ name: 'Dana', role: 'parent', sort_order: 0 }, { name: 'Fay', role: 'child', sort_order: 1 }]);
        expect(await onServer(`SELECT family_member_id FROM chore_assignees WHERE chore_id = $1`, [DISHES])).toEqual([{ family_member_id: FAY }]);
        // Removing someone who has already gone is nothing.
        await removeFamilyMember(ELI);
        expect(await device.takeUploads()).toEqual([]);
    });

    it('is refused to a kid', async () => {
        await home.deviceFor(eli);
        await expect(removeFamilyMember(FAY)).rejects.toMatchObject({ reason: 'not_allowed' });
    });
});

describe('a PIN', () => {
    it('is asked of the server, after everything changed here has been sent', async () => {
        const asked: Array<{ path: string; method?: string; body?: unknown; waiting: number }> = [];
        const device = await home.deviceFor(parent, {
            server: async (path, init) => {
                asked.push({ path, ...init, waiting: (await device.rows<{ n: number }>(`SELECT count(*) AS n FROM ps_crud`))[0].n });
                return { status: 200, body: { ok: true, hasPin: true } };
            },
        });
        const id = await addFamilyMember({ name: 'Gus', role: 'child' });
        // The upload lands a moment later, as it does on a real device.
        const sent = new Promise((resolve) => setTimeout(resolve, 150)).then(() => home.sync(device));

        await setMemberPin(id, '4321');
        await sent;

        expect(asked).toEqual([{ path: '/api/auth/pin', method: 'PUT', body: { familyMemberId: id, pin: '4321' }, waiting: 0 }]);
    });

    it('says so when there is no connection, and when the server will not', async () => {
        await home.deviceFor(parent);
        await expect(setMemberPin(ELI, '4321')).rejects.toBeInstanceOf(OfflineError);

        await home.deviceFor(eli, { server: () => ({ status: 403, body: { error: 'Parent access required', code: 'parent_required' } }) });
        const refused = await setMemberPin(ELI, '4321').catch((error) => error);
        expect(refused).toBeInstanceOf(ServerRefusedError);
        expect(refused).toMatchObject({ message: 'Parent access required', status: 403, code: 'parent_required' });
    });
});
