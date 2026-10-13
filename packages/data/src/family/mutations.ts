import type { Row } from '../policy';
import { currentDevice } from '../powersync/current';
import { mutate } from '../powersync/mutate';
import { deleteRow, insertRow, updateRow } from '../powersync/rows';
import { askServer, waitUntilSent } from '../powersync/server';
import { all, sqlFor } from '../powersync/sql';
import type { FamilyRole, MemberPhotoUrls } from './types';

// Changes to who is in the family. Each is one local transaction: it shows on this device at once and is sent when
// it can be. Each answers with a promise, which is what is rejected when a change is not allowed or makes no sense. A PIN is the exception. Its hash never leaves the server, so setting one is asked of the server.

export interface NewFamilyMember {
    name: string;
    role: FamilyRole;
    email?: string | null;
    color?: string | null;
    photoUrls?: MemberPhotoUrls | null;
}

/** What may be changed about a member. Only what is given changes; `null` clears. */
export interface FamilyMemberChanges {
    name?: string;
    role?: FamilyRole;
    email?: string | null;
    color?: string | null;
    photoUrls?: MemberPhotoUrls | null;
    allowanceAmount?: number | null;
    allowanceCurrency?: string | null;
    allowanceRrule?: string | null;
    /** `YYYY-MM-DD`. */
    allowanceStartDate?: string | null;
    allowancePayoutDelayDays?: number;
    allowanceConfig?: Record<string, unknown> | null;
    lastDisplayCurrency?: string | null;
    viewShowChoreDescriptions?: boolean | null;
    viewShowTaskDetails?: boolean | null;
    messageQuietHoursEnabled?: boolean | null;
    /** `HH:mm`. */
    messageQuietHoursStart?: string | null;
    /** `HH:mm`. */
    messageQuietHoursEnd?: string | null;
    messageDigestMode?: 'immediate' | 'digest' | null;
    messageDigestWindowMinutes?: number | null;
    /** The envelope money goes into when nobody says. One of the member's own that is in use. */
    defaultEnvelopeId?: string | null;
}

const COLUMN_OF: Record<keyof FamilyMemberChanges, string> = {
    name: 'name',
    role: 'role',
    email: 'email',
    color: 'color',
    photoUrls: 'photo_urls',
    allowanceAmount: 'allowance_amount',
    allowanceCurrency: 'allowance_currency',
    allowanceRrule: 'allowance_rrule',
    allowanceStartDate: 'allowance_start_date',
    allowancePayoutDelayDays: 'allowance_payout_delay_days',
    allowanceConfig: 'allowance_config',
    lastDisplayCurrency: 'last_display_currency',
    viewShowChoreDescriptions: 'view_show_chore_descriptions',
    viewShowTaskDetails: 'view_show_task_details',
    messageQuietHoursEnabled: 'message_quiet_hours_enabled',
    messageQuietHoursStart: 'message_quiet_hours_start',
    messageQuietHoursEnd: 'message_quiet_hours_end',
    messageDigestMode: 'message_digest_mode',
    messageDigestWindowMinutes: 'message_digest_window_minutes',
    defaultEnvelopeId: 'default_envelope_id',
};

function nameOf(value: unknown): string {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) throw new Error('A family member needs a name.');
    return name;
}

function roleOf(value: unknown): FamilyRole {
    if (value !== 'parent' && value !== 'child') throw new Error('A family member is a parent or a child.');
    return value;
}

function toColumns(changes: FamilyMemberChanges): Row {
    const row: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(changes) as Array<[keyof FamilyMemberChanges, unknown]>) {
        const column = COLUMN_OF[field];
        if (!column || value === undefined) continue;
        row[column] = field === 'name' ? nameOf(value) : field === 'role' ? roleOf(value) : value;
    }
    return row;
}

/** Adds someone to the family, after everyone already in it. Answers with their id. */
export async function addFamilyMember(input: NewFamilyMember): Promise<string> {
    const device = currentDevice();
    const name = nameOf(input?.name);
    const role = roleOf(input.role);
    return mutate(device, 'addFamilyMember', async (writer) => {
        const places = await all(writer, sqlFor.selectFrom('family_members').select('sort_order'));
        const last = places.reduce((highest, row) => Math.max(highest, row.sort_order ?? 0), -1);
        return insertRow(device, writer, 'family_members', {
            id: device.createId(),
            name,
            role,
            email: input.email?.trim() || null,
            color: input.color ?? null,
            photo_urls: input.photoUrls ?? null,
            sort_order: last + 1,
            allowance_payout_delay_days: 0,
            allowance_config: {},
        });
    });
}

export async function updateFamilyMember(memberId: string, changes: FamilyMemberChanges): Promise<void> {
    const device = currentDevice();
    const columns = toColumns(changes);
    return mutate(device, 'updateFamilyMember', async (writer) => {
        if ((await updateRow(device, writer, 'family_members', memberId, columns)) === null) throw new Error('That family member no longer exists.');
    });
}

/** Puts the family in a new order: everyone named, in the order given, then anyone left out as they were. */
export async function reorderFamilyMembers(orderedIds: readonly string[]): Promise<void> {
    const device = currentDevice();
    return mutate(device, 'reorderFamilyMembers', async (writer) => {
        const everyone = await all(writer, sqlFor.selectFrom('family_members').select('id').orderBy('sort_order').orderBy('id'));
        const known = new Set(everyone.map((row) => row.id));
        const named = orderedIds.filter((id, index) => known.has(id) && orderedIds.indexOf(id) === index);
        const order = [...named, ...everyone.map((row) => row.id).filter((id) => !named.includes(id))];
        let place = 0;
        for (const id of order) await updateRow(device, writer, 'family_members', id, { sort_order: place++ });
    });
}

/**
 * Takes someone out of the family and closes the gap they leave in its order. What was theirs goes with them on
 * the server; their envelopes stay, with nobody's name on them, because the ledger does.
 */
export async function removeFamilyMember(memberId: string): Promise<void> {
    const device = currentDevice();
    return mutate(device, 'removeFamilyMember', async (writer) => {
        if (!(await deleteRow(device, writer, 'family_members', memberId))) return;
        // A chore is no longer theirs on this device either, without waiting to hear so.
        const theirs = await all(writer, sqlFor.selectFrom('chore_assignees').select('id').where('family_member_id', '=', memberId));
        for (const assignment of theirs) await deleteRow(device, writer, 'chore_assignees', assignment.id);
        const remaining = await all(writer, sqlFor.selectFrom('family_members').select('id').orderBy('sort_order').orderBy('id'));
        let place = 0;
        for (const row of remaining) await updateRow(device, writer, 'family_members', row.id, { sort_order: place++ });
    });
}

/**
 * Sets a member's PIN, or with `null` removes it. Only a parent may, and only with a connection: the server keeps
 * the hash and tells every device whether there is one. A member added a moment ago is waited for first.
 */
export async function setMemberPin(memberId: string, pin: string | null): Promise<void> {
    const device = currentDevice();
    await waitUntilSent(device);
    await askServer(device, '/api/auth/pin', { method: 'PUT', body: { familyMemberId: memberId, pin } });
}

/** Signs a member out of every device, at once: what a parent does when a device is lost. */
export async function signOutEverywhere(memberId: string): Promise<void> {
    await askServer(currentDevice(), `/api/auth/members/${encodeURIComponent(memberId)}/sessions`, { method: 'DELETE' });
}
