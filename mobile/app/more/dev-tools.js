import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAppSession } from '../../src/providers/AppProviders';
import { radii, spacing } from '../../src/theme/tokens';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { ParentAccessNotice, SubscreenScaffold } from '../../src/components/SubscreenScaffold';
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
  const {
    currentUser,
    principalType,
    bootstrapStatus,
    connectionStatus,
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
  });
