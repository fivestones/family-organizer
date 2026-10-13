import 'server-only';

import { randomUUID } from 'crypto';
import type { Transaction } from 'kysely';
import type { Database, HistoryEventsTable } from '@/db/types';
import { jsonb, type AppDatabase } from './db';

// The family's history, as the server writes to it: an entry for something a route did on someone's behalf.

export interface HistoryEntry {
    /** Given when the entry must be the same entry however often it is written. Random otherwise. */
    id?: string;
    occurredAt: Date | string;
    domain: HistoryEventsTable['domain'];
    actionType: string;
    summary: string;
    /** `manual` for a person using the app. */
    source?: string | null;
    /** Who did it. */
    actorId?: string | null;
    /** Whom it affected. Repeats and gaps are ignored. */
    affectedMemberIds?: ReadonlyArray<string | null | undefined>;
    allowanceTransactionId?: string | null;
    messageThreadId?: string | null;
    messageId?: string | null;
    calendarItemId?: string | null;
    /** Whatever else is needed to show it as it was. */
    metadata?: Record<string, unknown>;
}

/** Writes an entry and whom it affected. An entry already there under its id is left as it is. */
export async function recordHistory(db: Transaction<Database> | AppDatabase, entry: HistoryEntry): Promise<string> {
    const id = entry.id ?? randomUUID();
    const written = await db
        .insertInto('history_events')
        .values({
            id,
            occurred_at: entry.occurredAt,
            domain: entry.domain,
            action_type: entry.actionType,
            summary: entry.summary,
            source: entry.source ?? null,
            actor_id: entry.actorId ?? null,
            allowance_transaction_id: entry.allowanceTransactionId ?? null,
            message_thread_id: entry.messageThreadId ?? null,
            message_id: entry.messageId ?? null,
            calendar_item_id: entry.calendarItemId ?? null,
            metadata: jsonb(entry.metadata ?? {}),
        })
        .onConflict((conflict) => conflict.column('id').doNothing())
        .returning('id')
        .executeTakeFirst();
    const affected = Array.from(new Set((entry.affectedMemberIds ?? []).filter((memberId): memberId is string => Boolean(memberId))));
    if (written && affected.length > 0) {
        await db
            .insertInto('history_event_members')
            .values(affected.map((memberId) => ({ history_event_id: id, family_member_id: memberId })))
            .execute();
    }
    return id;
}
