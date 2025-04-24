import { RRule, Frequency, Weekday, RRuleSet } from 'rrule';
import { init, tx, id } from '@instantdb/react';

// Assuming db instance is initialized here or passed around
// If passing around, remove this initialization
const APP_ID = process.env.NEXT_PUBLIC_INSTANT_APP_ID || 'af77353a-0a48-455f-b892-010232a052b4'; // Use env var
const db = init({
  appId: APP_ID,
  apiURI: process.env.NEXT_PUBLIC_INSTANT_API_URI || "http://localhost:8888",
  websocketURI: process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI || "ws://localhost:8888/runtime/session",
});

// --- Type Definitions (Refine based on actual schema/data structure) ---
interface Chore {
    id: string;
    title: string;
    startDate: string; // ISO string date
    rrule?: string | null;
    weight?: number | null;
    rotationType: 'none' | 'daily' | 'weekly' | 'monthly';
    assignees: { id: string; name?: string }[]; // Simplified assignee type
    assignments?: { // For rotation
        order: number;
        familyMember: { id: string; name?: string };
    }[];
    completions?: ChoreCompletion[]; // Link to completions
}

interface ChoreCompletion {
    id: string;
    completed: boolean;
    dateDue: string; // ISO string date YYYY-MM-DD
    completedBy: { id: string }[]; // Link to family member
    allowanceAwarded: boolean;
    chore?: { id: string; weight?: number | null }; // Optional link back to chore with weight
}

interface FamilyMember {
     id: string;
     name?: string;
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
}


// --- Existing Utility Functions (Keep as they are) ---

export function createRRule(ruleObject: Partial<RRule.Options>) {
  if (!ruleObject || typeof ruleObject !== 'object') {
    throw new Error('Invalid rule object provided');
  }

  const options: RRule.Options = {
    freq: Frequency.DAILY,  // Default frequency
    interval: 1,            // Default interval
    ...ruleObject,
  };

  const freq = (ruleObject as any).freq;

  // Handle the freq property
  if (typeof freq === 'string') {
    const upperFreq = freq.toUpperCase();
    options.freq =
      (Frequency[upperFreq as keyof typeof Frequency] as Frequency) ||
      Frequency.DAILY;
  } else if (typeof freq === 'number') {
    // Ensure the number is a valid Frequency enum value
    options.freq = Object.values(Frequency).includes(freq)
      ? freq
      : Frequency.DAILY;
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
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // gemeni thinks we need to replace the above with what's below:
  // // Ensures we create a Date object representing midnight UTC for the given date parts
  // return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
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
      dtstart: startDate
    });
  } catch (error) {
        console.error(`Error parsing RRULE "${rruleString}" with start date ${startDate.toISOString()}:`, error);
        // Optionally return a default or null based on desired error handling
        return null; // Indicate parsing failure
  }
}


// Update getNextOccurrence
export function getNextOccurrence(rruleString: string, startDateString: string, after = new Date()) {
  const rrule = createRRuleWithStartDate(rruleString, startDateString);
  if (!rrule) return null;
  return rrule.after(after); // do we need:  return rrule.after(toUTCDate(after)); // Use UTC date for comparison
}

export function getOccurrences(rruleString: string, startDateString: string, start: Date, end: Date): Date[] {
  const rrule = createRRuleWithStartDate(rruleString, startDateString);
  if (!rrule) return [];
  return rrule.between(start, end);
  // gemini thinks we need the following in place of the previous line:
  // // Ensure start and end dates are UTC for accurate 'between' calculation
  // return rrule.between(toUTCDate(start), toUTCDate(end), true); // inc = true
}

// this function seems to be unused. Still seems like it might be useful though. Maybe?
// TODO
export const isChoreAssignedForPersonOnDate = async (db: any, chore: any, familyMemberId: string, date: Date) => {
  const dateStart = new Date(date);
  dateStart.setHours(0, 0, 0, 0);
  const dateEnd = new Date(date);
  dateEnd.setHours(23, 59, 59, 999);

  // Check if the chore occurs on the given date
  const rrule = createRRuleWithStartDate(chore.rrule, chore.startDate);
  const occurrences = rrule.between(dateStart, dateEnd, true);

  if (occurrences.length === 0) {
    return { assigned: false, completed: false };
  }

  let assigned = false;

  if (chore.rotationType && chore.rotationType !== 'none' && chore.assignments && chore.assignments.length > 0) {
    // Handle rotation
    const rotationIndex = getRotationIndex(new Date(chore.startDate), dateStart, chore.rotationType, rrule);
    const assignmentIndex = rotationIndex % chore.assignments.length;
    const assignedPersonId = chore.assignments[assignmentIndex].familyMember.id;
    assigned = assignedPersonId === familyMemberId;
  } else {
    // Assigned to all assignees
    assigned = chore.assignees.some((assignee: any) => assignee.id === familyMemberId);
  }

  if (!assigned) {
    return { assigned: false, completed: false };
  }

  // Check if the chore has been completed by this person on this date
  const { data } = await db.query({
    choreCompletions: {
      $: {
        where: {
          chore: chore.id,
          completedBy: familyMemberId,
          date: {
            $gte: dateStart.getTime(),
            $lte: dateEnd.getTime(),
          },
          completed: true,
        },
      },
      id: true,
    },
  });

  const completed = data.choreCompletions.length > 0;

  return { assigned: true, completed };
};

// This function also seems to be no longer used
// TODO
export const getChoreAssignmentGrid = async (db: any, chore: any, startDate: Date, endDate: Date) => {
  const rrule = createRRuleWithStartDate(chore.rrule, chore.startDate);
  const occurrences = rrule.between(startDate, endDate, true);

  const { data } = await db.query({
    choreCompletions: {
      $: {
        where: {
          chore: chore.id,
          date: {
            $gte: startDate.getTime(),
            $lte: endDate.getTime(),
          },
          completed: true,
        },
      },
      date: true,
      completedBy: {
        id: true,
      },
    },
  });

  const completions = data.choreCompletions;

  const dateAssignments: { [date: string]: { [memberId: string]: { assigned: boolean; completed: boolean } } } = {};

  occurrences.forEach(date => {
    const dateStr = date.toISOString().split('T')[0];
    dateAssignments[dateStr] = {};

    let assignedMembers: any[] = [];

    if (chore.rotationType && chore.assignments && chore.assignments.length > 0) {
      // Handle rotation
      const startDate = new Date(chore.startDate);
      const daysSinceStart = Math.floor((date.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));

      let rotationIndex = 0;
      switch (chore.rotationType) {
        case 'daily':
          rotationIndex = daysSinceStart;
          break;
        case 'weekly':
          rotationIndex = Math.floor(daysSinceStart / 7);
          break;
        case 'monthly':
          rotationIndex = (date.getFullYear() - startDate.getFullYear()) * 12 + (date.getMonth() - startDate.getMonth());
          break;
        default:
          rotationIndex = 0;
      }

      const assignedIndex = rotationIndex % chore.assignments.length;
      assignedMembers = [chore.assignments[assignedIndex].familyMember];
    } else {
      // Assigned to all assignees
      assignedMembers = chore.assignees;
    }

    assignedMembers.forEach((assignee: any) => {
      dateAssignments[dateStr][assignee.id] = { assigned: true, completed: false };
    });
  });

  // Mark completed chores
  completions.forEach((completion: any) => {
    const date = new Date(completion.date);
    const dateStr = date.toISOString().split('T')[0];
    const assigneeId = completion.completedBy.id;
    if (dateAssignments[dateStr] && dateAssignments[dateStr][assigneeId]) {
      dateAssignments[dateStr][assigneeId].completed = true;
    }
  });

  return dateAssignments;
};

const getRotationIndex = (
    choreStartDate: Date,
    occurrenceDate: Date,
  rotationType: string, 
    rrule: RRule // Pass the RRule object itself
): number => {
     const utcStartDate = toUTCDate(choreStartDate);
     const utcOccurrenceDate = toUTCDate(occurrenceDate);

  switch (rotationType) {
    case 'daily':
        // Count actual occurrences between start date (inclusive) and occurrence date (inclusive)
         // This handles varying intervals correctly.
         try {
              // RRuleSet might be safer if EXDATEs are involved, but for simple rules:
              const occurrences = rrule.between(utcStartDate, utcOccurrenceDate, true); // inc = true
              return Math.max(0, occurrences.length - 1); // 0-based index
         } catch(e) {
              console.error("Error calculating daily rotation index:", e);
              return 0; // Fallback
         }

    case 'weekly':
        // Calculate weeks passed based on UTC dates
         const oneWeek = 7 * 24 * 60 * 60 * 1000;
         const weeksDiff = Math.floor((utcOccurrenceDate.getTime() - utcStartDate.getTime()) / oneWeek);
         return Math.max(0, weeksDiff);
    case 'monthly':
         // Calculate months passed based on UTC dates
         const monthsDiff = (utcOccurrenceDate.getUTCFullYear() - utcStartDate.getUTCFullYear()) * 12 +
                            (utcOccurrenceDate.getUTCMonth() - utcStartDate.getUTCMonth());
         return Math.max(0, monthsDiff);
    default:
        return 0; // No rotation or unknown type
  }
};


const isSameDay = (date1: Date, date2: Date) => {
  if (!date1 || !date2) return false;
  return date1.getUTCFullYear() === date2.getUTCFullYear() &&
         date1.getUTCMonth() === date2.getUTCMonth() &&
         date1.getUTCDate() === date2.getUTCDate();
};

export const getAssignedMembersForChoreOnDate = (chore: Chore, date: Date): { id: string; name?: string }[] => {
  const utcDate = toUTCDate(date);
  const choreStartDate = toUTCDate(chore.startDate);

  // Handle non-recurring chores first
  if (!chore.rrule) {
      return isSameDay(choreStartDate, utcDate) ? (chore.assignees || []) : [];
  }

  try {
       const rrule = createRRuleWithStartDate(chore.rrule, choreStartDate);
       if (!rrule) return []; // Invalid RRULE

       const dayStart = new Date(utcDate);
       const dayEnd = new Date(Date.UTC(utcDate.getUTCFullYear(), utcDate.getUTCMonth(), utcDate.getUTCDate() + 1));
       dayEnd.setUTCMilliseconds(dayEnd.getUTCMilliseconds() -1);
       const occurrencesOnDate = rrule.between(dayStart, dayEnd, true);

       if (occurrencesOnDate.length === 0) {
            return [];
       }

      // Determine assignment based on rotation or direct assignees
      if (chore.rotationType && chore.rotationType !== 'none' && chore.assignments && chore.assignments.length > 0) {
        const rotationIndex = getRotationIndex(choreStartDate, utcDate, chore.rotationType, rrule);
        // Ensure assignments array is not empty before modulo
        if (chore.assignments.length === 0) return [];
        const sortedAssignments = [...chore.assignments].sort((a, b) => a.order - b.order);
        const assignmentIndex = rotationIndex % sortedAssignments.length;

        const assignedMemberData = sortedAssignments[assignmentIndex]?.familyMember[0];
        
        // Now check if the extracted object and its id exist
        return (assignedMemberData && assignedMemberData.id)
          ? [{ id: assignedMemberData.id, name: assignedMemberData.name }] // Return valid assignee in an array
          : []; // Return empty array if data is incomplete or missing
      } else {
        // Assigned to all direct assignees
        // Ensure this also returns an array of objects with id/name
        return (chore.assignees || []).map(a => ({ id: a.id, name: a.name }));
      }
  } catch (error) {
      console.error(`Error processing RRULE for chore ${chore.id} on date ${date.toISOString()}:`, error);
      return []; // Return empty on error
  }
};

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
                if (freq === Frequency.DAILY) periodEndDate.setUTCDate(periodStartDate.getUTCDate() + interval -1);
                else if (freq === Frequency.WEEKLY) periodEndDate.setUTCDate(periodStartDate.getUTCDate() + (7 * interval) - 1);
                 else if (freq === Frequency.MONTHLY) periodEndDate.setUTCMonth(periodStartDate.getUTCMonth() + interval, periodStartDate.getUTCDate() -1);
                else periodEndDate.setUTCFullYear(periodStartDate.getUTCFullYear() + 1); // Default fallback
          } else {
             // No next occurrence, and no UNTIL/COUNT limit reached.
             // Calculate a theoretical end date based on frequency, or set a far future date.
               periodEndDate = new Date(periodStartDate);
               const freq = rule.options.freq;
               const interval = rule.options.interval || 1;
               if (freq === Frequency.DAILY) periodEndDate.setUTCDate(periodStartDate.getUTCDate() + interval -1);
               else if (freq === Frequency.WEEKLY) periodEndDate.setUTCDate(periodStartDate.getUTCDate() + (7 * interval) - 1);
               else if (freq === Frequency.MONTHLY) periodEndDate.setUTCMonth(periodStartDate.getUTCMonth() + interval, periodStartDate.getUTCDate() -1);
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
              console.error("Calculated period end date is before start date.", { finalStartDate, finalEndDate, dateInPeriod });
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
export const getChoreOccurrencesForMemberInPeriod = (
  chore: Chore,
  memberId: string,
  periodStartDate: Date,
  periodEndDate: Date
): Date[] => {
  if (memberId == "c72238c8-73b2-497d-8fd6-717768b6e167") {
  }
   const assignedOccurrences: Date[] = [];
   const choreStartDate = toUTCDate(chore.startDate);

    // Handle non-recurring chores
   if (!chore.rrule) {
       if (choreStartDate >= periodStartDate && choreStartDate <= periodEndDate) {
           const assignedMembers = chore.assignees || [];
           if (assignedMembers.some(a => a.id === memberId)) {
               assignedOccurrences.push(choreStartDate);
           }
       }
       return assignedOccurrences;
   }

   // Handle recurring chores
   try {
        const rrule = createRRuleWithStartDate(chore.rrule, choreStartDate);
        if (!rrule) return []; // Invalid RRULE

       const occurrencesInPeriod = rrule.between(periodStartDate, periodEndDate, true); // inc=true

       for (const occurrenceDate of occurrencesInPeriod) {
           const assignedMembersOnDate = getAssignedMembersForChoreOnDate(chore, occurrenceDate);
           if (assignedMembersOnDate.some(m => m.id === memberId)) {
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
  console.log(`Calculating details for ${memberId} from ${periodStartDate.toISOString().split('T')[0]} to ${periodEndDate.toISOString().split('T')[0]}`);

  let totalWeight = 0;
  let completedWeight = 0;
  const completionsInPeriodToMark: string[] = [];

  // 1. Calculate Total Assigned Weight for the member in the period
  for (const chore of allChores) {
    const choreWeight = chore.weight ?? 0; // Default to 0 if null/undefined
    if (choreWeight === 0) continue; // Skip chores excluded from calculation

    const occurrences = getChoreOccurrencesForMemberInPeriod(chore, memberId, periodStartDate, periodEndDate);
    totalWeight += occurrences.length * choreWeight;
  }

  // 2. Calculate Completed Weight from unawarded completions falling into this period
  const periodStartMillis = periodStartDate.getTime();
  // End date is inclusive, so add 1 day and check < for millis comparison
  const periodEndMillis = toUTCDate(new Date(periodEndDate).setUTCDate(periodEndDate.getUTCDate() + 1)).getTime();

  for (const completion of unawardedCompletionsForMember) {
    // Ensure completion has required data
    if (!completion.dateDue || !completion.chore || completion.chore[0].weight === null || completion.chore[0].weight === undefined) {
      // console.warn("Skipping completion due to missing data:", completion.id);
      continue;
    }

    const choreWeight = completion.chore[0].weight;
    if (choreWeight === 0) continue; // Skip if chore weight is 0

    const dateDue = toUTCDate(completion.dateDue); // Ensure UTC comparison
    const dateDueMillis = dateDue.getTime();

    // Check if the completion's due date falls within the period
    if (dateDueMillis >= periodStartMillis && dateDueMillis < periodEndMillis) {
        // This completion belongs to the current period
        completedWeight += choreWeight;
        completionsInPeriodToMark.push(completion.id); // Add to list to mark awarded later
    }
  }

   // 3. Calculate percentage and amount
   // Avoid division by zero if totalWeight is 0
   const percentage = totalWeight === 0 ? 0 : (completedWeight / totalWeight) * 100;
   // Ensure allowance amount is non-null before calculation
   const finalCalculatedAmount = ((percentage / 100) * (allowanceAmount || 0));

   // Ensure percentage is within reasonable bounds if needed (e.g., 0-100 if negatives aren't expected to exceed positives)
   // const clampedPercentage = Math.max(0, Math.min(100, percentage)); // Optional clamping

  console.log(`Calculation Result: TotalW=${totalWeight}, CompletedW=${completedWeight}, Percent=${percentage}, Amount=${finalCalculatedAmount}`);


  // Return the calculated data structure
  return {
      id: `${memberId}-${periodStartDate.toISOString()}`, // Generate an ID
      familyMemberId: memberId,
      periodStartDate: periodStartDate,
      periodEndDate: periodEndDate,
      totalWeight: totalWeight,
      completedWeight: completedWeight,
      percentage: percentage,
      calculatedAmount: finalCalculatedAmount,
      lastCalculatedAt: new Date(),
      isStale: false, // Mark as freshly calculated
      status: 'calculated', // Indicate calculated status
      completionsToMark: completionsInPeriodToMark,
  };
};


/**
* Marks a list of chore completions as awarded in the database.
* @param db - InstantDB instance.
* @param completionIds - An array of choreCompletion IDs to update.
*/
export const markCompletionsAwarded = async (db: any, completionIds: string[]): Promise<void> => {
  if (!completionIds || completionIds.length === 0) {
      console.log("No completion IDs provided to mark as awarded.");
      return;
  }
  console.log(`Marking ${completionIds.length} completions as awarded:`, completionIds);
  try {
      const transactions = completionIds.map(compId =>
          tx.choreCompletions[compId].update({ allowanceAwarded: true })
      );
      await db.transact(transactions);
      console.log("Completions successfully marked as awarded.");
  } catch (error) {
      console.error("Error marking completions awarded:", error);
      throw error; // Re-throw error to be handled by the caller
  }
};

export const getChoreAssignmentGridFromChore = async (chore: any, startDate: Date, endDate: Date) => {
  const rrule = createRRuleWithStartDate(chore.rrule, chore.startDate); //first we make an rrule including the start date (which isn't included in our database)

  if (!rrule) return {}; // Handle invalid rule
  const occurrences = rrule.between(toUTCDate(startDate), toUTCDate(endDate), true); // find out how many times the chore occurs between the start and end dates

  //initialize an empty object of the type that will hold dates, and for each dates family members, and for each family member whether or not they have been assigned the chore and whether or not they have completed it
  const dateAssignments: { [date: string]: { [memberId: string]: { assigned: boolean; completed: boolean } } } = {};

  // loop through each occurrence of the chore
  occurrences.forEach((date, index) => { //loop through each occurrence, each time having date be the date of the chore occurrence in question, and index being its index
    const utcDate = toUTCDate(date); // Ensure UTC
    const dateStr = utcDate.toISOString().split('T')[0]; // get a YYYY-MM-DD string date for the date we are dealing with
    dateAssignments[dateStr] = {}; // initialize the object for this particular date in the dateAssignments object

    const assignedMembers = getAssignedMembersForChoreOnDate(chore, utcDate);

    // Safeguard against null or undefined assignedMembers
    if (assignedMembers && assignedMembers.length > 0) {
      assignedMembers.forEach((assignee: any) => {
        if (assignee && assignee.id) { // Check assignee validity
          dateAssignments[dateStr][assignee.id] = { assigned: true, completed: false }; // set them to be assigned and to have not completed the chore that day
        }
      });
    }
  });

  // TODO: This grid function doesn't account for *actual* completions from the DB.
  // It only shows assignments. If completion status is needed here, it must be fetched
  // and merged similar to how `calculatePeriodDetails` would handle it.
  // For ChoreCalendarView, this might be sufficient if it only shows assignment status.

  return dateAssignments;
};
