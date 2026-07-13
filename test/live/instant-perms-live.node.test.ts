import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
    id as instantId,
    init as initCore,
    InstantCoreDatabase,
    Reactor,
    StoreInterface,
} from '@instantdb/core';
import schema from '@/instant.schema';
import {
    getInstantAdminDb,
    getKidPrincipalAuthEmail,
    getParentPrincipalAuthEmail,
    mintFamilyMemberToken,
    mintPrincipalToken,
} from '@/lib/instant-admin';

const RUN_LIVE = process.env.RUN_LIVE_INSTANT_PERMS === '1';

function loadLocalEnvFile(fileName: string) {
    const filePath = path.join(process.cwd(), fileName);
    if (!existsSync(filePath)) return;

    const contents = readFileSync(filePath, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const equalsIndex = trimmed.indexOf('=');
        if (equalsIndex <= 0) continue;
        const key = trimmed.slice(0, equalsIndex).trim();
        if (!key || process.env[key] !== undefined) continue;
        let value = trimmed.slice(equalsIndex + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

type ClientDb = ReturnType<typeof initCore>;

class MemoryStorage extends StoreInterface {
    private values = new Map<string, unknown>();

    async getItem(key: string) {
        return this.values.get(key) ?? null;
    }

    async removeItem(key: string) {
        this.values.delete(key);
    }

    async multiSet(entries: Array<[string, unknown]>) {
        for (const [key, value] of entries) this.values.set(key, value);
    }

    async getAllKeys() {
        return Array.from(this.values.keys());
    }
}

class AlwaysOnlineNetworkListener {
    static async getIsOnline() {
        return true;
    }

    static listen() {
        return () => undefined;
    }
}

function requiredEnv(name: string) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required for live Instant perms smoke tests`);
    }
    return value;
}

function createClient(): ClientDb {
    const appId = process.env.INSTANT_APP_ID || process.env.NEXT_PUBLIC_INSTANT_APP_ID;
    if (!appId) {
        throw new Error('INSTANT_APP_ID or NEXT_PUBLIC_INSTANT_APP_ID is required for live Instant perms smoke tests');
    }

    const connectionConfig =
        process.env.NEXT_PUBLIC_INSTANT_API_URI && process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI
            ? {
                  apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI,
                  websocketURI: process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI,
              }
            : {};

    // `init` intentionally returns one global client per app/config, which is
    // correct in an app but wrong for a permission matrix that needs isolated
    // anonymous, kid, and parent sessions. Build independent clients with the
    // public core primitives and in-memory storage instead.
    if (typeof window === 'undefined') {
        (globalThis as any).window = { location: { href: 'https://instant-perms.test/' } };
    }

    const apiURI = connectionConfig.apiURI || 'https://api.instantdb.com';
    const websocketURI = connectionConfig.websocketURI || 'wss://api.instantdb.com/runtime/session';
    const reactor = new Reactor(
        {
            appId,
            schema,
            apiURI,
            websocketURI,
            useDateObjects: false,
            cardinalityInference: true,
        },
        MemoryStorage as any,
        AlwaysOnlineNetworkListener as any,
        { '@instantdb/core': 'live-perms-test' },
        undefined
    );

    return new InstantCoreDatabase(reactor) as ClientDb;
}

async function expectRejected(promise: Promise<unknown>, label: string) {
    let rejected = false;
    try {
        await promise;
    } catch (error) {
        rejected = true;
        expect(error).toBeTruthy();
        expect(String(error)).not.toContain('Could not evaluate permission rule');
    }

    if (!rejected) {
        throw new Error(`Expected operation to be rejected: ${label}`);
    }
}

const suite = RUN_LIVE ? describe : describe.skip;

suite('live Instant perms smoke matrix (hosted app)', () => {
    let adminDb: ReturnType<typeof getInstantAdminDb>;
    let anonDb: ClientDb;
    let kidDb: ClientDb;
    let parentDb: ClientDb;
    let kidPrincipalUserId: string;
    const cleanup = {
        calendarItems: new Set<string>(),
        allowanceTransactions: new Set<string>(),
        chores: new Set<string>(),
        choreCompletions: new Set<string>(),
        tasks: new Set<string>(),
        taskUpdates: new Set<string>(),
        taskResponseFields: new Set<string>(),
        taskResponseFieldValues: new Set<string>(),
        taskAttachments: new Set<string>(),
    };

    beforeAll(async () => {
        loadLocalEnvFile('.env.local');
        loadLocalEnvFile('.env');

        requiredEnv('INSTANT_APP_ADMIN_TOKEN');
        if (!(process.env.INSTANT_APP_ID || process.env.NEXT_PUBLIC_INSTANT_APP_ID)) {
            throw new Error('INSTANT_APP_ID or NEXT_PUBLIC_INSTANT_APP_ID is required for live Instant perms smoke tests');
        }

        adminDb = getInstantAdminDb();

        anonDb = createClient();
        kidDb = createClient();
        parentDb = createClient();

        const [kidToken, parentToken] = await Promise.all([mintPrincipalToken('kid'), mintPrincipalToken('parent')]);
        await Promise.all([kidDb.auth.signInWithToken(kidToken), parentDb.auth.signInWithToken(parentToken)]);

        const kidUser = await adminDb.auth.getUser({ email: getKidPrincipalAuthEmail() });
        await adminDb.auth.getUser({ email: getParentPrincipalAuthEmail() });
        kidPrincipalUserId = kidUser.id;
    });

    afterAll(async () => {
        const txs: any[] = [];
        for (const entryId of Array.from(cleanup.choreCompletions)) {
            txs.push(adminDb.tx.choreCompletions[entryId].delete());
        }
        for (const entryId of Array.from(cleanup.chores)) {
            txs.push(adminDb.tx.chores[entryId].delete());
        }
        for (const entryId of Array.from(cleanup.calendarItems)) {
            txs.push(adminDb.tx.calendarItems[entryId].delete());
        }
        for (const entryId of Array.from(cleanup.allowanceTransactions)) {
            txs.push(adminDb.tx.allowanceTransactions[entryId].delete());
        }
        for (const entryId of Array.from(cleanup.taskResponseFieldValues)) {
            txs.push(adminDb.tx.taskResponseFieldValues[entryId].delete());
        }
        for (const entryId of Array.from(cleanup.taskUpdates)) {
            txs.push(adminDb.tx.taskUpdates[entryId].delete());
        }
        for (const entryId of Array.from(cleanup.taskResponseFields)) {
            txs.push(adminDb.tx.taskResponseFields[entryId].delete());
        }
        for (const entryId of Array.from(cleanup.taskAttachments)) {
            txs.push(adminDb.tx.taskAttachments[entryId].delete());
        }
        for (const entryId of Array.from(cleanup.tasks)) {
            txs.push(adminDb.tx.tasks[entryId].delete());
        }
        if (txs.length > 0) {
            await adminDb.transact(txs);
        }

        anonDb?.shutdown?.();
        kidDb?.shutdown?.();
        parentDb?.shutdown?.();
    });

    it(
        'enforces a basic anonymous/kid/parent allow-deny matrix',
        async () => {
            // View rules filter unauthorized rows rather than rejecting a
            // valid query, so anonymous access must resolve to an empty roster.
            const anonymousFamilyMembersResp = await anonDb.queryOnce({ familyMembers: {} });
            expect((anonymousFamilyMembersResp.data.familyMembers as any[]) || []).toHaveLength(0);

            // The shared kid principal can read the roster but has no member identity,
            // so every PIN hash must be hidden (not only parent hashes).
            const kidFamilyMembersResp = await kidDb.queryOnce({ familyMembers: {} });
            const kidFamilyMembers = (kidFamilyMembersResp.data.familyMembers as any[]) || [];
            expect(kidFamilyMembers.length).toBeGreaterThan(0);
            const parentRows = kidFamilyMembers.filter((m) => m.role === 'parent');
            expect(kidFamilyMembers.some((m) => typeof m.pinHash === 'string' && m.pinHash.length > 0)).toBe(false);

            // Calendar sync account rows contain encrypted Apple credentials
            // and account identity; kid principals must not receive the rows.
            const kidCalendarSyncAccountsResp = await kidDb.queryOnce({ calendarSyncAccounts: {} });
            expect((kidCalendarSyncAccountsResp.data.calendarSyncAccounts as any[]) || []).toHaveLength(0);
            await expect(parentDb.queryOnce({ calendarSyncAccounts: {} })).resolves.toBeTruthy();

            // A member-scoped kid principal may update only its own safe
            // preferences and may never see a sibling's PIN hash.
            const kidMember = kidFamilyMembers.find((member) => member.role !== 'parent');
            const siblingMember = kidFamilyMembers.find((member) => member.id !== kidMember?.id);
            expect(kidMember?.id).toBeTruthy();
            expect(siblingMember?.id).toBeTruthy();

            const memberKidDb = createClient();
            const memberSession = await mintFamilyMemberToken(kidMember.id);
            await memberKidDb.auth.signInWithToken(memberSession.token);
            const originalShowTaskDetails = Boolean(kidMember.viewShowTaskDetails);

            try {
                const memberRosterResp = await memberKidDb.queryOnce({ familyMembers: {} });
                const memberRoster = (memberRosterResp.data.familyMembers as any[]) || [];
                expect(
                    memberRoster
                        .filter((member) => member.id !== kidMember.id)
                        .some((member) => typeof member.pinHash === 'string' && member.pinHash.length > 0)
                ).toBe(false);

                await memberKidDb.transact(
                    memberKidDb.tx.familyMembers[kidMember.id].update({
                        viewShowTaskDetails: !originalShowTaskDetails,
                    })
                );
                await expectRejected(
                    memberKidDb.transact(
                        memberKidDb.tx.familyMembers[siblingMember.id].update({
                            viewShowTaskDetails: true,
                        })
                    ),
                    'kid familyMembers safe update on sibling row'
                );
            } finally {
                await adminDb.transact(
                    adminDb.tx.familyMembers[kidMember.id].update({
                        viewShowTaskDetails: originalShowTaskDetails,
                    })
                );
                memberKidDb.shutdown?.();
            }

            // Kid principal cannot create parent-managed calendar items.
            const deniedCalendarId = instantId();
            await expectRejected(
                kidDb.transact(
                    kidDb.tx.calendarItems[deniedCalendarId].create({
                        dayOfMonth: 1,
                        description: 'perms smoke denied create',
                        endDate: '2026-02-25T12:00:00.000Z',
                        isAllDay: true,
                        month: 2,
                        startDate: '2026-02-25T12:00:00.000Z',
                        title: 'Kid cannot create this',
                        year: 2026,
                    })
                ),
                'kid calendarItems create'
            );

            // Parent principal can create and delete calendar items.
            const parentCalendarId = instantId();
            await parentDb.transact(
                parentDb.tx.calendarItems[parentCalendarId].create({
                    dayOfMonth: 1,
                    description: 'perms smoke parent create',
                    endDate: '2026-02-25T12:00:00.000Z',
                    isAllDay: true,
                    month: 2,
                    startDate: '2026-02-25T12:00:00.000Z',
                    title: 'Parent can create this',
                    year: 2026,
                })
            );
            cleanup.calendarItems.add(parentCalendarId);
            await parentDb.transact(parentDb.tx.calendarItems[parentCalendarId].delete());
            cleanup.calendarItems.delete(parentCalendarId);

            // Kid must stamp allowance transaction audit with the trusted DB principal id.
            const deniedAuditTxId = instantId();
            await expectRejected(
                kidDb.transact(
                    kidDb.tx.allowanceTransactions[deniedAuditTxId].create({
                        amount: 1,
                        createdAt: new Date().toISOString(),
                        createdBy: 'some-other-principal',
                        currency: 'USD',
                        description: 'invalid audit stamp',
                        transactionType: 'adjustment',
                        updatedAt: new Date().toISOString(),
                    })
                ),
                'kid allowanceTransactions create with mismatched createdBy'
            );

            const validKidTxId = instantId();
            await kidDb.transact(
                kidDb.tx.allowanceTransactions[validKidTxId].create({
                    amount: 1,
                    createdAt: new Date().toISOString(),
                    createdBy: kidPrincipalUserId,
                    currency: 'USD',
                    description: 'perms smoke valid kid tx',
                    transactionType: 'adjustment',
                    updatedAt: new Date().toISOString(),
                })
            );
            cleanup.allowanceTransactions.add(validKidTxId);

            await expectRejected(
                kidDb.transact(kidDb.tx.allowanceTransactions[validKidTxId].delete()),
                'kid allowanceTransactions delete'
            );

            await parentDb.transact(parentDb.tx.allowanceTransactions[validKidTxId].delete());
            cleanup.allowanceTransactions.delete(validKidTxId);

            // Completion ownership is identity-scoped: a member kid can create
            // and safely toggle their own row, but cannot create/update a
            // sibling row or mutate payout/date fields.
            const targetFamilyMember = parentRows[0] || kidFamilyMembers[0];
            expect(targetFamilyMember?.id).toBeTruthy();

            const choreId = instantId();
            const nowIso = new Date().toISOString();

            await parentDb.transact([
                parentDb.tx.chores[choreId].update({
                    title: 'Perms smoke chore',
                    createdAt: nowIso,
                    description: 'Kid can link completion rows',
                    startDate: '2026-02-25T00:00:00.000Z',
                    done: false,
                    rotationType: 'none',
                }),
                parentDb.tx.chores[choreId].link({ assignees: targetFamilyMember.id }),
                parentDb.tx.familyMembers[targetFamilyMember.id].link({ assignedChores: choreId }),
            ]);
            cleanup.chores.add(choreId);

            const completionKidDb = createClient();
            const completionMemberSession = await mintFamilyMemberToken(kidMember.id);
            await completionKidDb.auth.signInWithToken(completionMemberSession.token);
            try {
                const ownCompletionId = instantId();
                await completionKidDb.transact([
                    completionKidDb.tx.choreCompletions[ownCompletionId].update({
                        dateDue: '2026-02-25',
                        dateCompleted: nowIso,
                        completed: true,
                        allowanceAwarded: false,
                    }),
                    completionKidDb.tx.chores[choreId].link({ completions: ownCompletionId }),
                    completionKidDb.tx.familyMembers[kidMember.id].link({ completedChores: ownCompletionId }),
                    completionKidDb.tx.familyMembers[kidMember.id].link({ markedCompletions: ownCompletionId }),
                ]);
                cleanup.choreCompletions.add(ownCompletionId);

                await completionKidDb.transact(
                    completionKidDb.tx.choreCompletions[ownCompletionId].update({
                        completed: false,
                        notDone: true,
                        dateCompleted: null,
                    })
                );
                await expectRejected(
                    completionKidDb.transact(
                        completionKidDb.tx.choreCompletions[ownCompletionId].update({ allowanceAwarded: true })
                    ),
                    'kid choreCompletions allowanceAwarded update'
                );
                await expectRejected(
                    completionKidDb.transact(
                        completionKidDb.tx.choreCompletions[ownCompletionId].update({ dateDue: '2026-03-01' })
                    ),
                    'kid choreCompletions dateDue update'
                );

                const siblingCreateId = instantId();
                await expectRejected(
                    completionKidDb.transact(
                        completionKidDb.tx.choreCompletions[siblingCreateId].update({
                            dateDue: '2026-02-25',
                            dateCompleted: nowIso,
                            completed: true,
                            allowanceAwarded: false,
                        }).link({ chore: choreId, completedBy: siblingMember.id })
                    ),
                    'kid choreCompletions create for sibling'
                );

                const sharedKidCompletionId = instantId();
                await expectRejected(
                    kidDb.transact(
                        kidDb.tx.choreCompletions[sharedKidCompletionId].update({
                            dateDue: '2026-02-25',
                            dateCompleted: nowIso,
                            completed: true,
                            allowanceAwarded: false,
                        })
                    ),
                    'shared kid choreCompletions create without member identity'
                );

                const siblingCompletionId = instantId();
                await parentDb.transact([
                    parentDb.tx.choreCompletions[siblingCompletionId].update({
                        dateDue: '2026-02-25',
                        dateCompleted: nowIso,
                        completed: true,
                        allowanceAwarded: false,
                    }),
                    parentDb.tx.chores[choreId].link({ completions: siblingCompletionId }),
                    parentDb.tx.familyMembers[siblingMember.id].link({ completedChores: siblingCompletionId }),
                ]);
                cleanup.choreCompletions.add(siblingCompletionId);
                await expectRejected(
                    completionKidDb.transact(
                        completionKidDb.tx.choreCompletions[siblingCompletionId].update({ completed: false })
                    ),
                    'kid choreCompletions sibling update'
                );

                await parentDb.transact(
                    parentDb.tx.choreCompletions[ownCompletionId].update({ allowanceAwarded: true })
                );
            } finally {
                completionKidDb.shutdown?.();
            }
        },
        120_000
    );

    it(
        'cascades task-owned records in the hosted schema',
        async () => {
            const taskId = instantId();
            const updateId = instantId();
            const fieldId = instantId();
            const valueId = instantId();
            const attachmentId = instantId();
            const now = Date.now();

            cleanup.tasks.add(taskId);
            cleanup.taskUpdates.add(updateId);
            cleanup.taskResponseFields.add(fieldId);
            cleanup.taskResponseFieldValues.add(valueId);
            cleanup.taskAttachments.add(attachmentId);

            await adminDb.transact([
                adminDb.tx.tasks[taskId].update({
                    text: 'Cascade smoke task',
                    order: 0,
                    isDayBreak: false,
                    workflowState: 'not_started',
                }),
                adminDb.tx.taskUpdates[updateId]
                    .update({
                        createdAt: now,
                        updatedAt: now,
                        fromState: 'not_started',
                        toState: 'in_progress',
                        scheduledForDate: '2026-07-14',
                    })
                    .link({ task: taskId }),
                adminDb.tx.taskResponseFields[fieldId]
                    .update({
                        type: 'rich_text',
                        label: 'Smoke response',
                        weight: 0,
                        required: false,
                        order: 0,
                        createdAt: now,
                        updatedAt: now,
                    })
                    .link({ task: taskId }),
                adminDb.tx.taskResponseFieldValues[valueId]
                    .update({ createdAt: now, updatedAt: now, richTextContent: 'Smoke value' })
                    .link({ field: fieldId }),
                adminDb.tx.taskAttachments[attachmentId].update({
                    createdAt: new Date(now),
                    updatedAt: new Date(now),
                    name: 'smoke.txt',
                    type: 'text/plain',
                    url: 'task-cascade-smoke/smoke.txt',
                }),
                adminDb.tx.tasks[taskId].link({ attachments: attachmentId }),
            ]);

            await adminDb.transact(adminDb.tx.tasks[taskId].delete());

            const result = await adminDb.query({
                tasks: { $: { where: { id: taskId } } },
                taskUpdates: { $: { where: { id: updateId } } },
                taskResponseFields: { $: { where: { id: fieldId } } },
                taskResponseFieldValues: { $: { where: { id: valueId } } },
                taskAttachments: { $: { where: { id: attachmentId } } },
            });

            expect(result.tasks || []).toHaveLength(0);
            expect(result.taskUpdates || []).toHaveLength(0);
            expect(result.taskResponseFields || []).toHaveLength(0);
            expect(result.taskResponseFieldValues || []).toHaveLength(0);
            expect(result.taskAttachments || []).toHaveLength(0);

            cleanup.tasks.delete(taskId);
            cleanup.taskUpdates.delete(updateId);
            cleanup.taskResponseFields.delete(fieldId);
            cleanup.taskResponseFieldValues.delete(valueId);
            cleanup.taskAttachments.delete(attachmentId);
        },
        120_000
    );
});
