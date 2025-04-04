// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from '@instantdb/react';

const _schema = i.schema({
  // We inferred 33 attributes!
  // Take a look at this schema, and if everything looks good,
  // run `push schema` again to enforce the types.
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed(),
    }),
    allowance: i.entity({
      createdAt: i.string(),
      currency: i.string(),
      totalAmount: i.number(),
      updatedAt: i.string(),
    }),
    allowanceEnvelopes: i.entity({
      amount: i.any(),
      currency: i.any(),
      description: i.any(),
      name: i.any(),
    }),
    allowanceTransactions: i.entity({
      amount: i.number(),
      createdAt: i.string(),
      currency: i.string(),
      transactionType: i.string(),
      updatedAt: i.string(),
    }),
    calendarItems: i.entity({
      dayOfMonth: i.number().indexed(),
      description: i.string(),
      endDate: i.string(),
      isAllDay: i.boolean(),
      month: i.number().indexed(),
      startDate: i.string(),
      title: i.string(),
      year: i.number().indexed(),
    }),
    choreAssignments: i.entity({
      order: i.number(),
    }),
    choreCompletions: i.entity({
      completed: i.boolean(),
      dateCompleted: i.string(),
      dateDue: i.string(),
    }),
    chores: i.entity({
      advanceCompletionLimit: i.any(),
      allowExtraDays: i.any(),
      area: i.any(),
      canCompleteInAdvance: i.any(),
      canCompletePast: i.any(),
      description: i.string(),
      difficultyRating: i.any(),
      done: i.boolean(),
      dueTimes: i.any(),
      endDate: i.any(),
      imageUrl: i.any(),
      isPaused: i.any(),
      pastCompletionLimit: i.any(),
      recurrenceRule: i.any(),
      rewardAmount: i.any(),
      rewardType: i.any(),
      rotationType: i.string(),
      rrule: i.string(),
      startDate: i.any(),
      title: i.string(),
    }),
    familyMembers: i.entity({
      email: i.string().indexed(),
      name: i.string(),
      photoUrl: i.string(),
      photoUrls: i.json(),
    }),
    goals: i.entity({
      createdAt: i.any(),
      title: i.any(),
    }),
    messages: i.entity({
      createdAt: i.any(),
      text: i.any(),
      updatedAt: i.any(),
    }),
    settings: i.entity({
      name: i.string(),
      value: i.string(),
    }),
    test: i.entity({}),
    timeOfDayDefinitions: i.entity({
      name: i.any(),
      time: i.any(),
    }),
    todos: i.entity({
      createdAt: i.any(),
      done: i.boolean(),
      text: i.any(),
    }),
  },
  links: {
    allowanceFamilyMember: {
      forward: {
        on: 'allowance',
        has: 'one',
        label: 'familyMember',
      },
      reverse: {
        on: 'familyMembers',
        has: 'many',
        label: 'allowance',
      },
    },
    allowanceEnvelopesAllowance: {
      forward: {
        on: 'allowanceEnvelopes',
        has: 'one',
        label: 'allowance',
      },
      reverse: {
        on: 'allowance',
        has: 'many',
        label: 'allowanceEnvelopes',
      },
    },
    allowanceTransactionsAllowance: {
      forward: {
        on: 'allowanceTransactions',
        has: 'many',
        label: 'allowance',
      },
      reverse: {
        on: 'allowance',
        has: 'many',
        label: 'allowanceTransactions',
      },
    },
    choreAssignmentsFamilyMember: {
      forward: {
        on: 'choreAssignments',
        has: 'one',
        label: 'familyMember',
      },
      reverse: {
        on: 'familyMembers',
        has: 'many',
        label: 'choreAssignments',
      },
    },
    choresAssignments: {
      forward: {
        on: 'chores',
        has: 'many',
        label: 'assignments',
      },
      reverse: {
        on: 'choreAssignments',
        has: 'one',
        label: 'chore',
      },
    },
    choresCompletions: {
      forward: {
        on: 'chores',
        has: 'many',
        label: 'completions',
      },
      reverse: {
        on: 'choreCompletions',
        has: 'one',
        label: 'chore',
      },
    },
    familyMembersAssignedChores: {
      forward: {
        on: 'familyMembers',
        has: 'many',
        label: 'assignedChores',
      },
      reverse: {
        on: 'chores',
        has: 'many',
        label: 'assignees',
      },
    },
    familyMembersCompletedChores: {
      forward: {
        on: 'familyMembers',
        has: 'many',
        label: 'completedChores',
      },
      reverse: {
        on: 'choreCompletions',
        has: 'one',
        label: 'completedBy',
      },
    },
  },
  rooms: {},
});

// This helps Typescript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
