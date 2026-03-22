import 'server-only';

import { id } from '@instantdb/admin';
import {
    HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
    getFamilyDayDateUTC,
    getNextChoreSortOrder,
    parseSharedScheduleSettings,
} from '@family-organizer/shared-core';
import { getFamilyMemberById, getInstantAdminDb, listFamilyMemberRoster } from '@/lib/instant-admin';

export type ShortcutFamilyMember = {
    id: string;
    name: string;
    role: string;
    photoUrls?: Record<string, string> | null;
};

export async function listMobileShortcutFamilyMembers(): Promise<ShortcutFamilyMember[]> {
    const roster = await listFamilyMemberRoster();
    return roster.map((member) => ({
        id: member.id,
        name: member.name,
        role: member.role || 'child',
        photoUrls: member.photoUrls || null,
    }));
}

export async function createTodayAnytimeShortcutChore(input: {
    title: string;
    assigneeFamilyMemberId: string;
}) {
    const title = String(input.title || '').trim();
    if (!title) {
        throw new Error('Title is required');
    }

    const assigneeFamilyMemberId = String(input.assigneeFamilyMemberId || '').trim();
    if (!assigneeFamilyMemberId) {
        throw new Error('assigneeFamilyMemberId is required');
    }

    const assignee = await getFamilyMemberById(assigneeFamilyMemberId);
    if (!assignee?.id) {
        throw new Error('Assignee not found');
    }

    const adminDb = getInstantAdminDb();
    const data = await adminDb.query({
        chores: {},
        settings: {},
    });

    const settingsRows = ((data as any)?.settings || []) as Array<{ name?: string | null; value?: string | null }>;
    const scheduleRow = settingsRows.find((row) => String(row?.name || '') === HOUSEHOLD_SCHEDULE_SETTINGS_NAME) || null;
    const scheduleSettings = parseSharedScheduleSettings(scheduleRow?.value || null);
    const familyDay = getFamilyDayDateUTC(new Date(), scheduleSettings);
    const dateKey = familyDay.toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const choreId = id();
    const chores = (((data as any)?.chores || []) as Array<{ sortOrder?: number | null }>) || [];
    const sortOrder = getNextChoreSortOrder(chores as any);

    await adminDb.transact([
        adminDb.tx.chores[choreId].update({
            createdAt: nowIso,
            description: '',
            done: false,
            exdates: [],
            isJoint: false,
            isUpForGrabs: false,
            pauseState: null,
            rewardAmount: null,
            rewardCurrency: null,
            rewardType: null,
            rotationType: 'none',
            rrule: null,
            sortOrder,
            startDate: `${dateKey}T00:00:00.000Z`,
            timeBucket: null,
            timingConfig: { mode: 'anytime' },
            timingMode: 'anytime',
            title,
            weight: 0,
        }),
        adminDb.tx.chores[choreId].link({ assignees: assignee.id }),
        adminDb.tx.familyMembers[assignee.id].link({ assignedChores: choreId }),
    ]);

    return {
        choreId,
        title,
        assigneeFamilyMemberId: assignee.id,
        dateKey,
    };
}
