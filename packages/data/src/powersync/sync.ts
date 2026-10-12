import { toServerForm, type RefusalReason } from '../policy';
import type { QueryResult, ReadOptions } from '../query-result';
import type { SyncBackend } from '../sync/backend';
import type { Refusal } from '../sync/types';
import type { Device } from './device';
import { useLiveRead } from './live';
import { ensureUpdate, mutate } from './mutate';
import type { ClientDatabase } from './schema';
import { all, first, run, sqlFor } from './sql';

type RefusalRow = ClientDatabase['write_refusals'];

const NONE: readonly Refusal[] = [];
const REASONS: readonly RefusalReason[] = ['not_allowed', 'not_yours', 'column_not_allowed', 'already_claimed', 'invalid', 'conflict'];

const toRefusal = (row: RefusalRow): Refusal => ({
    id: row.id,
    familyMemberId: row.family_member_id,
    mutation: row.mutation,
    reason: REASONS.includes(row.reason as RefusalReason) ? (row.reason as RefusalReason) : 'not_allowed',
    tableName: row.table_name,
    rowId: row.row_id,
    refusedAt: row.refused_at ?? '',
});

export function createPowerSyncSyncBackend(device: Device): SyncBackend {
    return {
        useRefusals(options?: ReadOptions): QueryResult<readonly Refusal[]> {
            return useLiveRead(
                device.db,
                ['write_refusals'],
                (reader) => all<RefusalRow>(reader, sqlFor.selectFrom('write_refusals').selectAll().where('dismissed_at', 'is', null).orderBy('refused_at', 'desc')),
                (rows): readonly Refusal[] => rows.map(toRefusal),
                NONE,
                [],
                options
            );
        },

        dismissRefusal(refusalId: string): Promise<void> {
            return mutate(device, 'dismissRefusal', async (writer) => {
                const current = await first<RefusalRow>(writer, sqlFor.selectFrom('write_refusals').selectAll().where('id', '=', refusalId));
                if (!current || current.dismissed_at !== null) return;
                const dismissedAt = device.now().toISOString();
                ensureUpdate(device, 'write_refusals', toServerForm('write_refusals', current), { dismissed_at: dismissedAt });
                await run(writer, sqlFor.updateTable('write_refusals').set({ dismissed_at: dismissedAt }).where('id', '=', refusalId));
            });
        },
    };
}
