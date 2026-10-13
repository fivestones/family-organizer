import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FinanceRequest } from '@family-organizer/data/finance/types';
import type { Principal } from '@family-organizer/data';
import { POST } from '@/app/api/finance/mutations/route';
import { createAllowanceDistributionHistoryId, createAllowanceDistributionTransactionId } from '@/lib/allowance-distribution-key';
import { executeFinanceRequest, FinanceError } from '@/lib/server/finance';
import { createSession, drainSession } from '@/lib/server/sessions';
import { applyUpload } from '@/lib/server/upload';
import { DANA, deviceRequest, DISHES, ELI, FAY, seedFamily } from '@/test/utils/family-fixture';
import { createTestDatabase, type TestDatabase } from '@/test/utils/postgres';

// Money on Postgres: every request is one transaction that writes the ledger and the balance together, as the
// person asking, or writes nothing.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-03-09T12:00:00.000Z');
const PARENT: Principal = { type: 'parent', familyMemberId: DANA };
const ELI_HIMSELF: Principal = { type: 'kid', familyMemberId: ELI };
const FAY_HERSELF: Principal = { type: 'kid', familyMemberId: FAY };
const SHARED: Principal = { type: 'kid', familyMemberId: null };

let database: TestDatabase;
beforeEach(async () => {
    database = await createTestDatabase();
    await seedFamily(database);
});
afterEach(() => database.close());

const ask = (principal: Principal, request: FinanceRequest) => executeFinanceRequest(database.db, principal, request, NOW);
const rows = async <T = Record<string, any>>(text: string, params: unknown[] = []) => (await database.sql.query<T>(text, params as any[])).rows;

/** What an envelope holds, by currency. */
const holds = async (envelopeId: string) => Object.fromEntries((await rows(`SELECT currency, amount FROM envelope_balances WHERE envelope_id = $1 ORDER BY currency`, [envelopeId])).map((row) => [row.currency, row.amount]));
/** An envelope's ledger, oldest first, without the row every envelope opens with. */
const ledger = (envelopeId: string) =>
    rows(`SELECT transaction_type AS type, amount, currency, description, created_by AS by FROM allowance_transactions WHERE envelope_id = $1 AND transaction_type <> 'init' ORDER BY created_at, transaction_type DESC`, [envelopeId]);
const defaultOf = async (memberId: string) => (await rows(`SELECT default_envelope_id FROM family_members WHERE id = $1`, [memberId]))[0].default_envelope_id as string | null;
const history = () => rows(`SELECT action_type AS action, summary, actor_id AS actor FROM history_events WHERE action_type <> 'envelope_created' ORDER BY occurred_at, summary`);
const everything = async () => ({
    ledger: await rows(`SELECT count(*)::integer AS n FROM allowance_transactions`),
    balances: await rows(`SELECT envelope_id, currency, amount FROM envelope_balances ORDER BY 1, 2`),
    history: await rows(`SELECT count(*)::integer AS n FROM history_events`),
});

/** Asks, expecting to be turned down, and that nothing at all was written. */
async function refused(principal: Principal, request: FinanceRequest, status: number, message?: string | RegExp) {
    const before = await everything();
    const error = await ask(principal, request).then(
        () => null,
        (thrown) => thrown
    );
    expect(error).toBeInstanceOf(FinanceError);
    expect((error as FinanceError).status).toBe(status);
    if (message) expect((error as FinanceError).message).toMatch(message);
    expect(await everything()).toEqual(before);
}

const firstEnvelope = (memberId: string) => ask(PARENT, { operation: 'create-initial', familyMemberId: memberId }) as Promise<string>;
const another = (memberId: string, name: string, isDefault = false) => ask(PARENT, { operation: 'create-envelope', familyMemberId: memberId, name, isDefault }) as Promise<string>;
const deposit = (envelopeId: string, amount: number, currency = 'USD') => ask(PARENT, { operation: 'deposit', envelopeId, amount, currency });

describe('a member\'s envelopes', () => {
    it('begin with Savings, their default, with an opening ledger row and a history entry', async () => {
        const savings = await firstEnvelope(ELI);

        expect(await rows(`SELECT family_member_id, name, archived_at FROM allowance_envelopes`)).toEqual([{ family_member_id: ELI, name: 'Savings', archived_at: null }]);
        expect(await defaultOf(ELI)).toBe(savings);
        expect(await rows(`SELECT envelope_id, transaction_type, amount, description, created_by, created_at FROM allowance_transactions`)).toEqual([
            { envelope_id: savings, transaction_type: 'init', amount: 0, description: 'Envelope Created', created_by: DANA, created_at: NOW.toISOString() },
        ]);
        expect(await rows(`SELECT domain, action_type, summary, source, actor_id, metadata->>'envelopeId' AS envelope FROM history_events`)).toEqual([
            { domain: 'finance', action_type: 'envelope_created', summary: 'Created envelope "Savings"', source: 'manual', actor_id: DANA, envelope: savings },
        ]);
        expect(await rows(`SELECT family_member_id FROM history_event_members`)).toEqual([{ family_member_id: ELI }]);
    });

    it('are made once, however often the first is asked for', async () => {
        const savings = await firstEnvelope(ELI);

        expect(await firstEnvelope(ELI)).toBe(savings);
        expect(await ask(ELI_HIMSELF, { operation: 'create-initial', familyMemberId: ELI })).toBe(savings);
        expect(await rows(`SELECT count(*)::integer AS n FROM allowance_envelopes`)).toEqual([{ n: 1 }]);
    });

    it('can be added to by a parent for anyone and by a kid for themselves', async () => {
        const savings = await firstEnvelope(ELI);
        const bike = (await ask(ELI_HIMSELF, { operation: 'create-envelope', familyMemberId: ELI, name: '  Bike ', description: 'A red one', isDefault: false, goalAmount: 120, goalCurrency: 'USD' })) as string;

        expect(await rows(`SELECT name, description, goal_amount, goal_currency FROM allowance_envelopes WHERE id = $1`, [bike])).toEqual([{ name: 'Bike', description: 'A red one', goal_amount: 120, goal_currency: 'USD' }]);
        expect(await defaultOf(ELI)).toBe(savings);

        // Asked for as the default, it takes the place of the one that was.
        const spending = await another(ELI, 'Spending', true);
        expect(await defaultOf(ELI)).toBe(spending);
    });

    it('become the default when they are a member\'s first, whatever was asked', async () => {
        const first = await another(FAY, 'Pocket money');

        expect(await defaultOf(FAY)).toBe(first);
    });

    it('cannot be made for someone else by a kid, by nobody in particular, or badly', async () => {
        await refused(ELI_HIMSELF, { operation: 'create-initial', familyMemberId: FAY }, 403, 'You can only change your own envelopes.');
        await refused(ELI_HIMSELF, { operation: 'create-envelope', familyMemberId: FAY, name: 'Mine now', isDefault: false }, 403);
        await refused(SHARED, { operation: 'create-initial', familyMemberId: ELI }, 403, 'Sign in as yourself');
        await refused(PARENT, { operation: 'create-initial', familyMemberId: id(999) }, 404);
        await refused(PARENT, { operation: 'create-initial', familyMemberId: 'not-an-id' }, 400);
        await refused(PARENT, { operation: 'create-envelope', familyMemberId: ELI, name: '   ', isDefault: false }, 400, 'Envelope name is required.');
        await refused(PARENT, { operation: 'create-envelope', familyMemberId: ELI, name: 'Bike', isDefault: false, goalAmount: -5, goalCurrency: 'USD' }, 400, 'Goal amount must be positive');
        await refused(PARENT, { operation: 'create-envelope', familyMemberId: ELI, name: 'Bike', isDefault: false, goalAmount: 5 }, 400, 'Goal currency must be specified');
        await refused(PARENT, { operation: 'launder' } as any, 400);
    });
});

describe('money in and out', () => {
    it('writes the ledger row, the balance and the history entry together', async () => {
        const savings = await firstEnvelope(ELI);

        expect(await ask(PARENT, { operation: 'deposit', envelopeId: savings, amount: 12.5, currency: 'usd', description: 'Birthday' })).toBeNull();
        expect(await ask(ELI_HIMSELF, { operation: 'withdraw', envelopeId: savings, amount: 2.5, currency: 'USD' })).toBeNull();

        expect(await holds(savings)).toEqual({ USD: 10 });
        expect(await ledger(savings)).toEqual([
            { type: 'withdrawal', amount: -2.5, currency: 'USD', description: 'Withdrawal', by: ELI },
            { type: 'deposit', amount: 12.5, currency: 'USD', description: 'Birthday', by: DANA },
        ]);
        expect(await history()).toEqual([
            { action: 'envelope_deposit', summary: "Deposited $12.50 to Eli's Savings", actor: DANA },
            { action: 'envelope_withdrawal', summary: "Withdrew $2.50 from Eli's Savings", actor: ELI },
        ]);
        expect(await rows(`SELECT metadata FROM history_events WHERE action_type = 'envelope_deposit'`)).toEqual([
            { metadata: { amount: 12.5, currency: 'USD', description: 'Birthday', envelopeId: savings, envelopeName: 'Savings', memberId: ELI, memberName: 'Eli' } },
        ]);
    });

    it('keeps each currency apart, writes out a unit that is not money, and holds no row for nothing', async () => {
        const savings = await firstEnvelope(ELI);
        await deposit(savings, 5);
        await deposit(savings, 3, 'stars');
        await ask(PARENT, { operation: 'withdraw', envelopeId: savings, amount: 5, currency: 'USD' });

        expect(await holds(savings)).toEqual({ STARS: 3 });
        expect((await history()).map((entry) => entry.summary)).toContain("Deposited 3 STARS to Eli's Savings");
    });

    it('will not take out more than is there, or an amount that is not one', async () => {
        const savings = await firstEnvelope(ELI);
        await deposit(savings, 5);

        await refused(PARENT, { operation: 'withdraw', envelopeId: savings, amount: 5.01, currency: 'USD' }, 400, 'Insufficient USD funds in Savings. Available: 5, Tried: 5.01');
        await refused(PARENT, { operation: 'withdraw', envelopeId: savings, amount: 1, currency: 'NPR' }, 400, 'Insufficient NPR funds');
        await refused(PARENT, { operation: 'deposit', envelopeId: savings, amount: 0, currency: 'USD' }, 400, 'Deposit amount must be positive.');
        await refused(PARENT, { operation: 'deposit', envelopeId: savings, amount: -3, currency: 'USD' }, 400);
        await refused(PARENT, { operation: 'deposit', envelopeId: savings, amount: Number.NaN, currency: 'USD' }, 400, 'finite number');
        await refused(PARENT, { operation: 'deposit', envelopeId: savings, amount: 1, currency: ' ' }, 400, 'Currency is required.');
    });

    it('is a kid\'s to do for themselves alone, and nobody\'s in an envelope that is gone', async () => {
        const savings = await firstEnvelope(ELI);
        const spending = await another(ELI, 'Spending');
        await deposit(savings, 5);
        await ask(PARENT, { operation: 'archive', envelopeId: spending, transferToEnvelopeId: savings });

        await refused(FAY_HERSELF, { operation: 'deposit', envelopeId: savings, amount: 1, currency: 'USD' }, 403);
        await refused(FAY_HERSELF, { operation: 'withdraw', envelopeId: savings, amount: 1, currency: 'USD' }, 403);
        await refused(SHARED, { operation: 'deposit', envelopeId: savings, amount: 1, currency: 'USD' }, 403);
        await refused(PARENT, { operation: 'deposit', envelopeId: spending, amount: 1, currency: 'USD' }, 404, 'Active envelope not found.');
        await refused(PARENT, { operation: 'deposit', envelopeId: id(999), amount: 1, currency: 'USD' }, 404);
    });

    it('stops while writes are frozen', async () => {
        const savings = await firstEnvelope(ELI);
        await database.sql.exec(`UPDATE installation SET writes_frozen = true`);

        await refused(PARENT, { operation: 'deposit', envelopeId: savings, amount: 1, currency: 'USD' }, 503);
    });
});

describe('money across', () => {
    it('moves between two envelopes of one member, with a ledger row on each side naming both', async () => {
        const savings = await firstEnvelope(ELI);
        const spending = await another(ELI, 'Spending');
        await deposit(savings, 10);

        await ask(ELI_HIMSELF, { operation: 'transfer', sourceEnvelopeId: savings, destinationEnvelopeId: spending, amount: 4, currency: 'USD' });

        expect([await holds(savings), await holds(spending)]).toEqual([{ USD: 6 }, { USD: 4 }]);
        expect(await rows(`SELECT envelope_id, source_envelope_id, destination_envelope_id, transaction_type, amount, description FROM allowance_transactions WHERE transaction_type LIKE 'transfer%' ORDER BY amount`)).toEqual([
            { envelope_id: savings, source_envelope_id: savings, destination_envelope_id: spending, transaction_type: 'transfer-out', amount: -4, description: 'Transfer from Savings to Spending' },
            { envelope_id: spending, source_envelope_id: savings, destination_envelope_id: spending, transaction_type: 'transfer-in', amount: 4, description: 'Transfer from Savings to Spending' },
        ]);
        expect(await history()).toContainEqual({ action: 'envelope_transfer', summary: "Transferred $4.00 from Eli's Savings to Eli's Spending", actor: ELI });
    });

    it('moves to another person only when asked to, and names them', async () => {
        const [elis, fays] = [await firstEnvelope(ELI), await firstEnvelope(FAY)];
        await deposit(elis, 10);

        await refused(ELI_HIMSELF, { operation: 'transfer', sourceEnvelopeId: elis, destinationEnvelopeId: fays, amount: 4, currency: 'USD' }, 409, 'must stay within one family member');
        await ask(ELI_HIMSELF, { operation: 'transfer-person', sourceEnvelopeId: elis, destinationEnvelopeId: fays, amount: 4, currency: 'USD' });

        expect([await holds(elis), await holds(fays)]).toEqual([{ USD: 6 }, { USD: 4 }]);
        expect(await ledger(fays)).toEqual([{ type: 'transfer-in-person', amount: 4, currency: 'USD', description: 'Transfer from Eli to Fay', by: ELI }]);
        expect(await history()).toContainEqual({ action: 'person_transfer', summary: "Transferred $4.00 from Eli's Savings to Fay's Savings", actor: ELI });
        expect(await rows(`SELECT family_member_id FROM history_event_members m JOIN history_events e ON e.id = m.history_event_id WHERE e.action_type = 'person_transfer' ORDER BY 1`)).toEqual([{ family_member_id: ELI }, { family_member_id: FAY }]);
    });

    it('is refused out of someone else\'s envelope, into the same one, or beyond what is there', async () => {
        const [elis, fays] = [await firstEnvelope(ELI), await firstEnvelope(FAY)];
        await deposit(fays, 10);

        await refused(ELI_HIMSELF, { operation: 'transfer-person', sourceEnvelopeId: fays, destinationEnvelopeId: elis, amount: 4, currency: 'USD' }, 403);
        await refused(PARENT, { operation: 'transfer-person', sourceEnvelopeId: fays, destinationEnvelopeId: fays, amount: 4, currency: 'USD' }, 400, 'same envelope');
        await refused(PARENT, { operation: 'transfer-person', sourceEnvelopeId: fays, destinationEnvelopeId: elis, amount: 40, currency: 'USD' }, 400, 'Insufficient USD funds in source envelope (Savings). Available: 10, Tried: 40');
        await refused(PARENT, { operation: 'transfer-person', sourceEnvelopeId: fays, destinationEnvelopeId: id(999), amount: 4, currency: 'USD' }, 404);
    });
});

describe('archiving an envelope', () => {
    it('moves everything it holds, a debt included, to another of the member\'s and puts it away', async () => {
        const savings = await firstEnvelope(ELI);
        const spending = await another(ELI, 'Spending');
        await deposit(spending, 7);
        await deposit(spending, 2, 'NPR');
        await database.sql.query(`INSERT INTO envelope_balances (envelope_id, currency, amount) VALUES ($1, 'STARS', -3)`, [spending]);

        await ask(PARENT, { operation: 'archive', envelopeId: spending, transferToEnvelopeId: savings });

        expect(await holds(savings)).toEqual({ NPR: 2, STARS: -3, USD: 7 });
        expect(await holds(spending)).toEqual({});
        expect(await rows(`SELECT archived_at FROM allowance_envelopes WHERE id = $1`, [spending])).toEqual([{ archived_at: NOW.toISOString() }]);
        expect(await rows(`SELECT amount, currency, description FROM allowance_transactions WHERE envelope_id = $1 AND transaction_type = 'transfer-in' ORDER BY currency`, [savings])).toEqual([
            { amount: 2, currency: 'NPR', description: 'Transfer from deleted envelope Spending to Savings' },
            { amount: -3, currency: 'STARS', description: 'Transfer from deleted envelope Spending to Savings' },
            { amount: 7, currency: 'USD', description: 'Transfer from deleted envelope Spending to Savings' },
        ]);
        expect(await history()).toContainEqual({ action: 'envelope_deleted', summary: "Deleted Eli's Spending", actor: DANA });
        // What the member has in all is what it was.
        expect(await rows(`SELECT currency, sum(amount)::double precision AS total FROM allowance_transactions GROUP BY currency HAVING sum(amount) <> 0 ORDER BY currency`)).toEqual([
            { currency: 'NPR', total: 2 },
            { currency: 'USD', total: 7 },
        ]);
    });

    it('moves the default first when the default is the one archived', async () => {
        const savings = await firstEnvelope(ELI);
        const spending = await another(ELI, 'Spending');

        await refused(PARENT, { operation: 'archive', envelopeId: savings, transferToEnvelopeId: spending }, 400, 'Must specify a new default envelope');
        await refused(PARENT, { operation: 'archive', envelopeId: savings, transferToEnvelopeId: spending, newDefaultEnvelopeId: savings }, 400, 'New default cannot be the deleted envelope.');
        await ask(PARENT, { operation: 'archive', envelopeId: savings, transferToEnvelopeId: spending, newDefaultEnvelopeId: spending });

        expect(await defaultOf(ELI)).toBe(spending);
    });

    it('is a parent\'s to do, within one member, and never to their last envelope', async () => {
        const savings = await firstEnvelope(ELI);
        const spending = await another(ELI, 'Spending');
        const fays = await firstEnvelope(FAY);

        await refused(ELI_HIMSELF, { operation: 'archive', envelopeId: spending, transferToEnvelopeId: savings }, 403, 'Parent access required.');
        await refused(PARENT, { operation: 'archive', envelopeId: spending, transferToEnvelopeId: fays }, 409, 'owned by the same member');
        await refused(PARENT, { operation: 'archive', envelopeId: spending, transferToEnvelopeId: savings, newDefaultEnvelopeId: fays }, 409, 'new default envelope must belong');
        await refused(PARENT, { operation: 'archive', envelopeId: spending, transferToEnvelopeId: spending }, 400);
        await refused(PARENT, { operation: 'archive', envelopeId: fays, transferToEnvelopeId: savings }, 409);
        await refused(PARENT, { operation: 'archive', envelopeId: id(999), transferToEnvelopeId: savings }, 404);
    });

    it('is something the database itself will not let leave a default behind', async () => {
        const savings = await firstEnvelope(ELI);
        const spending = await another(ELI, 'Spending');
        await ask(PARENT, { operation: 'archive', envelopeId: spending, transferToEnvelopeId: savings });

        // By hand, at a database prompt: neither half of the mistake can be made.
        await expect(database.sql.query(`UPDATE allowance_envelopes SET archived_at = now() WHERE id = $1`, [savings])).rejects.toMatchObject({ code: '23503' });
        await expect(database.sql.query(`UPDATE family_members SET default_envelope_id = $1 WHERE id = $2`, [spending, ELI])).rejects.toMatchObject({ code: '23503' });

        // From a device that had not heard: the choice is refused as one made too late.
        const { session } = await createSession(database.db, ELI_HIMSELF);
        const upload = { uploadId: 'upload-000000000001', dataGeneration: 1, mutation: 'setDefaultEnvelope', operations: [{ op: 'PATCH' as const, table: 'family_members', id: ELI, data: { default_envelope_id: spending } }] };
        expect((await applyUpload(database.db, session, upload)).outcome).toMatchObject({ ok: false, reason: 'conflict' });
        expect(await defaultOf(ELI)).toBe(savings);
    });
});

describe('paying an allowance', () => {
    const week = (n: number, amount: number, extra: Partial<{ additionalAmountsByCurrency: Record<string, number>; completionsToMark: string[]; description: string }> = {}) => ({
        id: `week-${n}`,
        periodStartDate: `2026-03-0${n}T00:00:00.000Z`,
        periodEndDate: `2026-03-0${n + 6 > 9 ? 9 : n + 6}T00:00:00.000Z`,
        amount,
        completionsToMark: [],
        ...extra,
    });
    const pay = (periods: ReturnType<typeof week>[], principal: Principal = PARENT) => ask(principal, { operation: 'allowance-payout', memberId: ELI, primaryCurrency: 'usd', periods });

    it('pays each period into the default envelope, once, and marks what it paid for', async () => {
        const savings = await firstEnvelope(ELI);
        await database.sql.query(`INSERT INTO chore_completions (id, chore_id, completed_by, date_due, completed_at) VALUES ($1, $2, $3, '2026-03-02', '2026-03-02T09:00:00Z')`, [id(40), DISHES, ELI]);

        const first = await pay([week(1, 5, { completionsToMark: [id(40)], additionalAmountsByCurrency: { stars: 2 } })]);

        expect(first).toEqual({ processedPeriodIds: ['week-1'], skippedPeriodIds: [], amountsByCurrency: { USD: 5, STARS: 2 }, envelopeId: savings });
        expect(await holds(savings)).toEqual({ STARS: 2, USD: 5 });
        const entryId = createAllowanceDistributionTransactionId(ELI, '2026-03-01', '2026-03-07', 'USD');
        expect(await rows(`SELECT id, transaction_type, amount, description, distribution_key FROM allowance_transactions WHERE currency = 'USD' AND transaction_type <> 'init'`)).toEqual([
            { id: entryId, transaction_type: 'allowance-distribution', amount: 5, description: 'Allowance distribution for period ending 2026-03-07', distribution_key: `allowance:${ELI}:2026-03-01:2026-03-07:USD` },
        ]);
        expect(await rows(`SELECT summary, allowance_transaction_id FROM history_events WHERE id = $1`, [createAllowanceDistributionHistoryId(entryId)])).toEqual([{ summary: 'Deposited $5.00 for Eli', allowance_transaction_id: entryId }]);
        expect(await rows(`SELECT allowance_awarded FROM chore_completions WHERE id = $1`, [id(40)])).toEqual([{ allowance_awarded: true }]);

        // Asked again, with a new period beside the old: only the new one is paid.
        const second = await pay([week(1, 5), week(2, 3)]);
        expect(second).toEqual({ processedPeriodIds: ['week-2'], skippedPeriodIds: ['week-1'], amountsByCurrency: { USD: 3 }, envelopeId: savings });
        expect(await holds(savings)).toEqual({ STARS: 2, USD: 8 });
        expect(await pay([week(1, 5), week(2, 3)])).toEqual({ processedPeriodIds: [], skippedPeriodIds: ['week-1', 'week-2'], amountsByCurrency: {}, envelopeId: savings });
    });

    it('makes the member an envelope if they have none, and records a period that pays nothing', async () => {
        const result = (await pay([week(1, 0)])) as { envelopeId: string };

        expect(await rows(`SELECT id, name FROM allowance_envelopes`)).toEqual([{ id: result.envelopeId, name: 'Savings' }]);
        expect(await defaultOf(ELI)).toBe(result.envelopeId);
        expect(await ledger(result.envelopeId)).toEqual([{ type: 'allowance-distribution', amount: 0, currency: 'USD', description: 'Allowance distribution for period ending 2026-03-07', by: DANA }]);
        expect(await holds(result.envelopeId)).toEqual({});
    });

    it('takes back what a period owes, if it is there to take', async () => {
        const savings = await firstEnvelope(ELI);
        await deposit(savings, 4);

        await refused(PARENT, { operation: 'allowance-payout', memberId: ELI, primaryCurrency: 'USD', periods: [week(1, -5)] }, 400, 'Insufficient funds. Available: 4 USD.');
        await pay([week(1, -4, { description: 'A hard week' })]);

        expect(await holds(savings)).toEqual({});
        expect((await ledger(savings)).at(-1)).toEqual({ type: 'allowance-withdrawal', amount: -4, currency: 'USD', description: 'A hard week', by: DANA });
    });

    it('is a parent\'s to do, for someone who exists, for periods that are periods', async () => {
        await refused(ELI_HIMSELF, { operation: 'allowance-payout', memberId: ELI, primaryCurrency: 'USD', periods: [week(1, 5)] }, 403);
        await refused(PARENT, { operation: 'allowance-payout', memberId: id(999), primaryCurrency: 'USD', periods: [week(1, 5)] }, 404);
        await refused(PARENT, { operation: 'allowance-payout', memberId: ELI, primaryCurrency: 'USD', periods: [] }, 400, 'At least one allowance period');
        await refused(PARENT, { operation: 'allowance-payout', memberId: ELI, primaryCurrency: 'USD', periods: [week(1, 5), { ...week(1, 2), id: 'again' }] }, 400, 'same period more than once');
        await refused(PARENT, { operation: 'allowance-payout', memberId: ELI, primaryCurrency: 'USD', periods: [{ ...week(1, 5), periodEndDate: 'whenever' }] }, 400, 'invalid date');
        await refused(PARENT, { operation: 'allowance-payout', memberId: ELI, primaryCurrency: 'USD', periods: [{ ...week(1, 5), amount: Number.POSITIVE_INFINITY }] }, 400);
    });
});

describe('a balance and its ledger', () => {
    it('are made to agree again when a balance has been changed by hand', async () => {
        const savings = await firstEnvelope(ELI);
        const spending = await another(ELI, 'Spending');
        await deposit(savings, 10);
        await deposit(spending, 3);
        await database.sql.exec(`UPDATE envelope_balances SET amount = 99 WHERE currency = 'USD' AND amount = 10; INSERT INTO envelope_balances SELECT id, 'NPR', 5 FROM allowance_envelopes WHERE name = 'Savings'`);

        expect(await ask(PARENT, { operation: 'reconcile', familyMemberId: ELI })).toEqual({ fixedEnvelopeIds: [savings], unverifiableEnvelopeIds: [] });
        expect([await holds(savings), await holds(spending)]).toEqual([{ USD: 10 }, { USD: 3 }]);
        expect(await ask(PARENT, { operation: 'reconcile', familyMemberId: ELI })).toEqual({ fixedEnvelopeIds: [], unverifiableEnvelopeIds: [] });
    });

    it('leaves alone an envelope that holds something and has no ledger to say why', async () => {
        await database.sql.exec(`
            INSERT INTO allowance_envelopes (id, family_member_id, name) VALUES ('${id(70)}', '${FAY}', 'Old jar');
            INSERT INTO envelope_balances (envelope_id, currency, amount) VALUES ('${id(70)}', 'USD', 12);
        `);

        expect(await ask(PARENT, { operation: 'reconcile', familyMemberId: FAY })).toEqual({ fixedEnvelopeIds: [], unverifiableEnvelopeIds: [id(70)] });
        expect(await holds(id(70))).toEqual({ USD: 12 });
        await refused(FAY_HERSELF, { operation: 'reconcile', familyMemberId: FAY }, 403);
    });
});

describe('the route', () => {
    const post = (sessionToken: string, body: unknown) => POST(deviceRequest('/api/finance/mutations', { sessionToken, body }));

    it('serves a request made under the app\'s own session from Postgres, as that session\'s person', async () => {
        const parent = await createSession(database.db, PARENT);
        const kid = await createSession(database.db, FAY_HERSELF);

        const created = await post(parent.token, { operation: 'create-initial', familyMemberId: ELI });
        expect(created.status).toBe(200);
        const { result: savings } = await created.json();
        expect(await defaultOf(ELI)).toBe(savings);

        const refusedResponse = await post(kid.token, { operation: 'deposit', envelopeId: savings, amount: 5, currency: 'USD' });
        expect(refusedResponse.status).toBe(403);
        expect(await refusedResponse.json()).toEqual({ error: 'You can only change your own envelopes.', code: 'finance_refused' });
        expect(await holds(savings)).toEqual({});
    });

    it('turns away a session that has ended, one that is only finishing its uploads, and a body that is not a request', async () => {
        const parent = await createSession(database.db, PARENT);
        expect((await post('no-such-session', { operation: 'create-initial', familyMemberId: ELI })).status).toBe(401);
        expect((await post(parent.token, 'not json')).status).toBe(400);
        expect((await post(parent.token, [])).status).toBe(400);

        await drainSession(database.db, parent.session.id);
        const draining = await post(parent.token, { operation: 'create-initial', familyMemberId: ELI });
        expect(draining.status).toBe(403);
        expect(await rows(`SELECT 1 FROM allowance_envelopes`)).toEqual([]);
    });
});
