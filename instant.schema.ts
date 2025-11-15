// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from '@instantdb/react';

const _schema = i.schema({
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
        calculatedAllowancePeriods: i.entity({
            //id: i.string().unique(),
            familyMemberId: i.string().indexed(),
            periodStartDate: i.date().indexed(),
            periodEndDate: i.date().indexed(),
            totalWeight: i.number(),
            completedWeight: i.number(),
            percentage: i.number(),
            calculatedAmount: i.number(),
            lastCalculatedAt: i.date(),
            isStale: i.boolean().indexed(),
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
            rotationType: i.string(),
            rrule: i.string(),
            startDate: i.any(),
            title: i.string(),
            weight: i.number(),
            isUpForGrabs: i.boolean(),
            rewardType: i.string(),
            rewardAmount: i.number(),
            rewardCurrency: i.string(),
        }),
        exchangeRates: i.entity({
            baseCurrency: i.string().indexed(),
            lastFetchedTimestamp: i.date().indexed(),
            rate: i.number(),
            targetCurrency: i.string().indexed(),
        }),
        familyMembers: i.entity({
            email: i.string().indexed().optional(),
            lastDisplayCurrency: i.string().optional(),
            name: i.string(),
            photoUrls: i.json().optional(),
            allowanceAmount: i.number().optional(),
            allowanceCurrency: i.string().optional(),
            allowanceRrule: i.string().optional(),
            allowanceStartDate: i.date().optional(),
            allowanceConfig: i.json().optional(),
            allowancePayoutDelayDays: i.number().optional(),
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
        // --- Task Series Management ---
        taskSeries: i.entity({
            name: i.string(),
            description: i.string(),
            startDate: i.date(),
            targetEndDate: i.date(),
            workAheadAllowed: i.boolean(),
            // For break after series completion
            breakType: i.string(), // "immediate", "specificDate", "delay"
            breakStartDate: i.date(), // Used if breakType is "specificDate"
            breakDelayValue: i.number(), // e.g., 2
            breakDelayUnit: i.string(), // "days", "weeks", "months"
            // Auto-timestamped fields
            createdAt: i.date(),
            updatedAt: i.date(),
        }),
        tasks: i.entity({
            text: i.string(),
            order: i.number(), // For maintaining sequence within a series/parent
            isDayBreak: i.boolean(), // True if this task line is a '~'
            // Individual task metadata
            overrideWorkAhead: i.boolean(),
            notes: i.string(),
            specificTime: i.string(), // e.g., "HH:MM"
            // Auto-timestamped fields
            createdAt: i.date(),
            updatedAt: i.date(),
        }),
        taskAttachments: i.entity({
            name: i.string(), // Original filename or user-defined name
            url: i.string(), // Path to the file in /public/uploads/
            type: i.string(), // e.g., 'pdf', 'image', 'document'
            // Auto-timestamped fields
            createdAt: i.date(),
            updatedAt: i.date(),
        }),
    },
    links: {
        allowanceEnvelopesFamilyMember: {
            forward: {
                on: 'allowanceEnvelopes',
                has: 'one',
                label: 'familyMember',
            },
            reverse: {
                on: 'familyMembers',
                has: 'many',
                label: 'allowanceEnvelopes',
            },
        },
        allowanceTransactionsDestinationEnvelope: {
            forward: {
                on: 'allowanceTransactions',
                has: 'one',
                label: 'destinationEnvelope',
            },
            reverse: {
                on: 'allowanceEnvelopes',
                has: 'many',
                label: 'incomingTransfers',
            },
        },
        allowanceTransactionsEnvelope: {
            forward: {
                on: 'allowanceTransactions',
                has: 'one',
                label: 'envelope',
            },
            reverse: {
                on: 'allowanceEnvelopes',
                has: 'many',
                label: 'transactions',
            },
        },
        allowanceTransactionsSourceEnvelope: {
            forward: {
                on: 'allowanceTransactions',
                has: 'one',
                label: 'sourceEnvelope',
            },
            reverse: {
                on: 'allowanceEnvelopes',
                has: 'many',
                label: 'outgoingTransfers',
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
        familyMemberAllowancePeriods: {
            forward: { on: 'familyMembers', has: 'many', label: 'allowancePeriods' },
            reverse: { on: 'calculatedAllowancePeriods', has: 'one', label: 'familyMember' },
        },
        // --- Task Series Management Links ---
        taskSeriesOwner: {
            // Who this task series is for
            forward: { on: 'taskSeries', has: 'one', label: 'familyMember' },
            reverse: { on: 'familyMembers', has: 'many', label: 'taskSeries' },
        },
        taskSeriesScheduledActivity: {
            // Link to the chore/scheduled activity
            forward: { on: 'taskSeries', has: 'one', label: 'scheduledActivity' }, // A series links to one chore
            reverse: { on: 'chores', has: 'many', label: 'taskSeries' }, // A chore can be linked by multiple series
        },
        seriesTasks: {
            // Tasks belonging to a series
            forward: { on: 'taskSeries', has: 'many', label: 'tasks' },
            reverse: { on: 'tasks', has: 'one', label: 'taskSeries' },
        },
        taskParentSubtask: {
            // For sub-tasks
            forward: { on: 'tasks', has: 'one', label: 'parentTask' }, // A subtask has one parent
            reverse: { on: 'tasks', has: 'many', label: 'subTasks' }, // A parent can have many subtasks
        },
        taskPrerequisites: {
            // For task dependencies
            forward: { on: 'tasks', has: 'many', label: 'prerequisites' }, // A task can have many prerequisites
            reverse: { on: 'tasks', has: 'many', label: 'subsequentTasks' }, // A task can be a prerequisite for many tasks
        },
        taskAttachmentsLink: {
            // For attachments to a task
            forward: { on: 'tasks', has: 'many', label: 'attachments' },
            reverse: { on: 'taskAttachments', has: 'one', label: 'task' },
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
