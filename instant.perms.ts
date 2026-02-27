// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from '@instantdb/react';

const IS_PARENT = "'parent' in auth.ref('$user.type')";
const IS_KID = "'kid' in auth.ref('$user.type')";
const IS_FAMILY_PRINCIPAL = `${IS_PARENT} || ${IS_KID}`;

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
    chores: PARENT_MUTABLE,
    deviceSessions: PARENT_MUTABLE,
    exchangeRates: FAMILY_MUTABLE,

    familyMembers: {
        bind: {
            isParent: IS_PARENT,
            isKid: IS_KID,
            isFamilyPrincipal: IS_FAMILY_PRINCIPAL,
            kidSafeFamilyMemberUpdate:
                "request.modifiedFields.all(field, field in ['lastDisplayCurrency', 'viewShowChoreDescriptions', 'viewShowTaskDetails'])",
        },
        allow: {
            view: 'isFamilyPrincipal',
            create: 'isParent',
            // Shared kid principal cannot be tied to one row, so this is intentionally limited to a safe field subset.
            update: "isParent || (isKid && kidSafeFamilyMemberUpdate)",
            delete: 'isParent',
            link: { $default: 'isParent' },
            unlink: { $default: 'isParent' },
        },
        fields: {
            // Hide parent PIN hashes from the kid principal. Child PIN hashes remain visible for low-friction client-side kid login.
            pinHash: "isParent || (isKid && data.role != 'parent')",
        },
    },

    settings: PARENT_MUTABLE,
    taskAttachments: FAMILY_MUTABLE,
    tasks: FAMILY_MUTABLE,
    taskSeries: PARENT_MUTABLE,
    timeOfDayDefinitions: PARENT_MUTABLE,
    todos: FAMILY_MUTABLE,
    unitDefinitions: PARENT_MUTABLE,
} satisfies InstantRules;

export default rules;
