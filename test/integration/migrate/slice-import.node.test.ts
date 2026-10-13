import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import * as choreTiming from '@/packages/shared-core/src/chore-timing';
import { applyMigrations, listMigrations } from '@/db/migrate.mjs';
import { describeImport, loadTables, readExport } from '@/scripts/migrate/import.mjs';
import { buildRows } from '@/scripts/migrate/mapping.mjs';
import { verifyImport } from '@/scripts/migrate/verify.mjs';

// The move from Instant to Postgres for the first tables: an export goes through the mapping into the schema, and the
// verification, which shares no code with the mapping, agrees. Everything here is invented; no real data is used.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ADA = id(1);
const BEN = id(2);
const CAL = id(3);
const DISHES = id(10);
const TRASH = id(11);
const PIANO = id(12);
const LAUNDRY = id(13);

type Rows = Record<string, Array<Record<string, unknown>>>;

/** A small family as Instant would export it, with each link on the side Instant's schema declares it forward. */
function family(): Rows {
    return withMessages(withContent(withMoney(withTaskSeries(base()))));
}

function base(): Rows {
    return ({
        settings: [
            { id: id(100), name: 'dashboardTheme', value: 'dark' },
            { id: id(101), name: 'enabledCurrencies', value: '["USD","STARS"]' },
        ],
        unitDefinitions: [{ id: id(110), code: 'STARS', name: 'Stars', symbol: '★', isMonetary: false, symbolPlacement: 'after', symbolSpacing: true, decimalPlaces: 0 }],
        familyMembers: [
            { id: ADA, name: 'Ada', role: 'parent', order: 0, email: '', pinHash: 'scrypt$abc', photoUrls: { '64': 'a64.png', '320': 'a320.png', '1200': 'a1200.png' }, allowancePayoutDelayDays: 0, allowanceStartDate: null, assignedChores: [DISHES, TRASH], completedChores: [id(40)], actedHistoryEvents: [id(60), id(62)], affectedHistoryEvents: [id(60)] },
            { id: BEN, name: 'Ben', role: 'child', order: 1, email: '', color: '#3366ff', allowancePayoutDelayDays: 2, allowanceStartDate: '2026-01-05T00:00:00.000Z', messageQuietHoursStart: '21:30', messageDigestMode: 'digest', assignedChores: [DISHES, TRASH, PIANO, LAUNDRY], completedChores: [id(41), id(42)], affectedHistoryEvents: [id(62)] },
            { id: CAL, name: 'Cal', role: 'child', order: 2, email: '', assignedChores: [TRASH], completedChores: [id(43)] },
        ],
        chores: [
            { id: DISHES, title: 'Dishes', description: '', startDate: '2026-01-01T00:00:00.000Z', createdAt: '2025-12-31T18:00:00.000Z', rrule: 'FREQ=DAILY', rotationType: 'none', done: false, isJoint: true, isUpForGrabs: false, sortOrder: 1, weight: 2, exdates: ['2026-01-03', '2026-01-02'], timingMode: 'named_window', timingConfig: { mode: 'named_window', namedWindowKey: 'Evening' }, completions: [id(40), id(41)], routineSteps: [id(81)] },
            // Rotates between three people, in an order that is not the family's.
            { id: TRASH, title: 'Trash', startDate: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T08:00:00.000Z', rrule: 'FREQ=WEEKLY', rotationType: 'weekly', done: false, sortOrder: 2, assignments: [id(30), id(31), id(32)], timingMode: null, timeBucket: 'morning', completions: [id(43)] },
            // An earlier generation's name for "after a routine marker", with the fallback on the old start field.
            { id: PIANO, title: 'Piano', startDate: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T08:00:00.000Z', rrule: null, rotationType: 'none', done: false, sortOrder: 3, timingMode: 'routine_anchor', timingConfig: { mode: 'routine_anchor', anchor: { sourceType: 'routine', relation: 'after', routineKey: 'Dinner', fallbackStartTime: '18:30' } }, completions: [id(42)], routineSteps: [id(82)] },
            // Due after another chore.
            { id: LAUNDRY, title: 'Laundry', startDate: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T08:00:00.000Z', rotationType: 'none', done: false, sortOrder: 4, isUpForGrabs: true, rewardType: 'fixed', rewardAmount: 1.5, rewardCurrency: 'USD', estimatedDurationSecs: 600, pauseState: { mode: 'bounded', intent: 'vacation', pauseStartDate: '2026-02-01', resumeOnDate: '2026-02-08', generatedExdates: [], originalEndCondition: { type: 'none' }, createdAt: '2026-01-20T00:00:00.000Z' }, timingMode: 'after_chore', timingConfig: { mode: 'after_chore', anchor: { sourceType: 'chore', sourceChoreId: DISHES, fallbackTime: '19:00', event: 'completed' } } },
        ],
        choreAssignments: [
            { id: id(30), order: 0, familyMember: CAL },
            { id: id(31), order: 1, familyMember: ADA },
            { id: id(32), order: 2, familyMember: BEN },
        ],
        routines: [{ id: id(80), name: 'Evening', onStepOverrun: 'advance', sortOrder: 1, createdAt: '2026-01-01T08:00:00.000Z', steps: [id(81), id(82)] }],
        // Stored out of order, as the export may hold them: piano is second.
        routineSteps: [{ id: id(82), position: 1 }, { id: id(81), position: 0 }],
        routineMarkerStatuses: [
            { id: id(85), key: '2026-01-04:dinner', date: '2026-01-04', markerKey: 'dinner', startedAt: '2026-01-04T18:00:00.000Z', startedById: ADA, completedAt: null, completedById: null },
        ],
        countdownRuns: [
            { id: id(90), familyMemberId: BEN, date: '2026-01-05', routineId: id(80), status: 'stopped', currentChoreId: null, skippedChoreIds: [PIANO], startedAt: '2026-01-05T15:00:00.000Z', stepStartedAt: null, stepExtensionSecs: 30, stepExtensionCount: 1, lastInteractionAt: '2026-01-05T15:20:00.000Z', stoppedAt: '2026-01-05T15:30:00.000Z', stoppedReason: 'finished' },
        ],
        historyEvents: [
            // Ada ticked the dishes; a calendar sync, which nobody did; and Ada ticking Ben's piano for him.
            { id: id(60), occurredAt: '2026-01-04T19:05:00.000Z', domain: 'chores', actionType: 'chore_marked_done', summary: 'Completed "Dishes"', source: 'manual', actorFamilyMemberId: ADA, choreId: DISHES, scheduledForDate: '2026-01-04', metadata: { choreTitle: 'Dishes', completed: true, dateDue: '2026-01-04' }, restoreTiming: null },
            { id: id(61), occurredAt: '2026-01-05T02:00:00.000Z', domain: 'calendar', actionType: 'calendar_event_updated', summary: 'Updated "Dentist"', source: 'apple_sync', actorFamilyMemberId: null, calendarItemId: id(70), metadata: {} },
            { id: id(62), occurredAt: '2026-01-05T16:00:00.000Z', domain: 'chores', actionType: 'chore_marked_done', summary: 'Completed "Piano"', source: 'manual', actorFamilyMemberId: ADA, choreId: PIANO, scheduledForDate: '2026-01-05', metadata: { choreTitle: 'Piano' } },
        ],
        choreCompletions: [
            { id: id(40), completed: true, dateDue: '2026-01-04', dateCompleted: '2026-01-04T19:05:00.000Z', allowanceAwarded: false, markedBy: ADA },
            { id: id(41), completed: false, dateDue: '2026-01-04', dateCompleted: null, notDone: true, allowanceAwarded: false, markedBy: ADA },
            { id: id(42), completed: true, dateDue: '2026-01-05', dateCompleted: '2026-01-05T16:00:00.000Z', allowanceAwarded: true },
            { id: id(43), completed: false, dateDue: '2026-01-05', dateCompleted: null, allowanceAwarded: false },
        ],
    });
}

/**
 * Ben saves in dollars and stars and has a second, empty envelope; Cal has one. Ada paid fifteen dollars into Ben's
 * savings, Ben passed two and a half on to Cal, and Cal spent a little under half a dollar: an amount with a part of
 * a cent in it, which must come through as it is.
 */
function withMoney(rows: Rows): Rows {
    const made = { createdBy: 'instant-user-ada', createdByFamilyMemberId: ADA };
    const entry = (n: number, minute: number, fields: Record<string, unknown>) => ({ id: id(n), createdAt: `2026-01-05T09:${String(minute).padStart(2, '0')}:00.000Z`, updatedAt: `2026-01-05T09:${String(minute).padStart(2, '0')}:00.000Z`, distributionKey: null, ...made, ...fields });
    return {
        ...rows,
        allowanceEnvelopes: [
            { id: id(200), name: 'Savings', isDefault: true, balances: { USD: 12.5, STARS: 3 }, goalAmount: 50, goalCurrency: 'USD', archivedAt: null, familyMember: BEN },
            { id: id(201), name: 'Spending', isDefault: false, balances: {}, goalAmount: null, goalCurrency: null, archivedAt: null, familyMember: BEN },
            { id: id(202), name: 'Savings', isDefault: true, balances: { USD: 2.005 }, archivedAt: null, familyMember: CAL },
        ],
        allowanceTransactions: [
            entry(210, 0, { transactionType: 'init', amount: 0, currency: 'USD', description: 'Initial balance', envelope: id(200) }),
            entry(211, 1, { transactionType: 'deposit', amount: 15, currency: 'USD', description: 'Birthday', envelope: id(200), destinationEnvelope: id(200) }),
            entry(212, 2, { transactionType: 'transfer-out-person', amount: -2.5, currency: 'USD', description: 'To Cal', envelope: id(200), sourceEnvelope: id(200), destinationEnvelope: id(202), createdBy: 'instant-user-ben', createdByFamilyMemberId: BEN }),
            entry(213, 2, { transactionType: 'transfer-in-person', amount: 2.5, currency: 'USD', description: 'From Ben', envelope: id(202), sourceEnvelope: id(200), destinationEnvelope: id(202), createdBy: 'instant-user-ben', createdByFamilyMemberId: BEN }),
            entry(214, 3, { transactionType: 'withdrawal', amount: -0.495, currency: 'USD', description: 'Sweets', envelope: id(202) }),
            entry(215, 4, { transactionType: 'allowance-distribution', amount: 3, currency: 'STARS', description: 'Allowance', envelope: id(200), destinationEnvelope: id(200), distributionKey: `${BEN}:2026-01-01:2026-01-07:STARS`, createdBy: null, createdByFamilyMemberId: null }),
        ],
        exchangeRates: [{ id: id(220), baseCurrency: 'USD', targetCurrency: 'NPR', pairKey: 'USD:NPR', rate: 133.5, lastFetchedTimestamp: '2026-01-05T00:00:00.000Z' }],
    };
}

/**
 * What the family posts: an announcement showing and one taken down, a verse on show from the queue with a picture,
 * and a house rule in its second version. The phone layout of the dashboard with one widget, Ben's own
 * arrangement of his, and a photo on the history entry for the dishes.
 */
function withContent(rows: Rows): Rows {
    const made = { createdAt: '2026-01-02T08:00:00.000Z', updatedAt: '2026-01-03T08:00:00.000Z' };
    Object.assign(rows.historyEvents.find((row) => row.id === id(60))!, { attachments: [id(360)] });
    return {
        ...rows,
        announcements: [
            { id: id(300), title: 'Grandma visits', richTextContent: '<p>On Friday.</p>', linkUrl: '', createdByFamilyMemberId: ADA, expiresAt: '2026-01-10T00:00:00.000Z', isActive: true, archivedAt: null, ...made, attachments: [] },
            { id: id(301), title: 'Bins on Tuesday', richTextContent: '', linkUrl: 'https://example.org/bins', createdByFamilyMemberId: '', expiresAt: '', isActive: false, archivedAt: '2026-01-02T20:00:00.000Z', ...made, attachments: [] },
        ],
        contentCategories: [{ id: id(310), slug: 'verse', name: 'Verse of the week', defaultDurationMs: 604_800_000, loopWhenEmpty: true, ...made }],
        contentQueueItems: [
            { id: id(311), title: 'Psalm 23', richTextContent: '<p>The Lord is my shepherd.</p>', linkUrl: '', status: 'live', sortOrder: 1, durationMs: null, liveAt: '2026-01-04T00:00:00.000Z', liveUntil: '2026-01-11T00:00:00.000Z', archivedAt: '', ...made, category: id(310), createdBy: ADA, attachments: [id(330)] },
        ],
        contentAttachments: [{ id: id(330), name: 'psalm.png', type: 'image/png', url: 'content/psalm.png', kind: 'image', sizeBytes: 4096, width: 640, height: 480, ...made }],
        familyRules: [{ id: id(320), title: 'Screens', sortOrder: 1, isArchived: false, activeVersionId: id(322), ...made, versions: [id(321), id(322)] }],
        familyRuleVersions: [
            { id: id(321), versionNumber: 1, richTextContent: '<p>One hour a day.</p>', editNote: '', createdByFamilyMemberId: ADA, createdAt: '2026-01-02T08:00:00.000Z' },
            { id: id(322), versionNumber: 2, richTextContent: '<p>One hour a day, after chores.</p>', editNote: 'Chores first', createdByFamilyMemberId: ADA, createdAt: '2026-01-03T08:00:00.000Z', previousVersion: id(321) },
        ],
        familyDashboardLayouts: [{ id: id(340), breakpointKey: 'phone-portrait', label: 'Phone', minWidth: 0, maxWidth: 480, order: 0, isDefault: true, ...made }],
        familyDashboardWidgets: [{ id: id(341), widgetType: 'clock', x: 0, y: 0.5, w: 2, h: 1.25, z: 3, config: { format: '24h' }, ...made, layout: id(340) }],
        dashboardConfigs: [{ id: id(350), widgetOrder: ['chores', 'balance'], disabledWidgets: ['weather'], widgetSettings: { chores: { compact: true } }, updatedAt: Date.parse('2026-01-03T08:00:00.000Z'), familyMember: BEN }],
        historyEventAttachments: [{ id: id(360), name: 'proof.jpg', type: 'image/jpeg', url: 'history/proof.jpg', kind: 'image', sizeBytes: 2048, width: 320, height: 240, ...made }],
    };
}

/**
 * The family's thread, where Ada asked for an acknowledgement, Ben answered and reacted, and Cal's message was
 * removed by Ada; and a thread about the piano chore that nobody has written in yet.
 */
function withMessages(rows: Rows): Rows {
    const [FAMILY, ABOUT_PIANO] = [id(400), id(401)];
    const made = { createdAt: '2026-01-02T08:00:00.000Z', updatedAt: '2026-01-05T12:10:00.000Z' };
    const seat = (n: number, thread: string, person: string, fields: Record<string, unknown> = {}) => ({
        id: id(n), threadId: thread, familyMemberId: person, membershipKey: `${thread}:${person}`, memberRole: 'member', notificationLevel: 'all', isArchived: false, isPinned: false, pinnedAt: null,
        joinedAt: '2026-01-02T08:00:00.000Z', sortTimestamp: '2026-01-05T12:05:00.000Z', lastReadAt: null, lastReadMessageId: null, ...fields,
    });
    const said = (n: number, minute: number, author: string, body: string, fields: Record<string, unknown> = {}) => ({
        id: id(n), threadId: FAMILY, authorFamilyMemberId: author, body, importance: 'normal', isSystem: false, clientNonce: `nonce-${n}`, metadata: null, replyToMessageId: null, editedAt: null,
        createdAt: `2026-01-05T12:${String(minute).padStart(2, '0')}:00.000Z`, updatedAt: `2026-01-05T12:${String(minute).padStart(2, '0')}:00.000Z`, editableUntil: `2026-01-05T12:${String(minute + 15).padStart(2, '0')}:00.000Z`,
        deletedAt: null, removedByFamilyMemberId: null, removedReason: null, attachments: [], reactions: [], acknowledgements: [], ...fields,
    });
    return {
        ...rows,
        messageThreads: [
            { id: FAMILY, threadType: 'family', visibility: 'family', threadKey: 'family', title: 'Family', titleNormalized: 'family', searchText: 'family', linkedDomain: null, linkedEntityId: null, isClosed: false, createdByFamilyMemberId: ADA, latestMessageAt: '2026-01-05T12:05:00.000Z', latestMessageAuthorId: BEN, latestMessagePreview: 'On my way', ...made, members: [id(410), id(411), id(412)], messages: [id(420), id(421), id(422)] },
            { id: ABOUT_PIANO, threadType: 'linked', visibility: 'members', threadKey: `linked:chores:${PIANO}`, title: 'Piano', titleNormalized: 'piano', searchText: 'piano ada ben', linkedDomain: 'chores', linkedEntityId: PIANO, isClosed: false, createdByFamilyMemberId: ADA, latestMessageAt: null, latestMessageAuthorId: null, latestMessagePreview: null, ...made, members: [id(413), id(414)], messages: [] },
        ],
        messageThreadMembers: [
            seat(410, FAMILY, ADA, { memberRole: 'owner', isPinned: true, pinnedAt: '2026-01-03T08:00:00.000Z', lastReadAt: '2026-01-05T12:11:00.000Z', lastReadMessageId: id(422) }),
            seat(411, FAMILY, BEN, { lastReadAt: '2026-01-05T12:05:00.000Z', lastReadMessageId: id(421) }),
            seat(412, FAMILY, CAL, { notificationLevel: 'mute', isArchived: true }),
            seat(413, ABOUT_PIANO, ADA, { memberRole: 'owner' }),
            seat(414, ABOUT_PIANO, BEN, { memberRole: 'watcher', notificationLevel: 'watch' }),
        ],
        messages: [
            said(420, 0, ADA, 'Dinner at six', { importance: 'needs_ack', attachments: [id(430)], reactions: [id(440)], acknowledgements: [id(450), id(451)] }),
            said(421, 5, BEN, 'On my way', { replyToMessageId: id(420), replyTo: id(420) }),
            // Removed by a parent, and from before a message said how important it was.
            said(422, 10, CAL, '', { importance: null, isSystem: null, clientNonce: null, deletedAt: '2026-01-05T12:11:00.000Z', removedByFamilyMemberId: ADA, removedReason: 'Removed by parent' }),
        ],
        messageAttachments: [{ id: id(430), name: 'menu.jpg', type: 'image/jpeg', url: 'messages/menu.jpg', kind: 'image', sizeBytes: 1024, width: 200, height: 100, createdAt: '2026-01-05T12:00:00.000Z', updatedAt: '2026-01-05T12:00:00.000Z' }],
        messageReactions: [{ id: id(440), messageId: id(420), familyMemberId: BEN, emoji: '👍', reactionKey: `reaction:${id(420)}:${BEN}:👍`, createdAt: '2026-01-05T12:01:00.000Z' }],
        messageAcknowledgements: [
            { id: id(450), messageId: id(420), familyMemberId: BEN, kind: 'acknowledged', ackKey: `ack:${id(420)}:${BEN}:acknowledged`, createdAt: '2026-01-05T12:02:00.000Z' },
            // An older row, which said what it was only at the end of its key.
            { id: id(451), messageId: id(420), familyMemberId: CAL, ackKey: `ack:${id(420)}:${CAL}:seen`, createdAt: '2026-01-05T12:03:00.000Z' },
        ],
    };
}

const at = (iso: string) => Date.parse(iso);

/**
 * Ben's maths series on his piano chore: a task done, a task handed in with a sub-task under it, and a day break.
 * Ben handed the second task in with an answer and a photo, and Ada answered him with a provisional grade.
 */
function withTaskSeries(rows: Rows): Rows {
    const member = (memberId: string) => rows.familyMembers.find((row) => row.id === memberId)!;
    Object.assign(member(BEN), { actedTaskUpdates: [id(160)], affectedTaskUpdates: [id(160), id(161)] });
    Object.assign(member(ADA), { actedTaskUpdates: [id(161)] });
    const file = { blurhash: null, durationSec: 0, height: 0, width: 0, thumbnailHeight: 0, thumbnailWidth: 0, thumbnailUrl: null, waveformPeaks: null };
    return {
        ...rows,
        gradeTypes: [
            { id: id(120), name: 'Percent', kind: 'number', lowValue: 0, highValue: 100, lowLabel: 'Low', highLabel: 'High', steps: null, isDefault: true, order: 0, createdAt: at('2026-01-01T08:00:00.000Z'), updatedAt: at('2026-01-01T08:00:00.000Z') },
            { id: id(121), name: 'Letters', kind: 'letter', lowValue: 0, highValue: 100, lowLabel: 'F', highLabel: 'A', steps: [{ label: 'A', value: 90 }, { label: 'F', value: 0 }], isDefault: false, order: 1, createdAt: at('2026-01-01T08:00:00.000Z'), updatedAt: at('2026-01-02T08:00:00.000Z') },
        ],
        taskSeries: [
            // The start is midnight on the fifth where the family lives, east of Greenwich, so the instant is on the fourth.
            { id: id(130), name: 'Maths', description: '', startDate: '2026-01-04T18:15:00.000Z', targetEndDate: null, plannedEndDate: at('2026-02-01T00:00:00.000Z'), baselineDayBreakCount: 1, workAheadAllowed: true, dependsOnSeriesId: null, createdAt: '2026-01-01T08:00:00.000Z', updatedAt: '2026-01-03T08:00:00.000Z', familyMember: BEN, scheduledActivity: PIANO, tasks: [id(131), id(132), id(133), id(134)] },
        ],
        tasks: [
            { id: id(131), text: 'Read chapter 1', order: 0, indentationLevel: 0, isDayBreak: false, isCompleted: true, workflowState: 'done', lastActiveState: 'in_progress', childTasksComplete: true, completedAt: '2026-01-05T10:00:00.000Z', completedOnDate: '2026-01-05', deferredUntilDate: null, notedUntilDate: null, isNotedIndefinitely: null, updatedAt: '2026-01-05T10:00:00.000Z', attachments: [id(140)], prerequisites: [] },
            { id: id(132), text: 'Exercises', notes: 'Show your working.', order: 1, indentationLevel: 0, isDayBreak: false, isCompleted: false, workflowState: 'needs_review', lastActiveState: 'in_progress', childTasksComplete: false, specificTime: '16:30', completedAt: null, completedOnDate: null, updatedAt: '2026-01-05T11:00:00.000Z', attachments: [], prerequisites: [] },
            // From before a task had a workflow state: it was ticked, and that is all it says.
            { id: id(133), text: 'Odd numbers only', order: 2, indentationLevel: 1, isDayBreak: false, isCompleted: true, childTasksComplete: true, completedAt: '2026-01-05T10:30:00.000Z', completedOnDate: '2026-01-05', updatedAt: '2026-01-05T10:30:00.000Z', parentTask: id(132), attachments: [], prerequisites: [] },
            { id: id(134), text: '', order: 3, indentationLevel: 0, isDayBreak: true, isCompleted: false, workflowState: 'not_started', lastActiveState: 'not_started', childTasksComplete: true, updatedAt: '2026-01-03T08:00:00.000Z', attachments: [], prerequisites: [] },
        ],
        taskAttachments: [{ id: id(140), name: 'chapter.pdf', type: 'application/pdf', url: 'tasks/chapter.pdf', kind: 'pdf', sizeBytes: 20480, ...file, createdAt: '2026-01-03T08:00:00.000Z', updatedAt: '2026-01-03T08:00:00.000Z' }],
        taskResponseFields: [{ id: id(150), type: 'rich_text', label: 'Your answers', description: null, weight: 1, required: true, order: 0, createdAt: at('2026-01-03T08:00:00.000Z'), updatedAt: at('2026-01-03T08:00:00.000Z'), task: id(132) }],
        taskUpdates: [
            { id: id(160), fromState: 'in_progress', toState: 'needs_review', note: 'Done!', isDraft: false, scheduledForDate: '2026-01-05', restoreTiming: null, createdAt: at('2026-01-05T11:00:00.000Z'), updatedAt: at('2026-01-05T11:00:00.000Z'), task: id(132), attachments: [id(170)] },
            { id: id(161), fromState: 'needs_review', toState: 'needs_review', note: 'Look again at number 3.', isDraft: false, scheduledForDate: '2026-01-05', restoreTiming: null, gradeNumericValue: 80, gradeDisplayValue: '80', gradeIsProvisional: true, createdAt: at('2026-01-05T12:00:00.000Z'), updatedAt: at('2026-01-05T12:00:00.000Z'), task: id(132), replyTo: id(160), gradeType: id(120), attachments: [] },
        ],
        taskUpdateAttachments: [{ id: id(170), name: 'page.jpg', type: 'image/jpeg', url: 'updates/page.jpg', kind: 'image', sizeBytes: 90210, ...file, width: 800, height: 600, blurhash: 'L5H2EC=PM+yV', createdAt: '2026-01-05T11:00:00.000Z', updatedAt: '2026-01-05T11:00:00.000Z' }],
        taskResponseFieldValues: [{ id: id(180), richTextContent: '<p>1, 3, 5</p>', fileUrl: null, fileName: null, fileType: null, fileSizeBytes: null, thumbnailUrl: null, createdAt: at('2026-01-05T11:00:00.000Z'), updatedAt: at('2026-01-05T11:00:00.000Z'), update: id(160), field: id(150) }],
    };
}

const scratch = mkdtempSync(path.join(tmpdir(), 'slice-import-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let exportCount = 0;
function writeExport(rows: Rows): string {
    const dir = path.join(scratch, `export-${(exportCount += 1)}`);
    mkdirSync(path.join(dir, 'entities'), { recursive: true });
    for (const [entity, list] of Object.entries(rows)) {
        writeFileSync(path.join(dir, 'entities', `${entity}.jsonl`), list.map((entity) => JSON.stringify({ entity })).join('\n'));
    }
    return dir;
}

async function importInto(db: PGlite, rows: Rows, options?: { replace?: boolean }) {
    const rowsOf = readExport(writeExport(rows));
    const built = buildRows(rowsOf);
    await loadTables(db, built.tables, options);
    return { rowsOf, built, report: describeImport(built, 'export') };
}

const failed = (result: { checks: Array<{ name: string; wrong: string[] }> }) => result.checks.filter((check) => check.wrong.length).map((check) => check.name);
const one = async (db: PGlite, sql: string, params: unknown[] = []) => (await db.query<Record<string, any>>(sql, params)).rows[0];

let db: PGlite;
beforeEach(async () => {
    db = new PGlite();
    await applyMigrations(db);
});

describe('the migrations', () => {
    it('apply once, and are recorded so a second start applies nothing', async () => {
        const fresh = new PGlite();
        const versions = listMigrations().map((migration) => migration.version);
        expect(versions.slice(0, 2)).toEqual(['0001_family_and_chores', '0002_powersync_publication']);
        expect(await applyMigrations(fresh)).toEqual(versions);
        expect(await applyMigrations(fresh)).toEqual([]);
        expect((await fresh.query('SELECT version FROM schema_migrations ORDER BY version')).rows).toEqual(versions.map((version) => ({ version })));
    });
});

describe('importing an export', () => {
    it('loads a family and passes a verification that shares no code with the mapping', async () => {
        const { rowsOf, report } = await importInto(db, family());

        expect(report.rows).toEqual({
            settings: 2, unit_definitions: 1, family_members: 3, chores: 4, chore_assignees: 7, chore_completions: 4,
            routines: 1, routine_steps: 2, routine_marker_statuses: 1, countdown_runs: 1, history_events: 3, history_event_members: 2,
            grade_types: 2, task_series: 1, tasks: 4, task_attachments: 1, task_response_fields: 1, task_updates: 2, task_update_attachments: 1,
            task_response_field_values: 1,
            allowance_envelopes: 3, envelope_balances: 3, allowance_transactions: 6, exchange_rates: 1,
            announcements: 2, content_categories: 1, content_queue_items: 1, family_rules: 1, family_rule_versions: 2, content_attachments: 1,
            family_dashboard_layouts: 1, family_dashboard_widgets: 1, dashboard_configs: 1, history_event_attachments: 1,
            message_threads: 2, messages: 3, message_thread_members: 5, message_attachments: 1, message_reactions: 1, message_acknowledgements: 2,
        });
        expect(report.heldBack).toEqual({});
        expect(report.storedButNotMapped).toEqual({});
        const result = await verifyImport(db, rowsOf, choreTiming);
        expect(failed(result)).toEqual([]);
        expect(result.checks.every((check) => check.compared > 0)).toBe(true);
    });

    it('keeps a setting stored as a bare word, and one stored as JSON, both as JSON', async () => {
        await importInto(db, family());

        expect((await one(db, `SELECT value FROM settings WHERE name = 'dashboardTheme'`)).value).toBe('dark');
        expect((await one(db, `SELECT value FROM settings WHERE name = 'enabledCurrencies'`)).value).toEqual(['USD', 'STARS']);
    });

    it('stores a day as a day, an empty string as nothing, and whether a PIN is set without being asked', async () => {
        await importInto(db, family());

        const ada = await one(db, `SELECT email, has_pin, photo_urls FROM family_members WHERE id = $1`, [ADA]);
        expect(ada).toEqual({ email: null, has_pin: true, photo_urls: { '64': 'a64.png', '320': 'a320.png', '1200': 'a1200.png' } });
        const ben = await one(db, `SELECT has_pin, allowance_start_date::text AS start, allowance_payout_delay_days AS delay, message_quiet_hours_start::text AS quiet FROM family_members WHERE id = $1`, [BEN]);
        expect(ben).toEqual({ has_pin: false, start: '2026-01-05', delay: 2, quiet: '21:30:00' });
        const dishes = await one(db, `SELECT start_date::text AS start, exdates::text[] AS exdates, description FROM chores WHERE id = $1`, [DISHES]);
        expect(dishes).toEqual({ start: '2026-01-01', exdates: ['2026-01-02', '2026-01-03'], description: null });
    });

    it('keeps has_pin true to the hash whoever writes the row, since it is what devices are sent in the hash\'s place', async () => {
        await importInto(db, family());
        const hasPin = async (memberId: string) => (await one(db, `SELECT has_pin FROM family_members WHERE id = $1`, [memberId])).has_pin;

        await db.query(`UPDATE family_members SET pin_hash = 'scrypt$new' WHERE id = $1`, [BEN]);
        expect(await hasPin(BEN)).toBe(true);
        await db.query(`UPDATE family_members SET pin_hash = NULL WHERE id = $1`, [BEN]);
        expect(await hasPin(BEN)).toBe(false);
        // Saying so directly changes nothing: the hash decides.
        await db.query(`UPDATE family_members SET has_pin = true WHERE id = $1`, [BEN]);
        expect(await hasPin(BEN)).toBe(false);
    });

    it('resolves each generation of timing into one mode and the columns that mode uses', async () => {
        const { report } = await importInto(db, family());
        const timing = async (choreId: string) =>
            one(db, `SELECT timing_mode AS mode, timing_window_key AS win, timing_marker_key AS marker, timing_chore_id AS chore, timing_event AS event, timing_fallback_time::text AS fallback FROM chores WHERE id = $1`, [choreId]);

        expect(await timing(DISHES)).toEqual({ mode: 'named_window', win: 'evening', marker: null, chore: null, event: null, fallback: null });
        expect(await timing(TRASH)).toEqual({ mode: 'named_window', win: 'morning', marker: null, chore: null, event: null, fallback: null });
        expect(await timing(PIANO)).toEqual({ mode: 'after_marker', win: null, marker: 'dinner', chore: null, event: 'completed', fallback: '18:30:00' });
        expect(await timing(LAUNDRY)).toEqual({ mode: 'after_chore', win: null, marker: null, chore: DISHES, event: 'completed', fallback: '19:00:00' });
        expect(report.conversions).toMatchObject({
            'chores timing: "routine_anchor" stored as after_marker': 1,
            'chores timing: a bare time bucket stored as named_window': 1,
        });
    });

    it('makes one table of who is assigned, in the rotation\'s order where there is one and the family\'s where there is not', async () => {
        await importInto(db, family());
        const order = async (choreId: string) => (await db.query<{ member: string }>(`SELECT family_member_id AS member FROM chore_assignees WHERE chore_id = $1 ORDER BY position`, [choreId])).rows.map((row) => row.member);

        expect(await order(TRASH)).toEqual([CAL, ADA, BEN]);
        expect(await order(DISHES)).toEqual([ADA, BEN]);
    });

    it('reads a link from either side, since which side an export holds it on is the old schema\'s business', async () => {
        const rows = family();
        for (const member of rows.familyMembers) delete member.assignedChores;
        rows.chores.find((chore) => chore.id === DISHES)!.assignees = [ADA, BEN];
        rows.chores.find((chore) => chore.id === TRASH)!.assignees = [ADA, BEN, CAL];
        rows.chores.find((chore) => chore.id === PIANO)!.assignees = [BEN];
        rows.chores.find((chore) => chore.id === LAUNDRY)!.assignees = [BEN];

        const { rowsOf, report } = await importInto(db, rows);

        expect(report.rows.chore_assignees).toBe(7);
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);
    });

    it('keeps who did a thing in one column and whom it affected in a table, and history that names a deleted thing', async () => {
        await importInto(db, family());

        expect(await one(db, `SELECT actor_id, chore_id, scheduled_for::text AS day, source, metadata FROM history_events WHERE id = $1`, [id(60)])).toEqual({
            actor_id: ADA, chore_id: DISHES, day: '2026-01-04', source: 'manual', metadata: { choreTitle: 'Dishes', completed: true, dateDue: '2026-01-04' },
        });
        // Nobody did the calendar sync, and the calendar item it names is in no table yet: both are kept as they are.
        expect(await one(db, `SELECT actor_id, calendar_item_id FROM history_events WHERE id = $1`, [id(61)])).toEqual({ actor_id: null, calendar_item_id: id(70) });
        const affected = (await db.query<{ member: string }>(`SELECT family_member_id AS member FROM history_event_members WHERE history_event_id = $1`, [id(62)])).rows;
        expect(affected).toEqual([{ member: BEN }]);
        // A chore can go; what happened to it stays.
        await db.query(`DELETE FROM chores WHERE id = $1`, [PIANO]);
        expect((await one(db, `SELECT chore_id FROM history_events WHERE id = $1`, [id(62)])).chore_id).toBe(PIANO);
    });

    it('keeps a routine\'s chores in order, a marker by its day, and a countdown run by its person and day', async () => {
        await importInto(db, family());

        const steps = (await db.query<{ chore: string }>(`SELECT chore_id AS chore FROM routine_steps WHERE routine_id = $1 ORDER BY position`, [id(80)])).rows;
        expect(steps.map((row) => row.chore)).toEqual([DISHES, PIANO]);
        expect(await one(db, `SELECT day::text AS day, marker_key, started_by, completed_at FROM routine_marker_statuses`)).toEqual({ day: '2026-01-04', marker_key: 'dinner', started_by: ADA, completed_at: null });
        expect(await one(db, `SELECT family_member_id, day::text AS day, routine_id, status, skipped_chore_ids::text[] AS skipped, step_extension_secs, stopped_reason FROM countdown_runs`)).toEqual({
            family_member_id: BEN, day: '2026-01-05', routine_id: id(80), status: 'stopped', skipped: [PIANO], step_extension_secs: 30, stopped_reason: 'finished',
        });
        // A second run for the same person and day cannot be stored.
        await expect(db.query(`INSERT INTO countdown_runs (id, family_member_id, day, status, started_at) VALUES ($1, $2, '2026-01-05', 'running', now())`, [id(91), BEN])).rejects.toThrow();
    });

    it('carries a task series with its tasks in order, each under its parent, on the chore and for the person it was', async () => {
        await importInto(db, family());

        // The day the family meant, not the day before that its midnight falls on in UTC.
        expect(await one(db, `SELECT family_member_id, chore_id, start_date::text AS starts, planned_end_date::text AS planned, work_ahead_allowed, pull_forward_count FROM task_series`)).toEqual({
            family_member_id: BEN, chore_id: PIANO, starts: '2026-01-05', planned: '2026-02-01', work_ahead_allowed: true, pull_forward_count: 0,
        });
        const tasks = (await db.query(`SELECT id, parent_task_id AS parent, title, workflow_state AS state, last_active_state AS back_to, is_day_break AS break, specific_time::text AS at FROM tasks ORDER BY sort_order`)).rows;
        expect(tasks).toEqual([
            { id: id(131), parent: null, title: 'Read chapter 1', state: 'done', back_to: 'in_progress', break: false, at: null },
            { id: id(132), parent: null, title: 'Exercises', state: 'needs_review', back_to: 'in_progress', break: false, at: '16:30:00' },
            // It only ever said it was ticked.
            { id: id(133), parent: id(132), title: 'Odd numbers only', state: 'done', back_to: 'not_started', break: false, at: null },
            { id: id(134), parent: null, title: '', state: 'not_started', back_to: 'not_started', break: true, at: null },
        ]);
        // A series that goes takes its tasks, and everything said about them, with it.
        await db.query(`DELETE FROM task_series WHERE id = $1`, [id(130)]);
        expect(await one(db, `SELECT (SELECT count(*) FROM tasks)::int AS tasks, (SELECT count(*) FROM task_updates)::int AS updates, (SELECT count(*) FROM task_response_field_values)::int AS answers, (SELECT count(*) FROM task_attachments)::int AS files`)).toEqual({ tasks: 0, updates: 0, answers: 0, files: 0 });
    });

    it('carries what was said about a task: who said it, what it answered, the grade, the files and the answers', async () => {
        await importInto(db, family());

        expect(await one(db, `SELECT task_id, actor_id, affected_person_id, reply_to_id, from_state, to_state, scheduled_for::text AS day, grade_type_id FROM task_updates WHERE id = $1`, [id(160)])).toEqual({
            task_id: id(132), actor_id: BEN, affected_person_id: BEN, reply_to_id: null, from_state: 'in_progress', to_state: 'needs_review', day: '2026-01-05', grade_type_id: null,
        });
        expect(await one(db, `SELECT actor_id, affected_person_id, reply_to_id, grade_type_id, grade_numeric_value AS grade, grade_is_provisional AS provisional FROM task_updates WHERE id = $1`, [id(161)])).toEqual({
            actor_id: ADA, affected_person_id: BEN, reply_to_id: id(160), grade_type_id: id(120), grade: 80, provisional: true,
        });
        expect(await one(db, `SELECT update_id, field_id, rich_text_content AS answer FROM task_response_field_values`)).toEqual({ update_id: id(160), field_id: id(150), answer: '<p>1, 3, 5</p>' });
        expect(await one(db, `SELECT update_id, url, width, blurhash FROM task_update_attachments`)).toEqual({ update_id: id(160), url: 'updates/page.jpg', width: 800, blurhash: 'L5H2EC=PM+yV' });
        expect(await one(db, `SELECT task_id, url, size_bytes::int AS size FROM task_attachments`)).toEqual({ task_id: id(131), url: 'tasks/chapter.pdf', size: 20480 });
        // Someone who leaves the family leaves what they said, with nobody's name on it.
        await db.exec(`DELETE FROM chore_completions`);
        await db.query(`DELETE FROM family_members WHERE id = $1`, [BEN]);
        expect(await one(db, `SELECT actor_id, affected_person_id FROM task_updates WHERE id = $1`, [id(160)])).toEqual({ actor_id: null, affected_person_id: null });
        expect((await one(db, `SELECT family_member_id FROM task_series`)).family_member_id).toBeNull();
    });

    it('holds one default grade scale, and clears a second', async () => {
        const rows = family();
        rows.gradeTypes[1].isDefault = true;
        const { report } = await importInto(db, rows);

        expect(report.conversions['gradeTypes.isDefault: a second default, cleared']).toBe(1);
        expect((await db.query(`SELECT id FROM grade_types WHERE is_default`)).rows).toEqual([{ id: id(120) }]);
        await expect(db.query(`UPDATE grade_types SET is_default = true WHERE id = $1`, [id(121)])).rejects.toThrow();
    });

    it('holds back what belonged to a task that is gone, and says so', async () => {
        const rows = family();
        // What a deleted task left behind: an update, the answer that came with it, a field, and a file.
        rows.tasks.push({ id: id(135), text: 'Left over', order: 9, isDayBreak: false, updatedAt: '2026-01-02T08:00:00.000Z' });
        rows.taskUpdates.push({ id: id(162), fromState: 'not_started', toState: 'in_progress', isDraft: false, scheduledForDate: '2026-01-02', createdAt: at('2026-01-02T08:00:00.000Z'), updatedAt: at('2026-01-02T08:00:00.000Z') });
        rows.taskResponseFields.push({ id: id(151), type: 'photo', label: 'A photo', weight: 0, required: false, order: 0, createdAt: at('2026-01-02T08:00:00.000Z'), updatedAt: at('2026-01-02T08:00:00.000Z') });
        rows.taskResponseFieldValues.push({ id: id(181), richTextContent: 'x', createdAt: at('2026-01-02T08:00:00.000Z'), updatedAt: at('2026-01-02T08:00:00.000Z'), update: id(162), field: id(151) });
        rows.taskAttachments.push({ id: id(141), name: 'old.pdf', type: 'application/pdf', url: 'tasks/old.pdf', createdAt: '2026-01-02T08:00:00.000Z', updatedAt: '2026-01-02T08:00:00.000Z' });
        // And an earlier answer to a field that was answered again with the same update.
        rows.taskResponseFieldValues.push({ id: id(182), richTextContent: '<p>1, 3</p>', createdAt: at('2026-01-05T10:50:00.000Z'), updatedAt: at('2026-01-05T10:50:00.000Z'), update: id(160), field: id(150) });
        const { rowsOf, report } = await importInto(db, rows);

        expect(report.heldBack).toEqual({
            tasks: { 'It belongs to no series.': 1 },
            taskUpdates: { 'Its task no longer exists.': 1 },
            taskResponseFields: { 'Its task no longer exists.': 1 },
            taskAttachments: { 'Its task no longer exists.': 1 },
            taskResponseFieldValues: { 'Its update no longer exists.': 1, 'A later answer to the same field came with the same update.': 1 },
        });
        expect((await one(db, `SELECT rich_text_content AS answer FROM task_response_field_values`)).answer).toBe('<p>1, 3, 5</p>');
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);
    });

    it('carries money as it is: each envelope, what it holds in each currency, and every ledger row', async () => {
        await importInto(db, family());

        expect((await db.query(`SELECT envelope_id, currency, amount FROM envelope_balances ORDER BY envelope_id, currency`)).rows).toEqual([
            { envelope_id: id(200), currency: 'STARS', amount: 3 }, { envelope_id: id(200), currency: 'USD', amount: 12.5 },
            // A part of a cent stays a part of a cent.
            { envelope_id: id(202), currency: 'USD', amount: 2.005 },
        ]);
        expect(await one(db, `SELECT family_member_id, name, goal_amount, goal_currency, archived_at FROM allowance_envelopes WHERE id = $1`, [id(200)])).toEqual({ family_member_id: BEN, name: 'Savings', goal_amount: 50, goal_currency: 'USD', archived_at: null });
        expect(await one(db, `SELECT envelope_id, source_envelope_id, destination_envelope_id, transaction_type, amount, currency, created_by FROM allowance_transactions WHERE id = $1`, [id(212)])).toEqual({
            envelope_id: id(200), source_envelope_id: id(200), destination_envelope_id: id(202), transaction_type: 'transfer-out-person', amount: -2.5, currency: 'USD', created_by: BEN,
        });
        expect((await one(db, `SELECT amount FROM allowance_transactions WHERE id = $1`, [id(214)])).amount).toBe(-0.495);
        expect(await one(db, `SELECT created_by, distribution_key FROM allowance_transactions WHERE id = $1`, [id(215)])).toEqual({ created_by: null, distribution_key: `${BEN}:2026-01-01:2026-01-07:STARS` });
        expect(await one(db, `SELECT rate, fetched_at FROM exchange_rates WHERE base_currency = 'USD' AND target_currency = 'NPR'`)).toMatchObject({ rate: 133.5 });
    });

    it('keeps which envelope is a member\'s default on the member, one each, and only ever one of their own', async () => {
        const rows = family();
        // Ben's second envelope is marked default as well, which a flag on every envelope allowed.
        rows.allowanceEnvelopes[1].isDefault = true;
        const { rowsOf, report } = await importInto(db, rows);

        expect(report.conversions['allowanceEnvelopes.isDefault: a member\'s second default, cleared']).toBe(1);
        expect((await db.query(`SELECT id, default_envelope_id AS chosen FROM family_members ORDER BY sort_order`)).rows).toEqual([{ id: ADA, chosen: null }, { id: BEN, chosen: id(200) }, { id: CAL, chosen: id(202) }]);
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);
        // Ben may choose his other envelope, and never Cal's.
        await db.query(`UPDATE family_members SET default_envelope_id = $1 WHERE id = $2`, [id(201), BEN]);
        await expect(db.query(`UPDATE family_members SET default_envelope_id = $1 WHERE id = $2`, [id(202), BEN])).rejects.toThrow();
    });

    it('keeps the ledger whatever else goes: an envelope cannot be deleted, and one whose member has left stays', async () => {
        const rows = family();
        // An envelope left by someone no longer in the family, with the row that opened it.
        rows.allowanceEnvelopes.push({ id: id(203), name: 'Savings', isDefault: true, balances: {}, archivedAt: null });
        rows.allowanceTransactions.push({ id: id(216), transactionType: 'init', amount: 0, currency: 'USD', description: 'Initial balance', createdAt: '2025-06-01T09:00:00.000Z', updatedAt: '2025-06-01T09:00:00.000Z', createdBy: null, createdByFamilyMemberId: id(9), envelope: id(203) });
        const { rowsOf, report } = await importInto(db, rows);

        expect(report.heldBack).toEqual({});
        expect(report.conversions['allowanceEnvelopes: its member is gone, kept as nobody\'s']).toBe(1);
        expect(await one(db, `SELECT e.family_member_id, t.created_by FROM allowance_envelopes e JOIN allowance_transactions t ON t.envelope_id = e.id WHERE e.id = $1`, [id(203)])).toEqual({ family_member_id: null, created_by: null });
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);

        await expect(db.query(`DELETE FROM allowance_envelopes WHERE id = $1`, [id(200)])).rejects.toThrow();
        await expect(db.query(`INSERT INTO allowance_transactions (id, envelope_id, transaction_type, amount, currency, distribution_key) VALUES ($1, $2, 'allowance-distribution', 3, 'STARS', $3)`, [id(217), id(200), `${BEN}:2026-01-01:2026-01-07:STARS`])).rejects.toThrow();
        // When Cal leaves, Cal's envelope and its ledger stay, and Ben's transfer still says where it went.
        await db.exec(`DELETE FROM chore_completions; DELETE FROM family_members WHERE id = '${CAL}'`);
        expect(await one(db, `SELECT family_member_id FROM allowance_envelopes WHERE id = $1`, [id(202)])).toEqual({ family_member_id: null });
        expect((await one(db, `SELECT destination_envelope_id FROM allowance_transactions WHERE id = $1`, [id(212)])).destination_envelope_id).toBe(id(202));
    });

    it('carries what the family posts: announcements showing or taken down, the queue, and a rule with every version it has had', async () => {
        await importInto(db, family());

        expect((await db.query(`SELECT id, created_by, archived_at IS NULL AS showing, link_url FROM announcements ORDER BY id`)).rows).toEqual([
            { id: id(300), created_by: ADA, showing: true, link_url: null }, { id: id(301), created_by: null, showing: false, link_url: 'https://example.org/bins' },
        ]);
        expect(await one(db, `SELECT c.slug, c.default_duration_ms::int AS week, i.status, i.duration_ms, i.archived_at, i.created_by FROM content_queue_items i JOIN content_categories c ON c.id = i.category_id`)).toEqual({
            slug: 'verse', week: 604_800_000, status: 'live', duration_ms: null, archived_at: null, created_by: ADA,
        });
        expect(await one(db, `SELECT announcement_id, queue_item_id, rule_version_id, url FROM content_attachments`)).toEqual({ announcement_id: null, queue_item_id: id(311), rule_version_id: null, url: 'content/psalm.png' });
        expect((await db.query(`SELECT v.version_number AS n, v.previous_version_id AS after, v.id = r.active_version_id AS current FROM family_rule_versions v JOIN family_rules r ON r.id = v.rule_id ORDER BY n`)).rows).toEqual([
            { n: 1, after: null, current: false }, { n: 2, after: id(321), current: true },
        ]);

        // A file is on one thing and one only, and a rule reads as a version of its own.
        await expect(db.query(`UPDATE content_attachments SET announcement_id = $1`, [id(300)])).rejects.toThrow();
        await db.exec(`INSERT INTO family_rules (id, title, active_version_id) VALUES ('${id(323)}', 'Bedtime', '${id(324)}'); INSERT INTO family_rule_versions (id, rule_id, version_number, rich_text_content) VALUES ('${id(324)}', '${id(323)}', 1, '<p>Eight.</p>')`);
        await expect(db.query(`UPDATE family_rules SET active_version_id = $1 WHERE id = $2`, [id(322), id(323)])).rejects.toThrow();
        await expect(db.query(`INSERT INTO family_rule_versions (id, rule_id, version_number, rich_text_content) VALUES ($1, $2, 2, 'again')`, [id(325), id(320)])).rejects.toThrow();
        // A category that goes takes its items and their files with it.
        await db.query(`DELETE FROM content_categories`);
        expect(await one(db, `SELECT (SELECT count(*) FROM content_queue_items)::int AS items, (SELECT count(*) FROM content_attachments)::int AS files`)).toEqual({ items: 0, files: 0 });
    });

    it('carries the dashboards: a layout with its widgets where they sat, each person\'s own arrangement, and a history entry\'s files', async () => {
        await importInto(db, family());

        expect(await one(db, `SELECT l.breakpoint_key, w.widget_type, w.x, w.y, w.w, w.h, w.z, w.config FROM family_dashboard_widgets w JOIN family_dashboard_layouts l ON l.id = w.layout_id`)).toEqual({
            breakpoint_key: 'phone-portrait', widget_type: 'clock', x: 0, y: 0.5, w: 2, h: 1.25, z: 3, config: { format: '24h' },
        });
        expect(await one(db, `SELECT family_member_id, widget_order, disabled_widgets, widget_settings FROM dashboard_configs`)).toEqual({
            family_member_id: BEN, widget_order: ['chores', 'balance'], disabled_widgets: ['weather'], widget_settings: { chores: { compact: true } },
        });
        expect(await one(db, `SELECT history_event_id, url, width FROM history_event_attachments`)).toEqual({ history_event_id: id(60), url: 'history/proof.jpg', width: 320 });
    });

    it('settles what a flag and a pointer left open: an announcement taken down at no time, a rule pointing at nothing, a file on nothing', async () => {
        const rows = family();
        Object.assign(rows.announcements[1], { archivedAt: null });
        Object.assign(rows.familyRules[0], { activeVersionId: id(399) });
        rows.contentAttachments.push({ id: id(331), name: 'lost.png', type: 'image/png', url: 'content/lost.png', createdAt: '2026-01-02T08:00:00.000Z', updatedAt: '2026-01-02T08:00:00.000Z' });
        rows.familyRuleVersions.push({ id: id(326), versionNumber: 1, richTextContent: '<p>Of a rule that is gone.</p>', createdAt: '2025-06-01T08:00:00.000Z' });
        const { rowsOf, report } = await importInto(db, rows);

        expect(report.conversions).toMatchObject({
            'announcements: taken down at no recorded time, taken as when it last changed': 1,
            'familyRules.activeVersionId: not a version of the rule, its newest taken': 1,
        });
        expect(report.heldBack).toEqual({ contentAttachments: { 'What it was attached to no longer exists.': 1 }, familyRuleVersions: { 'It is a version of no rule.': 1 } });
        expect((await one(db, `SELECT archived_at FROM announcements WHERE id = $1`, [id(301)])).archived_at).not.toBeNull();
        expect((await one(db, `SELECT active_version_id FROM family_rules`)).active_version_id).toBe(id(322));
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);
    });

    it('carries messages: each thread with the people in it and how each keeps it, and what was said, answered, removed and done with it', async () => {
        await importInto(db, family());
        const [FAMILY, ABOUT_PIANO] = [id(400), id(401)];

        expect(await one(db, `SELECT thread_type, visibility, thread_key, linked_domain, linked_entity_id, latest_message_at FROM message_threads WHERE id = $1`, [ABOUT_PIANO])).toEqual({
            thread_type: 'linked', visibility: 'members', thread_key: `linked:chores:${PIANO}`, linked_domain: 'chores', linked_entity_id: PIANO, latest_message_at: null,
        });
        expect((await db.query(`SELECT family_member_id AS who, member_role AS role, notification_level AS notify, is_archived AS archived, pinned_at IS NOT NULL AS pinned, last_read_message_id AS read FROM message_thread_members WHERE thread_id = $1 ORDER BY family_member_id`, [FAMILY])).rows).toEqual([
            { who: ADA, role: 'owner', notify: 'all', archived: false, pinned: true, read: id(422) },
            { who: BEN, role: 'member', notify: 'all', archived: false, pinned: false, read: id(421) },
            { who: CAL, role: 'member', notify: 'mute', archived: true, pinned: false, read: null },
        ]);
        expect((await db.query(`SELECT author_id AS by, body, importance, is_system AS system, reply_to_id AS answers, deleted_at IS NOT NULL AS removed, removed_by FROM messages ORDER BY created_at`)).rows).toEqual([
            { by: ADA, body: 'Dinner at six', importance: 'needs_ack', system: false, answers: null, removed: false, removed_by: null },
            { by: BEN, body: 'On my way', importance: 'normal', system: false, answers: id(420), removed: false, removed_by: null },
            { by: CAL, body: '', importance: 'normal', system: false, answers: null, removed: true, removed_by: ADA },
        ]);
        expect((await db.query(`SELECT message_id, family_member_id, emoji FROM message_reactions`)).rows).toEqual([{ message_id: id(420), family_member_id: BEN, emoji: '👍' }]);
        // What an acknowledgement was is its own column, for a row that said so and for one that said it only in its key.
        expect((await db.query(`SELECT family_member_id AS who, kind FROM message_acknowledgements ORDER BY created_at`)).rows).toEqual([{ who: BEN, kind: 'acknowledged' }, { who: CAL, kind: 'seen' }]);
        expect(await one(db, `SELECT message_id, url FROM message_attachments`)).toEqual({ message_id: id(420), url: 'messages/menu.jpg' });

        // One thread of each kind, a person in a thread once, a reaction once, and a place in a thread only at one of its own messages.
        await expect(db.query(`INSERT INTO message_threads (id, thread_type, visibility, thread_key, title) VALUES ($1, 'family', 'family', 'family', 'Family again')`, [id(402)])).rejects.toThrow();
        await expect(db.query(`INSERT INTO message_thread_members (thread_id, family_member_id) VALUES ($1, $2)`, [FAMILY, BEN])).rejects.toThrow();
        await expect(db.query(`INSERT INTO message_reactions (message_id, family_member_id, emoji) VALUES ($1, $2, '👍')`, [id(420), BEN])).rejects.toThrow();
        await expect(db.query(`UPDATE message_thread_members SET last_read_message_id = $1 WHERE thread_id = $2 AND family_member_id = $3`, [id(421), ABOUT_PIANO, ADA])).rejects.toThrow();
    });

    it('keeps what was said when the person who said it leaves, and loses a place in a thread only with the message it was at', async () => {
        await importInto(db, family());

        await db.query(`DELETE FROM messages WHERE id = $1`, [id(421)]);
        expect((await one(db, `SELECT last_read_message_id AS read, last_read_at IS NOT NULL AS had_read FROM message_thread_members WHERE thread_id = $1 AND family_member_id = $2`, [id(400), BEN]))).toEqual({ read: null, had_read: true });
        await db.exec(`DELETE FROM chore_completions; DELETE FROM family_members WHERE id = '${CAL}'`);
        expect(await one(db, `SELECT author_id, removed_by FROM messages WHERE id = $1`, [id(422)])).toEqual({ author_id: null, removed_by: ADA });
        expect(await one(db, `SELECT (SELECT count(*) FROM message_thread_members WHERE family_member_id = '${CAL}')::int AS seats, (SELECT count(*) FROM message_acknowledgements)::int AS acks`)).toEqual({ seats: 0, acks: 1 });
        // A thread that goes takes everything in it.
        await db.query(`DELETE FROM message_threads WHERE id = $1`, [id(400)]);
        expect(await one(db, `SELECT (SELECT count(*) FROM messages)::int AS messages, (SELECT count(*) FROM message_attachments)::int AS files, (SELECT count(*) FROM message_reactions)::int AS reactions`)).toEqual({ messages: 0, files: 0, reactions: 0 });
    });

    it('settles what messages left loose: a place in the wrong thread, a pin with no time, and what belongs to nobody or nothing', async () => {
        const rows = family();
        // Ada's place in the piano thread names a message of the family thread, and Ben pinned his without a time.
        Object.assign(rows.messageThreadMembers[3], { lastReadMessageId: id(420), lastReadAt: '2026-01-05T12:00:00.000Z' });
        Object.assign(rows.messageThreadMembers[4], { isPinned: true });
        rows.messageThreadMembers.push({ ...rows.messageThreadMembers[4], id: id(415), familyMemberId: id(9), membershipKey: 'gone' });
        rows.messages.push({ ...rows.messages[1], id: id(423), threadId: id(499), replyToMessageId: null, replyTo: undefined });
        rows.messageReactions.push({ ...rows.messageReactions[0], id: id(441) });
        rows.messageAcknowledgements.push({ id: id(452), messageId: id(420), familyMemberId: ADA, ackKey: 'ack:something-else', createdAt: '2026-01-05T12:04:00.000Z' });
        const { rowsOf, report } = await importInto(db, rows);

        expect(report.conversions).toMatchObject({
            'messageThreadMembers.lastReadMessageId: a message of another thread, left empty': 1,
            'messageThreadMembers: pinned at no recorded time, taken as when they joined': 1,
        });
        expect(report.heldBack).toEqual({
            messageThreadMembers: { 'It is for nobody in the family.': 1 },
            messages: { 'It is in no thread.': 1 },
            messageReactions: { 'The same person already gave the message the same emoji.': 1 },
            messageAcknowledgements: { 'It does not say whether the message was seen or acknowledged.': 1 },
        });
        expect(await one(db, `SELECT last_read_message_id AS read, last_read_at IS NOT NULL AS had_read FROM message_thread_members WHERE thread_id = $1 AND family_member_id = $2`, [id(401), ADA])).toEqual({ read: null, had_read: true });
        expect((await one(db, `SELECT pinned_at = joined_at AS pinned_when_joined FROM message_thread_members WHERE thread_id = $1 AND family_member_id = $2`, [id(401), BEN])).pinned_when_joined).toBe(true);
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);
    });

    it('holds a completion done, marked not done, or cleared, and never two of those at once', async () => {
        await importInto(db, family());
        const state = async (completionId: string) => one(db, `SELECT completed_at IS NOT NULL AS done, not_done, allowance_awarded AS awarded, marked_by FROM chore_completions WHERE id = $1`, [completionId]);

        expect(await state(id(40))).toEqual({ done: true, not_done: false, awarded: false, marked_by: ADA });
        expect(await state(id(41))).toEqual({ done: false, not_done: true, awarded: false, marked_by: ADA });
        expect(await state(id(42))).toEqual({ done: true, not_done: false, awarded: true, marked_by: null });
        expect(await state(id(43))).toEqual({ done: false, not_done: false, awarded: false, marked_by: null });
        await expect(db.query(`UPDATE chore_completions SET not_done = true WHERE id = $1`, [id(40)])).rejects.toThrow();
    });
});

describe('what the new schema cannot hold', () => {
    it('is held back with its reason and counted, never dropped', async () => {
        const rows = family();
        // A completion whose chore was deleted, one nobody is recorded against, and a second for a slot already taken.
        rows.choreCompletions.push({ id: id(50), completed: true, dateDue: '2026-01-06', dateCompleted: '2026-01-06T10:00:00.000Z', allowanceAwarded: false });
        rows.familyMembers[1].completedChores = [id(41), id(42), id(50)];
        rows.choreCompletions.push({ id: id(51), completed: true, dateDue: '2026-01-06', dateCompleted: '2026-01-06T11:00:00.000Z', allowanceAwarded: false });
        rows.chores[0].completions = [id(40), id(41), id(51), id(52)];
        rows.choreCompletions.push({ id: id(52), completed: true, dateDue: '2026-01-04', dateCompleted: '2026-01-04T20:00:00.000Z', allowanceAwarded: false });
        rows.familyMembers[0].completedChores = [id(40), id(52)];
        rows.settings.push({ id: id(102), name: 'dashboardTheme', value: 'light' });

        const { rowsOf, built, report } = await importInto(db, rows);

        expect(report.heldBack).toEqual({
            settings: { 'Another row already holds this setting.': 1 },
            choreCompletions: {
                'It belongs to no chore.': 1,
                'Nobody is recorded as having completed it.': 1,
                'Another completion already covers this chore, person and day.': 1,
            },
        });
        expect(built.heldBack.choreCompletions.map((held: { row: { id: string } }) => held.row.id).sort()).toEqual([id(40), id(50), id(51)]);
        // Of the two for Ada, the dishes and the fourth, the later one is the one kept.
        expect((await one(db, `SELECT id FROM chore_completions WHERE chore_id = $1 AND completed_by = $2`, [DISHES, ADA])).id).toBe(id(52));
        expect((await one(db, `SELECT value FROM settings WHERE name = 'dashboardTheme'`)).value).toBe('dark');
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);
    });

    it('leaves a timing anchor empty when the chore it pointed at is gone, and says so', async () => {
        const rows = family();
        rows.chores = rows.chores.filter((chore) => chore.id !== DISHES);
        rows.choreCompletions = rows.choreCompletions.filter((completion) => ![id(40), id(41)].includes(completion.id as string));

        const { report } = await importInto(db, rows);

        expect(await one(db, `SELECT timing_mode AS mode, timing_chore_id AS chore, timing_fallback_time::text AS fallback FROM chores WHERE id = $1`, [LAUNDRY])).toEqual({ mode: 'after_chore', chore: null, fallback: '19:00:00' });
        expect(report.conversions).toMatchObject({ 'chores timing: anchored to a chore that no longer exists, anchor left empty': 1 });
    });

    it('reports an attribute it was never told about, so a new one cannot be lost by oversight', async () => {
        const rows = family();
        rows.chores[0].somethingNew = 'value';

        const { report } = await importInto(db, rows);

        expect(report.storedButNotMapped).toEqual({ chores: { somethingNew: 1 } });
    });
});

describe('safety', () => {
    it('refuses to import over rows that are already there, and leaves them untouched', async () => {
        await importInto(db, family());
        const smaller = family();
        smaller.familyMembers = smaller.familyMembers.slice(0, 1);

        await expect(importInto(db, smaller)).rejects.toThrow(/already holds rows/);
        expect((await one(db, `SELECT count(*)::int AS n FROM family_members`)).n).toBe(3);
    });

    it('replaces everything when asked to', async () => {
        await importInto(db, family());
        const rows = family();
        rows.settings = rows.settings.slice(0, 1);

        const { rowsOf } = await importInto(db, rows, { replace: true });

        expect((await one(db, `SELECT count(*)::int AS n FROM settings`)).n).toBe(1);
        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toEqual([]);
    });

    it('loads nothing at all when any table fails', async () => {
        const rows = family();
        rows.choreCompletions[0].dateDue = '2026-02-30';

        await expect(importInto(db, rows)).rejects.toThrow();
        expect((await one(db, `SELECT count(*)::int AS n FROM family_members`)).n).toBe(0);
    });
});

describe('the verification', () => {
    // A check that cannot fail proves nothing. Each of these alters the database after a good import.
    const alterations: Array<[string, string, string]> = [
        ['a changed setting', `UPDATE settings SET value = '"light"' WHERE name = 'dashboardTheme'`, 'settings: each setting holds the value it held'],
        ['a changed role', `UPDATE family_members SET role = 'parent' WHERE id = '${BEN}'`, 'family_members: every member, field by field'],
        ['a start date a day out', `UPDATE chores SET start_date = start_date + 1 WHERE id = '${DISHES}'`, 'chores: every chore, field by field'],
        ['a different timing', `UPDATE chores SET timing_marker_key = 'breakfast' WHERE id = '${PIANO}'`, 'chores: the app resolves the same timing from the new columns as from the old attributes'],
        ['a missing assignee', `DELETE FROM chore_assignees WHERE chore_id = '${DISHES}' AND family_member_id = '${BEN}'`, 'chore_assignees: each chore is assigned to exactly the people it was'],
        ['a rotation out of order', `UPDATE chore_assignees SET position = 9 WHERE chore_id = '${TRASH}' AND family_member_id = '${CAL}'`, 'chore_assignees: each rotation runs in the order it did'],
        ['a completion moved to another person', `UPDATE chore_completions SET completed_by = '${CAL}' WHERE id = '${id(42)}'`, 'chore_completions: every completion loaded, field by field'],
        ['a completion that is missing', `DELETE FROM chore_completions WHERE id = '${id(43)}'`, 'chore_completions: one for each chore, person and day that had one'],
        ['a completion undone', `UPDATE chore_completions SET completed_at = NULL WHERE id = '${id(40)}'`, 'chore_completions: each person has done as many chores as before'],
        ['a routine\'s steps out of order', `UPDATE routine_steps SET position = 5 WHERE chore_id = '${DISHES}'`, 'routine_steps: each routine has its chores, in their order'],
        ['a marker credited to someone else', `UPDATE routine_marker_statuses SET started_by = '${BEN}'`, 'routine_marker_statuses: every marker on every day, field by field'],
        ['a countdown run on another day', `UPDATE countdown_runs SET day = day + 1`, 'countdown_runs: every run loaded, field by field'],
        ['a grade scale with other ends', `UPDATE grade_types SET high_value = 10 WHERE id = '${id(120)}'`, 'grade_types: every scale, field by field'],
        ['a second default grade scale gone', `UPDATE grade_types SET is_default = false`, 'grade_types: as many as were exported, and one default if there was one'],
        ['a series starting a day early', `UPDATE task_series SET start_date = start_date - 1`, 'task_series: every series, field by field'],
        ['a series on another chore', `UPDATE task_series SET chore_id = '${DISHES}'`, 'task_series: every series, field by field'],
        ['a task reworded', `UPDATE tasks SET title = 'Read chapter 2' WHERE id = '${id(131)}'`, 'tasks: every task of a series, field by field'],
        ['a task that is missing', `DELETE FROM tasks WHERE id = '${id(134)}'`, 'tasks: none loaded but those of a series that was exported'],
        ['a task no longer done', `UPDATE tasks SET workflow_state = 'in_progress' WHERE id = '${id(133)}'`, 'tasks: the app reads the same state for each task, and the same place to return to'],
        ['tasks out of order', `UPDATE tasks SET sort_order = 7 WHERE id = '${id(131)}'`, 'tasks: each series has its tasks in their order, each under the parent it had'],
        ['a sub-task that lost its parent', `UPDATE tasks SET parent_task_id = NULL WHERE id = '${id(133)}'`, 'tasks: each series has its tasks in their order, each under the parent it had'],
        ['a task file pointing elsewhere', `UPDATE task_attachments SET url = 'tasks/other.pdf'`, 'task_attachments: every file, field by field'],
        ['a task file that is missing', `DELETE FROM task_attachments`, 'task_attachments: none loaded but those whose owner was'],
        ['a response field no longer required', `UPDATE task_response_fields SET required = false`, 'task_response_fields: every field of a task, field by field'],
        ['an update credited to someone else', `UPDATE task_updates SET actor_id = '${CAL}' WHERE id = '${id(160)}'`, 'task_updates: every update of a task, field by field'],
        ['a reply that answers nothing', `UPDATE task_updates SET reply_to_id = NULL WHERE id = '${id(161)}'`, 'task_updates: every update of a task, field by field'],
        ['a grade changed', `UPDATE task_updates SET grade_numeric_value = 100 WHERE id = '${id(161)}'`, 'task_updates: every update of a task, field by field'],
        ['an update that is missing', `DELETE FROM task_updates WHERE id = '${id(161)}'`, 'task_updates: each task has as many updates as before'],
        ['an update\'s photo resized', `UPDATE task_update_attachments SET width = 80`, 'task_update_attachments: every file, field by field'],
        ['an answer rewritten', `UPDATE task_response_field_values SET rich_text_content = '<p>2</p>'`, 'task_response_field_values: every answer loaded, field by field'],
        ['an answer that is missing', `DELETE FROM task_response_field_values`, 'task_response_field_values: one for each field answered with each update'],
        ['an envelope renamed', `UPDATE allowance_envelopes SET name = 'Holiday' WHERE id = '${id(201)}'`, 'allowance_envelopes: every envelope, field by field, with its owner'],
        ['an envelope given to someone else', `UPDATE family_members SET default_envelope_id = NULL; UPDATE allowance_envelopes SET family_member_id = '${ADA}' WHERE id = '${id(202)}'`, 'allowance_envelopes: every envelope, field by field, with its owner'],
        ['a balance a cent out', `UPDATE envelope_balances SET amount = amount + 0.01 WHERE envelope_id = '${id(202)}'`, 'envelope_balances: each envelope holds exactly what it held, currency by currency'],
        ['a balance that is missing', `DELETE FROM envelope_balances WHERE currency = 'STARS'`, 'envelope_balances: each envelope holds exactly what it held, currency by currency'],
        ['a ledger row rounded to the cent', `UPDATE allowance_transactions SET amount = -0.5 WHERE id = '${id(214)}'`, 'allowance_transactions: every ledger row, field by field'],
        ['a ledger row in another envelope', `UPDATE allowance_transactions SET envelope_id = '${id(201)}' WHERE id = '${id(211)}'`, 'money: each envelope\'s ledger adds up to the same amount in every currency'],
        ['a ledger row that is missing', `DELETE FROM allowance_transactions WHERE id = '${id(213)}'`, 'money: each envelope agrees with its ledger exactly where it did before'],
        ['a ledger row credited to someone else', `UPDATE allowance_transactions SET created_by = '${CAL}' WHERE id = '${id(211)}'`, 'allowance_transactions: every ledger row, field by field'],
        ['money moved between a member\'s envelopes', `UPDATE envelope_balances SET envelope_id = '${id(201)}' WHERE envelope_id = '${id(200)}' AND currency = 'STARS'`, 'envelope_balances: each envelope holds exactly what it held, currency by currency'],
        ['a default envelope that was not the one marked', `UPDATE family_members SET default_envelope_id = '${id(201)}' WHERE id = '${BEN}'`, 'family_members: each member\'s default envelope is one of theirs that was marked so, if any was'],
        ['an exchange rate changed', `UPDATE exchange_rates SET rate = 140`, 'exchange_rates: the last rate fetched for each pair of currencies'],
        ['an announcement put back up', `UPDATE announcements SET archived_at = NULL WHERE id = '${id(301)}'`, 'announcements: every announcement, field by field, showing exactly if it was'],
        ['a category that no longer loops', `UPDATE content_categories SET loop_when_empty = false`, 'content_categories: every category, field by field'],
        ['a queue item no longer live', `UPDATE content_queue_items SET status = 'queued'`, 'content_queue_items: every item of a category, field by field'],
        ['a rule reading as its old version', `UPDATE family_rules SET active_version_id = '${id(321)}'`, 'family_rules: every rule, field by field, reading as the version it did'],
        ['a version of a rule reworded', `UPDATE family_rule_versions SET rich_text_content = '<p>Two hours.</p>' WHERE id = '${id(321)}'`, 'family_rule_versions: every version of a rule, word for word, in its place'],
        ['a file moved to an announcement', `UPDATE content_attachments SET queue_item_id = NULL, announcement_id = '${id(300)}'`, 'content_attachments: every file, on the one thing it was on'],
        ['a layout with another width', `UPDATE family_dashboard_layouts SET max_width = 500`, 'family_dashboard_layouts: every layout, field by field'],
        ['a widget nudged', `UPDATE family_dashboard_widgets SET y = 0.75`, 'family_dashboard_widgets: every widget, where it sat, with its settings'],
        ['a widget\'s settings changed', `UPDATE family_dashboard_widgets SET config = '{"format":"12h"}'`, 'family_dashboard_widgets: every widget, where it sat, with its settings'],
        ['a person\'s arrangement reordered', `UPDATE dashboard_configs SET widget_order = '["balance","chores"]'`, 'dashboard_configs: each person\'s own arrangement, as they last left it'],
        ['a history entry\'s file gone', `DELETE FROM history_event_attachments`, 'history_event_attachments: none loaded but those whose owner was'],
        ['a thread retitled', `UPDATE message_threads SET title = 'Everyone' WHERE id = '${id(400)}'`, 'message_threads: every thread, field by field'],
        ['a thread about another chore', `UPDATE message_threads SET linked_entity_id = '${DISHES}' WHERE id = '${id(401)}'`, 'message_threads: every thread, field by field'],
        ['a message reworded', `UPDATE messages SET body = 'Dinner at seven' WHERE id = '${id(420)}'`, 'messages: every message of a thread, word for word, by whom and in answer to what'],
        ['a message by someone else', `UPDATE messages SET author_id = '${CAL}' WHERE id = '${id(421)}'`, 'messages: every message of a thread, word for word, by whom and in answer to what'],
        ['a removed message put back', `UPDATE messages SET deleted_at = NULL WHERE id = '${id(422)}'`, 'messages: each thread has as many messages, and as many removed, as before'],
        ['a message in another thread', `UPDATE message_thread_members SET last_read_message_id = NULL; UPDATE messages SET reply_to_id = NULL; UPDATE messages SET thread_id = '${id(401)}' WHERE id = '${id(421)}'`, 'messages: each thread has as many messages, and as many removed, as before'],
        ['someone dropped from a thread', `DELETE FROM message_thread_members WHERE thread_id = '${id(400)}' AND family_member_id = '${CAL}'`, 'message_thread_members: each thread has exactly the people it had, each keeping it as they did'],
        ['a thread no longer muted', `UPDATE message_thread_members SET notification_level = 'all' WHERE family_member_id = '${CAL}'`, 'message_thread_members: each thread has exactly the people it had, each keeping it as they did'],
        ['a thread unpinned', `UPDATE message_thread_members SET pinned_at = NULL`, 'message_thread_members: each thread has exactly the people it had, each keeping it as they did'],
        ['someone added to a thread', `INSERT INTO message_thread_members (thread_id, family_member_id) VALUES ('${id(401)}', '${CAL}')`, 'message_thread_members: each person is in as many threads as before'],
        ['a message\'s file renamed', `UPDATE message_attachments SET name = 'other.jpg'`, 'message_attachments: every file, field by field'],
        ['a reaction changed', `UPDATE message_reactions SET emoji = '👎'`, 'message_reactions, message_acknowledgements: each message has the reactions and acknowledgements it had, from the people it had them from'],
        ['a seen turned into an acknowledgement', `UPDATE message_acknowledgements SET kind = 'acknowledged' WHERE family_member_id = '${CAL}'`, 'message_reactions, message_acknowledgements: each message has the reactions and acknowledgements it had, from the people it had them from'],
        ['a history entry reworded', `UPDATE history_events SET summary = 'Completed "Trash"' WHERE id = '${id(60)}'`, 'history_events: every event, field by field'],
        ['a history entry credited to someone else', `UPDATE history_events SET actor_id = '${BEN}' WHERE id = '${id(62)}'`, 'history_events: every event, field by field'],
        ['a history entry that is missing', `DELETE FROM history_events WHERE id = '${id(61)}'`, 'history_events: as many as were exported'],
        ['someone no longer affected by an event', `DELETE FROM history_event_members WHERE history_event_id = '${id(62)}'`, 'history_event_members: each event affected exactly the people it did'],
    ];

    it.each(alterations)('catches %s', async (_what, sql, check) => {
        const { rowsOf } = await importInto(db, family());
        await db.exec(sql);

        expect(failed(await verifyImport(db, rowsOf, choreTiming))).toContain(check);
    });
});
