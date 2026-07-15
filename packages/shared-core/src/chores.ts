import { RRule, RRuleSet } from 'rrule';
import { v5 as uuidv5 } from 'uuid';
import { toUTCDate } from './date';

const UP_FOR_GRABS_COMPLETION_NAMESPACE = 'f57d1ba6-d981-4cd3-b3d7-83e2c7349851';
const OCCURRENCE_SET_CACHE_LIMIT = 128;
const OCCURRENCE_RANGE_CACHE_LIMIT = 256;
const ROTATION_INDEX_CACHE_LIMIT = 512;
const occurrenceSetCache = new Map<string, RRuleSet | null>();
const occurrenceRangeCache = new Map<string, number[]>();
const rotationIndexCache = new Map<string, number>();

function readOccurrenceSetCache(key: string): RRuleSet | null | undefined {
  if (!occurrenceSetCache.has(key)) return undefined;
  const value = occurrenceSetCache.get(key) ?? null;
  occurrenceSetCache.delete(key);
  occurrenceSetCache.set(key, value);
  return value;
}

function writeOccurrenceSetCache(key: string, value: RRuleSet | null) {
  occurrenceSetCache.set(key, value);
  if (occurrenceSetCache.size > OCCURRENCE_SET_CACHE_LIMIT) {
    const oldestKey = occurrenceSetCache.keys().next().value;
    if (oldestKey) occurrenceSetCache.delete(oldestKey);
  }
  return value;
}

function readNumberArrayCache(cache: Map<string, number[]>, key: string): Date[] | null {
  const value = cache.get(key);
  if (!value) return null;
  cache.delete(key);
  cache.set(key, value);
  return value.map((timestamp) => new Date(timestamp));
}

function writeNumberArrayCache(cache: Map<string, number[]>, key: string, value: Date[], limit: number) {
  cache.set(key, value.map((entry) => entry.getTime()));
  if (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  return value;
}

function readRotationIndexCache(key: string): number | undefined {
  const value = rotationIndexCache.get(key);
  if (value === undefined) return undefined;
  rotationIndexCache.delete(key);
  rotationIndexCache.set(key, value);
  return value;
}

function writeRotationIndexCache(key: string, value: number) {
  rotationIndexCache.set(key, value);
  if (rotationIndexCache.size > ROTATION_INDEX_CACHE_LIMIT) {
    const oldestKey = rotationIndexCache.keys().next().value;
    if (oldestKey) rotationIndexCache.delete(oldestKey);
  }
  return value;
}

export function createChoreCompletionRecordId(
  choreId: string,
  dateKey: string,
  isUpForGrabs: boolean,
  createId: () => string,
) {
  if (!isUpForGrabs) return createId();

  const normalizedChoreId = String(choreId || '').trim();
  const normalizedDateKey = String(dateKey || '').trim();
  if (!normalizedChoreId || !/^\d{4}-\d{2}-\d{2}$/.test(normalizedDateKey)) {
    throw new Error('A chore id and YYYY-MM-DD date are required for an up-for-grabs completion');
  }

  return uuidv5(`${normalizedChoreId}:${normalizedDateKey}`, UP_FOR_GRABS_COMPLETION_NAMESPACE);
}

export function pickCanonicalChoreCompletion<T extends { id?: string | null; dateCompleted?: string | null }>(
  completions: T[],
): T | null {
  if (completions.length === 0) return null;
  return [...completions].sort((left, right) => {
    const leftTime = new Date(left.dateCompleted || '').getTime();
    const rightTime = new Date(right.dateCompleted || '').getTime();
    const normalizedLeftTime = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
    const normalizedRightTime = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
    if (normalizedLeftTime !== normalizedRightTime) return normalizedLeftTime - normalizedRightTime;
    return String(left.id || '').localeCompare(String(right.id || ''));
  })[0];
}

export interface SharedChoreAssignee {
  id: string;
  name?: string;
  color?: string | null;
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
  exdates?: string[] | null;
  sortOrder?: number | null;
  timeBucket?: string | null;
  timingMode?: string | null;
  timingConfig?: unknown;
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

function normalizeDateOnlyList(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((entry) => String(entry || '').trim())
        .filter(Boolean)
    )
  ).sort();
}

function parseExdateTokenToDateOnly(value: string): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{8}$/.test(trimmed)) {
    return `${trimmed.slice(0, 4)}-${trimmed.slice(4, 6)}-${trimmed.slice(6, 8)}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(parsed.getUTCDate()).padStart(2, '0')}`;
}

function normalizeChoreExdates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return normalizeDateOnlyList(
    value
      .map((entry) => parseExdateTokenToDateOnly(String(entry || '')))
      .filter(Boolean) as string[]
  );
}

function getOccurrenceSetCacheKey(chore: Pick<SharedChoreLike, 'rrule' | 'startDate' | 'exdates'>): string | null {
  const normalizedRrule = String(chore.rrule || '').replace(/^RRULE:/i, '').trim();
  if (!normalizedRrule) return null;
  return JSON.stringify([
    normalizedRrule,
    formatDateKeyUTC(toUTCDate(chore.startDate)),
    normalizeChoreExdates(chore.exdates),
  ]);
}

function createOccurrenceSet(chore: Pick<SharedChoreLike, 'rrule' | 'startDate' | 'exdates'>): RRuleSet | null {
  const normalizedRrule = String(chore.rrule || '').replace(/^RRULE:/i, '').trim();
  if (!normalizedRrule) return null;

  const normalizedExdates = normalizeChoreExdates(chore.exdates);
  const dtstart = toUTCDate(chore.startDate);
  const cacheKey = getOccurrenceSetCacheKey(chore)!;
  const cached = readOccurrenceSetCache(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const ruleOptions = RRule.parseString(normalizedRrule);
    const set = new RRuleSet();
    set.rrule(
      new RRule({
        ...ruleOptions,
        dtstart,
      }) as any
    );

    for (const exdate of normalizedExdates) {
      set.exdate(new Date(`${exdate}T00:00:00Z`));
    }

    return writeOccurrenceSetCache(cacheKey, set);
  } catch {
    return writeOccurrenceSetCache(cacheKey, null);
  }
}

function getChoreOccurrencesInRange(chore: SharedChoreLike, start: Date, end: Date): Date[] {
  const utcStart = toUTCDate(start);
  const utcEnd = toUTCDate(end);
  if (utcEnd.getTime() < utcStart.getTime()) return [];

  const scheduleKey = getOccurrenceSetCacheKey(chore);
  const rangeKey = scheduleKey ? JSON.stringify([scheduleKey, utcStart.getTime(), utcEnd.getTime()]) : null;
  if (rangeKey) {
    const cached = readNumberArrayCache(occurrenceRangeCache, rangeKey);
    if (cached) return cached;
  }

  const occurrenceSet = createOccurrenceSet(chore);
  if (!occurrenceSet) {
    if (String(chore.rrule || '').trim()) {
      return rangeKey
        ? writeNumberArrayCache(occurrenceRangeCache, rangeKey, [], OCCURRENCE_RANGE_CACHE_LIMIT)
        : [];
    }
    const choreDate = toUTCDate(chore.startDate);
    const time = choreDate.getTime();
    return time >= utcStart.getTime() && time <= utcEnd.getTime() ? [choreDate] : [];
  }

  const occurrences = occurrenceSet.between(utcStart, utcEnd, true).map((entry) => toUTCDate(entry));
  return rangeKey
    ? writeNumberArrayCache(occurrenceRangeCache, rangeKey, occurrences, OCCURRENCE_RANGE_CACHE_LIMIT)
    : occurrences;
}

function getRotationIndex(
  chore: SharedChoreLike,
  occurrenceDate: Date,
  rotationType: string | null | undefined
): number {
  if (!rotationType || rotationType === 'none') return 0;

  const utcStartDate = toUTCDate(chore.startDate);
  const utcOccurrenceDate = toUTCDate(occurrenceDate);
  const scheduleKey = getOccurrenceSetCacheKey(chore);
  const rotationCacheKey = scheduleKey
    ? JSON.stringify([scheduleKey, rotationType, utcOccurrenceDate.getTime()])
    : null;
  if (rotationCacheKey) {
    const cached = readRotationIndexCache(rotationCacheKey);
    if (cached !== undefined) return cached;
  }
  const actualOccurrences = getChoreOccurrencesInRange(chore, utcStartDate, utcOccurrenceDate);

  if (actualOccurrences.length === 0) {
    return rotationCacheKey ? writeRotationIndexCache(rotationCacheKey, 0) : 0;
  }

  let rotationIndex = 0;
  switch (rotationType) {
    case 'daily': {
      rotationIndex = Math.max(0, actualOccurrences.length - 1);
      break;
    }
    case 'weekly': {
      const weekBuckets = new Set(
        actualOccurrences.map((entry) => {
          const diffDays = Math.floor((entry.getTime() - utcStartDate.getTime()) / 86400000);
          return Math.floor(diffDays / 7);
        })
      );
      rotationIndex = Math.max(0, weekBuckets.size - 1);
      break;
    }
    case 'monthly': {
      const monthBuckets = new Set(
        actualOccurrences.map(
          (entry) =>
            (entry.getUTCFullYear() - utcStartDate.getUTCFullYear()) * 12 +
            (entry.getUTCMonth() - utcStartDate.getUTCMonth())
        )
      );
      rotationIndex = Math.max(0, monthBuckets.size - 1);
      break;
    }
    default: {
      rotationIndex = 0;
    }
  }
  return rotationCacheKey ? writeRotationIndexCache(rotationCacheKey, rotationIndex) : rotationIndex;
}

function normalizeFamilyMember(
  value: SharedChoreAssignee | SharedChoreAssignee[] | null | undefined
): SharedChoreAssignee | null {
  if (!value) return null;
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate?.id) return null;
  return { id: candidate.id, name: candidate.name, color: candidate.color ?? null };
}

export function getAssignedMembersForChoreOnDate(chore: SharedChoreLike, date: Date): SharedChoreAssignee[] {
  const utcDate = toUTCDate(date);
  const choreStartDate = toUTCDate(chore.startDate);

  if (!String(chore.rrule || '').trim()) {
    return isSameUtcDay(choreStartDate, utcDate) ? [...(chore.assignees || [])] : [];
  }

  const occurrencesOnDate = getChoreOccurrencesInRange(chore, utcDate, utcDate);
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

  const rotationIndex = getRotationIndex(chore, utcDate, chore.rotationType);
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

    const completionsForDate = getCompletedChoreCompletionsForDate(chore, date);
    const assignedMembers = getAssignedMembersForChoreOnDate(chore, date);

    if (chore.isUpForGrabs) {
      if (completionsForDate.length > 0) {
        const completion = pickCanonicalChoreCompletion(completionsForDate);
        const completerId = getCompletionMemberId(completion);
        if (!completerId || !xpMap[completerId]) continue;
        if (weight > 0) xpMap[completerId].possible += weight;
        xpMap[completerId].current += weight;
      } else {
        for (const assignee of assignedMembers) {
          if (!xpMap[assignee.id]) continue;
          if (weight > 0) xpMap[assignee.id].possible += weight;
        }
      }
      continue;
    }

    // `completedBy` is the durable beneficiary snapshot. If a later schedule
    // edit adds an exdate or changes rotation, keep historical earned XP with
    // the member whose completion row was recorded on that due date.
    const effectiveAssignees = [...assignedMembers];
    const effectiveAssigneeIds = new Set(effectiveAssignees.map((assignee) => assignee.id));
    for (const completion of completionsForDate) {
      const completedById = getCompletionMemberId(completion);
      if (completedById && !effectiveAssigneeIds.has(completedById)) {
        effectiveAssigneeIds.add(completedById);
        effectiveAssignees.push({ id: completedById });
      }
    }

    for (const assignee of effectiveAssignees) {
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
