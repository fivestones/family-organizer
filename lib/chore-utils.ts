import { RRule, Frequency } from 'rrule';
import { init, tx, id } from '@instantdb/react';

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4' //kepler.local
const db = init({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});

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

// Add this new utility function
export function toUTCDate(date: Date | string | number): Date {
  const d = new Date(date);
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

export function createRRuleWithStartDate(rruleString: string, startDateString: string): RRule {
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
    console.error('Error parsing RRULE:', error);
    // Return a default daily RRULE if parsing fails
    return new RRule({
      freq: RRule.DAILY,
      dtstart: startDate
    });
  }
}


// Update getNextOccurrence
export function getNextOccurrence(rruleString: string, startDateString: string, after = new Date()) {
  const rrule = createRRuleWithStartDate(rruleString, startDateString);
  return rrule.after(after);
}

// Update getOccurrences
export function getOccurrences(rruleString: string, startDateString: string, start: Date, end: Date) {
  const rrule = createRRuleWithStartDate(rruleString, startDateString);
  return rrule.between(start, end);
}


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
  startDate: Date, 
  currentDate: Date, 
  rotationType: string, 
  rrule: RRule
): number => {
  switch (rotationType) {
    case 'daily':
      // For daily rotation, count the number of occurrences up to the current date
      const occurrences = rrule.between(startDate, currentDate, true);
      return occurrences.length - 1; // Subtract 1 because we want 0-based index
    case 'weekly':
      const weeksDiff = Math.floor((currentDate.getTime() - startDate.getTime()) / (7 * 24 * 60 * 60 * 1000));
      return weeksDiff;
    case 'monthly':
      const monthsDiff = (currentDate.getFullYear() - startDate.getFullYear()) * 12 + 
                         (currentDate.getMonth() - startDate.getMonth());
      return monthsDiff;
    default:
      return 0;
  }
};

const isSameDay = (date1: Date, date2: Date) => {
  return date1.getUTCFullYear() === date2.getUTCFullYear() &&
         date1.getUTCMonth() === date2.getUTCMonth() &&
         date1.getUTCDate() === date2.getUTCDate();
};

export const getAssignedMembersForChoreOnDate = (chore, date) => {
  const choreDate = new Date(chore.startDate);
  if (!chore.rrule) {
    if (isSameDay(choreDate, date)) {
      return chore.assignees || [];
    } else {
      return [];
    }
  }

  try {
    const rrule = createRRuleWithStartDate(chore.rrule, chore.startDate);

    const selectedDayStart = new Date(date);
    selectedDayStart.setHours(0, 0, 0, 0);
    const selectedDayEnd = new Date(selectedDayStart);
    selectedDayEnd.setDate(selectedDayEnd.getDate() + 1);

    const occurrences = rrule.between(selectedDayStart, selectedDayEnd, true);

    if (occurrences.length === 0) {
      return [];
    }

    if (chore.rotationType && chore.rotationType !== 'none' && chore.assignments && chore.assignments.length > 0) {
      const rotationIndex = getRotationIndex(new Date(chore.startDate), date, chore.rotationType, rrule);
      const sortedAssignments = [...chore.assignments].sort((a, b) => a.order - b.order);
      const assignmentIndex = rotationIndex % sortedAssignments.length;
      const assignedMember = sortedAssignments[assignmentIndex]?.familyMember;
      return assignedMember ? assignedMember : "";
    } else {
      return chore.assignees || [];
    }
  } catch (error) {
    console.error(`Error processing RRULE for chore ${chore.id}:`, error);
    return [];
  }
};

export const getChoreAssignmentGridFromChore = async (chore: any, startDate: Date, endDate: Date) => {
  const rrule = createRRuleWithStartDate(chore.rrule, chore.startDate); //first we make an rrule including the start date (which isn't included in our database)
  const occurrences = rrule.between(startDate, endDate, true); // find out how many times the chore occurs between the start and end dates

  //initialize an empty object of the type that will hold dates, and for each dates family members, and for each family member whether or not they have been assigned the chore and whether or not they have completed it
  const dateAssignments: { [date: string]: { [memberId: string]: { assigned: boolean; completed: false } } } = {};

  // loop through each occurrence of the chore
  occurrences.forEach((date, index) => { //loop through each occurrence, each time having date be the date of the chore occurrence in question, and index being its index
    const dateStr = date.toISOString().split('T')[0]; // get a YYYY-MM-DD string date for the date we are dealing with
    dateAssignments[dateStr] = {}; // initialize the object for this particular date in the dateAssignments object

    let assignedMembers: any[] = []; // initialize assignedMembers as an empty array of any type

    if (chore.rotationType && chore.rotationType !== 'none' && chore.assignments && chore.assignments.length > 0) { // if the chore has a rotation and assignments
      const rotationIndex = getRotationIndex(new Date(chore.startDate), date, chore.rotationType, rrule); // get a rotation index number; for daily rotations this will just be the number of times the chore has been due by the current date (e.g., for a daily chore started 10 days ago it will be 11; for an every other day chore started 8 days ago it will be 4). For weekly it's how many weeks have gone by, and for monthly it's how many months have gone by.
      const sortedAssignments = [...chore.assignments].sort((a, b) => a.order - b.order); // sort the assignees by the order they were placed in in the database
      const assignmentIndex = rotationIndex % chore.assignments.length; // get the mod of rotationIndex by how many people are assigned. (e.g., for a daily rotation chore on its 16th occurrence with 3 people assigned, 16 % 3 = 1)
      assignedMembers = [sortedAssignments[assignmentIndex]?.familyMember].filter(Boolean); // add an assignee to assignedMembers, with the person who is at the assignementIndex index of the chore.assignments array (e.g., for the above example, [1], so the 2nd person in the order of those assigned)
    } else {
      // Assigned to all assignees because there's not a rotationType or there are no chore assignments
      assignedMembers = chore.assignees || []; // assign every one for this date (because there's no rotation) or assign no one (because no one has been assigned for this chore at all)
    }

    // Safeguard against null or undefined assignedMembers
    if (assignedMembers.length > 0) {
      assignedMembers.forEach((assignee: any) => { // loop through everyone who has been assigned to this chore on this date
        dateAssignments[dateStr][assignee.id] = { assigned: true, completed: false }; // set them to be assigned and to have not completed the chore that day
      });
    }
  });

  return dateAssignments;
};


// ********************************************************************
// The below functions were used for an earlier version and may or may not be useful:

export const isChoreDueForPerson = async (db, chore, familyMemberId, date) => {
  const rrule = RRule.fromString(chore.recurrenceRule);
  
  // Check if the chore occurs on the given date
  if (!rrule.between(date, new Date(date.getTime() + 86400000), true).length) {
    return false;
  }

  // Check if the chore has been completed for this date
  const { data: completions } = await db.query({
    choreCompletions: {
      $: {
        where: {
          chore: chore.id,
          completedBy: familyMemberId,
          date: {
            $gte: date.setHours(0, 0, 0, 0),
            $lt: date.setHours(23, 59, 59, 999)
          },
          completed: true
        }
      }
    }
  });

  if (completions.choreCompletions.length > 0) {
    return false; // Chore has been completed for this date
  }

  // If there's no rotation, check if the person is assigned
  if (chore.rotationType === 'none') {
    return chore.assignments.some(assignment => assignment.familyMember.id === familyMemberId);
  }

  // Calculate the index in the rotation based on the rotation type
  let rotationIndex;
  const startDate = new Date(chore.startDate);
  const daysSinceStart = Math.floor((date.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));

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
      throw new Error(`Invalid rotation type: ${chore.rotationType}`);
  }

  // Get the assigned person for this rotation index
  const assignedPerson = chore.assignments[rotationIndex % chore.assignments.length];
  return assignedPerson.familyMember.id === familyMemberId;
};

export const getAllChoresDueForPerson = async (db, familyMemberId, date) => {
  const { data } = await db.query({
    chores: {
      id: true,
      title: true,
      description: true,
      imageUrl: true,
      area: true,
      startDate: true,
      recurrenceRule: true,
      rotationType: true,
      assignments: {
        order: true,
        familyMember: {
          id: true,
          name: true,
        },
      },
    },
    choreCompletions: {
      $: {
        where: {
          completedBy: familyMemberId,
          date: {
            $gte: new Date(date.setHours(0, 0, 0, 0)),
            $lt: new Date(date.setHours(23, 59, 59, 999))
          },
          completed: true
        }
      },
      chore: true,
    }
  });

  const completedChoreIds = new Set(data.choreCompletions.map(completion => completion.chore.id));

  const dueChores = await Promise.all(data.chores.map(async chore => {
    const isDue = await isChoreDueForPerson(db, chore, familyMemberId, date);
    if (isDue) {
      return {
        ...chore,
        dueDate: date,
        completed: completedChoreIds.has(chore.id)
      };
    }
    return null;
  }));

  return dueChores.filter(chore => chore !== null);
};

export const getChoreAssignmentsForPeriod = async (db, choreId, startDate, endDate) => {
  const { data } = await db.query({
    chores: {
      $: { where: { id: choreId } },
      title: true,
      recurrenceRule: true,
      rotationType: true,
      startDate: true,
      assignments: {
        order: true,
        familyMember: {
          id: true,
          name: true,
        },
      },
    },
    choreCompletions: {
      $: {
        where: {
          chore: choreId,
          date: {
            $gte: startDate,
            $lte: endDate
          },
          completed: true
        }
      },
      date: true,
      completedBy: {
        id: true,
        name: true,
      },
    }
  });

  const chore = data.chores[0];
  if (!chore) return [];

  const rrule = RRule.fromString(chore.recurrenceRule);
  const occurrences = rrule.between(startDate, endDate, true);

  const completions = new Map(data.choreCompletions.map(completion => 
    [completion.date.toISOString().split('T')[0], completion.completedBy]
  ));

  return occurrences.map(date => {
    const daysSinceStart = Math.floor((date.getTime() - new Date(chore.startDate).getTime()) / (24 * 60 * 60 * 1000));
    let rotationIndex;

    switch (chore.rotationType) {
      case 'none':
        rotationIndex = 0;
        break;
      case 'daily':
        rotationIndex = daysSinceStart;
        break;
      case 'weekly':
        rotationIndex = Math.floor(daysSinceStart / 7);
        break;
      case 'monthly':
        rotationIndex = (date.getFullYear() - new Date(chore.startDate).getFullYear()) * 12 + (date.getMonth() - new Date(chore.startDate).getMonth());
        break;
    }

    const assignedPerson = chore.assignments[rotationIndex % chore.assignments.length].familyMember;
    const dateString = date.toISOString().split('T')[0];
    const completedBy = completions.get(dateString);

    return {
      date,
      assignee: assignedPerson,
      completed: !!completedBy,
      completedBy: completedBy || null,
    };
  });
};

export const assignChoreWithRotation = async (db, choreId, familyMemberIds, rotationType) => {
  const assignments = familyMemberIds.map((memberId, index) => 
    tx.choreAssignments[id()].update({
      order: index,
      chore: choreId,
      familyMember: memberId,
    })
  );

  await db.transact([
    ...assignments,
    tx.chores[choreId].update({ rotationType }),
  ]);
};

export const completeChore = async (db, choreId, familyMemberId, date) => {
  await db.transact([
    tx.choreCompletions[id()].update({
      chore: choreId,
      completedBy: familyMemberId,
      date: date.getTime(),
      completed: true,
    }),
  ]);
};