// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from '@instantdb/react';

const AUTHENTICATED = 'auth.id != null';

const authdEntity = {
    allow: {
        view: AUTHENTICATED,
        create: AUTHENTICATED,
        update: AUTHENTICATED,
        delete: AUTHENTICATED,
    },
} as const;

const rules = {
    // Shared-family Instant auth token gates app data.
    // Parent vs child restrictions intentionally remain UI-only for now.
    $users: {
        allow: {
            view: AUTHENTICATED,
            update: AUTHENTICATED,
        },
    },
    $files: {
        allow: {
            view: AUTHENTICATED,
            create: AUTHENTICATED,
            delete: AUTHENTICATED,
        },
    },
    allowanceEnvelopes: authdEntity,
    allowanceTransactions: authdEntity,
    calculatedAllowancePeriods: authdEntity,
    calendarItems: authdEntity,
    choreAssignments: authdEntity,
    choreCompletions: authdEntity,
    chores: authdEntity,
    deviceSessions: authdEntity,
    exchangeRates: authdEntity,
    familyMembers: authdEntity,
    settings: authdEntity,
    taskAttachments: authdEntity,
    taskSeries: authdEntity,
    tasks: authdEntity,
    timeOfDayDefinitions: authdEntity,
    todos: authdEntity,
    unitDefinitions: authdEntity,
} satisfies InstantRules;

export default rules;
