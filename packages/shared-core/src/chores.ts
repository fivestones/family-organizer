import { RRule } from 'rrule';
import { createRRuleWithStartDate, toUTCDate } from './date';

export interface SharedChoreAssignee {
  id: string;
  name?: string;
}

export interface SharedChoreAssignment {
  order: number;
  familyMember:
    | SharedChoreAssignee
    | SharedChoreAssignee[]
    | null
    | undefined;
}

export interface SharedChoreCompletion {
  id: string;
  completed?: boolean;
  dateDue?: string | null;
  dateCompleted?: string | null;
  completedBy?: { id?: string | null } | { id?: string | null }[] | null;
}

export interface SharedChoreLike {
  id: string;
  title?: string | null;
  description?: string | null;
  startDate: string | Date;
  rrule?: string | null;
  weight?: number | null;
  rewardType?: 'fixed' | 'weight' | string | null;
  rotationType?: 'none' | 'daily' | 'weekly' | 'monthly' | string | null;
  isJoint?: boolean | null;
  isUpForGrabs?: boolean | null;
  assignees?: SharedChoreAssignee[] | null;
  assignments?: SharedChoreAssignment[] | null;
  completions?: SharedChoreCompletion[] | null;
}

export interface SharedXpStats {
  current: number;
  possible: number;
}

export interface SharedFamilyMemberLike {
  id: string;
  name?: string | null;
}

function isSameUtcDay(date1: Date, date2: Date): boolean {
  return (
    date1.getUTCFullYear() === date2.getUTCFullYear() &&
    date1.getUTCMonth() === date2.getUTCMonth() &&
    date1.getUTCDate() === date2.getUTCDate()
  );
}

function getRotationIndex(
  startDate: Date,
  occurrenceDate: Date,
  rotationType: string | null | undefined,
  rrule?: RRule | null
): number {
  if (!rotationType || rotationType === 'none') return 0;

  const utcStartDate = toUTCDate(startDate);
  const utcOccurrenceDate = toUTCDate(occurrenceDate);

  switch (rotationType) {
    case 'daily': {
      const oneDay = 24 * 60 * 60 * 1000;
      return Math.max(0, Math.floor((utcOccurrenceDate.getTime() - utcStartDate.getTime()) / oneDay));
    }
    case 'weekly': {
      const oneWeek = 7 * 24 * 60 * 60 * 1000;
      return Math.max(0, Math.floor((utcOccurrenceDate.getTime() - utcStartDate.getTime()) / oneWeek));
    }
    case 'monthly': {
      return Math.max(
        0,
        (utcOccurrenceDate.getUTCFullYear() - utcStartDate.getUTCFullYear()) * 12 +
          (utcOccurrenceDate.getUTCMonth() - utcStartDate.getUTCMonth())
      );
    }
    default: {
      if (rrule) {
        const allOccurrences = rrule.between(utcStartDate, utcOccurrenceDate, true);
        return Math.max(0, allOccurrences.length - 1);
      }
      return 0;
    }
  }
}

function normalizeFamilyMember(
  value: SharedChoreAssignee | SharedChoreAssignee[] | null | undefined
): SharedChoreAssignee | null {
  if (!value) return null;
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.id) return null;
  return { id: candidate.id, name: candidate.name };
}

export function getAssignedMembersForChoreOnDate(chore: SharedChoreLike, date: Date): SharedChoreAssignee[] {
  const utcDate = toUTCDate(date);
  const choreStartDate = toUTCDate(chore.startDate);

  if (!chore.rrule) {
    return isSameUtcDay(choreStartDate, utcDate) ? [...(chore.assignees || [])] : [];
  }

  const rrule = createRRuleWithStartDate(chore.rrule, choreStartDate);
  if (!rrule) return [];

  const dayStart = new Date(utcDate);
  const dayEnd = new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate() + 1));
  dayEnd.setUTCMilliseconds(dayEnd.getUTCMilliseconds() - 1);

  const occurrencesOnDate = rrule.between(dayStart, dayEnd, true);
  if (occurrencesOnDate.length === 0) return [];

  const usesRotation =
    chore.rotationType &&
    chore.rotationType !== 'none' &&
    !chore.isUpForGrabs &&
    Array.isArray(chore.assignments) &&
    chore.assignments.length > 0;

  if (!usesRotation) {
    return (chore.assignees || []).map((a) => ({ id: a.id, name: a.name }));
  }

  const sortedAssignments = [...(chore.assignments || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  if (sortedAssignments.length === 0) return [];

  const rotationIndex = getRotationIndex(choreStartDate, utcDate, chore.rotationType, rrule);
  const assignmentIndex = rotationIndex % sortedAssignments.length;
  const assigned = normalizeFamilyMember(sortedAssignments[assignmentIndex]?.familyMember);
  return assigned ? [assigned] : [];
}

export function formatDateKeyUTC(date: Date): string {
  const utc = toUTCDate(date);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, '0');
  const d = String(utc.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCompletedChoreCompletionsForDate(chore: SharedChoreLike, date: Date): SharedChoreCompletion[] {
  const dateKey = formatDateKeyUTC(date);
  return (chore.completions || []).filter((completion) => completion?.completed && completion?.dateDue === dateKey);
}

export function getMemberCompletionForDate(
  chore: SharedChoreLike,
  familyMemberId: string,
  date: Date
): SharedChoreCompletion | null {
  const dateKey = formatDateKeyUTC(date);
  return (
    (chore.completions || []).find((completion) => {
      if (completion?.dateDue !== dateKey) return false;
      const completedBy = Array.isArray(completion?.completedBy) ? completion.completedBy[0] : completion?.completedBy;
      return completedBy?.id === familyMemberId;
    }) || null
  );
}

export function isChoreDueOnDate(chore: SharedChoreLike, date: Date): boolean {
  return getAssignedMembersForChoreOnDate(chore, date).length > 0;
}

function getCompletionMemberId(completion: SharedChoreCompletion | null | undefined): string | null {
  if (!completion) return null;
  const completedBy = Array.isArray(completion.completedBy) ? completion.completedBy[0] : completion.completedBy;
  return completedBy?.id || null;
}

/**
 * Calculates per-member XP for a single date using the same chore assignment/completion semantics
 * as the web app (weight-based chores only; fixed rewards do not contribute to XP).
 */
export function calculateDailyXP(
  chores: SharedChoreLike[],
  familyMembers: SharedFamilyMemberLike[],
  date: Date
): Record<string, SharedXpStats> {
  const xpMap: Record<string, SharedXpStats> = {};
  for (const member of familyMembers) {
    if (!member?.id) continue;
    xpMap[member.id] = { current: 0, possible: 0 };
  }

  for (const chore of chores || []) {
    if (!chore?.id) continue;
    if (chore.rewardType === 'fixed') continue;

    const weight = Number(chore.weight || 0);
    if (!Number.isFinite(weight) || weight === 0) continue;

    const assignedMembers = getAssignedMembersForChoreOnDate(chore, date);
    if (assignedMembers.length === 0) continue;

    const completionsForDate = getCompletedChoreCompletionsForDate(chore, date);

    if (chore.isUpForGrabs) {
      if (completionsForDate.length > 0) {
        for (const completion of completionsForDate) {
          const completerId = getCompletionMemberId(completion);
          if (!completerId || !xpMap[completerId]) continue;
          if (weight > 0) xpMap[completerId].possible += weight;
          xpMap[completerId].current += weight;
        }
      } else {
        for (const assignee of assignedMembers) {
          if (!xpMap[assignee.id]) continue;
          if (weight > 0) xpMap[assignee.id].possible += weight;
        }
      }
      continue;
    }

    for (const assignee of assignedMembers) {
      if (!xpMap[assignee.id]) continue;
      if (weight > 0) xpMap[assignee.id].possible += weight;
      const hasCompleted = completionsForDate.some((completion) => getCompletionMemberId(completion) === assignee.id);
      if (hasCompleted) {
        xpMap[assignee.id].current += weight;
      }
    }
  }

  return xpMap;
}
