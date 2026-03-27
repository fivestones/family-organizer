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

    it('sorts chores chronologically: timed windows before anytime, before-marker by deadline', () => {
        const chores: SharedChoreLike[] = [
            makeChore({
                id: 'anytime-chore',
                title: 'Make your bed',
                timingMode: 'anytime',
                timingConfig: { mode: 'anytime' },
            }),
            makeChore({
                id: 'before-bedtime',
                title: 'Brush teeth before bed',
                timingMode: 'before_marker',
                timingConfig: {
                    mode: 'before_marker',
                    anchor: { sourceType: 'routine', routineKey: 'bedtime', fallbackTime: '20:30' },
                },
            }),
            makeChore({
                id: 'morning-chore',
                title: 'Brush teeth in the morning',
                timeBucket: 'morning',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'morning' },
            }),
            makeChore({
                id: 'before-breakfast',
                title: 'Set the table',
                timingMode: 'before_marker',
                timingConfig: {
                    mode: 'before_marker',
                    anchor: { sourceType: 'routine', routineKey: 'breakfast', fallbackTime: '08:00' },
                },
            }),
        ];

        const sorted = sortChoresForDisplay(chores, { date: new Date('2026-03-22T00:00:00Z'), chores });

        // Expected: morning (start 420) → before-breakfast (deadline 480) → before-bedtime (deadline 1230) → anytime (9999)
        expect(sorted.map((entry) => entry.chore.id)).toEqual([
            'morning-chore',
            'before-breakfast',
            'before-bedtime',
            'anytime-chore',
        ]);
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

    it('before_chore with no fallback sorts just before the source chore window', () => {
        const chores: SharedChoreLike[] = [
            makeChore({
                id: 'evening-chore',
                title: 'Evening chore',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'evening' },
            }),
            makeChore({
                id: 'before-evening',
                title: 'Before evening chore',
                timingMode: 'before_chore',
                timingConfig: {
                    mode: 'before_chore',
                    anchor: { sourceType: 'chore', sourceChoreId: 'evening-chore' },
                },
            }),
            makeChore({
                id: 'morning-chore',
                title: 'Morning chore',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'morning' },
            }),
        ];

        const sorted = sortChoresForDisplay(chores, { date: new Date('2026-03-22T00:00:00Z'), chores });

        // before-evening should sort at evening's startOffset, placing it after morning but before evening
        expect(sorted.map((entry) => entry.chore.id)).toEqual([
            'morning-chore',
            'before-evening',
            'evening-chore',
        ]);
    });

    it('after_chore with no fallback sorts just after the source chore window', () => {
        const chores: SharedChoreLike[] = [
            makeChore({
                id: 'morning-chore',
                title: 'Morning chore',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'morning' },
            }),
            makeChore({
                id: 'after-morning',
                title: 'After morning chore',
                timingMode: 'after_chore',
                timingConfig: {
                    mode: 'after_chore',
                    anchor: { sourceType: 'chore', sourceChoreId: 'morning-chore' },
                },
            }),
            makeChore({
                id: 'evening-chore',
                title: 'Evening chore',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'evening' },
            }),
        ];

        const sorted = sortChoresForDisplay(chores, { date: new Date('2026-03-22T00:00:00Z'), chores });

        // after-morning should sort at morning's endOffset, placing it after morning but before evening
        expect(sorted.map((entry) => entry.chore.id)).toEqual([
            'morning-chore',
            'after-morning',
            'evening-chore',
        ]);
    });

    it('walks multi-level chore-anchor chains to find a time reference', () => {
        const chores: SharedChoreLike[] = [
            makeChore({
                id: 'evening-chore',
                title: 'Evening chore',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'evening' },
            }),
            // anchored to middle-chore which is anchored to evening-chore
            makeChore({
                id: 'after-after-evening',
                title: 'After after evening',
                timingMode: 'after_chore',
                timingConfig: {
                    mode: 'after_chore',
                    anchor: { sourceType: 'chore', sourceChoreId: 'middle-chore' },
                },
            }),
            makeChore({
                id: 'middle-chore',
                title: 'Middle chore',
                timingMode: 'after_chore',
                timingConfig: {
                    mode: 'after_chore',
                    anchor: { sourceType: 'chore', sourceChoreId: 'evening-chore' },
                },
            }),
            makeChore({
                id: 'morning-chore',
                title: 'Morning chore',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'morning' },
            }),
        ];

        const sorted = sortChoresForDisplay(chores, { date: new Date('2026-03-22T00:00:00Z'), chores });

        // Both chore-anchored items should resolve to evening window's endOffset
        // and sort after morning but alongside/after evening
        const ids = sorted.map((entry) => entry.chore.id);
        expect(ids.indexOf('morning-chore')).toBeLessThan(ids.indexOf('evening-chore'));
        expect(ids.indexOf('evening-chore')).toBeLessThan(ids.indexOf('middle-chore'));
        expect(ids.indexOf('evening-chore')).toBeLessThan(ids.indexOf('after-after-evening'));
    });

    it('before_chore with no chain time reference sorts at start of day', () => {
        const chores: SharedChoreLike[] = [
            makeChore({
                id: 'anytime-source',
                title: 'Anytime source',
                timingMode: 'anytime',
                timingConfig: { mode: 'anytime' },
            }),
            makeChore({
                id: 'before-anytime',
                title: 'Before anytime',
                timingMode: 'before_chore',
                timingConfig: {
                    mode: 'before_chore',
                    anchor: { sourceType: 'chore', sourceChoreId: 'anytime-source' },
                },
            }),
            makeChore({
                id: 'morning-chore',
                title: 'Morning chore',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'morning' },
            }),
        ];

        const sorted = sortChoresForDisplay(chores, { date: new Date('2026-03-22T00:00:00Z'), chores });

        // before-anytime has no time reference → sorts at 0 (before morning)
        expect(sorted.map((entry) => entry.chore.id)).toEqual([
            'before-anytime',
            'morning-chore',
            'anytime-source',
        ]);
    });

    it('after_chore with no chain time reference sorts at end of day before anytime', () => {
        const chores: SharedChoreLike[] = [
            makeChore({
                id: 'anytime-source',
                title: 'Anytime source',
                timingMode: 'anytime',
                timingConfig: { mode: 'anytime' },
            }),
            makeChore({
                id: 'after-anytime',
                title: 'After anytime',
                timingMode: 'after_chore',
                timingConfig: {
                    mode: 'after_chore',
                    anchor: { sourceType: 'chore', sourceChoreId: 'anytime-source' },
                },
            }),
            makeChore({
                id: 'morning-chore',
                title: 'Morning chore',
                timingMode: 'named_window',
                timingConfig: { mode: 'named_window', namedWindowKey: 'morning' },
            }),
        ];

        const sorted = sortChoresForDisplay(chores, { date: new Date('2026-03-22T00:00:00Z'), chores });

        // after-anytime → 1440 (end of day), morning → ~420, anytime → 9999
        expect(sorted.map((entry) => entry.chore.id)).toEqual([
            'morning-chore',
            'after-anytime',
            'anytime-source',
        ]);
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
