import { describe, expect, it } from 'vitest';
import {
    computeCountdownTimelines,
    DEFAULT_COUNTDOWN_SETTINGS,
    getDefaultScheduleSettings,
    type CountdownChoreInput,
    type CountdownEngineInput,
    type CountdownSlot,
    type SharedChoreLike,
} from '@family-organizer/shared-core';

const TEST_DATE = new Date('2026-03-31T00:00:00Z');
const SCHEDULE = getDefaultScheduleSettings();

function chore(overrides: Partial<CountdownChoreInput> & Pick<CountdownChoreInput, 'id'>): CountdownChoreInput {
    return {
        id: overrides.id,
        title: overrides.title || overrides.id,
        estimatedDurationSecs: overrides.estimatedDurationSecs ?? 300,
        weight: overrides.weight ?? null,
        sortOrder: overrides.sortOrder ?? 0,
        isJoint: overrides.isJoint ?? false,
        assigneeIds: overrides.assigneeIds ?? ['person-a'],
        timingMode: overrides.timingMode ?? 'before_time',
        timingConfig: overrides.timingConfig ?? { mode: 'before_time', time: '09:00' },
        timeBucket: overrides.timeBucket ?? null,
        completedAt: overrides.completedAt ?? null,
        memberCompletions: overrides.memberCompletions ?? {},
    };
}

function rawChore(input: CountdownChoreInput): SharedChoreLike {
    return {
        id: input.id,
        title: input.title,
        startDate: '2026-03-31',
        timingMode: input.timingMode,
        timingConfig: input.timingConfig,
        timeBucket: input.timeBucket,
        sortOrder: input.sortOrder,
        weight: input.weight,
        isJoint: input.isJoint,
        assignees: input.assigneeIds.map((id) => ({ id })),
        completions: Object.entries(input.memberCompletions).map(([memberId, dateCompleted], index) => ({
            id: `${input.id}-completion-${index}`,
            completed: true,
            dateDue: '2026-03-31',
            dateCompleted,
            completedBy: { id: memberId },
        })),
    };
}

function input(
    chores: CountdownChoreInput[],
    overrides: Partial<Omit<CountdownEngineInput, 'chores' | 'allChoresRaw'>> = {}
): CountdownEngineInput {
    return {
        chores,
        allChoresRaw: chores.map(rawChore),
        routineMarkerStatuses: overrides.routineMarkerStatuses || [],
        countdownSettings: overrides.countdownSettings || {
            ...DEFAULT_COUNTDOWN_SETTINGS,
            stackBufferSecs: 30,
        },
        scheduleSettings: overrides.scheduleSettings || SCHEDULE,
        now: overrides.now || new Date('2026-03-31T07:00:00'),
        date: overrides.date || TEST_DATE,
        manualStarts: overrides.manualStarts,
        collisionDecisions: overrides.collisionDecisions,
    };
}

function clock(timestampMs: number) {
    const date = new Date(timestampMs);
    return [date.getHours(), date.getMinutes(), date.getSeconds()]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
}

function slotLayout(slot: CountdownSlot) {
    const resume = slot.isResume ? ':resume' : '';
    return `${slot.choreId}${resume} ${clock(slot.countdownStartMs)}-${clock(slot.countdownEndMs)} target ${clock(slot.targetStartMs)}-${clock(slot.targetEndMs)}`;
}

function normalize(result: ReturnType<typeof computeCountdownTimelines>) {
    return Object.fromEntries(
        Object.entries(result.timelines)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([personId, timeline]) => [
                personId,
                {
                    slots: timeline.slots.map(slotLayout),
                    collisions: timeline.collisions.map(
                        (collision) => `${collision.startDrivenChoreId}:${collision.deadlineDrivenChoreId}`
                    ),
                },
            ])
    );
}

const scenarios: Array<{
    name: string;
    buildInput: () => CountdownEngineInput;
    expected: Record<string, { slots: string[]; collisions: string[] }>;
}> = [
    {
        name: 'packs a three-chore deadline stack right-to-left with buffers',
        buildInput: () =>
            input([
                chore({ id: 'two-minutes', estimatedDurationSecs: 120, sortOrder: 0 }),
                chore({ id: 'three-minutes', estimatedDurationSecs: 180, sortOrder: 1 }),
                chore({ id: 'four-minutes', estimatedDurationSecs: 240, sortOrder: 2 }),
            ]),
        expected: {
            'person-a': {
                slots: [
                    'two-minutes 08:50:00-08:52:00 target 08:50:00-08:52:00',
                    'three-minutes 08:52:30-08:55:30 target 08:52:30-08:55:30',
                    'four-minutes 08:56:00-09:00:00 target 08:56:00-09:00:00',
                ],
                collisions: [],
            },
        },
    },
    {
        name: 'pulls a packed successor forward from an exact completion timestamp',
        buildInput: () =>
            input(
                [
                    chore({
                        id: 'first',
                        estimatedDurationSecs: 120,
                        sortOrder: 0,
                        timingMode: 'after_time',
                        timingConfig: { mode: 'after_time', time: '08:00' },
                        memberCompletions: { 'person-a': '2026-03-31T08:01:12' },
                    }),
                    chore({
                        id: 'second',
                        estimatedDurationSecs: 180,
                        sortOrder: 1,
                        timingMode: 'after_time',
                        timingConfig: { mode: 'after_time', time: '08:00' },
                    }),
                ],
                {
                    countdownSettings: {
                        ...DEFAULT_COUNTDOWN_SETTINGS,
                        stackBufferSecs: 30,
                        afterAnchorDefaultDelaySecs: 0,
                    },
                    now: new Date('2026-03-31T08:02:00'),
                }
            ),
        expected: {
            'person-a': {
                slots: [
                    'first 08:00:00-08:02:00 target 08:00:00-08:02:00',
                    'second 08:01:42-08:04:42 target 08:02:30-08:05:30',
                ],
                collisions: [],
            },
        },
    },
    {
        name: 'keeps second precision when an after-chore anchor finished before its countdown',
        buildInput: () =>
            input(
                [
                    chore({
                        id: 'anchor',
                        timingMode: 'after_time',
                        timingConfig: { mode: 'after_time', time: '08:00' },
                        memberCompletions: { 'person-a': '2026-03-31T08:03:45' },
                    }),
                    chore({
                        id: 'dependent',
                        timingMode: 'after_chore',
                        timingConfig: {
                            mode: 'chore_anchor',
                            anchor: { relation: 'after', sourceChoreId: 'anchor' },
                        },
                    }),
                ],
                {
                    countdownSettings: {
                        ...DEFAULT_COUNTDOWN_SETTINGS,
                        stackBufferSecs: 15,
                        afterAnchorDefaultDelaySecs: 300,
                    },
                    now: new Date('2026-03-31T08:04:00'),
                }
            ),
        expected: {
            'person-a': {
                slots: [
                    'anchor 08:05:00-08:10:00 target 08:05:00-08:10:00',
                    'dependent 08:08:45-08:13:45 target 08:08:45-08:13:45',
                ],
                collisions: [],
            },
        },
    },
    {
        name: 'splits a start-driven chore around a deadline collision',
        buildInput: () =>
            input(
                [
                    chore({
                        id: 'start-driven',
                        estimatedDurationSecs: 1200,
                        timingMode: 'after_time',
                        timingConfig: { mode: 'after_time', time: '07:50' },
                    }),
                    chore({
                        id: 'deadline',
                        estimatedDurationSecs: 600,
                        timingMode: 'before_time',
                        timingConfig: { mode: 'before_time', time: '08:05' },
                    }),
                ],
                {
                    countdownSettings: {
                        ...DEFAULT_COUNTDOWN_SETTINGS,
                        stackBufferSecs: 30,
                        afterAnchorDefaultDelaySecs: 0,
                    },
                    collisionDecisions: { 'start-driven:deadline': 'start_driven_first' },
                }
            ),
        expected: {
            'person-a': {
                slots: [
                    'start-driven 07:50:00-07:54:30 target 07:50:00-07:54:30',
                    'deadline 07:55:00-08:05:00 target 07:55:00-08:05:00',
                    'start-driven:resume 08:05:30-08:21:00 target 08:05:30-08:21:00',
                ],
                collisions: [],
            },
        },
    },
    {
        name: 'propagates a joint chore constraint across otherwise independent people',
        buildInput: () =>
            input([
                chore({
                    id: 'joint',
                    estimatedDurationSecs: 600,
                    sortOrder: 0,
                    isJoint: true,
                    assigneeIds: ['person-a', 'person-b'],
                }),
                chore({
                    id: 'person-a-blocker',
                    estimatedDurationSecs: 1200,
                    sortOrder: 1,
                    assigneeIds: ['person-a'],
                }),
            ]),
        expected: {
            'person-a': {
                slots: [
                    'joint 08:29:30-08:39:30 target 08:29:30-08:39:30',
                    'person-a-blocker 08:40:00-09:00:00 target 08:40:00-09:00:00',
                ],
                collisions: [],
            },
            'person-b': {
                slots: ['joint 08:29:30-08:39:30 target 08:29:30-08:39:30'],
                collisions: [],
            },
        },
    },
];

describe('chore countdown golden scenarios', () => {
    it.each(scenarios)('$name', ({ buildInput, expected }) => {
        expect(normalize(computeCountdownTimelines(buildInput()))).toEqual(expected);
    });
});
