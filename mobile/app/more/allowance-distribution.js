import React, { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAppSession } from '../../src/providers/AppProviders';
import { radii, spacing, withAlpha } from '../../src/theme/tokens';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { ParentAccessNotice, SubscreenScaffold } from '../../src/components/SubscreenScaffold';
import { clearPendingParentAction } from '../../src/lib/session-prefs';
import { useParentActionGate } from '../../src/hooks/useParentActionGate';

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function formatAmount(code, amount) {
  if (!code || amount == null) return 'Not configured';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(code).toUpperCase() }).format(Number(amount) || 0);
  } catch {
    return `${amount} ${String(code).toUpperCase()}`;
  }
}

function recurrenceLabel(rrule) {
  if (!rrule) return 'No recurrence';
  const upper = String(rrule).toUpperCase();
  if (upper.includes('WEEKLY')) return 'Weekly';
  if (upper.includes('MONTHLY')) return 'Monthly';
  if (upper.includes('DAILY')) return 'Daily';
  return 'Custom';
}

export default function AllowanceDistributionScreen() {
  const searchParams = useLocalSearchParams();
  const { requireParentAction } = useParentActionGate();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { db, isAuthenticated, instantReady, principalType, isOnline, connectionStatus } = useAppSession();

  useEffect(() => {
    if (firstParam(searchParams.resumeParentAction) !== '1') return;
    if (principalType !== 'parent') return;
    void clearPendingParentAction();
  }, [principalType, searchParams.resumeParentAction]);

  const allowanceQuery = db.useQuery(
    isAuthenticated && instantReady && principalType === 'parent'
      ? {
          familyMembers: {
            $: { order: { order: 'asc' } },
            allowanceEnvelopes: {},
          },
        }
      : null
  );

  const members = allowanceQuery.data?.familyMembers || [];
  const configuredMembers = useMemo(
    () =>
      members.filter((member) => member.allowanceAmount != null && member.allowanceCurrency),
    [members]
  );

  async function handoffToParent() {
    await requireParentAction({
      actionId: 'more:open:allowanceDistribution',
      actionLabel: 'Allowance Distribution',
      payload: { href: '/more/allowance-distribution' },
      returnPath: '/more/allowance-distribution',
    });
  }

  if (principalType !== 'parent') {
    return (
      <SubscreenScaffold
        title="Allowance Distribution"
        subtitle="Distribution planning is parent-only because it writes household payout transactions."
        accent={colors.accentMore}
        statusChips={[
          { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
          { label: principalType === 'parent' ? 'Parent mode' : 'Kid mode', tone: 'neutral' },
        ]}
      >
        <ParentAccessNotice
          body="Log in as a parent to review payout readiness and per-member allowance settings."
          onContinue={handoffToParent}
        />
      </SubscreenScaffold>
    );
  }

  return (
    <SubscreenScaffold
      title="Allowance Distribution"
      subtitle="This preview screen shows which members are payout-ready while the full execution workflow is still being ported."
      accent={colors.accentMore}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        {
          label: connectionStatus === 'authenticated' ? 'Instant connected' : connectionStatus || 'Connecting',
          tone: connectionStatus === 'authenticated' ? 'success' : 'neutral',
        },
        { label: `${configuredMembers.length} configured`, tone: 'accent' },
      ]}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEyebrow}>Preview</Text>
          <Text style={styles.summaryTitle}>Payout readiness</Text>
          <Text style={styles.summaryBody}>
            The live execution flow is still next, but this mobile slice already surfaces which household members have recurrence, amount, and envelope data in place.
          </Text>
        </View>

        {members.map((member) => {
          const ready = member.allowanceAmount != null && member.allowanceCurrency && (member.allowanceEnvelopes || []).length > 0;
          return (
            <View key={member.id} style={styles.memberCard}>
              <View style={styles.memberHeader}>
                <Text style={styles.memberName}>{member.name}</Text>
                <View style={[styles.statePill, ready ? styles.readyPill : styles.pendingPill]}>
                  <Text style={[styles.stateText, ready ? styles.readyText : styles.pendingText]}>
                    {ready ? 'Ready' : 'Needs setup'}
                  </Text>
                </View>
              </View>
              <Text style={styles.memberMeta}>
                {formatAmount(member.allowanceCurrency, member.allowanceAmount)} • {recurrenceLabel(member.allowanceRrule)} • {(member.allowanceEnvelopes || []).length} envelope
                {(member.allowanceEnvelopes || []).length === 1 ? '' : 's'}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </SubscreenScaffold>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
  content: {
    gap: spacing.md,
    paddingBottom: spacing.lg,
  },
  summaryCard: {
    backgroundColor: withAlpha(colors.accentMore, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(colors.accentMore, 0.22),
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  summaryEyebrow: {
    color: colors.accentMore,
    textTransform: 'uppercase',
    fontWeight: '800',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  summaryTitle: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '800',
  },
  summaryBody: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  memberCard: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  memberHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    alignItems: 'center',
  },
  memberName: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  statePill: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  readyPill: {
    backgroundColor: withAlpha(colors.success, 0.12),
    borderColor: withAlpha(colors.success, 0.26),
  },
  pendingPill: {
    backgroundColor: withAlpha(colors.warning, 0.12),
    borderColor: withAlpha(colors.warning, 0.26),
  },
  stateText: {
    fontSize: 11,
    fontWeight: '700',
  },
  readyText: {
    color: colors.success,
  },
  pendingText: {
    color: colors.warning,
  },
  memberMeta: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  });
