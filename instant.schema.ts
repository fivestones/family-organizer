import { i } from '@instantdb/core';

const INSTANT_APP_ID = 'af77353a-0a48-455f-b892-010232a052b4';

const graph = i.graph(
  INSTANT_APP_ID,
  {
    familyMembers: i.entity({
      name: i.string(),
      email: i.string().unique().indexed(),
      // Add other family member attributes here
    }),
    chores: i.entity({
      title: i.string(),
      description: i.string(),
      imageUrl: i.string(),
      area: i.string(),
      startDate: i.number(),
      endDate: i.number().optional(),
      recurrenceRule: i.string(),
      dueTimes: i.json<string[]>(),
      rotationType: i.string(),
      allowExtraDays: i.boolean(),
      isPaused: i.boolean(),
      rewardType: i.string(),
      difficultyRating: i.number().optional(),
      rewardAmount: i.number().optional(),
      canCompleteInAdvance: i.boolean(),
      advanceCompletionLimit: i.string(),
      canCompletePast: i.boolean(),
      pastCompletionLimit: i.string(),
    }),
    choreAssignments: i.entity({
      order: i.number(),
    }),
    choreCompletions: i.entity({
      date: i.number(),
      completed: i.boolean(),
    }),
    timeOfDayDefinitions: i.entity({
      name: i.string(),
      time: i.string(),
    }),
    "calendarItems": i.entity({
      "dayOfMonth": i.any().indexed(),
      "description": i.any(),
      "endDate": i.any(),
      "isAllDay": i.any(),
      "month": i.any().indexed(),
      "startDate": i.any(),
      "title": i.any(),
      "year": i.any().indexed(),
    }),
    "goals": i.entity({
      "createdAt": i.any(),
      "title": i.any(),
    }),
    "messages": i.entity({
      "createdAt": i.any(),
      "text": i.any(),
      "updatedAt": i.any(),
    }),
    "test": i.entity({
  
    }),
    "todos": i.entity({
      "createdAt": i.any(),
      "done": i.any(),
      "text": i.any(),
    }),
  },
  {
    familyMemberChores: {
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
    choreAssignmentOrder: {
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
    assignmentFamilyMember: {
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
    choreCompletions: {
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
    familyMemberCompletions: {
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
  }
);

export default graph;