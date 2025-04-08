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
    allowance: i.entity({//got rid of currency (it's in the envelopes), and maybe the entire allowance namespace is defunct now. Maybe it will be useful for other stuff later.
      createdAt: i.string(),
      //currency: i.string(),
      totalAmount: i.number(),
      updatedAt: i.string(),
    }),
    allowanceEnvelopes: i.entity({
      name: i.string(), // Name of the envelope (e.g., "Savings", "Spending", "Games")
      // Store balances as a JSON object mapping currency codes to amounts
      // e.g., { "USD": 10.50, "NPR": 1500 }
      balances: i.json().indexed(),
      isDefault: i.boolean().indexed().optional(), // Flag for the special 'Default' envelope
      description: i.string().optional(),
      // Link to the family member this envelope belongs to
    }),
    allowanceTransactions: i.entity({
      amount: i.number(),
      createdAt: i.string().indexed(),
      currency: i.string(),
      transactionType: i.string(),
      updatedAt: i.string(),
      description: i.string().optional(), // Optional description for the transaction
      // Link to the source envelope (for transfers)
      // Link to the destination envelope
    }),
    // unitDefinitions ****
    // Stores overrides or definitions for non-standard units
    unitDefinitions: i.entity({
      code: i.string().unique().indexed(),   // e.g., "NPR", "STARS", "VIDMIN"
      name: i.string(),                    // e.g., "Nepalese Rupee", "Star Points", "Video Game Minutes"
      symbol: i.string(),                  // e.g., "रु", "⭐", "Min"
      isMonetary: i.boolean().indexed(),   // true for NPR, false for STARS/VIDMIN
      // Formatting options:
      symbolPlacement: i.string().optional(), // 'before' or 'after' (default: 'before' for monetary, 'after' for non-monetary?)
      symbolSpacing: i.boolean().optional(),  // true = space (⭐ 10), false = no space ($10) (default: true for 'after', false for 'before'?)
      decimalPlaces: i.number().optional(),   // e.g., 0, 2. null/undefined could mean 'auto' or default based on isMonetary.
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
        has: 'one',
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
    // Link between a family member and their envelopes
    familyMemberEnvelopes: {
      forward: { on: 'allowanceEnvelopes', has: 'one', label: 'familyMember' },
      reverse: { on: 'familyMembers', has: 'many', label: 'allowanceEnvelopes' },
    },
    // Link transactions to the envelope they affect
    envelopeTransactions: {
        forward: { on: 'allowanceTransactions', has: 'one', label: 'envelope' },
        reverse: { on: 'allowanceEnvelopes', has: 'many', label: 'transactions' },
    },
    // Optional: If transactions need to reference source/destination for transfers
    transactionSource: {
        forward: { on: 'allowanceTransactions', has: 'one', label: 'sourceEnvelope' },
        reverse: { on: 'allowanceEnvelopes', has: 'many', label: 'outgoingTransfers'}
    },
     transactionDestination: {
        forward: { on: 'allowanceTransactions', has: 'one', label: 'destinationEnvelope' },
        reverse: { on: 'allowanceEnvelopes', has: 'many', label: 'incomingTransfers'}
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
