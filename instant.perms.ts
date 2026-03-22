// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from '@instantdb/react';

const IS_PARENT = "'parent' in auth.ref('$user.type')";
const IS_KID = "'kid' in auth.ref('$user.type')";
const IS_FAMILY_PRINCIPAL = `${IS_PARENT} || ${IS_KID}`;
const AUTH_FAMILY_MEMBER_ID = "auth.ref('$user.familyMemberId')[0]";

const DENY_BY_DEFAULT = {
    allow: {
        view: IS_FAMILY_PRINCIPAL,
        create: 'false',
        update: 'false',
        delete: 'false',
        link: { $default: 'false' },
        unlink: { $default: 'false' },
    },
} as const;

const FAMILY_MUTABLE = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
    },
    allow: {
        view: 'isFamilyPrincipal',
        create: 'isFamilyPrincipal',
        update: 'isFamilyPrincipal',
        delete: 'isFamilyPrincipal',
        link: { $default: 'isFamilyPrincipal' },
        unlink: { $default: 'isFamilyPrincipal' },
    },
} as const;

const PARENT_MUTABLE = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
    },
    allow: {
        view: 'isFamilyPrincipal',
        create: 'isParent',
        update: 'isParent',
        delete: 'isParent',
        link: { $default: 'isParent' },
        unlink: { $default: 'isParent' },
    },
} as const;

const FAMILY_READ_PARENT_WRITE = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
    },
    allow: {
        view: 'isFamilyPrincipal',
        create: 'isParent',
        update: 'isParent',
        delete: 'isParent',
        link: { $default: 'isFamilyPrincipal' },
        unlink: { $default: 'isParent' },
    },
} as const;

const FAMILY_IMMUTABLE_LOG = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
    },
    allow: {
        view: 'isFamilyPrincipal',
        create: 'isFamilyPrincipal',
        update: 'false',
        delete: 'false',
        link: { $default: 'isFamilyPrincipal' },
        unlink: { $default: 'false' },
    },
} as const;

const FAMILY_CREATE_UPDATE = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
    },
    allow: {
        view: 'isFamilyPrincipal',
        create: 'isFamilyPrincipal',
        update: 'isFamilyPrincipal',
        delete: 'false',
        link: { $default: 'isFamilyPrincipal' },
        unlink: { $default: 'isFamilyPrincipal' },
    },
} as const;

const CHORES_PARENT_WRITE_FAMILY_COMPLETIONS = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
    },
    allow: {
        view: 'isFamilyPrincipal',
        create: 'isParent',
        update: 'isParent',
        delete: 'isParent',
        // Kids need to attach completion rows to existing chores, but should not be able to relink assignees/assignments.
        link: {
            completions: 'isFamilyPrincipal',
            $default: 'isParent',
        },
        unlink: { $default: 'isParent' },
    },
} as const;

const MESSAGE_THREADS_READ_ONLY = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
        authFamilyMemberId: AUTH_FAMILY_MEMBER_ID,
        canViewThread: "isParent || authFamilyMemberId in data.ref('members.familyMember.id')",
    },
    allow: {
        view: 'canViewThread',
        create: 'false',
        update: 'false',
        delete: 'false',
        link: { $default: 'false' },
        unlink: { $default: 'false' },
    },
} as const;

const MESSAGE_MEMBERS_READ_ONLY = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
        authFamilyMemberId: AUTH_FAMILY_MEMBER_ID,
        canViewMembership: "isParent || authFamilyMemberId == data.familyMemberId || authFamilyMemberId in data.ref('thread.members.familyMember.id')",
    },
    allow: {
        view: 'canViewMembership',
        create: 'false',
        update: 'false',
        delete: 'false',
        link: { $default: 'false' },
        unlink: { $default: 'false' },
    },
} as const;

const MESSAGE_ROWS_READ_ONLY = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
        authFamilyMemberId: AUTH_FAMILY_MEMBER_ID,
        canViewMessage: "isParent || authFamilyMemberId in data.ref('thread.members.familyMember.id')",
    },
    allow: {
        view: 'canViewMessage',
        create: 'false',
        update: 'false',
        delete: 'false',
        link: { $default: 'false' },
        unlink: { $default: 'false' },
    },
} as const;

const MESSAGE_CHILD_ROWS_READ_ONLY = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
        authFamilyMemberId: AUTH_FAMILY_MEMBER_ID,
        canViewViaMessage: "isParent || authFamilyMemberId in data.ref('message.thread.members.familyMember.id')",
    },
    allow: {
        view: 'canViewViaMessage',
        create: 'false',
        update: 'false',
        delete: 'false',
        link: { $default: 'false' },
        unlink: { $default: 'false' },
    },
} as const;

const PUSH_DEVICES_READ_ONLY = {
    bind: {
        isParent: IS_PARENT,
        isKid: IS_KID,
        isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
        authFamilyMemberId: AUTH_FAMILY_MEMBER_ID,
    },
    allow: {
        view: 'isParent || authFamilyMemberId == data.familyMemberId',
        create: 'false',
        update: 'false',
        delete: 'false',
        link: { $default: 'false' },
        unlink: { $default: 'false' },
    },
} as const;

const rules = {
    // Safety net: any future entity is family-readable but not writable until explicitly added.
    $default: DENY_BY_DEFAULT,

    // Prevent clients from inventing new namespaces/attrs dynamically.
    attrs: {
        allow: {
            create: 'false',
        },
    },

    // Instant auth users for the DB principals (shared kid / shared parent).
    $users: {
        bind: {
            isParent: IS_PARENT,
            isKid: IS_KID,
            isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
        },
        allow: {
            // Keep self-view default semantics, but permit parent to inspect principal rows for debugging/admin.
            view: 'auth.id == data.id || isParent',
            // Only admin routes should mutate principal role typing.
            update: 'false',
        },
        fields: {
            type: 'auth.id == data.id || isParent',
        },
    },

    $files: FAMILY_MUTABLE,

    allowanceEnvelopes: {
        ...FAMILY_READ_PARENT_WRITE,
        allow: {
            ...FAMILY_READ_PARENT_WRITE.allow,
            // Shared kid principal may add/delete/manage envelopes in v1 mobile finance.
            // UI enforces self-envelope constraints until per-member principals are introduced.
            create: 'isFamilyPrincipal',
            update: 'isFamilyPrincipal',
            delete: 'isFamilyPrincipal',
            link: { $default: 'isFamilyPrincipal' },
            unlink: { $default: 'isFamilyPrincipal' },
        },
    },

    allowanceTransactions: {
        bind: {
            isParent: IS_PARENT,
            isKid: IS_KID,
            isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
            auditMatchesPrincipal: 'data.createdBy == auth.id',
        },
        allow: {
            view: 'isFamilyPrincipal',
            // We intentionally allow both kid and parent principals to create transactions,
            // but require a trustworthy audit stamp bound to the current DB principal.
            create: 'isFamilyPrincipal && auditMatchesPrincipal',
            // Preserve the ledger trail; clients should not edit historical rows.
            update: 'false',
            delete: 'isParent',
            link: { $default: 'isFamilyPrincipal' },
            unlink: { $default: 'isParent' },
        },
    },

    calculatedAllowancePeriods: FAMILY_MUTABLE,
    calendarItems: PARENT_MUTABLE,
    calendarTags: PARENT_MUTABLE,
    calendarSyncAccounts: PARENT_MUTABLE,
    calendarSyncCalendars: PARENT_MUTABLE,
    calendarSyncLocks: {
        allow: {
            view: 'false',
            create: 'false',
            update: 'false',
            delete: 'false',
            link: { $default: 'false' },
            unlink: { $default: 'false' },
        },
    },
    calendarSyncRuns: {
        bind: {
            isParent: IS_PARENT,
            isKid: IS_KID,
            isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
        },
        allow: {
            view: 'isParent',
            create: 'isParent',
            update: 'isParent',
            delete: 'isParent',
            link: { $default: 'false' },
            unlink: { $default: 'false' },
        },
    },
    choreAssignments: PARENT_MUTABLE,
    choreCompletions: {
        bind: {
            isParent: IS_PARENT,
            isKid: IS_KID,
            isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
        },
        allow: {
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            update: 'isFamilyPrincipal',
            delete: 'isParent',
            link: { $default: 'isFamilyPrincipal' },
            unlink: { $default: 'isParent' },
        },
    },
    chores: CHORES_PARENT_WRITE_FAMILY_COMPLETIONS,
    dashboardConfigs: FAMILY_MUTABLE,
    deviceSessions: PARENT_MUTABLE,
    exchangeRates: FAMILY_MUTABLE,
    historyEventAttachments: FAMILY_IMMUTABLE_LOG,
    historyEvents: FAMILY_IMMUTABLE_LOG,

    familyMembers: {
        bind: {
            isParent: IS_PARENT,
            isKid: IS_KID,
            isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
            kidSafeFamilyMemberUpdate:
                "request.modifiedFields.all(field, field in ['lastDisplayCurrency', 'viewShowChoreDescriptions', 'viewShowTaskDetails', 'messageQuietHoursEnabled', 'messageQuietHoursStart', 'messageQuietHoursEnd', 'messageDigestMode', 'messageDigestWindowMinutes'])",
        },
        allow: {
            view: 'isFamilyPrincipal',
            create: 'isParent',
            // Shared kid principal cannot be tied to one row, so this is intentionally limited to a safe field subset.
            update: "isParent || (isKid && kidSafeFamilyMemberUpdate)",
            delete: 'isParent',
            link: { $default: 'isFamilyPrincipal' },
            unlink: { $default: 'isFamilyPrincipal' },
        },
        fields: {
            pinHash: "isParent || data.role != 'parent'",
        },
    },

    messageAcknowledgements: MESSAGE_CHILD_ROWS_READ_ONLY,
    messageAttachments: MESSAGE_CHILD_ROWS_READ_ONLY,
    messageReactions: MESSAGE_CHILD_ROWS_READ_ONLY,
    messages: MESSAGE_ROWS_READ_ONLY,
    messageThreadMembers: MESSAGE_MEMBERS_READ_ONLY,
    messageThreads: MESSAGE_THREADS_READ_ONLY,
    presence: FAMILY_MUTABLE,
    pushDevices: PUSH_DEVICES_READ_ONLY,
    routineMarkerStatuses: PARENT_MUTABLE,
    shortcutTokens: {
        allow: {
            view: 'false',
            create: 'false',
            update: 'false',
            delete: 'false',
            link: { $default: 'false' },
            unlink: { $default: 'false' },
        },
    },
    gradeTypes: PARENT_MUTABLE,
    settings: PARENT_MUTABLE,
    taskAttachments: FAMILY_MUTABLE,
    taskResponseFieldValues: FAMILY_MUTABLE,
    taskResponseFields: {
        bind: {
            isParent: IS_PARENT,
            isKid: IS_KID,
            isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
        },
        allow: {
            view: 'isFamilyPrincipal',
            create: 'isParent',
            update: 'isParent',
            delete: 'isParent',
            // Kids need to link their response values to fields
            link: { $default: 'isFamilyPrincipal' },
            unlink: { $default: 'isParent' },
        },
    },
    tasks: FAMILY_MUTABLE,
    taskUpdateAttachments: FAMILY_MUTABLE,
    taskUpdates: FAMILY_MUTABLE,
    taskSeries: PARENT_MUTABLE,
    timeOfDayDefinitions: PARENT_MUTABLE,
    todos: FAMILY_MUTABLE,
    unitDefinitions: PARENT_MUTABLE,
} satisfies InstantRules;

export default rules;
