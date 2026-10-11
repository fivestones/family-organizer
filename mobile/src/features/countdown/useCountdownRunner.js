import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { id, tx } from '@instantdb/react-native';
import {
  COUNTDOWN_SETTINGS_NAME,
  HOUSEHOLD_SCHEDULE_SETTINGS_NAME,
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
  getFamilyDayDateUTC,
  getRoutineChoreIds,
  getRoutineOverrunPolicy,
  isChoreHiddenFromDayList,
  isCountdownRunLive,
  isCountdownRunStale,
  parseCountdownSettings,
  parseSharedScheduleSettings,
  resolveRunnerState,
  selectNextRunnerStep,
  shouldRecordRunInteraction,
  sortRoutines,
} from '@family-organizer/shared-core';
import { useAppSession } from '../../providers/AppProviders';
import { buildCountdownCompletion } from './completion';

/** How often the queue itself is rebuilt; the clock on top of it ticks every second. */
const QUEUE_REFRESH_MS = 30_000;
/** Taps arrive in bursts; one write a minute is enough to prove someone is there. */
const INTERACTION_WRITE_INTERVAL_MS = 60_000;

function firstLinked(value) {
  return (Array.isArray(value) ? value[0] : value) || null;
}

function useNowMs(intervalMs) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), intervalMs);
    // A backgrounded app stops ticking; catch up the moment it comes back.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNowMs(Date.now());
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [intervalMs]);
  return nowMs;
}

/**
 * The phone's countdown. It reads the same run rows and builds the same queues
 * as the web page, through the same shared-core runner, so a run started on
 * the wall tablet reads identically here.
 */
export function useCountdownRunner() {
  const { db, currentUser, familyMembers, isAuthenticated, instantReady, isParentMode } = useAppSession();
  const nowMs = useNowMs(1000);
  const queueTick = Math.floor(nowMs / QUEUE_REFRESH_MS);
  const canQuery = isAuthenticated && instantReady;

  const settingsQuery = db.useQuery(
    canQuery
      ? {
          settings: {
            $: { where: { or: [{ name: HOUSEHOLD_SCHEDULE_SETTINGS_NAME }, { name: COUNTDOWN_SETTINGS_NAME }] } },
          },
        }
      : null
  );

  const scheduleSettings = useMemo(() => {
    const row = (settingsQuery.data?.settings || []).find((entry) => entry.name === HOUSEHOLD_SCHEDULE_SETTINGS_NAME);
    return parseSharedScheduleSettings(row?.value || null);
  }, [settingsQuery.data?.settings]);
  const settings = useMemo(() => {
    const row = (settingsQuery.data?.settings || []).find((entry) => entry.name === COUNTDOWN_SETTINGS_NAME);
    return parseCountdownSettings(row?.value || null);
  }, [settingsQuery.data?.settings]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = useMemo(() => getFamilyDayDateUTC(new Date(), scheduleSettings), [scheduleSettings, queueTick]);
  const todayKey = today.toISOString().slice(0, 10);

  const dayQuery = db.useQuery(
    canQuery
      ? {
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
        }
      : null
  );

  const data = dayQuery.data;
  const allRuns = useMemo(() => data?.countdownRuns || [], [data?.countdownRuns]);
  const routineMarkerStatuses = useMemo(() => data?.routineMarkerStatuses || [], [data?.routineMarkerStatuses]);
  const routines = useMemo(() => sortRoutines(data?.routines || []), [data?.routines]);

  const chores = useMemo(() => {
    const completionsByChoreId = new Map();
    for (const completion of data?.choreCompletions || []) {
      const choreId = firstLinked(completion.chore)?.id;
      if (!choreId) continue;
      const list = completionsByChoreId.get(choreId) || [];
      list.push({ ...completion, completedBy: firstLinked(completion.completedBy) });
      completionsByChoreId.set(choreId, list);
    }
    return (data?.chores || []).map((chore) => ({
      ...chore,
      completions: completionsByChoreId.get(chore.id) || [],
    }));
  }, [data?.chores, data?.choreCompletions]);

  // --- The plan and each person's queues ---
  const engineInput = useMemo(() => {
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
    const byMember = new Map();
    if (!engineInput) return byMember;
    try {
      const plan = computeCountdownTimelines(engineInput);
      // Steps folded into a routine are run from the routine, not from the day's queue.
      const foldedChoreIds = chores.filter(isChoreHiddenFromDayList).map((chore) => chore.id);
      for (const member of familyMembers) {
        const memberQueues = {
          day: buildRunnerQueue(engineInput, { personId: member.id, plan, excludeChoreIds: foldedChoreIds }),
          routines: routines.flatMap((routine) => {
            const queue = buildRunnerQueue(engineInput, {
              personId: member.id,
              plan,
              orderedChoreIds: getRoutineChoreIds(routine),
            });
            if (queue.length === 0) return [];
            return [
              { id: routine.id, name: routine.name || 'Routine', onStepOverrun: getRoutineOverrunPolicy(routine), queue },
            ];
          }),
        };
        if (memberQueues.day.length > 0 || memberQueues.routines.length > 0) byMember.set(member.id, memberQueues);
      }
    } catch (error) {
      console.warn('[countdown] engine error', error);
    }
    return byMember;
  }, [engineInput, familyMembers, chores, routines]);

  const currentMemberId = currentUser?.id || null;
  const choreDescriptions = useMemo(() => new Map(chores.map((chore) => [chore.id, chore.description || null])), [chores]);

  const runners = useMemo(
    () =>
      familyMembers.flatMap((member) => {
        const memberQueues = queues.get(member.id);
        if (!memberQueues) return [];
        const run = findCountdownRun(allRuns, member.id, todayKey);
        // A live run keeps to the routine it was started on; everything else reads the day's queue.
        const liveRoutine = isCountdownRunLive(run)
          ? memberQueues.routines.find((routine) => routine.id === run.routineId) || null
          : null;
        const state = resolveRunnerState({
          queue: liveRoutine?.queue || memberQueues.day,
          run,
          settings,
          nowMs,
          onStepOverrun: liveRoutine?.onStepOverrun || 'wait',
        });
        const stepOnScreen = state.liveStep || state.nextStep;
        return [
          {
            member,
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
            stepDescription: stepOnScreen ? choreDescriptions.get(stepOnScreen.choreId) || null : null,
          },
        ];
      }),
    [familyMembers, queues, allRuns, todayKey, settings, nowMs, isParentMode, currentMemberId, choreDescriptions]
  );

  // Handlers and effects read the latest snapshot without being rebuilt every tick.
  const latest = useRef({ runners, chores, settings, todayKey, currentMemberId });
  latest.current = { runners, chores, settings, todayKey, currentMemberId };

  // When each run was last written from this device. A button press already
  // stamps the run, so the tap that carried it is not recorded a second time.
  const lastWriteMs = useRef(new Map());

  const writeRun = useCallback(
    async (runId, patch, extraTransactions = []) => {
      lastWriteMs.current.set(runId, Date.now());
      try {
        await db.transact([...extraTransactions, tx.countdownRuns[runId].update(patch)]);
      } catch (error) {
        Alert.alert('Countdown not saved', error?.message || 'Check the connection and try again.');
      }
    },
    [db]
  );

  const findRunner = useCallback((memberId) => {
    const runner = latest.current.runners.find((entry) => entry.member.id === memberId);
    return runner?.canControl ? runner : null;
  }, []);

  const start = useCallback(
    (memberId, routineId) => {
      const runner = findRunner(memberId);
      if (!runner || runner.state.phase === 'running') return;
      const step = routineId
        ? runner.routines.find((routine) => routine.id === routineId)?.nextStep
        : runner.state.nextStep;
      if (!step) return;
      const date = latest.current.todayKey;
      void writeRun(
        runner.run?.id || createCountdownRunId(memberId, date),
        buildRunStartPatch({ familyMemberId: memberId, date, routineId, step, nowMs: Date.now(), existingRun: runner.run })
      );
    },
    [findRunner, writeRun]
  );

  const stopRun = useCallback(
    (memberId, reason) => {
      const runner = findRunner(memberId);
      if (!runner?.run || runner.state.phase !== 'running') return;
      void writeRun(runner.run.id, buildRunStopPatch(reason, Date.now()));
    },
    [findRunner, writeRun]
  );

  const stop = useCallback((memberId) => stopRun(memberId, 'user'), [stopRun]);

  const extend = useCallback(
    (memberId) => {
      const runner = findRunner(memberId);
      const step = runner?.state.liveStep;
      if (!runner?.run || !step || step.durationSecs == null) return;
      void writeRun(runner.run.id, buildRunExtendPatch(runner.run, step, latest.current.settings, Date.now()));
    },
    [findRunner, writeRun]
  );

  const advance = useCallback(
    (memberId, options = {}) => {
      const runner = findRunner(memberId);
      if (!runner?.run || runner.state.phase !== 'running') return;
      void writeRun(runner.run.id, buildRunAdvancePatch(runner.run, runner.state.queue, Date.now(), options));
    },
    [findRunner, writeRun]
  );

  const markDone = useCallback(
    (memberId) => {
      const runner = findRunner(memberId);
      const step = runner?.state.liveStep;
      if (!runner?.run || !step) return;

      const snapshot = latest.current;
      const chore = snapshot.chores.find((entry) => entry.id === step.choreId);
      if (!chore) return;
      if (!snapshot.currentMemberId) {
        Alert.alert('Login required', 'Choose a family member before marking chores complete.');
        return;
      }

      const now = Date.now();
      const change = buildCountdownCompletion({
        tx,
        createId: id,
        chore,
        familyMemberId: memberId,
        executorId: snapshot.currentMemberId,
        dateKey: snapshot.todayKey,
        now: new Date(now),
      });

      if (change.status === 'claimed') {
        const claimer = snapshot.runners.find((entry) => entry.member.id === change.claimedById);
        Alert.alert('Already claimed', `${chore.title} was already completed by ${claimer?.member.name || 'someone else'}.`);
      }

      // The completion and the move to the next step land together, and the
      // next step's timer waits out the pause that celebrates this one.
      const completed = change.status === 'completed';
      void writeRun(
        runner.run.id,
        buildRunAdvancePatch(runner.run, runner.state.queue, now, {
          settledChoreIds: [step.choreId],
          startDelaySecs: completed ? snapshot.settings.stackBufferSecs : 0,
        }),
        completed ? change.transactions : []
      );
    },
    [findRunner, writeRun]
  );

  // --- Transitions nobody taps for ---
  // Each is keyed to the step it applies to, so a slow write is not repeated
  // on the next tick while the result is still on its way back.
  const automatic = useMemo(() => {
    const due = [];
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
  const handledAutomatic = useRef(new Set());
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
  // Any touch on the countdown screen counts as presence for every live run
  // this session can write.
  const recordInteraction = useCallback(() => {
    const now = Date.now();
    for (const runner of latest.current.runners) {
      if (!runner.canControl || !runner.run) continue;
      if (now - (lastWriteMs.current.get(runner.run.id) || 0) < INTERACTION_WRITE_INTERVAL_MS) continue;
      if (!shouldRecordRunInteraction(runner.run, now, INTERACTION_WRITE_INTERVAL_MS)) continue;
      lastWriteMs.current.set(runner.run.id, now);
      db.transact(tx.countdownRuns[runner.run.id].update(buildRunTouchPatch(now))).catch((error) => {
        console.warn('[countdown] failed to record interaction', error);
      });
    }
  }, [db]);

  const actions = useMemo(() => ({ start, markDone, extend, stop }), [start, markDone, extend, stop]);

  return {
    isLoading: !canQuery || settingsQuery.isLoading || dayQuery.isLoading,
    error: settingsQuery.error || dayQuery.error || null,
    nowMs,
    runners,
    settings,
    currentMemberId,
    actions,
    recordInteraction,
  };
}
