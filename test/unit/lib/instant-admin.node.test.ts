import { beforeEach, describe, expect, it, vi } from 'vitest';

const instantAdminMocks = vi.hoisted(() => ({
    init: vi.fn(),
}));

vi.mock('@instantdb/admin', () => ({
    init: instantAdminMocks.init,
}));

const ORIGINAL_ENV = { ...process.env };

describe('lib/instant-admin', () => {
    beforeEach(() => {
        vi.resetModules();
        instantAdminMocks.init.mockReset();
        process.env = { ...ORIGINAL_ENV };
        delete process.env.INSTANT_KID_AUTH_EMAIL;
        delete process.env.INSTANT_PARENT_AUTH_EMAIL;
        delete process.env.INSTANT_KID_AUTH_ID;
        delete process.env.INSTANT_PARENT_AUTH_ID;
        delete process.env.INSTANT_FAMILY_AUTH_ID;
    });

    it('derives principal emails from IDs when explicit emails are not provided', async () => {
        process.env.INSTANT_KID_AUTH_ID = 'Kid Principal!';
        process.env.INSTANT_PARENT_AUTH_ID = 'Parent / Admin';

        const mod = await import('@/lib/instant-admin');

        expect(mod.getKidPrincipalAuthEmail()).toBe('kid-principal@family-organizer.local');
        expect(mod.getParentPrincipalAuthEmail()).toBe('parent-admin@family-organizer.local');
    });

    it('hashes PINs with a salted scrypt format and verifies them', async () => {
        const mod = await import('@/lib/instant-admin');
        const firstHash = mod.hashPinServer('1234');
        const secondHash = mod.hashPinServer('1234');

        expect(firstHash).toMatch(/^scrypt\$v1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
        expect(secondHash).not.toBe(firstHash);
        expect(mod.verifyPinHashServer('1234', firstHash)).toEqual({ valid: true, needsUpgrade: false });
        expect(mod.verifyPinHashServer('0000', firstHash)).toEqual({ valid: false, needsUpgrade: false });
    });

    it('accepts a valid legacy sha256 PIN hash only for migration', async () => {
        const mod = await import('@/lib/instant-admin');
        const legacyHash = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';

        expect(mod.verifyPinHashServer('1234', legacyHash)).toEqual({ valid: true, needsUpgrade: true });
        expect(mod.verifyPinHashServer('0000', legacyHash)).toEqual({ valid: false, needsUpgrade: false });
        expect(mod.verifyPinHashServer('1234', 'not-a-valid-hash')).toEqual({ valid: false, needsUpgrade: false });
    });

    it('upgrades a valid legacy PIN hash after successful credential verification', async () => {
        process.env.NEXT_PUBLIC_INSTANT_APP_ID = 'app_test';
        process.env.INSTANT_APP_ADMIN_TOKEN = 'admin_test';
        const legacyHash = '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4';
        const update = vi.fn().mockReturnValue({ op: 'upgrade-pin-hash' });
        const transact = vi.fn().mockResolvedValue(undefined);
        instantAdminMocks.init.mockReturnValue({
            query: vi.fn().mockResolvedValue({
                familyMembers: [{ id: 'parent-1', role: 'parent', pinHash: legacyHash }],
            }),
            tx: {
                familyMembers: {
                    'parent-1': { update },
                },
            },
            transact,
        } as any);

        const mod = await import('@/lib/instant-admin');
        await expect(mod.verifyFamilyMemberCredentials('parent-1', '1234')).resolves.toMatchObject({ id: 'parent-1' });

        expect(update).toHaveBeenCalledTimes(1);
        expect(update.mock.calls[0]?.[0]?.pinHash).toMatch(/^scrypt\$v1\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
        expect(transact).toHaveBeenCalledWith([{ op: 'upgrade-pin-hash' }]);
    });

    it('mints a shared principal token without retaining a member identity', async () => {
        process.env.NEXT_PUBLIC_INSTANT_APP_ID = 'app_test';
        process.env.INSTANT_APP_ADMIN_TOKEN = 'admin_test';
        process.env.INSTANT_KID_AUTH_EMAIL = 'kid@family-organizer.local';

        const createToken = vi.fn().mockResolvedValue('kid-token');
        const getUser = vi.fn().mockResolvedValue({ id: 'user_1' });
        const update = vi.fn().mockReturnValue({ op: 'update-user-type' });
        const transact = vi.fn().mockResolvedValue(undefined);

        instantAdminMocks.init.mockReturnValue({
            auth: {
                createToken,
                getUser,
            },
            tx: {
                $users: {
                    user_1: { update },
                },
            },
            transact,
        } as any);

        const mod = await import('@/lib/instant-admin');
        const token = await mod.mintPrincipalToken('kid');

        expect(token).toBe('kid-token');
        expect(createToken).toHaveBeenCalledWith({ email: 'kid@family-organizer.local' });
        expect(getUser).toHaveBeenCalledWith({ email: 'kid@family-organizer.local' });
        expect(update).toHaveBeenCalledWith({ type: 'kid', familyMemberId: '' });
        expect(transact).toHaveBeenCalledWith([{ op: 'update-user-type' }]);
    });
});
