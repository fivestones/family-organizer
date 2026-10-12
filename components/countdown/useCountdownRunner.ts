'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tx, id } from '@instantdb/react';
import { db } from '@/lib/db';
import { useAuth } from '@/components/AuthProvider';
import { useParentMode } from '@/components/auth/useParentMode';
import { useToast } from '@/components/ui/use-toast';
import { buildChoreCompletionChange } from '@/lib/chore-completion';
import {
    buildCountdownChoreInputs,
    buildRunAdvancePatch,
    buildRunExtendPatch,
    buildRunStartPatch,
    buildRunStopPatch,
    buildRunTouchPatch,
    buildRunnerQueue,
    computeCountdownTimelines,
    createCountdownRunId,
    findCountdownRun,
    selectNextRunnerStep,
    getFamilyDayDateUTC,
    getRoutineChoreIds,
    getRoutineOverrunPolicy,
    isChoreHiddenFromDayList,
    isCountdownRunLive,
    isCountdownRunStale,
    resolveRunnerState,
    shouldRecordRunInteraction,
    sortRoutines,
    type CountdownEngineInput,
    type CountdownRunLike,
    type CountdownRunPatch,
    type CountdownRunStoppedReason,
    type CountdownSettings,
    type RoutineOverrunPolicy,
    type RunnerState,
    type RunnerStep,
    type SharedRoutineLike,
    type SharedScheduleSettings,
} from '@family-organizer/shared-core';
import { useSetting } from '@/lib/data';

/** How often the queue itself is rebuilt; the clock on top of it ticks every second. */
const QUEUE_REFRESH_MS = 30_000;
/** Taps arrive in bursts; one write a minute is enough to prove someone is there. */
const INTERACTION_WRITE_INTERVAL_MS = 60_000;

export interface CountdownMember {
    id: string;
    name: string;
    photoUrls?: any;
}

/** A routine one person could run today, and how far through it they are. */
export interface MemberRoutine {
    id: string;
    name: string;
    totalCount: number;
    completedCount: number;
    /** The step starting this routine would begin; null when none is open. */
    nextStep: RunnerStep | null;
}

export interface MemberRunner {
    member: CountdownMember;
    run: (CountdownRunLike & { id: string }) | null;
    /** The queue the run is working through: a routine's while one is live, otherwise the day's. */
    state: RunnerState;
    /** The routine the live run belongs to, if any. */
    activeRoutine: { id: string; name: string } | null;
    /** Routines with steps on this person's plate today. */
    routines: MemberRoutine[];
    /** Whether this session may start, advance or stop this member's run. */
    canControl: boolean;
    /** The description of the step on screen — the live one, or the one Start would begin. */
    stepDescription: string | null;
}

export interface CountdownRunnerActions {
    /** Start the day's queue, or a routine when one is named. */
    start: (memberId: string, routineId?: string) => void;
    markDone: (memberId: string) => void;
    extend: (memberId: string) => void;
    stop: (memberId: string) => void;
}

export interface CountdownRunner {
    isLoading: boolean;
    error: { message?: string } | null;
    nowMs: number;
    /** Everyone with something on their plate today, in family order. */
    runners: MemberRunner[];
    settings: CountdownSettings;
    currentMemberId: string | null;
    canManageRoutines: boolean;
    actions: CountdownRunnerActions;
}

interface MemberQueues {
    day: RunnerStep[];
    routines: Array<{ id: string; name: string; onStepOverrun: RoutineOverrunPolicy; queue: RunnerStep[] }>;
}

function useNowMs(intervalMs: number): number {
    const [nowMs, setNowMs] = useState(() => Date.now());
    useEffect(() => {
        const interval = setInterval(() => setNowMs(Date.now()), intervalMs);
        return () => clearInterval(interval);
    }, [intervalMs]);
    return nowMs;
}

function firstLinked<T>(value: T | T[] | null | undefined): T | null {
    return (Array.isArray(value) ? value[0] : value) ?? null;
}

export function useCountdownRunner(): CountdownRunner {
    const { currentUser } = useAuth();
    const { isParentMode } = useParentMode();
    const { toast } = useToast();
    const nowMs = useNowMs(1000);
    const queueTick = Math.floor(nowMs / QUEUE_REFRESH_MS);

    // The family day can only be known once the schedule settings have loaded,
    // so the day-scoped rows are fetched against the calendar's best guess and
    // filtered again below.
    const scheduleSetting = useSetting('householdSchedule');
    const countdownSetting = useSetting('countdown');
    const scheduleSettings: SharedScheduleSettings = scheduleSetting.data;
    const settings: CountdownSettings = countdownSetting.data;

    // eslint-disable-next-line react-hooks/exhaustive-deps
    const today = useMemo(() => getFamilyDayDateUTC(new Date(), scheduleSettings), [scheduleSettings, queueTick]);
    const todayKey = today.toISOString().slice(0, 10);

    const dayQuery = (db.useQuery as any)({
        familyMembers: { $: { order: { order: 'asc' } } },
        chores: {
            assignees: {},
            assignments: { familyMember: {} },
            routineSteps: {},
        },
        routines: { steps: { chore: {} } },
        choreCompletions: {
            $: { where: { dateDue: todayKey } },
            chore: {},
            completedBy: {},
        },
        // Today's rows, plus any run a closed device left running on an earlier day.
        countdownRuns: { $: { where: { or: [{ date: todayKey }, { status: 'running' }] } } },
        routineMarkerStatuses: {},
    }) as { isLoading: boolean; error?: { message?: string } | null; data?: any };

    const data = dayQuery.data;
    const familyMembers = useMemo(() => (data?.familyMembers as any[]) || [], [data?.familyMembers]);
    const allRuns = useMemo(
        () => ((data?.countdownRuns as any[]) || []) as Array<CountdownRunLike & { id: string }>,
        [data?.countdownRuns],
    );
    const routineMarkerStatuses = useMemo(() => (data?.routineMarkerStatuses as any[]) || [], [data?.routineMarkerStatuses]);
    const routines = useMemo(() => sortRoutines((data?.routines as SharedRoutineLike[]) || []), [data?.routines]);

    const chores = useMemo(() => {
        const completionsByChoreId = new Map<string, any[]>();
        for (const completion of (data?.choreCompletions as any[]) || []) {
            const choreId = firstLinked<any>(completion.chore)?.id;
            if (!choreId) continue;
            const list = completionsByChoreId.get(choreId) ?? [];
            list.push({ ...completion, completedBy: firstLinked(completion.completedBy) });
            completionsByChoreId.set(choreId, list);
        }
        return ((data?.chores as any[]) || []).map((chore) => ({
            ...chore,
            completions: completionsByChoreId.get(chore.id) ?? [],
        }));
    }, [data?.chores, data?.choreCompletions]);

    // --- The plan and each person's queue ---
    const engineInput: CountdownEngineInput | null = useMemo(() => {
        if (chores.length === 0) return null;
        return {
            chores: buildCountdownChoreInputs(chores, today),
            routineMarkerStatuses,
            allChoresRaw: chores,
            countdownSettings: settings,
            scheduleSettings,
            now: new Date(),
            date: today,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [chores, todayKey, routineMarkerStatuses, settings, scheduleSettings, queueTick]);

    const queues = useMemo(() => {
        const byMember = new Map<string, MemberQueues>();
        if (!engineInput) return byMember;
        try {
            const plan = computeCountdownTimelines(engineInput);
            // Steps folded into a routine are run from the routine, not from the day's queue.
            const foldedChoreIds = chores.filter(isChoreHiddenFromDayList).map((chore) => chore.id as string);
            for (const member of familyMembers) {
                const personId = member.id as string;
                const memberQueues: MemberQueues = {
                    day: buildRunnerQueue(engineInput, { personId, plan, excludeChoreIds: foldedChoreIds }),
                    routines: routines.flatMap((routine) => {
                        const queue = buildRunnerQueue(engineInput, { personId, plan, orderedChoreIds: getRoutineChoreIds(routine) });
                        if (queue.length === 0) return [];
                        return [{ id: routine.id, name: routine.name || 'Routine', onStepOverrun: getRoutineOverrunPolicy(routine), queue }];
                    }),
                };
                if (memberQueues.day.length > 0 || memberQueues.routines.length > 0) byMember.set(personId, memberQueues);
            }
        } catch (err) {
            console.error('Countdown engine error:', err);
        }
        return byMember;
    }, [engineInput, familyMembers, chores, routines]);

    const currentMemberId = currentUser?.id ?? null;
    const choreDescriptions = useMemo(
        () => new Map(chores.map((chore) => [chore.id as string, (chore.description as string) || null])),
        [chores],
    );

    const runners: MemberRunner[] = useMemo(
        () =>
            familyMembers.flatMap((member) => {
                const memberQueues = queues.get(member.id);
                if (!memberQueues) return [];
                const run = findCountdownRun(allRuns, member.id, todayKey);
                // A live run keeps to the routine it was started on; everything else reads the day's queue.
                const liveRoutine = isCountdownRunLive(run)
                    ? memberQueues.routines.find((routine) => routine.id === run!.routineId) ?? null
                    : null;
                const state = resolveRunnerState({
                    queue: liveRoutine?.queue ?? memberQueues.day,
                    run,
                    settings,
                    nowMs,
                    onStepOverrun: liveRoutine?.onStepOverrun ?? 'wait',
                });
                const stepOnScreen = state.liveStep ?? state.nextStep;
                return [
                    {
                        member: { id: member.id, name: member.name || 'Unknown', photoUrls: member.photoUrls },
                        run,
                        state,
                        activeRoutine: liveRoutine ? { id: liveRoutine.id, name: liveRoutine.name } : null,
                        routines: memberQueues.routines.map((routine) => ({
                            id: routine.id,
                            name: routine.name,
                            totalCount: routine.queue.length,
                            completedCount: routine.queue.filter((step) => step.completedAtMs != null).length,
                            nextStep: selectNextRunnerStep(routine.queue, nowMs),
                        })),
                        canControl: isParentMode || member.id === currentMemberId,
                        stepDescription: stepOnScreen ? choreDescriptions.get(stepOnScreen.choreId) ?? null : null,
                    },
                ];
            }),
        [familyMembers, queues, allRuns, todayKey, settings, nowMs, isParentMode, currentMemberId, choreDescriptions],
    );

    // Handlers and effects read the latest snapshot without being rebuilt every tick.
    const latest = useRef({ runners, chores, settings, todayKey, currentMemberId });
    latest.current = { runners, chores, settings, todayKey, currentMemberId };

    // When each run was last written from this device. A button press already
    // stamps the run, so the tap that carried it is not recorded a second time.
    const lastWriteMs = useRef(new Map<string, number>());

    const writeRun = useCallback(
        async (runId: string, patch: CountdownRunPatch, extraTransactions: any[] = []) => {
            lastWriteMs.current.set(runId, Date.now());
            try {
                await db.transact([...extraTransactions, tx.countdownRuns[runId].update(patch as any)]);
            } catch (err: any) {
                console.error('Failed to update the countdown run:', err);
                toast({
                    title: 'Countdown not saved',
                    description: err?.message || 'The change could not be saved. Check the connection and try again.',
                    variant: 'destructive',
                });
            }
        },
        [toast],
    );

    const findRunner = useCallback((memberId: string) => {
        const runner = latest.current.runners.find((entry) => entry.member.id === memberId);
        return runner?.canControl ? runner : null;
    }, []);

    const start = useCallback(
        (memberId: string, routineId?: string) => {
            const runner = findRunner(memberId);
            if (!runner || runner.state.phase === 'running') return;
            const step = routineId
                ? runner.routines.find((routine) => routine.id === routineId)?.nextStep
                : runner.state.nextStep;
            if (!step) return;
            const { todayKey: date } = latest.current;
            void writeRun(
                runner.run?.id ?? createCountdownRunId(memberId, date),
                buildRunStartPatch({
                    familyMemberId: memberId,
                    date,
                    routineId,
                    step,
                    nowMs: Date.now(),
                    existingRun: runner.run,
                }),
            );
        },
        [findRunner, writeRun],
    );

    const stopRun = useCallback(
        (memberId: string, reason: CountdownRunStoppedReason) => {
            const runner = findRunner(memberId);
            if (!runner?.run || runner.state.phase !== 'running') return;
            void writeRun(runner.run.id, buildRunStopPatch(reason, Date.now()));
        },
        [findRunner, writeRun],
    );

    const stop = useCallback((memberId: string) => stopRun(memberId, 'user'), [stopRun]);

    const extend = useCallback(
        (memberId: string) => {
            const runner = findRunner(memberId);
            const step = runner?.state.liveStep;
            if (!runner?.run || !step || step.durationSecs == null) return;
            void writeRun(runner.run.id, buildRunExtendPatch(runner.run, step, latest.current.settings, Date.now()));
        },
        [findRunner, writeRun],
    );

    const advance = useCallback(
        (memberId: string, options: { skipCurrent?: boolean } = {}) => {
            const runner = findRunner(memberId);
            if (!runner?.run || runner.state.phase !== 'running') return;
            void writeRun(runner.run.id, buildRunAdvancePatch(runner.run, runner.state.queue, Date.now(), options));
        },
        [findRunner, writeRun],
    );

    const markDone = useCallback(
        (memberId: string) => {
            const runner = findRunner(memberId);
            const step = runner?.state.liveStep;
            if (!runner?.run || !step) return;

            const { chores: currentChores, settings: currentSettings, todayKey: dateKey, currentMemberId: executorId } = latest.current;
            const chore = currentChores.find((entry) => entry.id === step.choreId);
            if (!chore) return;
            if (!executorId) {
                toast({ title: 'Login Required', description: 'Please log in to mark chores as complete.', variant: 'destructive' });
                return;
            }

            const nowMs = Date.now();
            const change = buildChoreCompletionChange({
                tx,
                createId: id,
                chore,
                familyMemberId: memberId,
                executorId,
                dateKey,
                intent: 'done',
                now: new Date(nowMs),
            });

            if (change.status === 'claimed') {
                const claimer = latest.current.runners.find((entry) => entry.member.id === change.claimedById);
                toast({
                    title: 'Already claimed',
                    description: `${chore.title} was already completed by ${claimer?.member.name || 'someone else'}.`,
                });
            }

            // The completion and the move to the next step land together, and the
            // next step's timer waits out the pause that celebrates this one.
            void writeRun(
                runner.run.id,
                buildRunAdvancePatch(runner.run, runner.state.queue, nowMs, {
                    settledChoreIds: [step.choreId],
                    startDelaySecs: change.status === 'completed' ? currentSettings.stackBufferSecs : 0,
                }),
                change.status === 'completed' ? change.transactions : [],
            );
        },
        [findRunner, toast, writeRun],
    );

    // --- Transitions nobody taps for ---
    // Each is keyed to the step it applies to, so a slow write is not repeated
    // on the next tick while the result is still on its way back.
    const automatic = useMemo(() => {
        const due: Array<{ key: string; apply: () => void }> = [];
        for (const runner of runners) {
            if (!runner.canControl || !runner.run || runner.state.phase !== 'running') continue;
            const { member, run, state } = runner;
            const stepKey = `${run.id}:${run.currentChoreId}:${run.stepStartedAt}`;
            if (state.needsAdvance) {
                due.push({ key: `${stepKey}:advance`, apply: () => advance(member.id) });
            } else if (state.overrun.timedOut) {
                due.push({ key: `${stepKey}:timeout`, apply: () => stopRun(member.id, 'timeout') });
            } else if (state.overrun.shouldAutoAdvance) {
                due.push({ key: `${stepKey}:skip`, apply: () => advance(member.id, { skipCurrent: true }) });
            }
        }
        // A run left running when its family day ended. A kid session can only sweep its own.
        for (const run of allRuns) {
            if (!isCountdownRunStale(run, todayKey)) continue;
            if (!isParentMode && run.familyMemberId !== currentMemberId) continue;
            due.push({
                key: `${run.id}:day_boundary`,
                apply: () => void writeRun(run.id, buildRunStopPatch('day_boundary', Date.now())),
            });
        }
        return due;
    }, [runners, allRuns, todayKey, isParentMode, currentMemberId, advance, stopRun, writeRun]);

    const automaticKey = automatic.map((entry) => entry.key).join('|');
    const handledAutomatic = useRef(new Set<string>());
    useEffect(() => {
        const dueKeys = new Set(automatic.map((entry) => entry.key));
        for (const key of Array.from(handledAutomatic.current)) {
            if (!dueKeys.has(key)) handledAutomatic.current.delete(key);
        }
        for (const entry of automatic) {
            if (handledAutomatic.current.has(entry.key)) continue;
            handledAutomatic.current.add(entry.key);
            entry.apply();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [automaticKey]);

    // --- Idleness belongs to the run, not the device ---
    // Any tap here counts as presence for every live run this session can write.
    // Listening for `click` rather than `pointerdown` lets a button's own handler
    // run first, so recording presence can never unmount the button being pressed.
    useEffect(() => {
        const recordInteraction = () => {
            const now = Date.now();
            for (const runner of latest.current.runners) {
                if (!runner.canControl || !runner.run) continue;
                if (now - (lastWriteMs.current.get(runner.run.id) ?? 0) < INTERACTION_WRITE_INTERVAL_MS) continue;
                if (!shouldRecordRunInteraction(runner.run, now, INTERACTION_WRITE_INTERVAL_MS)) continue;
                lastWriteMs.current.set(runner.run.id, now);
                db.transact(tx.countdownRuns[runner.run.id].update(buildRunTouchPatch(now) as any)).catch((err: unknown) =>
                    console.error('Failed to record countdown interaction:', err),
                );
            }
        };
        window.addEventListener('click', recordInteraction);
        window.addEventListener('keydown', recordInteraction);
        return () => {
            window.removeEventListener('click', recordInteraction);
            window.removeEventListener('keydown', recordInteraction);
        };
    }, []);

    const actions = useMemo(() => ({ start, markDone, extend, stop }), [start, markDone, extend, stop]);

    return {
        isLoading: scheduleSetting.isLoading || countdownSetting.isLoading || dayQuery.isLoading,
        error: scheduleSetting.error || countdownSetting.error || dayQuery.error || null,
        nowMs,
        runners,
        settings,
        currentMemberId,
        canManageRoutines: isParentMode,
        actions,
    };
}
