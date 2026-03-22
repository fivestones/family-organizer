import { describe, expect, it } from 'vitest';
import {
    groupChoresForDisplay,
    resolveChoreTimingForDate,
    sortChoresForDisplay,
    wouldCreateChoreTimingCycle,
    type SharedChoreLike,
    type SharedRoutineMarkerStatusLike,
} from '@family-organizer/shared-core';

function makeChore(overrides: Partial<SharedChoreLike> = {}): SharedChoreLike {
    return {
        id: overrides.id || 'chore-1',
        title: overrides.title || 'Test chore',
        startDate: overrides.startDate || '2026-03-22',
        assignees: overrides.assignees || [{ id: 'kid-a', name: 'Alex' }],
        completions: overrides.completions || [],
        ...overrides,
    };
}

describe('shared-core chore timing helpers', () => {
    it('sorts chores by section timing and then manual sort order', () => {
        const chores: SharedChoreLike[] = [
            makeChore({
                id: 'evening',
                title: 'Evening chore',
                sortOrder: 0,
                timeBucket: 'evening',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'evening' },
            }),
            makeChore({
                id: 'morning-b',
                title: 'Morning B',
                sortOrder: 2,
                timeBucket: 'morning',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'morning' },
            }),
            makeChore({
                id: 'morning-a',
                title: 'Morning A',
                sortOrder: 1,
                timeBucket: 'morning',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'morning' },
            }),
        ];

        const sorted = sortChoresForDisplay(chores, { date: new Date('2026-03-22T00:00:00Z'), chores });

        expect(sorted.map((entry) => entry.chore.id)).toEqual(['morning-a', 'morning-b', 'evening']);
    });

    it('resolves routine-anchor timing from marker status rows', () => {
        const routineStatuses: SharedRoutineMarkerStatusLike[] = [
            {
                markerKey: 'breakfast',
                date: '2026-03-22',
                startedAt: new Date(2026, 2, 22, 8, 5).toISOString(),
            },
        ];

        const chore = makeChore({
            id: 'before-breakfast',
            title: 'Set the table',
            timingMode: 'before_marker',
            timingConfig: {
                mode: 'before_marker',
                anchor: {
                    sourceType: 'routine',
                    routineKey: 'breakfast',
                    fallbackTime: '11:00',
                },
            },
        });

        const timing = resolveChoreTimingForDate(chore, {
            date: new Date('2026-03-22T00:00:00Z'),
            now: new Date(2026, 2, 22, 7, 30),
            routineMarkerStatuses: routineStatuses,
            chores: [chore],
        });

        expect(timing.label).toBe('Before Breakfast');
        expect(timing.anchorMinute).toBe(485);
        expect(timing.status).toBe('now');
    });

    it('groups chore-anchor timing under the linked source chore label', () => {
        const sourceChore = makeChore({
            id: 'dishes',
            title: 'Wash dishes',
            completions: [
                {
                    id: 'completion-1',
                    completed: true,
                    dateDue: '2026-03-22',
                    dateCompleted: '2026-03-22T18:40:00.000Z',
                    completedBy: { id: 'kid-a' },
                },
            ],
        });
        const anchoredChore = makeChore({
            id: 'wipe-counters',
            title: 'Wipe counters',
            timingMode: 'after_chore',
            timingConfig: {
                mode: 'after_chore',
                anchor: {
                    sourceType: 'chore',
                    sourceChoreId: 'dishes',
                    fallbackTime: '19:30',
                },
            },
        });

        const sections = groupChoresForDisplay([sourceChore, anchoredChore], {
            date: new Date('2026-03-22T00:00:00Z'),
            now: new Date('2026-03-22T12:00:00Z'),
            chores: [sourceChore, anchoredChore],
        });

        expect(sections.some((section) => section.label === 'Upcoming')).toBe(true);
    });

    it('detects chore-anchor cycles before saving', () => {
        const chores = [
            makeChore({
                id: 'a',
                title: 'A',
                timingMode: 'after_chore',
                timingConfig: {
                    mode: 'after_chore',
                    anchor: {
                        sourceType: 'chore',
                        sourceChoreId: 'b',
                    },
                },
            }),
            makeChore({
                id: 'b',
                title: 'B',
                timingMode: 'after_chore',
                timingConfig: {
                    mode: 'after_chore',
                    anchor: {
                        sourceType: 'chore',
                        sourceChoreId: 'c',
                    },
                },
            }),
            makeChore({
                id: 'c',
                title: 'C',
            }),
        ];

        expect(wouldCreateChoreTimingCycle('c', 'a', chores)).toBe(true);
        expect(wouldCreateChoreTimingCycle('c', 'b', chores)).toBe(true);
        expect(wouldCreateChoreTimingCycle('a', 'c', chores)).toBe(false);
    });
});
