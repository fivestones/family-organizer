import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freezeTime } from '@/test/utils/fake-clock';

const payoutMocks = vi.hoisted(() => {
    const txFactory = (entity: string) =>
        new Proxy(
            {},
            {
                get(_target, id: string) {
                    return {
                        update(payload: unknown) {
                            return { op: 'update', entity, id, payload };
                        },
                        link(payload: unknown) {
                            return { op: 'link', entity, id, payload };
                        },
                        delete() {
                            return { op: 'delete', entity, id };
                        },
                    };
                },
            }
        );

    return {
        tx: new Proxy(
            {},
            {
                get(_target, entity: string) {
                    return txFactory(entity);
                },
            }
        ),
        getAuth: vi.fn(),
    };
});

vi.mock('@instantdb/react', () => ({ tx: payoutMocks.tx }));
vi.mock('@/lib/db', () => ({ db: { getAuth: payoutMocks.getAuth } }));

import {
    createAllowanceDistributionKey,
    createAllowanceDistributionTransactionId,
    executeAtomicAllowancePayout,
} from '@/lib/allowance-payout';

function period(id: string, amount: number, completionsToMark = [`completion-${id}`]) {
    return {
        id,
        periodStartDate: new Date('2026-02-01T00:00:00.000Z'),
        periodEndDate: new Date(id === 'period-2' ? '2026-02-28T00:00:00.000Z' : '2026-02-14T00:00:00.000Z'),
        amount,
        completionsToMark,
    };
}

describe('atomic allowance payouts', () => {
    beforeEach(() => {
        payoutMocks.getAuth.mockReset();
        payoutMocks.getAuth.mockResolvedValue({ id: 'instant-parent-principal' });
        freezeTime(new Date('2026-02-26T12:34:56.000Z'));
    });

    it('writes the balance, immutable period ledger row, history, and completion marks in one transaction', async () => {
        const db = {
            queryOnce: vi.fn().mockResolvedValue({
                data: {
                    familyMembers: [
                        {
                            id: 'member-1',
                            allowanceEnvelopes: [{ id: 'envelope-1', name: 'Savings', balances: { usd: 10 }, isDefault: true }],
                        },
                    ],
                    allowanceTransactions: [],
                },
            }),
            transact: vi.fn().mockResolvedValue(undefined),
        };

        const result = await executeAtomicAllowancePayout({
            db,
            memberId: 'member-1',
            memberName: 'Ethan',
            primaryCurrency: 'usd',
            periods: [period('period-1', 12.5, ['completion-1', 'completion-2', 'completion-1'])],
        });

        const transactionId = createAllowanceDistributionTransactionId(
            'member-1',
            '2026-02-01',
            '2026-02-14',
            'USD'
        );
        expect(result).toEqual({
            processedPeriodIds: ['period-1'],
            skippedPeriodIds: [],
            amountsByCurrency: { USD: 12.5 },
            envelopeId: 'envelope-1',
        });
        expect(db.transact).toHaveBeenCalledTimes(1);

        const transactions = db.transact.mock.calls[0][0] as any[];
        expect(transactions).toEqual(
            expect.arrayContaining([
                {
                    op: 'update',
                    entity: 'allowanceEnvelopes',
                    id: 'envelope-1',
                    payload: { balances: { USD: 22.5 } },
                },
                {
                    op: 'link',
                    entity: 'allowanceEnvelopes',
                    id: 'envelope-1',
                    payload: { transactions: transactionId },
                },
                {
                    op: 'update',
                    entity: 'choreCompletions',
                    id: 'completion-1',
                    payload: { allowanceAwarded: true },
                },
                {
                    op: 'update',
                    entity: 'choreCompletions',
                    id: 'completion-2',
                    payload: { allowanceAwarded: true },
                },
            ])
        );

        const ledgerWrite = transactions.find(
            (transaction) => transaction.entity === 'allowanceTransactions' && transaction.id === transactionId
        );
        expect(ledgerWrite).toMatchObject({
            op: 'update',
            payload: {
                amount: 12.5,
                createdAt: '2026-02-26T12:34:56.000Z',
                createdBy: 'instant-parent-principal',
                currency: 'USD',
                description: 'Allowance distribution for period ending 2026-02-14',
                distributionKey: createAllowanceDistributionKey('member-1', '2026-02-01', '2026-02-14', 'USD'),
                transactionType: 'allowance-distribution',
                updatedAt: '2026-02-26T12:34:56.000Z',
            },
        });
        expect(ledgerWrite.payload).not.toHaveProperty('envelope');
        expect(ledgerWrite.payload).not.toHaveProperty('sourceEnvelope');
        expect(ledgerWrite.payload).not.toHaveProperty('destinationEnvelope');
        expect(
            transactions.some(
                (transaction) =>
                    transaction.entity === 'historyEvents' &&
                    transaction.op === 'update' &&
                    transaction.payload?.allowanceTransactionId === transactionId &&
                    transaction.payload?.summary === 'Deposited $12.50 for Ethan'
            )
        ).toBe(true);
    });

    it('does nothing when the deterministic period transaction already exists', async () => {
        const transactionId = createAllowanceDistributionTransactionId(
            'member-1',
            '2026-02-01',
            '2026-02-14',
            'USD'
        );
        const db = {
            queryOnce: vi.fn().mockResolvedValue({
                data: {
                    familyMembers: [
                        { id: 'member-1', allowanceEnvelopes: [{ id: 'envelope-1', name: 'Savings', balances: { USD: 22.5 } }] },
                    ],
                    allowanceTransactions: [{ id: transactionId }],
                },
            }),
            transact: vi.fn(),
        };

        await expect(
            executeAtomicAllowancePayout({
                db,
                memberId: 'member-1',
                primaryCurrency: 'USD',
                periods: [period('period-1', 12.5)],
            })
        ).resolves.toEqual({
            processedPeriodIds: [],
            skippedPeriodIds: ['period-1'],
            amountsByCurrency: {},
            envelopeId: 'envelope-1',
        });
        expect(db.transact).not.toHaveBeenCalled();
        expect(payoutMocks.getAuth).not.toHaveBeenCalled();
    });

    it('processes only new periods when a bulk retry contains an older paid period', async () => {
        const oldTransactionId = createAllowanceDistributionTransactionId(
            'member-1',
            '2026-02-01',
            '2026-02-14',
            'USD'
        );
        const db = {
            queryOnce: vi.fn().mockResolvedValue({
                data: {
                    familyMembers: [
                        {
                            id: 'member-1',
                            allowanceEnvelopes: [{ id: 'envelope-1', name: 'Savings', balances: { USD: 20 }, isDefault: true }],
                        },
                    ],
                    allowanceTransactions: [{ id: oldTransactionId }],
                },
            }),
            transact: vi.fn().mockResolvedValue(undefined),
        };

        const result = await executeAtomicAllowancePayout({
            db,
            memberId: 'member-1',
            primaryCurrency: 'USD',
            periods: [period('period-1', 5), period('period-2', 3)],
        });

        expect(result.processedPeriodIds).toEqual(['period-2']);
        expect(result.skippedPeriodIds).toEqual(['period-1']);
        expect(result.amountsByCurrency).toEqual({ USD: 3 });
        const transactions = db.transact.mock.calls[0][0] as any[];
        expect(transactions).toContainEqual({
            op: 'update',
            entity: 'allowanceEnvelopes',
            id: 'envelope-1',
            payload: { balances: { USD: 23 } },
        });
        expect(transactions).not.toContainEqual(
            expect.objectContaining({ entity: 'choreCompletions', id: 'completion-period-1' })
        );
        expect(transactions).toContainEqual(
            expect.objectContaining({ entity: 'choreCompletions', id: 'completion-period-2' })
        );
    });

    it('creates and links a deterministic Savings envelope inside the payout transaction', async () => {
        const db = {
            queryOnce: vi.fn().mockResolvedValue({
                data: { familyMembers: [{ id: 'member-1', allowanceEnvelopes: [] }], allowanceTransactions: [] },
            }),
            transact: vi.fn().mockResolvedValue(undefined),
        };

        const result = await executeAtomicAllowancePayout({
            db,
            memberId: 'member-1',
            primaryCurrency: 'USD',
            periods: [period('period-1', 8)],
        });
        const transactions = db.transact.mock.calls[0][0] as any[];

        expect(result.envelopeId).toMatch(/^[0-9a-f-]{36}$/);
        expect(transactions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    op: 'update',
                    entity: 'allowanceEnvelopes',
                    id: result.envelopeId,
                    payload: expect.objectContaining({ name: 'Savings', balances: { USD: 8 }, isDefault: true }),
                }),
                {
                    op: 'link',
                    entity: 'familyMembers',
                    id: 'member-1',
                    payload: { allowanceEnvelopes: result.envelopeId },
                },
            ])
        );
    });

    it('rejects an overdraw before writing any payout state', async () => {
        const db = {
            queryOnce: vi.fn().mockResolvedValue({
                data: {
                    familyMembers: [
                        {
                            id: 'member-1',
                            allowanceEnvelopes: [{ id: 'envelope-1', name: 'Savings', balances: { USD: 2 }, isDefault: true }],
                        },
                    ],
                    allowanceTransactions: [],
                },
            }),
            transact: vi.fn(),
        };

        await expect(
            executeAtomicAllowancePayout({
                db,
                memberId: 'member-1',
                primaryCurrency: 'USD',
                periods: [period('period-1', -3)],
            })
        ).rejects.toThrow('Insufficient funds. Available: 2 USD.');
        expect(db.transact).not.toHaveBeenCalled();
    });
});
