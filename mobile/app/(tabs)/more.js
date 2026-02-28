import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenScaffold } from '../../src/components/ScreenScaffold';
import { radii, spacing, withAlpha } from '../../src/theme/tokens';
import { revokeMobileDeviceSession } from '../../src/lib/api-client';
import { useAppSession } from '../../src/providers/AppProviders';
import { router, useLocalSearchParams } from 'expo-router';
import { clearPendingParentAction, getPendingParentAction } from '../../src/lib/session-prefs';
import { useParentActionGate } from '../../src/hooks/useParentActionGate';
import { useAppTheme } from '../../src/theme/ThemeProvider';

const MENU_ITEMS = [
  {
    key: 'taskSeries',
    title: 'Task Series Manager',
    description: 'Live status, assignees, and checklist progress.',
    status: 'Live',
    href: '/more/task-series',
    parentOnly: true,
  },
  {
    key: 'familyMembers',
    title: 'Family Members',
    description: 'Household roster, roles, PIN state, and profile snapshots.',
    status: 'Live',
    href: '/more/family-members',
    parentOnly: true,
  },
  {
    key: 'allowanceDistribution',
    title: 'Allowance Distribution',
    description: 'Preview household payout readiness before the execution workflow lands.',
    status: 'Preview',
    href: '/more/allowance-distribution',
    parentOnly: true,
  },
  {
    key: 'files',
    title: 'Files',
    description: 'Browse uploaded files and open them through the mobile auth route.',
    status: 'Live',
    href: '/more/files',
    parentOnly: true,
  },
  {
    key: 'settings',
    title: 'Settings',
    description: 'Local appearance plus shared currency and unit definitions.',
    status: 'Live',
    href: '/more/settings',
    parentOnly: false,
  },
  {
    key: 'devTools',
    title: 'Dev Tools',
    description: 'Session details and debug helpers for simulator and device testing.',
    status: 'Preview',
    href: '/more/dev-tools',
    parentOnly: true,
  },
];

const MENU_ITEM_BY_KEY = Object.fromEntries(MENU_ITEMS.map((item) => [item.key, item]));

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default function MoreTab() {
  const searchParams = useLocalSearchParams();
  const { requireParentAction } = useParentActionGate();
  const { colors } = useAppTheme();
  const styles = React.useMemo(() => createStyles(colors), [colors]);
  const {
    resetDeviceSession,
    lock,
    currentUser,
    principalType,
    connectionStatus,
    isOnline,
    bootstrapStatus,
    deviceSessionToken,
    isAuthenticated,
    recordParentActivity,
  } = useAppSession();
  const [resumePendingAction, setResumePendingAction] = useState(null);
  const [handledResumeNonce, setHandledResumeNonce] = useState('');

  async function handleResetDevice() {
    try {
      await revokeMobileDeviceSession();
    } catch {
      // Ignore network failures; local clear still forces re-activation.
    }
    await resetDeviceSession();
    router.replace('/activate');
  }

  async function handleLockApp() {
    await lock();
    router.replace('/lock?intent=switch-user');
  }

  useEffect(() => {
    const shouldResume = firstParam(searchParams.resumeParentAction) === '1';
    const resumeNonce = String(firstParam(searchParams.resumeNonce) || '');
    if (!shouldResume || !resumeNonce || resumeNonce === handledResumeNonce) return;

    let cancelled = false;
    async function loadPendingAction() {
      const pending = await getPendingParentAction();
      if (cancelled) return;
      setHandledResumeNonce(resumeNonce);
      if (pending?.actionId?.startsWith('more:open:')) {
        setResumePendingAction(pending);
      }
    }

    void loadPendingAction();
    return () => {
      cancelled = true;
    };
  }, [handledResumeNonce, searchParams.resumeNonce, searchParams.resumeParentAction]);

  useEffect(() => {
    if (!resumePendingAction) return;
    if (!isAuthenticated || principalType !== 'parent') return;

    const key = resumePendingAction.actionId.replace('more:open:', '');
    const item = MENU_ITEM_BY_KEY[key];

    void (async () => {
      await clearPendingParentAction();
      setResumePendingAction(null);
      if (item?.href) {
        router.push(item.href);
      }
    })();
  }, [isAuthenticated, principalType, resumePendingAction]);

  async function handleMenuPress(item) {
    recordParentActivity();

    if (item.parentOnly && (!isAuthenticated || principalType !== 'parent')) {
      await requireParentAction({
        actionId: `more:open:${item.key}`,
        actionLabel: item.title,
        payload: { href: item.href },
        returnPath: '/more',
      });
      return;
    }

    if (item.href) {
      router.push(item.href);
    }
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

      <ScrollView style={styles.menu} contentContainerStyle={styles.menuContent} showsVerticalScrollIndicator={false}>
        {MENU_ITEMS.map((item) => (
          <Pressable
            key={item.key}
            testID={`more-menu-${item.key}`}
            accessibilityRole="button"
            accessibilityLabel={`Open ${item.title}`}
            style={styles.row}
            onPress={() => {
              void handleMenuPress(item);
            }}
          >
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowDescription}>{item.description}</Text>
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowBadge}>{item.status}</Text>
              <Text style={styles.rowArrow}>›</Text>
            </View>
          </Pressable>
        ))}
        <Pressable
          testID="more-lock-app-button"
          accessibilityRole="button"
          accessibilityLabel="Lock app"
          style={styles.lockButton}
          onPress={() => {
            void handleLockApp();
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
      </ScrollView>
    </ScreenScaffold>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
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
    flex: 1,
  },
  menuContent: {
    backgroundColor: colors.panelElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
    paddingBottom: spacing.md,
  },
  row: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowCopy: { flex: 1, gap: 4 },
  rowTitle: { color: colors.ink, fontWeight: '700', flex: 1 },
  rowDescription: { color: colors.inkMuted, fontSize: 12, lineHeight: 16 },
  rowMeta: {
    alignItems: 'flex-end',
    gap: 4,
  },
  rowBadge: { color: colors.inkMuted, fontSize: 12, fontWeight: '700' },
  rowArrow: { color: colors.inkMuted, fontSize: 18, lineHeight: 18 },
  lockButton: {
    backgroundColor: withAlpha(colors.accentCalendar, 0.1),
    borderColor: withAlpha(colors.accentCalendar, 0.24),
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 14,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  lockText: {
    color: colors.accentCalendar,
    fontWeight: '700',
  },
  resetButton: {
    backgroundColor: withAlpha(colors.danger, 0.1),
    borderColor: withAlpha(colors.danger, 0.24),
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingVertical: 14,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  resetText: {
    color: colors.danger,
    fontWeight: '700',
  },
  });
