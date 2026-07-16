import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    adminQuery: vi.fn(),
    adminTransact: vi.fn(),
    createAdditionalEnvelope: vi.fn(),
    createInitialSavingsEnvelope: vi.fn(),
    deleteEnvelope: vi.fn(),
    depositToSpecificEnvelope: vi.fn(),
    transferFunds: vi.fn(),
    transferFundsToPerson: vi.fn(),
    withdrawFromEnvelope: vi.fn(),
    setDefaultEnvelope: vi.fn(),
}));

vi.mock('@/lib/instant-admin', () => ({
    getInstantAdminDb: () => ({ query: mocks.adminQuery, transact: mocks.adminTransact }),
}));

vi.mock('@/lib/currency-utils', () => ({
    createAdditionalEnvelope: mocks.createAdditionalEnvelope,
    createInitialSavingsEnvelope: mocks.createInitialSavingsEnvelope,
    deleteEnvelope: mocks.deleteEnvelope,
    depositToSpecificEnvelope: mocks.depositToSpecificEnvelope,
    transferFunds: mocks.transferFunds,
    transferFundsToPerson: mocks.transferFundsToPerson,
    withdrawFromEnvelope: mocks.withdrawFromEnvelope,
    setDefaultEnvelope: mocks.setDefaultEnvelope,
}));

import { executeServerFinanceMutation } from '@/lib/finance-mutation-server';

const kidActor = {
    instantUser: { id: 'instant-kid' },
    familyMember: { id: 'member-kid', role: 'child' },
};
const parentActor = {
    instantUser: { id: 'instant-parent' },
    familyMember: { id: 'member-parent', role: 'parent' },
};

function envelope(id: string, memberId: string, balances: Record<string, number> = {}) {
    return { id, name: id, balances, familyMember: [{ id: memberId, name: memberId }] };
}

describe('server finance mutations', () => {
    beforeEach(() => {
        Object.values(mocks).forEach((mock) => mock.mockReset());
        mocks.adminTransact.mockResolvedValue(undefined);
    });

    it('re-reads an owned envelope before depositing and stamps the server actor', async () => {
        const freshEnvelope = envelope('env-own', 'member-kid', { USD: 7 });
        mocks.adminQuery.mockResolvedValue({ allowanceEnvelopes: [freshEnvelope] });

        await executeServerFinanceMutation({ operation: 'deposit', envelopeId: 'env-own', amount: 3, currency: 'usd' }, kidActor);

        expect(mocks.depositToSpecificEnvelope).toHaveBeenCalledWith(
            expect.objectContaining({
                __allowanceAuditFields: { createdBy: 'instant-kid', createdByFamilyMemberId: 'member-kid' },
            }),
            'env-own',
            { USD: 7 },
            3,
            'usd',
            'Deposit'
        );
    });

    it('rejects a kid mutation against another member envelope', async () => {
        mocks.adminQuery.mockResolvedValue({ allowanceEnvelopes: [envelope('env-sibling', 'member-sibling', { USD: 7 })] });

        await expect(
            executeServerFinanceMutation({ operation: 'withdraw', envelopeId: 'env-sibling', amount: 1, currency: 'USD' }, kidActor)
        ).rejects.toMatchObject({ status: 403 });
        expect(mocks.withdrawFromEnvelope).not.toHaveBeenCalled();
    });

    it('keeps same-member transfers separate from person transfers', async () => {
        const source = envelope('env-source', 'member-kid', { USD: 7 });
        const sibling = envelope('env-sibling', 'member-sibling', {});
        mocks.adminQuery.mockResolvedValue({ allowanceEnvelopes: [source, sibling] });

        await expect(
            executeServerFinanceMutation(
                { operation: 'transfer', sourceEnvelopeId: source.id, destinationEnvelopeId: sibling.id, amount: 1, currency: 'USD' },
                kidActor
            )
        ).rejects.toMatchObject({ status: 409 });

        await executeServerFinanceMutation(
            { operation: 'transfer-person', sourceEnvelopeId: source.id, destinationEnvelopeId: sibling.id, amount: 1, currency: 'USD' },
            kidActor
        );
        expect(mocks.transferFundsToPerson).toHaveBeenCalledWith(expect.anything(), source, sibling, 1, 'USD', undefined);
    });

    it('requires parent scope for archival and passes the full fresh member envelope list', async () => {
        const source = envelope('env-source', 'member-kid', { USD: 7 });
        const target = envelope('env-target', 'member-kid', {});
        mocks.adminQuery
            .mockResolvedValueOnce({ allowanceEnvelopes: [source, target] })
            .mockResolvedValueOnce({ familyMembers: [{ id: 'member-kid', allowanceEnvelopes: [source, target] }] });

        await expect(
            executeServerFinanceMutation(
                { operation: 'archive', envelopeId: source.id, transferToEnvelopeId: target.id, newDefaultEnvelopeId: target.id },
                kidActor
            )
        ).rejects.toMatchObject({ status: 403 });

        await executeServerFinanceMutation(
            { operation: 'archive', envelopeId: source.id, transferToEnvelopeId: target.id, newDefaultEnvelopeId: target.id },
            parentActor
        );
        expect(mocks.deleteEnvelope).toHaveBeenCalledWith(expect.anything(), [source, target], source.id, target.id, target.id);
    });

    it('allows kids to create only their own envelopes', async () => {
        mocks.createInitialSavingsEnvelope.mockResolvedValue('new-envelope');

        await expect(executeServerFinanceMutation({ operation: 'create-initial', familyMemberId: 'member-other' }, kidActor)).rejects.toMatchObject({
            status: 403,
        });
        await expect(executeServerFinanceMutation({ operation: 'create-initial', familyMemberId: 'member-kid' }, kidActor)).resolves.toBe('new-envelope');
    });

    it('normalizes the default flag after creating a named envelope', async () => {
        const oldDefault = { ...envelope('env-old', 'member-kid'), isDefault: true };
        mocks.adminQuery.mockResolvedValue({ familyMembers: [{ id: 'member-kid', allowanceEnvelopes: [oldDefault] }] });
        mocks.createAdditionalEnvelope.mockResolvedValue('env-new');

        await expect(
            executeServerFinanceMutation(
                {
                    operation: 'create-envelope',
                    familyMemberId: 'member-kid',
                    name: 'Trips',
                    description: 'Big adventures',
                    isDefault: true,
                },
                kidActor
            )
        ).resolves.toBe('env-new');

        expect(mocks.createAdditionalEnvelope).toHaveBeenCalledWith(
            expect.anything(),
            'member-kid',
            'Trips',
            true,
            null,
            null,
            'Big adventures'
        );
        expect(mocks.setDefaultEnvelope).toHaveBeenCalledWith(
            expect.anything(),
            expect.arrayContaining([oldDefault, expect.objectContaining({ id: 'env-new', isDefault: true })]),
            'env-new'
        );
    });
});
