// Docs: https://www.instantdb.com/docs/modeling-data

import { i } from '@instantdb/react';

const _schema = i.schema({
    // We inferred 3 attributes!
    // Take a look at this schema, and if everything looks good,
    // run `push schema` again to enforce the types.
    entities: {
        $files: i.entity({
            path: i.string().unique().indexed(),
            url: i.string(),
        }),
        $users: i.entity({
            email: i.string().unique().indexed().optional(),
            imageURL: i.string().optional(),
            type: i.string().optional(),
        }),
        allowanceEnvelopes: i.entity({
            amount: i.any(),
            balances: i.any().indexed(),
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
            updatedAt: i.string(),
        }),
        calculatedAllowancePeriods: i.entity({
            calculatedAmount: i.number(),
            completedWeight: i.number(),
            familyMemberId: i.string().indexed(),
            isStale: i.boolean().indexed(),
            lastCalculatedAt: i.date(),
            percentage: i.number(),
            periodEndDate: i.date().indexed(),
            periodStartDate: i.date().indexed(),
            totalWeight: i.number(),
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
            allowanceAwarded: i.boolean().indexed(),
            completed: i.boolean(),
            dateCompleted: i.string().optional(),
            dateDue: i.string(),
        }),
        chores: i.entity({
            advanceCompletionLimit: i.any().optional(),
            allowExtraDays: i.any().optional(),
            area: i.any().optional(),
            canCompleteInAdvance: i.any().optional(),
            canCompletePast: i.any().optional(),
            description: i.string().optional(),
            difficultyRating: i.any().optional(),
            done: i.boolean(),
            dueTimes: i.any().optional(),
            endDate: i.any().optional(),
            imageUrl: i.any().optional(),
            isPaused: i.any().optional(),
            isUpForGrabs: i.boolean().optional(),
            pastCompletionLimit: i.any().optional(),
            recurrenceRule: i.any().optional(),
            rewardAmount: i.number().optional(),
            rewardCurrency: i.string().optional(),
            rewardType: i.string().optional(),
            rotationType: i.string(),
            rrule: i.string().optional(),
            startDate: i.string(),
            title: i.string(),
            weight: i.number().optional(),
        }),
        exchangeRates: i.entity({
            baseCurrency: i.string().indexed(),
            lastFetchedTimestamp: i.date().indexed(),
            rate: i.number(),
            targetCurrency: i.string().indexed(),
        }),
        familyMembers: i.entity({
            allowanceAmount: i.number().optional(),
            allowanceConfig: i.json().optional(),
            allowanceCurrency: i.string().optional(),
            allowancePayoutDelayDays: i.number().optional(),
            allowanceRrule: i.string().optional(),
            allowanceStartDate: i.date().optional(),
            email: i.string().indexed().optional(),
            lastDisplayCurrency: i.string().optional(),
            name: i.string(),
            order: i.number().indexed(),
            photoUrls: i.json().optional(),
        }),
        settings: i.entity({
            name: i.string(),
            value: i.string(),
        }),
        taskAttachments: i.entity({
            createdAt: i.date(),
            name: i.string(),
            type: i.string(),
            updatedAt: i.date(),
            url: i.string(),
        }),
        tasks: i.entity({
            createdAt: i.date().optional(),
            indentationLevel: i.number().optional(),
            isDayBreak: i.boolean(),
            isCompleted: i.boolean().optional().indexed(),
            completedAt: i.date().optional(), // Keeps exact time of day
            completedOnDate: i.string().optional().indexed(), // <--- NEW: Sticks to the calendar day
            notes: i.string().optional(),
            order: i.number(),
            overrideWorkAhead: i.boolean().optional(),
            specificTime: i.string().optional(),
            text: i.string(),
            updatedAt: i.date().optional(),
        }),
        taskSeries: i.entity({
            breakDelayUnit: i.string().optional(),
            breakDelayValue: i.number().optional(),
            breakStartDate: i.date().optional(),
            breakType: i.string().optional(),
            createdAt: i.date().optional(),
            description: i.string().optional(),
            dependsOnSeriesId: i.string().optional().indexed(),
            name: i.string(),
            startDate: i.date().optional(),
            targetEndDate: i.date().optional(),
            updatedAt: i.date().optional(),
            workAheadAllowed: i.boolean().optional(),
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
        unitDefinitions: i.entity({
            code: i.string().unique().indexed(),
            decimalPlaces: i.number(),
            isMonetary: i.boolean().indexed(),
            name: i.string(),
            symbol: i.string(),
            symbolPlacement: i.string(),
            symbolSpacing: i.boolean(),
        }),
    },
    links: {
        $usersLinkedPrimaryUser: {
            forward: {
                on: '$users',
                has: 'one',
                label: 'linkedPrimaryUser',
                onDelete: 'cascade',
            },
            reverse: {
                on: '$users',
                has: 'many',
                label: 'linkedGuestUsers',
            },
        },
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
        familyMembersAllowancePeriods: {
            forward: {
                on: 'familyMembers',
                has: 'many',
                label: 'allowancePeriods',
            },
            reverse: {
                on: 'calculatedAllowancePeriods',
                has: 'one',
                label: 'familyMember',
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
        tasksAttachments: {
            forward: {
                on: 'tasks',
                has: 'many',
                label: 'attachments',
            },
            reverse: {
                on: 'taskAttachments',
                has: 'one',
                label: 'task',
            },
        },
        tasksParentTask: {
            forward: {
                on: 'tasks',
                has: 'one',
                label: 'parentTask',
            },
            reverse: {
                on: 'tasks',
                has: 'many',
                label: 'subTasks',
            },
        },
        tasksPrerequisites: {
            forward: {
                on: 'tasks',
                has: 'many',
                label: 'prerequisites',
            },
            reverse: {
                on: 'tasks',
                has: 'many',
                label: 'subsequentTasks',
            },
        },
        taskSeriesFamilyMember: {
            forward: {
                on: 'taskSeries',
                has: 'one',
                label: 'familyMember',
            },
            reverse: {
                on: 'familyMembers',
                has: 'many',
                label: 'taskSeries',
            },
        },
        taskSeriesScheduledActivity: {
            forward: {
                on: 'taskSeries',
                has: 'one',
                label: 'scheduledActivity',
            },
            reverse: {
                on: 'chores',
                has: 'many',
                label: 'taskSeries',
            },
        },
        taskSeriesTasks: {
            forward: {
                on: 'taskSeries',
                has: 'many',
                label: 'tasks',
            },
            reverse: {
                on: 'tasks',
                has: 'one',
                label: 'taskSeries',
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
