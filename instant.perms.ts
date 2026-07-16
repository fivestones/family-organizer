// Docs: https://www.instantdb.com/docs/permissions

import type { InstantRules } from '@instantdb/react';

const rules = {
    familyRuleVersions: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'false',
            unlink: {
                $default: 'isParent',
            },
            update: 'false',
        },
    },
    familyDashboardLayouts: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    dashboardConfigs: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'isFamilyPrincipal',
            unlink: {
                $default: 'isFamilyPrincipal',
            },
            update: 'isFamilyPrincipal',
        },
    },
    messageAcknowledgements: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            canViewViaMessage: "isParent || authFamilyMemberId in data.ref('message.thread.members.familyMember.id')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            authFamilyMemberId: "auth.ref('$user.familyMemberId')[0]",
        },
        allow: {
            link: {
                $default: 'false',
            },
            view: 'canViewViaMessage',
            create: 'false',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    attrs: {
        allow: {
            create: 'false',
        },
    },
    messageReactions: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            canViewViaMessage: "isParent || authFamilyMemberId in data.ref('message.thread.members.familyMember.id')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            authFamilyMemberId: "auth.ref('$user.familyMemberId')[0]",
        },
        allow: {
            link: {
                $default: 'false',
            },
            view: 'canViewViaMessage',
            create: 'false',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    calendarSyncLocks: {
        allow: {
            link: {
                $default: 'false',
            },
            view: 'false',
            create: 'false',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    contentQueueItems: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    tasks: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'isFamilyPrincipal',
            unlink: {
                $default: 'isFamilyPrincipal',
            },
            update: 'isFamilyPrincipal',
        },
    },
    contentCategories: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    messageAttachments: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            canViewViaMessage: "isParent || authFamilyMemberId in data.ref('message.thread.members.familyMember.id')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            authFamilyMemberId: "auth.ref('$user.familyMemberId')[0]",
        },
        allow: {
            link: {
                $default: 'false',
            },
            view: 'canViewViaMessage',
            create: 'false',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    allowanceTransactions: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            auditMatchesPrincipal: 'data.createdBy == auth.id',
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal && auditMatchesPrincipal',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'false',
        },
    },
    settings: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    historyEventAttachments: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    calendarTags: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    familyDashboardWidgets: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    calendarSyncAccounts: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isParent',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    taskUpdates: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'isFamilyPrincipal',
            unlink: {
                $default: 'isFamilyPrincipal',
            },
            update: 'isFamilyPrincipal',
        },
    },
    gradeTypes: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    taskSeries: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    $users: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            view: 'auth.id == data.id || isParent',
            update: 'false',
        },
        fields: {
            type: 'auth.id == data.id || isParent',
        },
    },
    allowanceEnvelopes: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            ownsEnvelope: "isKid && auth.ref('$user.familyMemberId')[0] in data.ref('familyMember.id')",
            kidSafeEnvelopeUpdate:
                "request.modifiedFields.all(field, field in ['name', 'description', 'goalAmount', 'goalCurrency', 'isDefault'])",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent || (ownsEnvelope && kidSafeEnvelopeUpdate)',
        },
    },
    taskResponseFields: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    timeOfDayDefinitions: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    deviceSessions: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    historyEvents: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            authFamilyMemberIds: "auth.ref('$user.familyMemberId')",
            hasAuthFamilyMemberId: "authFamilyMemberIds.exists(memberId, memberId != '')",
            kidOwnActor: 'data.actorFamilyMemberId in authFamilyMemberIds',
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
                actor: "isParent || (isKid && data.actorFamilyMemberId in auth.ref('$user.familyMemberId'))",
            },
            view: 'isFamilyPrincipal',
            create: 'isParent || (isKid && hasAuthFamilyMemberId && kidOwnActor)',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    pushDevices: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            authFamilyMemberId: "auth.ref('$user.familyMemberId')[0]",
        },
        allow: {
            link: {
                $default: 'false',
            },
            view: 'isParent || authFamilyMemberId == data.familyMemberId',
            create: 'false',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    routineMarkerStatuses: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    choreAssignments: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    exchangeRates: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    calendarSyncCalendars: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    $default: {
        allow: {
            link: {
                $default: 'false',
            },
            view: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            create: 'false',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    announcements: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    presence: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'isFamilyPrincipal',
            unlink: {
                $default: 'isFamilyPrincipal',
            },
            update: 'isFamilyPrincipal',
        },
    },
    $streams: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'false',
            update: 'false',
        },
    },
    calendarItems: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    messageThreads: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            canViewThread: "isParent || authFamilyMemberId in data.ref('members.familyMember.id')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            authFamilyMemberId: "auth.ref('$user.familyMemberId')[0]",
        },
        allow: {
            link: {
                $default: 'false',
            },
            view: 'canViewThread',
            create: 'false',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    calculatedAllowancePeriods: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    unitDefinitions: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    messages: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            canViewMessage: "isParent || authFamilyMemberId in data.ref('thread.members.familyMember.id')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            authFamilyMemberId: "auth.ref('$user.familyMemberId')[0]",
        },
        allow: {
            link: {
                $default: 'false',
            },
            view: 'canViewMessage',
            create: 'false',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    taskResponseFieldValues: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'isFamilyPrincipal',
            unlink: {
                $default: 'isFamilyPrincipal',
            },
            update: 'isFamilyPrincipal',
        },
    },
    contentAttachments: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    taskUpdateAttachments: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'isFamilyPrincipal',
            unlink: {
                $default: 'isFamilyPrincipal',
            },
            update: 'isFamilyPrincipal',
        },
    },
    choreCompletions: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            authFamilyMemberIds: "auth.ref('$user.familyMemberId')",
            hasAuthFamilyMemberId: "authFamilyMemberIds.exists(memberId, memberId != '')",
            ownsCompletion: "hasAuthFamilyMemberId && authFamilyMemberIds[0] in data.ref('completedBy.id')",
            kidSafeCompletionUpdate:
                "request.modifiedFields.all(field, field in ['completed', 'notDone', 'dateCompleted'])",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent || (isKid && hasAuthFamilyMemberId && data.allowanceAwarded == false)',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent || (isKid && ownsCompletion && kidSafeCompletionUpdate)',
        },
    },
    messageThreadMembers: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            canViewMembership: "isParent || authFamilyMemberId == data.familyMemberId || authFamilyMemberId in data.ref('thread.members.familyMember.id')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            authFamilyMemberId: "auth.ref('$user.familyMemberId')[0]",
        },
        allow: {
            link: {
                $default: 'false',
            },
            view: 'canViewMembership',
            create: 'false',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    choreManualStarts: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'isFamilyPrincipal',
            unlink: {
                $default: 'isFamilyPrincipal',
            },
            update: 'isFamilyPrincipal',
        },
    },
    familyRules: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    $files: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'isFamilyPrincipal',
            unlink: {
                $default: 'isFamilyPrincipal',
            },
            update: 'isFamilyPrincipal',
        },
    },
    chores: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isParent',
                completions: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isParent',
            },
            update: 'isParent',
        },
    },
    calendarSyncRuns: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'false',
            },
            view: 'isParent',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'false',
            },
            update: 'isParent',
        },
    },
    familyMembers: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
            authFamilyMemberIds: "auth.ref('$user.familyMemberId')",
            kidSafeFamilyMemberUpdate:
                "request.modifiedFields.all(field, field in ['lastDisplayCurrency', 'viewShowChoreDescriptions', 'viewShowTaskDetails', 'messageQuietHoursEnabled', 'messageQuietHoursStart', 'messageQuietHoursEnd', 'messageDigestMode', 'messageDigestWindowMinutes'])",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
                completedChores:
                    "'parent' in auth.ref('$user.type') || ('kid' in auth.ref('$user.type') && data.id in auth.ref('$user.familyMemberId'))",
                markedCompletions:
                    "'parent' in auth.ref('$user.type') || ('kid' in auth.ref('$user.type') && data.id in auth.ref('$user.familyMemberId'))",
                actedHistoryEvents:
                    "'parent' in auth.ref('$user.type') || ('kid' in auth.ref('$user.type') && data.id in auth.ref('$user.familyMemberId'))",
            },
            view: 'isFamilyPrincipal',
            create: 'isParent',
            delete: 'isParent',
            unlink: {
                $default: 'isFamilyPrincipal',
            },
            update: 'isParent || (isKid && data.id in authFamilyMemberIds && kidSafeFamilyMemberUpdate)',
        },
        fields: {
            pinHash: 'isParent || data.id in authFamilyMemberIds',
        },
    },
    shortcutTokens: {
        allow: {
            link: {
                $default: 'false',
            },
            view: 'false',
            create: 'false',
            delete: 'false',
            unlink: {
                $default: 'false',
            },
            update: 'false',
        },
    },
    taskAttachments: {
        bind: {
            isKid: "'kid' in auth.ref('$user.type')",
            isParent: "'parent' in auth.ref('$user.type')",
            isFamilyPrincipal: "'parent' in auth.ref('$user.type') || 'kid' in auth.ref('$user.type')",
        },
        allow: {
            link: {
                $default: 'isFamilyPrincipal',
            },
            view: 'isFamilyPrincipal',
            create: 'isFamilyPrincipal',
            delete: 'isFamilyPrincipal',
            unlink: {
                $default: 'isFamilyPrincipal',
            },
            update: 'isFamilyPrincipal',
        },
    },
} satisfies InstantRules;

export default rules;
