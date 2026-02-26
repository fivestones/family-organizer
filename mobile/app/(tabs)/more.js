import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { ScreenScaffold } from '../../src/components/ScreenScaffold';
import { colors, radii, spacing } from '../../src/theme/tokens';
import { revokeMobileDeviceSession } from '../../src/lib/api-client';
import { useAppSession } from '../../src/providers/AppProviders';
import { router } from 'expo-router';

const MENU_ITEMS = [
  { key: 'taskSeries', title: 'Task Series Manager', status: 'Phase 3/5' },
  { key: 'familyMembers', title: 'Family Members', status: 'Phase 4' },
  { key: 'allowanceDistribution', title: 'Allowance Distribution', status: 'Phase 4' },
  { key: 'files', title: 'Files', status: 'Phase 4' },
  { key: 'settings', title: 'Settings', status: 'Phase 4' },
  { key: 'devTools', title: 'Dev Tools (debug builds)', status: 'Phase 4' },
];

export default function MoreTab() {
  const {
    resetDeviceSession,
    lock,
    currentUser,
    principalType,
    connectionStatus,
    isOnline,
    bootstrapStatus,
    deviceSessionToken,
  } = useAppSession();

  async function handleResetDevice() {
    try {
      await revokeMobileDeviceSession();
    } catch {
      // Ignore network failures; local clear still forces re-activation.
    }
    await resetDeviceSession();
    router.replace('/activate');
  }

  return (
    <ScreenScaffold
      title="More"
      subtitle="Admin modules, settings, file manager, and advanced task-series tooling live here as parity phases are completed."
      accent={colors.accentMore}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        {
          label: principalType === 'parent' ? 'Parent mode' : principalType === 'kid' ? 'Kid mode' : 'No principal',
          tone: principalType === 'parent' ? 'accent' : 'neutral',
        },
      ]}
    >
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Current member</Text>
          <Text style={styles.statusValue}>{currentUser?.name || 'Locked'}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Instant connection</Text>
          <Text style={styles.statusValue}>{connectionStatus || 'unknown'}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Principal bootstrap</Text>
          <Text style={styles.statusValue}>{bootstrapStatus}</Text>
        </View>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Device session</Text>
          <Text style={styles.statusValue}>{deviceSessionToken ? 'Active' : 'Missing'}</Text>
        </View>
      </View>

      <View style={styles.menu}>
        {MENU_ITEMS.map((item) => (
          <View key={item.key} style={styles.row}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowBadge}>{item.status}</Text>
          </View>
        ))}
      </View>
      <Pressable
        testID="more-lock-app-button"
        accessibilityRole="button"
        accessibilityLabel="Lock app"
        style={styles.lockButton}
        onPress={async () => {
          await lock();
        }}
      >
        <Text style={styles.lockText}>Lock App</Text>
      </Pressable>
      <Pressable
        testID="more-reset-device-button"
        accessibilityRole="button"
        accessibilityLabel="Reset this iPhone and reactivate"
        style={styles.resetButton}
        onPress={handleResetDevice}
      >
        <Text style={styles.resetText}>Reset This iPhone (Re-activate)</Text>
      </Pressable>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  statusCard: {
    backgroundColor: colors.panelElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  statusLabel: { color: colors.inkMuted, fontSize: 12 },
  statusValue: { color: colors.ink, fontWeight: '700', fontSize: 12 },
  menu: {
    backgroundColor: colors.panelElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowTitle: { color: colors.ink, fontWeight: '600', flex: 1 },
  rowBadge: { color: colors.inkMuted, fontSize: 12 },
  lockButton: {
    backgroundColor: '#EAF1FB',
    borderColor: '#B7CAE8',
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 14,
    alignItems: 'center',
  },
  lockText: {
    color: '#315C97',
    fontWeight: '700',
  },
  resetButton: {
    backgroundColor: '#FCEDEA',
    borderColor: '#E7B9B0',
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 14,
    alignItems: 'center',
  },
  resetText: {
    color: colors.danger,
    fontWeight: '700',
  },
});
