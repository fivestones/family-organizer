import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenScaffold } from '../../src/components/ScreenScaffold';
import { colors, radii, shadows, spacing } from '../../src/theme/tokens';
import { useAppSession } from '../../src/providers/AppProviders';

function firstRef(value) {
  if (!value) return null;
  return Array.isArray(value) ? value[0] || null : value;
}

function coerceNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeBalances(envelope) {
  if (envelope?.balances && typeof envelope.balances === 'object' && !Array.isArray(envelope.balances)) {
    return Object.fromEntries(
      Object.entries(envelope.balances)
        .map(([code, amount]) => [String(code).toUpperCase(), coerceNumber(amount)])
        .filter(([, amount]) => amount !== 0)
    );
  }

  if (envelope?.currency && envelope?.amount != null) {
    return { [String(envelope.currency).toUpperCase()]: coerceNumber(envelope.amount) };
  }

  return {};
}

function addBalancesInto(target, source) {
  for (const [code, amount] of Object.entries(source || {})) {
    target[code] = (target[code] || 0) + coerceNumber(amount);
  }
  return target;
}

function sortBalanceEntries(balances) {
  return Object.entries(balances || {}).sort(([a], [b]) => a.localeCompare(b));
}

function buildUnitMap(unitDefinitions) {
  return new Map((unitDefinitions || []).map((def) => [String(def.code || '').toUpperCase(), def]));
}

function formatAmount(code, amount, unitMap) {
  const upper = String(code || '').toUpperCase();
  const unit = unitMap.get(upper);

  if (unit) {
    const symbol = unit.symbol || upper;
    const isMonetary = !!unit.isMonetary;
    const decimals = unit.decimalPlaces ?? (isMonetary ? 2 : 0);
    const placement = unit.symbolPlacement ?? (isMonetary ? 'before' : 'after');
    const spacing = unit.symbolSpacing ?? placement === 'after';
    const formatted = amount.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    if (placement === 'before') {
      return spacing ? `${symbol} ${formatted}` : `${symbol}${formatted}`;
    }
    return spacing ? `${formatted} ${symbol}` : `${formatted}${symbol}`;
  }

  try {
    if (upper.length === 3) {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: upper }).format(amount);
    }
  } catch {
    // fall through
  }

  const numeric = amount.toLocaleString(undefined, {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 6,
  });
  return `${numeric} ${upper}`.trim();
}

function formatBalancesInline(balances, unitMap) {
  const entries = sortBalanceEntries(balances);
  if (entries.length === 0) return 'Empty';
  return entries.map(([code, amount]) => formatAmount(code, amount, unitMap)).join(' · ');
}

function parseTxDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTimeShort(value) {
  const date = parseTxDate(value);
  if (!date) return 'Unknown time';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function txTypeLabel(type) {
  switch (type) {
    case 'transfer-in':
      return 'Transfer in';
    case 'transfer-out':
      return 'Transfer out';
    case 'withdrawal':
      return 'Withdrawal';
    case 'deposit':
      return 'Deposit';
    default:
      return type ? String(type).replace(/-/g, ' ') : 'Transaction';
  }
}

function txAmountTone(type, amount) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'deposit' || normalized === 'transfer-in') return 'positive';
  if (normalized === 'withdrawal' || normalized === 'transfer-out') return 'negative';
  return amount >= 0 ? 'neutral' : 'negative';
}

function formatSignedTxAmount(tx, unitMap) {
  const amount = Math.abs(coerceNumber(tx.amount));
  const base = formatAmount(tx.currency || 'USD', amount, unitMap);
  const tone = txAmountTone(tx.transactionType, tx.amount);
  if (tone === 'positive') return `+${base}`;
  if (tone === 'negative') return `-${base}`;
  return base;
}

function summarizeAllowance(member, unitMap) {
  const hasAmount = member.allowanceAmount != null && member.allowanceCurrency;
  const amountLabel = hasAmount ? formatAmount(member.allowanceCurrency, coerceNumber(member.allowanceAmount), unitMap) : null;

  let cadence = 'Not configured';
  if (member.allowanceRrule) {
    const rule = String(member.allowanceRrule).toUpperCase();
    if (rule.includes('WEEKLY')) cadence = 'Weekly';
    else if (rule.includes('MONTHLY')) cadence = 'Monthly';
    else if (rule.includes('DAILY')) cadence = 'Daily';
    else cadence = 'Custom recurrence';
  }

  return {
    amountLabel,
    cadence,
    payoutDelayDays: member.allowancePayoutDelayDays ?? 0,
    startDateLabel: member.allowanceStartDate ? new Date(member.allowanceStartDate).toLocaleDateString() : null,
  };
}

export default function FinanceTab() {
  const {
    db,
    isAuthenticated,
    instantReady,
    isOnline,
    connectionStatus,
    principalType,
    currentUser,
    recordParentActivity,
  } = useAppSession();

  const [selectedMemberId, setSelectedMemberId] = useState('all');

  const financeQuery = db.useQuery(
    isAuthenticated && instantReady
      ? {
          familyMembers: {
            $: { order: { order: 'asc' } },
            allowanceEnvelopes: {},
          },
          unitDefinitions: {},
          allowanceTransactions: {
            $: { order: { createdAt: 'desc' } },
            envelope: { familyMember: {} },
            sourceEnvelope: { familyMember: {} },
            destinationEnvelope: { familyMember: {} },
          },
        }
      : null
  );

  const familyMembers = useMemo(() => financeQuery.data?.familyMembers || [], [financeQuery.data?.familyMembers]);
  const unitDefinitions = useMemo(() => financeQuery.data?.unitDefinitions || [], [financeQuery.data?.unitDefinitions]);
  const transactions = useMemo(() => financeQuery.data?.allowanceTransactions || [], [financeQuery.data?.allowanceTransactions]);
  const unitMap = useMemo(() => buildUnitMap(unitDefinitions), [unitDefinitions]);

  const membersWithFinance = useMemo(() => {
    return familyMembers.map((member) => {
      const envelopes = (member.allowanceEnvelopes || []).map((envelope) => ({
        ...envelope,
        balancesNormalized: normalizeBalances(envelope),
      }));

      const totalBalances = envelopes.reduce((acc, env) => addBalancesInto(acc, env.balancesNormalized), {});
      const envelopeIds = new Set(envelopes.map((env) => env.id));

      return {
        ...member,
        envelopes,
        envelopeIds,
        totalBalances,
      };
    });
  }, [familyMembers]);

  const selectedMember = useMemo(
    () => (selectedMemberId === 'all' ? null : membersWithFinance.find((member) => member.id === selectedMemberId) || null),
    [membersWithFinance, selectedMemberId]
  );

  const visibleMembers = useMemo(
    () => (selectedMember ? [selectedMember] : membersWithFinance),
    [membersWithFinance, selectedMember]
  );

  const familyCombinedBalances = useMemo(
    () => visibleMembers.reduce((acc, member) => addBalancesInto(acc, member.totalBalances), {}),
    [visibleMembers]
  );

  const transactionRows = useMemo(() => {
    const allowedEnvelopeIds = selectedMember ? selectedMember.envelopeIds : null;
    const selectedId = selectedMember?.id || null;

    return transactions
      .filter((tx) => {
        if (!selectedMember) return true;

        const envelope = firstRef(tx.envelope);
        const sourceEnvelope = firstRef(tx.sourceEnvelope);
        const destinationEnvelope = firstRef(tx.destinationEnvelope);

        if (envelope?.id && allowedEnvelopeIds.has(envelope.id)) return true;
        if (sourceEnvelope?.id && allowedEnvelopeIds.has(sourceEnvelope.id)) return true;
        if (destinationEnvelope?.id && allowedEnvelopeIds.has(destinationEnvelope.id)) return true;
        if (tx.createdByFamilyMemberId && tx.createdByFamilyMemberId === selectedId) return true;
        return false;
      })
      .sort((a, b) => {
        const aTime = parseTxDate(a.createdAt)?.getTime() || 0;
        const bTime = parseTxDate(b.createdAt)?.getTime() || 0;
        return bTime - aTime;
      })
      .slice(0, 20)
      .map((tx) => {
        const envelope = firstRef(tx.envelope);
        const sourceEnvelope = firstRef(tx.sourceEnvelope);
        const destinationEnvelope = firstRef(tx.destinationEnvelope);
        const envelopeOwner = firstRef(envelope?.familyMember);
        const sourceOwner = firstRef(sourceEnvelope?.familyMember);
        const destinationOwner = firstRef(destinationEnvelope?.familyMember);
        const tone = txAmountTone(tx.transactionType, tx.amount);

        let counterparty = null;
        if (tx.transactionType === 'transfer-out' && destinationEnvelope?.name) {
          counterparty = `to ${destinationEnvelope.name}${destinationOwner?.name ? ` (${destinationOwner.name})` : ''}`;
        } else if (tx.transactionType === 'transfer-in' && sourceEnvelope?.name) {
          counterparty = `from ${sourceEnvelope.name}${sourceOwner?.name ? ` (${sourceOwner.name})` : ''}`;
        } else if (envelope?.name) {
          counterparty = `in ${envelope.name}${envelopeOwner?.name ? ` (${envelopeOwner.name})` : ''}`;
        }

        return {
          ...tx,
          tone,
          signedAmountLabel: formatSignedTxAmount(tx, unitMap),
          dateLabel: formatDateTimeShort(tx.createdAt),
          typeLabel: txTypeLabel(tx.transactionType),
          counterparty,
        };
      });
  }, [selectedMember, transactions, unitMap]);

  return (
    <ScreenScaffold
      title="Finance"
      subtitle="Phase 3 now includes a live family allowance overview with envelopes, balances, allowance settings, and recent transactions. Transfer/deposit/withdraw modals are next."
      accent={colors.accentFinance}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        {
          label: connectionStatus === 'authenticated' ? 'Instant connected' : connectionStatus || 'Connecting',
          tone: connectionStatus === 'authenticated' ? 'success' : 'neutral',
        },
        {
          label: principalType === 'parent' ? 'Parent mode' : 'Kid mode',
          tone: principalType === 'parent' ? 'accent' : 'neutral',
        },
      ]}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroEyebrow}>Allowance Overview</Text>
            <Text style={styles.heroTitle}>{selectedMember ? selectedMember.name : 'Family totals'}</Text>
            <Text style={styles.heroSub}>
              {selectedMember
                ? `${selectedMember.envelopes.length} envelope${selectedMember.envelopes.length === 1 ? '' : 's'}`
                : `${membersWithFinance.length} members • ${membersWithFinance.reduce((sum, m) => sum + m.envelopes.length, 0)} envelopes`}
              {currentUser?.name ? ` • viewing as ${currentUser.name}` : ''}
            </Text>
            <Text style={styles.heroBalances}>{formatBalancesInline(familyCombinedBalances, unitMap)}</Text>
          </View>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeLabel}>{principalType === 'parent' ? 'Edit Actions Next' : 'Read-only Mode'}</Text>
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeaderRow}>
            <Text style={styles.panelTitle}>Members</Text>
            <Text style={styles.metaText}>Tap to filter balances and transactions</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.memberChipRow}>
            <Pressable
              testID="finance-member-filter-all"
              accessibilityRole="button"
              accessibilityLabel="Show family finance for all members"
              onPress={() => {
                recordParentActivity();
                setSelectedMemberId('all');
              }}
              style={[styles.memberChip, selectedMemberId === 'all' && styles.memberChipSelected]}
            >
              <Text style={[styles.memberChipText, selectedMemberId === 'all' && styles.memberChipTextSelected]}>All</Text>
            </Pressable>
            {membersWithFinance.map((member) => {
              const selected = selectedMemberId === member.id;
              return (
                <Pressable
                  key={`finance-member-${member.id}`}
                  testID={`finance-member-filter-${member.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Show finance for ${member.name}`}
                  onPress={() => {
                    recordParentActivity();
                    setSelectedMemberId(member.id);
                  }}
                  style={[styles.memberChip, selected && styles.memberChipSelected]}
                >
                  <Text style={[styles.memberChipText, selected && styles.memberChipTextSelected]}>{member.name}</Text>
                  <Text style={[styles.memberChipMeta, selected && styles.memberChipMetaSelected]}>
                    {member.allowanceEnvelopes?.length || 0} env
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeaderRow}>
            <Text style={styles.panelTitle}>Allowance Settings</Text>
            <Text style={styles.metaText}>{selectedMember ? selectedMember.name : 'Visible members'}</Text>
          </View>
          <View style={styles.memberFinanceCards}>
            {visibleMembers.length === 0 ? (
              <Text style={styles.emptyText}>No family members available.</Text>
            ) : (
              visibleMembers.map((member) => {
                const summary = summarizeAllowance(member, unitMap);
                return (
                  <View key={`allowance-summary-${member.id}`} style={styles.memberFinanceCard}>
                    <View style={styles.memberFinanceHeader}>
                      <Text style={styles.memberFinanceName}>{member.name}</Text>
                      <View style={[styles.rolePill, member.role === 'parent' ? styles.rolePillParent : styles.rolePillChild]}>
                        <Text style={[styles.rolePillText, member.role === 'parent' ? styles.rolePillTextParent : styles.rolePillTextChild]}>
                          {member.role || 'member'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.allowanceAmountLabel}>{summary.amountLabel || 'No allowance amount set'}</Text>
                    <Text style={styles.allowanceMeta}>
                      {summary.cadence}
                      {summary.startDateLabel ? ` • starts ${summary.startDateLabel}` : ''}
                      {summary.payoutDelayDays ? ` • payout delay ${summary.payoutDelayDays}d` : ''}
                    </Text>
                    <Text style={styles.allowanceTotalLabel}>Envelope total: {formatBalancesInline(member.totalBalances, unitMap)}</Text>
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeaderRow}>
            <Text style={styles.panelTitle}>Envelopes</Text>
            <Text style={styles.metaText}>
              {visibleMembers.reduce((sum, member) => sum + member.envelopes.length, 0)} total
            </Text>
          </View>
          {visibleMembers.length === 0 ? (
            <Text style={styles.emptyText}>No members selected.</Text>
          ) : visibleMembers.every((member) => member.envelopes.length === 0) ? (
            <Text style={styles.emptyText}>
              No envelopes yet for the selected member(s). Phase 3 add/edit envelope flows will populate this list.
            </Text>
          ) : (
            <View style={styles.envelopeSections}>
              {visibleMembers.map((member) => (
                <View key={`member-envelopes-${member.id}`} style={styles.envelopeSection}>
                  <View style={styles.envelopeSectionHeader}>
                    <Text style={styles.envelopeSectionTitle}>{member.name}</Text>
                    <Text style={styles.envelopeSectionMeta}>
                      {member.envelopes.length} envelope{member.envelopes.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  {member.envelopes.length === 0 ? (
                    <Text style={styles.emptyInline}>No envelopes</Text>
                  ) : (
                    member.envelopes.map((envelope) => {
                      const balancesLabel = formatBalancesInline(envelope.balancesNormalized, unitMap);
                      const goalLabel =
                        envelope.goalAmount != null && envelope.goalCurrency
                          ? formatAmount(envelope.goalCurrency, coerceNumber(envelope.goalAmount), unitMap)
                          : null;
                      return (
                        <View key={`envelope-${envelope.id}`} style={styles.envelopeCard}>
                          <View style={styles.envelopeHeader}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.envelopeName}>{envelope.name || 'Untitled envelope'}</Text>
                              {!!envelope.description ? <Text style={styles.envelopeDescription}>{envelope.description}</Text> : null}
                            </View>
                            {envelope.isDefault ? (
                              <View style={styles.defaultPill}>
                                <Text style={styles.defaultPillText}>Default</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.envelopeBalances}>{balancesLabel}</Text>
                          {goalLabel ? <Text style={styles.envelopeGoal}>Goal: {goalLabel}</Text> : null}
                        </View>
                      );
                    })
                  )}
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.panel}>
          <View style={styles.panelHeaderRow}>
            <Text style={styles.panelTitle}>Recent Transactions</Text>
            <Text style={styles.metaText}>
              {selectedMember ? selectedMember.name : 'Family'} • latest {Math.min(20, transactionRows.length)}
            </Text>
          </View>

          {financeQuery.error ? (
            <Text style={styles.errorText}>{financeQuery.error.message || 'Failed to load finance data'}</Text>
          ) : financeQuery.isLoading ? (
            <Text style={styles.emptyText}>Loading balances and transactions...</Text>
          ) : transactionRows.length === 0 ? (
            <Text style={styles.emptyText}>No transactions found for the selected scope.</Text>
          ) : (
            <View style={styles.transactionList}>
              {transactionRows.map((tx) => (
                <View key={`tx-${tx.id}`} style={styles.transactionCard}>
                  <View style={styles.transactionTopRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.transactionTitle}>{tx.typeLabel}</Text>
                      <Text style={styles.transactionMetaLine}>
                        {tx.dateLabel}
                        {tx.counterparty ? ` • ${tx.counterparty}` : ''}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.transactionAmount,
                        tx.tone === 'positive' && styles.transactionAmountPositive,
                        tx.tone === 'negative' && styles.transactionAmountNegative,
                      ]}
                    >
                      {tx.signedAmountLabel}
                    </Text>
                  </View>
                  {!!tx.description ? <Text style={styles.transactionDescription}>{tx.description}</Text> : null}
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.phaseNextCard}>
          <Text style={styles.phaseNextTitle}>Next in Finance Phase 3</Text>
          <Text style={styles.phaseNextBody}>
            Deposit/withdraw/transfer modals, transfer-to-person workflow, transaction filters, and combined converted balance display will build on this live data foundation.
          </Text>
        </View>
      </ScrollView>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  heroCard: {
    backgroundColor: '#EDF6E8',
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: '#C7DDC0',
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  heroEyebrow: {
    color: colors.accentFinance,
    fontWeight: '700',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroTitle: {
    marginTop: 2,
    color: colors.ink,
    fontWeight: '800',
    fontSize: 24,
    lineHeight: 30,
  },
  heroSub: {
    color: colors.inkMuted,
    lineHeight: 18,
    marginTop: 4,
  },
  heroBalances: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
    marginTop: 8,
  },
  heroBadge: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C7DDC0',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  heroBadgeLabel: {
    color: colors.accentFinance,
    fontWeight: '700',
    fontSize: 12,
  },
  panel: {
    backgroundColor: colors.panelElevated,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  panelTitle: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 18,
  },
  metaText: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'right',
  },
  memberChipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  memberChip: {
    borderWidth: 1,
    borderColor: '#D7CCB8',
    backgroundColor: '#FFFDF7',
    borderRadius: radii.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberChipSelected: {
    borderColor: '#AFCB9D',
    backgroundColor: '#EEF7E9',
  },
  memberChipText: {
    color: colors.ink,
    fontWeight: '700',
  },
  memberChipTextSelected: {
    color: colors.accentFinance,
  },
  memberChipMeta: {
    color: colors.inkMuted,
    fontSize: 11,
    fontWeight: '700',
  },
  memberChipMetaSelected: {
    color: '#5A7E4D',
  },
  memberFinanceCards: {
    gap: spacing.sm,
  },
  memberFinanceCard: {
    borderWidth: 1,
    borderColor: '#D8CFBE',
    borderRadius: radii.md,
    backgroundColor: '#FFFDF7',
    padding: spacing.md,
    gap: 6,
  },
  memberFinanceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  memberFinanceName: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 16,
  },
  rolePill: {
    borderRadius: radii.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  rolePillParent: {
    backgroundColor: '#F1EAF9',
    borderColor: '#D7CCE7',
  },
  rolePillChild: {
    backgroundColor: '#FFF4E9',
    borderColor: '#EBCBAA',
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  rolePillTextParent: {
    color: colors.accentMore,
  },
  rolePillTextChild: {
    color: '#A85D1D',
  },
  allowanceAmountLabel: {
    color: colors.ink,
    fontWeight: '700',
    fontSize: 15,
  },
  allowanceMeta: {
    color: colors.inkMuted,
    lineHeight: 17,
    fontSize: 12,
  },
  allowanceTotalLabel: {
    color: '#49663E',
    fontWeight: '700',
    lineHeight: 18,
    fontSize: 12,
  },
  envelopeSections: {
    gap: spacing.md,
  },
  envelopeSection: {
    gap: spacing.sm,
  },
  envelopeSectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  envelopeSectionTitle: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 15,
  },
  envelopeSectionMeta: {
    color: colors.inkMuted,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyInline: {
    color: colors.inkMuted,
    fontStyle: 'italic',
  },
  envelopeCard: {
    borderWidth: 1,
    borderColor: '#DAD0BF',
    borderRadius: radii.md,
    backgroundColor: '#FFFFFF',
    padding: spacing.md,
    gap: 6,
  },
  envelopeHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  envelopeName: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 15,
  },
  envelopeDescription: {
    color: colors.inkMuted,
    lineHeight: 17,
    marginTop: 2,
  },
  defaultPill: {
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: '#BFE2CC',
    backgroundColor: '#EAF7EE',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  defaultPillText: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '700',
  },
  envelopeBalances: {
    color: colors.ink,
    fontWeight: '700',
    lineHeight: 18,
  },
  envelopeGoal: {
    color: '#5C7058',
    fontSize: 12,
    fontWeight: '700',
  },
  transactionList: {
    gap: spacing.sm,
  },
  transactionCard: {
    borderWidth: 1,
    borderColor: '#D8CFBE',
    borderRadius: radii.md,
    backgroundColor: '#FFFDF7',
    padding: spacing.md,
    gap: 4,
  },
  transactionTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  transactionTitle: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 14,
  },
  transactionMetaLine: {
    color: colors.inkMuted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  transactionAmount: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 14,
  },
  transactionAmountPositive: {
    color: colors.success,
  },
  transactionAmountNegative: {
    color: colors.danger,
  },
  transactionDescription: {
    color: colors.inkMuted,
    lineHeight: 17,
    fontSize: 12,
  },
  emptyText: {
    color: colors.inkMuted,
    lineHeight: 20,
  },
  errorText: {
    color: colors.danger,
    lineHeight: 20,
    fontWeight: '600',
  },
  phaseNextCard: {
    backgroundColor: '#F6F2E8',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: 6,
  },
  phaseNextTitle: {
    color: colors.ink,
    fontWeight: '800',
    fontSize: 15,
  },
  phaseNextBody: {
    color: colors.inkMuted,
    lineHeight: 19,
  },
});
