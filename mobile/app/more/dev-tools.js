import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAppSession } from '../../src/providers/AppProviders';
import { radii, spacing } from '../../src/theme/tokens';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { ParentAccessNotice, SubscreenScaffold } from '../../src/components/SubscreenScaffold';
import { clearDiagnosticsTimeline, formatDiagnosticDetails, getDiagnosticsTimeline, subscribeDiagnosticsTimeline } from '../../src/lib/diagnostics';
import { clearPendingParentAction } from '../../src/lib/session-prefs';
import { useParentActionGate } from '../../src/hooks/useParentActionGate';

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default function DevToolsScreen() {
  const searchParams = useLocalSearchParams();
  const { requireParentAction } = useParentActionGate();
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const [diagnostics, setDiagnostics] = useState(() => getDiagnosticsTimeline());
  const {
    currentUser,
    principalType,
    bootstrapStatus,
    canRenderCachedData,
    connectionStatus,
    networkValidated,
    deviceSessionToken,
    activationRequired,
    isOnline,
    isParentSessionSharedDevice,
    parentSharedDeviceIdleTimeoutMs,
  } = useAppSession();

  useEffect(() => {
    if (firstParam(searchParams.resumeParentAction) !== '1') return;
    if (principalType !== 'parent') return;
    void clearPendingParentAction();
  }, [principalType, searchParams.resumeParentAction]);

  useEffect(() => subscribeDiagnosticsTimeline(setDiagnostics), []);

  const recentDiagnostics = useMemo(
    () => diagnostics.slice().reverse().slice(0, 60),
    [diagnostics]
  );

  async function handoffToParent() {
    await requireParentAction({
      actionId: 'more:open:devTools',
      actionLabel: 'Dev Tools',
      payload: { href: '/more/dev-tools' },
      returnPath: '/more/dev-tools',
    });
  }

  if (principalType !== 'parent') {
    return (
      <SubscreenScaffold
        title="Dev Tools"
        subtitle="Debug tooling is parent-gated on shared devices."
        accent={colors.accentMore}
        statusChips={[
          { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
          { label: principalType === 'parent' ? 'Parent mode' : 'Kid mode', tone: 'neutral' },
        ]}
      >
        <ParentAccessNotice
          body="Log in as a parent to inspect current mobile session state and debug metadata."
          onContinue={handoffToParent}
        />
      </SubscreenScaffold>
    );
  }

  return (
    <SubscreenScaffold
      title="Dev Tools"
      subtitle="Live debug snapshot for simulator sessions, shared-device mode, and Instant principal status."
      accent={colors.accentMore}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        { label: principalType === 'parent' ? 'Parent mode' : 'Kid mode', tone: 'accent' },
      ]}
    >
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Session Snapshot</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Current member</Text>
          <Text style={styles.value}>{currentUser?.name || 'None'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Activation required</Text>
          <Text style={styles.value}>{activationRequired ? 'Yes' : 'No'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Device session</Text>
          <Text style={styles.value}>{deviceSessionToken ? 'Present' : 'Missing'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Bootstrap</Text>
          <Text style={styles.value}>{bootstrapStatus}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Local cache</Text>
          <Text style={styles.value}>{canRenderCachedData ? 'Renderable' : 'Waiting'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Network validation</Text>
          <Text style={styles.value}>{networkValidated ? 'Validated' : 'Pending'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Connection</Text>
          <Text style={styles.value}>{connectionStatus}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Shared device mode</Text>
          <Text style={styles.value}>{isParentSessionSharedDevice ? 'Enabled' : 'Disabled'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Idle timeout</Text>
          <Text style={styles.value}>{Math.round(parentSharedDeviceIdleTimeoutMs / 60000)} min</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.timelineHeader}>
          <Text style={styles.panelTitle}>Diagnostics Timeline</Text>
          <Text style={styles.timelineCount}>{diagnostics.length} events</Text>
        </View>
        <View style={styles.actionRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share diagnostics timeline"
            style={styles.actionButton}
            onPress={() =>
              Share.share({
                message: JSON.stringify(diagnostics, null, 2),
                title: 'Family Organizer diagnostics',
              })
            }
          >
            <Text style={styles.actionText}>Share JSON</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear diagnostics timeline"
            style={styles.actionButton}
            onPress={() => {
              clearDiagnosticsTimeline();
              setDiagnostics([]);
            }}
          >
            <Text style={styles.actionText}>Clear</Text>
          </Pressable>
        </View>
        {recentDiagnostics.length === 0 ? (
          <Text style={styles.emptyText}>No diagnostics recorded yet.</Text>
        ) : (
          <ScrollView style={styles.timeline} contentContainerStyle={styles.timelineContent}>
            {recentDiagnostics.map((event, index) => (
              <View key={event.id || `${event.ts}-${index}`} style={styles.eventRow}>
                <View style={styles.eventHeader}>
                  <Text style={styles.eventTitle}>
                    {event.type} · {event.phase}
                  </Text>
                  <Text style={styles.eventTime}>
                    {new Date(event.ts).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </Text>
                </View>
                {!!formatDiagnosticDetails(event.details) ? (
                  <Text style={styles.eventDetails}>{formatDiagnosticDetails(event.details)}</Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </SubscreenScaffold>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
  panel: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  panelTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  timelineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  timelineCount: {
    color: colors.inkMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  label: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  value: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  timeline: {
    maxHeight: 360,
  },
  timelineContent: {
    gap: spacing.sm,
  },
  eventRow: {
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.sm,
    gap: 4,
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  eventTitle: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: '800',
    flex: 1,
  },
  eventTime: {
    color: colors.inkMuted,
    fontSize: 11,
  },
  eventDetails: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  emptyText: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  });
