import { createChoreCompletionRecordId } from '@family-organizer/shared-core';

function completionMemberId(completion) {
  const completedBy = Array.isArray(completion?.completedBy) ? completion.completedBy[0] : completion?.completedBy;
  return completedBy?.id || null;
}

/**
 * The writes that mark a chore done for one person, in the shape the Chores
 * tab uses: the completion row, its chore and member links, and who ticked it.
 * A countdown only ever completes — it never undoes a finished chore.
 *
 * Returns `{ status: 'claimed', claimedById }` when an up-for-grabs chore was
 * already finished by someone else, `{ status: 'unchanged' }` when this person
 * has already done it, or `{ status: 'completed', transactions }`.
 */
export function buildCountdownCompletion({ tx, createId, chore, familyMemberId, executorId, dateKey, now = new Date() }) {
  const completionsOnDate = (chore.completions || []).filter((completion) => completion?.dateDue === dateKey);
  const existing = completionsOnDate.find((completion) => completionMemberId(completion) === familyMemberId);

  if (chore.isUpForGrabs) {
    const finished = completionsOnDate.filter((completion) => completion.completed);
    if (finished.length > 0 && !finished.some((completion) => completionMemberId(completion) === familyMemberId)) {
      return { status: 'claimed', claimedById: completionMemberId(finished[0]) };
    }
  }

  if (existing?.completed) return { status: 'unchanged' };

  const dateCompleted = now.toISOString();
  if (existing) {
    return {
      status: 'completed',
      transactions: [tx.choreCompletions[existing.id].update({ completed: true, notDone: false, dateCompleted })],
    };
  }

  const completionId = createChoreCompletionRecordId(chore.id, dateKey, Boolean(chore.isUpForGrabs), createId);
  const transactions = [
    tx.choreCompletions[completionId].update({
      dateDue: dateKey,
      dateCompleted,
      completed: true,
      allowanceAwarded: false,
    }),
    tx.chores[chore.id].link({ completions: completionId }),
    tx.familyMembers[familyMemberId].link({ completedChores: completionId }),
  ];
  if (executorId) {
    transactions.push(tx.familyMembers[executorId].link({ markedCompletions: completionId }));
  }
  return { status: 'completed', transactions };
}
