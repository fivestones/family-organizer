import { createChoreCompletionRecordId } from '@family-organizer/shared-core';
import { buildHistoryEventTransactions } from '@/lib/history-events';

/**
 * The one way a chore is marked done or not done on the web.
 *
 * Every surface that completes a chore — the day list, the countdown, the
 * sequence view — builds its writes here, so each completion carries a history
 * event, a `markedBy` link, and the up-for-grabs "already claimed" guard.
 */

interface CompletionMemberRef {
    id?: string | null;
}

export interface ChoreCompletionRow {
    id: string;
    completed?: boolean | null;
    dateDue?: string | null;
    completedBy?: CompletionMemberRef | CompletionMemberRef[] | null;
}

export interface ChoreCompletionTarget {
    id: string;
    title?: string | null;
    isUpForGrabs?: boolean | null;
    completions?: ChoreCompletionRow[] | null;
}

export interface BuildChoreCompletionParams {
    tx: any;
    createId: () => string;
    chore: ChoreCompletionTarget;
    /** Who the completion belongs to. */
    familyMemberId: string;
    /** Who made the change, when that is someone else (a parent ticking a kid's chore). */
    executorId?: string | null;
    /** The family-day key the chore is due on, YYYY-MM-DD. */
    dateKey: string;
    /**
     * `toggle` flips the member's completion, as the day list's avatar does.
     * `done` only ever completes — a timer or a sequence view must not undo work.
     */
    intent?: 'toggle' | 'done';
    now?: Date;
}

export type ChoreCompletionChange =
    /** Up for grabs and already finished by someone else today. */
    | { status: 'claimed'; claimedById: string | null }
    /** Already done by this member; `done` intent leaves it alone. */
    | { status: 'unchanged' }
    | { status: 'completed' | 'reopened'; transactions: any[]; completionId: string; occurredAt: string };

function completionMemberId(completion: ChoreCompletionRow): string | null {
    const completedBy = Array.isArray(completion.completedBy) ? completion.completedBy[0] : completion.completedBy;
    return completedBy?.id || null;
}

export function buildChoreCompletionChange(params: BuildChoreCompletionParams): ChoreCompletionChange {
    const { tx, createId, chore, familyMemberId, dateKey } = params;
    const intent = params.intent ?? 'toggle';
    const isUpForGrabs = Boolean(chore.isUpForGrabs);
    const completionsOnDate = (chore.completions || []).filter((completion) => completion.dateDue === dateKey);
    const existing = completionsOnDate.find((completion) => completionMemberId(completion) === familyMemberId);

    if (isUpForGrabs) {
        const finished = completionsOnDate.filter((completion) => completion.completed);
        if (finished.length > 0 && !finished.some((completion) => completionMemberId(completion) === familyMemberId)) {
            return { status: 'claimed', claimedById: completionMemberId(finished[0]) };
        }
    }

    if (existing?.completed && intent === 'done') return { status: 'unchanged' };

    const occurredAt = (params.now ?? new Date()).toISOString();
    const willComplete = !existing?.completed;
    const choreTitle = chore.title || '';
    const historyEvent = buildHistoryEventTransactions({
        tx,
        createId,
        occurredAt,
        domain: 'chores',
        actionType: willComplete ? 'chore_marked_done' : 'chore_marked_undone',
        summary: willComplete ? `Completed "${choreTitle}"` : `Marked "${choreTitle}" not done`,
        source: 'manual',
        actorFamilyMemberId: params.executorId || familyMemberId,
        affectedFamilyMemberIds: [familyMemberId],
        choreId: chore.id,
        scheduledForDate: dateKey,
        metadata: { choreTitle, completed: willComplete, dateDue: dateKey },
    });

    if (existing) {
        return {
            status: willComplete ? 'completed' : 'reopened',
            completionId: existing.id,
            occurredAt,
            transactions: [
                tx.choreCompletions[existing.id].update({
                    completed: willComplete,
                    notDone: false,
                    dateCompleted: willComplete ? occurredAt : null,
                }),
                ...historyEvent.transactions,
            ],
        };
    }

    const completionId = createChoreCompletionRecordId(chore.id, dateKey, isUpForGrabs, createId);
    const transactions: any[] = [
        tx.choreCompletions[completionId].update({
            dateDue: dateKey,
            dateCompleted: occurredAt,
            completed: true,
            allowanceAwarded: false,
        }),
        tx.chores[chore.id].link({ completions: completionId }),
        tx.familyMembers[familyMemberId].link({ completedChores: completionId }),
    ];
    if (params.executorId) {
        transactions.push(tx.familyMembers[params.executorId].link({ markedCompletions: completionId }));
    }
    transactions.push(...historyEvent.transactions);

    return { status: 'completed', completionId, occurredAt, transactions };
}
