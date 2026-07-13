import { describe, expect, it } from 'vitest';
import {
    calculateDailyXP,
    createChoreCompletionRecordId,
    formatDateKeyUTC,
    getAssignedMembersForChoreOnDate,
    getCompletedChoreCompletionsForDate,
    getMemberCompletionForDate,
    isChoreDueOnDate,
    pickCanonicalChoreCompletion,
    type SharedChoreLike,
} from '@family-organizer/shared-core';

function makeRotatingChore(overrides: Partial<SharedChoreLike> = {}): SharedChoreLike {
    return {
        id: 'chore-1',
        title: 'Dishes',
        startDate: '2026-03-01',
        rrule: 'FREQ=DAILY',
        rotationType: 'daily',
        isUpForGrabs: false,
        assignees: [
            { id: 'kid-a', name: 'Alex' },
            { id: 'kid-b', name: 'Blair' },
        ],
        assignments: [
            { order: 2, familyMember: { id: 'kid-b', name: 'Blair' } },
            { order: 1, familyMember: { id: 'kid-a', name: 'Alex' } },
        ],
        completions: [],
        ...overrides,
    };
}

describe('shared-core chores helpers', () => {
    it('uses one deterministic record id for concurrent up-for-grabs claims', () => {
        const createId = () => 'random-id';
        const first = createChoreCompletionRecordId('chore-1', '2026-03-02', true, createId);
        const second = createChoreCompletionRecordId('chore-1', '2026-03-02', true, createId);

        expect(first).toBe(second);
        expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(createChoreCompletionRecordId('chore-1', '2026-03-03', true, createId)).not.toBe(first);
        expect(createChoreCompletionRecordId('chore-1', '2026-03-02', false, createId)).toBe('random-id');
    });

    it('selects the earliest completion as the canonical legacy claim', () => {
        expect(
            pickCanonicalChoreCompletion([
                { id: 'later', dateCompleted: '2026-03-02T08:02:00Z' },
                { id: 'earlier', dateCompleted: '2026-03-02T08:01:00Z' },
            ])
        ).toMatchObject({ id: 'earlier' });
    });

    it('assigns rotating chores using sorted assignment order', () => {
        const chore = makeRotatingChore();

        const day1 = getAssignedMembersForChoreOnDate(chore, new Date('2026-03-01T12:00:00Z'));
        const day2 = getAssignedMembersForChoreOnDate(chore, new Date('2026-03-02T12:00:00Z'));
        const day3 = getAssignedMembersForChoreOnDate(chore, new Date('2026-03-03T12:00:00Z'));

        expect(day1.map((m) => m.id)).toEqual(['kid-a']);
        expect(day2.map((m) => m.id)).toEqual(['kid-b']);
        expect(day3.map((m) => m.id)).toEqual(['kid-a']);
    });

    it('treats up-for-grabs chores as available to all assignees even with rotation assignments', () => {
        const chore = makeRotatingChore({ isUpForGrabs: true });

        const assigned = getAssignedMembersForChoreOnDate(chore, new Date('2026-03-02T09:00:00Z'));

        expect(assigned.map((m) => m.id).sort()).toEqual(['kid-a', 'kid-b']);
    });

    it('skips exdates without advancing rotation order', () => {
        const chore = makeRotatingChore({
            exdates: ['2026-03-02'],
        });

        const skippedDay = getAssignedMembersForChoreOnDate(chore, new Date('2026-03-02T12:00:00Z'));
        const resumedDay = getAssignedMembersForChoreOnDate(chore, new Date('2026-03-03T12:00:00Z'));

        expect(skippedDay).toEqual([]);
        expect(resumedDay.map((m) => m.id)).toEqual(['kid-b']);
    });

    it('handles one-time chores without RRULE on exact UTC day only', () => {
        const chore: SharedChoreLike = {
            id: 'one-time',
            startDate: '2026-04-10',
            assignees: [{ id: 'kid-a', name: 'Alex' }],
        };

        expect(isChoreDueOnDate(chore, new Date('2026-04-10T23:59:59Z'))).toBe(true);
        expect(isChoreDueOnDate(chore, new Date('2026-04-11T00:00:00Z'))).toBe(false);
    });

    it('filters completed chore completions for the selected due date', () => {
        const chore = makeRotatingChore({
            completions: [
                { id: 'c1', completed: true, dateDue: '2026-03-02', completedBy: { id: 'kid-a' } },
                { id: 'c2', completed: false, dateDue: '2026-03-02', completedBy: { id: 'kid-b' } },
                { id: 'c3', completed: true, dateDue: '2026-03-03', completedBy: { id: 'kid-b' } },
            ],
        });

        const results = getCompletedChoreCompletionsForDate(chore, new Date('2026-03-02T06:00:00Z'));
        expect(results.map((c) => c.id)).toEqual(['c1']);
    });

    it('finds member completion for a date when completedBy relation is array-shaped', () => {
        const chore = makeRotatingChore({
            completions: [
                {
                    id: 'c-array',
                    completed: true,
                    dateDue: '2026-03-02',
                    completedBy: [{ id: 'kid-b' }],
                },
            ],
        });

        const completion = getMemberCompletionForDate(chore, 'kid-b', new Date('2026-03-02T17:00:00Z'));
        expect(completion?.id).toBe('c-array');
    });

    it('formats UTC date keys using UTC calendar day, not local timezone', () => {
        const date = new Date('2026-03-02T23:30:00-05:00'); // 2026-03-03 in UTC
        expect(formatDateKeyUTC(date)).toBe('2026-03-03');
    });

    it('calculates daily XP for standard and up-for-grabs chores', () => {
        const chores: SharedChoreLike[] = [
            makeRotatingChore({
                id: 'standard',
                rrule: 'FREQ=DAILY',
                weight: 3,
                rewardType: 'weight',
                completions: [
                    { id: 'c1', completed: true, dateDue: '2026-03-02', completedBy: { id: 'kid-b' } },
                ],
            }),
            makeRotatingChore({
                id: 'ufg-unclaimed',
                isUpForGrabs: true,
                rotationType: 'none',
                assignments: [],
                weight: 2,
                rewardType: 'weight',
                completions: [],
            }),
            makeRotatingChore({
                id: 'ufg-claimed',
                isUpForGrabs: true,
                rotationType: 'none',
                assignments: [],
                weight: 5,
                rewardType: 'weight',
                completions: [
                    { id: 'c2', completed: true, dateDue: '2026-03-02', completedBy: { id: 'kid-a' } },
                ],
            }),
            makeRotatingChore({
                id: 'fixed-reward',
                weight: 9,
                rewardType: 'fixed',
                completions: [],
            }),
        ];

        const familyMembers = [
            { id: 'kid-a', name: 'Alex' },
            { id: 'kid-b', name: 'Blair' },
        ];

        const xp = calculateDailyXP(chores, familyMembers, new Date('2026-03-02T12:00:00Z'));

        // standard rotating chore on 2026-03-02 assigns kid-b
        // ufg-unclaimed adds possible +2 to both
        // ufg-claimed adds current/possible +5 to kid-a only
        expect(xp['kid-a']).toEqual({ current: 5, possible: 7 });
        expect(xp['kid-b']).toEqual({ current: 3, possible: 5 });
    });

    it('does not add possible XP for negative-weight chores, but still counts current if completed', () => {
        const chores: SharedChoreLike[] = [
            makeRotatingChore({
                id: 'negative',
                weight: -2,
                rewardType: 'weight',
                completions: [
                    { id: 'neg-c', completed: true, dateDue: '2026-03-02', completedBy: { id: 'kid-b' } },
                ],
            }),
        ];
        const xp = calculateDailyXP(
            chores,
            [
                { id: 'kid-a', name: 'Alex' },
                { id: 'kid-b', name: 'Blair' },
            ],
            new Date('2026-03-02T12:00:00Z')
        );

        expect(xp['kid-a']).toEqual({ current: 0, possible: 0 });
        expect(xp['kid-b']).toEqual({ current: -2, possible: 0 });
    });

    it('credits only the canonical completion when legacy up-for-grabs claims are duplicated', () => {
        const chore = makeRotatingChore({
            id: 'ufg-duplicate',
            isUpForGrabs: true,
            rotationType: 'none',
            assignments: [],
            weight: 5,
            rewardType: 'weight',
            completions: [
                {
                    id: 'later',
                    completed: true,
                    dateDue: '2026-03-02',
                    dateCompleted: '2026-03-02T08:02:00Z',
                    completedBy: { id: 'kid-b' },
                },
                {
                    id: 'earlier',
                    completed: true,
                    dateDue: '2026-03-02',
                    dateCompleted: '2026-03-02T08:01:00Z',
                    completedBy: { id: 'kid-a' },
                },
            ],
        });

        const xp = calculateDailyXP(
            [chore],
            [
                { id: 'kid-a', name: 'Alex' },
                { id: 'kid-b', name: 'Blair' },
            ],
            new Date('2026-03-02T12:00:00Z')
        );

        expect(xp['kid-a']).toEqual({ current: 5, possible: 5 });
        expect(xp['kid-b']).toEqual({ current: 0, possible: 0 });
    });
});
