import type { FamilyBackend } from '../family/backend';
import type { FamilyMember, MemberPhotoUrls } from '../family/types';
import type { QueryResult, ReadOptions } from '../query-result';
import type { Device } from './device';
import { useLiveRead } from './live';
import type { ClientDatabase } from './schema';
import { all, asRecord, flag, fromJson, optionalFlag, sqlFor, toMinutes } from './sql';

type MemberRow = ClientDatabase['family_members'];

const EMPTY_ROSTER: FamilyMember[] = [];

export function toFamilyMember(row: MemberRow): FamilyMember {
    return {
        id: row.id,
        name: row.name ?? '',
        role: row.role === 'parent' ? 'parent' : 'child',
        email: row.email,
        color: row.color,
        photoUrls: asRecord(fromJson(row.photo_urls)) as MemberPhotoUrls | null,
        sortOrder: row.sort_order ?? 0,
        // Every device is sent whether a PIN is set, and none is sent the PIN's hash.
        hasPin: flag(row.has_pin),
        defaultEnvelopeId: row.default_envelope_id,
        allowanceAmount: row.allowance_amount,
        allowanceCurrency: row.allowance_currency,
        allowanceRrule: row.allowance_rrule,
        allowanceStartDate: row.allowance_start_date,
        allowancePayoutDelayDays: row.allowance_payout_delay_days ?? 0,
        allowanceConfig: asRecord(fromJson(row.allowance_config)),
        lastDisplayCurrency: row.last_display_currency,
        viewShowChoreDescriptions: optionalFlag(row.view_show_chore_descriptions),
        viewShowTaskDetails: optionalFlag(row.view_show_task_details),
        messageQuietHoursEnabled: optionalFlag(row.message_quiet_hours_enabled),
        messageQuietHoursStart: toMinutes(row.message_quiet_hours_start),
        messageQuietHoursEnd: toMinutes(row.message_quiet_hours_end),
        messageDigestMode: row.message_digest_mode,
        messageDigestWindowMinutes: row.message_digest_window_minutes,
    };
}

export function createPowerSyncFamilyBackend(device: Device): FamilyBackend {
    return {
        useFamilyMembers(options?: ReadOptions): QueryResult<FamilyMember[]> {
            return useLiveRead(
                device.db,
                ['family_members'],
                (reader) => all<MemberRow>(reader, sqlFor.selectFrom('family_members').selectAll().orderBy('sort_order').orderBy('id')),
                (rows) => rows.map(toFamilyMember),
                EMPTY_ROSTER,
                [],
                options
            );
        },
    };
}
