import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import {
  describeForecast,
  describeGate,
  describeLastStop,
  describePace,
  describeRunnerPanel,
  describeSchedule,
  formatCountdown,
  formatSpan,
} from '@family-organizer/shared-core';
import { AvatarPhotoImage } from '../src/components/AvatarPhotoImage';
import { CountdownRing } from '../src/features/countdown/CountdownRing';
import { useCountdownRunner } from '../src/features/countdown/useCountdownRunner';
import { useAppTheme } from '../src/theme/ThemeProvider';
import { radii, spacing, withAlpha } from '../src/theme/tokens';

function createInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() || '').join('');
}

/** The screen's own field. It deepens to red past zero and to green on a finish. */
function getFieldColor(mode, ringState, colors) {
  if (mode === 'overrun' || ringState === 'overdue') return '#4A1220';
  if (mode === 'celebrating' || mode === 'done') return '#0C3D2E';
  if (mode === 'running' || mode === 'untimed' || mode === 'due') return colors.canvas;
  return colors.canvasStrong;
}

function getRingColor(ringState, colors) {
  if (ringState === 'overdue') return colors.danger;
  if (ringState === 'celebrating') return colors.success;
  return colors.canvasText;
}

const CALM_ICONS = {
  done: 'sparkles',
  waiting: 'hourglass-outline',
  untimed: 'hand-left-outline',
  ready: 'play',
  routines: 'list',
};

export default function CountdownScreen() {
  const { colors } = useAppTheme();
  const { width, height } = useWindowDimensions();
  const { isLoading, error, nowMs, runners, settings, currentMemberId, actions, recordInteraction } = useCountdownRunner();
  const [chosenMemberId, setChosenMemberId] = useState(null);

  // Whoever is signed in sees their own countdown first.
  const runner =
    runners.find((entry) => entry.member.id === chosenMemberId) ||
    runners.find((entry) => entry.member.id === currentMemberId) ||
    runners[0] ||
    null;

  const view = runner ? describeRunnerPanel(runner.state, nowMs) : null;
  const mode = view?.mode || 'ready';
  const field = getFieldColor(mode, view?.ring?.state, colors);
  const styles = useMemo(() => createStyles(colors, field), [colors, field]);

  const header = (
    <View style={styles.topBar}>
      <Pressable
        testID="countdown-back-button"
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        style={styles.roundButton}
      >
        <Ionicons name="chevron-back" size={20} color={colors.canvasText} />
      </Pressable>
      <Text style={styles.topBarTitle}>Countdown</Text>
      <View style={styles.roundButtonSpacer} />
    </View>
  );

  if (!runner || !view) {
    return (
      <SafeAreaView style={styles.safeArea}>
        {header}
        <View style={styles.notice}>
          {isLoading ? (
            <ActivityIndicator size="large" color={colors.canvasText} />
          ) : (
            <>
              <Ionicons name="timer-outline" size={56} color={withAlpha(colors.canvasText, 0.35)} />
              <Text style={styles.noticeTitle}>{error ? 'The countdown could not load' : 'Nothing to count down today'}</Text>
              <Text style={styles.noticeBody}>
                {error?.message || 'Chores that are due today show up here, ready to start whenever you are.'}
              </Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const { member, state, run, canControl } = runner;
  const { step } = view;
  const isLive = state.phase === 'running';
  const pace = describePace(state);
  const forecast = describeForecast(state);
  const lastStopNote = isLive ? null : describeLastStop(run);
  const upNext = isLive ? state.nextStep : null;
  const extensionLabel = `+${formatSpan(settings.stepExtensionSecs)}`;

  const ringSize = Math.min(width - 72, height * 0.4, 340);
  const digits = formatCountdown(view.readoutMs ?? 0);
  // Long readouts (an hour or more) shrink so they stay inside the ring.
  const digitSize = ringSize * (digits.sub ? 0.19 : digits.main.length > 4 ? 0.22 : 0.27);

  const prompt = isLive ? state.overrun : null;
  const promptOpen = !!prompt && prompt.prompt !== 'none' && !!step;
  const stopsInMs =
    prompt?.promptSinceMs != null ? prompt.promptSinceMs + settings.overrunPromptGraceSecs * 1000 - nowMs : 0;

  // Everything on this person's plate may live inside routines, leaving the day's own queue empty.
  const onlyRoutines = mode === 'done' && state.totalCount === 0 && runner.routines.length > 0;
  const routinesLeft = runner.routines.some((routine) => routine.completedCount < routine.totalCount);
  const calmIcon = onlyRoutines && routinesLeft ? CALM_ICONS.routines : CALM_ICONS[mode] || CALM_ICONS.ready;
  const calmEyebrow = onlyRoutines
    ? 'Routines'
    : mode === 'done'
    ? 'All done'
    : mode === 'waiting'
    ? 'Nothing open right now'
    : mode === 'untimed'
    ? 'No timer'
    : 'Up next';
  const calmTitle = onlyRoutines
    ? routinesLeft
      ? 'Pick a routine to start'
      : 'Every routine is finished'
    : mode === 'done'
    ? state.totalCount > 0
      ? 'Everything is finished'
      : 'Nothing on the plate today'
    : mode === 'waiting'
    ? 'The rest unlocks later'
    : step?.title || '';
  const calmDetail =
    mode === 'done' && state.totalCount > 0
      ? `${state.completedCount} of ${state.totalCount} done today.`
      : mode === 'untimed'
      ? runner.stepDescription || 'Tap Done when you are finished.'
      : mode === 'ready'
      ? runner.stepDescription
      : null;
  const facts =
    mode === 'ready' && step
      ? [step.durationSecs != null ? `Takes ${formatSpan(step.durationSecs)}` : 'No timer', describeSchedule(step, nowMs)].filter(Boolean)
      : [];

  function handleDone() {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    actions.markDone(member.id);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      {/* Any touch here is presence for the run: idleness belongs to the run, not the device. */}
      <View
        style={styles.root}
        onStartShouldSetResponderCapture={() => {
          recordInteraction();
          return false;
        }}
      >
        {header}

        {runners.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memberRow} style={styles.memberScroller}>
            {runners.map((entry) => {
              const selected = entry.member.id === member.id;
              return (
                <Pressable
                  key={entry.member.id}
                  testID={`countdown-member-${entry.member.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Show ${entry.member.name}'s countdown`}
                  onPress={() => setChosenMemberId(entry.member.id)}
                  style={[styles.memberChip, selected && styles.memberChipSelected]}
                >
                  <AvatarPhotoImage
                    photoUrls={entry.member.photoUrls}
                    preferredSize="64"
                    style={styles.memberAvatar}
                    fallback={
                      <View style={styles.memberAvatarFallback}>
                        <Text style={styles.memberAvatarFallbackText}>{createInitials(entry.member.name)}</Text>
                      </View>
                    }
                  />
                  <Text style={[styles.memberChipText, selected && styles.memberChipTextSelected]} numberOfLines={1}>
                    {entry.member.name}
                  </Text>
                  {entry.state.phase === 'running' ? <View style={styles.liveDot} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        ) : null}

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* ---- Stage ---- */}
          {view.ring && step ? (
            <CountdownRing
              size={ringSize}
              thickness={Math.max(10, ringSize * 0.05)}
              progress={view.ring.progress}
              color={getRingColor(view.ring.state, colors)}
              trackColor={withAlpha(colors.canvasText, 0.14)}
              backgroundColor={field}
            >
              {view.readoutLabel ? <Text style={styles.ringLabel}>{view.readoutLabel}</Text> : null}
              {mode === 'celebrating' ? (
                <Ionicons name="checkmark" size={ringSize * 0.3} color={colors.canvasText} />
              ) : (
                <View
                  style={styles.digitRow}
                  accessible
                  accessibilityRole="timer"
                  accessibilityLabel={`${digits.sign}${digits.main}${digits.sub ? `:${digits.sub}` : ''}`}
                >
                  {digits.sign ? <Text style={[styles.digitSign, { fontSize: digitSize * 0.5 }]}>{digits.sign}</Text> : null}
                  <Text style={[styles.digits, { fontSize: digitSize }]}>{digits.main}</Text>
                  {digits.sub ? <Text style={[styles.digitSub, { fontSize: digitSize * 0.5 }]}>{digits.sub}</Text> : null}
                </View>
              )}
              <Text style={[styles.ringTitle, { maxWidth: ringSize * 0.66 }]} numberOfLines={2}>
                {step.title}
              </Text>
            </CountdownRing>
          ) : (
            <View style={styles.calmStage}>
              <View style={styles.calmIcon}>
                <Ionicons name={calmIcon} size={40} color={colors.canvasText} />
              </View>
              <Text style={styles.eyebrow}>{calmEyebrow}</Text>
              <Text style={styles.calmTitle}>{calmTitle}</Text>
              {calmDetail ? (
                <Text style={styles.calmDetail} numberOfLines={3}>
                  {calmDetail}
                </Text>
              ) : null}
              {facts.length > 0 ? (
                <View style={styles.factRow}>
                  {facts.map((fact) => (
                    <View key={fact} style={styles.pill}>
                      <Text style={styles.pillText}>{fact}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          )}

          {view.ring && runner.stepDescription && mode !== 'celebrating' ? (
            <Text style={styles.stepDescription} numberOfLines={2}>
              {runner.stepDescription}
            </Text>
          ) : null}

          {/* ---- Readouts ---- */}
          {runner.activeRoutine ? (
            <View style={styles.pill}>
              <Ionicons name="list" size={13} color={colors.canvasText} />
              <Text style={styles.pillText}>{runner.activeRoutine.name}</Text>
            </View>
          ) : null}

          {state.totalCount > 0 ? (
            state.totalCount > 12 ? (
              <Text style={styles.mutedText}>
                {state.completedCount} of {state.totalCount} done
              </Text>
            ) : (
              <View style={styles.dotRow} accessible accessibilityLabel={`${state.completedCount} of ${state.totalCount} done`}>
                {state.queue.map((entry) => (
                  <View
                    key={entry.choreId}
                    style={[
                      styles.dot,
                      entry.completedAtMs != null && styles.dotDone,
                      entry.choreId === state.liveStep?.choreId && styles.dotLive,
                    ]}
                  />
                ))}
              </View>
            )
          ) : null}

          {pace ? (
            <View
              style={[
                styles.pill,
                pace.tone === 'ahead' && { backgroundColor: withAlpha(colors.success, 0.24) },
                pace.tone === 'behind' && { backgroundColor: withAlpha(colors.danger, 0.3) },
              ]}
            >
              <Ionicons
                name={pace.tone === 'ahead' ? 'trending-up' : pace.tone === 'behind' ? 'trending-down' : 'remove'}
                size={14}
                color={colors.canvasText}
              />
              <Text style={styles.pillText}>{pace.label}</Text>
            </View>
          ) : null}

          {forecast ? (
            <Text style={[styles.forecast, forecast.tone === 'miss' && styles.forecastMiss]}>
              {forecast.tone === 'miss' ? '⚠︎ ' : ''}
              {forecast.label}
            </Text>
          ) : null}

          {upNext ? (
            <Text style={styles.mutedText} numberOfLines={1}>
              Next: <Text style={styles.nextTitle}>{upNext.title}</Text>
            </Text>
          ) : null}

          {lastStopNote ? <Text style={styles.mutedText}>{lastStopNote}</Text> : null}

          {/* ---- Actions ---- */}
          {canControl ? (
            <View style={styles.actions}>
              {mode === 'ready' || mode === 'due' ? (
                <Pressable
                  testID="countdown-start-button"
                  accessibilityRole="button"
                  accessibilityLabel="Start"
                  onPress={() => actions.start(member.id)}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                >
                  <Ionicons name="play" size={18} color={field} />
                  <Text style={styles.primaryButtonText}>Start</Text>
                </Pressable>
              ) : null}

              {isLive && step ? (
                <>
                  <Pressable
                    testID="countdown-done-button"
                    accessibilityRole="button"
                    accessibilityLabel="Done"
                    disabled={mode === 'celebrating'}
                    onPress={handleDone}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      mode === 'celebrating' && { backgroundColor: colors.success },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name="checkmark" size={20} color={mode === 'celebrating' ? colors.onAccent : field} />
                    <Text style={[styles.primaryButtonText, mode === 'celebrating' && { color: colors.onAccent }]}>
                      {mode === 'celebrating' ? 'Nice work!' : 'Done'}
                    </Text>
                  </Pressable>
                  <View style={styles.secondaryRow}>
                    {step.durationSecs != null && mode !== 'celebrating' ? (
                      <Pressable
                        testID="countdown-extend-button"
                        accessibilityRole="button"
                        accessibilityLabel={`Add ${formatSpan(settings.stepExtensionSecs)} to this step`}
                        onPress={() => actions.extend(member.id)}
                        style={({ pressed }) => [styles.secondaryButton, styles.secondaryButtonFilled, pressed && styles.pressed]}
                      >
                        <Ionicons name="alarm-outline" size={16} color={colors.canvasText} />
                        <Text style={styles.secondaryButtonText}>{extensionLabel}</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      testID="countdown-stop-button"
                      accessibilityRole="button"
                      accessibilityLabel="Stop"
                      onPress={() => actions.stop(member.id)}
                      style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                    >
                      <Ionicons name="stop" size={14} color={colors.canvasTextMuted} />
                      <Text style={[styles.secondaryButtonText, { color: colors.canvasTextMuted }]}>Stop</Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
            </View>
          ) : mode !== 'done' ? (
            <Text style={styles.readOnlyNote}>
              Only {member.name} or a parent can {isLive ? 'control' : 'start'} this countdown.
            </Text>
          ) : null}

          {/* ---- Routines ---- */}
          {!isLive && runner.routines.length > 0 ? (
            <View style={styles.list}>
              <Text style={styles.listHeading}>Routines</Text>
              {runner.routines.map((routine) => {
                const finished = routine.completedCount === routine.totalCount;
                const startable = canControl && !!routine.nextStep;
                return (
                  <Pressable
                    key={routine.id}
                    testID={`countdown-routine-${routine.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Start ${routine.name}`}
                    disabled={!startable}
                    onPress={() => actions.start(member.id, routine.id)}
                    style={({ pressed }) => [styles.listRow, !startable && styles.listRowDisabled, pressed && styles.pressed]}
                  >
                    <Ionicons name="list" size={16} color={colors.canvasTextMuted} />
                    <Text style={styles.listRowTitle} numberOfLines={1}>
                      {routine.name}
                    </Text>
                    <Text style={styles.listRowMeta}>
                      {routine.completedCount}/{routine.totalCount}
                    </Text>
                    <Ionicons
                      name={finished ? 'checkmark' : startable ? 'play' : 'lock-closed'}
                      size={15}
                      color={finished ? colors.success : colors.canvasText}
                    />
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* ---- Gated steps ---- */}
          {state.lockedSteps.length > 0 ? (
            <View style={styles.list}>
              <Text style={styles.listHeading}>Later</Text>
              {state.lockedSteps.slice(0, 5).map((entry) => (
                <View key={entry.choreId} style={styles.listRow}>
                  <Ionicons name="lock-closed" size={15} color={colors.canvasTextMuted} />
                  <Text style={styles.listRowTitle} numberOfLines={1}>
                    {entry.title}
                  </Text>
                  <Text style={styles.listRowMeta} numberOfLines={1}>
                    {describeGate(entry)}
                  </Text>
                </View>
              ))}
              {state.lockedSteps.length > 5 ? (
                <Text style={styles.mutedText}>and {state.lockedSteps.length - 5} more</Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </View>

      {/* ---- "Are you still there?" ---- */}
      <Modal visible={promptOpen} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.promptOverlay}>
          <View style={styles.promptCard}>
            <View style={styles.promptIcon}>
              <Ionicons name="hand-left" size={24} color={colors.warning} />
            </View>
            <Text style={styles.promptTitle}>
              {prompt?.prompt === 'still_working_or_stop'
                ? 'Still working on this, or should I stop the run?'
                : `Still working on ${step?.title || 'this'}?`}
            </Text>
            <Text style={styles.promptBody}>
              {stopsInMs > 0
                ? `This run stops by itself in ${formatSpan(Math.ceil(stopsInMs / 1000))}.`
                : 'This run is about to stop by itself.'}
            </Text>
            {canControl ? (
              <>
                <Pressable
                  testID="countdown-prompt-extend-button"
                  accessibilityRole="button"
                  onPress={() => actions.extend(member.id)}
                  style={({ pressed }) => [styles.promptPrimary, pressed && styles.pressed]}
                >
                  <Text style={styles.promptPrimaryText}>
                    {prompt?.prompt === 'still_working_or_stop'
                      ? `Keep going (${extensionLabel})`
                      : `Yes, ${formatSpan(settings.stepExtensionSecs)} more`}
                  </Text>
                </Pressable>
                {prompt?.prompt === 'still_working_or_stop' ? (
                  <Pressable
                    testID="countdown-prompt-stop-button"
                    accessibilityRole="button"
                    onPress={() => actions.stop(member.id)}
                    style={({ pressed }) => [styles.promptSecondary, pressed && styles.pressed]}
                  >
                    <Text style={styles.promptSecondaryText}>Stop the run</Text>
                  </Pressable>
                ) : null}
              </>
            ) : (
              <Text style={styles.promptBody}>Waiting for {member.name} to answer.</Text>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const createStyles = (colors, field) =>
  StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: field,
    },
    root: {
      flex: 1,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
    },
    topBarTitle: {
      color: colors.canvasText,
      fontSize: 16,
      fontWeight: '800',
      letterSpacing: 0.2,
    },
    roundButton: {
      width: 40,
      height: 40,
      borderRadius: radii.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.canvasText, 0.12),
    },
    roundButtonSpacer: {
      width: 40,
    },
    notice: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.xl,
    },
    noticeTitle: {
      color: colors.canvasText,
      fontSize: 20,
      fontWeight: '800',
      textAlign: 'center',
    },
    noticeBody: {
      color: colors.canvasTextMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    memberScroller: {
      flexGrow: 0,
    },
    memberRow: {
      paddingHorizontal: spacing.md,
      gap: spacing.xs,
    },
    memberChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      paddingVertical: 5,
      paddingLeft: 5,
      paddingRight: spacing.md,
      borderRadius: radii.pill,
      backgroundColor: withAlpha(colors.canvasText, 0.08),
    },
    memberChipSelected: {
      backgroundColor: withAlpha(colors.canvasText, 0.24),
    },
    memberAvatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
    },
    memberAvatarFallback: {
      width: 26,
      height: 26,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.canvasText, 0.2),
    },
    memberAvatarFallbackText: {
      color: colors.canvasText,
      fontSize: 10,
      fontWeight: '800',
    },
    memberChipText: {
      color: colors.canvasTextMuted,
      fontSize: 14,
      fontWeight: '600',
      maxWidth: 120,
    },
    memberChipTextSelected: {
      color: colors.canvasText,
    },
    liveDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.success,
    },
    content: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    ringLabel: {
      color: colors.canvasTextMuted,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.6,
      textTransform: 'uppercase',
      marginBottom: 2,
    },
    digitRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    digits: {
      color: colors.canvasText,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    digitSign: {
      color: withAlpha(colors.canvasText, 0.8),
      fontWeight: '800',
    },
    digitSub: {
      color: withAlpha(colors.canvasText, 0.5),
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      marginLeft: 3,
    },
    ringTitle: {
      color: withAlpha(colors.canvasText, 0.9),
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'center',
      marginTop: 4,
    },
    stepDescription: {
      color: colors.canvasTextMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
      maxWidth: 320,
    },
    calmStage: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xl,
    },
    calmIcon: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
      backgroundColor: withAlpha(colors.canvasText, 0.14),
      borderWidth: 1,
      borderColor: withAlpha(colors.canvasText, 0.2),
    },
    eyebrow: {
      color: colors.canvasTextMuted,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.8,
      textTransform: 'uppercase',
    },
    calmTitle: {
      color: colors.canvasText,
      fontSize: 30,
      lineHeight: 36,
      fontWeight: '800',
      textAlign: 'center',
    },
    calmDetail: {
      color: colors.canvasTextMuted,
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      maxWidth: 320,
    },
    factRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: spacing.xs,
      marginTop: spacing.xs,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
      borderRadius: radii.pill,
      backgroundColor: withAlpha(colors.canvasText, 0.14),
    },
    pillText: {
      color: colors.canvasText,
      fontSize: 12,
      fontWeight: '700',
    },
    dotRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: withAlpha(colors.canvasText, 0.3),
    },
    dotDone: {
      backgroundColor: withAlpha(colors.canvasText, 0.9),
    },
    dotLive: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.canvasText,
    },
    mutedText: {
      color: colors.canvasTextMuted,
      fontSize: 13,
      textAlign: 'center',
    },
    nextTitle: {
      color: colors.canvasText,
      fontWeight: '700',
    },
    forecast: {
      color: colors.canvasTextMuted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
      maxWidth: 320,
    },
    forecastMiss: {
      color: colors.warning,
      fontWeight: '700',
    },
    actions: {
      alignSelf: 'stretch',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      minHeight: 58,
      borderRadius: radii.md,
      backgroundColor: colors.canvasText,
    },
    primaryButtonText: {
      color: field,
      fontSize: 17,
      fontWeight: '800',
    },
    secondaryRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    secondaryButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      minHeight: 48,
      borderRadius: radii.md,
    },
    secondaryButtonFilled: {
      backgroundColor: withAlpha(colors.canvasText, 0.14),
    },
    secondaryButtonText: {
      color: colors.canvasText,
      fontSize: 14,
      fontWeight: '700',
    },
    pressed: {
      opacity: 0.75,
    },
    readOnlyNote: {
      color: colors.canvasTextMuted,
      fontSize: 13,
      textAlign: 'center',
      maxWidth: 280,
    },
    list: {
      alignSelf: 'stretch',
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
    listHeading: {
      color: withAlpha(colors.canvasText, 0.5),
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.8,
      textTransform: 'uppercase',
      textAlign: 'center',
      marginBottom: 2,
    },
    listRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      minHeight: 48,
      borderRadius: radii.md,
      backgroundColor: withAlpha(colors.canvasText, 0.1),
    },
    listRowDisabled: {
      opacity: 0.7,
    },
    listRowTitle: {
      flex: 1,
      color: colors.canvasText,
      fontSize: 14,
      fontWeight: '700',
    },
    listRowMeta: {
      color: colors.canvasTextMuted,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
      maxWidth: 170,
    },
    promptOverlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.xl,
      backgroundColor: 'rgba(4, 8, 22, 0.66)',
    },
    promptCard: {
      alignSelf: 'stretch',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.xl,
      borderRadius: radii.lg,
      backgroundColor: colors.panel,
    },
    promptIcon: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: withAlpha(colors.warning, 0.16),
    },
    promptTitle: {
      color: colors.ink,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: '800',
      textAlign: 'center',
    },
    promptBody: {
      color: colors.inkMuted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: 'center',
    },
    promptPrimary: {
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 54,
      marginTop: spacing.sm,
      borderRadius: radii.md,
      backgroundColor: colors.ink,
    },
    promptPrimaryText: {
      color: colors.panel,
      fontSize: 16,
      fontWeight: '800',
    },
    promptSecondary: {
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 50,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.line,
    },
    promptSecondaryText: {
      color: colors.ink,
      fontSize: 15,
      fontWeight: '700',
    },
  });
