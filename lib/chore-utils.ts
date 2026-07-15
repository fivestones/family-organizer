import { RRule, Frequency } from 'rrule';
import { tx, id } from '@instantdb/react';
import { db } from '@/lib/db';
import type { ChorePauseState } from '@/lib/chore-schedule';
import { getChoreOccurrencesInRange } from '@/lib/chore-schedule';
import { resolveOneLink } from '@/lib/instant-links';
import {
    calculateDailyXP as calculateSharedDailyXP,
    getAssignedMembersForChoreOnDate as getSharedAssignedMembersForChoreOnDate,
    pickCanonicalChoreCompletion,
} from '@family-organizer/shared-core';

// --- Type Definitions (Refine based on actual schema/data structure) ---
export interface Chore {
    id: string;
    title: string;
    description?: string | null;
    startDate: string; // ISO string date
    rrule?: string | null;
    exdates?: string[] | null;
    pauseState?: ChorePauseState | null;
    weight?: number | null;
    rotationType: 'none' | 'daily' | 'weekly' | 'monthly';
    assignees: { id: string; name?: string; color?: string | null }[]; // Simplified assignee type
    assignments?: {
        // For rotation
        order: number;
        familyMember: { id: string; name?: string; color?: string | null };
    }[];
    completions?: ChoreCompletion[]; // Link to completions
    // +++ Up for Grabs fields +++
    estimatedDurationSecs?: number | null;
    isJoint?: boolean | null;
    isUpForGrabs?: boolean | null;
    rewardType?: 'fixed' | 'weight' | null;
    rewardAmount?: number | null;
    rewardCurrency?: string | null;
}

export interface ChoreCompletion {
    id: string;
    completed: boolean;
    dateDue: string; // ISO string date
    completedBy?: { id: string } | { id: string }[]; // Link to family member
    allowanceAwarded?: boolean;
    dateCompleted?: string;
    chore?: { id: string; weight?: number | null } | { id: string; weight?: number | null }[]; // Optional link back to chore with weight
}

export function buildUpForGrabsClaimDeduplication(
    completions: ChoreCompletion[],
    chores: Chore[]
) {
    const choresById = new Map(chores.map((chore) => [chore.id, chore]));
    const groups = new Map<string, ChoreCompletion[]>();

    for (const completion of completions) {
        if (!completion.completed || !completion.dateDue) continue;
        const choreRef = resolveOneLink(completion.chore);
        if (!choreRef?.id || !choresById.get(choreRef.id)?.isUpForGrabs) continue;
        const key = `${choreRef.id}:${completion.dateDue}`;
        const group = groups.get(key) || [];
        group.push(completion);
        groups.set(key, group);
    }

    const supersededCompletionIds = new Set<string>();
    const completionIdsByWinnerId = new Map<string, string[]>();
    for (const group of Array.from(groups.values())) {
        const winner = pickCanonicalChoreCompletion(group);
        if (!winner?.id) continue;
        const completionIds = group.map((completion) => completion.id);
        completionIdsByWinnerId.set(winner.id, completionIds);
        for (const completionId of completionIds) {
            if (completionId !== winner.id) supersededCompletionIds.add(completionId);
        }
    }

    return {
        supersededCompletionIds,
        completionIdsByWinnerId,
    };
}

export function expandUpForGrabsAwardCompletionIds(
    completionIds: string[],
    completionIdsByWinnerId: ReadonlyMap<string, string[]>
) {
    return Array.from(
        new Set(
            completionIds.flatMap(
                (completionId) => completionIdsByWinnerId.get(completionId) || [completionId]
            )
        )
    );
}

interface FamilyMember {
    id: string;
    name?: string;
    color?: string | null;
    // Add other relevant fields
}

interface CalculatedPeriod {
    id: string; // Unique identifier for the period cache entry (e.g., memberId-startDate)
    familyMemberId: string;
    periodStartDate: Date;
    periodEndDate: Date;
    totalWeight: number;
    completedWeight: number;
    percentage: number;
    calculatedAmount: number;
    lastCalculatedAt: Date;
    isStale: boolean;
    status?: 'pending' | 'calculated' | 'skipped' | 'distributed' | 'in-progress'; // Optional status
    completionsToMark: string[]; // IDs of completions covered by this period calculation
    // +++ Track fixed rewards +++
    fixedRewardsEarned: { [currency: string]: number };
    // +++ Track percentage contribution from up-for-grabs weight chores +++
    upForGrabsContributionPercentage: number;
}

// --- Existing Utility Functions (Keep as they are) ---

export function createRRule(ruleObject: Partial<RRule.Options>) {
    if (!ruleObject || typeof ruleObject !== 'object') {
        throw new Error('Invalid rule object provided');
    }

    const options: RRule.Options = {
        freq: Frequency.DAILY, // Default frequency
        interval: 1, // Default interval
        ...ruleObject,
    };

    const freq = (ruleObject as any).freq;

    // Handle the freq property
    if (typeof freq === 'string') {
        const upperFreq = freq.toUpperCase();
        options.freq = (Frequency[upperFreq as keyof typeof Frequency] as Frequency) || Frequency.DAILY;
    } else if (typeof freq === 'number') {
        // Ensure the number is a valid Frequency enum value
        options.freq = Object.values(Frequency).includes(freq) ? freq : Frequency.DAILY;
    } else {
        options.freq = Frequency.DAILY;
    }

    if (options.dtstart && !(options.dtstart instanceof Date)) {
        options.dtstart = new Date(options.dtstart);
    }

    if (options.until && !(options.until instanceof Date)) {
        options.until = new Date(options.until);
    }

    return new RRule(options);
}

export function toUTCDate(date: Date | string | number): Date {
    const d = new Date(date);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function createRRuleWithStartDate(rruleString: string | null | undefined, startDateString: string | Date): RRule | null {
    if (!rruleString) return null; // Return null if no rule string

    const startDate = toUTCDate(startDateString);

    // Remove any potential 'RRULE:' prefix
    const cleanRruleString = rruleString.replace(/^RRULE:/, '');

    try {
        const rruleOptions = RRule.parseString(cleanRruleString);
        return new RRule({
            ...rruleOptions,
            dtstart: startDate,
        });
    } catch (error) {
        console.error(`Error parsing RRULE "${rruleString}" with start date ${startDate.toISOString()}:`, error);
        // Optionally return a default or null based on desired error handling
        return null; // Indicate parsing failure
    }
}

export const getAssignedMembersForChoreOnDate = (
    chore: Chore,
    date: Date
): { id: string; name?: string; color?: string | null }[] =>
    getSharedAssignedMembersForChoreOnDate(chore, date);

// --- NEW/Implemented Functions ---

/**
 * Determines the specific allowance period (start and end dates) that a given date falls into,
 * based on the member's allowance RRULE.
 * @param dateInPeriod - The date for which to find the containing allowance period (should be UTC midnight).
 * @param rruleString - The RRULE string defining the allowance frequency.
 * @param allowanceStartDate - The anchor date (dtstart) for the allowance RRULE.
 * @returns An object { startDate, endDate } or null if calculation fails or date is before schedule.
 */
export const getAllowancePeriodForDate = (
    dateInPeriod: Date,
    rruleString: string | null | undefined,
    allowanceStartDate: Date | string
): { startDate: Date; endDate: Date } | null => {
    if (!rruleString) return null; // No rule defined

    const rule = createRRuleWithStartDate(rruleString, allowanceStartDate);
    if (!rule) return null; // Invalid rule

    const utcTargetDate = toUTCDate(dateInPeriod); // Ensure target date is UTC midnight

    try {
        // Find the allowance period start date (occurrence <= target date)
        // RRule.before gives the latest occurrence strictly BEFORE the date,
        // so we need to check the target date itself first or adjust the 'before' call.
        // Let's find the occurrence immediately AFTER the target date, then go back one.

        // Find the *next* occurrence strictly after the target date
        const nextOccurrence = rule.after(utcTargetDate, false); // inc=false

        // Find the occurrence ON or BEFORE the target date
        // We check the target date itself, then use before()
        const occurrencesOnDate = rule.between(utcTargetDate, utcTargetDate, true);
        let periodStartDate: Date | null = null;

        if (occurrencesOnDate.length > 0) {
            periodStartDate = occurrencesOnDate[0]; // Target date is a period start
        } else {
            // Target date is not a start date, find the latest start date before it
            periodStartDate = rule.before(utcTargetDate, false); // inc=false
        }

        if (!periodStartDate) {
            // Target date is before the first occurrence defined by dtstart
            console.log(`Target date ${utcTargetDate.toISOString()} is before the first allowance period starting ${rule.options.dtstart.toISOString()}`);
            return null;
        }

        // Determine the end date
        let periodEndDate: Date | null = null;
        // Find the occurrence immediately after the periodStartDate
        const occurrenceAfterStartDate = rule.after(periodStartDate, false); // inc=false

        if (occurrenceAfterStartDate) {
            // End date is the day before the next start date
            periodEndDate = new Date(occurrenceAfterStartDate);
            periodEndDate.setUTCDate(periodEndDate.getUTCDate() - 1);
        } else if (rule.options.until && periodStartDate >= rule.options.until) {
            // If the start date is on or after the UNTIL date
            periodEndDate = new Date(rule.options.until);
        } else if (rule.options.count && rule.all().length <= 1) {
            // If count=1, period is just the start date? Or handle based on freq?
            // Let's assume a minimum period length based on frequency for count=1
            periodEndDate = new Date(periodStartDate);
            const freq = rule.options.freq;
            const interval = rule.options.interval || 1;
            if (freq === Frequency.DAILY) periodEndDate.setUTCDate(periodStartDate.getUTCDate() + interval - 1);
            else if (freq === Frequency.WEEKLY) periodEndDate.setUTCDate(periodStartDate.getUTCDate() + 7 * interval - 1);
            else if (freq === Frequency.MONTHLY) periodEndDate.setUTCMonth(periodStartDate.getUTCMonth() + interval, periodStartDate.getUTCDate() - 1);
            else periodEndDate.setUTCFullYear(periodStartDate.getUTCFullYear() + 1); // Default fallback
        } else {
            // No next occurrence, and no UNTIL/COUNT limit reached.
            // Calculate a theoretical end date based on frequency, or set a far future date.
            periodEndDate = new Date(periodStartDate);
            const freq = rule.options.freq;
            const interval = rule.options.interval || 1;
            if (freq === Frequency.DAILY) periodEndDate.setUTCDate(periodStartDate.getUTCDate() + interval - 1);
            else if (freq === Frequency.WEEKLY) periodEndDate.setUTCDate(periodStartDate.getUTCDate() + 7 * interval - 1);
            else if (freq === Frequency.MONTHLY) periodEndDate.setUTCMonth(periodStartDate.getUTCMonth() + interval, periodStartDate.getUTCDate() - 1);
            else periodEndDate.setUTCFullYear(periodStartDate.getUTCFullYear() + 10); // Default far future

            // If there's an UNTIL date, don't go past it
            if (rule.options.until && periodEndDate > rule.options.until) {
                periodEndDate = new Date(rule.options.until);
            }
        }

        // Ensure start and end dates are UTC midnight
        const finalStartDate = toUTCDate(periodStartDate);
        const finalEndDate = toUTCDate(periodEndDate);

        // Sanity check: ensure end date is not before start date
        if (finalEndDate < finalStartDate) {
            console.error('Calculated period end date is before start date.', { finalStartDate, finalEndDate, dateInPeriod });
            // Handle this case, perhaps by setting end date equal to start date for a single-day period?
            return { startDate: finalStartDate, endDate: finalStartDate };
        }

        return { startDate: finalStartDate, endDate: finalEndDate };
    } catch (e) {
        console.error(`Error getting allowance period for date ${dateInPeriod.toISOString()} with rule "${rruleString}":`, e);
        return null;
    }
};

/**
 * Gets all chore occurrences assigned to a specific member within a given period.
 * @param chore - The chore object.
 * @param memberId - The ID of the family member.
 * @param periodStartDate - The UTC start date of the period.
 * @param periodEndDate - The UTC end date of the period.
 * @returns An array of Date objects representing assigned occurrences.
 */
export const getChoreOccurrencesForMemberInPeriod = (chore: Chore, memberId: string, periodStartDate: Date, periodEndDate: Date): Date[] => {
    const assignedOccurrences: Date[] = [];
    const choreStartDate = toUTCDate(chore.startDate);

    // Handle non-recurring chores
    if (!chore.rrule) {
        if (choreStartDate >= periodStartDate && choreStartDate <= periodEndDate) {
            const assignedMembers = chore.assignees || [];
            if (assignedMembers.some((a) => a.id === memberId)) {
                assignedOccurrences.push(choreStartDate);
            }
        }
        return assignedOccurrences;
    }

    // Handle recurring chores
    try {
        const occurrencesInPeriod = getChoreOccurrencesInRange(chore, periodStartDate, periodEndDate);

        for (const occurrenceDate of occurrencesInPeriod) {
            const assignedMembersOnDate = getAssignedMembersForChoreOnDate(chore, occurrenceDate);
            if (assignedMembersOnDate.some((m) => m.id === memberId)) {
                assignedOccurrences.push(toUTCDate(occurrenceDate)); // Store as UTC date
            }
        }
        return assignedOccurrences;
    } catch (error) {
        console.error(`Error getting occurrences for chore ${chore.id} in period:`, error);
        return [];
    }
};

/**
 * Calculates the allowance details for a specific member and period.
 * Queries chores and completions to determine weights and amounts.
 * @param db - InstantDB instance.
 * @param memberId - The family member's ID.
 * @param periodStartDate - Start date of the period (UTC).
 * @param periodEndDate - End date of the period (UTC).
 * @param allowanceAmount - The base allowance amount for the member.
 * @param allChores - An array containing all chore data (or relevant subset).
 * @param unawardedCompletionsForMember - All unawarded completions for this member.
 * @returns A Promise resolving to a CalculatedPeriod object or null.
 */
export const calculatePeriodDetails = async (
    db: any, // Keep db instance for potential future sub-queries
    memberId: string,
    periodStartDate: Date,
    periodEndDate: Date,
    allowanceAmount: number,
    allChores: Chore[],
    unawardedCompletionsForMember: ChoreCompletion[]
): Promise<CalculatedPeriod | null> => {
    let totalWeight = 0;
    let completedWeight = 0;
    const completionsInPeriodToMark: string[] = [];
    // +++ Initialize fixed rewards tracker +++
    const fixedRewardsEarned: { [currency: string]: number } = {};
    const choreOccurrencesCounted = new Set<string>(); // Track chores already counted for totalWeight
    // +++ Initialize weight tracker for up-for-grabs +++
    let upForGrabsCompletedWeight = 0;

    // 1. Calculate Total Assigned Weight for the member in the period
    for (const chore of allChores) {
        // +++ Skip Up for Grabs chores for totalWeight calculation +++
        if (chore.isUpForGrabs) continue;

        const choreWeight = chore.weight ?? 0; // Default to 0 if null/undefined
        if (choreWeight === 0) continue; // Skip chores excluded from calculation

        const occurrences = getChoreOccurrencesForMemberInPeriod(chore, memberId, periodStartDate, periodEndDate);
        // +++ Corrected: Weight contributes per occurrence for non-up-for-grabs chores +++
        totalWeight += occurrences.length * choreWeight;
    }

    // 2. Calculate Completed Weight & Fixed Rewards from unawarded completions falling into this period
    const periodStartMillis = periodStartDate.getTime();
    // End date is inclusive, so add 1 day and check < for millis comparison
    const periodEndMillis = toUTCDate(new Date(periodEndDate).setUTCDate(periodEndDate.getUTCDate() + 1)).getTime();

    for (const completion of unawardedCompletionsForMember) {
        // Ensure completion has required data
        // +++ Fetch chore details directly from allChores array +++
        const completedChore = allChores.find((c) => c.id === resolveOneLink(completion.chore)?.id);

        if (!completion.dateDue || !completedChore) {
            // console.warn("Skipping completion due to missing data or chore link:", completion.id);
            continue;
        }

        const dateDue = toUTCDate(completion.dateDue); // Ensure UTC comparison
        const dateDueMillis = dateDue.getTime();

        // Check if the completion's due date falls within the period
        if (dateDueMillis >= periodStartMillis && dateDueMillis < periodEndMillis) {
            completionsInPeriodToMark.push(completion.id); // Mark completion for awarding

            if (completion.completed) {
                // +++ Handle Up for Grabs vs Regular Chores +++
                if (completedChore.isUpForGrabs) {
                    if (completedChore.rewardType === 'fixed' && completedChore.rewardAmount && completedChore.rewardCurrency) {
                        // Accumulate fixed rewards
                        const currency = completedChore.rewardCurrency.toUpperCase();
                        fixedRewardsEarned[currency] = (fixedRewardsEarned[currency] || 0) + completedChore.rewardAmount;
                    } else if (completedChore.rewardType === 'weight' && completedChore.weight) {
                        // Add weight to completedWeight, but NOT totalWeight
                        completedWeight += completedChore.weight;
                        // +++ Accumulate weight for up-for-grabs contribution +++
                        upForGrabsCompletedWeight += completedChore.weight;
                    }
                } else {
                    // Regular chore: Add weight if completed
                    const choreWeight = completedChore.weight ?? 0;
                    if (choreWeight !== 0) {
                        // Only add non-zero weights
                        completedWeight += choreWeight;
                    }
                }
            }
        }
    }

    // 3. Calculate percentage and amount (based on weighted chores only)
    // Avoid division by zero if totalWeight is 0
    const percentage = totalWeight === 0 ? 0 : (completedWeight / totalWeight) * 100;
    // Ensure allowance amount is non-null before calculation
    // This amount is *only* from weighted chores. Fixed rewards are separate.
    const finalCalculatedAmount = (percentage / 100) * (allowanceAmount || 0);
    // +++ Calculate percentage contribution from up-for-grabs +++
    const upForGrabsContributionPercentage = totalWeight === 0 ? 0 : (upForGrabsCompletedWeight / totalWeight) * 100;

    // Ensure percentage is within reasonable bounds if needed (e.g., 0-100 if negatives aren't expected to exceed positives)
    // Optional clamping might be needed depending on how >100% should affect base calculation vs just display
    // const clampedPercentage = Math.max(0, Math.min(100, percentage));

    console.log(
        `Calculation Result: TotalW=${totalWeight}, CompletedW=${completedWeight}, Percent=${percentage}, WeightedAmount=${finalCalculatedAmount}, FixedRewards=`,
        fixedRewardsEarned
    );

    // Return the calculated data structure
    return {
        id: `${memberId}-${periodStartDate.toISOString()}`, // Generate an ID
        familyMemberId: memberId,
        periodStartDate: periodStartDate,
        periodEndDate: periodEndDate,
        totalWeight: totalWeight,
        completedWeight: completedWeight,
        percentage: percentage,
        calculatedAmount: finalCalculatedAmount, // This is the weight-based amount
        lastCalculatedAt: new Date(),
        isStale: false, // Mark as freshly calculated
        status: 'calculated', // Indicate calculated status
        completionsToMark: completionsInPeriodToMark,
        fixedRewardsEarned: fixedRewardsEarned, // Include fixed rewards
        upForGrabsContributionPercentage: upForGrabsContributionPercentage, // Include contribution percentage
    };
};

/**
 * Marks a list of chore completions as awarded in the database.
 * @param db - InstantDB instance.
 * @param completionIds - An array of choreCompletion IDs to update.
 */
export const markCompletionsAwarded = async (db: any, completionIds: string[]): Promise<void> => {
    if (!completionIds || completionIds.length === 0) {
        console.log('No completion IDs provided to mark as awarded.');
        return;
    }
    console.log(`Marking ${completionIds.length} completions as awarded:`, completionIds);
    try {
        const transactions = completionIds.map((compId) => tx.choreCompletions[compId].update({ allowanceAwarded: true }));
        await db.transact(transactions);
        console.log('Completions successfully marked as awarded.');
    } catch (error) {
        console.error('Error marking completions awarded:', error);
        throw error; // Re-throw error to be handled by the caller
    }
};

export const getChoreAssignmentGridFromChore = async (chore: any, startDate: Date, endDate: Date) => {
    const occurrences = getChoreOccurrencesInRange(chore, toUTCDate(startDate), toUTCDate(endDate));

    //initialize an empty object of the type that will hold dates, and for each dates family members, and for each family member whether or not they have been assigned the chore and whether or not they have completed it
    const dateAssignments: { [date: string]: { [memberId: string]: { assigned: boolean; completed: boolean } } } = {};

    // loop through each occurrence of the chore
    occurrences.forEach((date, index) => {
        //loop through each occurrence, each time having date be the date of the chore occurrence in question, and index being its index
        const utcDate = toUTCDate(date); // Ensure UTC
        const dateStr = utcDate.toISOString().split('T')[0]; // get a YYYY-MM-DD string date for the date we are dealing with
        dateAssignments[dateStr] = {}; // initialize the object for this particular date in the dateAssignments object

        const assignedMembers = getAssignedMembersForChoreOnDate(chore, utcDate);

        // Safeguard against null or undefined assignedMembers
        if (assignedMembers && assignedMembers.length > 0) {
            assignedMembers.forEach((assignee: any) => {
                if (assignee && assignee.id) {
                    // Check assignee validity
                    dateAssignments[dateStr][assignee.id] = { assigned: true, completed: false }; // set them to be assigned and to have not completed the chore that day
                }
            });
        }
    });

    // Merge actual completions from the chore object
    const completions = chore.completions || [];
    const getCompleterId = (completion: any) => {
        const raw = completion?.completedBy;
        return Array.isArray(raw) ? raw[0]?.id : raw?.id;
    };
    completions.forEach((completion: any) => {
        if (!completion.completed || !completion.dateDue) return;
        const dateStr = completion.dateDue.split('T')[0];
        const completerId = getCompleterId(completion);
        if (completerId && dateAssignments[dateStr]?.[completerId]) {
            dateAssignments[dateStr][completerId].completed = true;
        }
    });

    return dateAssignments;
};

// +++ NEW: Calculate XP Function +++
/**
 * Calculates XP (Current and Possible) for all family members for a specific date.
 * Rules:
 * 1. Fixed Reward chores = 0 XP.
 * 2. Zero weight chores = 0 XP.
 * 3. Up For Grabs:
 * - If unclaimed: Counts to Possible for all assignees.
 * - If claimed by A: Counts to Possible/Current for A. Removed from Possible for others.
 */
export const calculateDailyXP = (
    chores: any[],
    familyMembers: any[],
    date: Date
): { [memberId: string]: { current: number; possible: number } } =>
    calculateSharedDailyXP(chores, familyMembers, date);
