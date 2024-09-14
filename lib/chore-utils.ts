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

  console.log("options: ", options);
  if (options.dtstart && !(options.dtstart instanceof Date)) {
    console.log("the dtstart will be", new Date(options.dtstart), " from ", options.dtstart)
    options.dtstart = new Date(options.dtstart);
  }

  if (options.until && !(options.until instanceof Date)) {
    options.until = new Date(options.until);
  }

  return new RRule(options);
}

export function createRRuleWithStartDate(rruleString: string, startDateString: string): RRule {
  const startDate = new Date(startDateString);
  const rruleOptions = RRule.parseString(rruleString);
  return new RRule({
    ...rruleOptions,
    dtstart: startDate
  });
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