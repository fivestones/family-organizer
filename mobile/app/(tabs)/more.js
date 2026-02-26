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
  const { clearDeviceSession } = useAppSession();

  async function handleResetDevice() {
    try {
      await revokeMobileDeviceSession();
    } catch {
      // Ignore network failures; local clear still forces re-activation.
    }
    await clearDeviceSession();
    router.replace('/activate');
  }

  return (
    <ScreenScaffold
      title="More"
      subtitle="Admin modules, settings, file manager, and advanced task-series tooling live here as parity phases are completed."
      accent={colors.accentMore}
    >
      <View style={styles.menu}>
        {MENU_ITEMS.map((item) => (
          <View key={item.key} style={styles.row}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowBadge}>{item.status}</Text>
          </View>
        ))}
      </View>
      <Pressable style={styles.resetButton} onPress={handleResetDevice}>
        <Text style={styles.resetText}>Reset This iPhone (Re-activate)</Text>
      </Pressable>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
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

