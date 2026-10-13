import type { Device } from './device';
import { insertRow } from './rows';
import type { Writer } from './sql';

// An entry in the family's history, written with the change it records, in the same transaction.

export interface HistoryEntry {
    domain: 'tasks' | 'chores' | 'calendar' | 'finance' | 'messages' | 'system';
    actionType: string;
    summary: string;
    /** Whom it affected. Repeats and gaps are ignored. */
    affectedMemberIds?: ReadonlyArray<string | null | undefined>;
    choreId?: string | null;
    taskSeriesId?: string | null;
    taskId?: string | null;
    calendarItemId?: string | null;
    /** The day the thing was scheduled for, `YYYY-MM-DD`. */
    scheduledFor?: string | null;
    restoreTiming?: string | null;
    /** Whatever else is needed to show it as it was. */
    metadata?: Record<string, unknown>;
}

/** Records something the signed-in person did. Answers with the entry's id. */
export async function recordHistory(device: Device, writer: Writer, entry: HistoryEntry): Promise<string> {
    const id = await insertRow(device, writer, 'history_events', {
        id: device.createId(),
        occurred_at: device.now().toISOString(),
        domain: entry.domain,
        action_type: entry.actionType,
        summary: entry.summary,
        source: 'manual',
        actor_id: device.principal.familyMemberId,
        chore_id: entry.choreId ?? null,
        task_series_id: entry.taskSeriesId ?? null,
        task_id: entry.taskId ?? null,
        calendar_item_id: entry.calendarItemId ?? null,
        scheduled_for: entry.scheduledFor ?? null,
        restore_timing: entry.restoreTiming ?? null,
        metadata: entry.metadata ?? {},
    });
    const affected = (entry.affectedMemberIds ?? []).filter((memberId, index, all): memberId is string => Boolean(memberId) && all.indexOf(memberId) === index);
    for (const memberId of affected) await insertRow(device, writer, 'history_event_members', { history_event_id: id, family_member_id: memberId });
    return id;
}
