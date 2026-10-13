import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureFirstEnvelope, findExchangeRate, requestFinance, setDefaultEnvelope, updateEnvelope, type Envelope, type Principal } from '@family-organizer/data';
import { readEnvelopes, readLedger, toEnvelopes } from '@family-organizer/data/finance/reads';
import { OfflineError, ServerRefusedError } from '@family-organizer/data/powersync/server';
import type { TestDevice } from '@/test/utils/device';
import { household, type Household } from '@/test/utils/data-area';
import { DANA, ELI, FAY, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// Money on a device: read from its own database, changed by asking the real finance route, and seen again when
// what the server wrote has been delivered.

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
const envelopesOn = async (device: TestDevice, memberId?: string): Promise<Envelope[]> => toEnvelopes(await readEnvelopes(device.device.db, memberId));

describe('a member\'s envelopes', () => {
    it('are made by the server and arrive on the device with what they hold and which is the default', async () => {
        const device = await home.deviceFor(parent, { online: true });
        const savings = await ensureFirstEnvelope(ELI);
        const spending = await requestFinance<string>({ operation: 'create-envelope', familyMemberId: ELI, name: 'Spending', isDefault: false, goalAmount: 20, goalCurrency: 'USD' });
        await requestFinance({ operation: 'deposit', envelopeId: savings, amount: 12.5, currency: 'USD' });
        await requestFinance({ operation: 'deposit', envelopeId: savings, amount: 3, currency: 'STARS' });
        await requestFinance({ operation: 'transfer', sourceEnvelopeId: savings, destinationEnvelopeId: spending, amount: 2.5, currency: 'USD' });

        // Nothing is on the device until it is delivered: the device wrote none of it.
        expect(await envelopesOn(device, ELI)).toEqual([]);
        await home.sync(device);

        expect(await envelopesOn(device, ELI)).toEqual([
            { id: savings, familyMemberId: ELI, name: 'Savings', description: null, goalAmount: null, goalCurrency: null, balances: { STARS: 3, USD: 10 }, isDefault: true },
            { id: spending, familyMemberId: ELI, name: 'Spending', description: null, goalAmount: 20, goalCurrency: 'USD', balances: { USD: 2.5 }, isDefault: false },
        ]);
        expect(await envelopesOn(device, FAY)).toEqual([]);
        expect((await envelopesOn(device)).map((envelope) => envelope.name)).toEqual(['Savings', 'Spending']);
        const ledger = await readLedger(device.device.db, { envelopeIds: [spending] });
        expect(ledger.map((entry) => [entry.transaction_type, entry.amount, entry.source_envelope_id, entry.created_by])).toEqual([['transfer-in', 2.5, savings, DANA], ['init', 0, null, DANA]]);
        expect((await readLedger(device.device.db, { limit: 2 })).length).toBe(2);
        expect(await readLedger(device.device.db, { envelopeIds: [] })).toEqual([]);
    });

    it('are renamed and given a goal on the device, by their owner or a parent, with an entry in the history', async () => {
        const parents = await home.deviceFor(parent, { online: true });
        const savings = await ensureFirstEnvelope(ELI);
        const fays = await ensureFirstEnvelope(FAY);
        await home.sync(parents);

        const kids = await home.deviceFor(eli);
        await updateEnvelope(savings, { name: '  Bike fund ', description: 'A red one', goalAmount: 120, goalCurrency: 'usd' });
        await updateEnvelope(savings, { name: 'Bike fund' });
        await expect(updateEnvelope(fays, { name: 'Mine now' })).rejects.toMatchObject({ reason: 'not_yours' });
        await expect(updateEnvelope(savings, { name: ' ' })).rejects.toThrow('cannot be empty');
        await expect(updateEnvelope(savings, { goalAmount: -1 })).rejects.toThrow('must be positive');

        expect(await home.sync(kids)).toEqual([{ ok: true }]);
        expect(await onServer(`SELECT name, description, goal_amount, goal_currency FROM allowance_envelopes WHERE id = $1`, [savings])).toEqual([{ name: 'Bike fund', description: 'A red one', goal_amount: 120, goal_currency: 'USD' }]);
        expect(await onServer(`SELECT action_type, summary, actor_id FROM history_events WHERE action_type = 'envelope_updated'`)).toEqual([{ action_type: 'envelope_updated', summary: "Updated Eli's Bike fund", actor_id: ELI }]);

        // Removing the goal removes its currency with it.
        await updateEnvelope(savings, { goalAmount: null });
        await home.sync(kids);
        expect(await onServer(`SELECT goal_amount, goal_currency FROM allowance_envelopes WHERE id = $1`, [savings])).toEqual([{ goal_amount: null, goal_currency: null }]);
    });

    it('have their default chosen on the device, with no connection, among the member\'s own that are in use', async () => {
        const parents = await home.deviceFor(parent, { online: true });
        const savings = await ensureFirstEnvelope(ELI);
        const spending = await requestFinance<string>({ operation: 'create-envelope', familyMemberId: ELI, name: 'Spending', isDefault: false });
        const old = await requestFinance<string>({ operation: 'create-envelope', familyMemberId: ELI, name: 'Old', isDefault: false });
        const fays = await ensureFirstEnvelope(FAY);
        const faysOther = await requestFinance<string>({ operation: 'create-envelope', familyMemberId: FAY, name: 'Other', isDefault: false });
        await home.sync(parents);

        const kids = await home.deviceFor(eli);
        await setDefaultEnvelope(ELI, spending);
        expect((await envelopesOn(kids, ELI)).filter((envelope) => envelope.isDefault).map((envelope) => envelope.name)).toEqual(['Spending']);
        await expect(setDefaultEnvelope(ELI, fays)).rejects.toThrow('one of the member\'s own');
        await expect(setDefaultEnvelope(FAY, faysOther)).rejects.toMatchObject({ reason: 'not_yours' });
        expect(await home.sync(kids)).toEqual([{ ok: true }]);
        expect(await onServer(`SELECT default_envelope_id FROM family_members WHERE id = $1`, [ELI])).toEqual([{ default_envelope_id: spending }]);

        // Archived on the server while this device had not heard: the choice is refused there, and put right here.
        await setDefaultEnvelope(ELI, old);
        home.use(parents);
        await requestFinance({ operation: 'archive', envelopeId: old, transferToEnvelopeId: savings });
        expect(await home.sync(kids)).toMatchObject([{ ok: false, reason: 'conflict' }]);
        expect((await envelopesOn(kids, ELI)).map((envelope) => [envelope.name, envelope.isDefault])).toEqual([['Savings', false], ['Spending', true]]);
    });
});

describe('asking the server about money', () => {
    it('says so when there is no connection, and gives the server\'s reason when it will not', async () => {
        await home.deviceFor(parent);
        await expect(requestFinance({ operation: 'create-initial', familyMemberId: ELI })).rejects.toBeInstanceOf(OfflineError);

        const parents = await home.deviceFor(parent, { online: true });
        const savings = await ensureFirstEnvelope(ELI);
        const refused = await requestFinance({ operation: 'withdraw', envelopeId: savings, amount: 5, currency: 'USD' }).catch((error) => error);
        expect(refused).toBeInstanceOf(ServerRefusedError);
        expect(refused).toMatchObject({ status: 400, code: 'finance_refused', message: 'Insufficient USD funds in Savings. Available: 0, Tried: 5' });
        await home.sync(parents);

        await home.deviceFor(eli, { online: true });
        await expect(requestFinance({ operation: 'archive', envelopeId: savings, transferToEnvelopeId: savings })).rejects.toMatchObject({ status: 403, message: 'Parent access required.' });
    });
});

describe('an exchange rate', () => {
    const rates = [
        { baseCurrency: 'USD', targetCurrency: 'NPR', rate: 133, fetchedAt: '2026-03-09T10:00:00.000Z' },
        { baseCurrency: 'USD', targetCurrency: 'EUR', rate: 0.95, fetchedAt: '2026-03-09T12:00:00.000Z' },
    ];

    it('is found directly, turned round, or through the currency both are priced in', () => {
        expect(findExchangeRate(rates, 'usd', 'NPR')).toEqual({ rate: 133, fetchedAt: '2026-03-09T10:00:00.000Z' });
        expect(findExchangeRate(rates, 'NPR', 'USD')?.rate).toBeCloseTo(1 / 133);
        expect(findExchangeRate(rates, 'EUR', 'NPR')).toEqual({ rate: 133 / 0.95, fetchedAt: '2026-03-09T10:00:00.000Z' });
        expect(findExchangeRate(rates, 'NPR', 'NPR')?.rate).toBe(1);
        expect(findExchangeRate(rates, 'USD', 'STARS')).toBeNull();
        expect(findExchangeRate(rates, '', 'USD')).toBeNull();
    });
});
