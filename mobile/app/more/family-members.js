import React, { useEffect, useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useAppSession } from '../../src/providers/AppProviders';
import { radii, spacing, withAlpha } from '../../src/theme/tokens';
import { useAppTheme } from '../../src/theme/ThemeProvider';
import { ParentAccessNotice, SubscreenScaffold } from '../../src/components/SubscreenScaffold';
import { clearPendingParentAction } from '../../src/lib/session-prefs';
import { useParentActionGate } from '../../src/hooks/useParentActionGate';
import { getApiBaseUrl } from '../../src/lib/api-client';

function firstParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function avatarUriForMember(member) {
  const fileName =
    member?.photoUrls?.['320'] ||
    member?.photoUrls?.[320] ||
    member?.photoUrls?.['64'] ||
    member?.photoUrls?.[64];

  if (!fileName) return null;
  return `${getApiBaseUrl()}/uploads/${fileName}`;
}

export default function FamilyMembersScreen() {
  const searchParams = useLocalSearchParams();
  const { requireParentAction } = useParentActionGate();
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    db,
    isAuthenticated,
    instantReady,
    principalType,
    isOnline,
    connectionStatus,
  } = useAppSession();

  useEffect(() => {
    if (firstParam(searchParams.resumeParentAction) !== '1') return;
    if (principalType !== 'parent') return;
    void clearPendingParentAction();
  }, [principalType, searchParams.resumeParentAction]);

  const familyQuery = db.useQuery(
    isAuthenticated && instantReady && principalType === 'parent'
      ? {
          familyMembers: {
            $: { order: { order: 'asc' } },
            allowanceEnvelopes: {},
          },
        }
      : null
  );

  const members = useMemo(() => familyQuery.data?.familyMembers || [], [familyQuery.data?.familyMembers]);

  async function handoffToParent() {
    await requireParentAction({
      actionId: 'more:open:familyMembers',
      actionLabel: 'Family Members',
      payload: { href: '/more/family-members' },
      returnPath: '/more/family-members',
    });
  }

  if (principalType !== 'parent') {
    return (
      <SubscreenScaffold
        title="Family Members"
        subtitle="Family administration stays parent-gated on shared devices."
        accent={colors.accentMore}
        statusChips={[
          { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
          { label: principalType === 'parent' ? 'Parent mode' : 'Kid mode', tone: 'neutral' },
        ]}
      >
        <ParentAccessNotice
          body="Log in as a parent to review member roles, PIN state, and household ordering."
          onContinue={handoffToParent}
        />
      </SubscreenScaffold>
    );
  }

  return (
    <SubscreenScaffold
      title="Family Members"
      subtitle="Phase 4 now includes a native family roster view with ordering, role, PIN, and envelope snapshots."
      accent={colors.accentMore}
      statusChips={[
        { label: isOnline ? 'Online' : 'Offline', tone: isOnline ? 'success' : 'warning' },
        {
          label: connectionStatus === 'authenticated' ? 'Instant connected' : connectionStatus || 'Connecting',
          tone: connectionStatus === 'authenticated' ? 'success' : 'neutral',
        },
        { label: `${members.length} members`, tone: 'accent' },
      ]}
    >
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryEyebrow}>Roster</Text>
          <Text style={styles.summaryTitle}>Shared-device household</Text>
          <Text style={styles.summaryBody}>
            Photo uploads, drag reordering, and edit forms are next, but the mobile admin roster is now showing live member data from Instant.
          </Text>
        </View>

        {familyQuery.isLoading ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Loading family members…</Text>
          </View>
        ) : members.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No family members found</Text>
            <Text style={styles.emptyBody}>Create members on the web app first, then they will appear here for mobile admin review.</Text>
          </View>
        ) : (
          members.map((member, index) => {
            const avatarUri = avatarUriForMember(member);
            const role = member.role || 'child';
            const roleIsParent = role === 'parent';
            return (
              <View key={member.id} style={styles.memberCard}>
                <View style={styles.memberHeader}>
                  <View style={styles.memberIdentity}>
                    {avatarUri ? (
                      <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                    ) : (
                      <View
                        style={[
                          styles.avatarFallback,
                          {
                            backgroundColor: roleIsParent
                              ? withAlpha(colors.accentMore, 0.18)
                              : withAlpha(colors.warning, 0.16),
                          },
                        ]}
                      >
                        <Text style={styles.avatarLetter}>{(member.name || '?').slice(0, 1).toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={styles.memberName}>{member.name}</Text>
                      <Text style={styles.memberMeta}>Sort order #{index + 1}</Text>
                    </View>
                  </View>
                  <View style={[styles.rolePill, roleIsParent ? styles.parentPill : styles.childPill]}>
                    <Text style={[styles.roleText, roleIsParent ? styles.parentText : styles.childText]}>{role}</Text>
                  </View>
                </View>

                <View style={styles.detailGrid}>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>PIN</Text>
                    <Text style={styles.detailValue}>{member.pinHash ? 'Configured' : 'Not set'}</Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Email</Text>
                    <Text style={styles.detailValue}>{member.email || 'No email'}</Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>Envelopes</Text>
                    <Text style={styles.detailValue}>
                      {(member.allowanceEnvelopes || []).length} total
                    </Text>
                  </View>
                  <View style={styles.detailCell}>
                    <Text style={styles.detailLabel}>View prefs</Text>
                    <Text style={styles.detailValue}>
                      {member.viewShowChoreDescriptions ? 'Descriptions on' : 'Descriptions off'}
                      {' · '}
                      {member.viewShowTaskDetails ? 'Tasks on' : 'Tasks off'}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
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
  emptyCard: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  emptyBody: {
    color: colors.inkMuted,
    lineHeight: 18,
  },
  memberCard: {
    backgroundColor: colors.panelElevated,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  memberHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  memberIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  avatarImage: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.panelElevated,
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.ink,
  },
  memberName: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '800',
  },
  memberMeta: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  rolePill: {
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  parentPill: {
    backgroundColor: withAlpha(colors.accentMore, 0.12),
    borderColor: withAlpha(colors.accentMore, 0.24),
  },
  childPill: {
    backgroundColor: withAlpha(colors.warning, 0.12),
    borderColor: withAlpha(colors.warning, 0.24),
  },
  roleText: {
    fontWeight: '700',
    fontSize: 11,
  },
  parentText: {
    color: colors.accentMore,
  },
  childText: {
    color: colors.warning,
  },
  detailGrid: {
    gap: spacing.sm,
  },
  detailCell: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radii.sm,
    padding: spacing.sm,
    gap: 2,
    backgroundColor: colors.panel,
  },
  detailLabel: {
    color: colors.inkMuted,
    fontSize: 11,
    textTransform: 'uppercase',
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  detailValue: {
    color: colors.ink,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  });
