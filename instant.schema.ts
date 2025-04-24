// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from "@instantdb/react";

const _schema = i.schema({
  // We inferred 5 attributes!
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
    allowanceEnvelopes: i.entity({
      amount: i.any(),
      balances: i.json().indexed(),
      currency: i.any(),
      description: i.string(),
      goalAmount: i.number(),
      goalCurrency: i.string(),
      isDefault: i.boolean(),
      name: i.string(),
    }),
    allowanceTransactions: i.entity({
      amount: i.number(),
      createdAt: i.string().indexed(),
      currency: i.string(),
      description: i.string(),
      transactionType: i.string(),
      updatedAt: i.string(), // Consider i.date()
    }),
    // +++ NEW: Cache for calculated allowance period data +++
    calculatedAllowancePeriods: i.entity({
      id: i.string().unique(), // Ensure this is explicitly defined if not default
      familyMemberId: i.string().indexed(),
      periodStartDate: i.date().indexed(),
      periodEndDate: i.date().indexed(),
      totalWeight: i.number(),
      completedWeight: i.number(),
      percentage: i.number(),
      calculatedAmount: i.number(),
      lastCalculatedAt: i.date(),
      isStale: i.boolean().indexed(), // Flag for recalculation needs
    }),
    unitDefinitions: i.entity({
      code: i.string().unique().indexed(),
      decimalPlaces: i.number(),
      isMonetary: i.boolean().indexed(),
      name: i.string(),
      symbol: i.string(),
      symbolPlacement: i.string(),
      symbolSpacing: i.boolean(),
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
      dateCompleted: i.string(), // Consider i.date()
      dateDue: i.string(), // Consider i.date()
      // +++ NEW: Track if allowance awarded for this completion +++
      allowanceAwarded: i.boolean().indexed(),
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
      // +++ NEW: Add weight field +++
      weight: i.number(),
    }),
    exchangeRates: i.entity({
      baseCurrency: i.string().indexed(),
      lastFetchedTimestamp: i.date().indexed(),
      rate: i.number(),
      targetCurrency: i.string().indexed(),
    }),
    familyMembers: i.entity({
      email: i.string().indexed(),
      lastDisplayCurrency: i.string(),
      name: i.string(),
      photoUrls: i.json(),
      // +++ NEW: Allowance Settings +++
      allowanceAmount: i.number(),
      allowanceCurrency: i.string(),
      allowanceRrule: i.string(), // RRULE for frequency
      allowanceStartDate: i.date(), // Anchor date for RRULE
      allowanceConfig: i.json(), // Store UI config like startOfWeek, readable string
      // +++ NEW: Delay for payout calculation +++
      allowancePayoutDelayDays: i.number(),
    }),
    settings: i.entity({
      name: i.string(),
      value: i.string(),
    }),
    timeOfDayDefinitions: i.entity({
      endTime: i.string(),
      name: i.string(),
      startTime: i.string(),
    }),
    todos: i.entity({
      createdAt: i.any(),
      done: i.boolean(),
      text: i.any(),
    }),
  },
  links: {
    allowanceEnvelopesFamilyMember: {
      forward: {
        on: "allowanceEnvelopes",
        has: "one",
        label: "familyMember",
      },
      reverse: {
        on: "familyMembers",
        has: "many",
        label: "allowanceEnvelopes",
      },
    },
    allowanceTransactionsDestinationEnvelope: {
      forward: {
        on: "allowanceTransactions",
        has: "one",
        label: "destinationEnvelope",
      },
      reverse: {
        on: "allowanceEnvelopes",
        has: "many",
        label: "incomingTransfers",
      },
    },
    allowanceTransactionsEnvelope: {
      forward: {
        on: "allowanceTransactions",
        has: "one",
        label: "envelope",
      },
      reverse: {
        on: "allowanceEnvelopes",
        has: "many",
        label: "transactions",
      },
    },
    allowanceTransactionsSourceEnvelope: {
      forward: {
        on: "allowanceTransactions",
        has: "one",
        label: "sourceEnvelope",
      },
      reverse: {
        on: "allowanceEnvelopes",
        has: "many",
        label: "outgoingTransfers",
      },
    },
    choreAssignmentsFamilyMember: {
      forward: {
        on: "choreAssignments",
        has: "one",
        label: "familyMember",
      },
      reverse: {
        on: "familyMembers",
        has: "many",
        label: "choreAssignments",
      },
    },
    choresAssignments: {
      forward: {
        on: "chores",
        has: "many",
        label: "assignments",
      },
      reverse: {
        on: "choreAssignments",
        has: "one",
        label: "chore",
      },
    },
    choresCompletions: {
      forward: {
        on: "chores",
        has: "many",
        label: "completions",
      },
      reverse: {
        on: "choreCompletions",
        has: "one",
        label: "chore",
      },
    },
    familyMembersAssignedChores: {
      forward: {
        on: "familyMembers",
        has: "many",
        label: "assignedChores",
      },
      reverse: {
        on: "chores",
        has: "many",
        label: "assignees",
      },
    },
    familyMembersCompletedChores: {
      forward: {
        on: "familyMembers",
        has: "many",
        label: "completedChores",
      },
      reverse: {
        on: "choreCompletions",
        has: "one",
        label: "completedBy",
      },
    },
    // +++ NEW: Link family member to their calculated allowance periods +++
    familyMemberAllowancePeriods: {
      forward: { on: 'familyMembers', has: 'many', label: 'allowancePeriods' },
      reverse: { on: 'calculatedAllowancePeriods', has: 'one', label: 'familyMember' },
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
