import { describe, expect, it } from 'vitest';
import { getAssignedMembersForChoreOnDate } from '@family-organizer/shared-core';
import { createChorePausePatch, getChoreOccurrenceDateKeysInRange, getChoreScheduleEndCondition } from '@/lib/chore-schedule';
import { getDefaultRecurrenceUiState, normalizeRrule, serializeRecurrenceToRrule } from '@/lib/recurrence';

/**
 * A chore's end date is not a field of its own: it is the end condition of its
 * recurrence. These tests pin that a chore given an end date in the form stops
 * after that date, inclusive, in both occurrence engines.
 */
describe('chore end dates', () => {
    const START = '2026-04-01';
    const END = '2026-04-10';

    // What the chore form saves for "Repeat daily · End on date".
    const rrule = normalizeRrule(
        serializeRecurrenceToRrule({ ...getDefaultRecurrenceUiState(START), mode: 'daily', repeatEndMode: 'until', repeatEndUntil: END }, START),
    );
    const chore = { id: 'chore-1', startDate: START, rrule, exdates: [], assignees: [{ id: 'kid-a' }] };
    const dueOn = (dateKey: string) => getAssignedMembersForChoreOnDate(chore, new Date(`${dateKey}T00:00:00Z`)).length > 0;

    it('is stored as the recurrence’s end condition', () => {
        expect(getChoreScheduleEndCondition(rrule).type).toBe('until');
    });

    it('still occurs on the end date and never after it, in the web schedule engine', () => {
        const keys = getChoreOccurrenceDateKeysInRange(chore, '2026-04-08', '2026-04-20');
        expect(keys).toEqual(['2026-04-08', '2026-04-09', '2026-04-10']);
    });

    it('still occurs on the end date and never after it, in the shared assignment engine', () => {
        expect(dueOn('2026-04-09')).toBe(true);
        expect(dueOn(END)).toBe(true);
        expect(dueOn('2026-04-11')).toBe(false);
        expect(dueOn('2026-05-01')).toBe(false);
    });

    it('ends a chore from the schedule actions the same way', () => {
        const forever = { startDate: START, rrule: 'RRULE:FREQ=DAILY', exdates: [] };
        // "End chore" with 10 April as the first day it should no longer happen.
        const ended = createChorePausePatch(forever, { pauseStartDate: '2026-04-11', intent: 'ended' });

        expect(getChoreScheduleEndCondition(ended.rrule).type).toBe('until');
        expect(getChoreOccurrenceDateKeysInRange({ ...forever, ...ended }, '2026-04-09', '2026-04-20')).toEqual([
            '2026-04-09',
            '2026-04-10',
        ]);
        expect(ended.pauseState).toMatchObject({ mode: 'open-ended', intent: 'ended' });
    });
});
